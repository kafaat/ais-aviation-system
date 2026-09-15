ALTER TABLE `outbox` ADD `traceId` varchar(32);--> statement-breakpoint
ALTER TABLE `outbox` ADD `spanId` varchar(16);--> statement-breakpoint
ALTER TABLE `event_inbox` ADD `traceId` varchar(32);--> statement-breakpoint
ALTER TABLE `event_inbox` ADD `spanId` varchar(16);