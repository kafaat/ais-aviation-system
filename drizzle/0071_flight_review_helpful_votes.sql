CREATE TABLE `flight_review_helpful_votes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reviewId` int NOT NULL,
	`userId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `flight_review_helpful_votes_id` PRIMARY KEY(`id`),
	CONSTRAINT `flight_review_helpful_votes_unique_idx` UNIQUE(`reviewId`,`userId`)
);
--> statement-breakpoint
CREATE INDEX `flight_review_helpful_votes_user_idx` ON `flight_review_helpful_votes` (`userId`);
