CREATE TABLE `agency_credit_obligations` (
	`bookingId` int NOT NULL,
	`termsId` int NOT NULL,
	`amountMinor` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agency_credit_obligations_bookingId` PRIMARY KEY(`bookingId`)
);
--> statement-breakpoint
CREATE TABLE `agency_credit_terms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agencyId` int NOT NULL,
	`ownerId` int NOT NULL,
	`tenantId` int,
	`limitMinor` int,
	`approvedBy` int NOT NULL,
	`reason` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agency_credit_terms_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `codeshare_allotments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agreementId` int NOT NULL,
	`flightId` int NOT NULL,
	`cabinClass` enum('economy','business') NOT NULL,
	`marketingFlightNumber` varchar(10) NOT NULL,
	`seatLimit` int unsigned NOT NULL,
	CONSTRAINT `codeshare_allotments_id` PRIMARY KEY(`id`),
	CONSTRAINT `codeshare_allotment_scope` UNIQUE(`agreementId`,`flightId`,`cabinClass`)
);
--> statement-breakpoint
CREATE TABLE `dcs_bag_return_grants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`airlineId` int NOT NULL,
	`airportId` int NOT NULL,
	`staffId` int NOT NULL,
	`enabled` boolean NOT NULL,
	CONSTRAINT `dcs_bag_return_grants_id` PRIMARY KEY(`id`),
	CONSTRAINT `dcs_return_staff_station` UNIQUE(`tenantId`,`airlineId`,`airportId`,`staffId`)
);
--> statement-breakpoint
ALTER TABLE `baggage_items` ADD `returnEventId` int;--> statement-breakpoint
ALTER TABLE `bookings` ADD `codeshareAllotmentId` int;--> statement-breakpoint
CREATE INDEX `agency_credit_obligations_terms` ON `agency_credit_obligations` (`termsId`);--> statement-breakpoint
CREATE INDEX `agency_credit_revision` ON `agency_credit_terms` (`agencyId`,`id`);--> statement-breakpoint
CREATE INDEX `bookings_codeshare_allotment_idx` ON `bookings` (`codeshareAllotmentId`);