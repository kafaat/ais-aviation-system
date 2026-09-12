CREATE TABLE `baggage_custody_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`baggageId` int NOT NULL,
	`flightId` int NOT NULL,
	`stage` enum('acceptance','loading','transfer','arrival') NOT NULL,
	`evidenceId` int NOT NULL,
	`previousEvidenceId` int,
	`airportId` int NOT NULL,
	`deviceId` varchar(100) NOT NULL,
	`sourceId` varchar(64) NOT NULL,
	`observedAt` timestamp NOT NULL,
	CONSTRAINT `baggage_custody_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `baggage_custody_events_evidenceId_unique` UNIQUE(`evidenceId`)
);
--> statement-breakpoint
CREATE INDEX `baggage_custody_journey_idx` ON `baggage_custody_events` (`baggageId`,`observedAt`);