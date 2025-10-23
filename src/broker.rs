// Importations de modèles et de bibliothèques nécessaires.
use crate::models::{BroadcastEvent, ClientInfo, ConsumptionInfo, GraphState, Link, MessageInfo};
// Pour l'interaction avec la base de données SQLite.
use sqlx::sqlite::SqlitePool;
// Structures de données standard, partage thread-safe, et temps système.
use std::{collections::HashMap, sync::Arc, time::SystemTime};
// Outils de synchronisation asynchrone de Tokio.
use tokio::sync::{broadcast, mpsc, RwLock};
// Pour la journalisation des erreurs et des avertissements.
use tracing::{error, warn};

// Énumération représentant les commandes à envoyer au worker de base de données.
// Ceci permet de centraliser les opérations DB et de les traiter de manière asynchrone.
pub enum DbCommand {
    // Enregistre un nouvel abonnement d'un consommateur à un sujet.
    RegisterSubscription {
        // ID de session unique du client.
        sid: String,
        // Nom du consommateur.
        consumer: String,
        // Nom du sujet.
        topic: String,
        // Timestamp de la connexion.
        connected_at: f64,
    },
    // Sauvegarde un message publié sur un sujet.
    SaveMessage {
        topic: String,
        // ID unique du message.
        message_id: String,
        // Contenu du message (JSON).
        message: String,
        // Nom du producteur.
        producer: String,
        timestamp: f64,
    },
    // Sauvegarde la confirmation de consommation d'un message.
    SaveConsumption {
        consumer: String,
        topic: String,
        message_id: String,
        message: String,
        timestamp: f64,
    },
    // Supprime un client lors de sa déconnexion.
    UnregisterClient {
        sid: String,
    },
}

// Configuration for automatic data purging
// Nombre maximum de messages à conserver.
const MAX_MESSAGES: i64 = 10_000;
// Nombre maximum de consommations à conserver.
const MAX_CONSUMPTIONS: i64 = 10_000;
// Âge maximum des données en heures.
const MAX_AGE_HOURS: f64 = 24.0;
// Intervalle en minutes entre chaque purge.
const PURGE_INTERVAL_MINUTES: u64 = 30;

// Le `Broker` est le cœur de l'application, gérant l'état, les messages et les clients.
pub struct Broker {
    // Pool de connexions à la base de données pour les lectures.
    db: SqlitePool,
    // Canal pour diffuser des événements à l'échelle de l'application (ex: dashboard).
    pub event_tx: broadcast::Sender<Arc<BroadcastEvent>>,
    // Cache en mémoire des abonnements: sid -> (consommateur, sujets, timestamp).
    // `Arc<RwLock<...>>` est un choix de performance :
    // `Arc` permet le partage entre threads.
    // `RwLock` permet de multiples lectures simultanées, ce qui est fréquent,
    // et une seule écriture, ce qui est moins fréquent. C'est plus performant qu'un `Mutex` ici.
    subscriptions: Arc<RwLock<HashMap<String, (String, Vec<String>, f64)>>>,
    // Canal pour envoyer des commandes d'écriture à la base de données.
    db_tx: mpsc::UnboundedSender<DbCommand>,
}

impl Broker {
    // Constructeur pour le `Broker`.
    pub fn new(db: SqlitePool, event_tx: broadcast::Sender<Arc<BroadcastEvent>>) -> Self {
        let (db_tx, mut db_rx) = mpsc::unbounded_channel::<DbCommand>();
        let db_clone = db.clone();

        // Worker dédié pour les écritures DB en batch
        // `tokio::spawn` exécute cette tâche en arrière-plan, sans bloquer le reste de l'application.
        // C'est une optimisation de performance clé pour découpler les écritures DB du chemin de requête principal.
        tokio::spawn(async move {
            // Pré-alloue un vecteur pour regrouper les commandes.
            let mut batch = Vec::with_capacity(500);
            // Intervalle de temps pour vider le batch.
            let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(20));

            loop {
                // `tokio::select!` attend sur plusieurs futurs en même temps.
                tokio::select! {
                    // Si l'intervalle se déclenche, on vide le batch.
                    _ = interval.tick() => {
                        if !batch.is_empty() {
                            Self::flush_batch(&db_clone, &mut batch).await;
                        }
                    }
                    // Si une nouvelle commande arrive, on l'ajoute au batch.
                    Some(cmd) = db_rx.recv() => {
                        batch.push(cmd);
                        // Si le batch atteint sa capacité maximale, on le vide immédiatement.
                        if batch.len() >= 500 {
                            Self::flush_batch(&db_clone, &mut batch).await;
                        }
                    }
                    // Si le canal est fermé, on sort de la boucle.
                    else => break,
                }
            }
        });

