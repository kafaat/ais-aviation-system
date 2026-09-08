-- Migration: P0 Critical Features
-- Description: Dynamic Pricing, Multi-Currency Support, Advanced Inventory Management
-- Date: 2026-01-26

-- ============================================================================
-- Dynamic Pricing Tables
-- ============================================================================

-- Pricing Rules
CREATE TABLE IF NOT EXISTS `pricing_rules` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `ruleType` ENUM('demand_multiplier', 'time_based', 'seasonal', 'route_specific', 'cabin_class', 'advance_purchase', 'load_factor') NOT NULL,
  `airlineId` INT,
  `originId` INT,
  `destinationId` INT,
  `cabinClass` ENUM('economy', 'business'),
  `parameters` TEXT NOT NULL,
  `priority` INT DEFAULT 0 NOT NULL,
  `validFrom` TIMESTAMP,
  `validTo` TIMESTAMP,
  `isActive` BOOLEAN DEFAULT TRUE NOT NULL,
  `createdBy` INT,
  `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  
  INDEX `pricing_rules_type_idx` (`ruleType`),
  INDEX `pricing_rules_airline_idx` (`airlineId`),
  INDEX `pricing_rules_route_idx` (`originId`, `destinationId`),
  INDEX `pricing_rules_active_idx` (`isActive`),
  INDEX `pricing_rules_priority_idx` (`priority`),
  INDEX `pricing_rules_validity_idx` (`validFrom`, `validTo`)
);

-- Pricing History
CREATE TABLE IF NOT EXISTS `pricing_history` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `flightId` INT NOT NULL,
  `cabinClass` ENUM('economy', 'business') NOT NULL,
  `basePrice` INT NOT NULL,
  `finalPrice` INT NOT NULL,
  `totalMultiplier` DECIMAL(10, 4) NOT NULL,
  `appliedRules` TEXT NOT NULL,
  `occupancyRate` DECIMAL(5, 4),
  `daysUntilDeparture` INT,
  `demandScore` DECIMAL(5, 2),
  `bookingId` INT,
  `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  
  INDEX `pricing_history_flight_idx` (`flightId`),
  INDEX `pricing_history_booking_idx` (`bookingId`),
  INDEX `pricing_history_created_idx` (`createdAt`)
);

-- Seasonal Pricing
CREATE TABLE IF NOT EXISTS `seasonal_pricing` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `nameAr` VARCHAR(255),
  `startDate` TIMESTAMP NOT NULL,
  `endDate` TIMESTAMP NOT NULL,
  `multiplier` DECIMAL(5, 2) NOT NULL,
  `airlineId` INT,
  `originId` INT,
  `destinationId` INT,
  `isActive` BOOLEAN DEFAULT TRUE NOT NULL,
  `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  
  INDEX `seasonal_pricing_dates_idx` (`startDate`, `endDate`),
  INDEX `seasonal_pricing_active_idx` (`isActive`)
);

-- ============================================================================
-- Multi-Currency Tables
-- ============================================================================

-- Currencies
CREATE TABLE IF NOT EXISTS `currencies` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(3) NOT NULL UNIQUE,
  `name` VARCHAR(100) NOT NULL,
  `nameAr` VARCHAR(100),
  `symbol` VARCHAR(10) NOT NULL,
  `decimalPlaces` INT DEFAULT 2 NOT NULL,
  `symbolPosition` ENUM('before', 'after') DEFAULT 'before' NOT NULL,
  `thousandsSeparator` VARCHAR(1) DEFAULT ',',
  `decimalSeparator` VARCHAR(1) DEFAULT '.',
  `isActive` BOOLEAN DEFAULT TRUE NOT NULL,
  `isBaseCurrency` BOOLEAN DEFAULT FALSE NOT NULL,
  `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  
  INDEX `currencies_code_idx` (`code`),
  INDEX `currencies_active_idx` (`isActive`)
);

-- Exchange Rates
CREATE TABLE IF NOT EXISTS `exchange_rates` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `fromCurrency` VARCHAR(3) NOT NULL,
  `toCurrency` VARCHAR(3) NOT NULL,
  `rate` DECIMAL(18, 8) NOT NULL,
  `source` VARCHAR(100),
  `validFrom` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `validTo` TIMESTAMP,
  `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  
  INDEX `exchange_rates_pair_idx` (`fromCurrency`, `toCurrency`),
  INDEX `exchange_rates_valid_idx` (`validFrom`)
);

-- ============================================================================
-- Inventory Management Tables
-- ============================================================================

-- Seat Holds
CREATE TABLE IF NOT EXISTS `seat_holds` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `flightId` INT NOT NULL,
  `cabinClass` ENUM('economy', 'business') NOT NULL,
  `seats` INT NOT NULL,
  `userId` INT,
  `sessionId` VARCHAR(255) NOT NULL,
  `status` ENUM('active', 'converted', 'expired', 'released') DEFAULT 'active' NOT NULL,
  `expiresAt` TIMESTAMP NOT NULL,
  `bookingId` INT,
  `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  
  INDEX `seat_holds_flight_idx` (`flightId`),
  INDEX `seat_holds_user_idx` (`userId`),
  INDEX `seat_holds_session_idx` (`sessionId`),
  INDEX `seat_holds_status_idx` (`status`),
  INDEX `seat_holds_expires_idx` (`expiresAt`)
);

