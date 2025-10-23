-- Create new messages table with new columns
DROP TABLE IF EXISTS messages;

CREATE TABLE messages
(
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    topic      TEXT,
    message_id TEXT,
    message    TEXT,
    producer   TEXT,
    timestamp  REAL
);

-- Create new consumptions table with message_id
DROP TABLE IF EXISTS consumptions;

CREATE TABLE consumptions
(
    consumer   TEXT,
    topic      TEXT,
    message_id TEXT,
    message    TEXT,
    timestamp  REAL
);

-- Subscriptions table remains unchanged
CREATE TABLE IF NOT EXISTS subscriptions (
    sid             TEXT,
    consumer        TEXT,
    topic           TEXT,
    connected_at    REAL,
    PRIMARY KEY (sid, topic)
 );

-- Adding basic indexes (composite indexes added in migration 002)
-- Keep only indexes that won't be replaced by composite ones
CREATE INDEX idx_messages_message_id ON messages (message_id);

-- Trigger pour la table 'messages'
CREATE TRIGGER IF NOT EXISTS trim_messages
AFTER INSERT ON messages
BEGIN
DELETE
FROM messages
WHERE rowid NOT IN (SELECT rowid
                    FROM messages
                    ORDER BY timestamp DESC
    LIMIT 1000
    );
END;

-- Trigger pour la table 'consumptions'
CREATE TRIGGER IF NOT EXISTS trim_consumptions
AFTER INSERT ON consumptions
BEGIN
DELETE
FROM consumptions
WHERE rowid NOT IN (SELECT rowid
                    FROM consumptions
                    ORDER BY timestamp DESC
    LIMIT 1000
    );
END;

-- On peut aussi le faire pour les abonnements, si besoin
CREATE TRIGGER IF NOT EXISTS trim_subscriptions
AFTER INSERT ON subscriptions
BEGIN
DELETE
FROM subscriptions
WHERE rowid NOT IN (SELECT rowid
                    FROM subscriptions
                    ORDER BY connected_at DESC
    LIMIT 1000
    );
END;