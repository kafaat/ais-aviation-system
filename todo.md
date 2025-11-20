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

### Phase 8: Email Ticket Delivery & Multi-Passenger
- [x] Send e-ticket PDF via email after payment confirmation
- [x] Create generateETicketForPassenger helper function
- [x] Generate e-tickets for all passengers in Stripe webhook
- [x] Update email.service.ts to support PDF attachments (interface)
- [x] Update My Bookings UI to show all passengers
- [x] Add download button for each passenger (icon-only buttons)
- [x] Create passenger list in booking card with passenger details
- [x] Test multi-passenger ticket download
- [x] All 45 tests passing successfully
- [ ] TODO: Integrate e-ticket attachments with email sending (future)

### Phase 9: Complete System Features
- [x] Complete email integration with PDF attachments
- [x] Update sendBookingConfirmation to accept attachments parameter
- [x] Send e-tickets as PDF attachments in confirmation email (single email with all tickets)
- [x] Refactor Stripe webhook to generate tickets before sending email
- [x] Implement dynamic pricing engine
- [x] Create dynamic-pricing.service.ts with occupancy and time-based pricing
- [x] Add occupancy-based multipliers (0%, 10%, 25%, 40%)
- [x] Add time-based multipliers (-5% early bird, +10%, +20%, +35%)
- [x] Update calculateFlightPrice to use dynamic pricing
- [x] Update all callers of calculateFlightPrice to handle async
- [x] Update tests for dynamic pricing
- [x] All 45 tests passing successfully
- [ ] Create admin analytics dashboard (future)
- [ ] Add KPIs (occupancy rate, daily revenue, cancellation rate) (future)
- [ ] Create charts for trends and statistics (future)

### Phase 10: Admin Analytics Dashboard
- [x] Create analytics service for KPI calculations
- [x] Calculate occupancy rate (overall and per flight)
- [x] Calculate daily/monthly revenue
- [x] Calculate cancellation rate
- [x] Get most popular destinations
- [x] Get booking trends over time
- [x] Create analytics router
- [x] Build Analytics Dashboard UI
- [x] Add KPI cards (occupancy, revenue, bookings, cancellations)
- [x] Add revenue chart (last 30 days)
- [x] Add popular destinations chart
- [x] Add booking trends chart
- [x] Test analytics calculations

### Phase 11: Multi-Language Support (i18n)
- [x] Install react-i18next and i18next packages
- [x] Create i18n configuration file
- [x] Create translation files (ar.json, en.json)
- [x] Translate all UI strings (Home, Search, Booking, etc.)
- [x] Add language switcher component in header
- [x] Persist language preference in localStorage
- [x] Test language switching across all pages
- [ ] Update email templates to support multiple languages

### Phase 12: Advanced Search Filters
- [x] Create AdvancedFilters component
- [x] Add price range filter (min/max slider)
- [x] Add airlines filter (multi-select)
- [x] Add stops filter (direct, 1 stop, 2+ stops)
- [x] Add time preference filter (morning, afternoon, evening, night)
- [x] Add cabin class filter
- [x] Integrate filters with SearchResults page
- [x] Add client-side filtering logic
- [x] Add sort options (price, duration, departure time)
- [x] Test all filter combinations

### Phase 13: User Profile & Preferences
- [x] Create user_preferences table in schema
- [x] Add seat preferences (window, aisle, middle)
- [x] Add cabin class preference
- [x] Add meal preferences (regular, vegetarian, vegan, halal, kosher, gluten-free)
- [x] Add special services (wheelchair, extra legroom)
- [x] Add saved passport information
- [x] Add emergency contact information
- [x] Add notification preferences (email, SMS)
- [x] Create user-preferences.service.ts
- [x] Create user-preferences router
- [x] Create User Profile page UI
- [x] Add profile route to App.tsx
- [x] Add profile link to navigation
- [x] Add translation keys for profile page
- [x] Write unit tests for user preferences service (10 tests)
- [x] All 50 tests passing successfully

### Phase 14: Loyalty Dashboard UI
- [x] Create LoyaltyDashboard page component
- [x] Add loyalty account overview card (tier, miles balance)
- [x] Create miles transactions history table
- [x] Add tier progress bar with benefits
- [x] Create miles redemption calculator
- [x] Add route to App.tsx
- [x] Add navigation link to loyalty dashboard
- [x] Add translation keys (ar/en)
- [x] Test loyalty dashboard UI
- [x] All 50 tests passing successfully

