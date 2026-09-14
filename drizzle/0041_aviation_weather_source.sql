CREATE TABLE `airport_weather_stations` (
	`airportId` int NOT NULL,
	`icaoCode` varchar(4) NOT NULL,
	`mappingEvidence` varchar(255) NOT NULL,
	`recordedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `airport_weather_stations_airportId` PRIMARY KEY(`airportId`),
	CONSTRAINT `airport_weather_station_icao_idx` UNIQUE(`icaoCode`)
);
--> statement-breakpoint
CREATE TABLE `weather_observations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`icaoCode` varchar(4) NOT NULL,
	`kind` enum('metar','taf') NOT NULL,
	`issuedAt` timestamp NOT NULL,
	`rawText` varchar(2048) NOT NULL,
	`bodyDigest` varchar(64) NOT NULL,
	`windDirection` int,
	`windSpeed` int,
	`windGust` int,
	`visibilityStatuteMiles` decimal(5,2),
	`ceilingFeet` int,
	`ceilingIndeterminate` boolean NOT NULL DEFAULT false,
	`temperatureC` int,
	`dewpointC` int,
	`altimeterHpa` decimal(7,2),
	`flightCategory` enum('VFR','MVFR','IFR','LIFR'),
	`sourceReference` varchar(255) NOT NULL,
	`sourceMode` enum('sandbox','live') NOT NULL,
	`fetchedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `weather_observations_id` PRIMARY KEY(`id`),
	CONSTRAINT `weather_observation_identity_idx` UNIQUE(`icaoCode`,`kind`,`issuedAt`,`bodyDigest`)
);
--> statement-breakpoint
CREATE INDEX `weather_observation_recent_idx` ON `weather_observations` (`icaoCode`,`kind`,`issuedAt`);