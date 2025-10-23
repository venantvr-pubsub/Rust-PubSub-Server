// Importations de l'état de l'application, des modèles de message, et des composants Socket.IO.
use crate::app_state::AppState;
use crate::models::{ConsumedMessage, SubscribeMessage};
use socketioxide::extract::{Data, SocketRef};
use tracing::info;

// Configure tous les gestionnaires d'événements pour le namespace par défaut ("/") de Socket.IO.
pub fn setup_socketio_handlers(io: socketioxide::SocketIo, state: AppState) {
    // `io.ns` définit la logique pour un namespace spécifique. Ici, le namespace racine.
    io.ns("/", move |socket: SocketRef| {
        // Ce code est exécuté chaque fois qu'un nouveau client se connecte.
        let state = state.clone();
        info!("Socket.IO client connected: {}", socket.id);

        // --- Gestionnaire pour l'événement "subscribe" ---
        let state_clone = state.clone();
        socket.on(
            "subscribe",
            // `Data<T>` est un extracteur qui désérialise le payload de l'événement en type `T`.
            move |socket: SocketRef, Data::<SubscribeMessage>(data)| {
                let state = state_clone.clone();
                let sid = socket.id.to_string();

                // Le bloc `async move` permet d'utiliser `await` à l'intérieur du handler.
                async move {
                    info!(
                        "Subscribing {} (SID: {}) to topics: {:?}",
                        data.consumer, sid, data.topics
                    );

                    // Boucle sur chaque sujet demandé dans le message d'abonnement.
                    for topic in &data.topics {
                        // Enregistre l'abonnement dans le Broker (qui le sauvegardera en DB et en cache).
                        state
                            .broker
                            .register_subscription(
                                sid.clone(),
                                data.consumer.clone(),
                                topic.clone(),
                            )
                            .await;

                        // Utilise le système de "salles" (rooms) de Socket.IO pour gérer la diffusion.
                        if topic == "*" {
                            // Abonnement "wildcard" : le client reçoit tous les messages.
                            // On le fait quitter toutes les autres salles et rejoindre une salle spéciale "__all__".
                            socket.leave_all();
                            socket.join("__all__");
                            info!(
                                "{} subscribed to ALL topics via wildcard '*'",
                                data.consumer
                            );
                        } else {
                            // Abonnement à un sujet spécifique : le client rejoint la salle correspondant au nom du sujet.
                            socket.join(topic.clone());
                        }
                    }

                    // Envoie une confirmation d'abonnement au client.
                    let _ = socket.emit("subscribed", &serde_json::json!({"status": "ok"}));
                }
            },
        );

        // --- Gestionnaire pour l'événement "consumed" ---
        let state_clone2 = state.clone();
        socket.on(
            "consumed",
            move |_socket: SocketRef, Data::<ConsumedMessage>(data)| {
                let state = state_clone2.clone();
                async move {
                    // Quand un client confirme avoir consommé un message, on sauvegarde cette information.
                    state
                        .broker
                        .save_consumption(data.consumer, data.topic, data.message_id, data.message)
                        .await;
                }
            },
        );

        // --- Gestionnaire pour la déconnexion ---
        let state_clone3 = state.clone();
        socket.on_disconnect(move |socket: SocketRef| {
            let state = state_clone3.clone();
            async move {
                info!("Socket.IO client disconnected: {}", socket.id);
                // Notifie le Broker que le client est parti pour nettoyer les abonnements.
                state.broker.unregister_client(&socket.id.to_string()).await;
            }
        });
    });
}
