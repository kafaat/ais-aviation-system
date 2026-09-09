-- Restore defaults removed by the NOT NULL modifications in migration 0013.
-- ALTER COLUMN changes metadata only; existing preference values are preserved.
ALTER TABLE `user_preferences` ALTER COLUMN `wheelchairAssistance` SET DEFAULT false;--> statement-breakpoint
ALTER TABLE `user_preferences` ALTER COLUMN `extraLegroom` SET DEFAULT false;--> statement-breakpoint
ALTER TABLE `user_preferences` ALTER COLUMN `smsNotifications` SET DEFAULT false;
