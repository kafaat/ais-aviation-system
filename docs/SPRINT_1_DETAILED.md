# Sprint 1 - Core Correctness & State Machine (تفصيلي)

**المدة:** أسبوعان  
**التاريخ:** 26 يناير 2026  
**الهدف:** لا double booking، لا double charge، لا حالات مكسورة

---

## 📋 نظرة عامة

هذا Sprint يركز على **الصحة الأساسية** للنظام. نريد التأكد من أن:
1. كل حجز له حالة واضحة ومحددة
2. لا يمكن حجز نفس المقعد مرتين
3. لا يمكن شحن العميل مرتين
4. جميع العمليات الحرجة atomic

---

## 🎯 User Stories

### US-1.1: تعريف حالات الحجز رسمياً

#### الوصف
تحديد جميع الحالات الممكنة للحجز وتوثيقها بشكل واضح.

#### الحالات المطلوبة

```typescript
// server/services/booking-state-machine.service.ts

export enum BookingStatus {
  // Initial states
  PENDING = 'pending',              // تم إنشاء الحجز، في انتظار الدفع
  PAYMENT_PROCESSING = 'payment_processing', // جاري معالجة الدفع
  
  // Success states
  CONFIRMED = 'confirmed',          // تم تأكيد الحجز والدفع
  CHECKED_IN = 'checked_in',        // تم تسجيل الوصول
  COMPLETED = 'completed',          // تم إكمال الرحلة
  
  // Modification states
  MODIFICATION_REQUESTED = 'modification_requested', // طلب تعديل
  MODIFIED = 'modified',            // تم التعديل
  
  // Cancellation states
  CANCELLATION_REQUESTED = 'cancellation_requested', // طلب إلغاء
  CANCELLED = 'cancelled',          // تم الإلغاء
  
  // Refund states
  REFUND_PENDING = 'refund_pending', // في انتظار الاسترداد
  REFUNDED = 'refunded',            // تم الاسترداد
  PARTIALLY_REFUNDED = 'partially_refunded', // استرداد جزئي
  
  // Failure states
  PAYMENT_FAILED = 'payment_failed', // فشل الدفع
  EXPIRED = 'expired',              // انتهت صلاحية الحجز
}
```

#### State Diagram

```
[PENDING] ──payment_processing──> [PAYMENT_PROCESSING]
    │                                      │
    │                                      ├──success──> [CONFIRMED]
    │                                      │
    │                                      └──failed───> [PAYMENT_FAILED]
    │
    └──timeout──> [EXPIRED]


[CONFIRMED] ──check_in──> [CHECKED_IN] ──complete──> [COMPLETED]
    │
    ├──request_modification──> [MODIFICATION_REQUESTED] ──approve──> [MODIFIED]
    │
    └──request_cancellation──> [CANCELLATION_REQUESTED] ──approve──> [CANCELLED]


[CANCELLED] ──request_refund──> [REFUND_PENDING] ──process──> [REFUNDED]
                                                              or
                                                              [PARTIALLY_REFUNDED]
```

#### المهام

- [ ] **Task 1.1.1:** مراجعة الـ enum الحالي في `booking-state-machine.service.ts`
- [ ] **Task 1.1.2:** إضافة الحالات المفقودة
- [ ] **Task 1.1.3:** توثيق كل حالة في JSDoc
- [ ] **Task 1.1.4:** إنشاء state diagram في `docs/BOOKING_STATE_DIAGRAM.md`

#### Acceptance Criteria

- [x] جميع الحالات محددة في enum
- [x] كل حالة لها JSDoc comment يشرحها
- [x] State diagram موثق
- [x] الفريق يفهم جميع الحالات

---

### US-1.2: منع الانتقال لحالة غير منطقية

#### الوصف
تطبيق validations صارمة لمنع الانتقالات غير المنطقية بين الحالات.

#### Allowed Transitions

