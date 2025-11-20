CREATE TABLE `airlines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(3) NOT NULL,
	`name` varchar(255) NOT NULL,
	`country` varchar(100),
	`logo` text,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `airlines_id` PRIMARY KEY(`id`),
	CONSTRAINT `airlines_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `airports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(3) NOT NULL,
	`name` varchar(255) NOT NULL,
	`city` varchar(100) NOT NULL,
	`country` varchar(100) NOT NULL,
	`timezone` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `airports_id` PRIMARY KEY(`id`),
	CONSTRAINT `airports_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`flightId` int NOT NULL,
	`bookingReference` varchar(6) NOT NULL,
	`pnr` varchar(6) NOT NULL,
	`status` enum('pending','confirmed','cancelled','completed') NOT NULL DEFAULT 'pending',
	`totalAmount` int NOT NULL,
	`paymentStatus` enum('pending','paid','refunded','failed') NOT NULL DEFAULT 'pending',
	`cabinClass` enum('economy','business') NOT NULL,
	`numberOfPassengers` int NOT NULL,
	`checkedIn` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bookings_id` PRIMARY KEY(`id`),
	CONSTRAINT `bookings_bookingReference_unique` UNIQUE(`bookingReference`),
	CONSTRAINT `bookings_pnr_unique` UNIQUE(`pnr`)
);
--> statement-breakpoint
CREATE TABLE `flights` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightNumber` varchar(10) NOT NULL,
	`airlineId` int NOT NULL,
	`originId` int NOT NULL,
	`destinationId` int NOT NULL,
	`departureTime` timestamp NOT NULL,
	`arrivalTime` timestamp NOT NULL,
	`aircraftType` varchar(50),
	`status` enum('scheduled','delayed','cancelled','completed') NOT NULL DEFAULT 'scheduled',
	`economySeats` int NOT NULL,
	`businessSeats` int NOT NULL,
	`economyPrice` int NOT NULL,
	`businessPrice` int NOT NULL,
	`economyAvailable` int NOT NULL,
	`businessAvailable` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `flights_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `passengers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`type` enum('adult','child','infant') NOT NULL DEFAULT 'adult',
	`title` varchar(10),
	`firstName` varchar(100) NOT NULL,
	`lastName` varchar(100) NOT NULL,
	`dateOfBirth` timestamp,
	`passportNumber` varchar(20),
	`nationality` varchar(3),
	`seatNumber` varchar(5),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `passengers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`amount` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`method` enum('card','wallet','bank_transfer') NOT NULL,
	`status` enum('pending','completed','failed','refunded') NOT NULL DEFAULT 'pending',
	`transactionId` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `bookings` (`userId`);--> statement-breakpoint
CREATE INDEX `pnr_idx` ON `bookings` (`pnr`);--> statement-breakpoint
CREATE INDEX `flight_number_idx` ON `flights` (`flightNumber`);--> statement-breakpoint
CREATE INDEX `departure_time_idx` ON `flights` (`departureTime`);--> statement-breakpoint
CREATE INDEX `route_idx` ON `flights` (`originId`,`destinationId`);--> statement-breakpoint
CREATE INDEX `booking_id_idx` ON `passengers` (`bookingId`);--> statement-breakpoint
CREATE INDEX `booking_id_idx` ON `payments` (`bookingId`);