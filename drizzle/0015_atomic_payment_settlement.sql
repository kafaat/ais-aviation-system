CREATE TABLE `payment_receipts` (
	`paymentIntentId` varchar(255) NOT NULL,
	`kind` enum('booking','split_payment','modification','wallet_topup') NOT NULL,
	`bookingId` int,
	`userId` int NOT NULL,
	`targetId` int NOT NULL,
	`amount` int NOT NULL,
	`currency` varchar(3) NOT NULL,
	`refundedAmount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_receipts_paymentIntentId` PRIMARY KEY(`paymentIntentId`)
);
--> statement-breakpoint
ALTER TABLE `bookings` ADD `inventoryLockId` int;--> statement-breakpoint
ALTER TABLE `bookings` ADD `seatsReserved` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_inventoryLockId_unique` UNIQUE(`inventoryLockId`);
--> statement-breakpoint
-- Existing confirmed inventory needs reconciliation against the pre-upgrade snapshot.
UPDATE `bookings` SET `seatsReserved` = TRUE WHERE `status` IN ('confirmed', 'completed') AND `paymentStatus` = 'paid';
--> statement-breakpoint
-- Legacy top-ups were not provider-verified. Positive balances require review before use.
UPDATE `wallets` SET `status` = 'frozen' WHERE `balance` > 0 AND `status` = 'active';
