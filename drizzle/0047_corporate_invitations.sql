CREATE TABLE `corporate_invitations` (
	`id` varchar(36) NOT NULL,
	`corporateAccountId` int NOT NULL,
	`recipientUserId` int NOT NULL,
	`invitedBy` int NOT NULL,
	`role` enum('admin','booker','traveler') NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`acceptedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `corporate_invitations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `corporate_invitation_recipient_idx` ON `corporate_invitations` (`recipientUserId`,`expiresAt`);