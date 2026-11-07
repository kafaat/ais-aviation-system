CREATE TABLE `crew_ftl_fdp_limits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ruleSetId` int NOT NULL,
	`tableKind` enum('acclimatised','unknown_acclimatisation','unknown_acclimatisation_frm','augmented_crew') NOT NULL,
	`bandStartMinute` int NOT NULL,
	`bandEndMinute` int NOT NULL,
	`sectorsFrom` int NOT NULL,
	`sectorsTo` int NOT NULL,
	`qualifier` varchar(40),
	`maxFdpMinutes` int,
	`sourceStatus` enum('documented','transcribed_unverified','pending_official_text') NOT NULL,
	CONSTRAINT `crew_ftl_fdp_limits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crew_ftl_limits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ruleSetId` int NOT NULL,
	`limitKey` varchar(64) NOT NULL,
	`qualifier` varchar(40),
	`value` int,
	`unit` enum('minutes','count','days','percent') NOT NULL,
	`reference` varchar(120) NOT NULL,
	`sourceStatus` enum('documented','transcribed_unverified','pending_official_text') NOT NULL,
	CONSTRAINT `crew_ftl_limits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crew_ftl_rule_sets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airlineId` int NOT NULL,
	`tenantId` int,
	`code` varchar(40) NOT NULL,
	`version` varchar(50) NOT NULL,
	`name` varchar(200) NOT NULL,
	`jurisdiction` varchar(10) NOT NULL,
	`effectiveFrom` datetime NOT NULL,
	`effectiveTo` datetime,
	`sourceUrl` varchar(500) NOT NULL,
	`sourceNotes` text,
	`valuesStatus` enum('documented','transcribed_unverified','pending_official_text') NOT NULL,
	`approvalStatus` enum('draft','operator_confirmed','retired') NOT NULL DEFAULT 'draft',
	`operatorConfirmed` boolean NOT NULL DEFAULT false,
	`confirmedBy` int,
	`confirmedAt` timestamp,
	`confirmationNote` varchar(500),
	`active` boolean NOT NULL DEFAULT false,
	`activatedBy` int,
	`activatedAt` timestamp,
	`allowsOverride` boolean NOT NULL DEFAULT false,
	`importedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crew_ftl_rule_sets_id` PRIMARY KEY(`id`),
	CONSTRAINT `crew_ftl_rule_set_identity_idx` UNIQUE(`airlineId`,`code`,`version`)
);
--> statement-breakpoint
CREATE TABLE `crew_legality_overrides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airlineId` int NOT NULL,
	`tenantId` int,
	`crewMemberId` int NOT NULL,
	`flightId` int NOT NULL,
	`ruleCodes` json NOT NULL,
	`reason` text NOT NULL,
	`approvedBy` int NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`status` enum('active','consumed','revoked') NOT NULL DEFAULT 'active',
	`consumedByAssignmentId` int,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crew_legality_overrides_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crew_legality_verdicts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ruleSetId` int,
	`airlineId` int NOT NULL,
	`tenantId` int,
	`crewMemberId` int NOT NULL,
	`flightId` int,
	`pairingId` int,
	`standbyId` int,
	`path` enum('manual','bulk_roster','recovery_swap','standby_activation','preview') NOT NULL,
	`verdict` enum('legal','legal_with_extension','illegal') NOT NULL,
	`blocked` boolean NOT NULL,
	`overrideId` int,
	`checks` json NOT NULL,
	`fatigue` json NOT NULL,
	`summary` json NOT NULL,
	`actorId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `crew_legality_verdicts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crew_pairings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airlineId` int NOT NULL,
	`tenantId` int,
	`code` varchar(40) NOT NULL,
	`homeBaseAirportId` int,
	`startsAt` timestamp NOT NULL,
	`endsAt` timestamp NOT NULL,
	`legs` json NOT NULL,
	`status` enum('draft','published') NOT NULL DEFAULT 'draft',
	`publishedAt` timestamp,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crew_pairings_id` PRIMARY KEY(`id`),
	CONSTRAINT `crew_pairing_code_idx` UNIQUE(`airlineId`,`code`)
);
--> statement-breakpoint
CREATE TABLE `crew_standby_duties` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airlineId` int NOT NULL,
	`tenantId` int,
	`crewMemberId` int NOT NULL,
	`kind` enum('airport','home') NOT NULL,
	`startsAt` timestamp NOT NULL,
	`endsAt` timestamp NOT NULL,
	`locationAirportId` int,
	`status` enum('planned','activated','released','cancelled') NOT NULL DEFAULT 'planned',
	`activatedAssignmentId` int,
	`activatedAt` timestamp,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crew_standby_duties_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `crew_assignments` ADD `pairingId` int;--> statement-breakpoint
ALTER TABLE `crew_assignments` ADD `legalityVerdictId` int;--> statement-breakpoint
ALTER TABLE `crew_members` ADD `homeBaseAirportId` int;--> statement-breakpoint
CREATE INDEX `crew_ftl_fdp_rule_set_idx` ON `crew_ftl_fdp_limits` (`ruleSetId`,`tableKind`);--> statement-breakpoint
CREATE INDEX `crew_ftl_limit_rule_set_idx` ON `crew_ftl_limits` (`ruleSetId`,`limitKey`);--> statement-breakpoint
CREATE INDEX `crew_ftl_rule_set_active_idx` ON `crew_ftl_rule_sets` (`airlineId`,`active`);--> statement-breakpoint
CREATE INDEX `crew_legality_override_target_idx` ON `crew_legality_overrides` (`crewMemberId`,`flightId`,`status`);--> statement-breakpoint
CREATE INDEX `crew_legality_verdict_crew_idx` ON `crew_legality_verdicts` (`crewMemberId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `crew_legality_verdict_flight_idx` ON `crew_legality_verdicts` (`flightId`);--> statement-breakpoint
CREATE INDEX `crew_standby_crew_idx` ON `crew_standby_duties` (`crewMemberId`,`startsAt`);