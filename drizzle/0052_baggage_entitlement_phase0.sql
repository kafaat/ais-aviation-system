ALTER TABLE `ancillary_services` ADD `weightGrams` int;--> statement-breakpoint
ALTER TABLE `booking_ancillaries` ADD `weightSnapshotGrams` int;--> statement-breakpoint
ALTER TABLE `booking_ancillaries` ADD `fundedAt` timestamp;--> statement-breakpoint
ALTER TABLE `booking_ancillaries` ADD `fundingReference` json;--> statement-breakpoint
ALTER TABLE `booking_ancillaries` ADD `segmentId` int;--> statement-breakpoint
ALTER TABLE `booking_ancillaries` ADD `scopeState` enum('unresolved','specific_segment','all_segments') DEFAULT 'unresolved' NOT NULL;--> statement-breakpoint
CREATE INDEX `baggage_entitlement_lookup_idx` ON `booking_ancillaries` (`bookingId`,`passengerId`,`status`,`fundedAt`);