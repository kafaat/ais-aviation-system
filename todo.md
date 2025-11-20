# AIS Web Application - TODO

## Core Features

### Database Schema
- [x] تصميم جداول قاعدة البيانات (Flights, Bookings, Passengers, Payments)
- [x] إضافة جدول Airlines
- [x] إضافة جدول Airports
- [x] تطبيق Database migrations

### Backend APIs (tRPC)
- [x] Flight Search API
- [x] Flight Details API
- [x] Booking Creation API
- [x] Payment Processing API
- [x] Booking Management API
- [x] Check-in API
- [x] Admin APIs (Flight Management, Statistics)

### Frontend - User Interface
- [x] صفحة البحث عن الرحلات
- [x] صفحة نتائج البحث
- [x] صفحة تفاصيل الرحلة
- [x] صفحة معلومات الركاب
- [x] صفحة الدفع
- [x] صفحة تأكيد الحجز
- [x] صفحة إدارة الحجوزات
- [x] صفحة تسجيل الوصول

### Admin Dashboard
- [x] لوحة التحكم الرئيسية
- [x] إدارة الرحلات (إضافة/تعديل/حذف)
- [x] إدارة شركات الطيران
- [x] إدارة المطارات
- [x] عرض الإحصائيات
- [x] إدارة الحجوزات

### Testing & Deployment
- [x] كتابة اختبارات Vitest للـ APIs
- [x] اختبار واجهة المستخدم
- [x] حفظ checkpoint
- [x] رفع المشروع إلى GitHub
- [x] كتابة الوثائق (README.md)

## UI/UX Enhancements

### Internationalization (i18n)
- [x] إضافة مكتبة i18next
- [x] إنشاء ملفات الترجمة (العربية والإنجليزية)
- [x] إضافة مبدل اللغة في الواجهة
- [x] تطبيق الترجمة على جميع الصفحات

### Visual Design Improvements
- [x] إضافة رسوم متحركة للانتقالات
- [x] تحسين نظام الألوان والتدرجات
- [x] إضافة تأثيرات hover وfocus محسّنة
- [x] تحسين Typography والخطوط

### Interactive Features
- [x] إضافة خريطة اختيار المقاعد التفاعلية
- [ ] إضافة معاينة تفصيلية للرحلة
- [ ] تحسين نماذج الإدخال بـ validation فوري
- [ ] إضافة loading states محسّنة

### Performance Optimization
- [x] تحسين lazy loading للصور
- [x] إضافة code splitting
- [x] تحسين bundle size
- [x] إضافة caching للبيانات

### PWA Features
- [x] إضافة Service Worker
- [x] إنشاء manifest.json
- [x] إضافة دعم offline
- [x] تحسين أيقونات التطبيق

## Stripe Payment Integration

- [x] إعداد Stripe وإضافة API Keys
- [x] بناء Payment Intent API
- [x] إنشاء واجهة الدفع بـ Stripe Elements
- [x] معالجة المدفوعات بشكل آمن
- [x] إضافة Stripe Webhooks
- [x] تحديث نظام الحجز للتكامل مع الدفع
- [x] اختبار المدفوعات

## Local Payment Gateway Integration (Tharwatt)

- [ ] فحص وتوثيق API البوابة المحلية
- [ ] إنشاء Payment Service للبوابة المحلية
- [ ] بناء Backend APIs للتكامل
- [ ] إنشاء واجهة الدفع
- [ ] معالجة Callbacks والإشعارات
- [ ] اختبار المدفوعات

## Advanced Enhancements

### UI/UX Improvements
- [x] تحسين صفحة البحث بفلاتر متقدمة
- [x] إضافة مقارنة الرحلات (Flight Comparison)
- [ ] تحسين عرض تفاصيل الرحلة
- [ ] إضافة Timeline للرحلة
- [ ] تحسين Mobile Responsiveness

### Advanced Features
- [ ] نظام التقييمات والمراجعات
- [ ] حفظ الرحلات المفضلة
- [ ] تنبيهات تغيير الأسعار
- [ ] اقتراحات رحلات ذكية

### Analytics Dashboard
- [ ] إحصائيات الحجوزات
- [ ] تحليل الإيرادات
- [ ] رسوم بيانية تفاعلية
- [ ] تقارير قابلة للتصدير

### Notifications System
- [ ] إشعارات داخل التطبيق
- [ ] تنبيهات البريد الإلكتروني
- [ ] إشعارات Push (PWA)
- [ ] تنبيهات SMS (اختياري)

## KPIs & Analytics Dashboard

### Backend APIs
- [x] إنشاء Analytics Router
- [x] API للإحصائيات العامة (Total Bookings, Revenue, etc.)
- [x] API للرسوم البيانية (Daily bookings, Revenue trends)
- [x] API لأكثر الوجهات شعبية
- [x] API لأداء شركات الطيران

### KPI Components
- [x] مكون Total Revenue
- [x] مكون Total Bookings
- [x] مكون Occupancy Rate
- [x] مكون Average Booking Value
- [x] مكون Conversion Rate

