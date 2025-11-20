CREATE TABLE `ancillary_services` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(50) NOT NULL,
	`category` enum('baggage','meal','seat','insurance','lounge','priority_boarding') NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`price` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`available` boolean NOT NULL DEFAULT true,
	`applicableCabinClasses` text,
	`applicableAirlines` text,
	`icon` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ancillary_services_id` PRIMARY KEY(`id`),
	CONSTRAINT `ancillary_services_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `booking_ancillaries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`passengerId` int,
	`ancillaryServiceId` int NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`unitPrice` int NOT NULL,
	`totalPrice` int NOT NULL,
	`status` enum('active','cancelled','refunded') NOT NULL DEFAULT 'active',
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `booking_ancillaries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `category_idx` ON `ancillary_services` (`category`);--> statement-breakpoint
CREATE INDEX `available_idx` ON `ancillary_services` (`available`);--> statement-breakpoint
CREATE INDEX `booking_id_idx` ON `booking_ancillaries` (`bookingId`);--> statement-breakpoint
CREATE INDEX `passenger_id_idx` ON `booking_ancillaries` (`passengerId`);--> statement-breakpoint
CREATE INDEX `ancillary_service_id_idx` ON `booking_ancillaries` (`ancillaryServiceId`);