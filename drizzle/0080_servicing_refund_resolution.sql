CREATE TABLE `order_service_refund_attempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` varchar(36) NOT NULL,
	`attempt` int NOT NULL,
	`refundId` varchar(255) NOT NULL,
	`status` enum('failed','canceled') NOT NULL,
	`errorCode` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_service_refund_attempts_id` PRIMARY KEY(`id`),
	CONSTRAINT `order_refund_attempt_unique` UNIQUE(`requestId`,`attempt`),
	CONSTRAINT `order_refund_attempt_refund_unique` UNIQUE(`refundId`)
);
--> statement-breakpoint
ALTER TABLE `order_service_refunds` MODIFY COLUMN `status` enum('queued','requesting','pending','succeeded','failed','review_required','cancelled') NOT NULL DEFAULT 'queued';--> statement-breakpoint
ALTER TABLE `order_service_refunds` ADD `attempt` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `order_service_refunds` ADD `resolvedBy` int;--> statement-breakpoint
ALTER TABLE `order_service_refunds` ADD `resolvedAt` timestamp;--> statement-breakpoint
ALTER TABLE `order_service_refunds` ADD `resolutionReason` varchar(500);