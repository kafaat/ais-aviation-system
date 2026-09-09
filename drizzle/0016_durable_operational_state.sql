CREATE TABLE `load_plan_details` (
	`flightId` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`data` json NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `load_plan_details_flightId` PRIMARY KEY(`flightId`)
);
--> statement-breakpoint
ALTER TABLE `outbox` ADD `leaseToken` varchar(36);