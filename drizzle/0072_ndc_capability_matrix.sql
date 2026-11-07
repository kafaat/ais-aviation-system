CREATE TABLE `distribution_capabilities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`carrierCode` varchar(3) NOT NULL DEFAULT '*',
	`sellerId` varchar(50) NOT NULL DEFAULT '*',
	`channel` enum('direct','ndc','gds','ota') NOT NULL,
	`schemaVersion` varchar(16) NOT NULL DEFAULT '*',
	`action` enum('shop','price','order_create','pay','order_change_voluntary','order_change_involuntary','passenger_split','seat_move','seat_fee_refund','ancillary_change','refund','reissue','name_correction') NOT NULL,
	`support` enum('supported','unsupported','partial') NOT NULL,
	`confirmation` enum('confirmed','unconfirmed') NOT NULL DEFAULT 'unconfirmed',
	`evidenceUrl` varchar(512),
	`evidenceNote` text,
	`idempotencyKeyHeader` varchar(120),
	`traceIdHeader` varchar(120),
	`effectiveFrom` timestamp,
	`effectiveTo` timestamp,
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `distribution_capabilities_id` PRIMARY KEY(`id`),
	CONSTRAINT `distribution_capability_combination` UNIQUE(`carrierCode`,`sellerId`,`channel`,`schemaVersion`,`action`)
);
--> statement-breakpoint
CREATE INDEX `distribution_capability_channel_action` ON `distribution_capabilities` (`channel`,`action`);