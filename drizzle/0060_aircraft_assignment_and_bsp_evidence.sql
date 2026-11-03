CREATE TABLE `bsp_evidence_files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenant_id` int NOT NULL,
	`kind` enum('ret_draft','hot_input','bank_input') NOT NULL,
	`reference` varchar(96) NOT NULL,
	`digest` varchar(64) NOT NULL,
	`content` json NOT NULL,
	`recorded_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bsp_evidence_files_id` PRIMARY KEY(`id`),
	CONSTRAINT `bsp_evidence_identity` UNIQUE(`tenant_id`,`kind`,`reference`)
);
--> statement-breakpoint
ALTER TABLE `flights` ADD `aircraftRegistrationId` int;