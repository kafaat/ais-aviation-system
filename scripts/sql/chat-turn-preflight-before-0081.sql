-- Read-only chat rollout preflight. Works before migration 0081.
-- Run after stopping/draining all chat writers. Counts cover all matching rows;
-- samples contain at most 50 identifiers and never transcript contents.
-- A query error/timeout is blocked evidence, not a zero count. No repairs.
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION READ ONLY;

SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_message_count_mismatch' AS finding, COUNT(*) AS total
FROM (SELECT c.id FROM chat_conversations c LEFT JOIN chat_messages m ON m.conversationId = c.id GROUP BY c.id, c.messageCount HAVING c.messageCount <> COUNT(m.id)) findings;
SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_message_count_mismatch' AS finding, c.id AS recordId
FROM chat_conversations c LEFT JOIN chat_messages m ON m.conversationId = c.id GROUP BY c.id, c.messageCount HAVING c.messageCount <> COUNT(m.id) ORDER BY c.id LIMIT 50;

SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_message_limit_invalid' AS finding, COUNT(*) AS total
FROM (SELECT c.id FROM chat_conversations c LEFT JOIN chat_messages m ON m.conversationId = c.id GROUP BY c.id, c.messageCount HAVING c.messageCount < 0 OR c.messageCount > 100 OR COUNT(m.id) > 100) findings;
SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_message_limit_invalid' AS finding, c.id AS recordId
FROM chat_conversations c LEFT JOIN chat_messages m ON m.conversationId = c.id GROUP BY c.id, c.messageCount HAVING c.messageCount < 0 OR c.messageCount > 100 OR COUNT(m.id) > 100 ORDER BY c.id LIMIT 50;

SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_conversation_owner_missing' AS finding, COUNT(*) AS total
FROM chat_conversations c LEFT JOIN users u ON u.id = c.userId WHERE u.id IS NULL;
SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_conversation_owner_missing' AS finding, c.id AS recordId
FROM chat_conversations c LEFT JOIN users u ON u.id = c.userId WHERE u.id IS NULL ORDER BY c.id LIMIT 50;

SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_message_conversation_missing' AS finding, COUNT(*) AS total
FROM chat_messages m LEFT JOIN chat_conversations c ON c.id = m.conversationId WHERE c.id IS NULL;
SELECT /*+ MAX_EXECUTION_TIME(5000) */ 'chat_message_conversation_missing' AS finding, m.id AS recordId
FROM chat_messages m LEFT JOIN chat_conversations c ON c.id = m.conversationId WHERE c.id IS NULL ORDER BY m.id LIMIT 50;

ROLLBACK;