### Charts & Visualizations
- [x] رسم بياني للحجوزات اليومية (Line Chart)
- [x] رسم بياني لتوزيع الإيرادات (Bar Chart)
- [x] رسم بياني للوجهات الشعبية (Pie Chart)
- [x] رسم بياني لأداء الشركات (Bar Chart)

### Analytics Dashboard
- [x] تصميم لوحة التحكم الإحصائية
- [ ] إضافة فلاتر التاريخ
- [x] تكامل جميع KPIs والرسوم البيانية
- [ ] إضافة ميزة التصدير (PDF/Excel)

## Comprehensive System Improvements (Based on Deep Analysis)

### Phase 1: Critical Foundations
- [x] ENV Validation with Zod
- [x] Graceful Shutdown
- [x] Cookie Security (httpOnly, secure, sameSite)
- [x] Admin Route Guards
- [ ] Request ID + Unified Logging

### Phase 2: Code Architecture
- [x] Split routers by domain (flights, bookings, admin, analytics, payments, reference)
- [x] Create Services Layer (flights.service.ts, bookings.service.ts, payments.service.ts)
- [x] Refactor main routers.ts to use domain routers
- [x] Write unit tests for services and routers
- [x] Fix CheckIn.tsx to work with new API structure

### Phase 3: Security Enhancements
- [x] Rate Limiting on /api/trpc and /api/stripe/webhook
- [ ] Data API Whitelist
- [ ] Account Lock after failed login attempts

### Phase 4: Stripe & Database
- [x] Stripe Refunds Support
- [ ] Payment History Table
- [x] Database Indexes (airlineId, status, composite route+date+status)
- [ ] Soft Delete for bookings

### Phase 5: AI Features
- [ ] AI Logging (with PII masking)
- [ ] AI Guardrails (message length, content filtering)
- [ ] Chat History in DB (ai_sessions, ai_messages)
- [ ] Suggested Messages in AI Chat
- [ ] Stop Generation Button

### Phase 6: Performance & UX
- [ ] Caching for flight search results
- [ ] Loading Skeletons for pages
- [ ] Mobile Responsive SeatMap
- [ ] Mobile Responsive Map (zoom & pan)
- [ ] Seat Layout from Backend (based on aircraft type)
- [ ] Legend for SeatMap colors
- [ ] Accessibility (Keyboard navigation + ARIA labels)

### Phase 7: Testing
- [ ] Integration Tests for AI (systemRouter)
- [ ] E2E Tests with Playwright (search → select → book → pay)
- [ ] Transaction-based Seeding
- [ ] Idempotent Seed Script
- [ ] Default Admin User in Seed

### Phase 3: Security & Performance
- [x] Install express-rate-limit package
- [x] Add rate limiting middleware to /api/trpc
- [x] Add rate limiting to /api/stripe/webhook
- [x] Add database indexes (airlineId, status, composite route+date+status)
- [x] Implement Stripe refunds support
- [x] Create refunds service and router
- [x] Test rate limiting (4 tests passing)
- [x] Apply database migrations

### Bug Fixes: Database Duplicate Entries
- [x] Fix Stripe test to use unique booking references (6-char limit)
- [x] Add test data cleanup/isolation (afterAll hooks)
- [x] Update Stripe test to use payments router (after refactoring)
- [x] Fix error message expectations in tests
- [x] All 28 tests passing successfully

### Phase 4: User Experience Enhancements
- [x] Add booking cancellation UI to My Bookings page
- [x] Implement refund request dialog (CancelBookingDialog component)
- [x] Show refund eligibility status
- [x] Create admin refunds dashboard with statistics
- [x] Add refund statistics and charts (trends, history table)
- [x] Implement flight status update system
- [x] Add notifications for flight changes (owner notifications)
- [x] Create flight-status.service.ts with updateFlightStatus and cancelFlightAndRefund
- [x] Add admin endpoints for flight status management
- [x] Test all new features (3 new tests, all passing)
- [x] All 31 tests passing successfully

### Phase 5: Advanced Features
- [x] Implement email notification service (email.service.ts)
- [x] Send booking confirmation emails (after Stripe payment)
- [x] Send flight status change notifications (delay/cancellation)
- [x] Send refund confirmation emails
- [x] Add partial refund support with cancellation fees
- [x] Implement tiered cancellation fee structure (0%, 25%, 50%, 75%, 100%)
- [x] Create cancellation-fees.service.ts calculator
- [x] Update CancelBookingDialog to show fee breakdown
- [x] Create flight status timeline UI (FlightStatusTimeline component)
- [x] Add flight_status_history table to schema
- [x] Automatically record all status changes in history
- [x] Add flights.getStatusHistory endpoint
- [x] Test all new features (6 new tests for cancellation fees)
- [x] All 37 tests passing successfully

