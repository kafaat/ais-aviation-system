CREATE TABLE `booking_modifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`userId` int NOT NULL,
	`modificationType` enum('change_date','upgrade_cabin','change_flight','add_services') NOT NULL,
	`originalFlightId` int,
	`originalCabinClass` enum('economy','business'),
	`originalAmount` int NOT NULL,
	`newFlightId` int,
	`newCabinClass` enum('economy','business'),
	`newAmount` int NOT NULL,
	`priceDifference` int NOT NULL,
	`modificationFee` int NOT NULL DEFAULT 0,
	`totalCost` int NOT NULL,
	`status` enum('pending','approved','rejected','completed') NOT NULL DEFAULT 'pending',
	`stripePaymentIntentId` varchar(255),
	`paymentStatus` enum('pending','paid','refunded') DEFAULT 'pending',
	`reason` text,
	`adminNotes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	CONSTRAINT `booking_modifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `booking_id_idx` ON `booking_modifications` (`bookingId`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `booking_modifications` (`userId`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `booking_modifications` (`status`);