CREATE TABLE `irops_actions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` int NOT NULL,
	`requestKey` varchar(191) NOT NULL,
	`actionType` enum('rebook','hotel','compensation','notification','meal_voucher') NOT NULL,
	`targetPassengerId` int,
	`status` enum('pending','in_progress','completed','failed') NOT NULL DEFAULT 'pending',
	`details` json NOT NULL,
	`evidenceType` varchar(40),
	`evidenceId` varchar(191),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `irops_actions_id` PRIMARY KEY(`id`),
	CONSTRAINT `irops_actions_request_idx` UNIQUE(`requestKey`)
);
--> statement-breakpoint
ALTER TABLE `flight_disruptions` ADD `iropsType` enum('delay','cancellation','diversion','equipment_change');--> statement-breakpoint
ALTER TABLE `flight_disruptions` ADD `iropsSeverity` enum('low','medium','high','critical');--> statement-breakpoint
ALTER TABLE `flight_disruptions` ADD `escalationLevel` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `flight_disruptions` ADD `estimatedRecoveryTime` timestamp;--> statement-breakpoint
ALTER TABLE `flight_disruptions` ADD `protectionStartedAt` timestamp;--> statement-breakpoint
CREATE INDEX `irops_actions_event_idx` ON `irops_actions` (`eventId`,`status`);
