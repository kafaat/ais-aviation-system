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
- [ ] Split routers by domain (flights, bookings, admin, ai)
- [ ] Create Services Layer (flights.service.ts, bookings.service.ts, payments.service.ts)
- [ ] Separate Auth Module

### Phase 3: Security Enhancements
- [ ] Rate Limiting on /api/trpc and /api/stripe/webhook
- [ ] Data API Whitelist
- [ ] Account Lock after failed login attempts

### Phase 4: Stripe & Database
- [ ] Stripe Refunds Support
- [ ] Payment History Table
- [ ] Database Indexes (fromAirport, toAirport, departureDate, airlineId)
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
