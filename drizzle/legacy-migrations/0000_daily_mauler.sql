CREATE TABLE `account_deletion_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`status` enum('pending','processing','completed','cancelled','failed') NOT NULL DEFAULT 'pending',
	`deletionType` enum('full','anonymize') NOT NULL DEFAULT 'anonymize',
	`reason` text,
	`ipAddress` varchar(45),
	`userAgent` text,
	`confirmationToken` varchar(64),
	`confirmedAt` timestamp,
	`dataAnonymizedAt` timestamp,
	`errorMessage` text,
	`scheduledDeletionAt` timestamp,
	`requestedAt` timestamp NOT NULL DEFAULT (now()),
	`processedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `account_deletion_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agent_bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`bookingId` int NOT NULL,
	`commissionRate` decimal(5,2) NOT NULL,
	`commissionAmount` int NOT NULL,
	`bookingAmount` int NOT NULL,
	`commissionStatus` enum('pending','approved','paid','cancelled') NOT NULL DEFAULT 'pending',
	`commissionPaidAt` timestamp,
	`externalReference` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_bookings_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_bookings_bookingId_unique` UNIQUE(`bookingId`)
);
--> statement-breakpoint
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
CREATE TABLE `airport_gates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airportId` int NOT NULL,
	`gateNumber` varchar(10) NOT NULL,
	`terminal` varchar(50),
	`type` enum('domestic','international','both') NOT NULL DEFAULT 'both',
	`status` enum('available','occupied','maintenance') NOT NULL DEFAULT 'available',
	`capacity` varchar(50),
	`amenities` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `airport_gates_id` PRIMARY KEY(`id`)
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
CREATE TABLE `baggage_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`passengerId` int NOT NULL,
	`tagNumber` varchar(20) NOT NULL,
	`weight` decimal(5,2) NOT NULL,
	`status` enum('checked_in','security_screening','loading','in_transit','arrived','customs','ready_for_pickup','claimed','lost','found','damaged') NOT NULL DEFAULT 'checked_in',
	`lastLocation` varchar(255),
	`description` text,
	`specialHandling` text,
	`lostReportedAt` timestamp,
	`lostDescription` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `baggage_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `baggage_items_tagNumber_unique` UNIQUE(`tagNumber`)
);
--> statement-breakpoint
CREATE TABLE `baggage_tracking` (
	`id` int AUTO_INCREMENT NOT NULL,
	`baggageId` int NOT NULL,
	`location` varchar(255) NOT NULL,
	`status` enum('checked_in','security_screening','loading','in_transit','arrived','customs','ready_for_pickup','claimed','lost','found','damaged') NOT NULL,
	`scannedAt` timestamp NOT NULL DEFAULT (now()),
	`scannedBy` int,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `baggage_tracking_id` PRIMARY KEY(`id`)
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
CREATE TABLE `booking_modifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`userId` int NOT NULL,
	`modificationType` enum('change_date','upgrade_cabin','change_flight','add_services') NOT NULL,
	`originalFlightId` int,
	`originalCabinClass` enum('economy','business'),
	`originalAmount` int NOT NULL,
	`newFlightId` int,
	`newCabinClass` enum('economy','business'),
	`newAmount` int NOT NULL,
	`priceDifference` int NOT NULL,
	`modificationFee` int NOT NULL DEFAULT 0,
	`totalCost` int NOT NULL,
	`status` enum('pending','approved','rejected','completed') NOT NULL DEFAULT 'pending',
	`stripePaymentIntentId` varchar(255),
	`paymentStatus` enum('pending','paid','refunded') DEFAULT 'pending',
	`reason` text,
	`adminNotes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	CONSTRAINT `booking_modifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `booking_segments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`segmentOrder` int NOT NULL,
	`flightId` int NOT NULL,
	`departureDate` timestamp NOT NULL,
	`status` enum('pending','confirmed','cancelled','completed') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `booking_segments_id` PRIMARY KEY(`id`)
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
CREATE TABLE `bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`flightId` int NOT NULL,
	`bookingReference` varchar(6) NOT NULL,
	`pnr` varchar(6) NOT NULL,
	`status` enum('pending','confirmed','cancelled','completed') NOT NULL DEFAULT 'pending',
	`totalAmount` int NOT NULL,
	`paymentStatus` enum('pending','paid','refunded','failed') NOT NULL DEFAULT 'pending',
	`stripePaymentIntentId` varchar(255),
	`stripeCheckoutSessionId` varchar(255),
	`idempotencyKey` varchar(255),
	`cabinClass` enum('economy','business') NOT NULL,
	`numberOfPassengers` int NOT NULL DEFAULT 1,
	`checkedIn` boolean NOT NULL DEFAULT false,
	`checkInReminderSentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bookings_id` PRIMARY KEY(`id`),
	CONSTRAINT `bookings_bookingReference_unique` UNIQUE(`bookingReference`),
	CONSTRAINT `bookings_pnr_unique` UNIQUE(`pnr`),
	CONSTRAINT `bookings_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `consent_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`consentType` varchar(50) NOT NULL,
	`previousValue` boolean,
	`newValue` boolean NOT NULL,
	`ipAddress` varchar(45),
	`userAgent` text,
	`consentVersion` varchar(20) NOT NULL,
	`changeReason` enum('user_update','initial_consent','withdrawal','account_deletion','system_update') NOT NULL DEFAULT 'user_update',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `consent_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `corporate_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`companyName` varchar(255) NOT NULL,
	`taxId` varchar(50) NOT NULL,
	`address` text,
	`contactName` varchar(255) NOT NULL,
	`contactEmail` varchar(320) NOT NULL,
	`contactPhone` varchar(20),
	`creditLimit` int NOT NULL DEFAULT 0,
	`balance` int NOT NULL DEFAULT 0,
	`discountPercent` decimal(5,2) NOT NULL DEFAULT '0.00',
	`status` enum('pending','active','suspended','closed') NOT NULL DEFAULT 'pending',
	`approvedBy` int,
	`approvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `corporate_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `corporate_accounts_taxId_unique` UNIQUE(`taxId`)
);
--> statement-breakpoint
CREATE TABLE `corporate_bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`corporateAccountId` int NOT NULL,
	`bookingId` int NOT NULL,
	`costCenter` varchar(50),
	`projectCode` varchar(50),
	`travelPurpose` text,
	`approvalStatus` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`approvedBy` int,
	`approvedAt` timestamp,
	`rejectionReason` text,
	`bookedByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `corporate_bookings_id` PRIMARY KEY(`id`),
	CONSTRAINT `corporate_bookings_bookingId_unique` UNIQUE(`bookingId`)
);
--> statement-breakpoint
CREATE TABLE `corporate_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`corporateAccountId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('admin','booker','traveler') NOT NULL DEFAULT 'traveler',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `corporate_users_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `credit_usage` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userCreditId` int NOT NULL,
	`userId` int NOT NULL,
	`bookingId` int NOT NULL,
	`amountUsed` int NOT NULL,
	`usedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `credit_usage_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `currencies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(3) NOT NULL,
	`name` varchar(100) NOT NULL,
	`nameAr` varchar(100),
	`symbol` varchar(10) NOT NULL,
	`decimalPlaces` int NOT NULL DEFAULT 2,
	`symbolPosition` enum('before','after') NOT NULL DEFAULT 'before',
	`thousandsSeparator` varchar(1) DEFAULT ',',
	`decimalSeparator` varchar(1) DEFAULT '.',
	`isActive` boolean NOT NULL DEFAULT true,
	`isBaseCurrency` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `currencies_id` PRIMARY KEY(`id`),
	CONSTRAINT `currencies_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `data_export_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`status` enum('pending','processing','completed','failed','expired') NOT NULL DEFAULT 'pending',
	`format` enum('json','csv') NOT NULL DEFAULT 'json',
	`downloadUrl` text,
	`downloadExpiresAt` timestamp,
	`fileSizeBytes` int,
	`ipAddress` varchar(45),
	`userAgent` text,
	`errorMessage` text,
	`requestedAt` timestamp NOT NULL DEFAULT (now()),
	`processedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `data_export_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `denied_boarding_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightId` int NOT NULL,
	`bookingId` int NOT NULL,
	`userId` int NOT NULL,
	`type` enum('voluntary','involuntary') NOT NULL,
	`compensationAmount` int NOT NULL,
	`compensationCurrency` varchar(3) NOT NULL DEFAULT 'SAR',
	`compensationType` enum('cash','voucher','miles') NOT NULL,
	`alternativeFlightId` int,
	`status` enum('pending','accepted','rejected','completed') NOT NULL DEFAULT 'pending',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `denied_boarding_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `exchange_rates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fromCurrency` varchar(3) NOT NULL,
	`toCurrency` varchar(3) NOT NULL,
	`rate` decimal(18,8) NOT NULL,
	`source` varchar(100),
	`validFrom` timestamp NOT NULL DEFAULT (now()),
	`validTo` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `exchange_rates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `family_group_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('owner','member') NOT NULL DEFAULT 'member',
	`milesContributed` int NOT NULL DEFAULT 0,
	`milesRedeemed` int NOT NULL DEFAULT 0,
	`status` enum('active','invited','removed') NOT NULL DEFAULT 'active',
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `family_group_members_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `family_groups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`ownerId` int NOT NULL,
	`pooledMiles` int NOT NULL DEFAULT 0,
	`maxMembers` int NOT NULL DEFAULT 6,
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `family_groups_id` PRIMARY KEY(`id`)
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
CREATE TABLE `financial_ledger` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int,
	`userId` int,
	`type` enum('charge','refund','partial_refund','fee','adjustment') NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`stripeEventId` varchar(255),
	`stripePaymentIntentId` varchar(255),
	`stripeChargeId` varchar(255),
	`stripeRefundId` varchar(255),
	`description` text,
	`metadata` text,
	`balanceBefore` decimal(10,2),
	`balanceAfter` decimal(10,2),
	`transactionDate` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `financial_ledger_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `flight_disruptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightId` int NOT NULL,
	`type` enum('delay','cancellation','diversion') NOT NULL,
	`reason` varchar(500) NOT NULL,
	`severity` enum('minor','moderate','severe') NOT NULL,
	`originalDepartureTime` timestamp,
	`newDepartureTime` timestamp,
	`delayMinutes` int,
	`status` enum('active','resolved','cancelled') NOT NULL DEFAULT 'active',
	`createdBy` int,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `flight_disruptions_id` PRIMARY KEY(`id`)
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
CREATE TABLE `flight_status_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightId` int NOT NULL,
	`oldStatus` enum('scheduled','delayed','cancelled','completed'),
	`newStatus` enum('scheduled','delayed','cancelled','completed') NOT NULL,
	`delayMinutes` int,
	`reason` text,
	`changedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `flight_status_history_id` PRIMARY KEY(`id`)
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
CREATE TABLE `gate_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightId` int NOT NULL,
	`gateId` int NOT NULL,
	`assignedAt` timestamp NOT NULL DEFAULT (now()),
	`boardingStartTime` timestamp,
	`boardingEndTime` timestamp,
	`status` enum('assigned','boarding','departed','cancelled','changed') NOT NULL DEFAULT 'assigned',
	`assignedBy` int,
	`previousGateId` int,
	`changeReason` text,
	`notificationSentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gate_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `group_bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizerName` varchar(255) NOT NULL,
	`organizerEmail` varchar(320) NOT NULL,
	`organizerPhone` varchar(20) NOT NULL,
	`groupSize` int NOT NULL,
	`flightId` int NOT NULL,
	`status` enum('pending','confirmed','cancelled') NOT NULL DEFAULT 'pending',
	`discountPercent` decimal(5,2),
	`totalPrice` int,
	`notes` text,
	`rejectionReason` text,
	`approvedBy` int,
	`approvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `group_bookings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `idempotency_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scope` varchar(100) NOT NULL,
	`idempotencyKey` varchar(255) NOT NULL,
	`userId` int,
	`requestHash` varchar(64) NOT NULL,
	`status` enum('STARTED','COMPLETED','FAILED') NOT NULL DEFAULT 'STARTED',
	`responseJson` text,
	`errorMessage` text,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `idempotency_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
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
CREATE TABLE `inventory_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightId` int NOT NULL,
	`snapshotDate` timestamp NOT NULL,
	`economyTotal` int NOT NULL,
	`economySold` int NOT NULL,
	`economyHeld` int NOT NULL,
	`economyAvailable` int NOT NULL,
	`economyWaitlist` int NOT NULL,
	`businessTotal` int NOT NULL,
	`businessSold` int NOT NULL,
	`businessHeld` int NOT NULL,
	`businessAvailable` int NOT NULL,
	`businessWaitlist` int NOT NULL,
	`economyPrice` int NOT NULL,
	`businessPrice` int NOT NULL,
	`daysUntilDeparture` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inventory_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `loyalty_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`totalMilesEarned` int NOT NULL DEFAULT 0,
	`currentMilesBalance` int NOT NULL DEFAULT 0,
	`milesRedeemed` int NOT NULL DEFAULT 0,
	`tier` enum('bronze','silver','gold','platinum') NOT NULL DEFAULT 'bronze',
	`tierPoints` int NOT NULL DEFAULT 0,
	`memberSince` timestamp NOT NULL DEFAULT (now()),
	`lastActivityAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `loyalty_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `loyalty_accounts_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `miles_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`loyaltyAccountId` int NOT NULL,
	`type` enum('earn','redeem','expire','bonus','adjustment') NOT NULL,
	`amount` int NOT NULL,
	`balanceAfter` int NOT NULL,
	`bookingId` int,
	`flightId` int,
	`description` text NOT NULL,
	`reason` text,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `miles_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('booking','flight','payment','promo','system') NOT NULL,
	`title` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`data` text,
	`isRead` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`readAt` timestamp,
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `overbooking_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airlineId` int,
	`originId` int,
	`destinationId` int,
	`economyRate` decimal(5,4) NOT NULL DEFAULT '0.05',
	`businessRate` decimal(5,4) NOT NULL DEFAULT '0.02',
	`maxOverbooking` int NOT NULL DEFAULT 10,
	`historicalNoShowRate` decimal(5,4),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `overbooking_config_id` PRIMARY KEY(`id`)
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
	`ticketNumber` varchar(13),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `passengers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payment_splits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`payerEmail` varchar(320) NOT NULL,
	`payerName` varchar(255) NOT NULL,
	`amount` int NOT NULL,
	`percentage` decimal(5,2) NOT NULL,
	`status` enum('pending','email_sent','paid','failed','cancelled','expired') NOT NULL DEFAULT 'pending',
	`stripePaymentIntentId` varchar(255),
	`stripeCheckoutSessionId` varchar(255),
	`paymentToken` varchar(64) NOT NULL,
	`paidAt` timestamp,
	`emailSentAt` timestamp,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payment_splits_id` PRIMARY KEY(`id`),
	CONSTRAINT `payment_splits_paymentToken_unique` UNIQUE(`paymentToken`)
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
	`idempotencyKey` varchar(100),
	`stripePaymentIntentId` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `payments_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
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
CREATE TABLE `price_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`originId` int NOT NULL,
	`destinationId` int NOT NULL,
	`targetPrice` int NOT NULL,
	`currentPrice` int,
	`isActive` boolean NOT NULL DEFAULT true,
	`lastChecked` timestamp,
	`notifiedAt` timestamp,
	`cabinClass` enum('economy','business') NOT NULL DEFAULT 'economy',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `price_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `price_locks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`flightId` int NOT NULL,
	`cabinClass` enum('economy','business') NOT NULL,
	`lockedPrice` int NOT NULL,
	`originalPrice` int NOT NULL,
	`lockFee` int NOT NULL DEFAULT 0,
	`status` enum('active','used','expired','cancelled') NOT NULL DEFAULT 'active',
	`bookingId` int,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `price_locks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pricing_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightId` int NOT NULL,
	`cabinClass` enum('economy','business') NOT NULL,
	`basePrice` int NOT NULL,
	`finalPrice` int NOT NULL,
	`totalMultiplier` decimal(10,4) NOT NULL,
	`appliedRules` text NOT NULL,
	`occupancyRate` decimal(5,4),
	`daysUntilDeparture` int,
	`demandScore` decimal(5,2),
	`bookingId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pricing_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pricing_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`ruleType` enum('demand_multiplier','time_based','seasonal','route_specific','cabin_class','advance_purchase','load_factor') NOT NULL,
	`airlineId` int,
	`originId` int,
	`destinationId` int,
	`cabinClass` enum('economy','business'),
	`parameters` text NOT NULL,
	`priority` int NOT NULL DEFAULT 0,
	`validFrom` timestamp,
	`validTo` timestamp,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pricing_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`token` varchar(500) NOT NULL,
	`deviceInfo` text,
	`ipAddress` varchar(45),
	`expiresAt` timestamp NOT NULL,
	`revokedAt` timestamp,
	`lastUsedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `refresh_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `refresh_tokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `saved_passengers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`firstName` varchar(100) NOT NULL,
	`lastName` varchar(100) NOT NULL,
	`dateOfBirth` timestamp,
	`nationality` varchar(100),
	`passportNumber` varchar(50),
	`passportExpiry` timestamp,
	`email` varchar(320),
	`phone` varchar(20),
	`isDefault` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `saved_passengers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `seasonal_pricing` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`nameAr` varchar(255),
	`startDate` timestamp NOT NULL,
	`endDate` timestamp NOT NULL,
	`multiplier` decimal(5,2) NOT NULL,
	`airlineId` int,
	`originId` int,
	`destinationId` int,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `seasonal_pricing_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `seat_holds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightId` int NOT NULL,
	`cabinClass` enum('economy','business') NOT NULL,
	`seats` int NOT NULL,
	`userId` int,
	`sessionId` varchar(255) NOT NULL,
	`status` enum('active','converted','expired','released') NOT NULL DEFAULT 'active',
	`expiresAt` timestamp NOT NULL,
	`bookingId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `seat_holds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sms_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`phoneNumber` varchar(20) NOT NULL,
	`message` text NOT NULL,
	`type` enum('booking_confirmation','flight_reminder','flight_status','boarding_pass','check_in_reminder','payment_received','refund_processed','loyalty_update','promotional','system') NOT NULL,
	`status` enum('pending','sent','delivered','failed','rejected') NOT NULL DEFAULT 'pending',
	`provider` varchar(50) NOT NULL,
	`providerMessageId` varchar(128),
	`errorMessage` text,
	`retryCount` int NOT NULL DEFAULT 0,
	`bookingId` int,
	`flightId` int,
	`templateId` varchar(64),
	`sentAt` timestamp,
	`deliveredAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sms_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `special_services` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`passengerId` int NOT NULL,
	`serviceType` enum('meal','wheelchair','unaccompanied_minor','extra_legroom','pet_in_cabin','medical_assistance') NOT NULL,
	`serviceCode` varchar(20) NOT NULL,
	`details` text,
	`status` enum('pending','confirmed','rejected','cancelled') NOT NULL DEFAULT 'pending',
	`adminNotes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `special_services_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stripe_events` (
	`id` varchar(255) NOT NULL,
	`type` varchar(100) NOT NULL,
	`apiVersion` varchar(20),
	`data` text NOT NULL,
	`processed` boolean NOT NULL DEFAULT false,
	`processedAt` timestamp,
	`error` text,
	`retryCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stripe_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `travel_agents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agencyName` varchar(255) NOT NULL,
	`iataNumber` varchar(20) NOT NULL,
	`contactName` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(50) NOT NULL,
	`commissionRate` decimal(5,2) NOT NULL DEFAULT '5.00',
	`apiKey` varchar(64) NOT NULL,
	`apiSecret` varchar(128) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`dailyBookingLimit` int NOT NULL DEFAULT 100,
	`monthlyBookingLimit` int NOT NULL DEFAULT 2000,
	`totalBookings` int NOT NULL DEFAULT 0,
	`totalRevenue` int NOT NULL DEFAULT 0,
	`totalCommission` int NOT NULL DEFAULT 0,
	`lastActiveAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `travel_agents_id` PRIMARY KEY(`id`),
	CONSTRAINT `travel_agents_iataNumber_unique` UNIQUE(`iataNumber`),
	CONSTRAINT `travel_agents_email_unique` UNIQUE(`email`),
	CONSTRAINT `travel_agents_apiKey_unique` UNIQUE(`apiKey`)
);
--> statement-breakpoint
CREATE TABLE `user_consents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`marketingEmails` boolean NOT NULL DEFAULT false,
	`marketingSms` boolean NOT NULL DEFAULT false,
	`marketingPush` boolean NOT NULL DEFAULT false,
	`analyticsTracking` boolean NOT NULL DEFAULT false,
	`performanceCookies` boolean NOT NULL DEFAULT false,
	`thirdPartySharing` boolean NOT NULL DEFAULT false,
	`partnerOffers` boolean NOT NULL DEFAULT false,
	`essentialCookies` boolean NOT NULL DEFAULT true,
	`personalizedAds` boolean NOT NULL DEFAULT false,
	`personalizedContent` boolean NOT NULL DEFAULT false,
	`consentVersion` varchar(20) NOT NULL DEFAULT '1.0',
	`ipAddressAtConsent` varchar(45),
	`userAgentAtConsent` text,
	`consentGivenAt` timestamp NOT NULL DEFAULT (now()),
	`lastUpdatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_consents_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_consents_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `user_credits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`amount` int NOT NULL,
	`source` enum('refund','promo','compensation','bonus') NOT NULL,
	`description` text,
	`expiresAt` timestamp,
	`usedAmount` int NOT NULL DEFAULT 0,
	`bookingId` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_credits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_flight_favorites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`flightId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_flight_favorites_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`preferredSeatType` enum('window','aisle','middle'),
	`preferredCabinClass` enum('economy','business','first'),
	`mealPreference` enum('regular','vegetarian','vegan','halal','kosher','gluten_free'),
	`wheelchairAssistance` boolean DEFAULT false,
	`extraLegroom` boolean DEFAULT false,
	`passportNumber` varchar(50),
	`passportExpiry` timestamp,
	`nationality` varchar(100),
	`phoneNumber` varchar(20),
	`emergencyContact` varchar(100),
	`emergencyPhone` varchar(20),
	`emailNotifications` boolean DEFAULT true,
	`smsNotifications` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_preferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_preferences_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin','super_admin','airline_admin','finance','ops','support') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE TABLE `voucher_usage` (
	`id` int AUTO_INCREMENT NOT NULL,
	`voucherId` int NOT NULL,
	`userId` int NOT NULL,
	`bookingId` int NOT NULL,
	`discountApplied` int NOT NULL,
	`usedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `voucher_usage_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vouchers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(50) NOT NULL,
	`type` enum('fixed','percentage') NOT NULL,
	`value` int NOT NULL,
	`minPurchase` int NOT NULL DEFAULT 0,
	`maxDiscount` int,
	`maxUses` int,
	`usedCount` int NOT NULL DEFAULT 0,
	`validFrom` timestamp NOT NULL,
	`validUntil` timestamp NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`description` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vouchers_id` PRIMARY KEY(`id`),
	CONSTRAINT `vouchers_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `waitlist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightId` int NOT NULL,
	`cabinClass` enum('economy','business') NOT NULL,
	`userId` int NOT NULL,
	`seats` int NOT NULL,
	`priority` int NOT NULL,
	`status` enum('waiting','offered','confirmed','expired','cancelled') NOT NULL DEFAULT 'waiting',
	`offeredAt` timestamp,
	`offerExpiresAt` timestamp,
	`confirmedAt` timestamp,
	`notifyByEmail` boolean NOT NULL DEFAULT true,
	`notifyBySms` boolean NOT NULL DEFAULT false,
	`bookingId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `waitlist_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wallet_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`walletId` int NOT NULL,
	`userId` int NOT NULL,
	`type` enum('top_up','payment','refund','bonus','withdrawal') NOT NULL,
	`amount` int NOT NULL,
	`balanceAfter` int NOT NULL,
	`description` varchar(500) NOT NULL,
	`bookingId` int,
	`stripePaymentIntentId` varchar(255),
	`status` enum('completed','pending','failed') NOT NULL DEFAULT 'completed',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wallet_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`balance` int NOT NULL DEFAULT 0,
	`currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`status` enum('active','frozen','closed') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `wallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `wallets_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `booking_suggestions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`messageId` int,
	`flightId` int NOT NULL,
	`cabinClass` enum('economy','business') NOT NULL,
	`pricePerPerson` int NOT NULL,
	`totalPrice` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`reason` text,
	`rank` int NOT NULL DEFAULT 1,
	`score` int,
	`selected` enum('pending','selected','rejected','expired') NOT NULL DEFAULT 'pending',
	`selectedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp,
	CONSTRAINT `booking_suggestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`status` enum('active','completed','archived','expired') NOT NULL DEFAULT 'active',
	`context` json,
	`bookingId` int,
	`messageCount` int NOT NULL DEFAULT 0,
	`lastMessageAt` timestamp,
	`sessionId` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chat_conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`role` enum('user','assistant','system') NOT NULL,
	`content` text NOT NULL,
	`metadata` json,
	`tokensUsed` int,
	`processingTimeMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_reviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`bookingId` int,
	`flightId` int,
	`overallRating` int NOT NULL,
	`comfortRating` int,
	`serviceRating` int,
	`valueRating` int,
	`punctualityRating` int,
	`title` varchar(255),
	`content` text,
	`images` json,
	`isVerified` enum('pending','verified','rejected') NOT NULL DEFAULT 'pending',
	`moderationStatus` enum('pending','approved','rejected','flagged') NOT NULL DEFAULT 'pending',
	`moderationNotes` text,
	`helpfulCount` int NOT NULL DEFAULT 0,
	`reportCount` int NOT NULL DEFAULT 0,
	`responseContent` text,
	`responseAt` timestamp,
	`respondedBy` int,
	`language` varchar(5) NOT NULL DEFAULT 'ar',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_reviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notification_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('booking_confirmation','flight_status','check_in_reminder','price_alert','loyalty_update','refund_status','promotional','system') NOT NULL,
	`channel` enum('email','sms','push','in_app') NOT NULL,
	`recipientAddress` varchar(320),
	`subject` varchar(255),
	`content` text,
	`templateId` varchar(64),
	`status` enum('queued','sent','delivered','failed','bounced','opened','clicked') NOT NULL DEFAULT 'queued',
	`scheduledAt` timestamp,
	`sentAt` timestamp,
	`deliveredAt` timestamp,
	`errorMessage` text,
	`retryCount` int NOT NULL DEFAULT 0,
	`bookingId` int,
	`flightId` int,
	`providerMessageId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notification_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `review_helpful_votes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reviewId` int NOT NULL,
	`userId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `review_helpful_votes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `account_deletion_requests_user_id_idx` ON `account_deletion_requests` (`userId`);--> statement-breakpoint
CREATE INDEX `account_deletion_requests_status_idx` ON `account_deletion_requests` (`status`);--> statement-breakpoint
CREATE INDEX `account_deletion_requests_scheduled_idx` ON `account_deletion_requests` (`scheduledDeletionAt`);--> statement-breakpoint
CREATE INDEX `agent_bookings_agent_id_idx` ON `agent_bookings` (`agentId`);--> statement-breakpoint
CREATE INDEX `agent_bookings_booking_id_idx` ON `agent_bookings` (`bookingId`);--> statement-breakpoint
CREATE INDEX `agent_bookings_commission_status_idx` ON `agent_bookings` (`commissionStatus`);--> statement-breakpoint
CREATE INDEX `agent_bookings_created_at_idx` ON `agent_bookings` (`createdAt`);--> statement-breakpoint
CREATE INDEX `agent_bookings_agent_commission_idx` ON `agent_bookings` (`agentId`,`commissionStatus`);--> statement-breakpoint
CREATE INDEX `airlines_active_idx` ON `airlines` (`active`);--> statement-breakpoint
CREATE INDEX `airlines_country_idx` ON `airlines` (`country`);--> statement-breakpoint
CREATE INDEX `airlines_active_country_idx` ON `airlines` (`active`,`country`);--> statement-breakpoint
CREATE INDEX `airport_gates_airport_id_idx` ON `airport_gates` (`airportId`);--> statement-breakpoint
CREATE INDEX `airport_gates_gate_number_idx` ON `airport_gates` (`gateNumber`);--> statement-breakpoint
CREATE INDEX `airport_gates_status_idx` ON `airport_gates` (`status`);--> statement-breakpoint
CREATE INDEX `airport_gates_type_idx` ON `airport_gates` (`type`);--> statement-breakpoint
CREATE INDEX `airport_gates_airport_status_idx` ON `airport_gates` (`airportId`,`status`);--> statement-breakpoint
CREATE INDEX `airport_gates_airport_type_idx` ON `airport_gates` (`airportId`,`type`);--> statement-breakpoint
CREATE INDEX `airport_gates_airport_gate_unique_idx` ON `airport_gates` (`airportId`,`gateNumber`);--> statement-breakpoint
CREATE INDEX `airports_city_idx` ON `airports` (`city`);--> statement-breakpoint
CREATE INDEX `airports_country_idx` ON `airports` (`country`);--> statement-breakpoint
CREATE INDEX `airports_country_city_idx` ON `airports` (`country`,`city`);--> statement-breakpoint
CREATE INDEX `category_idx` ON `ancillary_services` (`category`);--> statement-breakpoint
CREATE INDEX `available_idx` ON `ancillary_services` (`available`);--> statement-breakpoint
CREATE INDEX `event_type_idx` ON `audit_logs` (`eventType`);--> statement-breakpoint
CREATE INDEX `event_category_idx` ON `audit_logs` (`eventCategory`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `audit_logs` (`userId`);--> statement-breakpoint
CREATE INDEX `resource_type_idx` ON `audit_logs` (`resourceType`);--> statement-breakpoint
CREATE INDEX `resource_id_idx` ON `audit_logs` (`resourceId`);--> statement-breakpoint
CREATE INDEX `timestamp_idx` ON `audit_logs` (`timestamp`);--> statement-breakpoint
CREATE INDEX `outcome_idx` ON `audit_logs` (`outcome`);--> statement-breakpoint
CREATE INDEX `severity_idx` ON `audit_logs` (`severity`);--> statement-breakpoint
CREATE INDEX `category_outcome_idx` ON `audit_logs` (`eventCategory`,`outcome`);--> statement-breakpoint
CREATE INDEX `baggage_items_booking_id_idx` ON `baggage_items` (`bookingId`);--> statement-breakpoint
CREATE INDEX `baggage_items_passenger_id_idx` ON `baggage_items` (`passengerId`);--> statement-breakpoint
CREATE INDEX `baggage_items_tag_number_idx` ON `baggage_items` (`tagNumber`);--> statement-breakpoint
CREATE INDEX `baggage_items_status_idx` ON `baggage_items` (`status`);--> statement-breakpoint
CREATE INDEX `baggage_items_booking_passenger_idx` ON `baggage_items` (`bookingId`,`passengerId`);--> statement-breakpoint
CREATE INDEX `baggage_items_lost_status_idx` ON `baggage_items` (`status`,`lostReportedAt`);--> statement-breakpoint
CREATE INDEX `baggage_tracking_baggage_id_idx` ON `baggage_tracking` (`baggageId`);--> statement-breakpoint
CREATE INDEX `baggage_tracking_status_idx` ON `baggage_tracking` (`status`);--> statement-breakpoint
CREATE INDEX `baggage_tracking_scanned_at_idx` ON `baggage_tracking` (`scannedAt`);--> statement-breakpoint
CREATE INDEX `baggage_tracking_scanned_by_idx` ON `baggage_tracking` (`scannedBy`);--> statement-breakpoint
CREATE INDEX `baggage_tracking_baggage_timeline_idx` ON `baggage_tracking` (`baggageId`,`scannedAt`);--> statement-breakpoint
CREATE INDEX `booking_id_idx` ON `booking_ancillaries` (`bookingId`);--> statement-breakpoint
CREATE INDEX `passenger_id_idx` ON `booking_ancillaries` (`passengerId`);--> statement-breakpoint
CREATE INDEX `ancillary_service_id_idx` ON `booking_ancillaries` (`ancillaryServiceId`);--> statement-breakpoint
CREATE INDEX `booking_id_idx` ON `booking_modifications` (`bookingId`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `booking_modifications` (`userId`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `booking_modifications` (`status`);--> statement-breakpoint
CREATE INDEX `booking_segments_booking_id_idx` ON `booking_segments` (`bookingId`);--> statement-breakpoint
CREATE INDEX `booking_segments_flight_id_idx` ON `booking_segments` (`flightId`);--> statement-breakpoint
CREATE INDEX `booking_segments_booking_order_idx` ON `booking_segments` (`bookingId`,`segmentOrder`);--> statement-breakpoint
CREATE INDEX `booking_segments_status_idx` ON `booking_segments` (`status`);--> statement-breakpoint
CREATE INDEX `booking_id_idx` ON `booking_status_history` (`bookingId`);--> statement-breakpoint
CREATE INDEX `booking_reference_idx` ON `booking_status_history` (`bookingReference`);--> statement-breakpoint
CREATE INDEX `new_status_idx` ON `booking_status_history` (`newStatus`);--> statement-breakpoint
CREATE INDEX `transitioned_at_idx` ON `booking_status_history` (`transitionedAt`);--> statement-breakpoint
CREATE INDEX `changed_by_idx` ON `booking_status_history` (`changedBy`);--> statement-breakpoint
CREATE INDEX `booking_status_idx` ON `booking_status_history` (`bookingId`,`newStatus`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `bookings` (`userId`);--> statement-breakpoint
CREATE INDEX `pnr_idx` ON `bookings` (`pnr`);--> statement-breakpoint
CREATE INDEX `bookings_flight_id_idx` ON `bookings` (`flightId`);--> statement-breakpoint
CREATE INDEX `bookings_status_idx` ON `bookings` (`status`);--> statement-breakpoint
CREATE INDEX `bookings_payment_status_idx` ON `bookings` (`paymentStatus`);--> statement-breakpoint
CREATE INDEX `bookings_stripe_checkout_idx` ON `bookings` (`stripeCheckoutSessionId`);--> statement-breakpoint
CREATE INDEX `bookings_stripe_payment_intent_idx` ON `bookings` (`stripePaymentIntentId`);--> statement-breakpoint
CREATE INDEX `bookings_created_at_idx` ON `bookings` (`createdAt`);--> statement-breakpoint
CREATE INDEX `bookings_user_created_at_idx` ON `bookings` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `bookings_user_status_idx` ON `bookings` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `bookings_flight_status_idx` ON `bookings` (`flightId`,`status`);--> statement-breakpoint
CREATE INDEX `bookings_checked_in_idx` ON `bookings` (`checkedIn`);--> statement-breakpoint
CREATE INDEX `bookings_check_in_reminder_idx` ON `bookings` (`status`,`checkedIn`,`checkInReminderSentAt`);--> statement-breakpoint
CREATE INDEX `consent_history_user_id_idx` ON `consent_history` (`userId`);--> statement-breakpoint
CREATE INDEX `consent_history_type_idx` ON `consent_history` (`consentType`);--> statement-breakpoint
CREATE INDEX `consent_history_created_at_idx` ON `consent_history` (`createdAt`);--> statement-breakpoint
CREATE INDEX `corporate_accounts_company_name_idx` ON `corporate_accounts` (`companyName`);--> statement-breakpoint
CREATE INDEX `corporate_accounts_tax_id_idx` ON `corporate_accounts` (`taxId`);--> statement-breakpoint
CREATE INDEX `corporate_accounts_status_idx` ON `corporate_accounts` (`status`);--> statement-breakpoint
CREATE INDEX `corporate_accounts_contact_email_idx` ON `corporate_accounts` (`contactEmail`);--> statement-breakpoint
CREATE INDEX `corporate_accounts_created_at_idx` ON `corporate_accounts` (`createdAt`);--> statement-breakpoint
CREATE INDEX `corporate_bookings_account_id_idx` ON `corporate_bookings` (`corporateAccountId`);--> statement-breakpoint
CREATE INDEX `corporate_bookings_booking_id_idx` ON `corporate_bookings` (`bookingId`);--> statement-breakpoint
CREATE INDEX `corporate_bookings_approval_status_idx` ON `corporate_bookings` (`approvalStatus`);--> statement-breakpoint
CREATE INDEX `corporate_bookings_cost_center_idx` ON `corporate_bookings` (`costCenter`);--> statement-breakpoint
CREATE INDEX `corporate_bookings_project_code_idx` ON `corporate_bookings` (`projectCode`);--> statement-breakpoint
CREATE INDEX `corporate_bookings_booked_by_idx` ON `corporate_bookings` (`bookedByUserId`);--> statement-breakpoint
CREATE INDEX `corporate_bookings_created_at_idx` ON `corporate_bookings` (`createdAt`);--> statement-breakpoint
CREATE INDEX `corporate_bookings_account_approval_idx` ON `corporate_bookings` (`corporateAccountId`,`approvalStatus`);--> statement-breakpoint
CREATE INDEX `corporate_users_account_id_idx` ON `corporate_users` (`corporateAccountId`);--> statement-breakpoint
CREATE INDEX `corporate_users_user_id_idx` ON `corporate_users` (`userId`);--> statement-breakpoint
CREATE INDEX `corporate_users_role_idx` ON `corporate_users` (`role`);--> statement-breakpoint
CREATE INDEX `corporate_users_user_account_unique_idx` ON `corporate_users` (`userId`,`corporateAccountId`);--> statement-breakpoint
CREATE INDEX `corporate_users_is_active_idx` ON `corporate_users` (`isActive`);--> statement-breakpoint
CREATE INDEX `credit_usage_user_credit_id_idx` ON `credit_usage` (`userCreditId`);--> statement-breakpoint
CREATE INDEX `credit_usage_user_id_idx` ON `credit_usage` (`userId`);--> statement-breakpoint
CREATE INDEX `credit_usage_booking_id_idx` ON `credit_usage` (`bookingId`);--> statement-breakpoint
CREATE INDEX `credit_usage_used_at_idx` ON `credit_usage` (`usedAt`);--> statement-breakpoint
CREATE INDEX `currencies_code_idx` ON `currencies` (`code`);--> statement-breakpoint
CREATE INDEX `currencies_active_idx` ON `currencies` (`isActive`);--> statement-breakpoint
CREATE INDEX `data_export_requests_user_id_idx` ON `data_export_requests` (`userId`);--> statement-breakpoint
CREATE INDEX `data_export_requests_status_idx` ON `data_export_requests` (`status`);--> statement-breakpoint
CREATE INDEX `data_export_requests_requested_at_idx` ON `data_export_requests` (`requestedAt`);--> statement-breakpoint
CREATE INDEX `denied_boarding_flight_idx` ON `denied_boarding_records` (`flightId`);--> statement-breakpoint
CREATE INDEX `denied_boarding_user_idx` ON `denied_boarding_records` (`userId`);--> statement-breakpoint
CREATE INDEX `denied_boarding_status_idx` ON `denied_boarding_records` (`status`);--> statement-breakpoint
CREATE INDEX `exchange_rates_pair_idx` ON `exchange_rates` (`fromCurrency`,`toCurrency`);--> statement-breakpoint
CREATE INDEX `exchange_rates_valid_idx` ON `exchange_rates` (`validFrom`);--> statement-breakpoint
CREATE INDEX `family_group_members_group_idx` ON `family_group_members` (`groupId`);--> statement-breakpoint
CREATE INDEX `family_group_members_user_idx` ON `family_group_members` (`userId`);--> statement-breakpoint
CREATE INDEX `family_group_members_status_idx` ON `family_group_members` (`status`);--> statement-breakpoint
CREATE INDEX `family_group_members_group_user_idx` ON `family_group_members` (`groupId`,`userId`);--> statement-breakpoint
CREATE INDEX `family_groups_owner_idx` ON `family_groups` (`ownerId`);--> statement-breakpoint
CREATE INDEX `family_groups_status_idx` ON `family_groups` (`status`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `favorite_flights` (`userId`);--> statement-breakpoint
CREATE INDEX `route_idx` ON `favorite_flights` (`originId`,`destinationId`);--> statement-breakpoint
CREATE INDEX `airline_id_idx` ON `favorite_flights` (`airlineId`);--> statement-breakpoint
CREATE INDEX `price_alert_idx` ON `favorite_flights` (`enablePriceAlert`,`maxPrice`);--> statement-breakpoint
CREATE INDEX `user_route_favorite_unique` ON `favorite_flights` (`userId`,`originId`,`destinationId`,`airlineId`);--> statement-breakpoint
CREATE INDEX `financial_ledger_booking_id_idx` ON `financial_ledger` (`bookingId`);--> statement-breakpoint
CREATE INDEX `financial_ledger_user_id_idx` ON `financial_ledger` (`userId`);--> statement-breakpoint
CREATE INDEX `financial_ledger_type_idx` ON `financial_ledger` (`type`);--> statement-breakpoint
CREATE INDEX `financial_ledger_stripe_event_id_idx` ON `financial_ledger` (`stripeEventId`);--> statement-breakpoint
CREATE INDEX `financial_ledger_transaction_date_idx` ON `financial_ledger` (`transactionDate`);--> statement-breakpoint
CREATE INDEX `flight_disruptions_flight_idx` ON `flight_disruptions` (`flightId`);--> statement-breakpoint
CREATE INDEX `flight_disruptions_type_idx` ON `flight_disruptions` (`type`);--> statement-breakpoint
CREATE INDEX `flight_disruptions_status_idx` ON `flight_disruptions` (`status`);--> statement-breakpoint
CREATE INDEX `flight_disruptions_created_at_idx` ON `flight_disruptions` (`createdAt`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `flight_reviews` (`userId`);--> statement-breakpoint
CREATE INDEX `flight_id_idx` ON `flight_reviews` (`flightId`);--> statement-breakpoint
CREATE INDEX `booking_id_idx` ON `flight_reviews` (`bookingId`);--> statement-breakpoint
CREATE INDEX `rating_idx` ON `flight_reviews` (`rating`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `flight_reviews` (`status`);--> statement-breakpoint
CREATE INDEX `user_flight_unique` ON `flight_reviews` (`userId`,`flightId`);--> statement-breakpoint
CREATE INDEX `flight_status_history_flight_idx` ON `flight_status_history` (`flightId`);--> statement-breakpoint
CREATE INDEX `flight_status_history_new_status_idx` ON `flight_status_history` (`newStatus`);--> statement-breakpoint
CREATE INDEX `flight_status_history_changed_by_idx` ON `flight_status_history` (`changedBy`);--> statement-breakpoint
CREATE INDEX `flight_status_history_created_at_idx` ON `flight_status_history` (`createdAt`);--> statement-breakpoint
CREATE INDEX `flight_status_history_flight_created_idx` ON `flight_status_history` (`flightId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `flight_number_idx` ON `flights` (`flightNumber`);--> statement-breakpoint
CREATE INDEX `departure_time_idx` ON `flights` (`departureTime`);--> statement-breakpoint
CREATE INDEX `route_idx` ON `flights` (`originId`,`destinationId`);--> statement-breakpoint
CREATE INDEX `airline_idx` ON `flights` (`airlineId`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `flights` (`status`);--> statement-breakpoint
CREATE INDEX `route_date_status_idx` ON `flights` (`originId`,`destinationId`,`departureTime`,`status`);--> statement-breakpoint
CREATE INDEX `gate_assignments_flight_id_idx` ON `gate_assignments` (`flightId`);--> statement-breakpoint
CREATE INDEX `gate_assignments_gate_id_idx` ON `gate_assignments` (`gateId`);--> statement-breakpoint
CREATE INDEX `gate_assignments_status_idx` ON `gate_assignments` (`status`);--> statement-breakpoint
CREATE INDEX `gate_assignments_assigned_by_idx` ON `gate_assignments` (`assignedBy`);--> statement-breakpoint
CREATE INDEX `gate_assignments_boarding_start_idx` ON `gate_assignments` (`boardingStartTime`);--> statement-breakpoint
CREATE INDEX `gate_assignments_gate_status_idx` ON `gate_assignments` (`gateId`,`status`);--> statement-breakpoint
CREATE INDEX `gate_assignments_flight_status_idx` ON `gate_assignments` (`flightId`,`status`);--> statement-breakpoint
CREATE INDEX `gate_assignments_assigned_at_idx` ON `gate_assignments` (`assignedAt`);--> statement-breakpoint
CREATE INDEX `group_bookings_organizer_email_idx` ON `group_bookings` (`organizerEmail`);--> statement-breakpoint
CREATE INDEX `group_bookings_flight_id_idx` ON `group_bookings` (`flightId`);--> statement-breakpoint
CREATE INDEX `group_bookings_status_idx` ON `group_bookings` (`status`);--> statement-breakpoint
CREATE INDEX `group_bookings_created_at_idx` ON `group_bookings` (`createdAt`);--> statement-breakpoint
CREATE INDEX `group_bookings_status_created_at_idx` ON `group_bookings` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idempotency_scope_user_key_idx` ON `idempotency_requests` (`scope`,`userId`,`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `idempotency_scope_key_idx` ON `idempotency_requests` (`scope`,`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `idempotency_status_idx` ON `idempotency_requests` (`status`);--> statement-breakpoint
CREATE INDEX `idempotency_expires_at_idx` ON `idempotency_requests` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `flight_id_idx` ON `inventory_locks` (`flightId`);--> statement-breakpoint
CREATE INDEX `session_id_idx` ON `inventory_locks` (`sessionId`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `inventory_locks` (`status`);--> statement-breakpoint
CREATE INDEX `expires_at_idx` ON `inventory_locks` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `inventory_snapshots_flight_idx` ON `inventory_snapshots` (`flightId`);--> statement-breakpoint
CREATE INDEX `inventory_snapshots_date_idx` ON `inventory_snapshots` (`snapshotDate`);--> statement-breakpoint
CREATE INDEX `inventory_snapshots_flight_date_idx` ON `inventory_snapshots` (`flightId`,`snapshotDate`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `loyalty_accounts` (`userId`);--> statement-breakpoint
CREATE INDEX `tier_idx` ON `loyalty_accounts` (`tier`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `miles_transactions` (`userId`);--> statement-breakpoint
CREATE INDEX `loyalty_account_id_idx` ON `miles_transactions` (`loyaltyAccountId`);--> statement-breakpoint
CREATE INDEX `type_idx` ON `miles_transactions` (`type`);--> statement-breakpoint
CREATE INDEX `notifications_user_id_idx` ON `notifications` (`userId`);--> statement-breakpoint
CREATE INDEX `notifications_type_idx` ON `notifications` (`type`);--> statement-breakpoint
CREATE INDEX `notifications_is_read_idx` ON `notifications` (`isRead`);--> statement-breakpoint
CREATE INDEX `notifications_created_at_idx` ON `notifications` (`createdAt`);--> statement-breakpoint
CREATE INDEX `notifications_user_unread_idx` ON `notifications` (`userId`,`isRead`,`createdAt`);--> statement-breakpoint
CREATE INDEX `overbooking_route_idx` ON `overbooking_config` (`originId`,`destinationId`);--> statement-breakpoint
CREATE INDEX `overbooking_airline_idx` ON `overbooking_config` (`airlineId`);--> statement-breakpoint
CREATE INDEX `overbooking_active_idx` ON `overbooking_config` (`isActive`);--> statement-breakpoint
CREATE INDEX `booking_id_idx` ON `passengers` (`bookingId`);--> statement-breakpoint
CREATE INDEX `passengers_ticket_number_idx` ON `passengers` (`ticketNumber`);--> statement-breakpoint
CREATE INDEX `passengers_passport_idx` ON `passengers` (`passportNumber`);--> statement-breakpoint
CREATE INDEX `passengers_name_idx` ON `passengers` (`lastName`,`firstName`);--> statement-breakpoint
CREATE INDEX `passengers_type_idx` ON `passengers` (`type`);--> statement-breakpoint
CREATE INDEX `payment_splits_booking_id_idx` ON `payment_splits` (`bookingId`);--> statement-breakpoint
CREATE INDEX `payment_splits_payer_email_idx` ON `payment_splits` (`payerEmail`);--> statement-breakpoint
CREATE INDEX `payment_splits_status_idx` ON `payment_splits` (`status`);--> statement-breakpoint
CREATE INDEX `payment_splits_token_idx` ON `payment_splits` (`paymentToken`);--> statement-breakpoint
CREATE INDEX `payment_splits_booking_status_idx` ON `payment_splits` (`bookingId`,`status`);--> statement-breakpoint
CREATE INDEX `payment_splits_expires_at_idx` ON `payment_splits` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `payment_splits_stripe_checkout_idx` ON `payment_splits` (`stripeCheckoutSessionId`);--> statement-breakpoint
CREATE INDEX `booking_id_idx` ON `payments` (`bookingId`);--> statement-breakpoint
CREATE INDEX `idempotency_key_idx` ON `payments` (`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `payments_status_idx` ON `payments` (`status`);--> statement-breakpoint
CREATE INDEX `payments_stripe_payment_intent_idx` ON `payments` (`stripePaymentIntentId`);--> statement-breakpoint
CREATE INDEX `payments_transaction_id_idx` ON `payments` (`transactionId`);--> statement-breakpoint
CREATE INDEX `payments_created_at_idx` ON `payments` (`createdAt`);--> statement-breakpoint
CREATE INDEX `payments_status_created_at_idx` ON `payments` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `payments_method_idx` ON `payments` (`method`);--> statement-breakpoint
CREATE INDEX `favorite_flight_id_idx` ON `price_alert_history` (`favoriteFlightId`);--> statement-breakpoint
CREATE INDEX `flight_id_idx` ON `price_alert_history` (`flightId`);--> statement-breakpoint
CREATE INDEX `created_at_idx` ON `price_alert_history` (`createdAt`);--> statement-breakpoint
CREATE INDEX `price_alerts_user_id_idx` ON `price_alerts` (`userId`);--> statement-breakpoint
CREATE INDEX `price_alerts_route_idx` ON `price_alerts` (`originId`,`destinationId`);--> statement-breakpoint
CREATE INDEX `price_alerts_active_idx` ON `price_alerts` (`isActive`);--> statement-breakpoint
CREATE INDEX `price_alerts_last_checked_idx` ON `price_alerts` (`lastChecked`);--> statement-breakpoint
CREATE INDEX `price_alerts_user_route_unique_idx` ON `price_alerts` (`userId`,`originId`,`destinationId`,`cabinClass`);--> statement-breakpoint
CREATE INDEX `price_locks_user_idx` ON `price_locks` (`userId`);--> statement-breakpoint
CREATE INDEX `price_locks_flight_idx` ON `price_locks` (`flightId`);--> statement-breakpoint
CREATE INDEX `price_locks_status_idx` ON `price_locks` (`status`);--> statement-breakpoint
CREATE INDEX `price_locks_expires_at_idx` ON `price_locks` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `price_locks_user_flight_idx` ON `price_locks` (`userId`,`flightId`,`cabinClass`);--> statement-breakpoint
CREATE INDEX `pricing_history_flight_idx` ON `pricing_history` (`flightId`);--> statement-breakpoint
CREATE INDEX `pricing_history_booking_idx` ON `pricing_history` (`bookingId`);--> statement-breakpoint
CREATE INDEX `pricing_history_created_idx` ON `pricing_history` (`createdAt`);--> statement-breakpoint
CREATE INDEX `pricing_rules_type_idx` ON `pricing_rules` (`ruleType`);--> statement-breakpoint
CREATE INDEX `pricing_rules_airline_idx` ON `pricing_rules` (`airlineId`);--> statement-breakpoint
CREATE INDEX `pricing_rules_route_idx` ON `pricing_rules` (`originId`,`destinationId`);--> statement-breakpoint
CREATE INDEX `pricing_rules_active_idx` ON `pricing_rules` (`isActive`);--> statement-breakpoint
CREATE INDEX `pricing_rules_priority_idx` ON `pricing_rules` (`priority`);--> statement-breakpoint
CREATE INDEX `pricing_rules_validity_idx` ON `pricing_rules` (`validFrom`,`validTo`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_user_id_idx` ON `refresh_tokens` (`userId`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_token_idx` ON `refresh_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_expires_at_idx` ON `refresh_tokens` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `saved_passengers_user_id_idx` ON `saved_passengers` (`userId`);--> statement-breakpoint
CREATE INDEX `saved_passengers_user_default_idx` ON `saved_passengers` (`userId`,`isDefault`);--> statement-breakpoint
CREATE INDEX `saved_passengers_name_idx` ON `saved_passengers` (`lastName`,`firstName`);--> statement-breakpoint
CREATE INDEX `seasonal_pricing_dates_idx` ON `seasonal_pricing` (`startDate`,`endDate`);--> statement-breakpoint
CREATE INDEX `seasonal_pricing_active_idx` ON `seasonal_pricing` (`isActive`);--> statement-breakpoint
CREATE INDEX `seat_holds_flight_idx` ON `seat_holds` (`flightId`);--> statement-breakpoint
CREATE INDEX `seat_holds_user_idx` ON `seat_holds` (`userId`);--> statement-breakpoint
CREATE INDEX `seat_holds_session_idx` ON `seat_holds` (`sessionId`);--> statement-breakpoint
CREATE INDEX `seat_holds_status_idx` ON `seat_holds` (`status`);--> statement-breakpoint
CREATE INDEX `seat_holds_expires_idx` ON `seat_holds` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `sms_logs_user_id_idx` ON `sms_logs` (`userId`);--> statement-breakpoint
CREATE INDEX `sms_logs_phone_number_idx` ON `sms_logs` (`phoneNumber`);--> statement-breakpoint
CREATE INDEX `sms_logs_type_idx` ON `sms_logs` (`type`);--> statement-breakpoint
CREATE INDEX `sms_logs_status_idx` ON `sms_logs` (`status`);--> statement-breakpoint
CREATE INDEX `sms_logs_provider_idx` ON `sms_logs` (`provider`);--> statement-breakpoint
CREATE INDEX `sms_logs_sent_at_idx` ON `sms_logs` (`sentAt`);--> statement-breakpoint
CREATE INDEX `sms_logs_booking_id_idx` ON `sms_logs` (`bookingId`);--> statement-breakpoint
CREATE INDEX `sms_logs_created_at_idx` ON `sms_logs` (`createdAt`);--> statement-breakpoint
CREATE INDEX `sms_logs_user_created_at_idx` ON `sms_logs` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `sms_logs_status_created_at_idx` ON `sms_logs` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `special_services_booking_id_idx` ON `special_services` (`bookingId`);--> statement-breakpoint
CREATE INDEX `special_services_passenger_id_idx` ON `special_services` (`passengerId`);--> statement-breakpoint
CREATE INDEX `special_services_type_idx` ON `special_services` (`serviceType`);--> statement-breakpoint
CREATE INDEX `special_services_code_idx` ON `special_services` (`serviceCode`);--> statement-breakpoint
CREATE INDEX `special_services_status_idx` ON `special_services` (`status`);--> statement-breakpoint
CREATE INDEX `special_services_booking_passenger_idx` ON `special_services` (`bookingId`,`passengerId`);--> statement-breakpoint
CREATE INDEX `stripe_events_type_idx` ON `stripe_events` (`type`);--> statement-breakpoint
CREATE INDEX `stripe_events_processed_idx` ON `stripe_events` (`processed`);--> statement-breakpoint
CREATE INDEX `stripe_events_created_at_idx` ON `stripe_events` (`createdAt`);--> statement-breakpoint
CREATE INDEX `travel_agents_iata_number_idx` ON `travel_agents` (`iataNumber`);--> statement-breakpoint
CREATE INDEX `travel_agents_email_idx` ON `travel_agents` (`email`);--> statement-breakpoint
CREATE INDEX `travel_agents_api_key_idx` ON `travel_agents` (`apiKey`);--> statement-breakpoint
CREATE INDEX `travel_agents_is_active_idx` ON `travel_agents` (`isActive`);--> statement-breakpoint
CREATE INDEX `travel_agents_created_at_idx` ON `travel_agents` (`createdAt`);--> statement-breakpoint
CREATE INDEX `user_consents_user_id_idx` ON `user_consents` (`userId`);--> statement-breakpoint
CREATE INDEX `user_consents_version_idx` ON `user_consents` (`consentVersion`);--> statement-breakpoint
CREATE INDEX `user_credits_user_id_idx` ON `user_credits` (`userId`);--> statement-breakpoint
CREATE INDEX `user_credits_source_idx` ON `user_credits` (`source`);--> statement-breakpoint
CREATE INDEX `user_credits_expires_at_idx` ON `user_credits` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `user_credits_booking_id_idx` ON `user_credits` (`bookingId`);--> statement-breakpoint
CREATE INDEX `user_credits_user_available_idx` ON `user_credits` (`userId`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `user_flight_favorites_user_id_idx` ON `user_flight_favorites` (`userId`);--> statement-breakpoint
CREATE INDEX `user_flight_favorites_flight_id_idx` ON `user_flight_favorites` (`flightId`);--> statement-breakpoint
CREATE INDEX `user_flight_favorites_unique_idx` ON `user_flight_favorites` (`userId`,`flightId`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `user_preferences` (`userId`);--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role`);--> statement-breakpoint
CREATE INDEX `users_created_at_idx` ON `users` (`createdAt`);--> statement-breakpoint
CREATE INDEX `users_role_created_at_idx` ON `users` (`role`,`createdAt`);--> statement-breakpoint
CREATE INDEX `voucher_usage_voucher_id_idx` ON `voucher_usage` (`voucherId`);--> statement-breakpoint
CREATE INDEX `voucher_usage_user_id_idx` ON `voucher_usage` (`userId`);--> statement-breakpoint
CREATE INDEX `voucher_usage_booking_id_idx` ON `voucher_usage` (`bookingId`);--> statement-breakpoint
CREATE INDEX `voucher_usage_used_at_idx` ON `voucher_usage` (`usedAt`);--> statement-breakpoint
CREATE INDEX `voucher_usage_voucher_booking_unique` ON `voucher_usage` (`voucherId`,`bookingId`);--> statement-breakpoint
CREATE INDEX `vouchers_code_idx` ON `vouchers` (`code`);--> statement-breakpoint
CREATE INDEX `vouchers_is_active_idx` ON `vouchers` (`isActive`);--> statement-breakpoint
CREATE INDEX `vouchers_valid_from_idx` ON `vouchers` (`validFrom`);--> statement-breakpoint
CREATE INDEX `vouchers_valid_until_idx` ON `vouchers` (`validUntil`);--> statement-breakpoint
CREATE INDEX `vouchers_active_valid_idx` ON `vouchers` (`isActive`,`validFrom`,`validUntil`);--> statement-breakpoint
CREATE INDEX `waitlist_flight_idx` ON `waitlist` (`flightId`);--> statement-breakpoint
CREATE INDEX `waitlist_user_idx` ON `waitlist` (`userId`);--> statement-breakpoint
CREATE INDEX `waitlist_status_idx` ON `waitlist` (`status`);--> statement-breakpoint
CREATE INDEX `waitlist_priority_idx` ON `waitlist` (`flightId`,`cabinClass`,`priority`);--> statement-breakpoint
CREATE INDEX `wallet_transactions_wallet_idx` ON `wallet_transactions` (`walletId`);--> statement-breakpoint
CREATE INDEX `wallet_transactions_user_idx` ON `wallet_transactions` (`userId`);--> statement-breakpoint
CREATE INDEX `wallet_transactions_type_idx` ON `wallet_transactions` (`type`);--> statement-breakpoint
CREATE INDEX `wallet_transactions_booking_idx` ON `wallet_transactions` (`bookingId`);--> statement-breakpoint
CREATE INDEX `wallet_transactions_created_at_idx` ON `wallet_transactions` (`createdAt`);--> statement-breakpoint
CREATE INDEX `wallets_user_idx` ON `wallets` (`userId`);--> statement-breakpoint
CREATE INDEX `wallets_status_idx` ON `wallets` (`status`);--> statement-breakpoint
CREATE INDEX `booking_sug_conv_idx` ON `booking_suggestions` (`conversationId`);--> statement-breakpoint
CREATE INDEX `booking_sug_flight_idx` ON `booking_suggestions` (`flightId`);--> statement-breakpoint
CREATE INDEX `booking_sug_selected_idx` ON `booking_suggestions` (`selected`);--> statement-breakpoint
CREATE INDEX `chat_conv_user_idx` ON `chat_conversations` (`userId`);--> statement-breakpoint
CREATE INDEX `chat_conv_status_idx` ON `chat_conversations` (`status`);--> statement-breakpoint
CREATE INDEX `chat_conv_booking_idx` ON `chat_conversations` (`bookingId`);--> statement-breakpoint
CREATE INDEX `chat_conv_last_msg_idx` ON `chat_conversations` (`lastMessageAt`);--> statement-breakpoint
CREATE INDEX `chat_msg_conv_idx` ON `chat_messages` (`conversationId`);--> statement-breakpoint
CREATE INDEX `chat_msg_role_idx` ON `chat_messages` (`role`);--> statement-breakpoint
CREATE INDEX `chat_msg_created_idx` ON `chat_messages` (`createdAt`);--> statement-breakpoint
CREATE INDEX `review_user_idx` ON `customer_reviews` (`userId`);--> statement-breakpoint
CREATE INDEX `review_booking_idx` ON `customer_reviews` (`bookingId`);--> statement-breakpoint
CREATE INDEX `review_flight_idx` ON `customer_reviews` (`flightId`);--> statement-breakpoint
CREATE INDEX `review_rating_idx` ON `customer_reviews` (`overallRating`);--> statement-breakpoint
CREATE INDEX `review_status_idx` ON `customer_reviews` (`moderationStatus`);--> statement-breakpoint
CREATE INDEX `notif_hist_user_idx` ON `notification_history` (`userId`);--> statement-breakpoint
CREATE INDEX `notif_hist_type_idx` ON `notification_history` (`type`);--> statement-breakpoint
CREATE INDEX `notif_hist_channel_idx` ON `notification_history` (`channel`);--> statement-breakpoint
CREATE INDEX `notif_hist_status_idx` ON `notification_history` (`status`);--> statement-breakpoint
CREATE INDEX `notif_hist_sent_idx` ON `notification_history` (`sentAt`);--> statement-breakpoint
CREATE INDEX `notif_hist_booking_idx` ON `notification_history` (`bookingId`);--> statement-breakpoint
CREATE INDEX `helpful_review_user_idx` ON `review_helpful_votes` (`reviewId`,`userId`);