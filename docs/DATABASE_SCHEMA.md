# توثيق قاعدة البيانات - Database Schema Documentation

## 📊 نظرة عامة

نظام الطيران المتكامل يستخدم **MySQL/TiDB** كقاعدة بيانات رئيسية مع **Drizzle ORM** للتفاعل مع البيانات.

---

## 📋 جدول المحتويات

1. [نظرة عامة على البنية](#نظرة-عامة-على-البنية)
2. [الجداول الرئيسية](#الجداول-الرئيسية)
3. [العلاقات بين الجداول](#العلاقات-بين-الجداول)
4. [الفهارس والأداء](#الفهارس-والأداء)
5. [أنواع البيانات](#أنواع-البيانات)
6. [قيود وتحققات](#قيود-وتحققات)
7. [أمثلة الاستعلامات](#أمثلة-الاستعلامات)

---

## 🏗️ نظرة عامة على البنية

### مخطط ERD (Entity Relationship Diagram)

```
┌──────────┐       ┌────────────┐       ┌──────────┐
│  Users   │──────<│  Bookings  │>──────│ Flights  │
└──────────┘       └────────────┘       └──────────┘
                          │                    │
                          │                    │
                          ▼                    ▼
                   ┌────────────┐       ┌──────────┐
                   │ Passengers │       │ Airlines │
                   └────────────┘       └──────────┘
                          │                    │
                          │                    ▼
                          │              ┌──────────┐
                          │              │ Airports │
                          │              └──────────┘
                          ▼
                   ┌──────────┐
                   │ Payments │
                   └──────────┘
```

### إحصائيات قاعدة البيانات

- **عدد الجداول الرئيسية**: 16
- **عدد الجداول الإضافية**: 8+
- **عدد الفهارس**: 40+
- **التخزين المتوقع**: 1-10 GB (حسب حجم البيانات)

---

## 📊 الجداول الرئيسية

### 1. Users (المستخدمون)

**الوصف**: يخزن معلومات المستخدمين وحساباتهم.

| العمود | النوع | القيود | الوصف |
|--------|------|--------|-------|
| id | INT | PRIMARY KEY, AUTO_INCREMENT | المعرف الفريد |
| openId | VARCHAR(255) | UNIQUE, NOT NULL | معرف OAuth من Manus |
| name | VARCHAR(255) | NULL | اسم المستخدم |
| email | VARCHAR(255) | NULL | البريد الإلكتروني |
| loginMethod | VARCHAR(50) | NULL | طريقة تسجيل الدخول |
| role | ENUM('user', 'admin') | DEFAULT 'user' | دور المستخدم |
| lastSignedIn | TIMESTAMP | NOT NULL | آخر تسجيل دخول |
| createdAt | TIMESTAMP | DEFAULT NOW() | تاريخ الإنشاء |
| updatedAt | TIMESTAMP | ON UPDATE NOW() | تاريخ آخر تحديث |

**الفهارس**:
- PRIMARY KEY: `id`
- UNIQUE INDEX: `openId`
- INDEX: `email`

**العلاقات**:
- ONE-TO-MANY: `bookings` (المستخدم يمكن أن يكون له عدة حجوزات)
- ONE-TO-MANY: `loyalty_accounts` (حساب ولاء واحد)

---

### 2. Airlines (شركات الطيران)

**الوصف**: معلومات شركات الطيران.

| العمود | النوع | القيود | الوصف |
|--------|------|--------|-------|
| id | INT | PRIMARY KEY, AUTO_INCREMENT | المعرف الفريد |
| name | VARCHAR(100) | NOT NULL | اسم شركة الطيران |
| code | VARCHAR(3) | UNIQUE, NOT NULL | رمز IATA (مثل: SV, EY) |
| country | VARCHAR(50) | NULL | البلد |
| logo | TEXT | NULL | رابط شعار الشركة |
| createdAt | TIMESTAMP | DEFAULT NOW() | تاريخ الإنشاء |

**الفهارس**:
- PRIMARY KEY: `id`
- UNIQUE INDEX: `code`

**العلاقات**:
- ONE-TO-MANY: `flights` (شركة طيران لديها عدة رحلات)

---

### 3. Airports (المطارات)

**الوصف**: معلومات المطارات.

| العمود | النوع | القيود | الوصف |
|--------|------|--------|-------|
| id | INT | PRIMARY KEY, AUTO_INCREMENT | المعرف الفريد |
| name | VARCHAR(255) | NOT NULL | اسم المطار |
| code | VARCHAR(3) | UNIQUE, NOT NULL | رمز IATA (مثل: JED, RUH) |
| city | VARCHAR(100) | NOT NULL | المدينة |
| country | VARCHAR(50) | NOT NULL | البلد |
| timezone | VARCHAR(50) | NULL | المنطقة الزمنية |
| createdAt | TIMESTAMP | DEFAULT NOW() | تاريخ الإنشاء |

**الفهارس**:
- PRIMARY KEY: `id`
- UNIQUE INDEX: `code`
- INDEX: `city`
- INDEX: `country`

**العلاقات**:
- ONE-TO-MANY: `flights` (المطار نقطة انطلاق أو وصول)

---

### 4. Flights (الرحلات)

**الوصف**: معلومات الرحلات الجوية.

| العمود | النوع | القيود | الوصف |
|--------|------|--------|-------|
| id | INT | PRIMARY KEY, AUTO_INCREMENT | المعرف الفريد |
| flightNumber | VARCHAR(10) | NOT NULL | رقم الرحلة (مثل: SV123) |
| airlineId | INT | NOT NULL, FK | معرف شركة الطيران |
| originId | INT | NOT NULL, FK | معرف مطار الانطلاق |
| destinationId | INT | NOT NULL, FK | معرف مطار الوصول |
| departureTime | TIMESTAMP | NOT NULL | وقت المغادرة |
| arrivalTime | TIMESTAMP | NOT NULL | وقت الوصول |
| aircraftType | VARCHAR(50) | NULL | نوع الطائرة |
| status | ENUM | DEFAULT 'scheduled' | حالة الرحلة |
| economySeats | INT | NOT NULL | عدد مقاعد الاقتصادية |
| businessSeats | INT | NOT NULL | عدد مقاعد رجال الأعمال |
| economyPrice | INT | NOT NULL | سعر الاقتصادية (بالقروش) |
| businessPrice | INT | NOT NULL | سعر رجال الأعمال (بالقروش) |
| economyAvailable | INT | NOT NULL | المقاعد المتاحة اقتصادية |
| businessAvailable | INT | NOT NULL | المقاعد المتاحة أعمال |
| createdAt | TIMESTAMP | DEFAULT NOW() | تاريخ الإنشاء |
| updatedAt | TIMESTAMP | ON UPDATE NOW() | تاريخ التحديث |

**قيم ENUM للحالة**:
- `scheduled`: مجدولة
- `delayed`: متأخرة
- `cancelled`: ملغاة
- `completed`: مكتملة

**الفهارس**:
- PRIMARY KEY: `id`
- INDEX: `flight_number_idx` على `flightNumber`
- INDEX: `departure_time_idx` على `departureTime`
- INDEX: `route_idx` على `(originId, destinationId)`
- INDEX: `airline_idx` على `airlineId`
- INDEX: `status_idx` على `status`
- COMPOSITE INDEX: `route_date_status_idx` على `(originId, destinationId, departureTime, status)`

**العلاقات**:
- MANY-TO-ONE: `airlines` (رحلة تنتمي لشركة طيران واحدة)
- MANY-TO-ONE: `airports` (مطار انطلاق ووصول)
- ONE-TO-MANY: `bookings` (رحلة يمكن أن يكون لها عدة حجوزات)

---

### 5. Bookings (الحجوزات)

**الوصف**: معلومات الحجوزات.

| العمود | النوع | القيود | الوصف |
|--------|------|--------|-------|
| id | INT | PRIMARY KEY, AUTO_INCREMENT | المعرف الفريد |
| userId | INT | NOT NULL, FK | معرف المستخدم |
| flightId | INT | NOT NULL, FK | معرف الرحلة |
| bookingReference | VARCHAR(6) | UNIQUE, NOT NULL | رقم الحجز (ABC123) |
| pnr | VARCHAR(6) | UNIQUE, NOT NULL | رقم PNR |
| status | ENUM | DEFAULT 'pending' | حالة الحجز |
| totalAmount | INT | NOT NULL | المبلغ الإجمالي (بالقروش) |
| paymentStatus | ENUM | DEFAULT 'pending' | حالة الدفع |
| stripePaymentIntentId | VARCHAR(255) | NULL | معرف Stripe Payment Intent |
| stripeCheckoutSessionId | VARCHAR(255) | NULL | معرف Stripe Checkout Session |
| cabinClass | ENUM('economy', 'business') | NOT NULL | الدرجة |
| numberOfPassengers | INT | NOT NULL | عدد الركاب |
| checkedIn | BOOLEAN | DEFAULT FALSE | هل تم تسجيل الوصول |
| createdAt | TIMESTAMP | DEFAULT NOW() | تاريخ الإنشاء |
| updatedAt | TIMESTAMP | ON UPDATE NOW() | تاريخ التحديث |

**قيم ENUM للحالة**:
- `pending`: قيد الانتظار
- `confirmed`: مؤكد
- `cancelled`: ملغى
- `completed`: مكتمل

**قيم ENUM لحالة الدفع**:
- `pending`: قيد الانتظار
- `paid`: مدفوع
- `refunded`: مسترد
- `failed`: فشل

**الفهارس**:
- PRIMARY KEY: `id`
- UNIQUE INDEX: `bookingReference`
- UNIQUE INDEX: `pnr`
- INDEX: `user_id_idx` على `userId`
- INDEX: `flight_id_idx` على `flightId`

**العلاقات**:
- MANY-TO-ONE: `users` (حجز ينتمي لمستخدم واحد)
- MANY-TO-ONE: `flights` (حجز ينتمي لرحلة واحدة)
- ONE-TO-MANY: `passengers` (حجز يمكن أن يكون له عدة ركاب)
- ONE-TO-MANY: `payments` (حجز يمكن أن يكون له عدة دفعات)

---

### 6. Passengers (الركاب)

**الوصف**: معلومات الركاب في الحجوزات.

| العمود | النوع | القيود | الوصف |
|--------|------|--------|-------|
| id | INT | PRIMARY KEY, AUTO_INCREMENT | المعرف الفريد |
| bookingId | INT | NOT NULL, FK | معرف الحجز |
| type | ENUM('adult', 'child', 'infant') | DEFAULT 'adult' | نوع الراكب |
| title | VARCHAR(10) | NULL | اللقب (Mr, Mrs, Dr) |
| firstName | VARCHAR(100) | NOT NULL | الاسم الأول |
| lastName | VARCHAR(100) | NOT NULL | اسم العائلة |
| dateOfBirth | TIMESTAMP | NULL | تاريخ الميلاد |
| passportNumber | VARCHAR(20) | NULL | رقم جواز السفر |
| nationality | VARCHAR(3) | NULL | الجنسية (ISO code) |
| seatNumber | VARCHAR(5) | NULL | رقم المقعد (12A) |
| ticketNumber | VARCHAR(13) | NULL | رقم التذكرة IATA |
| createdAt | TIMESTAMP | DEFAULT NOW() | تاريخ الإنشاء |

**الفهارس**:
- PRIMARY KEY: `id`
- INDEX: `booking_id_idx` على `bookingId`

**العلاقات**:
- MANY-TO-ONE: `bookings` (راكب ينتمي لحجز واحد)

---

### 7. Payments (المدفوعات)

**الوصف**: معلومات المدفوعات والمعاملات المالية.

| العمود | النوع | القيود | الوصف |
|--------|------|--------|-------|
| id | INT | PRIMARY KEY, AUTO_INCREMENT | المعرف الفريد |
| bookingId | INT | NOT NULL, FK | معرف الحجز |
| amount | INT | NOT NULL | المبلغ (بالقروش) |
| currency | VARCHAR(3) | DEFAULT 'SAR' | العملة |
| method | ENUM | NOT NULL | طريقة الدفع |
| status | ENUM | DEFAULT 'pending' | حالة الدفع |
| transactionId | VARCHAR(100) | NULL | معرف المعاملة الخارجية |
| idempotencyKey | VARCHAR(100) | UNIQUE | مفتاح منع التكرار |
| createdAt | TIMESTAMP | DEFAULT NOW() | تاريخ الإنشاء |
| updatedAt | TIMESTAMP | ON UPDATE NOW() | تاريخ التحديث |

**قيم ENUM لطريقة الدفع**:
- `card`: بطاقة ائتمان/خصم
- `wallet`: محفظة إلكترونية
- `bank_transfer`: تحويل بنكي

**الفهارس**:
- PRIMARY KEY: `id`
- UNIQUE INDEX: `idempotency_key_idx` على `idempotencyKey`
- INDEX: `booking_id_idx` على `bookingId`

---

## 📊 الجداول الإضافية (Advanced Features)

### 8. Loyalty Accounts (حسابات الولاء)

| العمود | النوع | الوصف |
|--------|------|-------|
| id | INT | المعرف الفريد |
| userId | INT | معرف المستخدم |
| currentMiles | INT | الأميال الحالية |
| totalMilesEarned | INT | إجمالي الأميال المكتسبة |
| tier | ENUM | الدرجة (bronze, silver, gold, platinum) |
| tierExpiresAt | TIMESTAMP | تاريخ انتهاء الدرجة |

### 9. Ancillary Services (الخدمات الإضافية)

| العمود | النوع | الوصف |
|--------|------|-------|
| id | INT | المعرف الفريد |
| name | VARCHAR | اسم الخدمة |
| category | ENUM | الفئة (baggage, meal, seat, etc) |
| price | INT | السعر |
| description | TEXT | الوصف |

### 10. Booking Ancillaries (خدمات الحجز الإضافية)

| العمود | النوع | الوصف |
|--------|------|-------|
| id | INT | المعرف الفريد |
| bookingId | INT | معرف الحجز |
| ancillaryServiceId | INT | معرف الخدمة |
| quantity | INT | الكمية |
| totalPrice | INT | السعر الإجمالي |

### 11. Refunds (الاستردادات)

| العمود | النوع | الوصف |
|--------|------|-------|
| id | INT | المعرف الفريد |
| bookingId | INT | معرف الحجز |
| amount | INT | المبلغ المسترد |
| cancellationFee | INT | رسوم الإلغاء |
| status | ENUM | الحالة |
| reason | TEXT | السبب |

### 12. Inventory Locks (قفل المخزون)

| العمود | النوع | الوصف |
|--------|------|-------|
| id | INT | المعرف الفريد |
| flightId | INT | معرف الرحلة |
| sessionId | VARCHAR | معرف الجلسة |
| seatsLocked | INT | عدد المقاعد المقفلة |
| expiresAt | TIMESTAMP | وقت انتهاء القفل |

### 13. User Preferences (تفضيلات المستخدم)

| العمود | النوع | الوصف |
|--------|------|-------|
| id | INT | المعرف الفريد |
| userId | INT | معرف المستخدم |
| preferredCabinClass | ENUM | الدرجة المفضلة |
| preferredSeatType | VARCHAR | نوع المقعد المفضل |
| mealPreferences | JSON | تفضيلات الوجبات |
| savedPassengers | JSON | ركاب محفوظون |

### 14. Flight Status History (سجل حالة الرحلات)

| العمود | النوع | الوصف |
|--------|------|-------|
| id | INT | المعرف الفريد |
| flightId | INT | معرف الرحلة |
| oldStatus | ENUM | الحالة القديمة |
| newStatus | ENUM | الحالة الجديدة |
| delayMinutes | INT | دقائق التأخير |
| reason | TEXT | السبب |
| changedBy | INT | من قام بالتغيير |

### 15. Booking Modifications (تعديلات الحجز)

| العمود | النوع | الوصف |
|--------|------|-------|
| id | INT | المعرف الفريد |
| bookingId | INT | معرف الحجز |
| modificationType | ENUM | نوع التعديل |
| originalFlightId | INT | الرحلة الأصلية |
| newFlightId | INT | الرحلة الجديدة |
| modificationFee | INT | رسوم التعديل |
| priceDifference | INT | فرق السعر |
| status | ENUM | الحالة |

### 16. Reviews (المراجعات)

| العمود | النوع | الوصف |
|--------|------|-------|
| id | INT | المعرف الفريد |
| userId | INT | معرف المستخدم |
| flightId | INT | معرف الرحلة |
| rating | INT | التقييم (1-5) |
| comment | TEXT | التعليق |
| createdAt | TIMESTAMP | تاريخ الإنشاء |

---

## 🔗 العلاقات بين الجداول

### علاقات ONE-TO-MANY

```
Users (1) ──────> (*) Bookings
Users (1) ──────> (1) LoyaltyAccounts
Airlines (1) ────> (*) Flights
Airports (1) ────> (*) Flights (as origin)
Airports (1) ────> (*) Flights (as destination)
Flights (1) ─────> (*) Bookings
Bookings (1) ────> (*) Passengers
Bookings (1) ────> (*) Payments
Bookings (1) ────> (*) BookingAncillaries
Bookings (1) ────> (*) Refunds
```

### علاقات MANY-TO-MANY

```
Bookings (*) ────> (*) AncillaryServices
  (عبر BookingAncillaries)
```

---

## ⚡ الفهارس والأداء

### الفهارس الأساسية

1. **Primary Keys**: على جميع الجداول
2. **Unique Indexes**: على الحقول الفريدة مثل:
   - `users.openId`
   - `airlines.code`
   - `airports.code`
   - `bookings.bookingReference`
   - `bookings.pnr`

### الفهارس المركبة (Composite Indexes)

```sql
-- للبحث عن الرحلات (الأكثر استخداماً)
INDEX route_date_status_idx ON flights (
  originId, 
  destinationId, 
  departureTime, 
  status
);

-- لاستعلامات الحجوزات
INDEX user_booking_status_idx ON bookings (
  userId,
  status,
  createdAt
);
```

### نصائح للأداء

1. ✅ **استخدم الفهارس** للأعمدة المستخدمة في WHERE و JOIN
2. ✅ **تجنب SELECT *** - حدد الأعمدة المطلوبة فقط
3. ✅ **استخدم LIMIT** في الاستعلامات الكبيرة
4. ✅ **استخدم Batch Operations** لإدراج البيانات الكثيرة
5. ✅ **راقب الاستعلامات البطيئة** (Slow Query Log)

---

## 🔢 أنواع البيانات

### الأسعار والمبالغ

**نستخدم INT لتخزين الأسعار بالقروش** (cents):
- ✅ دقيق (لا توجد مشاكل الفاصلة العشرية)
- ✅ سريع (عمليات على الأعداد الصحيحة)
- ✅ آمن (لا فقدان للدقة)

**مثال**:
```typescript
// السعر: 500 SAR
const priceInCents = 50000; // يُخزن في قاعدة البيانات
const priceInSAR = priceInCents / 100; // 500 SAR للعرض
```

### التواريخ والأوقات

- **TIMESTAMP**: للتواريخ والأوقات
- **Timezone Aware**: يُنصح بتخزين UTC والتحويل عند العرض

### النصوص

- **VARCHAR**: للنصوص القصيرة المحددة الطول
- **TEXT**: للنصوص الطويلة
- **JSON**: للبيانات المنظمة المرنة

---

## 🛡️ قيود وتحققات

### القيود المطبقة

1. **NOT NULL**: على الحقول الإلزامية
2. **UNIQUE**: على الحقول الفريدة
3. **FOREIGN KEY**: للعلاقات (عبر Drizzle ORM)
4. **DEFAULT VALUES**: للقيم الافتراضية
5. **CHECK Constraints**: (عبر Application Logic)

### مثال على التحققات في التطبيق

```typescript
// في bookings.service.ts
if (availableSeats < requestedSeats) {
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: 'Not enough available seats'
  });
}

if (departureTime < new Date()) {
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: 'Cannot book flight in the past'
  });
}
```

---

## 📝 أمثلة الاستعلامات

### البحث عن رحلات

```typescript
// باستخدام Drizzle ORM
const flights = await db
  .select()
  .from(flights)
  .where(
    and(
      eq(flights.originId, originId),
      eq(flights.destinationId, destinationId),
      gte(flights.departureTime, startDate),
      lte(flights.departureTime, endDate),
      eq(flights.status, 'scheduled'),
      gt(flights.economyAvailable, 0)
    )
  )
  .orderBy(asc(flights.departureTime))
  .limit(50);
```

### إنشاء حجز (Transaction)

```typescript
await db.transaction(async (tx) => {
  // إنشاء الحجز
  const [booking] = await tx
    .insert(bookings)
    .values({
      userId,
      flightId,
      bookingReference: generateReference(),
      pnr: generatePNR(),
      totalAmount,
      cabinClass,
      numberOfPassengers
    });

  // إضافة الركاب
  await tx.insert(passengers).values(passengersData);

  // تحديث المقاعد المتاحة
  await tx
    .update(flights)
    .set({
      economyAvailable: sql`${flights.economyAvailable} - ${numberOfPassengers}`
    })
    .where(eq(flights.id, flightId));
});
```

### استعلام مع JOIN

```typescript
const bookingDetails = await db
  .select({
    booking: bookings,
    flight: flights,
    airline: airlines,
    origin: airports,
    destination: airports,
    passengers: passengers
  })
  .from(bookings)
  .leftJoin(flights, eq(bookings.flightId, flights.id))
  .leftJoin(airlines, eq(flights.airlineId, airlines.id))
  .leftJoin(airports, eq(flights.originId, airports.id))
  .leftJoin(airports, eq(flights.destinationId, airports.id))
  .leftJoin(passengers, eq(bookings.id, passengers.bookingId))
  .where(eq(bookings.id, bookingId));
```

---

## 🔧 الصيانة

### النسخ الاحتياطي

```bash
# نسخ احتياطي يومي
mysqldump -u username -p ais_aviation > backup_$(date +%Y%m%d).sql

# استعادة
mysql -u username -p ais_aviation < backup_20260113.sql
```

### التحسين

```sql
-- تحليل الجداول
ANALYZE TABLE flights, bookings, passengers;

-- تحسين الجداول
OPTIMIZE TABLE flights, bookings;

-- عرض حجم الجداول
SELECT 
  table_name,
  ROUND(((data_length + index_length) / 1024 / 1024), 2) AS "Size (MB)"
FROM information_schema.TABLES
WHERE table_schema = "ais_aviation"
ORDER BY (data_length + index_length) DESC;
```

---

## 📚 موارد إضافية

- [Drizzle ORM Documentation](https://orm.drizzle.team)
- [MySQL Documentation](https://dev.mysql.com/doc/)
- [TiDB Documentation](https://docs.pingcap.com/tidb/stable)

---

**للمزيد من التفاصيل، راجع**:
- [دليل المطور](DEVELOPER_GUIDE.md)
- [البنية المعمارية](ARCHITECTURE.md)
- [دليل الأداء](PERFORMANCE.md)
