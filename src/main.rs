// Déclaration des modules qui composent l'application.
// Chaque `mod` correspond à un fichier `.rs` du même nom.
mod app_state;
mod broker;
mod cache;
mod database;
mod embedded;
mod handlers;
mod models;
mod socketio;
mod websocket;

// Importations des structures et fonctions nécessaires depuis les autres modules et bibliothèques.
use app_state::AppState;
use axum::{
    routing::{get, post}, // Pour définir les routes HTTP GET et POST.
    Router, // Le routeur Axum qui associe les chemins aux handlers.
};
use broker::Broker;
use database::init_database;
use embedded::serve_embedded; // Handler pour les fichiers statiques embarqués.
use handlers::{
    clients_handler, consumptions_handler, dashboard_login_handler, dashboard_logout_handler,
    dashboard_status_handler, graph_state_handler, health_check, messages_handler, publish_handler,
};
use socketioxide::SocketIo;
use std::{net::SocketAddr, sync::Arc}; // Pour l'adresse du serveur et le partage de références thread-safe.
use tokio::sync::broadcast; // Canal de diffusion pour les événements.
use tower_http::cors::CorsLayer; // Middleware pour gérer les requêtes Cross-Origin (CORS).
use tracing::info; // Pour la journalisation.
use websocket::ws_handler; // Handler pour la connexion WebSocket.

// `#[tokio::main]` est une macro qui transforme la fonction `main` asynchrone
// en une fonction `main` synchrone standard en créant un runtime Tokio.
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialise le système de journalisation `tracing`.
    tracing_subscriber::fmt::init();

    // Récupère le chemin du fichier de base de données depuis une variable d'environnement.
    // Si la variable n'est pas définie, utilise une base de données en mémoire (`:memory:`), idéal pour les tests.
    let db_file = std::env::var("DATABASE_FILE").unwrap_or_else(|_| ":memory:".to_string());

    info!("Initializing database...");
    // Initialise la base de données (crée le fichier, applique les migrations, etc.).
    let pool = init_database(&db_file).await?;

    // Limite le nombre de connexions pour éviter de surcharger la base de données.
    sqlx::query("PRAGMA max_connections = 10")
        .execute(&pool)
        .await
        .ok();

    // Crée un canal de diffusion (`broadcast`) pour les événements internes de l'application.
    // `1000` est la capacité du canal.
    let (event_tx, _) = broadcast::channel(1000);
    // Crée le `Broker` et l'enveloppe dans un `Arc` pour le partager de manière sûre entre les threads.
    let broker = Arc::new(Broker::new(pool, event_tx.clone()));

    // Crée l'état global de l'application.
    let state = AppState::new(broker);

    // Crée la couche (`Layer`) et l'instance de Socket.IO.
    let (io_layer, io) = SocketIo::new_layer();

    // Configure les handlers pour les événements Socket.IO (connexion, abonnement, etc.).
    socketio::setup_socketio_handlers(io.clone(), state.clone());

    // --- Tâche de fond pour relayer les événements du Broker vers les clients Socket.IO ---
    // S'abonne au canal d'événements du Broker.
    let mut event_rx = event_tx.subscribe();
    let io_clone = io.clone();
    let state_clone = state.clone();
    tokio::spawn(async move {
        // Boucle infinie pour recevoir les événements.
        while let Ok(event) = event_rx.recv().await {
            // Ne relaie les événements que si le dashboard est activé.
            // C'est une optimisation pour éviter un travail inutile si personne n'écoute.
            if state_clone
                .dashboard_enabled
                .load(std::sync::atomic::Ordering::Relaxed)
            {
                if let Some(ns) = io_clone.of("/") {
                    // Émet l'événement à tous les clients connectés sur le namespace par défaut.
                    let _ = ns.emit(event.event_type.as_str(), &event.data).await;
                }
            }
        }
    });

    // Combine l'état de l'application et l'instance Socket.IO pour les injecter dans les handlers Axum.
    let app_state_with_io = (state.clone(), io);

    // Construit le routeur principal de l'application.
    let app = Router::new()
        // Définit les routes pour l'API REST.
        .route("/publish", post(publish_handler))
        .route("/clients", get(clients_handler))
        .route("/messages", get(messages_handler))
        .route("/consumptions", get(consumptions_handler))
        .route("/graph/state", get(graph_state_handler))
        .route("/health", get(health_check))
        // Route pour la connexion WebSocket brute.
        .route("/ws", get(ws_handler))
        // Routes pour la gestion du dashboard.
        .route("/dashboard/login", post(dashboard_login_handler))
        .route("/dashboard/logout", post(dashboard_logout_handler))
        .route("/dashboard/status", get(dashboard_status_handler))
        // Injecte l'état partagé dans tous les handlers.
        .with_state(app_state_with_io)
        // `fallback` définit un handler pour toutes les requêtes qui ne correspondent à aucune autre route.
        // Utilisé ici pour servir les fichiers statiques (HTML, CSS, JS).
        .fallback(serve_embedded)
        // Ajoute la couche Socket.IO au routeur.
        .layer(io_layer)
        // Ajoute la couche CORS pour autoriser les requêtes depuis n'importe quelle origine.
        .layer(CorsLayer::permissive());

    // Définit l'adresse et le port d'écoute du serveur.
    let addr = SocketAddr::from(([0, 0, 0, 0], 5000));
    info!("Server starting on {}", addr);

    // Crée un listener TCP sur l'adresse spécifiée.
    let listener = tokio::net::TcpListener::bind(addr).await?;

    // Lance le serveur Axum.
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}
