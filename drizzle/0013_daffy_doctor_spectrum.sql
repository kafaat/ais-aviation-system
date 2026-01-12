CREATE TABLE `account_locks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`reason` varchar(255) NOT NULL,
	`locked_by` varchar(50) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`unlocked_at` timestamp,
	`unlocked_by` varchar(50),
	`auto_unlock_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `account_locks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ip_blacklist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ip_address` varchar(45) NOT NULL,
	`reason` text NOT NULL,
	`blocked_by` varchar(50) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`unblocked_at` timestamp,
	`unblocked_by` varchar(50),
	`auto_unblock_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ip_blacklist_id` PRIMARY KEY(`id`),
	CONSTRAINT `ip_blacklist_ip_address_unique` UNIQUE(`ip_address`)
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320),
	`open_id` varchar(64),
	`ip_address` varchar(45) NOT NULL,
	`user_agent` text,
	`success` boolean NOT NULL,
	`failure_reason` varchar(255),
	`attempted_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `login_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`event_type` varchar(100) NOT NULL,
	`severity` varchar(20) NOT NULL,
	`user_id` int,
	`ip_address` varchar(45),
	`user_agent` text,
	`description` text,
	`metadata` text,
	`action_taken` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `security_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `lock_user_id_idx` ON `account_locks` (`user_id`);--> statement-breakpoint
CREATE INDEX `lock_is_active_idx` ON `account_locks` (`is_active`);--> statement-breakpoint
CREATE INDEX `blacklist_ip_address_idx` ON `ip_blacklist` (`ip_address`);--> statement-breakpoint
CREATE INDEX `blacklist_is_active_idx` ON `ip_blacklist` (`is_active`);--> statement-breakpoint
CREATE INDEX `login_email_idx` ON `login_attempts` (`email`);--> statement-breakpoint
CREATE INDEX `login_open_id_idx` ON `login_attempts` (`open_id`);--> statement-breakpoint
CREATE INDEX `login_ip_address_idx` ON `login_attempts` (`ip_address`);--> statement-breakpoint
CREATE INDEX `login_attempted_at_idx` ON `login_attempts` (`attempted_at`);--> statement-breakpoint
CREATE INDEX `sec_event_type_idx` ON `security_events` (`event_type`);--> statement-breakpoint
CREATE INDEX `sec_severity_idx` ON `security_events` (`severity`);--> statement-breakpoint
CREATE INDEX `sec_user_id_idx` ON `security_events` (`user_id`);--> statement-breakpoint
CREATE INDEX `sec_ip_address_idx` ON `security_events` (`ip_address`);--> statement-breakpoint
CREATE INDEX `sec_created_at_idx` ON `security_events` (`created_at`);