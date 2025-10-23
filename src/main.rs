mod app_state;
mod broker;
mod cache;
mod database;
mod embedded;
mod handlers;
mod models;
mod socketio;
mod websocket;

use app_state::AppState;
use axum::{
    routing::{get, post},
    Router,
};
use broker::Broker;
use database::init_database;
use embedded::serve_embedded;
use handlers::{
    clients_handler, consumptions_handler, graph_state_handler, health_check, messages_handler,
    publish_handler,
};
use socketioxide::SocketIo;
use std::{net::SocketAddr, sync::Arc};
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tracing::info;
use websocket::ws_handler;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();

    let db_file = std::env::var("DATABASE_FILE").unwrap_or_else(|_| ":memory:".to_string());

    info!("Initializing database...");
    let pool = init_database(&db_file).await?;

    sqlx::query("PRAGMA max_connections = 10")
        .execute(&pool)
        .await
        .ok();

    let (event_tx, _) = broadcast::channel(1000);
    let broker = Arc::new(Broker::new(pool, event_tx.clone()));

    let state = AppState::new(broker);

    // Create Socket.IO layer
    let (io_layer, io) = SocketIo::new_layer();

    // Setup Socket.IO handlers
    socketio::setup_socketio_handlers(io.clone(), state.clone());

    // Spawn a task to broadcast events to Socket.IO clients
    let mut event_rx = event_tx.subscribe();
    let io_clone = io.clone();
    tokio::spawn(async move {
        while let Ok(event) = event_rx.recv().await {
            if let Some(ns) = io_clone.of("/") {
                // Emit to all connected Socket.IO clients
                let _ = ns.emit(event.event_type.as_str(), &event.data).await;
            }
        }
    });

    // Create app state with Socket.IO instance
    let app_state_with_io = (state.clone(), io);

    let app = Router::new()
        .route("/publish", post(publish_handler))
        .route("/clients", get(clients_handler))
        .route("/messages", get(messages_handler))
        .route("/consumptions", get(consumptions_handler))
        .route("/graph/state", get(graph_state_handler))
        .route("/health", get(health_check))
        .route("/ws", get(ws_handler))
        .with_state(app_state_with_io)
        .fallback(serve_embedded)
        .layer(io_layer)
        .layer(CorsLayer::permissive());

    let addr = SocketAddr::from(([0, 0, 0, 0], 5000));
    info!("Server starting on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}
