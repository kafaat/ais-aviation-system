CREATE TABLE `premium_assignments` (
	`id` varchar(36) NOT NULL,
	`policyId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`variant` enum('control','treatment') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `premium_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `premium_assignment_visitor_idx` UNIQUE(`policyId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `premium_conversions` (
	`bookingId` int NOT NULL,
	`assignmentId` varchar(36) NOT NULL,
	`offerId` varchar(36) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `premium_conversions_bookingId` PRIMARY KEY(`bookingId`)
);
--> statement-breakpoint
CREATE TABLE `premium_policies` (
	`id` varchar(36) NOT NULL,
	`flightId` int NOT NULL,
	`tenantId` int,
	`evidenceId` int NOT NULL,
	`payload` json NOT NULL,
	`approvedBy` int NOT NULL,
	`status` enum('enabled','paused') NOT NULL DEFAULT 'enabled',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `premium_policies_id` PRIMARY KEY(`id`),
	CONSTRAINT `premium_policy_evidence_idx` UNIQUE(`evidenceId`)
);
--> statement-breakpoint
CREATE INDEX `premium_policy_flight_idx` ON `premium_policies` (`flightId`,`status`);