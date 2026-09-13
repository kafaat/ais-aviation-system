CREATE TABLE `loyalty_credit_lots` (
	`transactionId` int NOT NULL,
	`loyaltyAccountId` int NOT NULL,
	`bookingId` int,
	`creditedMiles` int NOT NULL,
	`remainingMiles` int NOT NULL,
	`spentMiles` int NOT NULL DEFAULT 0,
	`expiredMiles` int NOT NULL DEFAULT 0,
	`reversedMiles` int NOT NULL DEFAULT 0,
	`expiresAt` timestamp,
	CONSTRAINT `loyalty_credit_lots_transactionId` PRIMARY KEY(`transactionId`)
);
--> statement-breakpoint
ALTER TABLE `loyalty_accounts` ADD `creditLotsInitializedAt` timestamp;--> statement-breakpoint
CREATE INDEX `loyalty_lots_account_idx` ON `loyalty_credit_lots` (`loyaltyAccountId`);