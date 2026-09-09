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
ALTER TABLE `mfa_settings` ADD `lastUsedStep` int;--> statement-breakpoint
ALTER TABLE `refresh_tokens` ADD `familyId` varchar(64);--> statement-breakpoint
ALTER TABLE `refresh_tokens` ADD `mfaVerified` boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `refresh_tokens_family_idx` ON `refresh_tokens` (`familyId`,`revokedAt`);