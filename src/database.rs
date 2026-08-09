// Importe le pool de connexions SQLite de SQLx et le logger `info` de `tracing`.
use sqlx::sqlite::{
    SqliteAutoVacuum, SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions,
    SqliteSynchronous,
};
use std::str::FromStr;
use std::time::Duration;
use tracing::info;

// Nombre maximum de connexions dans le pool.
// Auparavant, `main.rs` exécutait `PRAGMA max_connections = 10` : ce PRAGMA n'existe pas dans
// SQLite, la commande était silencieusement ignorée et le pool gardait la taille par défaut.
// La taille d'un pool est une propriété du pool, pas de la base.
const MAX_CONNECTIONS: u32 = 10;

// Définit une structure pour représenter une migration de base de données.
struct Migration {
    // Le numéro de version de la migration, utilisé pour l'ordre d'application.
    version: i32,
    // Un nom descriptif pour la migration.
    name: &'static str,
    // Le contenu SQL de la migration. `&'static str` signifie que le texte est intégré dans le binaire du programme.
    sql: &'static str,
}

// Un tableau statique contenant toutes les migrations à appliquer.
// L'ordre est important.
const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "add_message_id_and_producer",
        // `include_str!` est une macro qui inclut le contenu d'un fichier texte directement dans le binaire au moment de la compilation.
        sql: include_str!("../migrations/001_add_message_id_and_producer.sql"),
    },
    Migration {
        version: 2,
        name: "optimize_performance",
        sql: include_str!("../migrations/002_optimize_performance.sql"),
    },
    Migration {
        version: 3,
        name: "add_subscriptions_table",
        sql: include_str!("../migrations/003_add_subscriptions_table.sql"),
    },
    Migration {
        version: 4,
        name: "timestamp_indexes",
        sql: include_str!("../migrations/004_timestamp_indexes.sql"),
    },
];

