# Booking State Machine - Implementation Guide

## Overview

The booking state machine is a critical component that ensures booking integrity and prevents invalid state transitions. It implements a finite state machine pattern with comprehensive audit trails.

## State Diagram

```
┌──────────┐
│INITIATED │ (Initial state when booking is created)
└────┬─────┘
     │
     ├─→ RESERVED (Seats locked, pending payment - TTL: 15 min)
     │      │
     │      ├─→ PAID (Payment successful)
     │      │     │
     │      │     ├─→ TICKETED (E-ticket issued)
     │      │     │     │
     │      │     │     ├─→ CHECKED_IN (Check-in completed)
     │      │     │     │     │
     │      │     │     │     ├─→ BOARDED (Passenger boarded)
     │      │     │     │     │     │
     │      │     │     │     │     └─→ FLOWN ✓ (Terminal state)
     │      │     │     │     │
     │      │     │     │     └─→ NO_SHOW ✗ (Terminal state)
     │      │     │     │
     │      │     │     └─→ CANCELLED
     │      │     │              │
     │      │     │              └─→ REFUNDED ✓ (Terminal state)
     │      │     │
     │      │     └─→ PAYMENT_FAILED
     │      │            │
     │      │            ├─→ RESERVED (Retry)
     │      │            └─→ CANCELLED
     │      │
     │      ├─→ EXPIRED (Reservation timeout)
     │      │     │
     │      │     └─→ RESERVED (User can retry)
     │      │
     │      └─→ CANCELLED
     │
     └─→ EXPIRED
          │
          └─→ RESERVED (User can retry)
```

## States

### Active States

| State | Description | Duration | Next States |
|-------|-------------|----------|-------------|
| `initiated` | Booking created, no seats locked yet | Instant | reserved, expired, cancelled |
| `reserved` | Seats locked, pending payment | 15 min | paid, expired, cancelled |
| `paid` | Payment successful, awaiting ticket | ~1 min | ticketed, payment_failed, cancelled |
| `ticketed` | E-ticket issued | Until flight | checked_in, cancelled, no_show |
| `checked_in` | Check-in completed | Until boarding | boarded, no_show |
| `boarded` | Passenger on aircraft | Until flight | flown |

### Terminal States

| State | Description | Refundable |
|-------|-------------|------------|
| `flown` | Flight completed successfully | No |
| `refunded` | Payment refunded to customer | N/A |
| `no_show` | Passenger didn't show up | Partial |

### Error States

| State | Description | Recoverable |
|-------|-------------|-------------|
| `expired` | Reservation timeout (15 min) | Yes - can retry |
| `payment_failed` | Payment processing failed | Yes - can retry |
| `cancelled` | Booking cancelled by user/admin | Only if paid |

## Implementation

### Basic Usage

```typescript
import {
  transitionBookingStatus,
  initializeBookingStatus,
  reserveBooking,
  markBookingPaid,
  cancelBooking,
} from './services/booking-state-machine.service';

// 1. Initialize booking
await initializeBookingStatus(
  bookingId,
  userId,
  'user',
  req.ip,
  req.headers['user-agent']
);

// 2. Reserve seats
await reserveBooking(
  bookingId,
  userId,
  req.ip,
  req.headers['user-agent']
);

// 3. Mark as paid (after payment success)
await markBookingPaid(
  bookingId,
  paymentIntentId,
  userId,
  req.ip,
  req.headers['user-agent']
);

// 4. Cancel if needed
await cancelBooking(
  bookingId,
  'User requested cancellation',
  userId,
  'user',
  'user',
  req.ip,
  req.headers['user-agent']
);
```

### Custom Transitions

```typescript
import { transitionBookingStatus } from './services/booking-state-machine.service';

await transitionBookingStatus({
  bookingId: 123,
  newStatus: 'checked_in',
  reason: 'Online check-in completed',
  actorId: userId,
  actorType: 'user',
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
});
```

### Query State History

```typescript
import { 
  getCurrentBookingStatus,
  getBookingStatusHistory 
} from './services/booking-state-machine.service';

// Get current status
const currentStatus = await getCurrentBookingStatus(bookingId);

// Get full history
const history = await getBookingStatusHistory(bookingId);
history.forEach(record => {
  console.log(`${record.oldStatus} → ${record.newStatus} at ${record.createdAt}`);
  console.log(`Reason: ${record.reason}`);
  console.log(`Actor: ${record.actorType} (ID: ${record.actorId})`);
});
```

