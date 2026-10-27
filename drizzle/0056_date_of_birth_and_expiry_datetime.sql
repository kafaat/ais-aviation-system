-- TIMESTAMP values are stored as UTC instants and converted to the session
-- time zone when MODIFY rewrites them as DATETIME. The application pool reads
-- and writes with timezone Z, so the conversion must also run in UTC or every
-- stored date of birth and expiry would shift by the server's offset.
SET time_zone = '+00:00';--> statement-breakpoint
ALTER TABLE `crew_members` MODIFY COLUMN `licenseExpiry` datetime;--> statement-breakpoint
ALTER TABLE `crew_members` MODIFY COLUMN `medicalExpiry` datetime;--> statement-breakpoint
ALTER TABLE `passengers` MODIFY COLUMN `dateOfBirth` datetime;--> statement-breakpoint
ALTER TABLE `passengers` MODIFY COLUMN `passportExpiry` datetime;--> statement-breakpoint
ALTER TABLE `saved_passengers` MODIFY COLUMN `dateOfBirth` datetime;--> statement-breakpoint
ALTER TABLE `saved_passengers` MODIFY COLUMN `passportExpiry` datetime;--> statement-breakpoint
ALTER TABLE `user_preferences` MODIFY COLUMN `passportExpiry` datetime;