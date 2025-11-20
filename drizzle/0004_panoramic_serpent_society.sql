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
