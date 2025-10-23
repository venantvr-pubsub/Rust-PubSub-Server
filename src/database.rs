// Importe le pool de connexions SQLite de SQLx et le logger `info` de `tracing`.
use sqlx::sqlite::SqlitePool;
use tracing::info;

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
];

// Fonction asynchrone pour initialiser la base de données.
// Retourne un `Result` avec le pool de connexions ou une erreur.
pub async fn init_database(db_file: &str) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    // Se connecte à la base de données SQLite. `?mode=rwc` signifie "read-write-create" : ouvre en lecture/écriture, et crée le fichier s'il n'existe pas.
    let pool = SqlitePool::connect(&format!("sqlite:{}?mode=rwc", db_file)).await?;

    // --- Configuration SQLite optimisée pour les performances en écriture et lecture --- 
    // `PRAGMA` sont des commandes spécifiques à SQLite pour modifier son comportement.

    // `journal_mode = WAL` (Write-Ahead Logging) : Améliore la concurrence en permettant aux lecteurs de ne pas être bloqués par les écritures.
    sqlx::query("PRAGMA journal_mode = WAL")
        .execute(&pool)
        .await?;
    // `synchronous = NORMAL` : Moins de `fsync` sur le disque, plus rapide mais avec un risque minime de corruption en cas de crash système.
    sqlx::query("PRAGMA synchronous = NORMAL")
        .execute(&pool)
        .await?;
    // `cache_size = -128000` : Alloue 128MB de RAM pour le cache de pages, réduisant les I/O disque.
    sqlx::query("PRAGMA cache_size = -128000")
        .execute(&pool)
        .await?;
    // `temp_store = MEMORY` : Utilise la RAM pour les tables temporaires.
    sqlx::query("PRAGMA temp_store = MEMORY")
        .execute(&pool)
        .await?;
    // `mmap_size` : Utilise le mapping mémoire pour accéder aux données, peut être plus rapide.
    sqlx::query("PRAGMA mmap_size = 536870912")
        .execute(&pool)
        .await?;
    // `page_size` : Augmente la taille des pages pour de meilleures performances sur les SSD.
    sqlx::query("PRAGMA page_size = 8192")
        .execute(&pool)
        .await?;
    // `auto_vacuum = INCREMENTAL` : Permet de récupérer l'espace non utilisé.
    sqlx::query("PRAGMA auto_vacuum = INCREMENTAL")
        .execute(&pool)
        .await?;
    // `busy_timeout` : Attend 5s si la base est verrouillée avant de retourner une erreur.
    sqlx::query("PRAGMA busy_timeout = 5000")
        .execute(&pool)
        .await?;
    // `wal_autocheckpoint` : Déclenche un checkpoint du WAL automatiquement.
    sqlx::query("PRAGMA wal_autocheckpoint = 1000")
        .execute(&pool)
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
