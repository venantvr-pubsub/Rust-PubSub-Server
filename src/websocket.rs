use crate::app_state::AppState;
use crate::models::{ConsumedMessage, SubscribeMessage};
use axum::{
    extract::{ws::WebSocketUpgrade, State},
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tracing::{info, warn};
use uuid::Uuid;

pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(socket: axum::extract::ws::WebSocket, state: AppState) {
    let sid = Uuid::new_v4().to_string();
    let (mut ws_sender, mut ws_receiver) = socket.split();

    let (internal_tx, mut internal_rx) = mpsc::unbounded_channel::<String>();

    let mut event_rx = state.broker.event_tx.subscribe();
    let internal_tx_clone = internal_tx.clone();
    let broadcast_task = tokio::spawn(async move {
        while let Ok(event) = event_rx.recv().await {
            if let Ok(msg) = serde_json::to_string(event.as_ref()) {
                if internal_tx_clone.send(msg).is_err() {
                    break;
                }
            }
        }
    });

    let topic_tasks: Arc<RwLock<Vec<tokio::task::JoinHandle<()>>>> =
        Arc::new(RwLock::new(Vec::new()));
    let topic_tasks_clone = topic_tasks.clone();

    let send_task = tokio::spawn(async move {
        while let Some(msg) = internal_rx.recv().await {
            if ws_sender
                .send(axum::extract::ws::Message::Text(msg.into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    while let Some(msg) = ws_receiver.next().await {
        let msg = if let Ok(msg) = msg {
            msg
        } else {
            break;
        };

        if let axum::extract::ws::Message::Text(text) = msg {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
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
                                    state
                                        .broker
                                        .register_subscription(
                                            sid.clone(),
                                            sub_msg.consumer.clone(),
                                            topic.clone(),
                                        )
                                        .await;

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

                                    let internal_tx_for_topic = internal_tx.clone();
                                    let topic_name = topic.clone();
                                    let task = tokio::spawn(async move {
                                        loop {
                                            match rx.recv().await {
                                                Ok(msg) => {
                                                    if internal_tx_for_topic.send(msg).is_err() {
                                                        break;
                                                    }
                                                }
                                                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                                                    warn!(
                                                        "Topic {} lagged by {} messages",
                                                        topic_name, n
                                                    );
                                                }
                                                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                                                    break;
                                                }
                                            }
                                        }
                                    });

                                    let mut tasks = topic_tasks_clone.write().await;
                                    tasks.push(task);
                                }
                            }
                        }
                        "consumed" => {
                            if let Ok(consumed_msg) =
                                serde_json::from_value::<ConsumedMessage>(parsed.clone())
                            {
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

    info!("Client disconnecting (SID: {})", sid);
    state.broker.unregister_client(&sid).await;
    broadcast_task.abort();
    send_task.abort();

    let tasks = topic_tasks.write().await;
    for task in tasks.iter() {
        task.abort();
    }
}
