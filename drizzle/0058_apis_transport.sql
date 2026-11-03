CREATE TABLE `apis_transmissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int,
	`flightId` int NOT NULL,
	`messageType` enum('PNRGOV','PAXLST') NOT NULL,
	`destinationCountry` varchar(3) NOT NULL,
	`authorityCode` varchar(35) NOT NULL,
	`messageVersion` varchar(10) NOT NULL,
	`scheduleOffsetMinutes` int,
	`scheduledFor` timestamp NOT NULL,
	`correlationId` varchar(14) NOT NULL,
	`status` enum('queued','sending','sent','acked','rejected','failed','dead_letter') NOT NULL DEFAULT 'queued',
	`attempts` int NOT NULL DEFAULT 0,
	`nextAttemptAt` timestamp,
	`body` longtext,
	`bodyHash` varchar(64),
	`pnrCount` int,
	`passengerCount` int,
	`transportName` varchar(40),
	`transportReference` varchar(255),
	`sentAt` timestamp,
	`acknowledgedAt` timestamp,
	`acknowledgementBody` text,
	`acknowledgementCode` varchar(40),
	`lastError` text,
	`requestedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `apis_transmissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `apis_transmissions_correlation_idx` UNIQUE(`correlationId`)
);
--> statement-breakpoint
CREATE TABLE `document_verification_results` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int,
	`bookingId` int NOT NULL,
	`passengerId` int NOT NULL,
	`flightId` int NOT NULL,
	`verdict` enum('go','no_go','manual_review') NOT NULL,
	`reasons` json NOT NULL,
	`rulesApplied` json NOT NULL,
	`rulesSource` varchar(40) NOT NULL,
	`documentDigest` varchar(64) NOT NULL,
	`itineraryDigest` varchar(64) NOT NULL,
	`trigger` varchar(20) NOT NULL,
	`evaluatedBy` int,
	`evaluatedAt` timestamp NOT NULL,
	`overrideVerdict` enum('go'),
	`overrideBy` int,
	`overrideRole` varchar(20),
	`overrideReason` text,
	`overriddenAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `document_verification_results_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `entry_requirement_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int,
	`destinationCountry` varchar(3) NOT NULL,
	`nationality` varchar(3) NOT NULL,
	`documentType` varchar(12) NOT NULL,
	`visaRequirement` enum('none','visa_required','evisa','visa_on_arrival','transit_without_visa') NOT NULL,
	`transitWithoutVisaHours` int,
	`passportValidityMonths` int NOT NULL DEFAULT 0,
	`blankPagesRequired` int NOT NULL DEFAULT 0,
	`sourceName` varchar(120) NOT NULL,
	`sourceUrl` varchar(500) NOT NULL,
	`effectiveFrom` datetime NOT NULL,
	`effectiveTo` datetime,
	`confirmationStatus` enum('confirmed','unconfirmed','fictional_fixture') NOT NULL,
	`notes` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `entry_requirement_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pnrgov_schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int,
	`destinationCountry` varchar(3) NOT NULL,
	`authorityCode` varchar(35) NOT NULL,
	`messageVersion` varchar(10) NOT NULL DEFAULT '21:1',
	`offsetsMinutes` json NOT NULL,
	`timingSource` varchar(255) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pnrgov_schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `pnrgov_schedules_destination_idx` UNIQUE(`tenantId`,`destinationCountry`)
);
--> statement-breakpoint
CREATE INDEX `apis_transmissions_flight_idx` ON `apis_transmissions` (`flightId`,`messageType`);--> statement-breakpoint
CREATE INDEX `apis_transmissions_due_idx` ON `apis_transmissions` (`status`,`scheduledFor`,`nextAttemptAt`);--> statement-breakpoint
CREATE INDEX `document_verification_passenger_idx` ON `document_verification_results` (`passengerId`,`flightId`,`evaluatedAt`);--> statement-breakpoint
CREATE INDEX `document_verification_booking_idx` ON `document_verification_results` (`bookingId`);--> statement-breakpoint
CREATE INDEX `entry_rules_lookup_idx` ON `entry_requirement_rules` (`destinationCountry`,`nationality`,`documentType`);