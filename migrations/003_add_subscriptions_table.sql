-- Migration 003: Add subscriptions table for persistent subscription tracking
CREATE TABLE IF NOT EXISTS subscriptions (
    sid TEXT NOT NULL,
    consumer TEXT NOT NULL,
    topic TEXT NOT NULL,
    connected_at REAL NOT NULL,
    PRIMARY KEY (sid, topic)
);

-- Index pour améliorer les performances des requêtes
CREATE INDEX IF NOT EXISTS idx_subscriptions_consumer ON subscriptions(consumer);
CREATE INDEX IF NOT EXISTS idx_subscriptions_topic ON subscriptions(topic);
