CREATE TABLE `irops_recovery_plans` (
	`id` varchar(36) NOT NULL,
	`eventId` int NOT NULL,
	`tenantId` int,
	`payload` json NOT NULL,
	`digest` varchar(64) NOT NULL,
	`status` enum('proposed','approved','executed') NOT NULL DEFAULT 'proposed',
	`approvedBy` int,
	`expiresAt` timestamp NOT NULL,
	`executionEventId` varchar(36),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `irops_recovery_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `crew_assignments` ADD `dutyStartTime` timestamp;--> statement-breakpoint
ALTER TABLE `crew_assignments` ADD `dutyEndTime` timestamp;--> statement-breakpoint
ALTER TABLE `crew_assignments` ADD `ruleEvidenceId` int;--> statement-breakpoint
CREATE INDEX `irops_recovery_event_idx` ON `irops_recovery_plans` (`eventId`,`status`);