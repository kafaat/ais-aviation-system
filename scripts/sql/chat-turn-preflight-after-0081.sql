-- Additional read-only checks after migration 0081; also run the before script.
-- pending_count must be zero before resuming an old writer, even when the
-- pending association is structurally valid. Expiry alone does not clear it.
-- A query error/timeout is blocked evidence, not a zero count. No repairs.
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION READ ONLY;
SET @ais_chat_preflight_time = CURRENT_TIMESTAMP(3);

SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_pending_shape_invalid' AS finding, COUNT(*) AS total
FROM chat_conversations WHERE (pendingMessageId IS NULL) <> (pendingUntil IS NULL) OR pendingMessageId <= 0;
SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_pending_shape_invalid' AS finding, id AS recordId
FROM chat_conversations WHERE (pendingMessageId IS NULL) <> (pendingUntil IS NULL) OR pendingMessageId <= 0 ORDER BY id LIMIT 50;

SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_pending_reference_invalid' AS finding, COUNT(*) AS total
FROM chat_conversations c LEFT JOIN chat_messages m ON m.id = c.pendingMessageId WHERE c.pendingMessageId IS NOT NULL AND (m.id IS NULL OR m.conversationId <> c.id OR m.role <> 'user' OR c.status <> 'active');
SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_pending_reference_invalid' AS finding, c.id AS recordId
FROM chat_conversations c LEFT JOIN chat_messages m ON m.id = c.pendingMessageId WHERE c.pendingMessageId IS NOT NULL AND (m.id IS NULL OR m.conversationId <> c.id OR m.role <> 'user' OR c.status <> 'active') ORDER BY c.id LIMIT 50;

SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_pending_capacity_invalid' AS finding, COUNT(*) AS total
FROM chat_conversations WHERE pendingMessageId IS NOT NULL AND (messageCount < 1 OR messageCount >= 100);
SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_pending_capacity_invalid' AS finding, id AS recordId
FROM chat_conversations WHERE pendingMessageId IS NOT NULL AND (messageCount < 1 OR messageCount >= 100) ORDER BY id LIMIT 50;

SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_pending_not_tail' AS finding, COUNT(*) AS total
FROM chat_conversations c WHERE c.pendingMessageId IS NOT NULL AND NOT (c.pendingMessageId <=> (SELECT MAX(m.id) FROM chat_messages m WHERE m.conversationId = c.id));
SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_pending_not_tail' AS finding, c.id AS recordId
FROM chat_conversations c WHERE c.pendingMessageId IS NOT NULL AND NOT (c.pendingMessageId <=> (SELECT MAX(m.id) FROM chat_messages m WHERE m.conversationId = c.id)) ORDER BY c.id LIMIT 50;

SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_pending_expired' AS finding, COUNT(*) AS total
FROM chat_conversations WHERE pendingMessageId IS NOT NULL AND pendingUntil <= @ais_chat_preflight_time;
SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_pending_expired' AS finding, id AS recordId
FROM chat_conversations WHERE pendingMessageId IS NOT NULL AND pendingUntil <= @ais_chat_preflight_time ORDER BY id LIMIT 50;

SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_pending_count' AS finding, COUNT(*) AS total
FROM chat_conversations WHERE pendingMessageId IS NOT NULL OR pendingUntil IS NOT NULL;
SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_pending_count' AS finding, id AS recordId
FROM chat_conversations WHERE pendingMessageId IS NOT NULL OR pendingUntil IS NOT NULL ORDER BY id LIMIT 50;

ROLLBACK;
