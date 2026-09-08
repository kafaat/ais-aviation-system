-- Migration: Multi-Tenancy — scope core transactional tables (Phase 0, step 2)
-- Description:
--   Add nullable `tenantId` to the core transactional tables so rows can be
--   isolated per airline tenant. Nullable + indexed keeps existing single-tenant
--   data working during the migration; a later step backfills + tightens to
--   NOT NULL once every row is assigned.
-- Date: 2026-05-29

ALTER TABLE `flights` ADD COLUMN `tenantId` INT NULL AFTER `airlineId`;
CREATE INDEX `flights_tenant_idx` ON `flights` (`tenantId`);

ALTER TABLE `bookings` ADD COLUMN `tenantId` INT NULL AFTER `id`;
CREATE INDEX `bookings_tenant_idx` ON `bookings` (`tenantId`);

ALTER TABLE `passengers` ADD COLUMN `tenantId` INT NULL AFTER `id`;
CREATE INDEX `passengers_tenant_idx` ON `passengers` (`tenantId`);

ALTER TABLE `payments` ADD COLUMN `tenantId` INT NULL AFTER `id`;
CREATE INDEX `payments_tenant_idx` ON `payments` (`tenantId`);

-- Backfill example (run once tenants are provisioned and a mapping exists):
--   UPDATE flights  f  JOIN airlines a ON f.airlineId = a.id
--     SET f.tenantId = <tenantId> WHERE a.<...>;
--   UPDATE bookings b JOIN flights  f ON b.flightId = f.id
--     SET b.tenantId = f.tenantId;
--   UPDATE passengers p JOIN bookings b ON p.bookingId = b.id
--     SET p.tenantId = b.tenantId;
--   UPDATE payments  pm JOIN bookings b ON pm.bookingId = b.id
--     SET pm.tenantId = b.tenantId;
