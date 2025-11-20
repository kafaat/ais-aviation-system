CREATE TABLE `inventory_locks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightId` int NOT NULL,
	`numberOfSeats` int NOT NULL,
	`cabinClass` enum('economy','business') NOT NULL,
	`userId` int,
	`sessionId` varchar(64) NOT NULL,
	`status` enum('active','released','expired','converted') NOT NULL DEFAULT 'active',
	`lockedAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	`releasedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `inventory_locks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `flight_id_idx` ON `inventory_locks` (`flightId`);--> statement-breakpoint
CREATE INDEX `session_id_idx` ON `inventory_locks` (`sessionId`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `inventory_locks` (`status`);--> statement-breakpoint
CREATE INDEX `expires_at_idx` ON `inventory_locks` (`expiresAt`);