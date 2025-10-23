use crate::models::{ConsumptionInfo, GraphState, MessageInfo};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug)]
pub struct QueryCache {
    pub messages: Arc<RwLock<Option<(Vec<MessageInfo>, std::time::Instant)>>>,
    pub consumptions: Arc<RwLock<Option<(Vec<ConsumptionInfo>, std::time::Instant)>>>,
    pub graph_state: Arc<RwLock<Option<(GraphState, std::time::Instant)>>>,
    pub ttl: std::time::Duration,
}

impl QueryCache {
    pub fn new(ttl_secs: u64) -> Self {
        Self {
            messages: Arc::new(RwLock::new(None)),
            consumptions: Arc::new(RwLock::new(None)),
            graph_state: Arc::new(RwLock::new(None)),
            ttl: std::time::Duration::from_secs(ttl_secs),
        }
    }
}
