CREATE TABLE `booking_checkout_requests` (
	`bookingId` int NOT NULL,
	`userId` int NOT NULL,
	`requestId` varchar(64) NOT NULL,
	`invoiceHash` varchar(64) NOT NULL,
	`requestPayload` text NOT NULL,
	`status` enum('creating','ready','expired') NOT NULL DEFAULT 'creating',
	`sessionId` varchar(255),
	`checkoutUrl` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `booking_checkout_requests_bookingId` PRIMARY KEY(`bookingId`),
	CONSTRAINT `booking_checkout_requests_requestId_unique` UNIQUE(`requestId`),
	CONSTRAINT `booking_checkout_requests_sessionId_unique` UNIQUE(`sessionId`)
);
