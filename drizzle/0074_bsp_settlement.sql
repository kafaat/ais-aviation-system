CREATE TABLE `bsp_bank_remittances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bspCountry` varchar(2) NOT NULL,
	`importSha256` varchar(64) NOT NULL,
	`lineNumber` int NOT NULL,
	`valueDate` varchar(10) NOT NULL,
	`amount` int NOT NULL,
	`currency` varchar(3) NOT NULL,
	`reference` varchar(140) NOT NULL,
	`counterparty` varchar(140),
	`importedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bsp_bank_remittances_id` PRIMARY KEY(`id`),
	CONSTRAINT `bsp_remittance_once_idx` UNIQUE(`importSha256`,`lineNumber`)
);
--> statement-breakpoint
CREATE TABLE `bsp_hot_files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bspCountry` varchar(2) NOT NULL,
	`fileName` varchar(128) NOT NULL,
	`sha256` varchar(64) NOT NULL,
	`content` longtext NOT NULL,
	`recordCount` int NOT NULL,
	`transactionCount` int NOT NULL,
	`processingDate` varchar(10),
	`remittancePeriodEnd` varchar(10),
	`totals` json NOT NULL,
	`warnings` json NOT NULL,
	`ingestedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bsp_hot_files_id` PRIMARY KEY(`id`),
	CONSTRAINT `bsp_hot_files_sha256_unique` UNIQUE(`sha256`)
);
--> statement-breakpoint
CREATE TABLE `bsp_hot_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fileId` int NOT NULL,
	`transactionNumber` int NOT NULL,
	`transactionCode` varchar(4) NOT NULL,
	`documentNumber` varchar(15) NOT NULL,
	`agentCode` varchar(8) NOT NULL,
	`passengerName` varchar(49),
	`fareAmount` int NOT NULL,
	`taxAmount` int NOT NULL,
	`commissionAmount` int NOT NULL,
	`netAmount` int NOT NULL,
	`currency` varchar(3) NOT NULL,
	`formOfPayment` varchar(2),
	`issueDate` varchar(10),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bsp_hot_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bsp_reconciliation_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` int NOT NULL,
	`documentNumber` varchar(15) NOT NULL,
	`transactionCode` varchar(4) NOT NULL,
	`ledgerEntryId` int,
	`bookingId` int,
	`retLineId` int,
	`hotLineId` int,
	`remittanceId` int,
	`expectedAmount` int,
	`hotAmount` int,
	`classification` enum('matched','missing_in_hot','amount_mismatch','missing_remittance','unexpected_in_hot') NOT NULL,
	`dispositionReason` varchar(500),
	`dispositionedBy` int,
	`dispositionedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bsp_reconciliation_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bsp_reconciliation_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bspCountry` varchar(2) NOT NULL,
	`settlementPlan` enum('bsp','arc','other') NOT NULL DEFAULT 'bsp',
	`periodStart` varchar(10) NOT NULL,
	`periodEnd` varchar(10) NOT NULL,
	`sources` json NOT NULL,
	`summary` json NOT NULL,
	`status` enum('open','complete') NOT NULL DEFAULT 'open',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `bsp_reconciliation_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bsp_ret_files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`specificationId` int NOT NULL,
	`bspCountry` varchar(2) NOT NULL,
	`reportingDate` varchar(10) NOT NULL,
	`windowStart` timestamp NOT NULL,
	`windowEnd` timestamp NOT NULL,
	`sequenceNumber` int NOT NULL,
	`fileName` varchar(64) NOT NULL,
	`sha256` varchar(64) NOT NULL,
	`content` longtext NOT NULL,
	`recordCount` int NOT NULL,
	`transactionCount` int NOT NULL,
	`controlTotals` json NOT NULL,
	`fallbackLineCount` int NOT NULL DEFAULT 0,
	`status` enum('generated','transmitted','accepted','rejected') NOT NULL DEFAULT 'generated',
	`transmittedAt` timestamp,
	`transportReference` varchar(255),
	`acknowledgedAt` timestamp,
	`acknowledgementReason` varchar(500),
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bsp_ret_files_id` PRIMARY KEY(`id`),
	CONSTRAINT `bsp_ret_files_sha256_unique` UNIQUE(`sha256`),
	CONSTRAINT `bsp_ret_period_idx` UNIQUE(`bspCountry`,`reportingDate`,`sequenceNumber`)
);
--> statement-breakpoint
CREATE TABLE `bsp_ret_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fileId` int NOT NULL,
	`transactionNumber` int NOT NULL,
	`transactionCode` varchar(4) NOT NULL,
	`documentNumber` varchar(15) NOT NULL,
	`bookingId` int,
	`passengerId` int,
	`ledgerEntryId` int,
	`agentCode` varchar(8) NOT NULL,
	`fareAmount` int NOT NULL,
	`taxAmount` int NOT NULL,
	`commissionAmount` int NOT NULL,
	`netAmount` int NOT NULL,
	`currency` varchar(3) NOT NULL,
	`formOfPayment` varchar(2) NOT NULL,
	`issuedAt` timestamp NOT NULL,
	`componentsSource` enum('fare_components','booking_total_fallback') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bsp_ret_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settlement_link_specifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int,
	`bspCountry` varchar(2) NOT NULL,
	`settlementPlan` enum('bsp','arc','other') NOT NULL DEFAULT 'bsp',
	`linkType` enum('ndclink','ifg','direct') NOT NULL,
	`dishVersion` varchar(8) NOT NULL,
	`airlineNumericCode` varchar(3) NOT NULL,
	`reportingSystemId` varchar(4) NOT NULL,
	`currency` varchar(3) NOT NULL,
	`timeZone` varchar(50) NOT NULL,
	`retCutoffLocalTime` varchar(5) NOT NULL,
	`hotCutoffLocalTime` varchar(5) NOT NULL,
	`effectiveFrom` varchar(10) NOT NULL,
	`effectiveTo` varchar(10),
	`confirmationStatus` enum('draft','confirmed','revoked') NOT NULL DEFAULT 'draft',
	`confirmationReference` varchar(100),
	`confirmedBy` int,
	`confirmedAt` timestamp,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `settlement_link_specifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `bsp_remittance_period_idx` ON `bsp_bank_remittances` (`bspCountry`,`valueDate`);--> statement-breakpoint
CREATE INDEX `bsp_hot_line_file_idx` ON `bsp_hot_lines` (`fileId`,`transactionNumber`);--> statement-breakpoint
CREATE INDEX `bsp_hot_line_document_idx` ON `bsp_hot_lines` (`documentNumber`,`transactionCode`);--> statement-breakpoint
CREATE INDEX `bsp_reconciliation_item_run_idx` ON `bsp_reconciliation_items` (`runId`,`classification`);--> statement-breakpoint
CREATE INDEX `bsp_ret_line_file_idx` ON `bsp_ret_lines` (`fileId`,`transactionNumber`);--> statement-breakpoint
CREATE INDEX `bsp_ret_line_document_idx` ON `bsp_ret_lines` (`documentNumber`,`transactionCode`);--> statement-breakpoint
CREATE INDEX `settlement_link_scope_idx` ON `settlement_link_specifications` (`bspCountry`,`confirmationStatus`,`effectiveFrom`);