CREATE INDEX `loyalty_lots_booking_idx` ON `loyalty_credit_lots` (`bookingId`);--> statement-breakpoint
CREATE INDEX `miles_transactions_booking_id_idx` ON `miles_transactions` (`bookingId`);--> statement-breakpoint
CREATE INDEX `payment_receipts_booking_id_idx` ON `payment_receipts` (`bookingId`);