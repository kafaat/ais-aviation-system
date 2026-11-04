CREATE TABLE `standard_report_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`templateId` int,
	`createdBy` int NOT NULL,
	`tenantId` int,
	`reportId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`requestKey` varchar(150) NOT NULL,
	`definitionHash` varchar(64) NOT NULL,
	`filters` json NOT NULL,
	`columns` json,
	`format` enum('csv','html','xml') NOT NULL,
	`status` enum('generating','ready','failed') NOT NULL,
	`leaseToken` varchar(36),
	`leaseUntil` timestamp,
	`content` longtext,
	`filename` varchar(160),
	`contentType` varchar(100),
	`recordCount` int NOT NULL DEFAULT 0,
	`checksum` varchar(64),
	`deliveryStatus` enum('none','pending','sending','accepted','failed','unknown') NOT NULL DEFAULT 'none',
	`deliveryStartedAt` timestamp,
	`emailReceiptId` varchar(160),
	`emailAcceptedAt` timestamp,
	`errorMessage` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `standard_report_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `standard_report_run_request` UNIQUE(`requestKey`)
);
--> statement-breakpoint
CREATE TABLE `standard_report_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`createdBy` int NOT NULL,
	`tenantId` int,
	`reportId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`filters` json NOT NULL,
	`columns` json,
	`format` enum('csv','html','xml') NOT NULL,
	`cadence` enum('manual','daily','weekly','monthly') NOT NULL,
	`hourUtc` int NOT NULL DEFAULT 0,
	`minuteUtc` int NOT NULL DEFAULT 0,
	`lookbackDays` int,
	`emailToOwner` boolean NOT NULL DEFAULT false,
	`enabled` boolean NOT NULL DEFAULT true,
	`nextRunAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `standard_report_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `standard_report_run_owner` ON `standard_report_runs` (`createdBy`,`id`);--> statement-breakpoint
CREATE INDEX `standard_report_run_template` ON `standard_report_runs` (`templateId`,`id`);--> statement-breakpoint
CREATE INDEX `standard_report_template_owner` ON `standard_report_templates` (`createdBy`,`id`);--> statement-breakpoint
CREATE INDEX `standard_report_template_due` ON `standard_report_templates` (`enabled`,`nextRunAt`);