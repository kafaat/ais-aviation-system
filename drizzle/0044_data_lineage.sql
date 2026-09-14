CREATE TABLE `lineage_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` varchar(36) NOT NULL,
	`jobNamespace` varchar(255) NOT NULL,
	`jobName` varchar(255) NOT NULL,
	`eventType` enum('START','RUNNING','COMPLETE','ABORT','FAIL','OTHER') NOT NULL,
	`eventTime` timestamp NOT NULL,
	`traceId` varchar(32),
	`document` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lineage_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `lineage_event_identity_idx` UNIQUE(`runId`,`eventType`)
);
--> statement-breakpoint
CREATE INDEX `lineage_event_job_idx` ON `lineage_events` (`jobName`,`eventTime`);