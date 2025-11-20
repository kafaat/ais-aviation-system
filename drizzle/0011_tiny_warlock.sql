ALTER TABLE `payments` ADD `idempotencyKey` varchar(100);--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_idempotencyKey_unique` UNIQUE(`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `idempotency_key_idx` ON `payments` (`idempotencyKey`);