-- Waitlist
CREATE TABLE IF NOT EXISTS `waitlist` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `flightId` INT NOT NULL,
  `cabinClass` ENUM('economy', 'business') NOT NULL,
  `userId` INT NOT NULL,
  `seats` INT NOT NULL,
  `priority` INT NOT NULL,
  `status` ENUM('waiting', 'offered', 'confirmed', 'expired', 'cancelled') DEFAULT 'waiting' NOT NULL,
  `offeredAt` TIMESTAMP,
  `offerExpiresAt` TIMESTAMP,
  `confirmedAt` TIMESTAMP,
  `notifyByEmail` BOOLEAN DEFAULT TRUE NOT NULL,
  `notifyBySms` BOOLEAN DEFAULT FALSE NOT NULL,
  `bookingId` INT,
  `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  
  INDEX `waitlist_flight_idx` (`flightId`),
  INDEX `waitlist_user_idx` (`userId`),
  INDEX `waitlist_status_idx` (`status`),
  INDEX `waitlist_priority_idx` (`flightId`, `cabinClass`, `priority`)
);

-- Overbooking Configuration
CREATE TABLE IF NOT EXISTS `overbooking_config` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `airlineId` INT,
  `originId` INT,
  `destinationId` INT,
  `economyRate` DECIMAL(5, 4) DEFAULT 0.0500 NOT NULL,
  `businessRate` DECIMAL(5, 4) DEFAULT 0.0200 NOT NULL,
  `maxOverbooking` INT DEFAULT 10 NOT NULL,
  `historicalNoShowRate` DECIMAL(5, 4),
  `isActive` BOOLEAN DEFAULT TRUE NOT NULL,
  `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  
  INDEX `overbooking_route_idx` (`originId`, `destinationId`),
  INDEX `overbooking_airline_idx` (`airlineId`),
  INDEX `overbooking_active_idx` (`isActive`)
);

-- Inventory Snapshots
CREATE TABLE IF NOT EXISTS `inventory_snapshots` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `flightId` INT NOT NULL,
  `snapshotDate` TIMESTAMP NOT NULL,
  `economyTotal` INT NOT NULL,
  `economySold` INT NOT NULL,
  `economyHeld` INT NOT NULL,
  `economyAvailable` INT NOT NULL,
  `economyWaitlist` INT NOT NULL,
  `businessTotal` INT NOT NULL,
  `businessSold` INT NOT NULL,
  `businessHeld` INT NOT NULL,
  `businessAvailable` INT NOT NULL,
  `businessWaitlist` INT NOT NULL,
  `economyPrice` INT NOT NULL,
  `businessPrice` INT NOT NULL,
  `daysUntilDeparture` INT NOT NULL,
  `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  
  INDEX `inventory_snapshots_flight_idx` (`flightId`),
  INDEX `inventory_snapshots_date_idx` (`snapshotDate`),
  INDEX `inventory_snapshots_flight_date_idx` (`flightId`, `snapshotDate`)
);

-- Denied Boarding Records
CREATE TABLE IF NOT EXISTS `denied_boarding_records` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `flightId` INT NOT NULL,
  `bookingId` INT NOT NULL,
  `userId` INT NOT NULL,
  `type` ENUM('voluntary', 'involuntary') NOT NULL,
  `compensationAmount` INT NOT NULL,
  `compensationCurrency` VARCHAR(3) DEFAULT 'SAR' NOT NULL,
  `compensationType` ENUM('cash', 'voucher', 'miles') NOT NULL,
  `alternativeFlightId` INT,
  `status` ENUM('pending', 'accepted', 'rejected', 'completed') DEFAULT 'pending' NOT NULL,
  `notes` TEXT,
  `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  
  INDEX `denied_boarding_flight_idx` (`flightId`),
  INDEX `denied_boarding_user_idx` (`userId`),
  INDEX `denied_boarding_status_idx` (`status`)
);

-- ============================================================================
-- Initial Data
-- ============================================================================

