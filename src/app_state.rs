// Utilise des modules pour le broker, le cache, et la synchronisation.
use crate::broker::Broker;
use crate::cache::QueryCache;
use std::{
    collections::HashMap,
    // `Arc` pour partage thread-safe, `AtomicBool` pour booléen atomique.
    sync::{atomic::AtomicBool, Arc},
};
// `RwLock` pour accès concurrent (lectures multiples/une écriture), `broadcast` pour diffusion.
use tokio::sync::{broadcast, RwLock};

// `#[derive(Clone)]` permet de dupliquer l'état de l'application.
#[derive(Clone)]
// `AppState` contient l'état partagé de l'application, accessible par tous les threads.
pub struct AppState {
    // `Arc<Broker>`: Pointeur pour partager le `Broker` entre threads de manière sûre.
    pub broker: Arc<Broker>,
    // `Arc<RwLock<...>>`: Partage thread-safe d'un HashMap.
    // `RwLock`: Optimise les accès concurrents (plusieurs lecteurs ou un seul rédacteur).
    // `HashMap`: Associe un nom de topic à un canal de diffusion (`broadcast::Sender`).
    pub topic_channels: Arc<RwLock<HashMap<String, broadcast::Sender<String>>>>,
    // `Arc<QueryCache>`: Partage thread-safe du cache de requêtes.
    pub cache: Arc<QueryCache>,
    // `Arc<AtomicBool>`: Un booléen thread-safe, plus performant qu'un Mutex pour les cas simples.
    pub dashboard_enabled: Arc<AtomicBool>,
}

impl AppState {
    // `new` est le constructeur pour `AppState`.
    pub fn new(broker: Arc<Broker>) -> Self {
        Self {
            broker,
            // `with_capacity(100)`: Pré-alloue la mémoire, une optimisation de performance.
            topic_channels: Arc::new(RwLock::new(HashMap::with_capacity(100))),
            // Crée une nouvelle instance du cache.
            cache: Arc::new(QueryCache::new(2)),
            // Initialise le drapeau du dashboard à `false`.
            dashboard_enabled: Arc::new(AtomicBool::new(false)),
        }
    }
}
