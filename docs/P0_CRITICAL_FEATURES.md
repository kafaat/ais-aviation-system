# P0 Critical Features Documentation

## نظرة عامة | Overview

This document describes the three critical P0 features implemented to enhance the AIS Aviation System's revenue management and operational capabilities.

| Feature                       | Expected ROI     | Markets Impact                                        |
| ----------------------------- | ---------------- | ----------------------------------------------------- |
| Dynamic Pricing Engine        | +15-25% Revenue  | All markets                                           |
| Multi-Currency Support        | 3+ New Markets   | SAR, USD, EUR, AED, GBP, KWD, BHD, QAR, OMR, EGP, YER |
| Advanced Inventory Management | +5-10% Occupancy | All flights                                           |

---

## 1. Dynamic Pricing Engine | محرك التسعير الديناميكي

### 1.1 Overview

The Dynamic Pricing Engine implements revenue management algorithms to optimize ticket prices based on multiple factors including demand, time, occupancy, and seasonality.

### 1.2 Pricing Factors

| Factor                      | Description                                 | Multiplier Range |
| --------------------------- | ------------------------------------------- | ---------------- |
| **Demand**                  | Based on booking velocity and search volume | 0.85x - 1.50x    |
| **Time (Advance Purchase)** | Days until departure                        | 0.80x - 1.80x    |
| **Occupancy (Load Factor)** | Current seat availability                   | 0.80x - 1.80x    |
| **Seasonal**                | Peak travel seasons                         | 0.90x - 1.80x    |
| **Day of Week**             | Weekend premium                             | 1.00x - 1.10x    |
| **Cabin Class**             | Business class premium                      | 1.00x - 1.05x    |

### 1.3 Pricing Rules

```typescript
// Example pricing rule structure
{
  name: "High Demand Multiplier",
  ruleType: "load_factor",
  parameters: {
    thresholds: [
      { occupancy: 0.80, multiplier: 1.15 },
      { occupancy: 0.90, multiplier: 1.30 },
      { occupancy: 0.95, multiplier: 1.50 }
    ]
  },
  priority: 100,
  isActive: true
}
```

### 1.4 Seasonal Pricing (Saudi Arabia)

| Season               | Period          | Multiplier |
| -------------------- | --------------- | ---------- |
| Hajj Season          | June 1-20       | 1.80x      |
| Umrah Peak (Ramadan) | Feb 28 - Mar 30 | 1.50x      |
| Eid Al-Fitr          | Mar 29 - Apr 5  | 1.60x      |
| Eid Al-Adha          | Jun 5-15        | 1.70x      |
| Summer Holiday       | Jul 1 - Aug 31  | 1.25x      |
| National Day         | Sep 21-25       | 1.30x      |
| Winter Break         | Dec 20 - Jan 5  | 1.35x      |

### 1.5 API Endpoints

```typescript
// Calculate dynamic price
pricing.calculate({
  flightId: 123,
  cabinClass: "economy",
  passengers: 2,
  currency: "USD",
  promoCode: "SUMMER10",
});

// Get price range for route
pricing.getPriceRange({
  originId: 1,
  destinationId: 2,
  cabinClass: "economy",
  startDate: "2026-02-01",
  endDate: "2026-02-28",
  currency: "SAR",
});

// Validate price
pricing.validate({
  priceId: "PRC-123-economy-50000-...",
  expectedPrice: 50000,
});

// Get price forecast
pricing.getForecast({
  flightId: 123,
  cabinClass: "economy",
  days: 7,
  currency: "SAR",
});
```

### 1.6 Price Validity

- Calculated prices are valid for **15 minutes**
- Price ID format: `PRC-{flightId}-{cabinClass}-{price}-{timestamp}-{random}`
- Expired prices must be recalculated before booking

---

## 2. Multi-Currency Support | دعم العملات المتعددة

### 2.1 Supported Currencies

| Code | Currency       | Arabic Name   | Symbol | Decimals |
| ---- | -------------- | ------------- | ------ | -------- |
| SAR  | Saudi Riyal    | ريال سعودي    | ر.س    | 2        |
| USD  | US Dollar      | دولار أمريكي  | $      | 2        |
| EUR  | Euro           | يورو          | €      | 2        |
| AED  | UAE Dirham     | درهم إماراتي  | د.إ    | 2        |
| GBP  | British Pound  | جنيه إسترليني | £      | 2        |
| KWD  | Kuwaiti Dinar  | دينار كويتي   | د.ك    | 3        |
| BHD  | Bahraini Dinar | دينار بحريني  | د.ب    | 3        |
| QAR  | Qatari Riyal   | ريال قطري     | ر.ق    | 2        |
| OMR  | Omani Rial     | ريال عماني    | ر.ع    | 3        |
| EGP  | Egyptian Pound | جنيه مصري     | ج.م    | 2        |
| YER  | Yemeni Rial    | ريال يمني     | ﷼      | 2        |

