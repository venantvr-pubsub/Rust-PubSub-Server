-- Migration 004: index the plain timestamp columns.
--
-- Migration 002 added composite indexes prefixed by topic/consumer, but the two hottest queries in
-- the application do not filter at all:
--
--   SELECT ... FROM messages     ORDER BY timestamp DESC LIMIT 100   (dashboard refresh)
--   SELECT ... FROM consumptions ORDER BY timestamp DESC LIMIT 100   (dashboard refresh)
--
-- plus the retention job's "keep the N most recent" subquery. A composite index on
-- (topic, timestamp) cannot serve an unfiltered ORDER BY timestamp, so each of those ran a full
-- table scan followed by a sort - on every single dashboard event.

CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_consumptions_timestamp ON consumptions (timestamp DESC);
