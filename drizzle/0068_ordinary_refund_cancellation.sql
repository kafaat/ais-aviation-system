CREATE TABLE `ordinary_booking_refunds` (
	`bookingId` int NOT NULL,
	`paymentIntentId` varchar(255) NOT NULL,
	`operationId` varchar(255) NOT NULL,
	`actorId` int NOT NULL,
	`amount` int NOT NULL,
	`collectedAmount` int NOT NULL,
	`baseRefundedAmount` int NOT NULL,
	`requestPayload` text NOT NULL,
	`refundId` varchar(255),
	`status` enum('queued','requesting','pending','succeeded','failed','review_required') NOT NULL DEFAULT 'queued',
	`providerStatus` varchar(32),
	`errorCode` varchar(64),
	`requestedAt` timestamp,
	`nextAttemptAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ordinary_booking_refunds_bookingId` PRIMARY KEY(`bookingId`),
	CONSTRAINT `ordinary_booking_refunds_paymentIntentId_unique` UNIQUE(`paymentIntentId`),
	CONSTRAINT `ordinary_booking_refunds_operationId_unique` UNIQUE(`operationId`),
	CONSTRAINT `ordinary_booking_refunds_refundId_unique` UNIQUE(`refundId`)
);
--> statement-breakpoint
CREATE INDEX `ordinary_refunds_due_idx` ON `ordinary_booking_refunds` (`status`,`nextAttemptAt`);