```typescript
// server/services/booking-state-machine.service.ts

const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  [BookingStatus.PENDING]: [
    BookingStatus.PAYMENT_PROCESSING,
    BookingStatus.EXPIRED,
    BookingStatus.CANCELLED,
  ],
  
  [BookingStatus.PAYMENT_PROCESSING]: [
    BookingStatus.CONFIRMED,
    BookingStatus.PAYMENT_FAILED,
  ],
  
  [BookingStatus.CONFIRMED]: [
    BookingStatus.CHECKED_IN,
    BookingStatus.MODIFICATION_REQUESTED,
    BookingStatus.CANCELLATION_REQUESTED,
  ],
  
  [BookingStatus.CHECKED_IN]: [
    BookingStatus.COMPLETED,
  ],
  
  [BookingStatus.MODIFICATION_REQUESTED]: [
    BookingStatus.MODIFIED,
    BookingStatus.CONFIRMED, // رفض التعديل
  ],
  
  [BookingStatus.MODIFIED]: [
    BookingStatus.CONFIRMED, // بعد إتمام التعديل
  ],
  
  [BookingStatus.CANCELLATION_REQUESTED]: [
    BookingStatus.CANCELLED,
    BookingStatus.CONFIRMED, // رفض الإلغاء
  ],
  
  [BookingStatus.CANCELLED]: [
    BookingStatus.REFUND_PENDING,
  ],
  
  [BookingStatus.REFUND_PENDING]: [
    BookingStatus.REFUNDED,
    BookingStatus.PARTIALLY_REFUNDED,
  ],
  
  // Terminal states - لا انتقالات
  [BookingStatus.COMPLETED]: [],
  [BookingStatus.REFUNDED]: [],
  [BookingStatus.PARTIALLY_REFUNDED]: [],
  [BookingStatus.PAYMENT_FAILED]: [],
  [BookingStatus.EXPIRED]: [],
};
```

#### Implementation

```typescript
// server/services/booking-state-machine.service.ts

export class BookingStateMachineService {
  canTransition(from: BookingStatus, to: BookingStatus): boolean {
    const allowedTransitions = ALLOWED_TRANSITIONS[from];
    return allowedTransitions.includes(to);
  }

  transition(
    booking: Booking,
    newStatus: BookingStatus,
    reason?: string
  ): Booking {
    if (!this.canTransition(booking.status, newStatus)) {
      throw new InvalidStateTransitionError(
        `Cannot transition from ${booking.status} to ${newStatus}`
      );
    }

    // Log the transition
    logger.info('Booking state transition', {
      bookingId: booking.id,
      from: booking.status,
      to: newStatus,
      reason,
    });

    // Update the booking
    return {
      ...booking,
      status: newStatus,
      statusUpdatedAt: new Date(),
    };
  }
}
```

#### المهام

- [ ] **Task 1.2.1:** إنشاء `ALLOWED_TRANSITIONS` map
- [ ] **Task 1.2.2:** تطبيق `canTransition()` method
- [ ] **Task 1.2.3:** تطبيق `transition()` method
- [ ] **Task 1.2.4:** إنشاء `InvalidStateTransitionError` class
- [ ] **Task 1.2.5:** استخدام `transition()` في جميع services
- [ ] **Task 1.2.6:** كتابة unit tests لكل انتقال

#### الملفات المتأثرة

```
server/
├── services/
│   ├── booking-state-machine.service.ts (تعديل)
│   ├── bookings.service.ts (تعديل)
│   ├── refunds.service.ts (تعديل)
│   └── booking-modification.service.ts (تعديل)
└── _core/
    └── errors.ts (إضافة InvalidStateTransitionError)
```

#### Acceptance Criteria

- [x] `canTransition()` يعمل بشكل صحيح
- [x] `transition()` يرفض الانتقالات غير الصالحة
- [x] جميع services تستخدم `transition()`
- [x] Unit tests تغطي جميع الحالات
- [x] Error handling واضح

---

### US-1.3: إضافة Idempotency Keys للحجوزات

#### الوصف
تطبيق idempotency للحجوزات لمنع التكرار عند إعادة إرسال الطلب.

#### Database Schema

```typescript
// drizzle/schema.ts

export const idempotencyKeys = pgTable('idempotency_keys', {
  key: varchar('key', { length: 255 }).primaryKey(),
  resourceType: varchar('resource_type', { length: 50 }).notNull(), // 'booking', 'payment', etc.
  resourceId: varchar('resource_id', { length: 255 }), // ID of created resource
  response: json('response'), // Cached response
  statusCode: integer('status_code'), // HTTP status code
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(), // 24 hours from creation
}, (table) => ({
  expiresAtIdx: index('idempotency_keys_expires_at_idx').on(table.expiresAt),
}));
```

#### Migration

```sql
-- drizzle/migrations/XXXX_add_idempotency_keys.sql

CREATE TABLE idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  resource_type VARCHAR(50) NOT NULL,
  resource_id VARCHAR(255),
  response JSONB,
  status_code INTEGER,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idempotency_keys_expires_at_idx ON idempotency_keys(expires_at);

-- Cleanup job (run daily)
DELETE FROM idempotency_keys WHERE expires_at < NOW();
```

