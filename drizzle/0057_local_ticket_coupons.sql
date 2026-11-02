CREATE TABLE `ticket_coupons` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`passengerId` int NOT NULL,
	`flightId` int NOT NULL,
	`ticketNumber` varchar(13) NOT NULL,
	`couponNumber` int NOT NULL,
	`status` enum('O','C','F','R','E','V','unverified') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ticket_coupons_id` PRIMARY KEY(`id`),
	CONSTRAINT `ticket_coupon_document_idx` UNIQUE(`ticketNumber`,`couponNumber`)
);
--> statement-breakpoint
CREATE INDEX `ticket_coupon_booking_idx` ON `ticket_coupons` (`bookingId`,`passengerId`,`flightId`);