### Phase 15: Reviews & Ratings System
- [ ] Design reviews schema (flight_reviews table)
- [ ] Create reviews.service.ts
- [ ] Create reviews router
- [ ] Add review submission form
- [ ] Display reviews on flight details
- [ ] Add rating aggregation
- [ ] Write unit tests
- [ ] Update todo.md after completion

### Phase 16: Favorite Flights & Price Alerts
- [ ] Design favorites schema (favorite_flights table)
- [ ] Create favorites.service.ts
- [ ] Create favorites router
- [ ] Add favorite button to flight cards
- [ ] Create favorites page
- [ ] Implement price alert notifications
- [ ] Write unit tests
- [ ] Update todo.md after completion


## PSS Comprehensive Review & Completion

### 1. Real-time Inventory Management ✅
- [x] Inventory locks table (temporary seat holds)
- [x] Seat locking service with race condition prevention
- [x] Automatic expired locks cleanup
- [x] Integration with booking flow
- [ ] Real-time seat availability updates (WebSocket/SSE)
- [ ] Inventory sync across multiple booking channels
- [ ] Waitlist management for fully booked flights

### 2. Fare Classes & Ancillary Services
- [x] Design ancillary_services table (baggage, meals, seats, insurance, lounge, priority_boarding)
- [x] Design booking_ancillaries table (links services to bookings)
- [x] Create ancillary-services.service.ts with full CRUD operations
- [x] Create ancillary services catalog (13 services seeded)
- [x] Create ancillary router with APIs (getAvailable, addToBooking, etc.)
- [x] Create AncillarySelection UI component
- [x] Add translation keys (ar/en)
- [x] Write unit tests for ancillary services (10 tests)
- [x] All 60 tests passing successfully
- [x] Integrate AncillarySelection component into booking page
- [x] Update booking service to save selected ancillaries
- [x] Update payment calculation to include ancillaries total
- [x] Display ancillaries in booking summary
- [x] Write integration tests for booking with ancillaries (3 tests)
- [x] All 63 tests passing successfully
- [ ] Show ancillaries in My Bookings page
- [ ] Add ability to add/remove ancillaries after booking
- [ ] Design fare_classes table (economy, business, first with sub-classes)
- [ ] Implement fare rules engine (restrictions, change fees, cancellation fees)

### 3. Enhanced Self-Service Management ✅ (Partial)
- [x] View bookings
- [x] Modify booking (date change, cabin upgrade)
- [x] Cancel booking with refund
- [x] Download e-tickets
- [x] Download boarding passes
- [x] Check-in online
- [ ] Add baggage to existing booking
- [ ] Change seat after booking
- [ ] Add special services (meals, wheelchair)
- [ ] Split PNR (separate passengers)
- [ ] Group booking management

### 4. Payment Integration & Refund Policies ✅
- [x] Stripe payment integration
- [x] Payment webhooks
- [x] Refund processing
- [x] Tiered cancellation fees
- [x] Partial refunds
- [x] Payment history tracking
- [ ] Multiple payment methods (PayPal, Apple Pay)
- [ ] Split payments
- [ ] Payment installments (Tabby/Tamara)
- [ ] Voucher/credit system for refunds

### 5. Analytics & Diagnostics Dashboard ✅ (Partial)
- [x] KPIs (occupancy rate, revenue, bookings, cancellations)
- [x] Revenue trends chart (last 30 days)
- [x] Popular destinations chart
- [x] Booking trends over time
- [ ] Per-flight profitability analysis
- [ ] Peak booking times analysis
- [ ] Customer segmentation (frequent flyers, one-time, etc.)
- [ ] Revenue per available seat mile (RASM)
- [ ] Load factor by route
- [ ] Cancellation reasons analysis
- [ ] Export reports (PDF/Excel)

### 6. Check-in & Boarding ✅ (Partial)
- [x] Online check-in
- [x] Boarding pass generation
- [x] E-ticket generation
- [ ] Baggage tag printing
- [ ] Gate assignment
- [ ] Boarding sequence management
- [ ] Flight manifest for crew
- [ ] Weight & balance calculation

### 7. Additional PSS Features
- [ ] Multi-city/complex itineraries
- [ ] Code-share flight support
- [ ] Frequent flyer tier benefits (priority boarding, extra baggage)
- [ ] Group booking discounts
- [ ] Corporate travel accounts
- [ ] Travel agent portal
- [ ] API for third-party integration
- [ ] IATA compliance (NDC, ONE Order)
