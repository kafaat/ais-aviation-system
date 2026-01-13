# AIS Aviation System - API Documentation

**Version:** 2.0  
**Last Updated:** January 2026  
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
9. [Error Handling](#error-handling)
10. [Rate Limiting](#rate-limiting)

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

**Last Updated:** January 2026  
**API Version:** 2.0
