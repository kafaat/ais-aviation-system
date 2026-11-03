CREATE TABLE `bag_tag_sequences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airlineId` int NOT NULL,
	`numericCode` varchar(3) NOT NULL,
	`nextSequence` int NOT NULL DEFAULT 1,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bag_tag_sequences_id` PRIMARY KEY(`id`),
	CONSTRAINT `bag_tag_sequences_airline_idx` UNIQUE(`airlineId`)
);
--> statement-breakpoint
CREATE TABLE `bag_tracking_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`baggageId` int NOT NULL,
	`licensePlate` varchar(10),
	`flightId` int NOT NULL,
	`trackingPoint` enum('acceptance','security','loading','transfer','arrival') NOT NULL,
	`stationCode` varchar(3) NOT NULL,
	`airportId` int,
	`observedAt` timestamp NOT NULL,
	`recordedAt` timestamp NOT NULL DEFAULT (now()),
	`sourceId` varchar(64) NOT NULL,
	`deviceId` varchar(100),
	`actorType` enum('user','handler','system') NOT NULL,
	`actorId` varchar(100),
	`scanMethod` enum('manual','scanner','bsm') NOT NULL,
	`origin` enum('system','handler') NOT NULL,
	`physicalScanVerified` boolean NOT NULL DEFAULT false,
	`evidenceId` int,
	`containerId` varchar(20),
	CONSTRAINT `bag_tracking_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `airlines` ADD `numericCode` varchar(3);--> statement-breakpoint
ALTER TABLE `baggage_items` ADD `licensePlate` varchar(10);--> statement-breakpoint
ALTER TABLE `baggage_items` ADD CONSTRAINT `baggage_items_license_plate_idx` UNIQUE(`licensePlate`);--> statement-breakpoint
CREATE INDEX `bag_tracking_bag_timeline_idx` ON `bag_tracking_events` (`baggageId`,`observedAt`);--> statement-breakpoint
CREATE INDEX `bag_tracking_flight_point_idx` ON `bag_tracking_events` (`flightId`,`trackingPoint`);--> statement-breakpoint
CREATE INDEX `bag_tracking_license_plate_idx` ON `bag_tracking_events` (`licensePlate`);--> statement-breakpoint
CREATE INDEX `bag_tracking_dedupe_idx` ON `bag_tracking_events` (`baggageId`,`trackingPoint`,`stationCode`,`observedAt`);