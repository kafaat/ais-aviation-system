ALTER TABLE `exchange_rates` ADD `sourceReference` varchar(255);--> statement-breakpoint
ALTER TABLE `exchange_rates` ADD `recordedBy` int;--> statement-breakpoint
ALTER TABLE `exchange_rates` ADD `version` int;--> statement-breakpoint
ALTER TABLE `exchange_rates` ADD `supersedesId` int;--> statement-breakpoint
ALTER TABLE `exchange_rates` ADD CONSTRAINT `exchange_rates_pair_version_idx` UNIQUE(`fromCurrency`,`toCurrency`,`version`);--> statement-breakpoint
ALTER TABLE `exchange_rates` ADD CONSTRAINT `exchange_rates_supersedes_idx` UNIQUE(`supersedesId`);