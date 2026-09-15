CREATE TABLE `compensation_claims` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`flightId` int NOT NULL,
	`passengerId` int,
	`regulationType` enum('eu261','dot','local') NOT NULL,
	`claimType` enum('delay','cancellation','denied_boarding','downgrade') NOT NULL,
	`flightDistance` int,
	`delayMinutes` int,
	`calculatedAmount` int,
	`approvedAmount` int,
	`currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`status` enum('pending','under_review','approved','denied','paid','appealed') NOT NULL DEFAULT 'under_review',
	`reason` text,
	`denialReason` text,
	`reviewEvidence` json,
	`filedAt` timestamp NOT NULL DEFAULT (now()),
	`resolvedAt` timestamp,
	`paidAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `compensation_claims_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `compensation_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`regulationType` enum('eu261','dot','local') NOT NULL,
	`claimType` enum('delay','cancellation','denied_boarding','downgrade') NOT NULL,
	`minDelay` int,
	`maxDelay` int,
	`distanceMin` int,
	`distanceMax` int,
	`compensationAmount` int NOT NULL,
	`currency` varchar(3) NOT NULL,
	`conditions` json,
	`isActive` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `compensation_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `compensation_claim_booking_idx` ON `compensation_claims` (`bookingId`);--> statement-breakpoint
CREATE INDEX `compensation_claim_flight_idx` ON `compensation_claims` (`flightId`);