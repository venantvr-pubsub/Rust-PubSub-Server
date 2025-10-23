use crate::models::{BroadcastEvent, ClientInfo, ConsumptionInfo, GraphState, Link, MessageInfo};
use sqlx::sqlite::SqlitePool;
use std::{collections::HashMap, sync::Arc, time::SystemTime};
use tokio::sync::{broadcast, mpsc, RwLock};
use tracing::{error, warn};

pub enum DbCommand {
    RegisterSubscription {
        sid: String,
        consumer: String,
        topic: String,
        connected_at: f64,
    },
    SaveMessage {
        topic: String,
        message_id: String,
        message: String,
        producer: String,
        timestamp: f64,
    },
    SaveConsumption {
        consumer: String,
        topic: String,
        message_id: String,
        message: String,
        timestamp: f64,
    },
    UnregisterClient {
        sid: String,
    },
}

// Configuration for automatic data purging
const MAX_MESSAGES: i64 = 10_000;
const MAX_CONSUMPTIONS: i64 = 10_000;
const MAX_AGE_HOURS: f64 = 24.0; // 24 hours
const PURGE_INTERVAL_MINUTES: u64 = 30; // Run purge every 30 minutes

pub struct Broker {
    db: SqlitePool,
    pub event_tx: broadcast::Sender<Arc<BroadcastEvent>>,
    subscriptions: Arc<RwLock<HashMap<String, (String, Vec<String>, f64)>>>, // sid -> (consumer, topics, connected_at)
    db_tx: mpsc::UnboundedSender<DbCommand>,
}

