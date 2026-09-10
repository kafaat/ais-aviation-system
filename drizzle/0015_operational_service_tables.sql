CREATE TABLE `apis_data` (
	`id` int AUTO_INCREMENT NOT NULL,
	`passenger_id` int NOT NULL,
	`booking_id` int NOT NULL,
	`document_type` enum('passport','national_id','visa') NOT NULL,
	`document_number` varchar(20) NOT NULL,
	`issuing_country` varchar(3) NOT NULL,
	`nationality` varchar(3) NOT NULL,
	`date_of_birth` date NOT NULL,
	`gender` enum('M','F','U') NOT NULL,
	`expiry_date` date NOT NULL,
	`given_names` varchar(100) NOT NULL,
	`surname` varchar(100) NOT NULL,
	`residence_country` varchar(3),
	`residence_address` varchar(500),
	`destination_address` varchar(500),
	`redress_number` varchar(20),
	`known_traveler_number` varchar(25),
	`status` enum('incomplete','complete','validated','submitted','rejected') NOT NULL DEFAULT 'incomplete',
	`validated_at` timestamp,
	`submitted_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `apis_data_id` PRIMARY KEY(`id`),
	CONSTRAINT `apis_data_passenger_unique` UNIQUE(`passenger_id`)
);
--> statement-breakpoint
CREATE TABLE `apis_requirements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`origin_country` varchar(3) NOT NULL,
	`destination_country` varchar(3) NOT NULL,
	`required_fields` text NOT NULL,
	`submission_deadline_minutes` int NOT NULL,
	`format` enum('paxlst','pnrgov') NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `apis_requirements_id` PRIMARY KEY(`id`),
	CONSTRAINT `apis_requirements_route_unique` UNIQUE(`origin_country`,`destination_country`)
);
--> statement-breakpoint
CREATE TABLE `apis_submissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flight_id` int NOT NULL,
	`destination_country` varchar(3) NOT NULL,
	`format` enum('paxlst','pnrgov') NOT NULL,
	`message_content` text NOT NULL,
	`submission_time` timestamp,
	`acknowledgment_time` timestamp,
	`status` enum('pending','submitted','acknowledged','rejected','error') NOT NULL DEFAULT 'pending',
	`response_message` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `apis_submissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `consent_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`consentVersion` varchar(20) NOT NULL,
	`essential` boolean NOT NULL DEFAULT true,
	`analytics` boolean NOT NULL DEFAULT false,
	`marketing` boolean NOT NULL DEFAULT false,
	`preferences` boolean NOT NULL DEFAULT false,
	`ipAddress` varchar(45),
	`userAgent` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `consent_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `emergency_hotel_bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`hotelId` int NOT NULL,
	`bookingId` int NOT NULL,
	`flightId` int NOT NULL,
	`passengerId` int NOT NULL,
	`roomType` enum('standard','suite') NOT NULL DEFAULT 'standard',
	`checkIn` datetime NOT NULL,
	`checkOut` datetime NOT NULL,
	`nightlyRate` int NOT NULL,
	`totalCost` int NOT NULL,
	`mealIncluded` boolean NOT NULL DEFAULT true,
	`transportIncluded` boolean NOT NULL DEFAULT false,
	`status` enum('reserved','checked_in','checked_out','cancelled','no_show') NOT NULL DEFAULT 'reserved',
	`confirmationNumber` varchar(20) NOT NULL,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emergency_hotel_bookings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `emergency_hotels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`airportId` int NOT NULL,
	`address` varchar(500) NOT NULL,
	`phone` varchar(50) NOT NULL,
	`email` varchar(255) NOT NULL,
	`starRating` int NOT NULL,
	`standardRate` int NOT NULL,
	`distanceKm` decimal(6,2) NOT NULL,
	`hasTransport` boolean NOT NULL DEFAULT false,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emergency_hotels_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kiosk_analytics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kioskId` int NOT NULL,
	`date` timestamp NOT NULL,
	`totalSessions` int NOT NULL DEFAULT 0,
	`completedSessions` int NOT NULL DEFAULT 0,
	`abandonedSessions` int NOT NULL DEFAULT 0,
	`avgSessionDurationSec` int NOT NULL DEFAULT 0,
	`boardingPassesPrinted` int NOT NULL DEFAULT 0,
	`bagTagsPrinted` int NOT NULL DEFAULT 0,
	`ancillaryRevenue` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `kiosk_analytics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kiosk_devices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kioskCode` varchar(20) NOT NULL,
	`airportId` int NOT NULL,
	`terminal` varchar(50) NOT NULL,
	`location` varchar(255) NOT NULL,
	`status` enum('online','offline','maintenance') NOT NULL DEFAULT 'online',
	`hardwareType` varchar(100),
	`hasPrinter` boolean NOT NULL DEFAULT true,
	`hasScanner` boolean NOT NULL DEFAULT true,
	`hasPayment` boolean NOT NULL DEFAULT false,
	`lastHeartbeat` timestamp,
	`installedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kiosk_devices_id` PRIMARY KEY(`id`),
	CONSTRAINT `kiosk_devices_kioskCode_unique` UNIQUE(`kioskCode`),
	CONSTRAINT `kiosk_devices_code_unique_idx` UNIQUE(`kioskCode`)
);
--> statement-breakpoint
CREATE TABLE `kiosk_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kioskId` int,
	`bookingId` int NOT NULL,
	`passengerId` int,
	`sessionType` enum('check_in','seat_change','bag_tag','ancillary') NOT NULL,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`status` enum('active','completed','abandoned','error') NOT NULL DEFAULT 'active',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `kiosk_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `apis_data_booking_idx` ON `apis_data` (`booking_id`);--> statement-breakpoint
CREATE INDEX `apis_submissions_flight_idx` ON `apis_submissions` (`flight_id`);--> statement-breakpoint
CREATE INDEX `consent_records_userId_idx` ON `consent_records` (`userId`);--> statement-breakpoint
CREATE INDEX `consent_records_version_idx` ON `consent_records` (`consentVersion`);--> statement-breakpoint
CREATE INDEX `ehb_hotel_idx` ON `emergency_hotel_bookings` (`hotelId`);--> statement-breakpoint
CREATE INDEX `ehb_booking_idx` ON `emergency_hotel_bookings` (`bookingId`);--> statement-breakpoint
CREATE INDEX `ehb_flight_idx` ON `emergency_hotel_bookings` (`flightId`);--> statement-breakpoint
CREATE INDEX `ehb_passenger_idx` ON `emergency_hotel_bookings` (`passengerId`);--> statement-breakpoint
CREATE INDEX `ehb_status_idx` ON `emergency_hotel_bookings` (`status`);--> statement-breakpoint
CREATE INDEX `ehb_confirmation_idx` ON `emergency_hotel_bookings` (`confirmationNumber`);--> statement-breakpoint
CREATE INDEX `eh_airport_idx` ON `emergency_hotels` (`airportId`);--> statement-breakpoint
CREATE INDEX `eh_active_idx` ON `emergency_hotels` (`isActive`);--> statement-breakpoint
CREATE INDEX `kiosk_analytics_kiosk_id_idx` ON `kiosk_analytics` (`kioskId`);--> statement-breakpoint
CREATE INDEX `kiosk_analytics_date_idx` ON `kiosk_analytics` (`date`);--> statement-breakpoint
CREATE INDEX `kiosk_analytics_kiosk_date_idx` ON `kiosk_analytics` (`kioskId`,`date`);--> statement-breakpoint
CREATE INDEX `kiosk_devices_airport_id_idx` ON `kiosk_devices` (`airportId`);--> statement-breakpoint
CREATE INDEX `kiosk_devices_status_idx` ON `kiosk_devices` (`status`);--> statement-breakpoint
CREATE INDEX `kiosk_devices_airport_status_idx` ON `kiosk_devices` (`airportId`,`status`);--> statement-breakpoint
CREATE INDEX `kiosk_sessions_kiosk_id_idx` ON `kiosk_sessions` (`kioskId`);--> statement-breakpoint
CREATE INDEX `kiosk_sessions_booking_id_idx` ON `kiosk_sessions` (`bookingId`);--> statement-breakpoint
CREATE INDEX `kiosk_sessions_status_idx` ON `kiosk_sessions` (`status`);--> statement-breakpoint
CREATE INDEX `kiosk_sessions_type_idx` ON `kiosk_sessions` (`sessionType`);--> statement-breakpoint
CREATE INDEX `kiosk_sessions_started_at_idx` ON `kiosk_sessions` (`startedAt`);