## Validation Rules

### Transition Validation

```typescript
import { isValidTransition } from '../../drizzle/booking-status-history-schema';

// Check if transition is valid
if (!isValidTransition('reserved', 'paid')) {
  throw new Error('Invalid transition');
}
```

### Valid Transitions Table

| From State | Valid Next States |
|------------|-------------------|
| `null` (new) | `initiated` |
| `initiated` | `reserved`, `expired`, `cancelled` |
| `reserved` | `paid`, `expired`, `cancelled` |
| `paid` | `ticketed`, `payment_failed`, `cancelled` |
| `ticketed` | `checked_in`, `cancelled`, `no_show` |
| `checked_in` | `boarded`, `no_show` |
| `boarded` | `flown` |
| `flown` | (none - terminal) |
| `expired` | `reserved` (retry) |
| `payment_failed` | `reserved` (retry), `cancelled` |
| `cancelled` | `refunded` (if paid) |
| `refunded` | (none - terminal) |
| `no_show` | (none - terminal) |

## Business Logic

### Seat Hold TTL

**Implementation:**
```typescript
// Inventory lock service automatically releases seats after 15 minutes
const lock = await createInventoryLock({
  flightId,
  numberOfSeats,
  cabinClass,
  userId,
  sessionId,
  expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
});

// Background job checks for expired locks
setInterval(async () => {
  const expiredLocks = await getExpiredLocks();
  for (const lock of expiredLocks) {
    await releaseInventoryLock(lock.id);
    await expireBooking(lock.bookingId, 'Reservation expired');
  }
}, 60 * 1000); // Check every minute
```

### Double Booking Prevention

**Enforced Through:**
1. **State Machine** - Must go through `reserved` state before `paid`
2. **Inventory Locks** - Pessimistic locking on seats
3. **Optimistic Locking** - Version column on flights table
4. **Unique Constraints** - DB-level uniqueness on seat bookings

### Cancellation & Refund

```typescript
// Check if refund is possible
const currentStatus = await getCurrentBookingStatus(bookingId);

if (!['paid', 'ticketed', 'checked_in'].includes(currentStatus)) {
  throw new Error('Booking cannot be refunded in current state');
}

// Cancel booking
await cancelBooking(bookingId, reason, userId, 'user');

// Process refund
await processRefund(bookingId);

// Update to refunded state
await transitionBookingStatus({
  bookingId,
  newStatus: 'refunded',
  reason: 'Refund processed successfully',
  actorType: 'system',
});
```

## Audit Trail

### Automatic Logging

Every state transition is automatically logged to:
1. **booking_status_history** table - Full transition details
2. **audit_logs** table - High-level audit trail

### Audit Record Structure

```typescript
interface BookingStatusHistory {
  id: number;
  bookingId: number;
  oldStatus: BookingStatus | null;
  newStatus: BookingStatus;
  reason?: string;
  notes?: string;
  actorId?: number;
  actorType: 'user' | 'admin' | 'system';
  actorRole?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}
```

### Query Audit Trail

```sql
-- Get all transitions for a booking
SELECT 
  id,
  oldStatus,
  newStatus,
  reason,
  actorType,
  actorRole,
  createdAt
FROM booking_status_history
WHERE bookingId = ?
ORDER BY createdAt DESC;

-- Find all bookings that expired
SELECT 
  bookingId,
  COUNT(*) as expiration_count
FROM booking_status_history
WHERE newStatus = 'expired'
GROUP BY bookingId
HAVING expiration_count > 1;

-- Track admin interventions
SELECT 
  bookingId,
  oldStatus,
  newStatus,
  reason,
  actorId,
  createdAt
FROM booking_status_history
WHERE actorType = 'admin'
ORDER BY createdAt DESC;
```

## Error Handling

### Invalid Transition Attempt

```typescript
try {
  await transitionBookingStatus({
    bookingId: 123,
    newStatus: 'flown',
    actorType: 'user',
  });
} catch (error) {
  if (error.code === 'BAD_REQUEST') {
    // Invalid transition - current state doesn't allow this
    console.error('Invalid state transition:', error.message);
  }
}
```

### Timeout Scenarios

```typescript
// Automatically handled by background job
// Manual expiration:
await expireBooking(bookingId, 'Payment window expired');

// User can retry:
await reserveBooking(bookingId, userId);
```

## Testing

### State Machine Tests

