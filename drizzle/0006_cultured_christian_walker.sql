CREATE TABLE `loyalty_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`totalMilesEarned` int NOT NULL DEFAULT 0,
	`currentMilesBalance` int NOT NULL DEFAULT 0,
	`milesRedeemed` int NOT NULL DEFAULT 0,
	`tier` enum('bronze','silver','gold','platinum') NOT NULL DEFAULT 'bronze',
	`tierPoints` int NOT NULL DEFAULT 0,
	`memberSince` timestamp NOT NULL DEFAULT (now()),
	`lastActivityAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `loyalty_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `loyalty_accounts_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `miles_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`loyaltyAccountId` int NOT NULL,
	`type` enum('earn','redeem','expire','bonus','adjustment') NOT NULL,
	`amount` int NOT NULL,
	`balanceAfter` int NOT NULL,
	`bookingId` int,
	`flightId` int,
	`description` text NOT NULL,
	`reason` text,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `miles_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `loyalty_accounts` (`userId`);--> statement-breakpoint
CREATE INDEX `tier_idx` ON `loyalty_accounts` (`tier`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `miles_transactions` (`userId`);--> statement-breakpoint
CREATE INDEX `loyalty_account_id_idx` ON `miles_transactions` (`loyaltyAccountId`);--> statement-breakpoint
CREATE INDEX `type_idx` ON `miles_transactions` (`type`);