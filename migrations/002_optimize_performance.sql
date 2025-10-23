-- Migration 002: Performance optimization
-- Remove synchronous cleanup triggers and add performance settings

-- Drop the synchronous cleanup triggers (replaced by background cleanup thread)
DROP TRIGGER IF EXISTS trim_messages;
DROP TRIGGER IF EXISTS trim_consumptions;
DROP TRIGGER IF EXISTS trim_subscriptions;

-- Add composite indexes for common query patterns
-- Index for filtering messages by topic and sorting by timestamp
CREATE INDEX IF NOT EXISTS idx_messages_topic_timestamp ON messages (topic, timestamp DESC);

-- Index for filtering consumptions by consumer and sorting by timestamp
CREATE INDEX IF NOT EXISTS idx_consumptions_consumer_timestamp ON consumptions (consumer, timestamp DESC);

-- Index for filtering consumptions by topic and sorting by timestamp
CREATE INDEX IF NOT EXISTS idx_consumptions_topic_timestamp ON consumptions (topic, timestamp DESC);

-- Index for graph queries (producer-topic relationships)
CREATE INDEX IF NOT EXISTS idx_messages_producer_topic ON messages (producer, topic);

-- Index for subscription lookups by consumer
CREATE INDEX IF NOT EXISTS idx_subscriptions_consumer_topic ON subscriptions (consumer, topic);

-- Performance PRAGMAs will be set at runtime via the application code