        // Worker dédié pour la purge automatique des données
        // Une autre tâche de fond dédiée à la maintenance de la base de données.
        let purge_db = db.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
                PURGE_INTERVAL_MINUTES * 60,
            ));

            // Wait for first interval before running
            // Attend le premier intervalle avant de commencer pour ne pas purger au démarrage.
            interval.tick().await;

            loop {
                // Attend le prochain intervalle.
                interval.tick().await;
                Self::purge_old_data(&purge_db).await;
            }
        });

        Self {
            db,
            event_tx,
            subscriptions: Arc::new(RwLock::new(HashMap::with_capacity(1000))),
            db_tx,
        }
    }

    // Traite un batch de commandes DB à l'intérieur d'une seule transaction.
    // L'utilisation de transactions garantit l'atomicité : soit toutes les commandes réussissent, soit aucune n'est appliquée.
    async fn flush_batch(db: &SqlitePool, batch: &mut Vec<DbCommand>) {
        if batch.is_empty() {
            return;
        }

        let mut tx = match db.begin().await {
            Ok(tx) => tx,
            Err(e) => {
                // On vide le batch pour ne pas retenter des commandes qui ont échoué.
                error!("Impossible de démarrer une transaction: {}", e);
                batch.clear();
                return;
            }
        };

        let mut has_error = false;

        // Itère sur les commandes et les exécute.
        for cmd in batch.drain(..) {
            let result = match cmd {
                DbCommand::RegisterSubscription {
                    sid,
                    consumer,
                    topic,
                    connected_at,
                } => {
                    // `INSERT OR REPLACE` est utilisé pour mettre à jour l'abonnement s'il existe déjà.
                    sqlx::query("INSERT OR REPLACE INTO subscriptions (sid, consumer, topic, connected_at) VALUES (?, ?, ?, ?)")
                        .bind(sid)
                        .bind(consumer)
                        .bind(topic)
                        .bind(connected_at)
                        .execute(&mut *tx)
                        .await
                }
                DbCommand::SaveMessage {
                    topic,
                    message_id,
                    message,
                    producer,
                    timestamp,
                } => {
                    sqlx::query("INSERT INTO messages (topic, message_id, message, producer, timestamp) VALUES (?, ?, ?, ?, ?)")
                        .bind(topic)
                        .bind(message_id)
                        .bind(message)
                        .bind(producer)
                        .bind(timestamp)
                        .execute(&mut *tx)
                        .await
                }
                DbCommand::SaveConsumption {
                    consumer,
                    topic,
                    message_id,
                    message,
                    timestamp,
                } => {
                    sqlx::query("INSERT INTO consumptions (consumer, topic, message_id, message, timestamp) VALUES (?, ?, ?, ?, ?)")
                        .bind(consumer)
                        .bind(topic)
                        .bind(message_id)
                        .bind(message)
                        .bind(timestamp)
                        .execute(&mut *tx)
                        .await
                }
                DbCommand::UnregisterClient { sid } => {
                    sqlx::query("DELETE FROM subscriptions WHERE sid = ?")
                        .bind(sid)
                        .execute(&mut *tx)
                        .await
                }
            };

            if let Err(e) = result {
                // Arrête le traitement du batch en cas d'erreur.
                error!("Erreur lors de l'exécution d'une commande DB: {}", e);
                has_error = true;
                break;
            }
        }

        // Atomicité garantie : COMMIT seulement si tout a réussi
        // `COMMIT` ou `ROLLBACK` de la transaction.
        if has_error {
            if let Err(e) = tx.rollback().await {
                error!("Erreur lors du rollback de la transaction: {}", e);
            } else {
                warn!("Transaction annulée suite à une erreur");
            }
        } else if let Err(e) = tx.commit().await {
            error!("Erreur lors du commit de la transaction: {}", e);
        }
    }

    // Supprime les anciennes données de la base de données pour éviter qu'elle ne grossisse indéfiniment.
    async fn purge_old_data(db: &SqlitePool) {
        use tracing::info;

        let start = std::time::Instant::now();
        let cutoff_timestamp = current_timestamp() - (MAX_AGE_HOURS * 3600.0);

        // Start a transaction for all purge operations
        // Utilise une transaction pour assurer que la purge est atomique.
        let mut tx = match db.begin().await {
            Ok(tx) => tx,
            Err(e) => {
                error!("Impossible de démarrer une transaction de purge: {}", e);
                return;
            }
        };

        let mut total_deleted = 0i64;

        // Purge messages: keep only MAX_MESSAGES most recent AND remove anything older than MAX_AGE_HOURS
        // Purge les messages en gardant les `MAX_MESSAGES` plus récents et en supprimant tout ce qui est plus vieux que `MAX_AGE_HOURS`.
        match sqlx::query(
            "DELETE FROM messages WHERE id NOT IN (
                SELECT id FROM messages ORDER BY timestamp DESC LIMIT ?
            ) OR timestamp < ?",
        )
        .bind(MAX_MESSAGES)
        .bind(cutoff_timestamp)
        .execute(&mut *tx)
        .await
        {
            Ok(result) => {
                let deleted = result.rows_affected();
                if deleted > 0 {
                    info!("Purge: supprimé {} anciens messages", deleted);
                    total_deleted += deleted as i64;
                }
            }
            Err(e) => {
                // Annule la transaction en cas d'erreur.
                error!("Erreur lors de la purge des messages: {}", e);
                let _ = tx.rollback().await;
                return;
            }
        }

        // Purge consumptions: keep only MAX_CONSUMPTIONS most recent AND remove anything older than MAX_AGE_HOURS
        // Fait de même pour les consommations.
        match sqlx::query(
            "DELETE FROM consumptions WHERE id NOT IN (
                SELECT id FROM consumptions ORDER BY timestamp DESC LIMIT ?
            ) OR timestamp < ?",
        )
        .bind(MAX_CONSUMPTIONS)
        .bind(cutoff_timestamp)
        .execute(&mut *tx)
        .await
        {
            Ok(result) => {
                let deleted = result.rows_affected();
                if deleted > 0 {
                    info!("Purge: supprimé {} anciennes consommations", deleted);
                    total_deleted += deleted as i64;
                }
            }
            Err(e) => {
                error!("Erreur lors de la purge des consommations: {}", e);
                let _ = tx.rollback().await;
                return;
            }
        }

        // Commit the transaction
        // Valide la transaction si tout s'est bien passé.
        if let Err(e) = tx.commit().await {
            error!("Erreur lors du commit de la transaction de purge: {}", e);
            return;
        }

        if total_deleted > 0 {
            let elapsed = start.elapsed();
            info!(
                "Purge terminée: {} enregistrements supprimés en {:?}",
                total_deleted, elapsed
            );
        }
    }

    // Enregistre un nouvel abonnement.
    pub async fn register_subscription(&self, sid: String, consumer: String, topic: String) {
        if sid.is_empty() || consumer.is_empty() || topic.is_empty() {
            warn!("register_subscription: Paramètres requis manquants");
            return;
        }

        let connected_at = current_timestamp();

        // Envoie la commande d'enregistrement au worker DB. L'opération est asynchrone et ne bloque pas.
        let _ = self.db_tx.send(DbCommand::RegisterSubscription {
            sid: sid.clone(),
            consumer: consumer.clone(),
            topic: topic.clone(),
            connected_at,
        });

        {
            // Met à jour le cache en mémoire des abonnements.
            // `write().await` obtient un verrou en écriture sur le `RwLock`.
            let mut subs = self.subscriptions.write().await;
            subs.entry(sid.clone())
                .and_modify(|(_, topics, _)| {
                    if !topics.contains(&topic) {
                        topics.push(topic.clone());
                    }
                })
                .or_insert((consumer.clone(), vec![topic.clone()], connected_at));
        }

        // Diffuse un événement pour notifier (par exemple, le dashboard) qu'un nouveau client s'est connecté.
        let event = Arc::new(BroadcastEvent {
            event_type: "new_client".to_string(),
            data: serde_json::json!({
                "consumer": consumer,
                "topic": topic,
                "connected_at": connected_at,
            }),
        });

        let _ = self.event_tx.send(event);
    }

    // Gère la déconnexion d'un client.
    pub async fn unregister_client(&self, sid: &str) {
        // Récupère les informations du client avant de le supprimer.
        let client_info = self.get_client_by_sid(sid).await;

        // Envoie la commande de suppression au worker DB.
        let _ = self.db_tx.send(DbCommand::UnregisterClient {
            sid: sid.to_string(),
        });

        {
            // Supprime le client du cache en mémoire.
            let mut subs = self.subscriptions.write().await;
            subs.remove(sid);
        }

        // Si le client existait, diffuse des événements de déconnexion pour chaque sujet auquel il était abonné.
        if let Some((consumer, topics, _)) = client_info {
            for topic in topics {
                let event = Arc::new(BroadcastEvent {
                    event_type: "client_disconnected".to_string(),
                    data: serde_json::json!({
                        "consumer": consumer.clone(),
                        "topic": topic,
                    }),
                });
                let _ = self.event_tx.send(event);
            }
        }
    }

    // Sauvegarde un message et diffuse un événement.
    pub async fn save_message(
        &self,
        topic: String,
        message_id: String,
        message: serde_json::Value,
        producer: String,
    ) {
        let timestamp = current_timestamp();
        // Sérialise le message en JSON.
        let message_json = message.to_string();

        // Envoie la commande de sauvegarde au worker DB.
        let _ = self.db_tx.send(DbCommand::SaveMessage {
            topic: topic.clone(),
            message_id: message_id.clone(),
            message: message_json,
            producer: producer.clone(),
            timestamp,
        });

        // Diffuse l'événement de nouveau message.
        let event = Arc::new(BroadcastEvent {
            event_type: "new_message".to_string(),
            data: serde_json::json!({
                "topic": topic,
                "message_id": message_id,
                "message": message,
                "producer": producer,
                "timestamp": timestamp,
            }),
        });

        let _ = self.event_tx.send(event);
    }

    // Sauvegarde une consommation de message et diffuse un événement.
    pub async fn save_consumption(
        &self,
        consumer: String,
        topic: String,
        message_id: String,
        message: serde_json::Value,
    ) {
        let timestamp = current_timestamp();
        let message_json = message.to_string();

        // Envoie la commande de sauvegarde au worker DB.
        let _ = self.db_tx.send(DbCommand::SaveConsumption {
            consumer: consumer.clone(),
            topic: topic.clone(),
            message_id: message_id.clone(),
            message: message_json,
            timestamp,
        });

        // Diffuse l'événement de nouvelle consommation.
        let event = Arc::new(BroadcastEvent {
            event_type: "new_consumption".to_string(),
            data: serde_json::json!({
                "consumer": consumer,
                "topic": topic,
                "message_id": message_id,
                "message": message,
                "timestamp": timestamp,
            }),
        });

        let _ = self.event_tx.send(event);
    }

    // Récupère les informations d'un client par son SID depuis le cache en mémoire.
    // C'est une lecture, donc elle est rapide grâce au `RwLock`.
    pub async fn get_client_by_sid(&self, sid: &str) -> Option<(String, Vec<String>, f64)> {
        let subs = self.subscriptions.read().await;
        // `cloned()` pour retourner une copie des données et libérer le verrou rapidement.
        subs.get(sid).cloned()
    }

    // Récupère la liste de tous les clients connectés depuis le cache.
    pub async fn get_clients(&self) -> Vec<ClientInfo> {
        let subs = self.subscriptions.read().await;
        // Pré-allocation pour la performance.
        let mut clients = Vec::with_capacity(subs.len());

        for (_, (consumer, topics, connected_at)) in subs.iter() {
            for topic in topics {
                clients.push(ClientInfo {
                    consumer: consumer.clone(),
                    topic: topic.clone(),
                    connected_at: *connected_at,
                });
            }
        }

        clients
    }

    // Récupère les 100 derniers messages depuis la base de données.
    // C'est une opération de lecture directe sur la DB.
    pub async fn get_messages(&self) -> Vec<MessageInfo> {
        let result = sqlx::query_as::<_, (String, String, String, String, f64)>(
            "SELECT topic, message_id, message, producer, timestamp FROM messages ORDER BY timestamp DESC LIMIT 100"
        )
            .fetch_all(&self.db)
            .await;

        match result {
            Ok(rows) => rows
                .into_iter()
                // `filter_map` est utilisé pour traiter les lignes et ignorer celles qui ont un JSON invalide.
                .filter_map(|(topic, message_id, message_str, producer, timestamp)| {
                    let message = serde_json::from_str(&message_str).unwrap_or_else(
                        |_| serde_json::json!({"error": "Invalid JSON", "raw": message_str}),
                    );

                    Some(MessageInfo {
                        topic,
                        message_id,
                        message,
                        producer,
                        timestamp,
                    })
                })
                .collect(),
            Err(e) => {
                // Retourne un vecteur vide en cas d'erreur.
                error!("Erreur lors de la récupération des messages: {}", e);
                Vec::with_capacity(0)
            }
        }
    }

    // Récupère les 100 dernières consommations depuis la base de données.
    pub async fn get_consumptions(&self) -> Vec<ConsumptionInfo> {
        let result = sqlx::query_as::<_, (String, String, String, String, f64)>(
            "SELECT consumer, topic, message_id, message, timestamp FROM consumptions ORDER BY timestamp DESC LIMIT 100"
        )
            .fetch_all(&self.db)
            .await;

        match result {
            Ok(rows) => rows
                .into_iter()
                .filter_map(|(consumer, topic, message_id, message_str, timestamp)| {
                    let message = serde_json::from_str(&message_str).unwrap_or_else(
                        |_| serde_json::json!({"error": "Invalid JSON", "raw": message_str}),
                    );

                    Some(ConsumptionInfo {
                        consumer,
                        topic,
                        message_id,
                        message,
                        timestamp,
                    })
                })
                .collect(),
            Err(e) => {
                error!("Erreur lors de la récupération des consommations: {}", e);
                Vec::with_capacity(0)
            }
        }
    }

    // Construit l'état du graphe pour le dashboard en agrégeant les données de la DB.
    pub async fn get_graph_state(&self) -> GraphState {
        // `tokio::join!` exécute toutes ces requêtes en parallèle pour de meilleures performances.
        let (producers_res, consumers_res, topics_res, subscriptions_res, publications_res) = tokio::join!(
            sqlx::query_as::<_, (String,)>("SELECT DISTINCT producer FROM messages").fetch_all(&self.db),
            sqlx::query_as::<_, (String,)>("SELECT DISTINCT consumer FROM subscriptions UNION SELECT DISTINCT consumer FROM consumptions").fetch_all(&self.db),
            sqlx::query_as::<_, (String,)>("SELECT DISTINCT topic FROM messages UNION SELECT DISTINCT topic FROM subscriptions").fetch_all(&self.db),
            sqlx::query_as::<_, (String, String)>("SELECT topic, consumer FROM subscriptions").fetch_all(&self.db),
            sqlx::query_as::<_, (String, String)>("SELECT DISTINCT producer, topic FROM messages").fetch_all(&self.db)
        );

        // Traite les résultats des requêtes pour construire les listes de nœuds.
        let producers = producers_res
            .unwrap_or_default()
            .into_iter()
            .map(|(p,)| p)
            .collect();
        let consumers = consumers_res
            .unwrap_or_default()
            .into_iter()
            .map(|(c,)| c)
            .collect();
        let topics = topics_res
            .unwrap_or_default()
            .into_iter()
            .map(|(t,)| t)
            .collect();

        let mut links = Vec::with_capacity(200);

        // Construit les liens de consommation.
        if let Ok(subs) = subscriptions_res {
            for (topic, consumer) in subs {
                links.push(Link {
                    source: topic,
                    target: consumer,
                    link_type: "consume".to_string(),
                });
            }
        }

        // Construit les liens de publication.
        if let Ok(pubs) = publications_res {
            for (producer, topic) in pubs {
                links.push(Link {
                    source: producer,
                    target: topic,
                    link_type: "publish".to_string(),
                });
            }
        }

        GraphState {
            producers,
            consumers,
            topics,
            links,
        }
    }

    // Getter pour le pool de connexions DB.
    pub fn db(&self) -> &SqlitePool {
        &self.db
    }
}

// Fonction utilitaire pour obtenir le timestamp actuel en secondes (f64).
fn current_timestamp() -> f64 {
    SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64()
}
