use crate::app_state::AppState;
use crate::models::{
    ClientInfo, ConsumptionInfo, GraphState, HealthStatus, MessageInfo, PublishRequest,
};
use axum::{extract::State, http::StatusCode, Json};
use std::sync::Arc;
use std::time::SystemTime;
use tokio::sync::RwLock;
use tracing::info;

async fn get_or_fetch_cached<T, F, Fut>(
    cache: &Arc<RwLock<Option<(T, std::time::Instant)>>>,
    ttl: std::time::Duration,
    fetch_fn: F,
) -> T
where
    T: Clone,
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = T>,
{
    // Check cache
    {
        let cache_read = cache.read().await;
        if let Some((data, timestamp)) = cache_read.as_ref() {
            if timestamp.elapsed() < ttl {
                return data.clone();
            }
        }
    }

    // Fetch new data
    let data = fetch_fn().await;

    // Update cache
    {
        let mut cache_write = cache.write().await;
        *cache_write = Some((data.clone(), std::time::Instant::now()));
    }

    data
}

pub async fn publish_handler(
    State(state): State<AppState>,
    Json(payload): Json<PublishRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if payload.topic.is_empty() || payload.message_id.is_empty() || payload.producer.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    info!(
        "Publishing message {} to topic {} by {}",
        payload.message_id, payload.topic, payload.producer
    );

    state
        .broker
        .save_message(
            payload.topic.clone(),
            payload.message_id.clone(),
            payload.message.clone(),
            payload.producer.clone(),
        )
        .await;

    let channels = state.topic_channels.read().await;
    if let Some(tx) = channels.get(&payload.topic) {
        let msg = serde_json::to_string(&payload).unwrap_or_default();
        let _ = tx.send(msg);
    }

    Ok(Json(serde_json::json!({"status": "ok"})))
}

pub async fn clients_handler(State(state): State<AppState>) -> Json<Vec<ClientInfo>> {
    Json(state.broker.get_clients().await)
}

pub async fn messages_handler(State(state): State<AppState>) -> Json<Vec<MessageInfo>> {
    let messages = get_or_fetch_cached(&state.cache.messages, state.cache.ttl, || async {
        state.broker.get_messages().await
    })
    .await;
    Json(messages)
}

pub async fn consumptions_handler(State(state): State<AppState>) -> Json<Vec<ConsumptionInfo>> {
    let consumptions = get_or_fetch_cached(&state.cache.consumptions, state.cache.ttl, || async {
        state.broker.get_consumptions().await
    })
    .await;
    Json(consumptions)
}

pub async fn graph_state_handler(State(state): State<AppState>) -> Json<GraphState> {
    let graph = get_or_fetch_cached(&state.cache.graph_state, state.cache.ttl, || async {
        state.broker.get_graph_state().await
    })
    .await;
    Json(graph)
}

pub async fn health_check(State(state): State<AppState>) -> Result<Json<HealthStatus>, StatusCode> {
    match state.broker.db().acquire().await {
        Ok(_) => Ok(Json(HealthStatus {
            status: "healthy".to_string(),
            timestamp: current_timestamp(),
        })),
        Err(e) => {
            tracing::error!("Health check failed: DB acquire error: {}", e);
            Err(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
}

fn current_timestamp() -> f64 {
    SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64()
}
