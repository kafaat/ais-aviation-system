ALTER TABLE `outbox` ADD `schemaVersion` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `event_inbox` ADD `schemaVersion` int DEFAULT 1 NOT NULL;