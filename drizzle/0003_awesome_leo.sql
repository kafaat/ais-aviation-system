CREATE INDEX `airline_idx` ON `flights` (`airlineId`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `flights` (`status`);--> statement-breakpoint
CREATE INDEX `route_date_status_idx` ON `flights` (`originId`,`destinationId`,`departureTime`,`status`);