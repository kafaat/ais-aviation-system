CREATE TABLE `flight_cancellation_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightId` int NOT NULL,
	`bookingId` int NOT NULL,
	`reason` varchar(500) NOT NULL,
	`actorId` int,
	`status` enum('queued','planned','completed','review_required') NOT NULL DEFAULT 'queued',
	`errorCode` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `flight_cancellation_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `flight_cancel_booking_unique` UNIQUE(`flightId`,`bookingId`)
);
--> statement-breakpoint
ALTER TABLE `order_service_refunds` MODIFY COLUMN `modificationId` int;--> statement-breakpoint
ALTER TABLE `order_service_refunds` ADD `cancellationFlightId` int;--> statement-breakpoint
CREATE INDEX `flight_cancel_status_idx` ON `flight_cancellation_jobs` (`status`);