ALTER TABLE `idempotency_requests` MODIFY COLUMN `expiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `booking_segments` ADD `inventoryLockId` int;--> statement-breakpoint
ALTER TABLE `booking_segments` ADD `seatsReserved` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `seat_holds` ADD `inventoryLockId` int;--> statement-breakpoint
ALTER TABLE `travel_agents` ADD `ownerUserId` int;