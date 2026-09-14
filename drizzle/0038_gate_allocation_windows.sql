ALTER TABLE `airport_gates` ADD `compatibleAircraftTypes` json;--> statement-breakpoint
ALTER TABLE `airport_gates` ADD `compatibilityEvidence` varchar(255);--> statement-breakpoint
ALTER TABLE `gate_assignments` ADD `occupiedFrom` timestamp(3);--> statement-breakpoint
ALTER TABLE `gate_assignments` ADD `occupiedUntil` timestamp(3);