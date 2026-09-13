CREATE TABLE `operational_samples` (
	`id` varchar(36) NOT NULL,
	`instanceId` varchar(64) NOT NULL,
	`component` enum('api','worker') NOT NULL,
	`status` enum('healthy','degraded','stopped') NOT NULL,
	`startedAt` timestamp NOT NULL,
	`endedAt` timestamp NOT NULL,
	`requests` int NOT NULL DEFAULT 0,
	`errors` int NOT NULL DEFAULT 0,
	`totalDurationMs` decimal(20,3) NOT NULL DEFAULT '0',
	CONSTRAINT `operational_samples_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `operations_alerts` (
	`key` varchar(100) NOT NULL,
	`status` enum('active','resolved') NOT NULL,
	`message` varchar(500) NOT NULL,
	`acknowledgedBy` int,
	`acknowledgedAt` timestamp,
	`firstObservedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `operations_alerts_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE INDEX `operational_sample_window_idx` ON `operational_samples` (`component`,`endedAt`);