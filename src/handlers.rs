// Importations de l'état de l'application, des modèles de données, et des composants Axum/Socket.IO.
use crate::app_state::AppState;
use crate::models::{
    ClientInfo, ConsumptionInfo, GraphState, HealthStatus, MessageInfo, PublishRequest,
};
use axum::{extract::State, http::StatusCode, Json};
use socketioxide::SocketIo;
use std::sync::{atomic::Ordering, Arc};
use std::time::SystemTime;
use tokio::sync::RwLock;
use tracing::info;

// --- Fonction générique de mise en cache (Cache-Aside Pattern) ---
// Cette fonction est une abstraction puissante pour gérer la logique de cache.
async fn get_or_fetch_cached<T, F, Fut>(
    // Le champ de cache spécifique à utiliser (ex: `state.cache.messages`).
    cache: &Arc<RwLock<Option<(T, std::time::Instant)>>>,
    // La durée de vie (TTL) du cache.
    ttl: std::time::Duration,
    // Une fonction (closure) qui sera appelée pour récupérer les données fraîches si le cache est vide ou expiré.
    fetch_fn: F,
    // Un booléen pour activer/désactiver le cache.
    dashboard_enabled: bool,
) -> T
where
    // `T` est le type de données à mettre en cache (ex: `Vec<MessageInfo>`).
    T: Clone,
    // `F` est une fonction qui ne prend pas d'arguments et retourne un Future.
    F: FnOnce() -> Fut,
    // `Fut` est un Future qui se résout en une valeur de type `T`.
    Fut: std::future::Future<Output = T>,
{
    // Si le dashboard (et donc le cache) est désactivé, on récupère toujours les données fraîches.
    if !dashboard_enabled {
        return fetch_fn().await;
    }

    // --- Étape 1: Vérifier le cache (partie lecture) ---
    {
        // `read().await` obtient un verrou en lecture. Plusieurs threads peuvent lire en même temps.
        let cache_read = cache.read().await;
        if let Some((data, timestamp)) = cache_read.as_ref() {
            // Si le cache contient des données et qu'elles n'ont pas expiré...
            if timestamp.elapsed() < ttl {
                // ... on retourne une copie des données du cache. C'est un "cache hit".
                return data.clone();
            }
        }
    } // Le verrou en lecture est libéré ici.

    // --- Étape 2: Récupérer les données (Cache Miss) ---
    // Si on arrive ici, c'est un "cache miss" (données absentes ou expirées).
    let data = fetch_fn().await;

    // --- Étape 3: Mettre à jour le cache (partie écriture) ---
    {
        // `write().await` obtient un verrou en écriture. Un seul thread peut écrire à la fois.
        let mut cache_write = cache.write().await;
        // On met à jour le cache avec les nouvelles données et le timestamp actuel.
        *cache_write = Some((data.clone(), std::time::Instant::now()));
    } // Le verrou en écriture est libéré ici.

    // On retourne les données fraîchement récupérées.
    data
}

// Les deux stratégies d'émission sont mutuellement exclusives, mais rien n'obligeait à en activer
// une : `--no-default-features` compilait sans erreur un serveur qui enregistrait bien les messages
// mais ne les livrait à aucun abonné. On transforme donc ce piège en erreur de compilation.
#[cfg(not(any(feature = "parallel-emit", feature = "sequential-emit")))]
compile_error!(
    "Activez exactement une stratégie d'émission : --features parallel-emit (défaut) ou sequential-emit"
);

#[cfg(all(feature = "parallel-emit", feature = "sequential-emit"))]
compile_error!(
    "Les features parallel-emit et sequential-emit s'excluent : chaque message serait émis deux fois"
);

// Réponse d'erreur JSON. Le handler renvoyait auparavant un `StatusCode` nu, donc un corps vide :
// côté navigateur, `response.json()` levait alors « Unexpected end of JSON input » et masquait la
// vraie raison du rejet.
fn error_response(status: StatusCode, message: &str) -> (StatusCode, Json<serde_json::Value>) {
    (
        status,
        Json(serde_json::json!({"status": "error", "message": message})),
    )
}

