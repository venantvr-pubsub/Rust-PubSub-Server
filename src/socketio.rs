use crate::app_state::AppState;
use crate::models::{ConsumedMessage, SubscribeMessage};
use socketioxide::extract::{Data, SocketRef};
use tracing::info;

pub fn setup_socketio_handlers(io: socketioxide::SocketIo, state: AppState) {
    io.ns("/", move |socket: SocketRef| {
        let state = state.clone();
        info!("Socket.IO client connected: {}", socket.id);

        let state_clone = state.clone();

        socket.on(
            "subscribe",
            move |socket: SocketRef, Data::<SubscribeMessage>(data)| {
                let state = state_clone.clone();
                let sid = socket.id.to_string();

                async move {
                    info!(
                        "Subscribing {} (SID: {}) to topics: {:?}",
                        data.consumer, sid, data.topics
                    );

                    for topic in &data.topics {
                        state
                            .broker
                            .register_subscription(
                                sid.clone(),
                                data.consumer.clone(),
                                topic.clone(),
                            )
                            .await;

                        // Use Socket.IO rooms like Flask-SocketIO
                        if topic == "*" {
                            // Wildcard subscription - join room "__all__"
                            socket.leave_all();
                            socket.join("__all__");
                            info!(
                                "{} subscribed to ALL topics via wildcard '*'",
                                data.consumer
                            );
                        } else {
                            // Subscribe to specific topic room
                            socket.join(topic.clone());
                        }
                    }

                    let _ = socket.emit("subscribed", &serde_json::json!({"status": "ok"}));
                }
            },
        );

        let state_clone2 = state.clone();
        socket.on(
            "consumed",
            move |_socket: SocketRef, Data::<ConsumedMessage>(data)| {
                let state = state_clone2.clone();
                async move {
                    state
                        .broker
                        .save_consumption(data.consumer, data.topic, data.message_id, data.message)
                        .await;
                }
            },
        );

        let state_clone3 = state.clone();
        socket.on_disconnect(move |socket: SocketRef| {
            let state = state_clone3.clone();
            async move {
                info!("Socket.IO client disconnected: {}", socket.id);
                state.broker.unregister_client(&socket.id.to_string()).await;
            }
        });
    });
}
