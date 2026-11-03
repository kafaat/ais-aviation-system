CREATE TABLE `aircraft_balance_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airlineId` int NOT NULL,
	`aircraftTypeId` int NOT NULL,
	`version` varchar(50) NOT NULL,
	`referenceStationMm` decimal(12,3) NOT NULL,
	`lemacMm` decimal(12,3) NOT NULL,
	`macLengthMm` decimal(12,3) NOT NULL,
	`indexConstant` decimal(12,4) NOT NULL,
	`indexCoefficient` decimal(16,8) NOT NULL,
	`maxLmcWeightKg` decimal(12,3) NOT NULL,
	`maxLmcIndex` decimal(12,4) NOT NULL,
	`envelope` json NOT NULL,
	`status` enum('draft','accepted','suspended') NOT NULL DEFAULT 'draft',
	`evidenceId` int,
	`approvedBy` int,
	`approvedAt` timestamp,
	`effectiveFrom` datetime NOT NULL,
	`effectiveTo` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `aircraft_balance_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `aircraft_balance_profile_version_idx` UNIQUE(`airlineId`,`aircraftTypeId`,`version`)
);
--> statement-breakpoint
CREATE TABLE `aircraft_registrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`airlineId` int NOT NULL,
	`aircraftTypeId` int NOT NULL,
	`registration` varchar(20) NOT NULL,
	`dataVersion` varchar(50) NOT NULL,
	`dryOperatingWeightKg` decimal(12,3) NOT NULL,
	`dryOperatingIndex` decimal(12,4) NOT NULL,
	`effectiveFrom` datetime NOT NULL,
	`effectiveTo` datetime,
	`status` enum('draft','accepted','suspended') NOT NULL DEFAULT 'draft',
	`evidenceId` int,
	`approvedBy` int,
	`approvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `aircraft_registrations_id` PRIMARY KEY(`id`),
	CONSTRAINT `aircraft_registration_idx` UNIQUE(`airlineId`,`registration`,`dataVersion`)
);
--> statement-breakpoint
CREATE TABLE `booking_fare_components` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`tenantId` int,
	`passengerId` int,
	`bookingSegmentId` int,
	`flightId` int NOT NULL,
	`componentType` enum('base_fare','tax','carrier_surcharge','booking_fee','ancillary','discount','unclassified') NOT NULL,
	`code` varchar(32),
	`amount` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`source` enum('retail_offer','group_allocation','price_lock','ancillary_catalog','servicing') NOT NULL,
	`sourceReference` varchar(64),
	`policyVersion` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`reversedAt` timestamp,
	CONSTRAINT `booking_fare_components_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `flight_fare_class_inventory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightId` int NOT NULL,
	`fareClassId` int NOT NULL,
	`capacity` int NOT NULL,
	`availableSeats` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `flight_fare_class_inventory_id` PRIMARY KEY(`id`),
	CONSTRAINT `flight_fare_class_inventory_unique` UNIQUE(`flightId`,`fareClassId`)
);
--> statement-breakpoint
CREATE TABLE `load_sheet_documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flightId` int NOT NULL,
	`aircraftRegistrationId` int NOT NULL,
	`balanceProfileId` int NOT NULL,
	`edition` int NOT NULL,
	`status` enum('draft','signed_draft','superseded') NOT NULL DEFAULT 'draft',
	`inputs` json NOT NULL,
	`result` json NOT NULL,
	`digestSha256` varchar(64) NOT NULL,
	`signature` varchar(128),
	`signedBy` int,
	`signedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `load_sheet_documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `load_sheet_flight_edition_idx` UNIQUE(`flightId`,`edition`),
	CONSTRAINT `load_sheet_digest_idx` UNIQUE(`digestSha256`)
);
--> statement-breakpoint
CREATE TABLE `loyalty_contract_liability_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`policyProfileId` int NOT NULL,
	`bookingId` int,
	`userId` int NOT NULL,
	`idempotencyKey` varchar(191) NOT NULL,
	`eventType` enum('allocate','redeem','expire','reverse','breakage_reestimate') NOT NULL,
	`miles` int NOT NULL,
	`allocatedAmountMinor` int NOT NULL,
	`expectedBreakageMinor` int NOT NULL,
	`recognizedAmountMinor` int NOT NULL,
	`deferredAmountAfterMinor` int NOT NULL,
	`currency` varchar(3) NOT NULL,
	`evidence` json NOT NULL,
	`occurredAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `loyalty_contract_liability_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `loyalty_liability_event_idempotency_unique` UNIQUE(`tenantId`,`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `loyalty_policy_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`version` varchar(64) NOT NULL,
	`status` enum('draft','approved','retired') NOT NULL DEFAULT 'draft',
	`expiryMode` enum('none','fixed','activity') NOT NULL DEFAULT 'none',
	`expiryMonths` int,
	`mileStandaloneValueMinor` int NOT NULL,
	`expectedBreakageBasisPoints` int NOT NULL DEFAULT 0,
	`currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`sourceReferences` json NOT NULL,
	`effectiveAt` timestamp NOT NULL,
	`approvedBy` int,
	`approvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `loyalty_policy_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `loyalty_policy_tenant_version_unique` UNIQUE(`tenantId`,`version`)
);
--> statement-breakpoint
CREATE TABLE `passenger_rights_policy_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`jurisdiction` varchar(32) NOT NULL,
	`version` varchar(64) NOT NULL,
	`status` enum('draft','approved','retired') NOT NULL DEFAULT 'draft',
	`sourceUri` varchar(1000) NOT NULL,
	`sourcePublishedAt` timestamp,
	`effectiveAt` timestamp NOT NULL,
	`rules` json NOT NULL,
	`approvedBy` int,
	`approvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `passenger_rights_policy_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `passenger_rights_policy_version_unique` UNIQUE(`tenantId`,`jurisdiction`,`version`)
);
--> statement-breakpoint
CREATE TABLE `zatca_invoice_drafts` (
	`id` varchar(36) NOT NULL,
	`bookingId` int NOT NULL,
	`tenantId` int,
	`invoiceNumber` varchar(64) NOT NULL,
	`documentType` enum('simplified','standard') NOT NULL DEFAULT 'simplified',
	`status` enum('draft','ready_for_egs','reported','cleared','rejected') NOT NULL DEFAULT 'draft',
	`currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`issueTimestamp` datetime NOT NULL,
	`supplyTimestamp` datetime NOT NULL,
	`sellerName` varchar(255) NOT NULL,
	`sellerVatNumber` varchar(32) NOT NULL,
	`taxableAmount` int NOT NULL,
	`taxAmount` int NOT NULL,
	`totalAmount` int NOT NULL,
	`previewQrPayload` text NOT NULL,
	`previewQrSha256` varchar(64) NOT NULL,
	`componentDigest` varchar(64) NOT NULL,
	`egsAcceptanceEvidenceId` varchar(128),
	`authorityUuid` varchar(36),
	`authorityResponse` json,
	`reportedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `zatca_invoice_drafts_id` PRIMARY KEY(`id`),
	CONSTRAINT `zatca_invoice_drafts_invoiceNumber_unique` UNIQUE(`invoiceNumber`)
);
--> statement-breakpoint
CREATE TABLE `operational_message_routes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenant_id` int NOT NULL,
	`station_code` varchar(3) NOT NULL,
	`message_type` varchar(12) NOT NULL,
	`origin_address` varchar(7) NOT NULL,
	`destination_address` varchar(7) NOT NULL,
	`transport_profile` varchar(64) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`accepted_at` timestamp,
	`accepted_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `operational_message_routes_id` PRIMARY KEY(`id`),
	CONSTRAINT `operational_message_route_unique` UNIQUE(`tenant_id`,`station_code`,`message_type`)
);
--> statement-breakpoint
CREATE TABLE `operational_message_transmissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenant_id` int NOT NULL,
	`flight_id` int,
	`route_id` int,
	`message_type` varchar(12) NOT NULL,
	`direction` enum('outbound','inbound') NOT NULL,
	`idempotency_key` varchar(128) NOT NULL,
	`message_digest` varchar(64) NOT NULL,
	`message_content` longtext NOT NULL,
	`status` enum('draft','queued','sending','sent','received','acknowledged','rejected','retry_scheduled','failed') NOT NULL DEFAULT 'draft',
	`attempt_count` int NOT NULL DEFAULT 0,
	`next_attempt_at` timestamp(3),
	`lease_key` varchar(36),
	`lease_until` timestamp(3),
	`provider_message_id` varchar(128),
	`acknowledgment_code` varchar(32),
	`response_digest` varchar(64),
	`error_message` varchar(500),
	`sent_at` timestamp(3),
	`acknowledged_at` timestamp(3),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `operational_message_transmissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `operational_message_transmission_idempotency_unique` UNIQUE(`tenant_id`,`idempotency_key`)
);
--> statement-breakpoint
ALTER TABLE `booking_segments` ADD `fareClassId` int;--> statement-breakpoint
ALTER TABLE `bookings` ADD `fareClassId` int;--> statement-breakpoint
ALTER TABLE `inventory_locks` ADD `fareClassId` int;--> statement-breakpoint
CREATE INDEX `aircraft_balance_profile_active_idx` ON `aircraft_balance_profiles` (`airlineId`,`aircraftTypeId`,`status`,`effectiveFrom`);--> statement-breakpoint
CREATE INDEX `aircraft_registration_active_idx` ON `aircraft_registrations` (`airlineId`,`registration`,`status`,`effectiveFrom`);--> statement-breakpoint
CREATE INDEX `fare_components_booking_idx` ON `booking_fare_components` (`bookingId`);--> statement-breakpoint
CREATE INDEX `fare_components_passenger_sector_idx` ON `booking_fare_components` (`passengerId`,`flightId`);--> statement-breakpoint
CREATE INDEX `fare_components_segment_idx` ON `booking_fare_components` (`bookingSegmentId`);--> statement-breakpoint
CREATE INDEX `fare_components_tenant_created_idx` ON `booking_fare_components` (`tenantId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `flight_fare_class_inventory_flight_idx` ON `flight_fare_class_inventory` (`flightId`);--> statement-breakpoint
CREATE INDEX `loyalty_liability_event_booking_idx` ON `loyalty_contract_liability_events` (`bookingId`);--> statement-breakpoint
CREATE INDEX `loyalty_liability_event_policy_idx` ON `loyalty_contract_liability_events` (`policyProfileId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `loyalty_policy_active_idx` ON `loyalty_policy_profiles` (`tenantId`,`status`,`effectiveAt`);--> statement-breakpoint
CREATE INDEX `passenger_rights_policy_active_idx` ON `passenger_rights_policy_profiles` (`tenantId`,`jurisdiction`,`status`,`effectiveAt`);--> statement-breakpoint
CREATE INDEX `zatca_drafts_booking_idx` ON `zatca_invoice_drafts` (`bookingId`);--> statement-breakpoint
CREATE INDEX `zatca_drafts_tenant_status_idx` ON `zatca_invoice_drafts` (`tenantId`,`status`);--> statement-breakpoint
CREATE INDEX `operational_message_route_enabled_idx` ON `operational_message_routes` (`tenant_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `operational_message_transmission_due_idx` ON `operational_message_transmissions` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `operational_message_transmission_flight_idx` ON `operational_message_transmissions` (`flight_id`,`message_type`);--> statement-breakpoint
CREATE INDEX `booking_segments_fare_class_idx` ON `booking_segments` (`fareClassId`);--> statement-breakpoint
CREATE INDEX `bookings_fare_class_idx` ON `bookings` (`fareClassId`);--> statement-breakpoint
CREATE INDEX `inventory_locks_fare_class_idx` ON `inventory_locks` (`flightId`,`fareClassId`);