### 2.2 Exchange Rates (Base: SAR)

| From | To  | Rate   |
| ---- | --- | ------ |
| SAR  | USD | 0.2666 |
| SAR  | EUR | 0.2450 |
| SAR  | AED | 0.9793 |
| SAR  | GBP | 0.2100 |
| SAR  | KWD | 0.0820 |
| SAR  | BHD | 0.1004 |
| SAR  | QAR | 0.9707 |
| SAR  | OMR | 0.1026 |
| SAR  | EGP | 8.2400 |
| SAR  | YER | 66.790 |

### 2.3 Currency Conversion

```typescript
// Convert currency
const result = await CurrencyService.convertCurrency(
  1000,    // amount
  "SAR",   // from
  "USD"    // to
);

// Result:
{
  originalAmount: 1000,
  originalCurrency: "SAR",
  convertedAmount: 266.60,
  targetCurrency: "USD",
  exchangeRate: 0.2666,
  formattedOriginal: "1,000.00 ر.س",
  formattedConverted: "$266.60",
  rateTimestamp: "2026-01-26T..."
}
```

### 2.4 Price Display

```typescript
// Display price in user's currency
const display = await CurrencyService.convertPriceForDisplay(
  50000,  // price in SAR (cents)
  "USD"   // user's preferred currency
);

// Result:
{
  amount: 13330,
  currency: "USD",
  formatted: "133.30",
  formattedWithSymbol: "$133.30"
}
```

### 2.5 API Endpoints

```typescript
// Get supported currencies
pricing.getSupportedCurrencies();

// Convert currency
pricing.convertCurrency({
  amount: 1000,
  fromCurrency: "SAR",
  toCurrency: "USD",
});

// Get exchange rate
pricing.getExchangeRate({
  fromCurrency: "SAR",
  toCurrency: "EUR",
});
```

---

## 3. Advanced Inventory Management | إدارة المخزون المتقدمة

### 3.1 Inventory Status

| Status          | Occupancy | Description             |
| --------------- | --------- | ----------------------- |
| `available`     | < 85%     | Seats readily available |
| `limited`       | 85-98%    | Limited availability    |
| `waitlist_only` | > 98%     | Only waitlist available |
| `closed`        | 100%      | No seats available      |

### 3.2 Seat Holds

- **Duration**: 15 minutes
- **Purpose**: Reserve seats during checkout process
- **States**: `active`, `converted`, `expired`, `released`

```typescript
// Allocate seats
const result = await InventoryService.allocateSeats(
  flightId: 123,
  cabinClass: "economy",
  seats: 2,
  userId: 456,
  sessionId: "session-abc"
);

// Result:
{
  success: true,
  holdId: 789,
  seatsAllocated: 2,
  expiresAt: "2026-01-26T12:30:00Z",
  message: "2 seat(s) held successfully"
}
```

### 3.3 Overbooking Management

| Class    | Default Rate | Max Overbooking |
| -------- | ------------ | --------------- |
| Economy  | 5%           | 10 seats        |
| Business | 2%           | 5 seats         |

```typescript
// Calculate effective availability
effectiveAvailable = availableSeats + overbookingLimit;

// Example:
// Available: 5 seats
// Overbooking limit: 7 seats
// Effective available: 12 seats
```

### 3.4 Waitlist System

- **Priority**: First-come, first-served
- **Offer Duration**: 24 hours
- **Notifications**: Email and SMS

```typescript
// Add to waitlist
const entry = await InventoryService.addToWaitlist(
  flightId: 123,
  cabinClass: "economy",
  seats: 2,
  userId: 456
);

// Result:
{
  id: 789,
  priority: 5,
  status: "waiting",
  message: "Added to waitlist at position 5"
}
```

### 3.5 Demand Forecasting

| Days Until Departure | Predicted Demand | Risk Level |
| -------------------- | ---------------- | ---------- |
| ≤ 3 days             | High (15)        | High       |
| 4-7 days             | Medium (10)      | Medium     |
| 8-14 days            | Low (5)          | Low        |
| > 14 days            | Very Low (3)     | Low        |

### 3.6 Denied Boarding Handling

```typescript
// Handle overbooking situation
const result = await InventoryService.handleDeniedBoarding(
  flightId: 123,
  cabinClass: "economy",
  seatsNeeded: 3
);

// Result:
{
  volunteersNeeded: 3,
  compensationOffer: 1500, // SAR
  alternativeFlights: [124, 125, 126]
}
```

### 3.7 API Endpoints

