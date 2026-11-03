CREATE TABLE `dcs_flight_operations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightId` int NOT NULL,
	`tenantId` int,
	`checkInState` enum('open','closed') NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dcs_flight_operations_id` PRIMARY KEY(`id`),
	CONSTRAINT `dcs_flight_operations_flight` UNIQUE(`flightId`)
);
--> statement-breakpoint
CREATE TABLE `dcs_operation_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int,
	`flightId` int NOT NULL,
	`bookingId` int,
	`passengerId` int,
	`action` varchar(32) NOT NULL,
	`fromState` varchar(32) NOT NULL,
	`toState` varchar(32) NOT NULL,
	`actorId` int,
	`actorRole` varchar(32) NOT NULL,
	`reason` varchar(500) NOT NULL,
	`idempotencyKey` varchar(255),
	`requestHash` varchar(64) NOT NULL,
	`details` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dcs_operation_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dcs_passenger_states` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`passengerId` int NOT NULL,
	`flightId` int NOT NULL,
	`state` enum('not_checked_in','checked_in','boarded','offloaded') NOT NULL,
	`boardingDenied` boolean NOT NULL DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dcs_passenger_states_id` PRIMARY KEY(`id`),
	CONSTRAINT `dcs_passenger_flight` UNIQUE(`bookingId`,`passengerId`,`flightId`)
);
--> statement-breakpoint
ALTER TABLE `baggage_items` ADD `flightId` int;--> statement-breakpoint
ALTER TABLE `baggage_items` ADD `segmentId` int;--> statement-breakpoint
CREATE INDEX `dcs_operation_events_flight` ON `dcs_operation_events` (`flightId`,`id`);--> statement-breakpoint
CREATE INDEX `dcs_operation_events_passenger` ON `dcs_operation_events` (`bookingId`,`passengerId`,`flightId`,`id`);--> statement-breakpoint
CREATE INDEX `dcs_passenger_states_flight` ON `dcs_passenger_states` (`flightId`);--> statement-breakpoint
CREATE INDEX `baggage_items_passenger_segment_idx` ON `baggage_items` (`bookingId`,`passengerId`,`segmentId`);