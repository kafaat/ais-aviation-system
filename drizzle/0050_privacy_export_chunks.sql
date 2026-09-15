CREATE TABLE `privacy_export_chunks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` int NOT NULL,
	`part` int NOT NULL,
	`content` longtext NOT NULL,
	`sha256` varchar(64) NOT NULL,
	`sizeBytes` int NOT NULL,
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `privacy_export_chunks_id` PRIMARY KEY(`id`),
	CONSTRAINT `privacy_export_chunk_identity` UNIQUE(`requestId`,`part`)
);
--> statement-breakpoint
ALTER TABLE `privacy_export_artifacts` ADD `chunkCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `privacy_export_chunk_expiry` ON `privacy_export_chunks` (`expiresAt`);