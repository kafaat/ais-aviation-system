ALTER TABLE `emergency_hotel_bookings` MODIFY COLUMN `status` enum('reserved','checked_in','checked_out','cancelled','no_show','requested','pending_provider','outcome_unknown','confirmed','sandbox_confirmed','cancellation_pending','cancellation_unknown','rejected') NOT NULL DEFAULT 'reserved';--> statement-breakpoint
ALTER TABLE `emergency_hotel_bookings` MODIFY COLUMN `confirmationNumber` varchar(100);--> statement-breakpoint
ALTER TABLE `emergency_hotel_bookings` ADD `tenantId` int;--> statement-breakpoint
ALTER TABLE `emergency_hotel_bookings` ADD `requestKey` varchar(64);--> statement-breakpoint
ALTER TABLE `emergency_hotel_bookings` ADD `requestHash` varchar(64);--> statement-breakpoint
ALTER TABLE `emergency_hotel_bookings` ADD `requestReference` varchar(20);--> statement-breakpoint
ALTER TABLE `emergency_hotel_bookings` ADD `providerRequest` json;--> statement-breakpoint
ALTER TABLE `emergency_hotel_bookings` ADD `providerReceipt` json;--> statement-breakpoint
ALTER TABLE `emergency_hotel_bookings` ADD `providerLease` varchar(36);--> statement-breakpoint
ALTER TABLE `emergency_hotel_bookings` ADD `providerLeaseUntil` timestamp(3);--> statement-breakpoint
ALTER TABLE `emergency_hotel_bookings` ADD `providerNextAttemptAt` timestamp(3);--> statement-breakpoint
ALTER TABLE `emergency_hotel_bookings` ADD `providerLastError` varchar(255);--> statement-breakpoint
ALTER TABLE `emergency_hotel_bookings` ADD CONSTRAINT `emergency_hotel_bookings_requestKey_unique` UNIQUE(`requestKey`);--> statement-breakpoint
ALTER TABLE `emergency_hotel_bookings` ADD CONSTRAINT `emergency_hotel_bookings_requestReference_unique` UNIQUE(`requestReference`);