CREATE TABLE `privacy_export_artifacts` (
	`requestId` int NOT NULL,
	`userId` int NOT NULL,
	`content` longtext NOT NULL,
	`contentType` varchar(64) NOT NULL,
	`sha256` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `privacy_export_artifacts_requestId` PRIMARY KEY(`requestId`)
);
