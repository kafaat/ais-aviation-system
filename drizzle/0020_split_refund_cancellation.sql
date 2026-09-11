CREATE TABLE `booking_refund_items` (
	`id` varchar(36) NOT NULL,
	`bookingId` int NOT NULL,
	`planId` varchar(36) NOT NULL,
	`splitId` int NOT NULL,
	`paymentIntentId` varchar(255) NOT NULL,
	`collectedAmount` int NOT NULL,
	`refundAmount` int NOT NULL,
	`requestPayload` text NOT NULL,
	`requestedAt` timestamp,
	`refundId` varchar(255),
	`status` enum('queued','requesting','pending','succeeded','failed','review_required') NOT NULL DEFAULT 'queued',
	`providerStatus` varchar(32),
	`errorCode` varchar(64),
	`nextAttemptAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `booking_refund_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `booking_refund_items_splitId_unique` UNIQUE(`splitId`),
	CONSTRAINT `booking_refund_items_paymentIntentId_unique` UNIQUE(`paymentIntentId`),
	CONSTRAINT `booking_refund_items_refundId_unique` UNIQUE(`refundId`)
);
--> statement-breakpoint
CREATE TABLE `booking_refund_plans` (
	`bookingId` int NOT NULL,
	`id` varchar(36) NOT NULL,
	`actorId` int NOT NULL,
	`quoteHash` varchar(64) NOT NULL,
	`totalAmount` int NOT NULL,
	`cancellationFee` int NOT NULL,
	`refundAmount` int NOT NULL,
	`policyTier` varchar(16) NOT NULL,
	`reason` varchar(32) NOT NULL,
	`notes` varchar(500),
	`status` enum('processing','completed','review_required') NOT NULL DEFAULT 'processing',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `booking_refund_plans_bookingId` PRIMARY KEY(`bookingId`),
	CONSTRAINT `booking_refund_plans_id_unique` UNIQUE(`id`)
);
--> statement-breakpoint
CREATE INDEX `refund_items_booking_idx` ON `booking_refund_items` (`bookingId`);--> statement-breakpoint
CREATE INDEX `refund_items_due_idx` ON `booking_refund_items` (`status`,`nextAttemptAt`);