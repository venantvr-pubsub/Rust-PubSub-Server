// Importations des modèles de données et des outils de synchronisation.
use crate::models::{ConsumptionInfo, GraphState, MessageInfo};
use std::sync::Arc;
use tokio::sync::RwLock;

// Une entrée de cache : la donnée accompagnée de son instant de création, `None` si vide.
// L'alias sert aussi de signature commune à `get_or_fetch_cached` (handlers.rs).
pub type CacheEntry<T> = Arc<RwLock<Option<(T, std::time::Instant)>>>;

// La structure `QueryCache` est conçue pour stocker en mémoire les résultats de requêtes coûteuses,
// afin de réduire la charge sur la base de données et d'accélérer les réponses.
// C'est un exemple du pattern "cache-aside".
#[derive(Debug)]
pub struct QueryCache {
    // Chaque champ utilise `Arc<RwLock<Option<...>>>` pour une gestion concurrente et thread-safe du cache.
    // `Arc`: Permet de partager la possession du cache entre plusieurs threads (ex: différents handlers de requêtes).
    // `RwLock`: Permet de multiples lectures simultanées (non bloquantes) ou une seule écriture exclusive.
    //          C'est idéal pour un cache où les lectures sont beaucoup plus fréquentes que les écritures.
    // `Option<(T, std::time::Instant)>`: Stocke la donnée (`T`) avec son timestamp de création.
    // `None` signifie que le cache est vide ou invalide pour cette donnée.

    // Cache pour la liste des messages.
    pub messages: CacheEntry<Vec<MessageInfo>>,
    // Cache pour la liste des consommations.
    pub consumptions: CacheEntry<Vec<ConsumptionInfo>>,
    // Cache pour l'état du graphe de dépendances.
    pub graph_state: CacheEntry<GraphState>,

    // `ttl` (Time-To-Live): Durée de validité d'une entrée dans le cache.
    // Après cette durée, l'entrée est considérée comme expirée et devra être rafraîchie.
    pub ttl: std::time::Duration,
}

impl QueryCache {
    // Constructeur pour `QueryCache`.
    pub fn new(ttl_secs: u64) -> Self {
        Self {
            // Initialise chaque champ du cache à `None` (vide).
            messages: Arc::new(RwLock::new(None)),
            consumptions: Arc::new(RwLock::new(None)),
            graph_state: Arc::new(RwLock::new(None)),
            // Définit la durée de vie des entrées du cache à partir des secondes fournies.
            ttl: std::time::Duration::from_secs(ttl_secs),
        }
    }

    // --- Invalidation explicite ---
    //
    // Le TTL seul ne suffit pas. Le dashboard réagit à l'événement `new_message` en rechargeant
    // `/messages` immédiatement : sans invalidation, il recevait l'instantané mis en cache jusqu'à
    // `ttl` secondes plus tôt, donc *sans* le message qui vient de déclencher le rafraîchissement.
    // Le message n'apparaissait qu'au rafraîchissement suivant, ce qui donnait l'impression que le
    // dashboard sautait des messages.

    // Invalide le cache des messages et celui du graphe (un nouveau producteur/topic peut être apparu).
    pub async fn invalidate_messages(&self) {
        *self.messages.write().await = None;
        *self.graph_state.write().await = None;
    }

    // Invalide le cache des consommations et celui du graphe.
    pub async fn invalidate_consumptions(&self) {
        *self.consumptions.write().await = None;
        *self.graph_state.write().await = None;
    }

    // Invalide uniquement le graphe (nouvel abonnement, déconnexion d'un client).
    pub async fn invalidate_graph(&self) {
        *self.graph_state.write().await = None;
    }
}