```typescript
import { describe, it, expect } from 'vitest';
import { isValidTransition } from '../../drizzle/booking-status-history-schema';

describe('State Machine Validation', () => {
  it('should allow initiated -> reserved transition', () => {
    expect(isValidTransition('initiated', 'reserved')).toBe(true);
  });

  it('should prevent initiated -> paid transition', () => {
    expect(isValidTransition('initiated', 'paid')).toBe(false);
  });

  it('should allow retry after expiration', () => {
    expect(isValidTransition('expired', 'reserved')).toBe(true);
  });

  it('should prevent transitions from terminal states', () => {
    expect(isValidTransition('flown', 'cancelled')).toBe(false);
    expect(isValidTransition('refunded', 'paid')).toBe(false);
  });
});
```

## Performance Considerations

### Database Indexes

```sql
-- booking_status_history indexes
CREATE INDEX idx_bsh_booking_id ON booking_status_history(bookingId);
CREATE INDEX idx_bsh_new_status ON booking_status_history(newStatus);
CREATE INDEX idx_bsh_actor_id ON booking_status_history(actorId);
CREATE INDEX idx_bsh_created_at ON booking_status_history(createdAt);

-- Composite index for common queries
CREATE INDEX idx_bsh_booking_status_date 
ON booking_status_history(bookingId, newStatus, createdAt);
```

### Query Optimization

```typescript
// Cache current status to avoid repeated queries
const statusCache = new Map<number, BookingStatus>();

async function getCachedStatus(bookingId: number): Promise<BookingStatus> {
  if (!statusCache.has(bookingId)) {
    const status = await getCurrentBookingStatus(bookingId);
    statusCache.set(bookingId, status);
  }
  return statusCache.get(bookingId)!;
}

// Invalidate cache on transition
async function transitionWithCacheInvalidation(...) {
  await transitionBookingStatus(...);
  statusCache.delete(bookingId);
}
```

## Monitoring & Alerts

### Metrics to Track

```typescript
// Track state distribution
const metrics = {
  bookings_by_state: {
    initiated: 10,
    reserved: 25,
    paid: 50,
    ticketed: 100,
    // ...
  },
  
  // Track transitions
  transitions_per_hour: 150,
  expired_reservations_per_hour: 5,
  failed_payments_per_hour: 2,
  
  // Track duration in each state
  avg_time_to_payment: '5m 30s',
  avg_reservation_hold_time: '8m 15s',
};
```

### Alerts

```yaml
# High expiration rate alert
- alert: HighExpirationRate
  expr: rate(booking_transitions{to_state="expired"}[5m]) > 0.1
  for: 5m
  annotations:
    summary: "High booking expiration rate"
    
# Payment failures alert
- alert: HighPaymentFailureRate
  expr: rate(booking_transitions{to_state="payment_failed"}[5m]) > 0.05
  for: 10m
  annotations:
    summary: "High payment failure rate"
```

## Best Practices

1. **Always use transition functions** - Never update status directly in database
2. **Log all transitions** - Every state change must be audited
3. **Handle timeouts gracefully** - Expired bookings should allow retry
4. **Prevent terminal state transitions** - flown, refunded, no_show are final
5. **Use descriptive reasons** - Help debug issues and customer service
6. **Track actor information** - Know who/what triggered the transition
7. **Test state machine thoroughly** - Invalid transitions should be impossible

## Troubleshooting

### Common Issues

**Issue: Booking stuck in reserved state**
```typescript
// Check if inventory lock expired
const lock = await getInventoryLockForBooking(bookingId);
if (lock.expiresAt < new Date()) {
  await expireBooking(bookingId, 'Lock expired');
}
```

**Issue: User can't retry after expiration**
```typescript
// Ensure expired -> reserved transition is allowed
expect(isValidTransition('expired', 'reserved')).toBe(true);

// Reset to reserved
await transitionBookingStatus({
  bookingId,
  newStatus: 'reserved',
  reason: 'User retry after expiration',
  actorType: 'user',
});
```

**Issue: Invalid state in database**
```sql
-- Find bookings with no status history
SELECT b.id, b.status
FROM bookings b
LEFT JOIN booking_status_history bsh ON b.id = bsh.bookingId
WHERE bsh.id IS NULL;

-- Fix by initializing status
INSERT INTO booking_status_history (bookingId, newStatus, reason, actorType)
VALUES (?, 'initiated', 'Retroactive initialization', 'system');
```
