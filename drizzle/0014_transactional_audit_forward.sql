CREATE TABLE `load_plan_details` (
	`flightId` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`data` json NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `load_plan_details_flightId` PRIMARY KEY(`flightId`)
);
--> statement-breakpoint
CREATE TABLE `mfa_challenges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mfa_challenges_id` PRIMARY KEY(`id`),
	CONSTRAINT `mfa_challenges_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `mfa_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`secret` text NOT NULL,
	`isEnabled` boolean NOT NULL DEFAULT false,
	`backupCodes` text NOT NULL,
	`enabledAt` timestamp,
	`lastUsedAt` timestamp,
	`lastUsedStep` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mfa_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `mfa_settings_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `payment_receipts` (
	`paymentIntentId` varchar(255) NOT NULL,
	`kind` enum('booking','split_payment','modification','wallet_topup') NOT NULL,
	`bookingId` int,
	`userId` int NOT NULL,
	`targetId` int NOT NULL,
	`amount` int NOT NULL,
	`currency` varchar(3) NOT NULL,
	`refundedAmount` int NOT NULL DEFAULT 0,
	`settlementStatus` enum('applied','review_required','review_refunded') NOT NULL DEFAULT 'applied',
	`settlementError` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_receipts_paymentIntentId` PRIMARY KEY(`paymentIntentId`)
);
--> statement-breakpoint
ALTER TABLE `bookings` ADD `inventoryLockId` int;--> statement-breakpoint
ALTER TABLE `bookings` ADD `seatsReserved` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `outbox` ADD `leaseToken` varchar(36);--> statement-breakpoint
ALTER TABLE `refresh_tokens` ADD `familyId` varchar(64);--> statement-breakpoint
ALTER TABLE `refresh_tokens` ADD `mfaVerified` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_inventoryLockId_unique` UNIQUE(`inventoryLockId`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_family_idx` ON `refresh_tokens` (`familyId`,`revokedAt`);
--> statement-breakpoint
-- Preserve the paid legacy bookings that already consumed inventory.
UPDATE `bookings` SET `seatsReserved` = TRUE
WHERE `status` IN ('confirmed', 'completed') AND `paymentStatus` = 'paid';
--> statement-breakpoint
-- Existing positive balances need funding review before spending is enabled.
UPDATE `wallets` SET `status` = 'frozen'
WHERE `balance` > 0 AND `status` = 'active';
