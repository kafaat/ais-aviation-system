CREATE TABLE `retail_offers` (
	`id` varchar(36) NOT NULL,
	`flightId` int NOT NULL,
	`tenantId` int,
	`userId` int,
	`channel` enum('direct','ndc') NOT NULL,
	`cabinClass` enum('economy','business') NOT NULL,
	`payload` json NOT NULL,
	`digest` varchar(64) NOT NULL,
	`totalAmount` int NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`consumedBookingId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `retail_offers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `retail_offers_expires_idx` ON `retail_offers` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `retail_offers_booking_idx` ON `retail_offers` (`consumedBookingId`);