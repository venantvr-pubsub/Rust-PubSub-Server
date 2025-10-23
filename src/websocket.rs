// Importations nécessaires pour l'état, les modèles, Axum, les WebSockets, et la synchronisation.
use crate::app_state::AppState;
use crate::models::{ConsumedMessage, SubscribeMessage};
use axum::{
    extract::{ws::WebSocketUpgrade, State},
    response::Response,
};
use futures_util::{SinkExt, StreamExt}; // Traits pour envoyer et recevoir sur des flux (streams).
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock}; // Canal MPSC pour la communication interne et RwLock pour l'accès concurrent.
use tracing::{info, warn};
use uuid::Uuid; // Pour générer des identifiants uniques.

// Handler Axum pour le point de terminaison `/ws`.
pub async fn ws_handler(
    // `WebSocketUpgrade` est un extracteur qui permet de transformer une requête HTTP en connexion WebSocket.
    ws: WebSocketUpgrade,
    State((state, _)): State<(crate::app_state::AppState, socketioxide::SocketIo)>,
) -> Response {
    // `on_upgrade` finalise la mise à niveau et fournit un `socket` WebSocket, qui est ensuite passé à notre logique de gestion.
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

// Gère le cycle de vie complet d'une connexion WebSocket individuelle.
async fn handle_socket(socket: axum::extract::ws::WebSocket, state: AppState) {
    // Génère un ID de session unique pour ce client WebSocket.
    let sid = Uuid::new_v4().to_string();
    // Sépare le socket en un `sender` (pour écrire) et un `receiver` (pour lire).
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Crée un canal MPSC (multi-producer, single-consumer) interne.
    // C'est un pattern clé ici : plusieurs tâches (abonnements aux topics, broadcast global)
    // peuvent envoyer des messages dans ce canal (`internal_tx`), et une seule tâche (`send_task`)
    // les consomme pour les écrire sur le WebSocket. Cela évite les accès concurrents au `ws_sender`.
    let (internal_tx, mut internal_rx) = mpsc::unbounded_channel::<String>();

    // --- Tâche de Broadcast Global ---
    // S'abonne au canal d'événements global du Broker.
    let mut event_rx = state.broker.event_tx.subscribe();
    let internal_tx_clone = internal_tx.clone();
    let broadcast_task = tokio::spawn(async move {
        // Écoute les événements et les transfère au canal interne du client.
        while let Ok(event) = event_rx.recv().await {
            if let Ok(msg) = serde_json::to_string(event.as_ref()) {
                if internal_tx_clone.send(msg).is_err() {
                    // Si l'envoi échoue, le client est probablement déconnecté, on arrête la tâche.
                    break;
                }
            }
        }
    });

    // Stocke les handles des tâches d'abonnement aux topics pour pouvoir les arrêter plus tard.
    let topic_tasks: Arc<RwLock<Vec<tokio::task::JoinHandle<()>>>> =
        Arc::new(RwLock::new(Vec::new()));
    let topic_tasks_clone = topic_tasks.clone();

    // --- Tâche d'Envoi (Sender) ---
    // Tâche dédiée à l'envoi de messages au client WebSocket.
    let send_task = tokio::spawn(async move {
        // Lit en continu depuis le canal interne.
        while let Some(msg) = internal_rx.recv().await {
            // Envoie le message au client via le WebSocket.
            if ws_sender
                .send(axum::extract::ws::Message::Text(msg.into()))
                .await
                .is_err()
            {
                // Si l'envoi échoue, le client est déconnecté, on arrête la tâche.
                break;
            }
        }
    });

    // --- Boucle de Réception (Receiver) ---
    // Boucle principale qui attend les messages entrants du client.
    while let Some(msg) = ws_receiver.next().await {
        let msg = if let Ok(msg) = msg {
            msg
        } else {
            // Erreur de réception, probablement une déconnexion.
            break;
        };

        if let axum::extract::ws::Message::Text(text) = msg {
            // Tente de parser le message texte en JSON.
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                // Recherche un champ "event" pour déterminer le type de message (pattern similaire à Socket.IO).
                if let Some(event_type) = parsed.get("event").and_then(|v| v.as_str()) {
                    match event_type {
                        "subscribe" => {
                            if let Ok(sub_msg) =
                                serde_json::from_value::<SubscribeMessage>(parsed.clone())
                            {
                                info!(
                                    "Subscribing {} (SID: {}) to topics: {:?}",
                                    sub_msg.consumer, sid, sub_msg.topics
                                );

                                for topic in &sub_msg.topics {
                                    // Enregistre l'abonnement dans le Broker.
                                    state
                                        .broker
                                        .register_subscription(
                                            sid.clone(),
                                            sub_msg.consumer.clone(),
                                            topic.clone(),
                                        )
                                        .await;

                                    // Crée ou récupère un canal de diffusion pour ce topic spécifique.
                                    let mut rx = {
                                        let mut channels = state.topic_channels.write().await;
                                        let tx = channels
                                            .entry(topic.clone())
                                            .or_insert_with(|| {
                                                tokio::sync::broadcast::channel(1000).0
                                            })
                                            .clone();
                                        tx.subscribe()
                                    };

                                    // Crée une tâche dédiée pour cet abonnement de topic.
                                    let internal_tx_for_topic = internal_tx.clone();
                                    let topic_name = topic.clone();
                                    let task = tokio::spawn(async move {
                                        loop {
                                            match rx.recv().await {
                                                Ok(msg) => {
                                                    // Transfère le message du topic au canal interne du client.
                                                    if internal_tx_for_topic.send(msg).is_err() {
                                                        break;
                                                    }
                                                }
                                                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                                                    // Le client est trop lent et a manqué des messages.
                                                    warn!(
                                                        "Topic {} lagged by {} messages",
                                                        topic_name, n
                                                    );
                                                }
                                                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                                                    // Le canal du topic a été fermé.
                                                    break;
                                                }
                                            }
                                        }
                                    });

                                    // Ajoute la nouvelle tâche à la liste pour le nettoyage futur.
                                    let mut tasks = topic_tasks_clone.write().await;
                                    tasks.push(task);
                                }
                            }
                        }
                        "consumed" => {
                            if let Ok(consumed_msg) =
                                serde_json::from_value::<ConsumedMessage>(parsed.clone())
                            {
                                // Sauvegarde la confirmation de consommation.
                                state
                                    .broker
                                    .save_consumption(
                                        consumed_msg.consumer,
                                        consumed_msg.topic,
                                        consumed_msg.message_id,
                                        consumed_msg.message,
                                    )
                                    .await;
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    // --- Nettoyage --- 
    // Ce code est exécuté lorsque la boucle de réception se termine (client déconnecté).
    info!("Client disconnecting (SID: {})", sid);
    // Désenregistre le client du Broker.
    state.broker.unregister_client(&sid).await;
    // Arrête toutes les tâches de fond associées à ce client pour libérer les ressources.
    broadcast_task.abort();
    send_task.abort();

    let tasks = topic_tasks.write().await;
    for task in tasks.iter() {
        task.abort();
    }
}
