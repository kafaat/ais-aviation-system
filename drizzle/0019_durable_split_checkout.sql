ALTER TABLE `payment_splits` ADD `checkoutRequestId` varchar(64);--> statement-breakpoint
ALTER TABLE `payment_splits` ADD `checkoutRequestPayload` text;--> statement-breakpoint
ALTER TABLE `payment_splits` ADD `checkoutRequestedAt` timestamp;--> statement-breakpoint
ALTER TABLE `payment_splits` ADD `checkoutStatus` enum('creating','ready','expired');--> statement-breakpoint
ALTER TABLE `payment_splits` ADD CONSTRAINT `payment_splits_checkoutRequestId_unique` UNIQUE(`checkoutRequestId`);