use crate::broker::Broker;
use crate::cache::QueryCache;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::{broadcast, RwLock};

#[derive(Clone)]
pub struct AppState {
    pub broker: Arc<Broker>,
    pub topic_channels: Arc<RwLock<HashMap<String, broadcast::Sender<String>>>>,
    pub cache: Arc<QueryCache>,
}

impl AppState {
    pub fn new(broker: Arc<Broker>) -> Self {
        Self {
            broker,
            topic_channels: Arc::new(RwLock::new(HashMap::with_capacity(100))),
            cache: Arc::new(QueryCache::new(2)),
        }
    }
}
