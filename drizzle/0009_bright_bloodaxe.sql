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
CREATE INDEX `user_id_idx` ON `user_preferences` (`userId`);