### Phase 6: Booking Modification & Advanced Features
- [x] Design booking modification schema (booking_modifications table)
- [x] Create booking-modification.service.ts
- [x] Implement change date functionality with price difference
- [x] Implement upgrade cabin class functionality
- [x] Add modification fee calculation (0%, 5%, 10%, 15% based on time)
- [x] Create ModifyBookingDialog component
- [x] Add modification history tracking
- [x] Create modifications router
- [x] Add modify button to My Bookings page
- [x] Integrate with Stripe for payment of price differences

### Phase 7: Multi-City Flights
- [ ] Design multi-city schema (booking_segments table)
- [ ] Update flight search to support multi-city
- [ ] Implement smart pricing for multi-city routes
- [ ] Create multi-city booking flow UI
- [ ] Add segment management in booking details
- [ ] Test multi-city booking flow

### Phase 8: Loyalty Program
- [x] Design loyalty schema (loyalty_accounts, miles_transactions tables)
- [x] Create loyalty.service.ts
- [x] Implement miles earning on bookings (1 mile per SAR)
- [x] Implement miles redemption for discounts
- [x] Add tier system (Bronze, Silver, Gold, Platinum)
- [x] Implement tier multipliers (1x, 1.25x, 1.5x, 2x)
- [x] Auto-award miles after successful payment (Stripe webhook)
- [x] Create loyalty router
- [x] Test loyalty program features (8 tests passing)
- [x] All 45 tests passing successfully
- [ ] Create loyalty dashboard UI (pending)

## Critical Gaps - المرحلة 1: الأساسيات الحرجة (Top 3 Priority)

### Inventory Management & Real-time Updates
- [x] Create inventory_locks table for temporary seat holds
- [x] Implement seat locking service (inventory-lock.service.ts)
- [x] Integrate inventory locking with booking flow
- [x] Add sessionId to booking creation
- [x] Support lock creation and verification
- [x] Automatic expired locks cleanup
- [x] Race condition prevention with active locks check

### E-Ticketing & Documentation
- [x] Generate IATA-standard ticket numbers (13 digits)
- [x] Create e-ticket PDF generation service (eticket.service.ts)
- [x] Design e-ticket PDF template with QR code
- [x] Generate boarding pass PDF
- [x] Add ticketNumber field to passengers table
- [x] Create eticket router with generateETicket and generateBoardingPass endpoints
- [x] Return PDF as base64 for download
- [ ] Add ticket validation system (future)
- [ ] Create ticket/boarding pass email delivery (future)

### Dynamic Pricing & Fare Management
- [ ] Design fare_rules table (restrictions, penalties, etc)
- [ ] Create dynamic pricing engine
- [ ] Implement demand-based pricing algorithm
- [ ] Add seasonal pricing support
- [ ] Create fare class management system
- [ ] Implement revenue management (yield management)

### Multi-Language & Multi-Currency
- [ ] Add i18n support (react-i18next)
- [ ] Create translation files (AR, EN)
- [ ] Implement language switcher in UI
- [ ] Add multi-currency support in schema
- [ ] Integrate currency conversion API
- [ ] Update all prices to support multiple currencies
- [ ] Add timezone handling for international flights

### Analytics Dashboard
- [ ] Create comprehensive admin analytics dashboard
- [ ] Add revenue reports with charts
- [ ] Implement load factor analysis
- [ ] Add customer behavior analytics
- [ ] Create export to Excel/PDF functionality
- [ ] Add predictive analytics (ML-based forecasting)

## Important Gaps - المرحلة 2: ميزات مهمة

### Passenger Services (PSS)
- [ ] Add special services requests (meals, wheelchair, etc)
- [ ] Create special_services table
- [ ] Implement group bookings system
- [ ] Add frequent flyer integration with PSS
- [ ] Create passenger profile management

### Departure Control System (DCS)
- [ ] Implement baggage handling system
- [ ] Create baggage tracking table
- [ ] Add weight & balance calculation
- [ ] Implement gate assignment system
- [ ] Add flight delays management dashboard
- [ ] Create load planning system

### Payment Enhancements
- [ ] Add PayPal integration
- [ ] Add Apple Pay / Google Pay support
- [ ] Implement split payments
- [ ] Add payment installments (Tabby/Tamara)
- [ ] Create PCI compliance documentation

### Distribution Channels
- [ ] Research GDS integration requirements (Amadeus/Sabre)
- [ ] Create API for travel agents
- [ ] Add channel management system
- [ ] Implement OTA integration (future consideration)

### Phase 7: E-Ticket UI & Multi-Language
- [x] Add download e-ticket button in My Bookings page
- [x] Add download boarding pass button in My Bookings page (only for confirmed bookings)
- [x] Create utility function to convert base64 PDF to download (downloadPDF.ts)
- [x] Create DownloadTicketButtons component
- [x] Add passengers data to myBookings API
- [x] Test e-ticket download functionality
- [ ] Install react-i18next for multi-language support (future)
- [ ] Create translation files (ar.json, en.json) (future)
- [ ] Add language switcher in header (future)
- [ ] Translate all UI strings (future)
