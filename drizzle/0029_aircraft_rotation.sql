CREATE TABLE `aircraft_rotations` (
	`flightId` int NOT NULL,
	`airlineId` int NOT NULL,
	`tenantId` int,
	`tailNumber` varchar(20) NOT NULL,
	`maintenanceEvidenceId` int NOT NULL,
	`scheduleDigest` varchar(64) NOT NULL,
	`assignedBy` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `aircraft_rotations_flightId` PRIMARY KEY(`flightId`)
);
--> statement-breakpoint
CREATE INDEX `aircraft_rotation_tail_idx` ON `aircraft_rotations` (`airlineId`,`tailNumber`);