// Handler pour la publication de messages via une requête POST sur `/publish`.
pub async fn publish_handler(
    // `State` est un extracteur Axum qui injecte l'état partagé de l'application.
    State((state, io)): State<(AppState, SocketIo)>,
    // `Json` est un extracteur qui désérialise le corps de la requête en une structure Rust.
    Json(payload): Json<PublishRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // Validation simple des données d'entrée.
    if payload.topic.is_empty() {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "`topic` est requis et ne peut pas être vide",
        ));
    }
    if payload.message_id.is_empty() {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "`message_id` est requis et ne peut pas être vide",
        ));
    }
    if payload.producer.is_empty() {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "`producer` est requis et ne peut pas être vide",
        ));
    }
    // `__all__` est la salle interne utilisée pour les abonnements wildcard : un topic portant ce
    // nom livrerait ses messages en double à tous les abonnés wildcard.
    if payload.topic == "__all__" {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "`__all__` est un nom de salle réservé et ne peut pas être utilisé comme topic",
        ));
    }

    info!(
        "Publishing message {} to topic {} by {}",
        payload.message_id, payload.topic, payload.producer
    );

    // Délègue la sauvegarde du message au `Broker`.
    state
        .broker
        .save_message(
            payload.topic.clone(),
            payload.message_id.clone(),
            payload.message.clone(),
            payload.producer.clone(),
        )
        .await;

    // Le dashboard recharge `/messages` dès qu'il reçoit `new_message` : purger le cache ici évite
    // de lui resservir un instantané antérieur à ce message.
    state.cache.invalidate_messages().await;

    // Relaie aussi le message aux clients WebSocket bruts (`/ws`), qui s'abonnent via
    // `state.topic_channels`. Sans cela, ces canaux étaient alimentés par personne : un client
    // `/ws` pouvait s'abonner avec succès puis n'obtenir jamais le moindre message.
    fanout_to_ws_subscribers(&state, &payload).await;

    // Émet le message via Socket.IO aux clients abonnés.
    // La compilation conditionnelle (`cfg`) permet de choisir entre deux stratégies d'émission.

    // Stratégie "parallel-emit" : envoie aux deux salles en même temps pour une latence plus faible.
    #[cfg(feature = "parallel-emit")]
    {
        if let (Some(ns1), Some(ns2)) = (io.of("/"), io.of("/")) {
            let topic_emit = ns1.to(payload.topic.clone()).emit("message", &payload);
            let wildcard_emit = ns2.to("__all__").emit("message", &payload);
            // `tokio::join!` exécute les deux futurs d'émission en parallèle.
            let _ = tokio::join!(topic_emit, wildcard_emit);
        }
    }

    // Stratégie "sequential-emit" : comportement original, envoie séquentiellement.
    #[cfg(feature = "sequential-emit")]
    {
        if let Some(ns) = io.of("/") {
            let _ = ns.to(payload.topic.clone()).emit("message", &payload).await;
        }

        if let Some(ns) = io.of("/") {
            let _ = ns.to("__all__").emit("message", &payload).await;
        }
    }

    Ok(Json(serde_json::json!({"status": "ok"})))
}

// Diffuse le message sur les canaux `broadcast` consommés par les connexions `/ws`.
async fn fanout_to_ws_subscribers(state: &AppState, payload: &PublishRequest) {
    let serialized = match serde_json::to_string(payload) {
        Ok(text) => text,
        Err(e) => {
            tracing::error!("Sérialisation du message impossible pour les clients /ws: {}", e);
            return;
        }
    };

    // Verrou en lecture seulement : on n'ajoute jamais de canal ici, on ne publie que sur ceux
    // qu'un abonné a déjà créés. `send` échoue quand il ne reste aucun abonné, ce qui est normal.
    let channels = state.topic_channels.read().await;
    if let Some(tx) = channels.get(&payload.topic) {
        let _ = tx.send(serialized.clone());
    }
    // Les abonnés wildcard `/ws` rejoignent le canal "*".
    if let Some(tx) = channels.get("*") {
        let _ = tx.send(serialized);
    }
}

// Handler pour GET `/api/clients` : retourne la liste des clients connectés.
pub async fn clients_handler(
    State((state, _)): State<(AppState, SocketIo)>,
) -> Json<Vec<ClientInfo>> {
    // Les données viennent directement du cache en mémoire du broker, c'est donc très rapide.
    Json(state.broker.get_clients().await)
}

