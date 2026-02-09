# AIS Aviation System - API Documentation

**Version:** 4.0
**Last Updated:** February 2026
**Base URL:** `http://localhost:3000/api/trpc`

---

## Table of Contents

1. [Introduction](#introduction)
2. [Authentication](#authentication)
3. [Flights API](#flights-api)
4. [Bookings API](#bookings-api)
5. [Payments API](#payments-api)
6. [Loyalty API](#loyalty-api)
7. [Admin API](#admin-api)
8. [Analytics API](#analytics-api)
9. [Phase 2 APIs](#phase-2-apis)
10. [Phase 3 APIs](#phase-3-apis)
11. [Phase 4 APIs](#phase-4-apis)
12. [Error Handling](#error-handling)
13. [Rate Limiting](#rate-limiting)

---

## Introduction

The AIS API is built with tRPC, providing end-to-end type safety between client and server. All endpoints follow RESTful principles and return JSON responses.

### API Client Usage

```typescript
import { trpc } from "@/lib/trpc";

// Query (GET-like operation)
const { data, isLoading, error } = trpc.flights.search.useQuery({
  origin: "RUH",
  destination: "JED",
  date: "2026-02-15",
});

// Mutation (POST/PUT/DELETE-like operation)
const createBooking = trpc.bookings.create.useMutation({
  onSuccess: data => console.log("Booking created:", data),
  onError: error => console.error("Error:", error.message),
});
```

---

## Authentication

### Overview

The API uses cookie-based JWT authentication. Users authenticate via Manus OAuth, and the backend sets an httpOnly secure cookie.

### Protected vs Public Endpoints

- **Public:** Anyone can access (e.g., flight search)
- **Protected:** Requires authentication (e.g., my bookings)
- **Admin:** Requires admin role (e.g., analytics)

### Headers

```http
Cookie: auth_token=<JWT_TOKEN>
Content-Type: application/json
```

---

## Flights API

### 1. Search Flights

Search for available flights based on criteria.

**Endpoint:** `flights.search`  
**Type:** Query (Public)

**Input:**

```typescript
{
  origin: string;              // Airport code (e.g., 'RUH')
  destination: string;         // Airport code (e.g., 'JED')
  departureDate: string;       // ISO date (e.g., '2026-02-15')
  returnDate?: string;         // Optional for round trip
  cabinClass?: 'economy' | 'business' | 'first';
  passengers?: number;         // Default: 1
}
```

**Response:**

```typescript
{
  flights: Array<{
    id: number;
    flightNumber: string;
    airline: {
      id: number;
      name: string;
      code: string;
      logo: string;
    };
    origin: {
      id: number;
      code: string;
      name: string;
      city: string;
    };
    destination: {
      id: number;
      code: string;
      name: string;
      city: string;
    };
    departureTime: string; // ISO timestamp
    arrivalTime: string; // ISO timestamp
    duration: number; // Minutes
    price: number; // Base price in SAR
    availableSeats: number;
    cabinClass: "economy" | "business" | "first";
    status: "scheduled" | "delayed" | "cancelled";
  }>;
}
```

**Example:**

```typescript
const { data } = trpc.flights.search.useQuery({
  origin: "RUH",
  destination: "JED",
  departureDate: "2026-02-15",
  cabinClass: "economy",
  passengers: 2,
});
```

---

### 2. Get Flight Details

Get detailed information about a specific flight.

**Endpoint:** `flights.getById`  
**Type:** Query (Public)

**Input:**

```typescript
{
  id: number; // Flight ID
}
```

**Response:**

```typescript
{
  id: number;
  flightNumber: string;
  airline: { /* airline details */ };
  origin: { /* airport details */ };
  destination: { /* airport details */ };
  departureTime: string;
  arrivalTime: string;
  duration: number;
  basePrice: number;
  availableSeats: number;
  totalSeats: number;
  cabinClass: 'economy' | 'business' | 'first';
  status: 'scheduled' | 'delayed' | 'cancelled';
  baggageAllowance: {
    checked: number;    // kg
    cabin: number;      // kg
  };
  amenities: string[];
}
```

---

### 3. List Flights (Admin)

List all flights with filtering options.

**Endpoint:** `flights.list`  
**Type:** Query (Admin)

**Input:**

```typescript
{
  page?: number;           // Default: 1
  limit?: number;          // Default: 20, Max: 100
  status?: 'scheduled' | 'delayed' | 'cancelled' | 'completed';
  airlineId?: number;
  originId?: number;
  destinationId?: number;
  dateFrom?: string;
  dateTo?: string;
}
```

**Response:**

```typescript
{
  flights: Array<Flight>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
```

---

## Bookings API

### 1. Create Booking

Create a new flight booking.

**Endpoint:** `bookings.create`  
**Type:** Mutation (Protected)

**Input:**

```typescript
{
  flightId: number;
  passengers: Array<{
    firstName: string;
    lastName: string;
    passportNumber: string;
    nationality: string;      // ISO 3166-1 alpha-2 (e.g., 'SA')
    dateOfBirth: string;      // ISO date
    gender: 'male' | 'female';
    email?: string;
    phone?: string;
  }>;
  contactInfo: {
    email: string;
    phone: string;
  };
  specialRequests?: string;
  ancillaryServices?: Array<{
    serviceId: number;
    quantity: number;
  }>;
  useLoyaltyMiles?: number;   // Miles to redeem
}
```

**Response:**

```typescript
{
  id: number;
  bookingReference: string; // 6-char unique code
  pnr: string; // 6-char PNR
  status: "pending";
  totalAmount: number;
  flight: {
    /* flight details */
  }
  passengers: Array<{
    /* passenger details */
  }>;
  createdAt: string;
  paymentUrl: string; // Stripe checkout URL
}
```

**Example:**

```typescript
const createBooking = trpc.bookings.create.useMutation();

createBooking.mutate({
  flightId: 123,
  passengers: [
    {
      firstName: "Ahmed",
      lastName: "AlSalem",
      passportNumber: "A12345678",
      nationality: "SA",
      dateOfBirth: "1990-01-01",
      gender: "male",
    },
  ],
  contactInfo: {
    email: "ahmed@example.com",
    phone: "+966501234567",
  },
});
```

---

### 2. Get My Bookings

Retrieve all bookings for the authenticated user.

**Endpoint:** `bookings.myBookings`  
**Type:** Query (Protected)

**Input:**

```typescript
{
  status?: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  page?: number;
  limit?: number;
}
```

**Response:**

```typescript
{
  bookings: Array<{
    id: number;
    bookingReference: string;
    pnr: string;
    status: string;
    totalAmount: number;
    flight: {
      flightNumber: string;
      departureTime: string;
      arrivalTime: string;
      origin: { code: string; name: string };
      destination: { code: string; name: string };
    };
    passengers: Array<{
      firstName: string;
      lastName: string;
      seatNumber?: string;
      ticketNumber?: string;
    }>;
    payment: {
      status: string;
      amount: number;
    };
    createdAt: string;
  }>;
  total: number;
}
```

---

### 3. Get Booking Details

Get full details of a specific booking.

**Endpoint:** `bookings.getById`  
**Type:** Query (Protected)

**Input:**

```typescript
{
  id: number;
}
```

**Response:**

```typescript
{
  id: number;
  bookingReference: string;
  pnr: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  totalAmount: number;
  flight: { /* full flight details */ };
  passengers: Array<{ /* full passenger details */ }>;
  payment: { /* payment details */ };
  ancillaries: Array<{ /* ancillary services */ }>;
  modifications: Array<{ /* modification history */ }>;
  refund?: { /* refund details if applicable */ };
  createdAt: string;
  updatedAt: string;
}
```

---

### 4. Modify Booking

Modify an existing booking (change date or upgrade class).

**Endpoint:** `bookings.modify`  
**Type:** Mutation (Protected)

**Input:**

```typescript
{
  bookingId: number;
  modificationType: 'date_change' | 'cabin_upgrade';
  newFlightId?: number;      // For date change
  newCabinClass?: 'economy' | 'business' | 'first';  // For upgrade
}
```

**Response:**

```typescript
{
  success: boolean;
  booking: { /* updated booking */ };
  priceDifference: number;   // Positive if additional payment needed
  modificationFee: number;
  paymentUrl?: string;       // If additional payment required
}
```

---

### 5. Cancel Booking

Cancel a booking and request refund.

**Endpoint:** `bookings.cancel`  
**Type:** Mutation (Protected)

**Input:**

```typescript
{
  bookingId: number;
  reason?: string;
}
```

**Response:**

```typescript
{
  success: boolean;
  refundAmount: number;
  cancellationFee: number;
  refundETA: string; // Estimated refund date
}
```

---

### 6. Check-in

Perform online check-in and select seats.

**Endpoint:** `bookings.checkIn`  
**Type:** Mutation (Protected)

**Input:**

```typescript
{
  bookingId: number;
  seatSelections: Array<{
    passengerId: number;
    seatNumber: string; // e.g., '12A'
  }>;
}
```

**Response:**

```typescript
{
  success: boolean;
  boardingPasses: Array<{
    passengerId: number;
    passengerName: string;
    seatNumber: string;
    boardingGroup: string;
    boardingTime: string;
    gate?: string;
    downloadUrl: string; // PDF download link
  }>;
}
```

---

## Payments API

### 1. Create Checkout Session

Create a Stripe checkout session for payment.

**Endpoint:** `payments.createCheckoutSession`  
**Type:** Mutation (Protected)

**Input:**

```typescript
{
  bookingId: number;
}
```

**Response:**

```typescript
{
  sessionId: string;
  url: string; // Redirect user to this URL
  expiresAt: string;
}
```

---

### 2. Get Payment Status

Check payment status for a booking.

**Endpoint:** `payments.getStatus`  
**Type:** Query (Protected)

**Input:**

```typescript
{
  bookingId: number;
}
```

**Response:**

```typescript
{
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  amount: number;
  currency: string;
  paidAt?: string;
  refundedAt?: string;
}
```

---

## Loyalty API

### 1. Get Loyalty Account

Get user's loyalty account details.

**Endpoint:** `loyalty.getAccount`  
**Type:** Query (Protected)

**Response:**

```typescript
{
  id: number;
  userId: number;
  milesBalance: number;
  tier: "bronze" | "silver" | "gold" | "platinum";
  tierProgress: number; // % to next tier
  tierExpiry: string;
  joinedAt: string;
}
```

---

### 2. Get Miles Transactions

Get miles transaction history.

**Endpoint:** `loyalty.getTransactions`  
**Type:** Query (Protected)

**Input:**

```typescript
{
  page?: number;
  limit?: number;
}
```

**Response:**

```typescript
{
  transactions: Array<{
    id: number;
    type: "earned" | "redeemed" | "expired";
    amount: number;
    description: string;
    bookingId?: number;
    createdAt: string;
  }>;
  total: number;
}
```

---

### 3. Redeem Miles

Redeem miles for booking discount.

**Endpoint:** `loyalty.redeemMiles`  
**Type:** Mutation (Protected)

**Input:**

```typescript
{
  bookingId: number;
  milesToRedeem: number;
}
```

**Response:**

```typescript
{
  success: boolean;
  discountAmount: number;
  remainingMiles: number;
}
```

---

## Admin API

### 1. Create Flight

Create a new flight schedule.

**Endpoint:** `admin.flights.create`  
**Type:** Mutation (Admin)

**Input:**

```typescript
{
  flightNumber: string;
  airlineId: number;
  originAirportId: number;
  destinationAirportId: number;
  departureTime: string; // ISO timestamp
  arrivalTime: string;
  basePrice: number;
  totalSeats: number;
  cabinClass: "economy" | "business" | "first";
}
```

**Response:**

```typescript
{
  id: number;
  flightNumber: string;
  status: "scheduled";
  createdAt: string;
}
```

---

### 2. Update Flight

Update flight details or status.

**Endpoint:** `admin.flights.update`  
**Type:** Mutation (Admin)

**Input:**

```typescript
{
  id: number;
  status?: 'scheduled' | 'delayed' | 'cancelled' | 'completed';
  departureTime?: string;
  arrivalTime?: string;
  basePrice?: number;
  delayReason?: string;
}
```

**Response:**

```typescript
{
  success: boolean;
  flight: {
    /* updated flight details */
  }
}
```

---

### 3. Get All Bookings

Retrieve all bookings with filtering (admin view).

**Endpoint:** `admin.bookings.list`  
**Type:** Query (Admin)

**Input:**

```typescript
{
  page?: number;
  limit?: number;
  status?: string;
  flightId?: number;
  dateFrom?: string;
  dateTo?: string;
  searchTerm?: string;       // Search by booking ref, PNR, or passenger name
}
```

**Response:**

```typescript
{
  bookings: Array<{
    id: number;
    bookingReference: string;
    pnr: string;
    status: string;
    totalAmount: number;
    passenger: string; // Primary passenger name
    flight: {
      /* flight summary */
    };
    createdAt: string;
  }>;
  total: number;
  page: number;
  totalPages: number;
}
```

---

## Analytics API

### 1. Get Dashboard Metrics

Get key performance indicators for admin dashboard.

**Endpoint:** `analytics.getDashboardMetrics`  
**Type:** Query (Admin)

**Input:**

```typescript
{
  dateFrom?: string;
  dateTo?: string;
}
```

**Response:**

```typescript
{
  totalBookings: number;
  totalRevenue: number;
  occupancyRate: number; // Percentage
  cancellationRate: number; // Percentage
  avgBookingValue: number;
  newCustomers: number;
  returningCustomers: number;
}
```

---

### 2. Get Revenue Trends

Get revenue data over time for charts.

**Endpoint:** `analytics.getRevenueTrends`  
**Type:** Query (Admin)

**Input:**

```typescript
{
  period: "daily" | "weekly" | "monthly";
  dateFrom: string;
  dateTo: string;
}
```

**Response:**

```typescript
{
  data: Array<{
    date: string;
    revenue: number;
    bookings: number;
  }>;
}
```

---

### 3. Get Popular Destinations

Get most booked routes.

**Endpoint:** `analytics.getPopularDestinations`  
**Type:** Query (Admin)

**Input:**

```typescript
{
  limit?: number;            // Default: 10
  dateFrom?: string;
  dateTo?: string;
}
```

**Response:**

```typescript
{
  destinations: Array<{
    route: string; // e.g., "RUH → JED"
    bookings: number;
    revenue: number;
    occupancyRate: number;
  }>;
}
```

---

## Phase 2 APIs

### Gate Management (`gates`)

Manage airport gates and flight gate assignments.

**Endpoints:**

| Endpoint                 | Type     | Auth   | Description                      |
| ------------------------ | -------- | ------ | -------------------------------- |
| `gates.list`             | Query    | Admin  | List all airport gates           |
| `gates.getById`          | Query    | Admin  | Get gate details                 |
| `gates.create`           | Mutation | Admin  | Create a new gate                |
| `gates.update`           | Mutation | Admin  | Update gate info                 |
| `gates.assign`           | Mutation | Admin  | Assign a gate to a flight        |
| `gates.getAssignment`    | Query    | Public | Get gate assignment for a flight |
| `gates.getChangeHistory` | Query    | Admin  | View gate change history         |

---

### Vouchers & Credits (`vouchers`)

Promotional codes and user credit system.

**Endpoints:**

| Endpoint                  | Type     | Auth      | Description                   |
| ------------------------- | -------- | --------- | ----------------------------- |
| `vouchers.validate`       | Query    | Protected | Validate a voucher code       |
| `vouchers.apply`          | Mutation | Protected | Apply voucher to booking      |
| `vouchers.create`         | Mutation | Admin     | Create a new voucher          |
| `vouchers.list`           | Query    | Admin     | List all vouchers             |
| `vouchers.getUserCredits` | Query    | Protected | Get user credit balance       |
| `vouchers.applyCredits`   | Mutation | Protected | Apply credits to booking      |
| `vouchers.addCredits`     | Mutation | Admin     | Add credits to a user account |

---

### Split Payments (`splitPayments`)

Allow multiple users to share booking costs.

**Endpoints:**

| Endpoint                     | Type     | Auth      | Description                |
| ---------------------------- | -------- | --------- | -------------------------- |
| `splitPayments.createSplit`  | Mutation | Protected | Create a payment split     |
| `splitPayments.getShareLink` | Query    | Protected | Get shareable payment link |
| `splitPayments.getShares`    | Query    | Protected | List shares for a booking  |
| `splitPayments.payShare`     | Mutation | Public    | Pay an individual share    |

---

### Price Calendar (`priceCalendar`)

Visual price comparison across dates.

**Endpoints:**

| Endpoint                    | Type  | Auth   | Description                       |
| --------------------------- | ----- | ------ | --------------------------------- |
| `priceCalendar.getCalendar` | Query | Public | Get prices for a month on a route |

**Input:**

```typescript
{
  originId: number;
  destinationId: number;
  month: number; // 1-12
  year: number;
}
```

---

### Waitlist (`waitlist`)

Join waitlist for full flights.

**Endpoints:**

| Endpoint               | Type     | Auth      | Description                     |
| ---------------------- | -------- | --------- | ------------------------------- |
| `waitlist.join`        | Mutation | Protected | Join waitlist for a flight      |
| `waitlist.getPosition` | Query    | Protected | Check position on waitlist      |
| `waitlist.leave`       | Mutation | Protected | Leave the waitlist              |
| `waitlist.getByFlight` | Query    | Admin     | View all waitlist entries       |
| `waitlist.offerSeat`   | Mutation | Admin     | Offer a seat to waitlisted user |

---

### Corporate Accounts (`corporate`)

Business travel management.

**Endpoints:**

| Endpoint                  | Type     | Auth      | Description                   |
| ------------------------- | -------- | --------- | ----------------------------- |
| `corporate.getAccount`    | Query    | Protected | Get corporate account details |
| `corporate.createBooking` | Mutation | Protected | Book with corporate billing   |
| `corporate.getBookings`   | Query    | Protected | List corporate bookings       |
| `corporate.getStatement`  | Query    | Protected | Get billing statement         |
| `corporate.addTraveler`   | Mutation | Protected | Add approved traveler         |

---

### Travel Agent (`travelAgent`)

Travel agent portal and commissions.

**Endpoints:**

| Endpoint                     | Type     | Auth      | Description             |
| ---------------------------- | -------- | --------- | ----------------------- |
| `travelAgent.getProfile`     | Query    | Protected | Get agent profile       |
| `travelAgent.createBooking`  | Mutation | Protected | Create booking as agent |
| `travelAgent.getCommissions` | Query    | Protected | View commission history |
| `travelAgent.getBookings`    | Query    | Protected | List agent bookings     |

---

### Group Bookings (`groupBookings`)

Group discount requests.

**Endpoints:**

| Endpoint                      | Type     | Auth      | Description                   |
| ----------------------------- | -------- | --------- | ----------------------------- |
| `groupBookings.createRequest` | Mutation | Protected | Submit group booking request  |
| `groupBookings.getRequests`   | Query    | Protected | View user's group requests    |
| `groupBookings.approve`       | Mutation | Admin     | Approve group booking request |
| `groupBookings.reject`        | Mutation | Admin     | Reject group booking request  |

---

### Notifications (`notifications`)

User notifications system.

**Endpoints:**

| Endpoint                          | Type     | Auth      | Description                  |
| --------------------------------- | -------- | --------- | ---------------------------- |
| `notifications.list`              | Query    | Protected | List user notifications      |
| `notifications.markRead`          | Mutation | Protected | Mark notification as read    |
| `notifications.markAllRead`       | Mutation | Protected | Mark all as read             |
| `notifications.getPreferences`    | Query    | Protected | Get notification preferences |
| `notifications.updatePreferences` | Mutation | Protected | Update preferences           |

---

### Price Alerts (`priceAlerts`)

Price drop notifications.

**Endpoints:**

| Endpoint             | Type     | Auth      | Description              |
| -------------------- | -------- | --------- | ------------------------ |
| `priceAlerts.create` | Mutation | Protected | Create a price alert     |
| `priceAlerts.list`   | Query    | Protected | List user's price alerts |
| `priceAlerts.delete` | Mutation | Protected | Delete a price alert     |

---

### Additional Phase 2 Routers

| Router            | Description                                |
| ----------------- | ------------------------------------------ |
| `baggage`         | Baggage tracking and management            |
| `multiCity`       | Multi-city itinerary search and booking    |
| `savedPassengers` | Saved passenger profiles for quick booking |
| `priceLock`       | Lock flight price for limited time         |
| `familyPool`      | Family mile pooling for loyalty program    |
| `wallet`          | Digital wallet balance and transactions    |
| `inventory`       | Inventory management and seat availability |
| `pricing`         | Dynamic pricing rules and calculations     |

---

## Phase 3 APIs

### Departure Control System (`dcs`)

**Endpoints:**

| Endpoint                | Type     | Auth  | Description                 |
| ----------------------- | -------- | ----- | --------------------------- |
| `dcs.getFlightManifest` | Query    | Admin | Get passenger manifest      |
| `dcs.boardPassenger`    | Mutation | Admin | Board a passenger           |
| `dcs.closeBoarding`     | Mutation | Admin | Close boarding for a flight |
| `dcs.getSeatMap`        | Query    | Admin | Get aircraft seat map       |

---

### Disruptions (`disruptions`)

Automated flight disruption handling.

**Endpoints:**

| Endpoint                          | Type     | Auth  | Description                     |
| --------------------------------- | -------- | ----- | ------------------------------- |
| `disruptions.getByFlight`         | Query    | Admin | Get disruptions for a flight    |
| `disruptions.createDisruption`    | Mutation | Admin | Record a flight disruption      |
| `disruptions.getAffectedBookings` | Query    | Admin | Get affected bookings           |
| `disruptions.autoRebook`          | Mutation | Admin | Auto-rebook affected passengers |

---

### Rebooking (`rebooking`)

Flight rebooking from previous booking.

**Endpoints:**

| Endpoint               | Type     | Auth      | Description            |
| ---------------------- | -------- | --------- | ---------------------- |
| `rebooking.getOptions` | Query    | Protected | Get rebooking options  |
| `rebooking.rebook`     | Mutation | Protected | Rebook to a new flight |

---

### AI Chat (`aiChat`)

AI-powered booking assistant.

**Endpoints:**

| Endpoint             | Type     | Auth      | Description                  |
| -------------------- | -------- | --------- | ---------------------------- |
| `aiChat.sendMessage` | Mutation | Protected | Send message to AI assistant |
| `aiChat.getHistory`  | Query    | Protected | Get chat history             |
| `aiChat.archiveChat` | Mutation | Protected | Archive a conversation       |

---

### Travel Scenarios (`travelScenarios`)

Carbon offset and travel document checks.

**Endpoints:**

| Endpoint                                | Type  | Auth      | Description                    |
| --------------------------------------- | ----- | --------- | ------------------------------ |
| `travelScenarios.calculateCarbonOffset` | Query | Public    | Calculate flight carbon offset |
| `travelScenarios.checkDocuments`        | Query | Protected | Validate travel documents      |

---

### Other System Routers

| Router       | Description                         |
| ------------ | ----------------------------------- |
| `health`     | System health checks                |
| `system`     | System info and version             |
| `reference`  | Reference data (airlines, airports) |
| `gdpr`       | GDPR data export and deletion       |
| `rateLimit`  | Rate limit status                   |
| `metrics`    | System metrics                      |
| `cache`      | Cache management                    |
| `softDelete` | Soft delete recovery                |
| `sms`        | SMS notification service            |

---

## Phase 4 APIs

Phase 4 closes competitive gaps identified in the system comparison against Altéa, SabreSonic, Travelport, Navitaire, and other major aviation platforms.

### IROPS Command Center (`irops`)

Irregular operations management and real-time coordination.

| Endpoint                      | Type     | Auth  | Description                      |
| ----------------------------- | -------- | ----- | -------------------------------- |
| `irops.getActiveIROPS`        | Query    | Admin | Get active irregular operations  |
| `irops.declareIROPS`          | Mutation | Admin | Declare IROPS for a flight       |
| `irops.getAffectedPassengers` | Query    | Admin | Get passengers affected by IROPS |
| `irops.executeRecoveryAction` | Mutation | Admin | Execute a recovery action        |
| `irops.getRecoveryPlan`       | Query    | Admin | Get automated recovery plan      |

---

### Weight & Balance (`weightBalance`)

Aircraft weight and balance calculations for flight operations.

| Endpoint                            | Type     | Auth  | Description                     |
| ----------------------------------- | -------- | ----- | ------------------------------- |
| `weightBalance.calculate`           | Mutation | Admin | Calculate W&B for a flight      |
| `weightBalance.getLoadSheet`        | Query    | Admin | Get load sheet                  |
| `weightBalance.validateLimits`      | Query    | Admin | Validate within aircraft limits |
| `weightBalance.getAircraftEnvelope` | Query    | Admin | Get CG envelope data            |

---

### Load Planning (`loadPlanning`)

Cargo and passenger load planning for DCS operations.

| Endpoint                         | Type     | Auth  | Description                   |
| -------------------------------- | -------- | ----- | ----------------------------- |
| `loadPlanning.createLoadPlan`    | Mutation | Admin | Create a load plan            |
| `loadPlanning.getLoadPlan`       | Query    | Admin | Get load plan for flight      |
| `loadPlanning.optimizeLoad`      | Mutation | Admin | Optimize cargo distribution   |
| `loadPlanning.getULDAssignments` | Query    | Admin | Get ULD container assignments |

---

### Crew Assignment (`crew`)

Crew scheduling and assignment management.

| Endpoint                | Type     | Auth  | Description                   |
| ----------------------- | -------- | ----- | ----------------------------- |
| `crew.getFlightCrew`    | Query    | Admin | Get crew assigned to flight   |
| `crew.assignCrew`       | Mutation | Admin | Assign crew member to flight  |
| `crew.getAvailableCrew` | Query    | Admin | Get available crew members    |
| `crew.getCrewSchedule`  | Query    | Admin | Get crew member schedule      |
| `crew.checkFTL`         | Query    | Admin | Check flight time limitations |

---

### APIS - Advance Passenger Information (`apis`)

Border compliance and advance passenger information submission.

| Endpoint                   | Type     | Auth      | Description                     |
| -------------------------- | -------- | --------- | ------------------------------- |
| `apis.submitPassengerData` | Mutation | Admin     | Submit APIS data to authorities |
| `apis.validatePassenger`   | Query    | Protected | Validate passenger travel docs  |
| `apis.getSubmissionStatus` | Query    | Admin     | Get APIS submission status      |
| `apis.checkNoFlyList`      | Query    | Admin     | Check passenger against no-fly  |

---

### Biometric Boarding (`biometric`)

Facial recognition and biometric boarding system.

| Endpoint                      | Type     | Auth      | Description                   |
| ----------------------------- | -------- | --------- | ----------------------------- |
| `biometric.enrollPassenger`   | Mutation | Protected | Enroll biometric data         |
| `biometric.verifyIdentity`    | Mutation | Admin     | Verify passenger identity     |
| `biometric.getBoardingStatus` | Query    | Admin     | Get biometric boarding status |

---

### Self-Service Kiosk (`kiosk`)

Airport kiosk check-in operations.

| Endpoint                  | Type     | Auth   | Description             |
| ------------------------- | -------- | ------ | ----------------------- |
| `kiosk.checkIn`           | Mutation | Public | Self-service check-in   |
| `kiosk.selectSeat`        | Mutation | Public | Seat selection at kiosk |
| `kiosk.printBoardingPass` | Mutation | Public | Print boarding pass     |
| `kiosk.printBagTag`       | Mutation | Public | Print baggage tag       |

---

### Automated Bag Drop (`bagDrop`)

Self-service baggage drop system.

| Endpoint               | Type     | Auth  | Description                    |
| ---------------------- | -------- | ----- | ------------------------------ |
| `bagDrop.initiateDrop` | Mutation | Admin | Initiate bag drop session      |
| `bagDrop.validateBag`  | Query    | Admin | Validate bag weight/dimensions |
| `bagDrop.confirmDrop`  | Mutation | Admin | Confirm bag acceptance         |
| `bagDrop.getStatus`    | Query    | Admin | Get bag drop station status    |

---

### Revenue Accounting (`revenueAccounting`)

Revenue recognition and financial reporting.

| Endpoint                               | Type  | Auth  | Description                  |
| -------------------------------------- | ----- | ----- | ---------------------------- |
| `revenueAccounting.getRevenueReport`   | Query | Admin | Get revenue report by period |
| `revenueAccounting.getRevenueByRoute`  | Query | Admin | Revenue breakdown by route   |
| `revenueAccounting.getUnearnedRevenue` | Query | Admin | Get unearned revenue report  |
| `revenueAccounting.reconcileTickets`   | Query | Admin | Ticket reconciliation report |

---

### BSP Reporting (`bspReporting`)

IATA BSP settlement and reporting.

| Endpoint                           | Type     | Auth  | Description                |
| ---------------------------------- | -------- | ----- | -------------------------- |
| `bspReporting.generateHOT`         | Mutation | Admin | Generate HOT report        |
| `bspReporting.getSettlementReport` | Query    | Admin | Get BSP settlement data    |
| `bspReporting.getAgentSales`       | Query    | Admin | Get agent sales report     |
| `bspReporting.reconcile`           | Mutation | Admin | Reconcile BSP transactions |

---

### EU261/DOT Compensation (`compensation`)

Regulatory compensation management for flight disruptions.

| Endpoint                            | Type     | Auth      | Description                    |
| ----------------------------------- | -------- | --------- | ------------------------------ |
| `compensation.calculateEligibility` | Query    | Protected | Check compensation eligibility |
| `compensation.submitClaim`          | Mutation | Protected | Submit compensation claim      |
| `compensation.getClaimStatus`       | Query    | Protected | Get claim status               |
| `compensation.processClaim`         | Mutation | Admin     | Process/approve compensation   |
| `compensation.getRegulations`       | Query    | Public    | Get applicable regulations     |

---

### Emergency Hotel (`emergencyHotel`)

IROPS hotel accommodation management.

| Endpoint                            | Type     | Auth  | Description                      |
| ----------------------------------- | -------- | ----- | -------------------------------- |
| `emergencyHotel.searchAvailability` | Query    | Admin | Search nearby hotel availability |
| `emergencyHotel.bookAccommodation`  | Mutation | Admin | Book emergency hotel room        |
| `emergencyHotel.getBookings`        | Query    | Admin | Get IROPS hotel bookings         |
| `emergencyHotel.issueVoucher`       | Mutation | Admin | Issue hotel voucher to passenger |

---

### Passenger Priority (`passengerPriority`)

Priority scoring for rebooking and service recovery.

| Endpoint                               | Type  | Auth  | Description                     |
| -------------------------------------- | ----- | ----- | ------------------------------- |
| `passengerPriority.calculatePriority`  | Query | Admin | Calculate passenger priority    |
| `passengerPriority.getRebookingOrder`  | Query | Admin | Get prioritized rebooking order |
| `passengerPriority.getPriorityFactors` | Query | Admin | Get priority scoring factors    |

---

### SLA Monitoring (`sla`)

Service level agreement tracking and compliance.

| Endpoint                  | Type     | Auth  | Description                   |
| ------------------------- | -------- | ----- | ----------------------------- |
| `sla.getDashboard`        | Query    | Admin | Get SLA dashboard metrics     |
| `sla.getBreaches`         | Query    | Admin | Get SLA breach events         |
| `sla.createTarget`        | Mutation | Admin | Create SLA target             |
| `sla.getPerformanceTrend` | Query    | Admin | Get SLA performance over time |

---

### Data Warehouse / BI (`dataWarehouse`)

Business intelligence and analytics data warehouse.

| Endpoint                             | Type  | Auth  | Description                     |
| ------------------------------------ | ----- | ----- | ------------------------------- |
| `dataWarehouse.getKPIs`              | Query | Admin | Get key performance indicators  |
| `dataWarehouse.getRevenueAnalytics`  | Query | Admin | Revenue analytics and trends    |
| `dataWarehouse.getOperationsMetrics` | Query | Admin | Operational performance metrics |
| `dataWarehouse.getCustomerInsights`  | Query | Admin | Customer behavior analytics     |

---

### MFA / TOTP (`mfa`)

Multi-factor authentication with TOTP.

| Endpoint             | Type     | Auth      | Description             |
| -------------------- | -------- | --------- | ----------------------- |
| `mfa.setup`          | Mutation | Protected | Initialize MFA setup    |
| `mfa.verifySetup`    | Mutation | Protected | Verify and enable MFA   |
| `mfa.verifyLogin`    | Mutation | Public    | Verify MFA during login |
| `mfa.disable`        | Mutation | Protected | Disable MFA             |
| `mfa.generateBackup` | Mutation | Protected | Generate backup codes   |
| `mfa.useBackupCode`  | Mutation | Public    | Use a backup code       |

---

### Multi-Region (`multiRegion`)

Multi-region deployment configuration.

| Endpoint                        | Type     | Auth  | Description                |
| ------------------------------- | -------- | ----- | -------------------------- |
| `multiRegion.getRegions`        | Query    | Admin | Get configured regions     |
| `multiRegion.getRegionHealth`   | Query    | Admin | Get region health status   |
| `multiRegion.setActiveRegion`   | Mutation | Admin | Set active region          |
| `multiRegion.getFailoverConfig` | Query    | Admin | Get failover configuration |

---

### Disaster Recovery (`disasterRecovery`)

Business continuity and DR planning.

| Endpoint                            | Type     | Auth  | Description              |
| ----------------------------------- | -------- | ----- | ------------------------ |
| `disasterRecovery.getStatus`        | Query    | Admin | Get DR system status     |
| `disasterRecovery.initiateFailover` | Mutation | Admin | Initiate failover        |
| `disasterRecovery.runHealthCheck`   | Mutation | Admin | Run DR health check      |
| `disasterRecovery.getRecoveryPlan`  | Query    | Admin | Get BCP/DR recovery plan |

---

### Cookie Consent (`consent`)

Privacy consent management (GDPR/CCPA).

| Endpoint                 | Type     | Auth   | Description                  |
| ------------------------ | -------- | ------ | ---------------------------- |
| `consent.getPreferences` | Query    | Public | Get user consent preferences |
| `consent.updateConsent`  | Mutation | Public | Update consent choices       |
| `consent.getPolicy`      | Query    | Public | Get current privacy policy   |

---

### Suggestions (`suggestions`)

Personalized flight suggestions, popular flights, and deal recommendations.

**Endpoints:**

| Endpoint              | Type  | Auth      | Description                           |
| --------------------- | ----- | --------- | ------------------------------------- |
| `suggestions.forUser` | Query | Protected | Get personalized suggestions for user |
| `suggestions.popular` | Query | Public    | Get popular flights                   |
| `suggestions.deals`   | Query | Public    | Get deal/cheap flights                |

---

#### 1. Get Personalized Suggestions

Returns personalized flight suggestions based on user booking history and preferences.

**Endpoint:** `suggestions.forUser`
**Type:** Query (Protected)

**Input:**

```typescript
{
  limit?: number;  // 1-20, default: 6
}
```

**Response:**

```typescript
Array<{
  flightId: number;
  flightNumber: string;
  originId: number;
  originCode: string;
  originCity: string;
  destinationId: number;
  destinationCode: string;
  destinationCity: string;
  departureTime: string; // ISO timestamp
  arrivalTime: string; // ISO timestamp
  economyPrice: number; // SAR cents
  businessPrice: number; // SAR cents
  economyAvailable: number;
  businessAvailable: number;
  airlineName: string;
  airlineCode: string;
  reason: "history" | "popular" | "deal" | "trending";
  score: number;
}>;
```

**Example:**

```typescript
const { data } = trpc.suggestions.forUser.useQuery({ limit: 10 });
```

---

#### 2. Get Popular Flights

Returns the most popular flights based on booking volume and demand.

**Endpoint:** `suggestions.popular`
**Type:** Query (Public)

**Input:**

```typescript
{
  limit?: number;  // 1-20, default: 6
}
```

**Response:**

```typescript
Array<SuggestedFlight>; // Same shape as suggestions.forUser response
```

**Example:**

```typescript
const { data } = trpc.suggestions.popular.useQuery({ limit: 6 });
```

---

#### 3. Get Deal Flights

Returns flights with the best deals and lowest prices.

**Endpoint:** `suggestions.deals`
**Type:** Query (Public)

**Input:**

```typescript
{
  limit?: number;  // 1-20, default: 4
}
```

**Response:**

```typescript
Array<SuggestedFlight>; // Same shape as suggestions.forUser response
```

**Example:**

```typescript
const { data } = trpc.suggestions.deals.useQuery({ limit: 4 });
```

---

## Error Handling

### Error Response Format

All errors follow this structure:

```typescript
{
  error: {
    code: string;
    message: string;
    data?: any;
  }
}
```

### Error Codes

| Code                    | HTTP Status | Description                         |
| ----------------------- | ----------- | ----------------------------------- |
| `BAD_REQUEST`           | 400         | Invalid input parameters            |
| `UNAUTHORIZED`          | 401         | Authentication required             |
| `FORBIDDEN`             | 403         | Insufficient permissions            |
| `NOT_FOUND`             | 404         | Resource not found                  |
| `CONFLICT`              | 409         | Resource conflict (e.g., duplicate) |
| `INTERNAL_SERVER_ERROR` | 500         | Server error                        |

### Example Error Response

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Flight with ID 999 not found",
    "data": {
      "flightId": 999
    }
  }
}
```

---

## Rate Limiting

### Limits

- **Default:** 100 requests per 15 minutes
- **Webhook endpoints:** 1000 requests per 15 minutes
- **Admin endpoints:** 200 requests per 15 minutes

### Rate Limit Headers

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1609459200
```

### Rate Limit Exceeded Response

```json
{
  "error": {
    "code": "TOO_MANY_REQUESTS",
    "message": "Rate limit exceeded. Try again in 5 minutes.",
    "data": {
      "retryAfter": 300
    }
  }
}
```

---

## Pagination

All list endpoints support pagination:

**Query Parameters:**

- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20, max: 100)

**Response:**

```typescript
{
  data: Array<T>;
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  }
}
```

---

## Versioning

The API currently uses version 2.0. Future breaking changes will be introduced as new versions.

**Version Header (future):**

```http
X-API-Version: 2.0
```

---

## Support

For API issues or questions:

- Email: api-support@ais.com
- Documentation: https://ais-aviation-system.manus.space/docs
- GitHub Issues: https://github.com/kafaat/ais-aviation-system/issues

---

**Last Updated:** February 2026
**API Version:** 4.0
