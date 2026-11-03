ALTER TABLE `baggage_custody_events` MODIFY COLUMN `stage` enum('acceptance','loading','transfer','arrival','unloading','return') NOT NULL;--> statement-breakpoint
ALTER TABLE `baggage_items` ADD `returnEvidenceId` int;--> statement-breakpoint
ALTER TABLE `baggage_items` ADD `replacesBaggageId` int;--> statement-breakpoint
ALTER TABLE `flights` ADD `dcsClosedAt` timestamp(3);--> statement-breakpoint
ALTER TABLE `flights` ADD `stationOffBlocksAt` timestamp(3);--> statement-breakpoint
ALTER TABLE `baggage_items` ADD CONSTRAINT `baggage_items_replacesBaggageId_unique` UNIQUE(`replacesBaggageId`);