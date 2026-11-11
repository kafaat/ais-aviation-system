CREATE TABLE `favorite_price_observations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`favoriteFlightId` int NOT NULL,
	`flightId` int NOT NULL,
	`cabinClass` enum('economy','business') NOT NULL,
	`price` int NOT NULL,
	`observedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `favorite_price_observations_id` PRIMARY KEY(`id`),
	CONSTRAINT `favorite_price_observation_unique` UNIQUE(`favoriteFlightId`,`flightId`,`cabinClass`)
);
