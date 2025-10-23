mod app_state;
mod broker;
mod cache;
mod database;
mod embedded;
mod handlers;
mod models;
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

    let app = Router::new()
        .route("/publish", post(publish_handler))
        .route("/clients", get(clients_handler))
        .route("/messages", get(messages_handler))
        .route("/consumptions", get(consumptions_handler))
        .route("/graph/state", get(graph_state_handler))
        .route("/health", get(health_check))
        .route("/ws", get(ws_handler))
        .with_state(state)
        .fallback(serve_embedded)
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