impl Broker {
    pub fn new(db: SqlitePool, event_tx: broadcast::Sender<Arc<BroadcastEvent>>) -> Self {
        let (db_tx, mut db_rx) = mpsc::unbounded_channel::<DbCommand>();
        let db_clone = db.clone();

        // Worker dédié pour les écritures DB en batch
        tokio::spawn(async move {
            let mut batch = Vec::with_capacity(500);
            let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(20));

            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        if !batch.is_empty() {
                            Self::flush_batch(&db_clone, &mut batch).await;
                        }
                    }
                    Some(cmd) = db_rx.recv() => {
                        batch.push(cmd);
                        if batch.len() >= 500 {
                            Self::flush_batch(&db_clone, &mut batch).await;
                        }
                    }
                    else => break,
                }
            }
        });

        // Worker dédié pour la purge automatique des données
        let purge_db = db.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
                PURGE_INTERVAL_MINUTES * 60,
            ));

            // Wait for first interval before running
            interval.tick().await;

            loop {
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

    async fn flush_batch(db: &SqlitePool, batch: &mut Vec<DbCommand>) {
        if batch.is_empty() {
            return;
        }

        let mut tx = match db.begin().await {
            Ok(tx) => tx,
            Err(e) => {
                error!("Impossible de démarrer une transaction: {}", e);
                batch.clear();
                return;
            }
        };

        let mut has_error = false;

        for cmd in batch.drain(..) {
            let result = match cmd {
                DbCommand::RegisterSubscription {
                    sid,
                    consumer,
                    topic,
                    connected_at,
                } => {
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
                error!("Erreur lors de l'exécution d'une commande DB: {}", e);
                has_error = true;
                break;
            }
        }

        // Atomicité garantie : COMMIT seulement si tout a réussi
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

    async fn purge_old_data(db: &SqlitePool) {
        use tracing::info;

        let start = std::time::Instant::now();
        let cutoff_timestamp = current_timestamp() - (MAX_AGE_HOURS * 3600.0);

        // Start a transaction for all purge operations
        let mut tx = match db.begin().await {
            Ok(tx) => tx,
            Err(e) => {
                error!("Impossible de démarrer une transaction de purge: {}", e);
                return;
            }
        };

        let mut total_deleted = 0i64;

        // Purge messages: keep only MAX_MESSAGES most recent AND remove anything older than MAX_AGE_HOURS
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
                error!("Erreur lors de la purge des messages: {}", e);
                let _ = tx.rollback().await;
                return;
            }
        }

        // Purge consumptions: keep only MAX_CONSUMPTIONS most recent AND remove anything older than MAX_AGE_HOURS
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

    pub async fn register_subscription(&self, sid: String, consumer: String, topic: String) {
        if sid.is_empty() || consumer.is_empty() || topic.is_empty() {
            warn!("register_subscription: Paramètres requis manquants");
            return;
        }

        let connected_at = current_timestamp();

        let _ = self.db_tx.send(DbCommand::RegisterSubscription {
            sid: sid.clone(),
            consumer: consumer.clone(),
            topic: topic.clone(),
            connected_at,
        });

        {
            let mut subs = self.subscriptions.write().await;
            subs.entry(sid.clone())
                .and_modify(|(_, topics, _)| {
                    if !topics.contains(&topic) {
                        topics.push(topic.clone());
                    }
                })
                .or_insert((consumer.clone(), vec![topic.clone()], connected_at));
        }

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

    pub async fn unregister_client(&self, sid: &str) {
        let client_info = self.get_client_by_sid(sid).await;

        let _ = self.db_tx.send(DbCommand::UnregisterClient {
            sid: sid.to_string(),
        });

        {
            let mut subs = self.subscriptions.write().await;
            subs.remove(sid);
        }

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

    pub async fn save_message(
        &self,
        topic: String,
        message_id: String,
        message: serde_json::Value,
        producer: String,
    ) {
        let timestamp = current_timestamp();
        let message_json = message.to_string();

        let _ = self.db_tx.send(DbCommand::SaveMessage {
            topic: topic.clone(),
            message_id: message_id.clone(),
            message: message_json,
            producer: producer.clone(),
            timestamp,
        });

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

    pub async fn save_consumption(
        &self,
        consumer: String,
        topic: String,
        message_id: String,
        message: serde_json::Value,
    ) {
        let timestamp = current_timestamp();
        let message_json = message.to_string();

        let _ = self.db_tx.send(DbCommand::SaveConsumption {
            consumer: consumer.clone(),
            topic: topic.clone(),
            message_id: message_id.clone(),
            message: message_json,
            timestamp,
        });

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

    pub async fn get_client_by_sid(&self, sid: &str) -> Option<(String, Vec<String>, f64)> {
        let subs = self.subscriptions.read().await;
        subs.get(sid).cloned()
    }

    pub async fn get_clients(&self) -> Vec<ClientInfo> {
        let subs = self.subscriptions.read().await;
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

    pub async fn get_messages(&self) -> Vec<MessageInfo> {
        let result = sqlx::query_as::<_, (String, String, String, String, f64)>(
            "SELECT topic, message_id, message, producer, timestamp FROM messages ORDER BY timestamp DESC LIMIT 100"
        )
            .fetch_all(&self.db)
            .await;

        match result {
            Ok(rows) => rows
                .into_iter()
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
                error!("Erreur lors de la récupération des messages: {}", e);
                Vec::with_capacity(0)
            }
        }
    }

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

    pub async fn get_graph_state(&self) -> GraphState {
        let (producers_res, consumers_res, topics_res, subscriptions_res, publications_res) = tokio::join!(
            sqlx::query_as::<_, (String,)>("SELECT DISTINCT producer FROM messages").fetch_all(&self.db),
            sqlx::query_as::<_, (String,)>("SELECT DISTINCT consumer FROM subscriptions UNION SELECT DISTINCT consumer FROM consumptions").fetch_all(&self.db),
            sqlx::query_as::<_, (String,)>("SELECT DISTINCT topic FROM messages UNION SELECT DISTINCT topic FROM subscriptions").fetch_all(&self.db),
            sqlx::query_as::<_, (String, String)>("SELECT topic, consumer FROM subscriptions").fetch_all(&self.db),
            sqlx::query_as::<_, (String, String)>("SELECT DISTINCT producer, topic FROM messages").fetch_all(&self.db)
        );

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

        if let Ok(subs) = subscriptions_res {
            for (topic, consumer) in subs {
                links.push(Link {
                    source: topic,
                    target: consumer,
                    link_type: "consume".to_string(),
                });
            }
        }

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

    pub fn db(&self) -> &SqlitePool {
        &self.db
    }
}

fn current_timestamp() -> f64 {
    SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64()
}
