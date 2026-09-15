-- A reviewed catalog definition, not a historical-purchase backfill.
-- Existing booking_ancillaries deliberately retain NULL snapshots.
UPDATE `ancillary_services`
SET `weightGrams` = 20000
WHERE `category` = 'baggage'
  AND `code` = 'BAG_20KG'
  AND `weightGrams` IS NULL;--> statement-breakpoint
UPDATE `ancillary_services`
SET `weightGrams` = 30000
WHERE `category` = 'baggage'
  AND `code` = 'BAG_30KG'
  AND `weightGrams` IS NULL;
