CREATE TABLE `booking_loyalty_accruals` (
	`bookingId` int NOT NULL,
	`userId` int NOT NULL,
	`multiplier` decimal(5,2) NOT NULL,
	`awardedMiles` int NOT NULL DEFAULT 0,
	`awardedTierPoints` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `booking_loyalty_accruals_bookingId` PRIMARY KEY(`bookingId`)
);
--> statement-breakpoint
CREATE TABLE `event_deliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` varchar(36) NOT NULL,
	`consumer` varchar(100) NOT NULL,
	`status` enum('pending','processing','processed','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`leaseToken` varchar(36),
	`leaseUntil` timestamp,
	`processedAt` timestamp,
	`lastError` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `event_deliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `event_consumer_unique` UNIQUE(`eventId`,`consumer`)
);
--> statement-breakpoint
CREATE INDEX `event_delivery_status_idx` ON `event_deliveries` (`status`,`updatedAt`);