// Importations des modèles de données et des outils de synchronisation.
use crate::models::{ConsumptionInfo, GraphState, MessageInfo};
use std::sync::Arc;
use tokio::sync::RwLock;

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
    pub messages: Arc<RwLock<Option<(Vec<MessageInfo>, std::time::Instant)>>>,
    // Cache pour la liste des consommations.
    pub consumptions: Arc<RwLock<Option<(Vec<ConsumptionInfo>, std::time::Instant)>>>,
    // Cache pour l'état du graphe de dépendances.
    pub graph_state: Arc<RwLock<Option<(GraphState, std::time::Instant)>>>,

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
}