```typescript
// Get inventory status
inventory.getStatus({
  flightId: 123,
  cabinClass: "economy",
});

// Allocate seats
inventory.allocateSeats({
  flightId: 123,
  cabinClass: "economy",
  seats: 2,
  sessionId: "session-abc",
});

// Release hold
inventory.releaseHold({
  holdId: 789,
});

// Add to waitlist
inventory.addToWaitlist({
  flightId: 123,
  cabinClass: "economy",
  seats: 2,
});

// Get demand forecast (admin)
inventory.getForecast({
  flightId: 123,
  daysAhead: 30,
});

// Get recommended overbooking (admin)
inventory.getRecommendedOverbooking({
  flightId: 123,
});
```

---

## 4. Database Schema

### 4.1 New Tables

| Table                     | Purpose                          |
| ------------------------- | -------------------------------- |
| `pricing_rules`           | Dynamic pricing rule definitions |
| `pricing_history`         | Price calculation audit trail    |
| `seasonal_pricing`        | Seasonal price adjustments       |
| `currencies`              | Supported currencies             |
| `exchange_rates`          | Currency exchange rates          |
| `seat_holds`              | Temporary seat reservations      |
| `waitlist`                | Flight waitlist entries          |
| `overbooking_config`      | Overbooking settings per route   |
| `inventory_snapshots`     | Daily inventory snapshots        |
| `denied_boarding_records` | Denied boarding incidents        |

### 4.2 Migration

```bash
# Apply migration
npm run db:migrate

# Or manually
mysql -u root -p ais_aviation < drizzle/migrations/0005_p0_critical_features.sql
```

---

## 5. Configuration

### 5.1 Environment Variables

```env
# Pricing
PRICE_VALIDITY_MINUTES=15
MIN_PRICE_MULTIPLIER=0.7
MAX_PRICE_MULTIPLIER=2.5

# Currency
BASE_CURRENCY=SAR
EXCHANGE_RATE_CACHE_TTL=3600

# Inventory
SEAT_HOLD_MINUTES=15
WAITLIST_OFFER_HOURS=24
DEFAULT_OVERBOOKING_RATE=0.05
```

### 5.2 Cache Keys

| Key Pattern                               | TTL    | Purpose                |
| ----------------------------------------- | ------ | ---------------------- |
| `pricing_rules:{airline}:{origin}:{dest}` | 5 min  | Pricing rules cache    |
| `exchange_rate:{from}_{to}`               | 1 hour | Exchange rate cache    |
| `inventory:{flight}:{class}`              | 1 min  | Inventory status cache |

---

## 6. Testing

### 6.1 Run Tests

```bash
# Run P0 feature tests
npm run test -- server/__tests__/integration/p0-features.test.ts

# Run all tests
npm run test
```

### 6.2 Test Coverage

- Dynamic Pricing: 15 tests
- Multi-Currency: 12 tests
- Inventory Management: 18 tests
- Integration: 3 tests

---

## 7. Monitoring

### 7.1 Key Metrics

| Metric                       | Description               | Alert Threshold |
| ---------------------------- | ------------------------- | --------------- |
| `pricing_calculation_time`   | Price calculation latency | > 500ms         |
| `currency_conversion_errors` | Failed conversions        | > 1%            |
| `seat_hold_expiration_rate`  | Holds that expire         | > 30%           |
| `waitlist_conversion_rate`   | Waitlist to booking       | < 20%           |
| `overbooking_denied_rate`    | Denied boardings          | > 1%            |

### 7.2 Logging

All operations are logged in structured JSON format:

```json
{
  "event": "dynamic_price_calculated",
  "flightId": 123,
  "cabinClass": "economy",
  "basePrice": 50000,
  "finalPrice": 57500,
  "multiplier": 1.15,
  "rulesApplied": 3,
  "timestamp": "2026-01-26T12:00:00.000Z"
}
```

---

## 8. Future Enhancements

### 8.1 Planned Features

1. **Competitor Pricing Integration** - Real-time competitor price monitoring
2. **Machine Learning Pricing** - AI-powered demand prediction
3. **Dynamic Currency Selection** - Auto-detect user's preferred currency
4. **Real-time Exchange Rates** - Integration with live rate providers
5. **Advanced Overbooking AI** - ML-based no-show prediction

### 8.2 API Versioning

Current version: `v1`
Next planned version: `v2` (with ML pricing)

---

## 9. Support

For technical support or questions about these features:

- **Documentation**: `/docs/P0_CRITICAL_FEATURES.md`
- **API Reference**: `/docs/API_REFERENCE.md`
- **GitHub Issues**: `kafaat/ais-aviation-system/issues`

---

_Last Updated: January 26, 2026_
_Version: 1.0.0-beta_
