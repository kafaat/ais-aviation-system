ALTER TABLE `bag_drop_sessions` ADD `entitlementSnapshot` json;--> statement-breakpoint
ALTER TABLE `bag_drop_sessions` ADD `entitlementSnapshotAt` timestamp;--> statement-breakpoint
ALTER TABLE `bag_drop_sessions` ADD `entitlementSegmentId` int;