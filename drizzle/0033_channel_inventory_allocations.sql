ALTER TABLE `group_bookings` ADD `organizerUserId` int;--> statement-breakpoint
ALTER TABLE `group_bookings` ADD `inventoryLockId` int;--> statement-breakpoint
ALTER TABLE `group_bookings` ADD `bookingId` int;--> statement-breakpoint
ALTER TABLE `group_bookings` ADD `allocationExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `waitlist` ADD `inventoryLockId` int;