// Handler pour GET `/api/messages` : retourne les derniers messages.
pub async fn messages_handler(
    State((state, _)): State<(AppState, SocketIo)>,
) -> Json<Vec<MessageInfo>> {
    let dashboard_enabled = state.dashboard_enabled.load(Ordering::Relaxed);
    // Utilise la fonction de cache générique.
    let messages = get_or_fetch_cached(
        &state.cache.messages, // Le cache à utiliser.
        state.cache.ttl, // Le TTL.
        || async { state.broker.get_messages().await }, // La fonction pour fetch les données.
        dashboard_enabled, // L'état d'activation du cache.
    )
    .await;
    Json(messages)
}

// Handler pour GET `/api/consumptions` : retourne les dernières consommations.
pub async fn consumptions_handler(
    State((state, _)): State<(AppState, SocketIo)>,
) -> Json<Vec<ConsumptionInfo>> {
    let dashboard_enabled = state.dashboard_enabled.load(Ordering::Relaxed);
    // Utilise la même logique de cache que pour les messages.
    let consumptions = get_or_fetch_cached(
        &state.cache.consumptions,
        state.cache.ttl,
        || async { state.broker.get_consumptions().await },
        dashboard_enabled,
    )
    .await;
    Json(consumptions)
}

// Handler pour GET `/api/graph-state` : retourne les données pour le graphe.
pub async fn graph_state_handler(
    State((state, _)): State<(AppState, SocketIo)>,
) -> Json<GraphState> {
    let dashboard_enabled = state.dashboard_enabled.load(Ordering::Relaxed);
    // Utilise la même logique de cache.
    let graph = get_or_fetch_cached(
        &state.cache.graph_state,
        state.cache.ttl,
        || async { state.broker.get_graph_state().await },
        dashboard_enabled,
    )
    .await;
    Json(graph)
}

// Handler pour GET `/health` : vérifie l'état de santé du service.
pub async fn health_check(
    State((state, _)): State<(AppState, SocketIo)>,
) -> Result<Json<HealthStatus>, StatusCode> {
    // Tente d'obtenir une connexion à la base de données.
    match state.broker.db().acquire().await {
        // Si réussi, le service est considéré comme sain.
        Ok(_) => Ok(Json(HealthStatus {
            status: "healthy".to_string(),
            timestamp: current_timestamp(),
        })),
        // Si échec, le service est en mauvaise santé.
        Err(e) => {
            tracing::error!("Health check failed: DB acquire error: {}", e);
            Err(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
}

// Fonction utilitaire pour le timestamp.
fn current_timestamp() -> f64 {
    SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64()
}

// Handler pour POST `/api/dashboard/login` : active le mode dashboard.
pub async fn dashboard_login_handler(
    State((state, _)): State<(AppState, SocketIo)>,
) -> Json<serde_json::Value> {
    // `store` est une opération atomique pour définir la valeur du booléen.
    // `Ordering::Relaxed` est la contrainte de mémoire la plus faible, suffisante ici car il n'y a pas d'autre synchronisation qui en dépend.
    state.dashboard_enabled.store(true, Ordering::Relaxed);
    info!("Dashboard enabled");
    Json(serde_json::json!({
        "status": "ok",
        "dashboard_enabled": true
    }))
}

// Handler pour POST `/api/dashboard/logout` : désactive le mode dashboard.
pub async fn dashboard_logout_handler(
    State((state, _)): State<(AppState, SocketIo)>,
) -> Json<serde_json::Value> {
    state.dashboard_enabled.store(false, Ordering::Relaxed);
    info!("Dashboard disabled");
    Json(serde_json::json!({
        "status": "ok",
        "dashboard_enabled": false
    }))
}

// Handler pour GET `/api/dashboard/status` : vérifie l'état du dashboard.
pub async fn dashboard_status_handler(
    State((state, _)): State<(AppState, SocketIo)>,
) -> Json<serde_json::Value> {
    // `load` est une opération atomique pour lire la valeur.
    let enabled = state.dashboard_enabled.load(Ordering::Relaxed);
    Json(serde_json::json!({
        "dashboard_enabled": enabled
    }))
}
