CREATE TABLE `bag_drop_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`unitId` int NOT NULL DEFAULT 0,
	`bookingId` int NOT NULL,
	`passengerId` int NOT NULL,
	`totalBags` int NOT NULL DEFAULT 0,
	`totalWeight` int NOT NULL DEFAULT 0,
	`bagWeights` json NOT NULL,
	`allowanceWeight` int NOT NULL,
	`excessWeight` int NOT NULL DEFAULT 0,
	`excessFee` int NOT NULL DEFAULT 0,
	`paymentStatus` enum('none','pending','paid') NOT NULL DEFAULT 'none',
	`status` enum('started','weighing','payment','printing','complete','error','timeout') NOT NULL DEFAULT 'started',
	`version` int NOT NULL DEFAULT 0,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bag_drop_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bag_drop_tags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`bagNumber` int NOT NULL,
	`tagNumber` varchar(20) NOT NULL,
	`weight` int NOT NULL,
	`destination` varchar(3) NOT NULL,
	`connectionTags` json,
	`printedAt` timestamp,
	`status` enum('printed','attached','loaded','transferred','arrived','lost') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bag_drop_tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `bag_drop_tags_tagNumber_unique` UNIQUE(`tagNumber`),
	CONSTRAINT `bag_drop_session_bag` UNIQUE(`sessionId`,`bagNumber`)
);
--> statement-breakpoint
CREATE TABLE `bag_drop_units` (
	`id` int AUTO_INCREMENT NOT NULL,
	`unitCode` varchar(50) NOT NULL,
	`airportId` int NOT NULL,
	`terminal` varchar(50) NOT NULL,
	`zone` varchar(50) NOT NULL,
	`status` enum('online','offline','jam','maintenance') NOT NULL DEFAULT 'offline',
	`hasPrinter` boolean NOT NULL DEFAULT false,
	`hasScale` boolean NOT NULL DEFAULT false,
	`hasPayment` boolean NOT NULL DEFAULT false,
	`beltConnected` boolean NOT NULL DEFAULT false,
	`lastMaintenance` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bag_drop_units_id` PRIMARY KEY(`id`),
	CONSTRAINT `bag_drop_units_unitCode_unique` UNIQUE(`unitCode`)
);
--> statement-breakpoint
CREATE TABLE `event_inbox` (
	`eventId` varchar(36) NOT NULL,
	`eventType` varchar(100) NOT NULL,
	`aggregateType` varchar(100) NOT NULL,
	`aggregateId` varchar(255) NOT NULL,
	`tenantId` int,
	`payload` json NOT NULL,
	`processedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `event_inbox_eventId` PRIMARY KEY(`eventId`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_tasks` (
	`name` varchar(100) NOT NULL,
	`lastTick` varchar(64),
	`leaseToken` varchar(36),
	`leaseUntil` datetime,
	`lastStartedAt` datetime,
	`lastSuccessAt` datetime,
	`lastError` text,
	CONSTRAINT `scheduled_tasks_name` PRIMARY KEY(`name`)
);
--> statement-breakpoint
CREATE TABLE `warehouse_exports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`exportType` enum('bookings','flights','revenue','customers','operational') NOT NULL,
	`dateRangeStart` datetime NOT NULL,
	`dateRangeEnd` datetime NOT NULL,
	`format` enum('csv','json','jsonl') NOT NULL,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`filePath` varchar(255),
	`recordCount` int NOT NULL DEFAULT 0,
	`fileSize` int NOT NULL DEFAULT 0,
	`createdBy` int NOT NULL,
	`requestKey` varchar(191),
	`checksum` varchar(64),
	`content` longtext,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `warehouse_exports_id` PRIMARY KEY(`id`),
	CONSTRAINT `warehouse_export_request` UNIQUE(`requestKey`)
);
--> statement-breakpoint
CREATE TABLE `warehouse_schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`createdBy` int NOT NULL,
	`exportType` enum('bookings','flights','revenue','customers','operational') NOT NULL,
	`frequency` enum('daily','weekly','monthly') NOT NULL,
	`format` enum('csv','json','jsonl') NOT NULL,
	`lastRunAt` datetime,
	`nextRunAt` datetime NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`config` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `warehouse_schedules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `booking_segments` ADD `segmentAmount` int;--> statement-breakpoint
CREATE INDEX `bag_drop_passenger` ON `bag_drop_sessions` (`bookingId`,`passengerId`);--> statement-breakpoint
CREATE INDEX `bag_drop_unit` ON `bag_drop_sessions` (`unitId`);--> statement-breakpoint
CREATE INDEX `warehouse_export_created` ON `warehouse_exports` (`createdAt`);