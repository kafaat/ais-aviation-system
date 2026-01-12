CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` varchar(64) NOT NULL,
	`eventType` varchar(100) NOT NULL,
	`eventCategory` enum('auth','booking','payment','user_management','flight_management','refund','modification','access','system') NOT NULL,
	`outcome` enum('success','failure','error') NOT NULL,
	`severity` enum('low','medium','high','critical') NOT NULL DEFAULT 'low',
	`userId` int,
	`userRole` varchar(50),
	`actorType` enum('user','admin','system','api') NOT NULL DEFAULT 'user',
	`sourceIp` varchar(45),
	`userAgent` text,
	`requestId` varchar(64),
	`resourceType` varchar(100),
	`resourceId` varchar(100),
	`previousValue` text,
	`newValue` text,
	`changeDescription` text,
	`metadata` text,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`),
	CONSTRAINT `audit_logs_eventId_unique` UNIQUE(`eventId`)
);
--> statement-breakpoint
CREATE TABLE `booking_status_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`bookingReference` varchar(6) NOT NULL,
	`previousStatus` enum('initiated','pending','reserved','paid','confirmed','checked_in','boarded','completed','cancelled','refunded','expired','payment_failed','no_show'),
	`newStatus` enum('initiated','pending','reserved','paid','confirmed','checked_in','boarded','completed','cancelled','refunded','expired','payment_failed','no_show') NOT NULL,
	`transitionReason` text,
	`isValidTransition` boolean NOT NULL DEFAULT true,
	`changedBy` int,
	`changedByRole` varchar(50),
	`actorType` enum('user','admin','system','payment_gateway') NOT NULL DEFAULT 'system',
	`paymentIntentId` varchar(255),
	`metadata` text,
	`transitionedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `booking_status_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `favorite_flights` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`originId` int NOT NULL,
	`destinationId` int NOT NULL,
	`airlineId` int,
	`cabinClass` enum('economy','business'),
	`enablePriceAlert` boolean NOT NULL DEFAULT false,
	`maxPrice` int,
	`lastAlertSent` timestamp,
	`emailNotifications` boolean NOT NULL DEFAULT true,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `favorite_flights_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `flight_reviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`flightId` int NOT NULL,
	`bookingId` int,
	`rating` int NOT NULL,
	`comfortRating` int,
	`serviceRating` int,
	`valueRating` int,
	`title` varchar(200),
	`comment` text,
	`helpfulCount` int NOT NULL DEFAULT 0,
	`isVerified` boolean NOT NULL DEFAULT false,
	`status` enum('pending','approved','rejected','hidden') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `flight_reviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `price_alert_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`favoriteFlightId` int NOT NULL,
	`flightId` int NOT NULL,
	`previousPrice` int NOT NULL,
	`newPrice` int NOT NULL,
	`priceChange` int NOT NULL,
	`alertSent` boolean NOT NULL DEFAULT false,
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `price_alert_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','super_admin','airline_admin','finance','ops','support') NOT NULL DEFAULT 'user';--> statement-breakpoint
CREATE INDEX `event_type_idx` ON `audit_logs` (`eventType`);--> statement-breakpoint
CREATE INDEX `event_category_idx` ON `audit_logs` (`eventCategory`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `audit_logs` (`userId`);--> statement-breakpoint
CREATE INDEX `resource_type_idx` ON `audit_logs` (`resourceType`);--> statement-breakpoint
CREATE INDEX `resource_id_idx` ON `audit_logs` (`resourceId`);--> statement-breakpoint
CREATE INDEX `timestamp_idx` ON `audit_logs` (`timestamp`);--> statement-breakpoint
CREATE INDEX `outcome_idx` ON `audit_logs` (`outcome`);--> statement-breakpoint
CREATE INDEX `severity_idx` ON `audit_logs` (`severity`);--> statement-breakpoint
CREATE INDEX `category_outcome_idx` ON `audit_logs` (`eventCategory`,`outcome`);--> statement-breakpoint
CREATE INDEX `booking_id_idx` ON `booking_status_history` (`bookingId`);--> statement-breakpoint
CREATE INDEX `booking_reference_idx` ON `booking_status_history` (`bookingReference`);--> statement-breakpoint
CREATE INDEX `new_status_idx` ON `booking_status_history` (`newStatus`);--> statement-breakpoint
CREATE INDEX `transitioned_at_idx` ON `booking_status_history` (`transitionedAt`);--> statement-breakpoint
CREATE INDEX `changed_by_idx` ON `booking_status_history` (`changedBy`);--> statement-breakpoint
CREATE INDEX `booking_status_idx` ON `booking_status_history` (`bookingId`,`newStatus`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `favorite_flights` (`userId`);--> statement-breakpoint
CREATE INDEX `route_idx` ON `favorite_flights` (`originId`,`destinationId`);--> statement-breakpoint
CREATE INDEX `airline_id_idx` ON `favorite_flights` (`airlineId`);--> statement-breakpoint
CREATE INDEX `price_alert_idx` ON `favorite_flights` (`enablePriceAlert`,`maxPrice`);--> statement-breakpoint
CREATE INDEX `user_route_favorite_unique` ON `favorite_flights` (`userId`,`originId`,`destinationId`,`airlineId`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `flight_reviews` (`userId`);--> statement-breakpoint
CREATE INDEX `flight_id_idx` ON `flight_reviews` (`flightId`);--> statement-breakpoint
CREATE INDEX `booking_id_idx` ON `flight_reviews` (`bookingId`);--> statement-breakpoint
CREATE INDEX `rating_idx` ON `flight_reviews` (`rating`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `flight_reviews` (`status`);--> statement-breakpoint
CREATE INDEX `user_flight_unique` ON `flight_reviews` (`userId`,`flightId`);--> statement-breakpoint
CREATE INDEX `favorite_flight_id_idx` ON `price_alert_history` (`favoriteFlightId`);--> statement-breakpoint
CREATE INDEX `flight_id_idx` ON `price_alert_history` (`flightId`);--> statement-breakpoint
CREATE INDEX `created_at_idx` ON `price_alert_history` (`createdAt`);