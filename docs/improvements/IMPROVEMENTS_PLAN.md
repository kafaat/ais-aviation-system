# خطة التحسينات والميزات الجديدة لنظام AIS

**تاريخ الإعداد:** 23 نوفمبر 2025  
**الهدف:** تطوير تحسينات حرجة ومهمة لرفع جاهزية النظام من 75% إلى 95%

---

## التحسينات المخططة

### 1. Multi-Currency Support (دعم العملات المتعددة) 🔴

#### الملفات المطلوبة:

1. `drizzle/schema-currency.ts` - جدول exchange_rates
2. `server/services/currency.service.ts` - خدمة تحويل العملات
3. `server/routers/currency.ts` - API للعملات
4. `client/src/contexts/CurrencyContext.tsx` - Context للعملة المختارة
5. `client/src/components/CurrencySelector.tsx` - مكون اختيار العملة

#### الوظائف:

- جدول `exchange_rates` مع معدلات تحويل محدثة
- API لجلب معدلات التحويل من مصدر خارجي
- تحويل الأسعار تلقائياً حسب العملة المختارة
- عرض الأسعار بالعملة المفضلة للمستخدم
- دعم العملات: SAR, USD, EUR, GBP, AED

---

### 2. Enhanced Analytics Dashboard (لوحة تحليلات متقدمة) 🟡

#### الملفات المطلوبة:

1. `server/services/analytics-advanced.service.ts` - خدمة التحليلات المتقدمة
2. `server/routers/analytics-advanced.ts` - API للتحليلات
3. `client/src/pages/admin/AdvancedAnalytics.tsx` - صفحة التحليلات
4. `client/src/components/analytics/RevenueChart.tsx` - رسم بياني للإيرادات
5. `client/src/components/analytics/LoadFactorChart.tsx` - معامل التحميل
6. `client/src/components/analytics/ExportReports.tsx` - تصدير التقارير

#### الوظائف:

- رسوم بيانية تفاعلية متقدمة (Recharts)
- تحليل معامل التحميل (Load Factor)
- تقارير الإيرادات المفصلة
- تحليل سلوك العملاء
- تصدير التقارير (PDF/Excel)
- فلاتر متقدمة (تاريخ، شركة طيران، مسار)

---

### 3. Request ID & Unified Logging (تسجيل موحد) 🔴

#### الملفات المطلوبة:

1. `server/_core/request-id.middleware.ts` - Middleware لـ Request ID
2. `server/_core/unified-logger.ts` - Logger موحد مع PII masking
3. `server/_core/log-formatter.ts` - تنسيق السجلات

#### الوظائف:

- Request ID فريد لكل طلب
- Unified Logging مع Pino
- PII Masking (إخفاء البيانات الحساسة)
- Structured Logging (JSON format)
- Log Levels (debug, info, warn, error)
- Log Rotation

---

### 4. Caching Layer with Redis (طبقة تخزين مؤقت) 🟡

#### الملفات المطلوبة:

1. `server/services/cache.service.ts` - خدمة الـ Caching
2. `server/_core/redis.ts` - Redis client
3. `docker-compose.redis.yml` - Redis container

#### الوظائف:

- Cache لنتائج البحث عن الرحلات
- Cache لبيانات المطارات والشركات
- Cache للإحصائيات
- TTL (Time To Live) قابل للتخصيص
- Cache Invalidation عند التحديث

---

### 5. Dynamic Pricing Engine (محرك التسعير الديناميكي) 🟡

#### الملفات المطلوبة:

1. `server/services/dynamic-pricing.service.ts` - خدمة التسعير الديناميكي
2. `drizzle/schema-pricing.ts` - جدول pricing_rules
3. `server/routers/pricing.ts` - API للتسعير

#### الوظائف:

- تسعير ديناميكي حسب العرض والطلب
- تسعير موسمي (مواسم الحج، الأعياد)
- خصومات الحجز المبكر
- زيادة الأسعار عند اقتراب موعد الرحلة
- قواعد تسعير قابلة للتخصيص