#### Service Implementation

```typescript
// server/services/idempotency.service.ts (جديد)

export class IdempotencyService {
  async check(key: string): Promise<IdempotencyResult | null> {
    const record = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key))
      .limit(1);

    if (record.length === 0) {
      return null;
    }

    const idempotency = record[0];

    // Check if expired
    if (new Date() > idempotency.expiresAt) {
      await this.delete(key);
      return null;
    }

    return {
      resourceType: idempotency.resourceType,
      resourceId: idempotency.resourceId,
      response: idempotency.response,
      statusCode: idempotency.statusCode,
    };
  }

  async store(
    key: string,
    resourceType: string,
    resourceId: string,
    response: any,
    statusCode: number
  ): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hours TTL

    await db.insert(idempotencyKeys).values({
      key,
      resourceType,
      resourceId,
      response,
      statusCode,
      expiresAt,
    });
  }

  async delete(key: string): Promise<void> {
    await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key));
  }
}
```

#### Router Integration

```typescript
// server/routers/bookings.ts

export const bookingsRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        idempotencyKey: z.string().min(1).max(255),
        // ... other fields
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { idempotencyKey, ...bookingData } = input;

      // Check idempotency
      const existing = await idempotencyService.check(idempotencyKey);
      if (existing) {
        // Return cached response
        return existing.response;
      }

      // Create booking
      const booking = await bookingsService.create(bookingData, ctx.user.id);

      // Store idempotency key
      await idempotencyService.store(
        idempotencyKey,
        'booking',
        booking.id,
        booking,
        200
      );

      return booking;
    }),
});
```

#### Client Integration

```typescript
// client/src/hooks/useBooking.ts

import { v4 as uuidv4 } from 'uuid';

export function useBooking() {
  const createBooking = async (data: BookingData) => {
    const idempotencyKey = uuidv4(); // Generate unique key

    return await api.bookings.create.mutate({
      idempotencyKey,
      ...data,
    });
  };

  return { createBooking };
}
```

#### المهام

- [ ] **Task 1.3.1:** إنشاء جدول `idempotency_keys` في schema
- [ ] **Task 1.3.2:** إنشاء migration
- [ ] **Task 1.3.3:** إنشاء `IdempotencyService`
- [ ] **Task 1.3.4:** تطبيق في `bookings.router.ts`
- [ ] **Task 1.3.5:** تطبيق في `useBooking` hook
- [ ] **Task 1.3.6:** إنشاء cleanup job للـ expired keys
- [ ] **Task 1.3.7:** كتابة integration tests

#### Acceptance Criteria

- [x] إعادة إرسال نفس الطلب يعيد نفس النتيجة
- [x] Keys تنتهي صلاحيتها بعد 24 ساعة
- [x] Cleanup job يعمل بشكل صحيح
- [x] Tests تغطي جميع السيناريوهات

---

### US-1.4: لفّ العمليات الحرجة بـ Transactions

#### الوصف
التأكد من أن جميع العمليات الحرجة atomic باستخدام database transactions.

#### العمليات الحرجة

1. **إنشاء حجز:**
   - إنشاء booking record
   - إنشاء passenger records
   - إنشاء payment record
   - تحديث seat availability

2. **إلغاء حجز:**
   - تحديث booking status
   - إنشاء refund record
   - تحديث seat availability

3. **تعديل حجز:**
   - تحديث booking details
   - إنشاء payment/refund (إذا لزم)
   - تحديث seat availability

#### Implementation Example

