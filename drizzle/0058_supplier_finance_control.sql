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
--> statement-breakpoint
CREATE TRIGGER supplier_profile_initial BEFORE INSERT ON supplier_bank_profiles
FOR EACH ROW BEGIN
  IF NEW.bankVersion <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Supplier bank profile must start at version zero';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER supplier_profile_identity BEFORE UPDATE ON supplier_bank_profiles
FOR EACH ROW BEGIN
  IF NEW.id <> OLD.id OR NEW.tenantId <> OLD.tenantId OR CAST(NEW.supplierRef AS BINARY) <> CAST(OLD.supplierRef AS BINARY) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Supplier bank profile identity is immutable';
  END IF;
  IF NEW.bankVersion <> OLD.bankVersion AND (
    NEW.bankVersion <> OLD.bankVersion + 1 OR NOT EXISTS (
      SELECT 1 FROM supplier_finance_events
      WHERE profileId = OLD.id AND bankVersion = NEW.bankVersion AND action = 'bank_change'
        AND invoiceRef = '' AND (supersedesBankVersion <=> NULLIF(OLD.bankVersion, 0))
    )
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Supplier version requires the next bank change receipt';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER supplier_profile_no_delete BEFORE DELETE ON supplier_bank_profiles
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Supplier bank profile cannot be deleted';
--> statement-breakpoint
CREATE TRIGGER supplier_event_parent BEFORE INSERT ON supplier_finance_events
FOR EACH ROW BEGIN
  IF NOT EXISTS (SELECT 1 FROM supplier_bank_profiles WHERE id = NEW.profileId) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Supplier finance evidence requires an existing profile';
  END IF;
END;
