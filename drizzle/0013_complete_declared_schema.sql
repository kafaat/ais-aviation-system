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
CREATE TABLE `account_locks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`reason` varchar(255) NOT NULL,
	`lockedBy` varchar(50) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`unlockedAt` timestamp,
	`unlockedBy` varchar(50),
	`autoUnlockAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `account_locks_id` PRIMARY KEY(`id`),
	CONSTRAINT `account_locks_userId_unique` UNIQUE(`userId`)
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
CREATE TABLE `agent_decisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` varchar(100) NOT NULL,
	`agentName` varchar(255) NOT NULL,
	`requestId` varchar(100) NOT NULL,
	`status` enum('idle','running','completed','failed','timeout') NOT NULL,
	`confidence` decimal(5,4),
	`confidenceLevel` enum('low','medium','high','very_high'),
	`executionTimeMs` int,
	`data` json,
	`reasoning` json,
	`recommendations` json,
	`errors` json,
	`tenantId` int,
	`overridden` boolean NOT NULL DEFAULT false,
	`overriddenBy` int,
	`overrideReason` text,
	`overriddenAt` timestamp,
	`supersededBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_decisions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_gateway_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` varchar(100) NOT NULL,
	`agentId` varchar(100),
	`modelId` varchar(100) NOT NULL,
	`taskType` varchar(50),
	`tenantId` int,
	`feature` varchar(100),
	`inputTokens` int,
	`outputTokens` int,
	`costUsd` decimal(10,6),
	`latencyMs` int,
	`cached` boolean NOT NULL DEFAULT false,
	`error` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_gateway_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_pricing_models` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`version` varchar(50) NOT NULL,
	`modelType` enum('demand_forecast','price_optimization','customer_segmentation','elasticity') NOT NULL,
	`config` text NOT NULL,
	`metrics` text,
	`trainedAt` timestamp,
	`trainingDataStart` timestamp,
	`trainingDataEnd` timestamp,
	`sampleCount` int,
	`airlineId` int,
	`routeScope` text,
	`status` enum('training','validating','active','inactive','failed') NOT NULL DEFAULT 'training',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_pricing_models_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `aircraft_types` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(10) NOT NULL,
	`name` varchar(100) NOT NULL,
	`manufacturer` varchar(50) NOT NULL,
	`maxTakeoffWeight` int NOT NULL,
	`maxLandingWeight` int NOT NULL,
	`maxZeroFuelWeight` int NOT NULL,
	`operatingEmptyWeight` int NOT NULL,
	`maxPayload` int NOT NULL,
	`maxFuelCapacity` int NOT NULL,
	`totalSeats` int NOT NULL,
	`economySeats` int NOT NULL,
	`businessSeats` int NOT NULL,
	`cargoZones` text,
	`forwardCgLimit` decimal(5,2),
	`aftCgLimit` decimal(5,2),
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `aircraft_types_id` PRIMARY KEY(`id`),
	CONSTRAINT `aircraft_types_code_unique` UNIQUE(`code`)
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
	CONSTRAINT `airport_gates_id` PRIMARY KEY(`id`),
	CONSTRAINT `airport_gates_airport_gate_unique_idx` UNIQUE(`airportId`,`gateNumber`)
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
CREATE TABLE `codeshare_agreements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`marketingAirlineId` int NOT NULL,
	`operatingAirlineId` int NOT NULL,
	`agreementType` enum('free_sale','block_space','hard_block','soft_block') NOT NULL,
	`agreementReference` varchar(50) NOT NULL,
	`routeScope` enum('all_routes','specific_routes') NOT NULL DEFAULT 'specific_routes',
	`routes` text,
	`revenueShareModel` enum('prorate','fixed_amount','percentage','free_flow') NOT NULL DEFAULT 'prorate',
	`revenueShareValue` decimal(10,2),
	`blockSize` int,
	`validFrom` timestamp NOT NULL,
	`validUntil` timestamp,
	`status` enum('draft','pending_approval','active','suspended','terminated') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `codeshare_agreements_id` PRIMARY KEY(`id`),
	CONSTRAINT `codeshare_agreements_agreementReference_unique` UNIQUE(`agreementReference`)
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
	CONSTRAINT `corporate_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `corporate_users_user_account_unique_idx` UNIQUE(`userId`,`corporateAccountId`)
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
CREATE TABLE `crew_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightId` int NOT NULL,
	`crewMemberId` int NOT NULL,
	`role` enum('captain','first_officer','purser','cabin_crew') NOT NULL,
	`status` enum('assigned','confirmed','onboard','removed') NOT NULL DEFAULT 'assigned',
	`notes` text,
	`assignedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crew_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crew_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employeeId` varchar(20) NOT NULL,
	`firstName` varchar(100) NOT NULL,
	`lastName` varchar(100) NOT NULL,
	`role` enum('captain','first_officer','purser','cabin_crew') NOT NULL,
	`airlineId` int NOT NULL,
	`licenseNumber` varchar(50),
	`licenseExpiry` timestamp,
	`medicalExpiry` timestamp,
	`qualifiedAircraft` text,
	`status` enum('active','on_leave','training','inactive') NOT NULL DEFAULT 'active',
	`phone` varchar(20),
	`email` varchar(320),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crew_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `crew_members_employeeId_unique` UNIQUE(`employeeId`)
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
CREATE TABLE `customer_segment_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`segmentId` int NOT NULL,
	`score` decimal(5,4) DEFAULT '1.0000',
	`behaviorSnapshot` text,
	`assignedAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp,
	`isActive` boolean NOT NULL DEFAULT true,
	CONSTRAINT `customer_segment_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `segment_assignments_user_segment_idx` UNIQUE(`userId`,`segmentId`)
);
--> statement-breakpoint
CREATE TABLE `customer_segments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`nameAr` varchar(255),
	`description` text,
	`segmentType` enum('value','frequency','behavior','loyalty_tier','corporate','price_sensitive','premium') NOT NULL,
	`criteria` text NOT NULL,
	`priceMultiplier` decimal(5,4) DEFAULT '1.0000',
	`maxDiscount` decimal(5,4) DEFAULT '0.3000',
	`priorityAccess` boolean NOT NULL DEFAULT false,
	`memberCount` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_segments_id` PRIMARY KEY(`id`)
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
CREATE TABLE `demand_predictions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`modelId` int NOT NULL,
	`flightId` int,
	`originId` int,
	`destinationId` int,
	`predictionDate` timestamp NOT NULL,
	`cabinClass` enum('economy','business') NOT NULL,
	`predictedDemand` decimal(10,2) NOT NULL,
	`confidenceLower` decimal(10,2),
	`confidenceUpper` decimal(10,2),
	`confidenceLevel` decimal(5,4) DEFAULT '0.95',
	`recommendedPrice` int,
	`recommendedMultiplier` decimal(5,4),
	`actualDemand` decimal(10,2),
	`actualPrice` int,
	`featureImportances` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `demand_predictions_id` PRIMARY KEY(`id`)
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
CREATE TABLE `electronic_misc_docs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`emdNumber` varchar(14) NOT NULL,
	`emdType` enum('EMD-S','EMD-A') NOT NULL,
	`bookingId` int,
	`passengerId` int,
	`ticketNumber` varchar(14),
	`issuingAirlineId` int NOT NULL,
	`issuingAgentId` int,
	`iataNumber` varchar(8),
	`reasonForIssuance` enum('baggage','seat_selection','meal','lounge_access','priority_boarding','insurance','pet_transport','unaccompanied_minor','sport_equipment','upgrade','penalty','residual_value','ground_transport','wifi','entertainment','other') NOT NULL,
	`serviceDescription` varchar(255) NOT NULL,
	`rficCode` varchar(2),
	`rfiscCode` varchar(4),
	`amount` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`taxAmount` int NOT NULL DEFAULT 0,
	`status` enum('issued','used','void','exchanged','refunded','suspended') NOT NULL DEFAULT 'issued',
	`flightId` int,
	`flightSegment` varchar(20),
	`dateOfIssuance` timestamp NOT NULL DEFAULT (now()),
	`dateOfService` timestamp,
	`expiryDate` timestamp,
	`voidedAt` timestamp,
	`voidReason` text,
	`exchangedFromEmd` varchar(14),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `electronic_misc_docs_id` PRIMARY KEY(`id`),
	CONSTRAINT `electronic_misc_docs_emdNumber_unique` UNIQUE(`emdNumber`)
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
CREATE TABLE `fare_classes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airlineId` int NOT NULL,
	`code` varchar(2) NOT NULL,
	`name` varchar(100) NOT NULL,
	`cabinClass` enum('first','business','premium_economy','economy') NOT NULL,
	`fareFamily` varchar(50),
	`priority` int NOT NULL DEFAULT 0,
	`basePriceMultiplier` decimal(5,3) NOT NULL DEFAULT '1.000',
	`seatsAllocated` int DEFAULT 0,
	`refundable` boolean NOT NULL DEFAULT false,
	`changeable` boolean NOT NULL DEFAULT true,
	`changeFee` int DEFAULT 0,
	`upgradeable` boolean NOT NULL DEFAULT true,
	`baggageAllowance` int DEFAULT 23,
	`baggagePieces` int DEFAULT 1,
	`carryOnAllowance` int DEFAULT 7,
	`mileageEarningRate` decimal(4,2) DEFAULT '1.00',
	`seatSelection` enum('free','paid','none') DEFAULT 'paid',
	`loungeAccess` boolean NOT NULL DEFAULT false,
	`priorityBoarding` boolean NOT NULL DEFAULT false,
	`mealIncluded` boolean NOT NULL DEFAULT false,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `fare_classes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fare_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fareClassId` int NOT NULL,
	`airlineId` int NOT NULL,
	`ruleName` varchar(100) NOT NULL,
	`ruleCategory` enum('eligibility','day_time','seasonality','flight_application','advance_purchase','minimum_stay','maximum_stay','stopovers','transfers','combinations','blackout_dates','surcharges','penalties','children_discount','group_discount') NOT NULL,
	`conditions` text NOT NULL,
	`validFrom` timestamp NOT NULL,
	`validUntil` timestamp,
	`originAirportId` int,
	`destinationAirportId` int,
	`priceAdjustment` int DEFAULT 0,
	`priceMultiplier` decimal(5,3) DEFAULT '1.000',
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `fare_rules_id` PRIMARY KEY(`id`)
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
CREATE TABLE `flight_tracking` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightId` int NOT NULL,
	`latitude` decimal(10,7) NOT NULL,
	`longitude` decimal(10,7) NOT NULL,
	`altitude` int NOT NULL,
	`heading` int NOT NULL,
	`groundSpeed` int NOT NULL,
	`phase` enum('boarding','taxiing','takeoff','climbing','cruising','descending','approach','landing','arrived') NOT NULL,
	`estimatedArrival` timestamp,
	`temperature` int,
	`windSpeed` int,
	`windDirection` int,
	`turbulence` enum('none','light','moderate','severe') DEFAULT 'none',
	`distanceCovered` int,
	`distanceRemaining` int,
	`progressPercent` decimal(5,2),
	`recordedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `flight_tracking_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fraud_assessments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int,
	`userId` int,
	`riskScore` int NOT NULL,
	`riskLevel` enum('low','medium','high','critical') NOT NULL,
	`recommendation` enum('approve','review','block') NOT NULL,
	`signals` json,
	`reasoning` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fraud_assessments_id` PRIMARY KEY(`id`)
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
CREATE TABLE `gds_connections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` enum('amadeus','sabre','travelport','travelsky') NOT NULL,
	`airlineId` int NOT NULL,
	`connectionName` varchar(100) NOT NULL,
	`pseudoCityCode` varchar(10),
	`officeId` varchar(20),
	`apiKey` varchar(255),
	`apiSecret` varchar(255),
	`environment` enum('production','certification','test') NOT NULL DEFAULT 'test',
	`baseUrl` varchar(500),
	`supportsBooking` boolean NOT NULL DEFAULT true,
	`supportsTicketing` boolean NOT NULL DEFAULT true,
	`supportsSchedules` boolean NOT NULL DEFAULT true,
	`supportsPricing` boolean NOT NULL DEFAULT true,
	`supportsAvailability` boolean NOT NULL DEFAULT true,
	`maxRequestsPerMinute` int DEFAULT 100,
	`maxRequestsPerDay` int DEFAULT 50000,
	`status` enum('active','inactive','maintenance','error') NOT NULL DEFAULT 'inactive',
	`lastHealthCheck` timestamp,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gds_connections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gds_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`connectionId` int NOT NULL,
	`provider` enum('amadeus','sabre','travelport','travelsky') NOT NULL,
	`messageType` enum('availability_request','availability_response','pricing_request','pricing_response','booking_request','booking_response','ticketing_request','ticketing_response','cancel_request','cancel_response','schedule_request','schedule_response') NOT NULL,
	`direction` enum('outbound','inbound') NOT NULL,
	`requestPayload` text,
	`responsePayload` text,
	`correlationId` varchar(64) NOT NULL,
	`bookingReference` varchar(20),
	`responseTimeMs` int,
	`httpStatusCode` int,
	`status` enum('success','error','timeout','pending') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gds_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `group_bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizerName` varchar(255) NOT NULL,
	`organizerEmail` varchar(320) NOT NULL,
	`organizerPhone` varchar(20) NOT NULL,
	`groupSize` int NOT NULL,
	`cabinClass` enum('economy','business') NOT NULL DEFAULT 'economy',
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
	CONSTRAINT `idempotency_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `idempotency_scope_user_key_idx` UNIQUE(`scope`,`userId`,`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `intelligence_briefings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` varchar(100) NOT NULL,
	`overallHealth` enum('excellent','good','fair','poor','critical') NOT NULL,
	`healthScore` int NOT NULL,
	`executionTimeMs` int,
	`period` varchar(100),
	`economicsSummary` text,
	`operationsSummary` text,
	`fraudSummary` text,
	`pricingSummary` text,
	`topRecommendations` json,
	`fullData` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `intelligence_briefings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `interline_agreements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airline1Id` int NOT NULL,
	`airline2Id` int NOT NULL,
	`agreementType` enum('ticketing','baggage','full') NOT NULL,
	`agreementReference` varchar(50) NOT NULL,
	`prorateType` enum('mileage','spi','percentage') DEFAULT 'mileage',
	`prorateValue` decimal(10,2),
	`baggageThroughCheck` boolean NOT NULL DEFAULT false,
	`baggageRuleApplied` enum('most_significant_carrier','first_carrier','each_carrier') DEFAULT 'most_significant_carrier',
	`settlementMethod` enum('bsp','bilateral','ich') DEFAULT 'bsp',
	`validFrom` timestamp NOT NULL,
	`validUntil` timestamp,
	`status` enum('draft','pending_approval','active','suspended','terminated') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `interline_agreements_id` PRIMARY KEY(`id`),
	CONSTRAINT `interline_agreements_agreementReference_unique` UNIQUE(`agreementReference`)
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
CREATE TABLE `ip_blacklist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ipAddress` varchar(45) NOT NULL,
	`reason` text NOT NULL,
	`blockedBy` varchar(50) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`unblockedAt` timestamp,
	`unblockedBy` varchar(50),
	`autoUnblockAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ip_blacklist_id` PRIMARY KEY(`id`),
	CONSTRAINT `ip_blacklist_ipAddress_unique` UNIQUE(`ipAddress`)
);
--> statement-breakpoint
CREATE TABLE `load_plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightId` int NOT NULL,
	`aircraftTypeId` int NOT NULL,
	`passengerCount` int NOT NULL DEFAULT 0,
	`passengerWeight` int NOT NULL DEFAULT 0,
	`baggageCount` int NOT NULL DEFAULT 0,
	`baggageWeight` int NOT NULL DEFAULT 0,
	`cargoDistribution` text,
	`totalCargoWeight` int NOT NULL DEFAULT 0,
	`fuelWeight` int NOT NULL DEFAULT 0,
	`zeroFuelWeight` int NOT NULL DEFAULT 0,
	`takeoffWeight` int NOT NULL DEFAULT 0,
	`landingWeight` int NOT NULL DEFAULT 0,
	`cgPosition` decimal(5,2),
	`status` enum('draft','calculated','approved','finalized') NOT NULL DEFAULT 'draft',
	`withinLimits` boolean NOT NULL DEFAULT false,
	`warnings` text,
	`approvedBy` int,
	`approvedAt` timestamp,
	`finalizedBy` int,
	`finalizedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `load_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320),
	`openId` varchar(64),
	`ipAddress` varchar(45) NOT NULL,
	`userAgent` text,
	`success` boolean NOT NULL,
	`failureReason` varchar(255),
	`attemptedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `login_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mfa_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`secret` text NOT NULL,
	`isEnabled` boolean NOT NULL DEFAULT false,
	`backupCodes` text NOT NULL,
	`enabledAt` timestamp,
	`lastUsedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mfa_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `mfa_settings_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `ndc_offers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`offerId` varchar(64) NOT NULL,
	`responseId` varchar(64) NOT NULL,
	`originId` int NOT NULL,
	`destinationId` int NOT NULL,
	`departureDate` timestamp NOT NULL,
	`returnDate` timestamp,
	`airlineId` int NOT NULL,
	`fareClassId` int,
	`cabinClass` enum('first','business','premium_economy','economy') NOT NULL,
	`totalPrice` int NOT NULL,
	`basePrice` int NOT NULL,
	`taxesAndFees` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`offerPayload` text NOT NULL,
	`segments` text NOT NULL,
	`bundledServices` text,
	`expiresAt` timestamp NOT NULL,
	`status` enum('active','expired','selected','ordered','cancelled') NOT NULL DEFAULT 'active',
	`ownerCode` varchar(3),
	`channel` enum('direct','ndc_aggregator','gds','ota','travel_agent') NOT NULL DEFAULT 'direct',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ndc_offers_id` PRIMARY KEY(`id`),
	CONSTRAINT `ndc_offers_offerId_unique` UNIQUE(`offerId`)
);
--> statement-breakpoint
CREATE TABLE `ndc_orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` varchar(64) NOT NULL,
	`offerId` varchar(64) NOT NULL,
	`bookingId` int,
	`airlineId` int NOT NULL,
	`passengers` text NOT NULL,
	`contactInfo` text NOT NULL,
	`paymentMethod` varchar(50),
	`totalAmount` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`ticketNumbers` text,
	`emdNumbers` text,
	`status` enum('pending','confirmed','ticketed','partially_ticketed','changed','cancelled','refunded') NOT NULL DEFAULT 'pending',
	`orderPayload` text NOT NULL,
	`lastServicingAction` varchar(50),
	`servicingHistory` text,
	`channel` enum('direct','ndc_aggregator','gds','ota','travel_agent') NOT NULL DEFAULT 'direct',
	`distributorId` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ndc_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `ndc_orders_orderId_unique` UNIQUE(`orderId`)
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
CREATE TABLE `outbox` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` varchar(64) NOT NULL,
	`aggregateType` varchar(64) NOT NULL,
	`aggregateId` varchar(64) NOT NULL,
	`eventType` varchar(100) NOT NULL,
	`tenantId` int,
	`payload` json NOT NULL,
	`status` enum('pending','processing','published','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`lockedAt` timestamp,
	`publishedAt` timestamp,
	CONSTRAINT `outbox_id` PRIMARY KEY(`id`),
	CONSTRAINT `outbox_eventId_unique` UNIQUE(`eventId`)
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
CREATE TABLE `payment_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`paymentId` int NOT NULL,
	`bookingId` int NOT NULL,
	`event` enum('created','processing','completed','failed','refund_initiated','refund_completed','refund_failed','chargeback','disputed','expired') NOT NULL,
	`fromStatus` enum('pending','completed','failed','refunded'),
	`toStatus` enum('pending','completed','failed','refunded') NOT NULL,
	`amount` int,
	`currency` varchar(3) DEFAULT 'SAR',
	`providerReference` varchar(255),
	`metadata` text,
	`initiatedBy` enum('system','user','admin','webhook','cron') NOT NULL DEFAULT 'system',
	`userId` int,
	`ipAddress` varchar(45),
	`userAgent` varchar(500),
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_history_id` PRIMARY KEY(`id`)
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
	CONSTRAINT `price_alerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `price_alerts_user_route_unique_idx` UNIQUE(`userId`,`originId`,`destinationId`,`cabinClass`)
);
--> statement-breakpoint
CREATE TABLE `price_elasticity_data` (
	`id` int AUTO_INCREMENT NOT NULL,
	`originId` int NOT NULL,
	`destinationId` int NOT NULL,
	`cabinClass` enum('economy','business') NOT NULL,
	`segmentId` int,
	`elasticity` decimal(8,4) NOT NULL,
	`sampleSize` int NOT NULL,
	`rSquared` decimal(5,4),
	`minPrice` int NOT NULL,
	`maxPrice` int NOT NULL,
	`optimalPrice` int,
	`periodStart` timestamp NOT NULL,
	`periodEnd` timestamp NOT NULL,
	`modelId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `price_elasticity_data_id` PRIMARY KEY(`id`)
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
CREATE TABLE `pricing_ab_test_exposures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`testId` int NOT NULL,
	`variantId` int NOT NULL,
	`userId` int,
	`sessionId` varchar(128),
	`flightId` int,
	`originalPrice` int,
	`variantPrice` int,
	`converted` boolean NOT NULL DEFAULT false,
	`bookingId` int,
	`revenue` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pricing_ab_test_exposures_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pricing_ab_test_variants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`testId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`isControl` boolean NOT NULL DEFAULT false,
	`pricingStrategy` text NOT NULL,
	`weight` int NOT NULL DEFAULT 50,
	`impressions` int NOT NULL DEFAULT 0,
	`conversions` int NOT NULL DEFAULT 0,
	`totalRevenue` int NOT NULL DEFAULT 0,
	`averageOrderValue` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pricing_ab_test_variants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pricing_ab_tests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`hypothesis` text,
	`airlineId` int,
	`originId` int,
	`destinationId` int,
	`cabinClass` enum('economy','business'),
	`trafficPercentage` int NOT NULL DEFAULT 100,
	`confidenceLevel` decimal(5,4) DEFAULT '0.95',
	`minimumSampleSize` int NOT NULL DEFAULT 100,
	`startDate` timestamp NOT NULL,
	`endDate` timestamp,
	`winnerVariantId` int,
	`conclusionNotes` text,
	`status` enum('draft','running','paused','completed','cancelled') NOT NULL DEFAULT 'draft',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pricing_ab_tests_id` PRIMARY KEY(`id`)
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
CREATE TABLE `revenue_optimization_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightId` int NOT NULL,
	`cabinClass` enum('economy','business') NOT NULL,
	`previousPrice` int NOT NULL,
	`optimizedPrice` int NOT NULL,
	`priceChange` decimal(10,2) NOT NULL,
	`factors` text NOT NULL,
	`modelId` int,
	`predictionId` int,
	`optimizationGoal` enum('maximize_revenue','maximize_load_factor','maximize_yield','balance') NOT NULL DEFAULT 'balance',
	`expectedRevenueImpact` decimal(12,2),
	`actualRevenueImpact` decimal(12,2),
	`autoApplied` boolean NOT NULL DEFAULT false,
	`approvedBy` int,
	`approvedAt` timestamp,
	`status` enum('suggested','approved','applied','rejected','reverted') NOT NULL DEFAULT 'suggested',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `revenue_optimization_logs_id` PRIMARY KEY(`id`)
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
CREATE TABLE `seat_inventory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightId` int NOT NULL,
	`seatMapId` int NOT NULL,
	`seatNumber` varchar(5) NOT NULL,
	`row` int NOT NULL,
	`column` varchar(2) NOT NULL,
	`cabinClass` enum('first','business','premium_economy','economy') NOT NULL,
	`seatType` enum('window','middle','aisle','bulkhead_window','bulkhead_middle','bulkhead_aisle','exit_row_window','exit_row_middle','exit_row_aisle') NOT NULL,
	`hasExtraLegroom` boolean NOT NULL DEFAULT false,
	`hasPowerOutlet` boolean NOT NULL DEFAULT false,
	`isReclinable` boolean NOT NULL DEFAULT true,
	`nearLavatory` boolean NOT NULL DEFAULT false,
	`nearGalley` boolean NOT NULL DEFAULT false,
	`seatPrice` int NOT NULL DEFAULT 0,
	`priceTier` enum('free','standard','preferred','premium','extra_legroom') NOT NULL DEFAULT 'standard',
	`status` enum('available','held','occupied','blocked','restricted','checked_in') NOT NULL DEFAULT 'available',
	`bookingId` int,
	`passengerId` int,
	`assignedAt` timestamp,
	`checkedInAt` timestamp,
	`boardingPassIssued` boolean NOT NULL DEFAULT false,
	`boardingGroup` varchar(5),
	`boardingSequence` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `seat_inventory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `seat_maps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`aircraftType` varchar(50) NOT NULL,
	`airlineId` int NOT NULL,
	`configName` varchar(100) NOT NULL,
	`cabinLayout` text NOT NULL,
	`totalSeats` int NOT NULL,
	`firstClassSeats` int NOT NULL DEFAULT 0,
	`businessSeats` int NOT NULL DEFAULT 0,
	`premiumEconomySeats` int NOT NULL DEFAULT 0,
	`economySeats` int NOT NULL DEFAULT 0,
	`seatPitch` text,
	`seatWidth` text,
	`hasWifi` boolean NOT NULL DEFAULT false,
	`hasPowerOutlets` boolean NOT NULL DEFAULT false,
	`hasIFE` boolean NOT NULL DEFAULT false,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `seat_maps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventType` varchar(100) NOT NULL,
	`severity` varchar(20) NOT NULL,
	`userId` int,
	`ipAddress` varchar(45),
	`userAgent` text,
	`description` text,
	`metadata` text,
	`actionTaken` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `security_events_id` PRIMARY KEY(`id`)
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
CREATE TABLE `tenants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`airlineCode` varchar(3),
	`status` enum('active','suspended','pending') NOT NULL DEFAULT 'active',
	`contactEmail` varchar(320),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenants_slug_unique` UNIQUE(`slug`),
	CONSTRAINT `tenants_slug_idx` UNIQUE(`slug`)
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
	CONSTRAINT `user_flight_favorites_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_flight_favorites_unique_idx` UNIQUE(`userId`,`flightId`)
);
--> statement-breakpoint
CREATE TABLE `voucher_usage` (
	`id` int AUTO_INCREMENT NOT NULL,
	`voucherId` int NOT NULL,
	`userId` int NOT NULL,
	`bookingId` int NOT NULL,
	`discountApplied` int NOT NULL,
	`usedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `voucher_usage_id` PRIMARY KEY(`id`),
	CONSTRAINT `voucher_usage_voucher_booking_unique` UNIQUE(`voucherId`,`bookingId`)
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
DROP INDEX `user_route_favorite_unique` ON `favorite_flights`;--> statement-breakpoint
DROP INDEX `user_flight_unique` ON `flight_reviews`;--> statement-breakpoint
ALTER TABLE `bookings` MODIFY COLUMN `numberOfPassengers` int NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE `payments` MODIFY COLUMN `method` enum('card','wallet','bank_transfer','mada','apple_pay','stc_pay','tabby','tamara') NOT NULL;--> statement-breakpoint
-- Preserve the prior defaults when making existing nullable preferences required.
UPDATE `user_preferences` SET
  `wheelchairAssistance` = COALESCE(`wheelchairAssistance`, false),
  `extraLegroom` = COALESCE(`extraLegroom`, false),
  `emailNotifications` = COALESCE(`emailNotifications`, true),
  `smsNotifications` = COALESCE(`smsNotifications`, false);--> statement-breakpoint
ALTER TABLE `user_preferences` MODIFY COLUMN `wheelchairAssistance` boolean NOT NULL;--> statement-breakpoint
ALTER TABLE `user_preferences` MODIFY COLUMN `extraLegroom` boolean NOT NULL;--> statement-breakpoint
ALTER TABLE `user_preferences` MODIFY COLUMN `emailNotifications` boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE `user_preferences` MODIFY COLUMN `smsNotifications` boolean NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `tenantId` int;--> statement-breakpoint
ALTER TABLE `bookings` ADD `idempotencyKey` varchar(255);--> statement-breakpoint
ALTER TABLE `bookings` ADD `checkInReminderSentAt` timestamp;--> statement-breakpoint
ALTER TABLE `bookings` ADD `deletedAt` timestamp;--> statement-breakpoint
ALTER TABLE `flights` ADD `tenantId` int;--> statement-breakpoint
ALTER TABLE `passengers` ADD `tenantId` int;--> statement-breakpoint
ALTER TABLE `payments` ADD `tenantId` int;--> statement-breakpoint
ALTER TABLE `payments` ADD `provider` enum('stripe','hyperpay','tabby','tamara','stc_pay','moyasar','floosak','jawali','onecash','easycash') DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `providerSessionId` varchar(255);--> statement-breakpoint
ALTER TABLE `payments` ADD `stripePaymentIntentId` varchar(255);--> statement-breakpoint
ALTER TABLE `payments` ADD `providerMetadata` text;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `autoCheckIn` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `tenantId` int;--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(255);--> statement-breakpoint
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_idempotencyKey_unique` UNIQUE(`idempotencyKey`);--> statement-breakpoint
ALTER TABLE `favorite_flights` ADD CONSTRAINT `user_route_favorite_unique` UNIQUE(`userId`,`originId`,`destinationId`,`airlineId`);--> statement-breakpoint
ALTER TABLE `flight_reviews` ADD CONSTRAINT `user_flight_unique` UNIQUE(`userId`,`flightId`);--> statement-breakpoint
CREATE INDEX `account_deletion_requests_user_id_idx` ON `account_deletion_requests` (`userId`);--> statement-breakpoint
CREATE INDEX `account_deletion_requests_status_idx` ON `account_deletion_requests` (`status`);--> statement-breakpoint
CREATE INDEX `account_deletion_requests_scheduled_idx` ON `account_deletion_requests` (`scheduledDeletionAt`);--> statement-breakpoint
CREATE INDEX `account_lock_user_id_idx` ON `account_locks` (`userId`);--> statement-breakpoint
CREATE INDEX `account_lock_is_active_idx` ON `account_locks` (`isActive`);--> statement-breakpoint
CREATE INDEX `agent_bookings_agent_id_idx` ON `agent_bookings` (`agentId`);--> statement-breakpoint
CREATE INDEX `agent_bookings_booking_id_idx` ON `agent_bookings` (`bookingId`);--> statement-breakpoint
CREATE INDEX `agent_bookings_commission_status_idx` ON `agent_bookings` (`commissionStatus`);--> statement-breakpoint
CREATE INDEX `agent_bookings_created_at_idx` ON `agent_bookings` (`createdAt`);--> statement-breakpoint
CREATE INDEX `agent_bookings_agent_commission_idx` ON `agent_bookings` (`agentId`,`commissionStatus`);--> statement-breakpoint
CREATE INDEX `agent_dec_agent_idx` ON `agent_decisions` (`agentId`);--> statement-breakpoint
CREATE INDEX `agent_dec_request_idx` ON `agent_decisions` (`requestId`);--> statement-breakpoint
CREATE INDEX `agent_dec_status_idx` ON `agent_decisions` (`status`);--> statement-breakpoint
CREATE INDEX `agent_dec_created_idx` ON `agent_decisions` (`createdAt`);--> statement-breakpoint
CREATE INDEX `agent_dec_tenant_idx` ON `agent_decisions` (`tenantId`);--> statement-breakpoint
CREATE INDEX `agent_dec_overridden_idx` ON `agent_decisions` (`overridden`);--> statement-breakpoint
CREATE INDEX `ai_gw_agent_idx` ON `ai_gateway_log` (`agentId`);--> statement-breakpoint
CREATE INDEX `ai_gw_model_idx` ON `ai_gateway_log` (`modelId`);--> statement-breakpoint
CREATE INDEX `ai_gw_created_idx` ON `ai_gateway_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `ai_gw_tenant_idx` ON `ai_gateway_log` (`tenantId`);--> statement-breakpoint
CREATE INDEX `ai_gw_feature_idx` ON `ai_gateway_log` (`feature`);--> statement-breakpoint
CREATE INDEX `ai_pricing_models_type_idx` ON `ai_pricing_models` (`modelType`);--> statement-breakpoint
CREATE INDEX `ai_pricing_models_status_idx` ON `ai_pricing_models` (`status`);--> statement-breakpoint
CREATE INDEX `ai_pricing_models_version_idx` ON `ai_pricing_models` (`modelType`,`version`);--> statement-breakpoint
CREATE INDEX `airport_gates_airport_id_idx` ON `airport_gates` (`airportId`);--> statement-breakpoint
CREATE INDEX `airport_gates_gate_number_idx` ON `airport_gates` (`gateNumber`);--> statement-breakpoint
CREATE INDEX `airport_gates_status_idx` ON `airport_gates` (`status`);--> statement-breakpoint
CREATE INDEX `airport_gates_type_idx` ON `airport_gates` (`type`);--> statement-breakpoint
CREATE INDEX `airport_gates_airport_status_idx` ON `airport_gates` (`airportId`,`status`);--> statement-breakpoint
CREATE INDEX `airport_gates_airport_type_idx` ON `airport_gates` (`airportId`,`type`);--> statement-breakpoint
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
CREATE INDEX `booking_segments_booking_id_idx` ON `booking_segments` (`bookingId`);--> statement-breakpoint
CREATE INDEX `booking_segments_flight_id_idx` ON `booking_segments` (`flightId`);--> statement-breakpoint
CREATE INDEX `booking_segments_booking_order_idx` ON `booking_segments` (`bookingId`,`segmentOrder`);--> statement-breakpoint
CREATE INDEX `booking_segments_status_idx` ON `booking_segments` (`status`);--> statement-breakpoint
CREATE INDEX `cs_marketing_airline_idx` ON `codeshare_agreements` (`marketingAirlineId`);--> statement-breakpoint
CREATE INDEX `cs_operating_airline_idx` ON `codeshare_agreements` (`operatingAirlineId`);--> statement-breakpoint
CREATE INDEX `cs_status_idx` ON `codeshare_agreements` (`status`);--> statement-breakpoint
CREATE INDEX `cs_agreement_ref_idx` ON `codeshare_agreements` (`agreementReference`);--> statement-breakpoint
CREATE INDEX `cs_validity_idx` ON `codeshare_agreements` (`validFrom`,`validUntil`);--> statement-breakpoint
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
CREATE INDEX `corporate_users_is_active_idx` ON `corporate_users` (`isActive`);--> statement-breakpoint
CREATE INDEX `credit_usage_user_credit_id_idx` ON `credit_usage` (`userCreditId`);--> statement-breakpoint
CREATE INDEX `credit_usage_user_id_idx` ON `credit_usage` (`userId`);--> statement-breakpoint
CREATE INDEX `credit_usage_booking_id_idx` ON `credit_usage` (`bookingId`);--> statement-breakpoint
CREATE INDEX `credit_usage_used_at_idx` ON `credit_usage` (`usedAt`);--> statement-breakpoint
CREATE INDEX `crew_assign_flight_idx` ON `crew_assignments` (`flightId`);--> statement-breakpoint
CREATE INDEX `crew_assign_crew_idx` ON `crew_assignments` (`crewMemberId`);--> statement-breakpoint
CREATE INDEX `crew_assign_flight_crew_idx` ON `crew_assignments` (`flightId`,`crewMemberId`);--> statement-breakpoint
CREATE INDEX `crew_airline_idx` ON `crew_members` (`airlineId`);--> statement-breakpoint
CREATE INDEX `crew_role_idx` ON `crew_members` (`role`);--> statement-breakpoint
CREATE INDEX `crew_status_idx` ON `crew_members` (`status`);--> statement-breakpoint
CREATE INDEX `currencies_code_idx` ON `currencies` (`code`);--> statement-breakpoint
CREATE INDEX `currencies_active_idx` ON `currencies` (`isActive`);--> statement-breakpoint
CREATE INDEX `segment_assignments_user_idx` ON `customer_segment_assignments` (`userId`);--> statement-breakpoint
CREATE INDEX `segment_assignments_segment_idx` ON `customer_segment_assignments` (`segmentId`);--> statement-breakpoint
CREATE INDEX `segment_assignments_active_idx` ON `customer_segment_assignments` (`isActive`);--> statement-breakpoint
CREATE INDEX `customer_segments_type_idx` ON `customer_segments` (`segmentType`);--> statement-breakpoint
CREATE INDEX `customer_segments_active_idx` ON `customer_segments` (`isActive`);--> statement-breakpoint
CREATE INDEX `data_export_requests_user_id_idx` ON `data_export_requests` (`userId`);--> statement-breakpoint
CREATE INDEX `data_export_requests_status_idx` ON `data_export_requests` (`status`);--> statement-breakpoint
CREATE INDEX `data_export_requests_requested_at_idx` ON `data_export_requests` (`requestedAt`);--> statement-breakpoint
CREATE INDEX `demand_predictions_model_idx` ON `demand_predictions` (`modelId`);--> statement-breakpoint
CREATE INDEX `demand_predictions_flight_idx` ON `demand_predictions` (`flightId`);--> statement-breakpoint
CREATE INDEX `demand_predictions_route_idx` ON `demand_predictions` (`originId`,`destinationId`);--> statement-breakpoint
CREATE INDEX `demand_predictions_date_idx` ON `demand_predictions` (`predictionDate`);--> statement-breakpoint
CREATE INDEX `demand_predictions_cabin_idx` ON `demand_predictions` (`cabinClass`);--> statement-breakpoint
CREATE INDEX `denied_boarding_flight_idx` ON `denied_boarding_records` (`flightId`);--> statement-breakpoint
CREATE INDEX `denied_boarding_user_idx` ON `denied_boarding_records` (`userId`);--> statement-breakpoint
CREATE INDEX `denied_boarding_status_idx` ON `denied_boarding_records` (`status`);--> statement-breakpoint
CREATE INDEX `emd_number_idx` ON `electronic_misc_docs` (`emdNumber`);--> statement-breakpoint
CREATE INDEX `emd_booking_idx` ON `electronic_misc_docs` (`bookingId`);--> statement-breakpoint
CREATE INDEX `emd_passenger_idx` ON `electronic_misc_docs` (`passengerId`);--> statement-breakpoint
CREATE INDEX `emd_ticket_idx` ON `electronic_misc_docs` (`ticketNumber`);--> statement-breakpoint
CREATE INDEX `emd_airline_idx` ON `electronic_misc_docs` (`issuingAirlineId`);--> statement-breakpoint
CREATE INDEX `emd_status_idx` ON `electronic_misc_docs` (`status`);--> statement-breakpoint
CREATE INDEX `emd_type_idx` ON `electronic_misc_docs` (`emdType`);--> statement-breakpoint
CREATE INDEX `emd_reason_idx` ON `electronic_misc_docs` (`reasonForIssuance`);--> statement-breakpoint
CREATE INDEX `exchange_rates_pair_idx` ON `exchange_rates` (`fromCurrency`,`toCurrency`);--> statement-breakpoint
CREATE INDEX `exchange_rates_valid_idx` ON `exchange_rates` (`validFrom`);--> statement-breakpoint
CREATE INDEX `family_group_members_group_idx` ON `family_group_members` (`groupId`);--> statement-breakpoint
CREATE INDEX `family_group_members_user_idx` ON `family_group_members` (`userId`);--> statement-breakpoint
CREATE INDEX `family_group_members_status_idx` ON `family_group_members` (`status`);--> statement-breakpoint
CREATE INDEX `family_group_members_group_user_idx` ON `family_group_members` (`groupId`,`userId`);--> statement-breakpoint
CREATE INDEX `family_groups_owner_idx` ON `family_groups` (`ownerId`);--> statement-breakpoint
CREATE INDEX `family_groups_status_idx` ON `family_groups` (`status`);--> statement-breakpoint
CREATE INDEX `fare_class_airline_idx` ON `fare_classes` (`airlineId`);--> statement-breakpoint
CREATE INDEX `fare_class_code_idx` ON `fare_classes` (`airlineId`,`code`);--> statement-breakpoint
CREATE INDEX `fare_class_cabin_idx` ON `fare_classes` (`cabinClass`);--> statement-breakpoint
CREATE INDEX `fare_class_family_idx` ON `fare_classes` (`fareFamily`);--> statement-breakpoint
CREATE INDEX `fare_class_active_idx` ON `fare_classes` (`active`);--> statement-breakpoint
CREATE INDEX `fare_rule_fare_class_idx` ON `fare_rules` (`fareClassId`);--> statement-breakpoint
CREATE INDEX `fare_rule_airline_idx` ON `fare_rules` (`airlineId`);--> statement-breakpoint
CREATE INDEX `fare_rule_category_idx` ON `fare_rules` (`ruleCategory`);--> statement-breakpoint
CREATE INDEX `fare_rule_route_idx` ON `fare_rules` (`originAirportId`,`destinationAirportId`);--> statement-breakpoint
CREATE INDEX `fare_rule_validity_idx` ON `fare_rules` (`validFrom`,`validUntil`);--> statement-breakpoint
CREATE INDEX `fare_rule_active_idx` ON `fare_rules` (`active`);--> statement-breakpoint
CREATE INDEX `financial_ledger_booking_id_idx` ON `financial_ledger` (`bookingId`);--> statement-breakpoint
CREATE INDEX `financial_ledger_user_id_idx` ON `financial_ledger` (`userId`);--> statement-breakpoint
CREATE INDEX `financial_ledger_type_idx` ON `financial_ledger` (`type`);--> statement-breakpoint
CREATE INDEX `financial_ledger_stripe_event_id_idx` ON `financial_ledger` (`stripeEventId`);--> statement-breakpoint
CREATE INDEX `financial_ledger_transaction_date_idx` ON `financial_ledger` (`transactionDate`);--> statement-breakpoint
CREATE INDEX `flight_disruptions_flight_idx` ON `flight_disruptions` (`flightId`);--> statement-breakpoint
CREATE INDEX `flight_disruptions_type_idx` ON `flight_disruptions` (`type`);--> statement-breakpoint
CREATE INDEX `flight_disruptions_status_idx` ON `flight_disruptions` (`status`);--> statement-breakpoint
CREATE INDEX `flight_disruptions_created_at_idx` ON `flight_disruptions` (`createdAt`);--> statement-breakpoint
CREATE INDEX `flight_tracking_flight_idx` ON `flight_tracking` (`flightId`);--> statement-breakpoint
CREATE INDEX `flight_tracking_recorded_idx` ON `flight_tracking` (`recordedAt`);--> statement-breakpoint
CREATE INDEX `flight_tracking_flight_recorded_idx` ON `flight_tracking` (`flightId`,`recordedAt`);--> statement-breakpoint
CREATE INDEX `fraud_assess_booking_idx` ON `fraud_assessments` (`bookingId`);--> statement-breakpoint
CREATE INDEX `fraud_assess_user_idx` ON `fraud_assessments` (`userId`);--> statement-breakpoint
CREATE INDEX `fraud_assess_risk_idx` ON `fraud_assessments` (`riskLevel`);--> statement-breakpoint
CREATE INDEX `fraud_assess_created_idx` ON `fraud_assessments` (`createdAt`);--> statement-breakpoint
CREATE INDEX `gate_assignments_flight_id_idx` ON `gate_assignments` (`flightId`);--> statement-breakpoint
CREATE INDEX `gate_assignments_gate_id_idx` ON `gate_assignments` (`gateId`);--> statement-breakpoint
CREATE INDEX `gate_assignments_status_idx` ON `gate_assignments` (`status`);--> statement-breakpoint
CREATE INDEX `gate_assignments_assigned_by_idx` ON `gate_assignments` (`assignedBy`);--> statement-breakpoint
CREATE INDEX `gate_assignments_boarding_start_idx` ON `gate_assignments` (`boardingStartTime`);--> statement-breakpoint
CREATE INDEX `gate_assignments_gate_status_idx` ON `gate_assignments` (`gateId`,`status`);--> statement-breakpoint
CREATE INDEX `gate_assignments_flight_status_idx` ON `gate_assignments` (`flightId`,`status`);--> statement-breakpoint
CREATE INDEX `gate_assignments_assigned_at_idx` ON `gate_assignments` (`assignedAt`);--> statement-breakpoint
CREATE INDEX `gds_provider_idx` ON `gds_connections` (`provider`);--> statement-breakpoint
CREATE INDEX `gds_airline_idx` ON `gds_connections` (`airlineId`);--> statement-breakpoint
CREATE INDEX `gds_status_idx` ON `gds_connections` (`status`);--> statement-breakpoint
CREATE INDEX `gds_provider_airline_idx` ON `gds_connections` (`provider`,`airlineId`);--> statement-breakpoint
CREATE INDEX `gds_msg_connection_idx` ON `gds_messages` (`connectionId`);--> statement-breakpoint
CREATE INDEX `gds_msg_provider_idx` ON `gds_messages` (`provider`);--> statement-breakpoint
CREATE INDEX `gds_msg_type_idx` ON `gds_messages` (`messageType`);--> statement-breakpoint
CREATE INDEX `gds_msg_correlation_idx` ON `gds_messages` (`correlationId`);--> statement-breakpoint
CREATE INDEX `gds_msg_status_idx` ON `gds_messages` (`status`);--> statement-breakpoint
CREATE INDEX `gds_msg_created_idx` ON `gds_messages` (`createdAt`);--> statement-breakpoint
CREATE INDEX `group_bookings_organizer_email_idx` ON `group_bookings` (`organizerEmail`);--> statement-breakpoint
CREATE INDEX `group_bookings_flight_id_idx` ON `group_bookings` (`flightId`);--> statement-breakpoint
CREATE INDEX `group_bookings_status_idx` ON `group_bookings` (`status`);--> statement-breakpoint
CREATE INDEX `group_bookings_created_at_idx` ON `group_bookings` (`createdAt`);--> statement-breakpoint
CREATE INDEX `group_bookings_status_created_at_idx` ON `group_bookings` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idempotency_scope_key_idx` ON `idempotency_requests` (`scope`,`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `idempotency_status_idx` ON `idempotency_requests` (`status`);--> statement-breakpoint
CREATE INDEX `idempotency_expires_at_idx` ON `idempotency_requests` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `intel_brief_request_idx` ON `intelligence_briefings` (`requestId`);--> statement-breakpoint
CREATE INDEX `intel_brief_health_idx` ON `intelligence_briefings` (`overallHealth`);--> statement-breakpoint
CREATE INDEX `intel_brief_created_idx` ON `intelligence_briefings` (`createdAt`);--> statement-breakpoint
CREATE INDEX `il_airline1_idx` ON `interline_agreements` (`airline1Id`);--> statement-breakpoint
CREATE INDEX `il_airline2_idx` ON `interline_agreements` (`airline2Id`);--> statement-breakpoint
CREATE INDEX `il_status_idx` ON `interline_agreements` (`status`);--> statement-breakpoint
CREATE INDEX `il_agreement_ref_idx` ON `interline_agreements` (`agreementReference`);--> statement-breakpoint
CREATE INDEX `il_type_idx` ON `interline_agreements` (`agreementType`);--> statement-breakpoint
CREATE INDEX `inventory_snapshots_flight_idx` ON `inventory_snapshots` (`flightId`);--> statement-breakpoint
CREATE INDEX `inventory_snapshots_date_idx` ON `inventory_snapshots` (`snapshotDate`);--> statement-breakpoint
CREATE INDEX `inventory_snapshots_flight_date_idx` ON `inventory_snapshots` (`flightId`,`snapshotDate`);--> statement-breakpoint
CREATE INDEX `ip_blacklist_ip_address_idx` ON `ip_blacklist` (`ipAddress`);--> statement-breakpoint
CREATE INDEX `ip_blacklist_is_active_idx` ON `ip_blacklist` (`isActive`);--> statement-breakpoint
CREATE INDEX `load_plan_flight_idx` ON `load_plans` (`flightId`);--> statement-breakpoint
CREATE INDEX `load_plan_status_idx` ON `load_plans` (`status`);--> statement-breakpoint
CREATE INDEX `login_email_idx` ON `login_attempts` (`email`);--> statement-breakpoint
CREATE INDEX `login_open_id_idx` ON `login_attempts` (`openId`);--> statement-breakpoint
CREATE INDEX `login_ip_address_idx` ON `login_attempts` (`ipAddress`);--> statement-breakpoint
CREATE INDEX `login_attempted_at_idx` ON `login_attempts` (`attemptedAt`);--> statement-breakpoint
CREATE INDEX `ndc_offer_id_idx` ON `ndc_offers` (`offerId`);--> statement-breakpoint
CREATE INDEX `ndc_offer_response_idx` ON `ndc_offers` (`responseId`);--> statement-breakpoint
CREATE INDEX `ndc_offer_route_idx` ON `ndc_offers` (`originId`,`destinationId`);--> statement-breakpoint
CREATE INDEX `ndc_offer_airline_idx` ON `ndc_offers` (`airlineId`);--> statement-breakpoint
CREATE INDEX `ndc_offer_status_idx` ON `ndc_offers` (`status`);--> statement-breakpoint
CREATE INDEX `ndc_offer_expires_idx` ON `ndc_offers` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `ndc_offer_channel_idx` ON `ndc_offers` (`channel`);--> statement-breakpoint
CREATE INDEX `ndc_order_id_idx` ON `ndc_orders` (`orderId`);--> statement-breakpoint
CREATE INDEX `ndc_order_offer_idx` ON `ndc_orders` (`offerId`);--> statement-breakpoint
CREATE INDEX `ndc_order_booking_idx` ON `ndc_orders` (`bookingId`);--> statement-breakpoint
CREATE INDEX `ndc_order_airline_idx` ON `ndc_orders` (`airlineId`);--> statement-breakpoint
CREATE INDEX `ndc_order_status_idx` ON `ndc_orders` (`status`);--> statement-breakpoint
CREATE INDEX `ndc_order_channel_idx` ON `ndc_orders` (`channel`);--> statement-breakpoint
CREATE INDEX `notifications_user_id_idx` ON `notifications` (`userId`);--> statement-breakpoint
CREATE INDEX `notifications_type_idx` ON `notifications` (`type`);--> statement-breakpoint
CREATE INDEX `notifications_is_read_idx` ON `notifications` (`isRead`);--> statement-breakpoint
CREATE INDEX `notifications_created_at_idx` ON `notifications` (`createdAt`);--> statement-breakpoint
CREATE INDEX `notifications_user_unread_idx` ON `notifications` (`userId`,`isRead`,`createdAt`);--> statement-breakpoint
CREATE INDEX `outbox_status_idx` ON `outbox` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `outbox_aggregate_idx` ON `outbox` (`aggregateType`,`aggregateId`);--> statement-breakpoint
CREATE INDEX `outbox_tenant_idx` ON `outbox` (`tenantId`);--> statement-breakpoint
CREATE INDEX `overbooking_route_idx` ON `overbooking_config` (`originId`,`destinationId`);--> statement-breakpoint
CREATE INDEX `overbooking_airline_idx` ON `overbooking_config` (`airlineId`);--> statement-breakpoint
CREATE INDEX `overbooking_active_idx` ON `overbooking_config` (`isActive`);--> statement-breakpoint
CREATE INDEX `payment_history_payment_id_idx` ON `payment_history` (`paymentId`);--> statement-breakpoint
CREATE INDEX `payment_history_booking_id_idx` ON `payment_history` (`bookingId`);--> statement-breakpoint
CREATE INDEX `payment_history_event_idx` ON `payment_history` (`event`);--> statement-breakpoint
CREATE INDEX `payment_history_created_at_idx` ON `payment_history` (`createdAt`);--> statement-breakpoint
CREATE INDEX `payment_history_payment_event_idx` ON `payment_history` (`paymentId`,`event`);--> statement-breakpoint
CREATE INDEX `payment_splits_booking_id_idx` ON `payment_splits` (`bookingId`);--> statement-breakpoint
CREATE INDEX `payment_splits_payer_email_idx` ON `payment_splits` (`payerEmail`);--> statement-breakpoint
CREATE INDEX `payment_splits_status_idx` ON `payment_splits` (`status`);--> statement-breakpoint
CREATE INDEX `payment_splits_token_idx` ON `payment_splits` (`paymentToken`);--> statement-breakpoint
CREATE INDEX `payment_splits_booking_status_idx` ON `payment_splits` (`bookingId`,`status`);--> statement-breakpoint
CREATE INDEX `payment_splits_expires_at_idx` ON `payment_splits` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `payment_splits_stripe_checkout_idx` ON `payment_splits` (`stripeCheckoutSessionId`);--> statement-breakpoint
CREATE INDEX `price_alerts_user_id_idx` ON `price_alerts` (`userId`);--> statement-breakpoint
CREATE INDEX `price_alerts_route_idx` ON `price_alerts` (`originId`,`destinationId`);--> statement-breakpoint
CREATE INDEX `price_alerts_active_idx` ON `price_alerts` (`isActive`);--> statement-breakpoint
CREATE INDEX `price_alerts_last_checked_idx` ON `price_alerts` (`lastChecked`);--> statement-breakpoint
CREATE INDEX `price_elasticity_route_idx` ON `price_elasticity_data` (`originId`,`destinationId`);--> statement-breakpoint
CREATE INDEX `price_elasticity_cabin_idx` ON `price_elasticity_data` (`cabinClass`);--> statement-breakpoint
CREATE INDEX `price_elasticity_segment_idx` ON `price_elasticity_data` (`segmentId`);--> statement-breakpoint
CREATE INDEX `price_locks_user_idx` ON `price_locks` (`userId`);--> statement-breakpoint
CREATE INDEX `price_locks_flight_idx` ON `price_locks` (`flightId`);--> statement-breakpoint
CREATE INDEX `price_locks_status_idx` ON `price_locks` (`status`);--> statement-breakpoint
CREATE INDEX `price_locks_expires_at_idx` ON `price_locks` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `price_locks_user_flight_idx` ON `price_locks` (`userId`,`flightId`,`cabinClass`);--> statement-breakpoint
CREATE INDEX `ab_test_exposures_test_idx` ON `pricing_ab_test_exposures` (`testId`);--> statement-breakpoint
CREATE INDEX `ab_test_exposures_variant_idx` ON `pricing_ab_test_exposures` (`variantId`);--> statement-breakpoint
CREATE INDEX `ab_test_exposures_user_idx` ON `pricing_ab_test_exposures` (`userId`);--> statement-breakpoint
CREATE INDEX `ab_test_exposures_session_idx` ON `pricing_ab_test_exposures` (`sessionId`);--> statement-breakpoint
CREATE INDEX `ab_test_exposures_converted_idx` ON `pricing_ab_test_exposures` (`converted`);--> statement-breakpoint
CREATE INDEX `ab_test_variants_test_idx` ON `pricing_ab_test_variants` (`testId`);--> statement-breakpoint
CREATE INDEX `ab_test_variants_control_idx` ON `pricing_ab_test_variants` (`isControl`);--> statement-breakpoint
CREATE INDEX `pricing_ab_tests_status_idx` ON `pricing_ab_tests` (`status`);--> statement-breakpoint
CREATE INDEX `pricing_ab_tests_date_idx` ON `pricing_ab_tests` (`startDate`,`endDate`);--> statement-breakpoint
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
CREATE INDEX `revenue_opt_logs_flight_idx` ON `revenue_optimization_logs` (`flightId`);--> statement-breakpoint
CREATE INDEX `revenue_opt_logs_status_idx` ON `revenue_optimization_logs` (`status`);--> statement-breakpoint
CREATE INDEX `revenue_opt_logs_goal_idx` ON `revenue_optimization_logs` (`optimizationGoal`);--> statement-breakpoint
CREATE INDEX `revenue_opt_logs_model_idx` ON `revenue_optimization_logs` (`modelId`);--> statement-breakpoint
CREATE INDEX `revenue_opt_logs_created_idx` ON `revenue_optimization_logs` (`createdAt`);--> statement-breakpoint
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
CREATE INDEX `seat_inv_flight_idx` ON `seat_inventory` (`flightId`);--> statement-breakpoint
CREATE INDEX `seat_inv_seat_map_idx` ON `seat_inventory` (`seatMapId`);--> statement-breakpoint
CREATE INDEX `seat_inv_seat_number_idx` ON `seat_inventory` (`flightId`,`seatNumber`);--> statement-breakpoint
CREATE INDEX `seat_inv_status_idx` ON `seat_inventory` (`status`);--> statement-breakpoint
CREATE INDEX `seat_inv_booking_idx` ON `seat_inventory` (`bookingId`);--> statement-breakpoint
CREATE INDEX `seat_inv_passenger_idx` ON `seat_inventory` (`passengerId`);--> statement-breakpoint
CREATE INDEX `seat_inv_cabin_idx` ON `seat_inventory` (`flightId`,`cabinClass`,`status`);--> statement-breakpoint
CREATE INDEX `seat_map_aircraft_idx` ON `seat_maps` (`aircraftType`);--> statement-breakpoint
CREATE INDEX `seat_map_airline_idx` ON `seat_maps` (`airlineId`);--> statement-breakpoint
CREATE INDEX `seat_map_active_idx` ON `seat_maps` (`active`);--> statement-breakpoint
CREATE INDEX `security_event_type_idx` ON `security_events` (`eventType`);--> statement-breakpoint
CREATE INDEX `security_severity_idx` ON `security_events` (`severity`);--> statement-breakpoint
CREATE INDEX `security_user_id_idx` ON `security_events` (`userId`);--> statement-breakpoint
CREATE INDEX `security_ip_address_idx` ON `security_events` (`ipAddress`);--> statement-breakpoint
CREATE INDEX `security_created_at_idx` ON `security_events` (`createdAt`);--> statement-breakpoint
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
CREATE INDEX `tenants_status_idx` ON `tenants` (`status`);--> statement-breakpoint
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
CREATE INDEX `voucher_usage_voucher_id_idx` ON `voucher_usage` (`voucherId`);--> statement-breakpoint
CREATE INDEX `voucher_usage_user_id_idx` ON `voucher_usage` (`userId`);--> statement-breakpoint
CREATE INDEX `voucher_usage_booking_id_idx` ON `voucher_usage` (`bookingId`);--> statement-breakpoint
CREATE INDEX `voucher_usage_used_at_idx` ON `voucher_usage` (`usedAt`);--> statement-breakpoint
CREATE INDEX `vouchers_code_idx` ON `vouchers` (`code`);--> statement-breakpoint
CREATE INDEX `vouchers_is_active_idx` ON `vouchers` (`isActive`);--> statement-breakpoint
CREATE INDEX `vouchers_valid_from_idx` ON `vouchers` (`validFrom`);--> statement-breakpoint
CREATE INDEX `vouchers_valid_until_idx` ON `vouchers` (`validUntil`);--> statement-breakpoint
CREATE INDEX `vouchers_active_valid_idx` ON `vouchers` (`isActive`,`validFrom`,`validUntil`);--> statement-breakpoint
CREATE INDEX `waitlist_flight_idx` ON `waitlist` (`flightId`);--> statement-breakpoint
CREATE INDEX `waitlist_user_idx` ON `waitlist` (`userId`);--> statement-breakpoint
CREATE INDEX `waitlist_status_idx` ON `waitlist` (`status`);--> statement-breakpoint
CREATE INDEX `waitlist_booking_id_idx` ON `waitlist` (`bookingId`);--> statement-breakpoint
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
CREATE INDEX `helpful_review_user_idx` ON `review_helpful_votes` (`reviewId`,`userId`);--> statement-breakpoint
CREATE INDEX `airlines_active_idx` ON `airlines` (`active`);--> statement-breakpoint
CREATE INDEX `airlines_country_idx` ON `airlines` (`country`);--> statement-breakpoint
CREATE INDEX `airlines_active_country_idx` ON `airlines` (`active`,`country`);--> statement-breakpoint
CREATE INDEX `airports_city_idx` ON `airports` (`city`);--> statement-breakpoint
CREATE INDEX `airports_country_idx` ON `airports` (`country`);--> statement-breakpoint
CREATE INDEX `airports_country_city_idx` ON `airports` (`country`,`city`);--> statement-breakpoint
CREATE INDEX `bookings_tenant_idx` ON `bookings` (`tenantId`);--> statement-breakpoint
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
CREATE INDEX `bookings_deleted_at_idx` ON `bookings` (`deletedAt`);--> statement-breakpoint
CREATE INDEX `flight_status_history_flight_idx` ON `flight_status_history` (`flightId`);--> statement-breakpoint
CREATE INDEX `flight_status_history_new_status_idx` ON `flight_status_history` (`newStatus`);--> statement-breakpoint
CREATE INDEX `flight_status_history_changed_by_idx` ON `flight_status_history` (`changedBy`);--> statement-breakpoint
CREATE INDEX `flight_status_history_created_at_idx` ON `flight_status_history` (`createdAt`);--> statement-breakpoint
CREATE INDEX `flight_status_history_flight_created_idx` ON `flight_status_history` (`flightId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `flights_tenant_idx` ON `flights` (`tenantId`);--> statement-breakpoint
CREATE INDEX `passengers_ticket_number_idx` ON `passengers` (`ticketNumber`);--> statement-breakpoint
CREATE INDEX `passengers_passport_idx` ON `passengers` (`passportNumber`);--> statement-breakpoint
CREATE INDEX `passengers_tenant_idx` ON `passengers` (`tenantId`);--> statement-breakpoint
CREATE INDEX `passengers_name_idx` ON `passengers` (`lastName`,`firstName`);--> statement-breakpoint
CREATE INDEX `passengers_type_idx` ON `passengers` (`type`);--> statement-breakpoint
CREATE INDEX `payments_tenant_idx` ON `payments` (`tenantId`);--> statement-breakpoint
CREATE INDEX `payments_status_idx` ON `payments` (`status`);--> statement-breakpoint
CREATE INDEX `payments_stripe_payment_intent_idx` ON `payments` (`stripePaymentIntentId`);--> statement-breakpoint
CREATE INDEX `payments_transaction_id_idx` ON `payments` (`transactionId`);--> statement-breakpoint
CREATE INDEX `payments_created_at_idx` ON `payments` (`createdAt`);--> statement-breakpoint
CREATE INDEX `payments_status_created_at_idx` ON `payments` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `payments_method_idx` ON `payments` (`method`);--> statement-breakpoint
CREATE INDEX `payments_provider_idx` ON `payments` (`provider`);--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role`);--> statement-breakpoint
CREATE INDEX `users_tenant_idx` ON `users` (`tenantId`);--> statement-breakpoint
CREATE INDEX `users_created_at_idx` ON `users` (`createdAt`);--> statement-breakpoint
CREATE INDEX `users_role_created_at_idx` ON `users` (`role`,`createdAt`);