// Fonction asynchrone pour initialiser la base de données.
// Retourne un `Result` avec le pool de connexions ou une erreur.
pub async fn init_database(db_file: &str) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    // Une base `:memory:` est privée à *chaque connexion*. Avec un pool multi-connexions, les
    // migrations s'appliquaient donc sur une base et les requêtes suivantes pouvaient tomber sur
    // une autre connexion, avec une base entièrement vide ("no such table: messages").
    // On passe par une base mémoire *nommée* en cache partagé pour que toutes les connexions du
    // pool voient bien la même base.
    let in_memory = db_file.is_empty() || db_file == ":memory:";

    let url = if in_memory {
        "sqlite:file:pubsub_shared_mem?mode=memory&cache=shared".to_string()
    } else {
        // `mode=rwc` = "read-write-create" : ouvre en lecture/écriture et crée le fichier si besoin.
        format!("sqlite:{}?mode=rwc", db_file)
    };

    // --- Configuration SQLite optimisée pour les performances en écriture et lecture ---
    //
    // Les PRAGMA étaient auparavant exécutés une seule fois via `execute(&pool)`, ce qui les
    // appliquait à *une* connexion prise au hasard dans le pool. Or `synchronous`, `cache_size`,
    // `temp_store`, `mmap_size` et `busy_timeout` sont des réglages **par connexion** : les neuf
    // autres connexions gardaient les valeurs par défaut (dont un `busy_timeout` à 0, d'où des
    // erreurs `database is locked` sous charge au lieu d'une attente).
    // En les déclarant ici, SQLx les rejoue sur chaque nouvelle connexion du pool.
    let mut options = SqliteConnectOptions::from_str(&url)?
        // WAL : les lecteurs ne sont plus bloqués par les écritures.
        // (Ignoré pour une base en mémoire, qui ne peut pas utiliser le WAL.)
        .journal_mode(if in_memory {
            SqliteJournalMode::Memory
        } else {
            SqliteJournalMode::Wal
        })
        // NORMAL : moins de `fsync`, plus rapide, risque minime en cas de crash système.
        .synchronous(SqliteSynchronous::Normal)
        // Attend 5s si la base est verrouillée avant de retourner une erreur.
        .busy_timeout(Duration::from_secs(5))
        // 128 Mo de cache de pages (valeur négative = kibioctets).
        .pragma("cache_size", "-128000")
        // Tables temporaires en RAM.
        .pragma("temp_store", "MEMORY");

    if !in_memory {
        options = options
            // Mapping mémoire de 512 Mo pour les lectures.
            .pragma("mmap_size", "536870912")
            // Pages plus grandes : moins d'I/O sur SSD.
            .page_size(8192)
            // Récupère l'espace libéré par les purges.
            .auto_vacuum(SqliteAutoVacuum::Incremental)
            .pragma("wal_autocheckpoint", "1000");
    }

    let pool = SqlitePoolOptions::new()
        .max_connections(MAX_CONNECTIONS)
        // Pour une base en mémoire, garder au moins une connexion ouverte en permanence :
        // SQLite détruit la base dès que la dernière connexion se referme.
        .min_connections(if in_memory { 1 } else { 0 })
        .connect_with(options)
        .await?;

    // Force un checkpoint au démarrage pour nettoyer le fichier WAL.
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(&pool)
        .await
        .ok();

    // Crée la table pour suivre les migrations déjà appliquées, si elle n'existe pas.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at REAL NOT NULL
        )",
    )
    .execute(&pool)
    .await?;

    // Boucle sur toutes les migrations définies.
    for migration in MIGRATIONS {
        // Vérifie si la migration a déjà été appliquée en consultant la table `schema_migrations`.
        let applied =
            sqlx::query_as::<_, (i32,)>("SELECT version FROM schema_migrations WHERE version = ?")
                .bind(migration.version)
                .fetch_optional(&pool)
                .await?
                .is_some();

        if !applied {
            info!(
                "Running migration {}: {}",
                migration.version, migration.name
            );

            // Exécute la migration à l'intérieur d'une transaction.
            // C'est une pratique de sécurité : si une partie de la migration échoue, toute la transaction est annulée (rollback).
            let mut tx = pool.begin().await?;
            sqlx::raw_sql(migration.sql).execute(&mut *tx).await?;

            // Enregistre la migration comme étant appliquée dans la table `schema_migrations`.
            sqlx::query(
                "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
            )
            .bind(migration.version)
            .bind(migration.name)
            .bind(current_timestamp())
            .execute(&mut *tx)
            .await?;

            // Valide la transaction.
            tx.commit().await?;

            info!("Migration {} applied successfully", migration.version);
        } else {
            info!("Migration {} already applied, skipping", migration.version);
        }
    }

    // Purge les abonnements laissés par le processus précédent.
    // La table `subscriptions` reflète les clients *actuellement* connectés : les lignes sont
    // supprimées à la déconnexion. Si le serveur s'arrête brutalement, personne ne les supprime, et
    // au redémarrage `/graph/state` continue d'annoncer des consommateurs disparus depuis
    // longtemps. Les sockets ne survivent pas au redémarrage, donc toute ligne présente ici au
    // démarrage est par définition périmée.
    let orphaned = sqlx::query("DELETE FROM subscriptions")
        .execute(&pool)
        .await?
        .rows_affected();
    if orphaned > 0 {
        info!(
            "Suppression de {} abonnement(s) orphelin(s) du démarrage précédent",
            orphaned
        );
    }

    // `ANALYZE` collecte des statistiques sur les tables et les index.
    // L'optimiseur de requêtes de SQLite utilise ces statistiques pour choisir les meilleurs plans d'exécution.
    sqlx::query("ANALYZE").execute(&pool).await?;

    info!("Database initialization complete");

    // Retourne le pool de connexions si tout s'est bien passé.
    Ok(pool)
}

// Fonction utilitaire pour obtenir le timestamp actuel en secondes (f64).
fn current_timestamp() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64()
}