-- Insert supported currencies
INSERT INTO `currencies` (`code`, `name`, `nameAr`, `symbol`, `decimalPlaces`, `symbolPosition`, `isActive`, `isBaseCurrency`) VALUES
('SAR', 'Saudi Riyal', 'ريال سعودي', 'ر.س', 2, 'after', TRUE, TRUE),
('USD', 'US Dollar', 'دولار أمريكي', '$', 2, 'before', TRUE, FALSE),
('EUR', 'Euro', 'يورو', '€', 2, 'before', TRUE, FALSE),
('AED', 'UAE Dirham', 'درهم إماراتي', 'د.إ', 2, 'after', TRUE, FALSE),
('GBP', 'British Pound', 'جنيه إسترليني', '£', 2, 'before', TRUE, FALSE),
('KWD', 'Kuwaiti Dinar', 'دينار كويتي', 'د.ك', 3, 'after', TRUE, FALSE),
('BHD', 'Bahraini Dinar', 'دينار بحريني', 'د.ب', 3, 'after', TRUE, FALSE),
('QAR', 'Qatari Riyal', 'ريال قطري', 'ر.ق', 2, 'after', TRUE, FALSE),
('OMR', 'Omani Rial', 'ريال عماني', 'ر.ع', 3, 'after', TRUE, FALSE),
('EGP', 'Egyptian Pound', 'جنيه مصري', 'ج.م', 2, 'after', TRUE, FALSE)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- Insert initial exchange rates (SAR as base)
INSERT INTO `exchange_rates` (`fromCurrency`, `toCurrency`, `rate`, `source`) VALUES
('SAR', 'USD', 0.26660000, 'initial'),
('SAR', 'EUR', 0.24500000, 'initial'),
('SAR', 'AED', 0.97930000, 'initial'),
('SAR', 'GBP', 0.21000000, 'initial'),
('SAR', 'KWD', 0.08200000, 'initial'),
('SAR', 'BHD', 0.10040000, 'initial'),
('SAR', 'QAR', 0.97070000, 'initial'),
('SAR', 'OMR', 0.10260000, 'initial'),
('SAR', 'EGP', 8.24000000, 'initial'),
('USD', 'SAR', 3.75000000, 'initial'),
('EUR', 'SAR', 4.08160000, 'initial'),
('AED', 'SAR', 1.02110000, 'initial'),
('GBP', 'SAR', 4.76190000, 'initial'),
('KWD', 'SAR', 12.19510000, 'initial'),
('BHD', 'SAR', 9.96020000, 'initial'),
('QAR', 'SAR', 1.03020000, 'initial'),
('OMR', 'SAR', 9.74660000, 'initial'),
('EGP', 'SAR', 0.12140000, 'initial')
ON DUPLICATE KEY UPDATE `rate` = VALUES(`rate`);

-- Insert default pricing rules
INSERT INTO `pricing_rules` (`name`, `description`, `ruleType`, `parameters`, `priority`, `isActive`) VALUES
('High Demand Multiplier', 'Increase price when occupancy exceeds 80%', 'load_factor', '{"thresholds":[{"occupancy":0.80,"multiplier":1.15},{"occupancy":0.90,"multiplier":1.30},{"occupancy":0.95,"multiplier":1.50}]}', 100, TRUE),
('Last Minute Premium', 'Premium pricing for bookings within 3 days of departure', 'advance_purchase', '{"thresholds":[{"days":3,"multiplier":1.40},{"days":7,"multiplier":1.20},{"days":14,"multiplier":1.10}]}', 90, TRUE),
('Early Bird Discount', 'Discount for bookings 30+ days in advance', 'advance_purchase', '{"thresholds":[{"days":30,"multiplier":0.90},{"days":60,"multiplier":0.85},{"days":90,"multiplier":0.80}]}', 80, TRUE),
('Weekend Premium', 'Premium for weekend departures', 'time_based', '{"daysOfWeek":[4,5],"multiplier":1.10}', 70, TRUE),
('Business Class Premium', 'Additional premium for business class', 'cabin_class', '{"cabinClass":"business","multiplier":1.05}', 60, TRUE)
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

-- Insert seasonal pricing for common Saudi travel seasons
INSERT INTO `seasonal_pricing` (`name`, `nameAr`, `startDate`, `endDate`, `multiplier`, `isActive`) VALUES
('Hajj Season 2026', 'موسم الحج 2026', '2026-06-01 00:00:00', '2026-06-20 23:59:59', 1.80, TRUE),
('Umrah Peak - Ramadan', 'ذروة العمرة - رمضان', '2026-02-28 00:00:00', '2026-03-30 23:59:59', 1.50, TRUE),
('Eid Al-Fitr', 'عيد الفطر', '2026-03-29 00:00:00', '2026-04-05 23:59:59', 1.60, TRUE),
('Eid Al-Adha', 'عيد الأضحى', '2026-06-05 00:00:00', '2026-06-15 23:59:59', 1.70, TRUE),
('Summer Holiday', 'إجازة الصيف', '2026-07-01 00:00:00', '2026-08-31 23:59:59', 1.25, TRUE),
('National Day', 'اليوم الوطني', '2026-09-21 00:00:00', '2026-09-25 23:59:59', 1.30, TRUE),
('Winter Break', 'إجازة الشتاء', '2026-12-20 00:00:00', '2027-01-05 23:59:59', 1.35, TRUE)
ON DUPLICATE KEY UPDATE `multiplier` = VALUES(`multiplier`);

-- Insert default overbooking configuration
INSERT INTO `overbooking_config` (`airlineId`, `originId`, `destinationId`, `economyRate`, `businessRate`, `maxOverbooking`, `historicalNoShowRate`, `isActive`) VALUES
(NULL, NULL, NULL, 0.0500, 0.0200, 10, 0.0800, TRUE)
ON DUPLICATE KEY UPDATE `economyRate` = VALUES(`economyRate`);
