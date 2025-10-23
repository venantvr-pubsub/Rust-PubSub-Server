use sqlx::sqlite::SqlitePool;
use tracing::info;

struct Migration {
    version: i32,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "add_message_id_and_producer",
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

pub async fn init_database(db_file: &str) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    let pool = SqlitePool::connect(&format!("sqlite:{}?mode=rwc", db_file)).await?;

    // Configuration SQLite optimisée pour les performances
    sqlx::query("PRAGMA journal_mode = WAL")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA synchronous = NORMAL")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA cache_size = -128000")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA temp_store = MEMORY")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA mmap_size = 536870912")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA page_size = 8192")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA auto_vacuum = INCREMENTAL")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA busy_timeout = 5000")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA wal_autocheckpoint = 1000")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(&pool)
        .await
        .ok();

    // Create schema_migrations table if it doesn't exist
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at REAL NOT NULL
        )",
    )
    .execute(&pool)
    .await?;

    // Run all pending migrations
    for migration in MIGRATIONS {
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

            // Execute migration in a transaction
            let mut tx = pool.begin().await?;
            sqlx::raw_sql(migration.sql).execute(&mut *tx).await?;

            // Record migration
            sqlx::query(
                "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
            )
            .bind(migration.version)
            .bind(migration.name)
            .bind(current_timestamp())
            .execute(&mut *tx)
            .await?;

            tx.commit().await?;

            info!("Migration {} applied successfully", migration.version);
        } else {
            info!("Migration {} already applied, skipping", migration.version);
        }
    }

    // Run ANALYZE for query optimization
    sqlx::query("ANALYZE").execute(&pool).await?;

    info!("Database initialization complete");

    Ok(pool)
}

fn current_timestamp() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64()
}
