CREATE TABLE `booking_fare_components` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`tenantId` int,
	`passengerId` int,
	`flightId` int,
	`segmentId` int,
	`componentType` enum('base','tax','surcharge','fee') NOT NULL,
	`code` varchar(8) NOT NULL,
	`jurisdiction` varchar(2),
	`rateBasisPoints` int,
	`amount` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`fxRateMillionths` int,
	`fxSource` varchar(32),
	`fxAsOf` timestamp,
	`entryKind` enum('sale','adjustment','reversal') NOT NULL DEFAULT 'sale',
	`basis` enum('fare_line','derived','unresolved') NOT NULL,
	`reference` varchar(96) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `booking_fare_components_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tax_invoices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`uuid` varchar(36) NOT NULL,
	`issuingUnit` varchar(64) NOT NULL,
	`sequence` int NOT NULL,
	`invoiceNumber` varchar(96) NOT NULL,
	`bookingId` int NOT NULL,
	`tenantId` int,
	`documentType` enum('simplified_invoice','simplified_credit_note') NOT NULL,
	`referencedInvoiceId` int,
	`sellerName` varchar(255) NOT NULL,
	`sellerVatNumber` varchar(15) NOT NULL,
	`issuedAt` timestamp NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`totalExcludingVat` int NOT NULL,
	`vatAmount` int NOT NULL,
	`totalIncludingVat` int NOT NULL,
	`qrPayload` text NOT NULL,
	`invoiceHash` varchar(64) NOT NULL,
	`previousInvoiceHash` varchar(64) NOT NULL,
	`document` json NOT NULL,
	`status` enum('generated','reported','cleared','failed') NOT NULL DEFAULT 'generated',
	`submissionReference` varchar(128),
	`submissionError` text,
	`reference` varchar(96) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tax_invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `tax_invoices_uuid_unique` UNIQUE(`uuid`),
	CONSTRAINT `tax_invoices_invoiceNumber_unique` UNIQUE(`invoiceNumber`),
	CONSTRAINT `tax_invoices_unit_sequence_idx` UNIQUE(`issuingUnit`,`sequence`),
	CONSTRAINT `tax_invoices_reference_idx` UNIQUE(`bookingId`,`documentType`,`reference`)
);
--> statement-breakpoint
CREATE INDEX `fare_components_booking_idx` ON `booking_fare_components` (`bookingId`);--> statement-breakpoint
CREATE INDEX `fare_components_booking_passenger_idx` ON `booking_fare_components` (`bookingId`,`passengerId`);--> statement-breakpoint
CREATE INDEX `fare_components_flight_idx` ON `booking_fare_components` (`flightId`);--> statement-breakpoint
CREATE INDEX `fare_components_reference_idx` ON `booking_fare_components` (`bookingId`,`reference`);--> statement-breakpoint
CREATE INDEX `tax_invoices_booking_idx` ON `tax_invoices` (`bookingId`);--> statement-breakpoint
CREATE INDEX `tax_invoices_status_idx` ON `tax_invoices` (`status`);