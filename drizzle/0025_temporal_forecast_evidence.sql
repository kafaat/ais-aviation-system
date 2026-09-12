ALTER TABLE `demand_predictions` ADD `trainingCutoffAt` timestamp;--> statement-breakpoint
ALTER TABLE `demand_predictions` ADD `diagnostics` json;