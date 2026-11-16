CREATE TABLE `ordinary_booking_refund_parts` (
	`id` varchar(36) NOT NULL,
	`bookingId` int NOT NULL,
	`sequence` int NOT NULL,
	`paymentIntentId` varchar(255) NOT NULL,
	`operationId` varchar(255) NOT NULL,
	`amount` int NOT NULL,
	`collectedAmount` int NOT NULL,
	`baseRefundedAmount` int NOT NULL,
	`requestPayload` text NOT NULL,
	`requestedAt` timestamp,
	`refundId` varchar(255),
	`status` enum('queued','requesting','pending','succeeded','failed','review_required') NOT NULL DEFAULT 'queued',
	`providerStatus` varchar(32),
	`errorCode` varchar(64),
	`nextAttemptAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ordinary_booking_refund_parts_id` PRIMARY KEY(`id`),
	CONSTRAINT `ordinary_booking_refund_parts_paymentIntentId_unique` UNIQUE(`paymentIntentId`),
	CONSTRAINT `ordinary_booking_refund_parts_operationId_unique` UNIQUE(`operationId`),
	CONSTRAINT `ordinary_booking_refund_parts_refundId_unique` UNIQUE(`refundId`),
	CONSTRAINT `refund_parts_booking_sequence_idx` UNIQUE(`bookingId`,`sequence`)
);
--> statement-breakpoint
CREATE INDEX `refund_parts_due_idx` ON `ordinary_booking_refund_parts` (`status`,`nextAttemptAt`);