```typescript
// server/services/bookings.service.ts

export class BookingsService {
  async create(data: CreateBookingInput, userId: string): Promise<Booking> {
    // Start transaction
    return await db.transaction(async (tx) => {
      // 1. Check seat availability (with lock)
      const flight = await tx
        .select()
        .from(flights)
        .where(eq(flights.id, data.flightId))
        .for('update') // Row-level lock
        .limit(1);

      if (flight[0].availableSeats < data.passengers.length) {
        throw new SeatsUnavailableError();
      }

      // 2. Create booking
      const booking = await tx.insert(bookings).values({
        userId,
        flightId: data.flightId,
        status: BookingStatus.PENDING,
        totalAmount: data.totalAmount,
      }).returning();

      // 3. Create passengers
      await tx.insert(passengers).values(
        data.passengers.map(p => ({
          bookingId: booking[0].id,
          ...p,
        }))
      );

      // 4. Update seat availability
      await tx
        .update(flights)
        .set({
          availableSeats: sql`${flights.availableSeats} - ${data.passengers.length}`,
        })
        .where(eq(flights.id, data.flightId));

      // 5. Create payment record
      await tx.insert(payments).values({
        bookingId: booking[0].id,
        amount: data.totalAmount,
        status: 'pending',
      });

      return booking[0];
    });
  }

  async cancel(bookingId: string, reason: string): Promise<Booking> {
    return await db.transaction(async (tx) => {
      // 1. Get booking (with lock)
      const booking = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .for('update')
        .limit(1);

      if (!booking[0]) {
        throw new BookingNotFoundError();
      }

      // 2. Check if cancellable
      if (!this.canCancel(booking[0])) {
        throw new BookingNotCancellableError();
      }

      // 3. Update booking status
      const updated = await tx
        .update(bookings)
        .set({
          status: BookingStatus.CANCELLED,
          cancelledAt: new Date(),
          cancellationReason: reason,
        })
        .where(eq(bookings.id, bookingId))
        .returning();

      // 4. Release seats
      await tx
        .update(flights)
        .set({
          availableSeats: sql`${flights.availableSeats} + ${booking[0].passengerCount}`,
        })
        .where(eq(flights.id, booking[0].flightId));

      // 5. Create refund record (if applicable)
      if (this.isRefundable(booking[0])) {
        await tx.insert(refunds).values({
          bookingId: bookingId,
          amount: this.calculateRefundAmount(booking[0]),
          status: 'pending',
        });
      }

      return updated[0];
    });
  }
}
```

#### المهام

- [ ] **Task 1.4.1:** مراجعة `bookings.service.ts` - لف create في transaction
- [ ] **Task 1.4.2:** مراجعة `bookings.service.ts` - لف cancel في transaction
- [ ] **Task 1.4.3:** مراجعة `payments.service.ts` - لف payment processing في transaction
- [ ] **Task 1.4.4:** مراجعة `refunds.service.ts` - لف refund processing في transaction
- [ ] **Task 1.4.5:** مراجعة `booking-modification.service.ts` - لف modify في transaction
- [ ] **Task 1.4.6:** إضافة row-level locks حيث لزم
- [ ] **Task 1.4.7:** كتابة integration tests للـ race conditions

#### Acceptance Criteria

- [x] جميع العمليات الحرجة في transactions
- [x] لا race conditions
- [x] Rollback يعمل عند الفشل
- [x] Tests تغطي failure scenarios

---

### US-1.5: اختبارات Integration لمسارات Booking/Payment

#### الوصف
كتابة integration tests شاملة لضمان عمل المسارات الحرجة.

#### Test Scenarios

