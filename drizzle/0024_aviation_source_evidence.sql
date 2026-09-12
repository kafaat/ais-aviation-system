CREATE TABLE `aviation_evidence` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceId` varchar(64) NOT NULL,
	`sourceEventId` varchar(128) NOT NULL,
	`tenantId` int,
	`flightId` int,
	`kind` varchar(50) NOT NULL,
	`payload` json NOT NULL,
	`digest` varchar(64) NOT NULL,
	`observedAt` timestamp NOT NULL,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `aviation_evidence_id` PRIMARY KEY(`id`),
	CONSTRAINT `aviation_source_event_unique` UNIQUE(`sourceId`,`sourceEventId`)
);
--> statement-breakpoint
CREATE INDEX `aviation_flight_kind_idx` ON `aviation_evidence` (`flightId`,`kind`,`observedAt`);