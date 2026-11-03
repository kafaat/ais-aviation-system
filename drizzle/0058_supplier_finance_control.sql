CREATE TABLE `supplier_bank_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`supplierRef` varchar(36) NOT NULL,
	`bankVersion` int NOT NULL DEFAULT 0,
	CONSTRAINT `supplier_bank_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `supplier_bank_scope` UNIQUE(`tenantId`,`supplierRef`)
);
--> statement-breakpoint
CREATE TABLE `supplier_finance_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`profileId` int NOT NULL,
	`bankVersion` int NOT NULL,
	`action` enum('bank_change','bank_approved','payout_request','payout_approved') NOT NULL,
	`invoiceRef` varchar(36) NOT NULL DEFAULT '',
	`supersedesBankVersion` int,
	`vaultRef` varchar(36),
	`lastFour` varchar(4),
	`amountMinor` int,
	`actorId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `supplier_finance_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `supplier_finance_once` UNIQUE(`profileId`,`bankVersion`,`action`,`invoiceRef`)
);
--> statement-breakpoint
CREATE INDEX `supplier_finance_invoice` ON `supplier_finance_events` (`profileId`,`invoiceRef`,`id`);
--> statement-breakpoint
CREATE TRIGGER supplier_finance_no_update BEFORE UPDATE ON supplier_finance_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Supplier finance evidence is append-only';
--> statement-breakpoint
CREATE TRIGGER supplier_finance_no_delete BEFORE DELETE ON supplier_finance_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Supplier finance evidence is append-only';