```typescript
// server/tests/integration/booking-flow.test.ts

describe('Booking Flow', () => {
  describe('Happy Path', () => {
    it('should create booking, process payment, and confirm', async () => {
      // 1. Search for flights
      const flights = await api.flights.search.query({
        from: 'RUH',
        to: 'JED',
        date: '2026-02-01',
      });

      expect(flights).toHaveLength(1);

      // 2. Create booking
      const booking = await api.bookings.create.mutate({
        idempotencyKey: uuidv4(),
        flightId: flights[0].id,
        passengers: [
          {
            firstName: 'Ahmed',
            lastName: 'Ali',
            passportNumber: 'A123456',
          },
        ],
      });

      expect(booking.status).toBe('pending');

      // 3. Process payment
      const payment = await api.payments.create.mutate({
        bookingId: booking.id,
        paymentMethodId: 'pm_test_123',
      });

      expect(payment.status).toBe('succeeded');

      // 4. Verify booking confirmed
      const confirmedBooking = await api.bookings.get.query({
        id: booking.id,
      });

      expect(confirmedBooking.status).toBe('confirmed');

      // 5. Verify seat availability updated
      const updatedFlight = await api.flights.get.query({
        id: flights[0].id,
      });

      expect(updatedFlight.availableSeats).toBe(
        flights[0].availableSeats - 1
      );
    });
  });

  describe('Double Booking Prevention', () => {
    it('should prevent double booking of same seat', async () => {
      const flight = await createTestFlight({ availableSeats: 1 });

      // First booking
      const booking1 = await api.bookings.create.mutate({
        idempotencyKey: uuidv4(),
        flightId: flight.id,
        passengers: [{ /* ... */ }],
      });

      // Second booking (should fail)
      await expect(
        api.bookings.create.mutate({
          idempotencyKey: uuidv4(),
          flightId: flight.id,
          passengers: [{ /* ... */ }],
        })
      ).rejects.toThrow('No seats available');
    });
  });

  describe('Payment Failure Handling', () => {
    it('should rollback booking on payment failure', async () => {
      const flight = await createTestFlight({ availableSeats: 10 });

      // Create booking
      const booking = await api.bookings.create.mutate({
        idempotencyKey: uuidv4(),
        flightId: flight.id,
        passengers: [{ /* ... */ }],
      });

      // Simulate payment failure
      await expect(
        api.payments.create.mutate({
          bookingId: booking.id,
          paymentMethodId: 'pm_test_fail',
        })
      ).rejects.toThrow('Payment failed');

      // Verify booking status
      const failedBooking = await api.bookings.get.query({
        id: booking.id,
      });

      expect(failedBooking.status).toBe('payment_failed');

      // Verify seats released
      const updatedFlight = await api.flights.get.query({
        id: flight.id,
      });

      expect(updatedFlight.availableSeats).toBe(10);
    });
  });

  describe('Cancellation and Refund', () => {
    it('should cancel booking and process refund', async () => {
      // Create and confirm booking
      const booking = await createConfirmedBooking();

      // Cancel booking
      const cancelled = await api.bookings.cancel.mutate({
        id: booking.id,
        reason: 'Customer request',
      });

      expect(cancelled.status).toBe('cancelled');

      // Verify refund created
      const refund = await api.refunds.get.query({
        bookingId: booking.id,
      });

      expect(refund.status).toBe('pending');

      // Process refund
      await processRefund(refund.id);

      // Verify refund completed
      const completedRefund = await api.refunds.get.query({
        bookingId: booking.id,
      });

      expect(completedRefund.status).toBe('refunded');
    });
  });

  describe('Idempotency', () => {
    it('should return same result for duplicate requests', async () => {
      const idempotencyKey = uuidv4();
      const flight = await createTestFlight();

      // First request
      const booking1 = await api.bookings.create.mutate({
        idempotencyKey,
        flightId: flight.id,
        passengers: [{ /* ... */ }],
      });

      // Duplicate request
      const booking2 = await api.bookings.create.mutate({
        idempotencyKey,
        flightId: flight.id,
        passengers: [{ /* ... */ }],
      });

      // Should return same booking
      expect(booking1.id).toBe(booking2.id);

      // Should not create duplicate
      const allBookings = await db.select().from(bookings);
      expect(allBookings).toHaveLength(1);
    });
  });
});
```

#### المهام

- [ ] **Task 1.5.1:** إعداد test environment
- [ ] **Task 1.5.2:** كتابة test: Happy path
- [ ] **Task 1.5.3:** كتابة test: Double booking prevention
- [ ] **Task 1.5.4:** كتابة test: Payment failure handling
- [ ] **Task 1.5.5:** كتابة test: Cancellation and refund
- [ ] **Task 1.5.6:** كتابة test: Idempotency
- [ ] **Task 1.5.7:** كتابة test helpers
- [ ] **Task 1.5.8:** إضافة tests إلى CI pipeline

#### Acceptance Criteria

- [x] جميع tests تمر
- [x] Test coverage > 90% للـ critical paths
- [x] Tests تعمل في CI
- [x] Tests سريعة (< 30 ثانية)

---

## ✅ Definition of Done

Sprint 1 يعتبر مكتمل عندما:

- [x] جميع User Stories مكتملة
- [x] جميع Tasks منجزة
- [x] جميع Tests تمر (unit + integration)
- [x] Code review مكتمل
- [x] Documentation محدّث
- [x] لا double booking يمكن أن يحدث
- [x] لا double charge يمكن أن يحدث
- [x] جميع state transitions صحيحة
- [x] Idempotency يعمل بشكل كامل
- [x] جميع العمليات الحرجة في transactions

---

## 📊 Progress Tracking

| User Story | Status | Progress | Assignee |
|-----------|--------|----------|----------|
| US-1.1 | 📝 To Do | 0% | - |
| US-1.2 | 📝 To Do | 0% | - |
| US-1.3 | 📝 To Do | 0% | - |
| US-1.4 | 📝 To Do | 0% | - |
| US-1.5 | 📝 To Do | 0% | - |

**Overall Progress:** 0% (0/47 story points)

---

## 🚀 الخطوات التالية

بعد إكمال Sprint 1:
1. Sprint retrospective
2. تحديث backlog
3. البدء في Sprint 2 (Stripe Webhooks & Financial Ledger)

---

**آخر تحديث:** 26 يناير 2026
