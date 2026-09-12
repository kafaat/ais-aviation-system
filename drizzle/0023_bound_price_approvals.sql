ALTER TABLE `revenue_optimization_logs` ADD `approvalDigest` varchar(64);--> statement-breakpoint
ALTER TABLE `revenue_optimization_logs` ADD `approvalExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `revenue_optimization_logs` ADD `executionEventId` varchar(36);