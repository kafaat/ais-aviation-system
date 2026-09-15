CREATE TABLE `alert_dispatches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`alertKey` varchar(100) NOT NULL,
	`action` enum('raise','close') NOT NULL,
	`dedupKey` varchar(100) NOT NULL,
	`summary` varchar(200) NOT NULL,
	`details` varchar(1000) NOT NULL DEFAULT '',
	`status` enum('pending','outcome_unknown','delivered','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`nextAttemptAt` timestamp,
	`leaseToken` varchar(36),
	`leaseUntil` timestamp,
	`providerMode` enum('sandbox','live') NOT NULL,
	`providerReference` varchar(255) NOT NULL,
	`lastError` varchar(500),
	`deliveredAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `alert_dispatches_id` PRIMARY KEY(`id`),
	CONSTRAINT `alert_dispatch_identity_idx` UNIQUE(`alertKey`,`action`,`dedupKey`)
);
--> statement-breakpoint
CREATE INDEX `alert_dispatch_claimable_idx` ON `alert_dispatches` (`status`,`nextAttemptAt`);