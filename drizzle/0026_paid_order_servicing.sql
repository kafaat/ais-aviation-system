CREATE TABLE `order_service_refunds` (
	`id` varchar(36) NOT NULL,
	`bookingId` int NOT NULL,
	`modificationId` int NOT NULL,
	`paymentIntentId` varchar(255) NOT NULL,
	`amount` int NOT NULL,
	`baseRefundedAmount` int NOT NULL,
	`status` enum('queued','requesting','pending','succeeded','failed','review_required') NOT NULL DEFAULT 'queued',
	`refundId` varchar(255),
	`requestedAt` timestamp,
	`nextAttemptAt` timestamp NOT NULL DEFAULT (now()),
	`errorCode` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `order_service_refunds_id` PRIMARY KEY(`id`),
	CONSTRAINT `order_refund_mod_payment_unique` UNIQUE(`modificationId`,`paymentIntentId`)
);
--> statement-breakpoint
ALTER TABLE `booking_modifications` ADD `servicingPayload` json;--> statement-breakpoint
ALTER TABLE `booking_modifications` ADD `executionEventId` varchar(36);--> statement-breakpoint
ALTER TABLE `booking_modifications` ADD `checkoutRequestId` varchar(36);--> statement-breakpoint
ALTER TABLE `booking_modifications` ADD `checkoutData` json;--> statement-breakpoint
ALTER TABLE `booking_modifications` ADD `checkoutSessionId` varchar(255);--> statement-breakpoint
ALTER TABLE `booking_modifications` ADD `checkoutUrl` text;--> statement-breakpoint
CREATE INDEX `order_refund_pending_idx` ON `order_service_refunds` (`status`,`nextAttemptAt`);--> statement-breakpoint
CREATE INDEX `order_refund_booking_idx` ON `order_service_refunds` (`bookingId`);