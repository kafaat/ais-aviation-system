CREATE TABLE `exchange_rates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`base_currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`target_currency` varchar(3) NOT NULL,
	`rate` decimal(10,6) NOT NULL,
	`source` varchar(100),
	`last_updated` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `exchange_rates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_currency_preferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`preferred_currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_currency_preferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_currency_preferences_user_id_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE INDEX `currency_pair_idx` ON `exchange_rates` (`base_currency`,`target_currency`);--> statement-breakpoint
CREATE INDEX `target_currency_idx` ON `exchange_rates` (`target_currency`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `user_currency_preferences` (`user_id`);