---

### 6. Enhanced Security Features (ميزات أمان متقدمة) 🔴

#### الملفات المطلوبة:

1. `server/_core/account-lock.service.ts` - قفل الحساب
2. `server/_core/data-api-whitelist.ts` - Whitelist للـ Data API
3. `drizzle/schema-security.ts` - جدول login_attempts

#### الوظائف:

- Account Lock بعد 5 محاولات فاشلة
- Data API Whitelist
- تسجيل محاولات تسجيل الدخول
- تنبيهات أمنية
- IP Blocking للمحاولات المشبوهة

---

### 7. Notification System (نظام الإشعارات) 🟡

#### الملفات المطلوبة:

1. `server/services/notification.service.ts` - خدمة الإشعارات
2. `drizzle/schema-notifications.ts` - جدول notifications
3. `client/src/components/NotificationCenter.tsx` - مركز الإشعارات

#### الوظائف:

- إشعارات داخل التطبيق
- إشعارات البريد الإلكتروني (موجودة جزئياً)
- إشعارات Push (PWA)
- تنبيهات تغيير حالة الرحلة
- تنبيهات تغيير الأسعار
- إشعارات برنامج الولاء

---

### 8. Advanced Search & Filters (بحث متقدم) 🟢

#### الملفات المطلوبة:

1. `server/services/search-advanced.service.ts` - خدمة البحث المتقدم
2. `client/src/components/AdvancedSearchFilters.tsx` - فلاتر متقدمة

#### الوظائف:

- فلاتر متقدمة (نطاق السعر، وقت المغادرة، عدد التوقفات)
- البحث بالمرونة (±3 أيام)
- ترتيب النتائج (السعر، المدة، التقييم)
- حفظ البحث المفضل
- تنبيهات تغيير الأسعار

---

### 9. E2E Testing with Playwright (اختبارات شاملة) 🟡

#### الملفات المطلوبة:

1. `tests/e2e/booking-flow.spec.ts` - اختبار تدفق الحجز
2. `tests/e2e/payment.spec.ts` - اختبار الدفع
3. `tests/e2e/admin.spec.ts` - اختبار صفحات الإدارة
4. `playwright.config.ts` - إعدادات Playwright

#### الوظائف:

- اختبار تدفق الحجز الكامل
- اختبار الدفع
- اختبار تسجيل الوصول
- اختبار صفحات الإدارة
- اختبار متعدد المتصفحات

---

### 10. Performance Monitoring (مراقبة الأداء) 🟢

#### الملفات المطلوبة:

1. `server/_core/performance-monitor.ts` - مراقبة الأداء
2. `server/_core/metrics.ts` - Metrics collection

#### الوظائف:

- مراقبة زمن الاستجابة
- مراقبة استخدام الذاكرة
- مراقبة استعلامات قاعدة البيانات
- تنبيهات الأداء
- Dashboard للأداء

---

## الأولويات

### المرحلة 1: حرجة (أسبوع واحد)

1. ✅ Multi-Currency Support
2. ✅ Request ID & Unified Logging
3. ✅ Enhanced Security Features

### المرحلة 2: مهمة (أسبوع واحد)

1. ✅ Enhanced Analytics Dashboard
2. ✅ Caching Layer with Redis
3. ✅ Dynamic Pricing Engine

### المرحلة 3: تحسينات (أسبوع واحد)

1. ✅ Notification System
2. ✅ Advanced Search & Filters
3. ✅ E2E Testing

### المرحلة 4: إضافية (حسب الحاجة)

1. Performance Monitoring
2. Load Testing
3. Security Audit

---

## التنفيذ

سيتم تطوير التحسينات بالترتيب التالي:

1. Multi-Currency Support
2. Request ID & Unified Logging
3. Enhanced Security Features
4. Enhanced Analytics Dashboard
5. Caching Layer with Redis

---

**ملاحظة:** سيتم تطوير كل تحسين بشكل منفصل واختباره قبل الانتقال للتالي.
