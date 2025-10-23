use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishRequest {
    pub topic: String,
    pub message_id: String,
    pub message: serde_json::Value,
    pub producer: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClientInfo {
    pub consumer: String,
    pub topic: String,
    pub connected_at: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MessageInfo {
    pub topic: String,
    pub message_id: String,
    pub message: serde_json::Value,
    pub producer: String,
    pub timestamp: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConsumptionInfo {
    pub consumer: String,
    pub topic: String,
    pub message_id: String,
    pub message: serde_json::Value,
    pub timestamp: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphState {
    pub producers: Vec<String>,
    pub consumers: Vec<String>,
    pub topics: Vec<String>,
    pub links: Vec<Link>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Link {
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub link_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HealthStatus {
    pub status: String,
    pub timestamp: f64,
}

#[derive(Debug, Deserialize)]
pub struct SubscribeMessage {
    pub consumer: String,
    pub topics: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct ConsumedMessage {
    pub consumer: String,
    pub topic: String,
    pub message_id: String,
    pub message: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct BroadcastEvent {
    pub event_type: String,
    pub data: serde_json::Value,
}
