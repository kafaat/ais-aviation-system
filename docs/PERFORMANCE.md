# دليل الأداء والتحسين - Performance Guide

## ⚡ نظرة عامة

هذا الدليل يوفر استراتيجيات وأفضل الممارسات لتحسين أداء نظام الطيران المتكامل.

---

## 📋 جدول المحتويات

1. [قياس الأداء](#قياس-الأداء)
2. [تحسين Frontend](#تحسين-frontend)
3. [تحسين Backend](#تحسين-backend)
4. [تحسين قاعدة البيانات](#تحسين-قاعدة-البيانات)
5. [التخزين المؤقت (Caching)](#التخزين-المؤقت-caching)
6. [الحمل والتوسع](#الحمل-والتوسع)
7. [المراقبة والتنبيهات](#المراقبة-والتنبيهات)

---

## 📊 قياس الأداء

### أهداف الأداء

| المقياس | الهدف | الحالي |
|---------|--------|--------|
| Time to First Byte (TTFB) | < 200ms | ~150ms |
| First Contentful Paint (FCP) | < 1.5s | ~1.2s |
| Largest Contentful Paint (LCP) | < 2.5s | ~2.0s |
| Time to Interactive (TTI) | < 3.5s | ~3.0s |
| API Response Time (p95) | < 500ms | ~300ms |
| Database Query Time (p95) | < 100ms | ~50ms |

### أدوات القياس

#### 1. Frontend Performance

```bash
# Lighthouse CI
npm install -g @lhci/cli
lhci autorun

# WebPageTest
# استخدم https://www.webpagetest.org/

# Chrome DevTools
# Network tab, Performance tab
```

#### 2. Backend Performance

```typescript
// في server/_core/logger.ts
import { performance } from 'perf_hooks';

// قياس وقت التنفيذ
const start = performance.now();
await someOperation();
const duration = performance.now() - start;
logger.info({ duration, operation: 'someOperation' });
```

#### 3. Database Performance

```sql
-- تفعيل Slow Query Log
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 0.5; -- استعلامات أبطأ من 0.5s

-- عرض الاستعلامات البطيئة
SELECT * FROM mysql.slow_log 
ORDER BY query_time DESC 
LIMIT 10;

-- شرح خطة الاستعلام
EXPLAIN SELECT * FROM flights WHERE ...;
```

---

## 🎨 تحسين Frontend

### 1. Code Splitting

**استخدم React.lazy للتحميل الكسول**:

```typescript
// بدلاً من
import AdminDashboard from './pages/AdminDashboard';

// استخدم
const AdminDashboard = React.lazy(() => import('./pages/AdminDashboard'));

// مع Suspense
<Suspense fallback={<Loading />}>
  <AdminDashboard />
</Suspense>
```

### 2. Bundle Optimization

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
          'vendor-query': ['@tanstack/react-query', '@trpc/client'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
});
```

### 3. Image Optimization

```typescript
// استخدم صور مُحسّنة
<img 
  src="/images/airline-logo.webp" 
  alt="Airline"
  width={100}
  height={50}
  loading="lazy" // Lazy loading
/>

// أو استخدم مكتبة
import { LazyLoadImage } from 'react-lazy-load-image-component';
```

### 4. CSS Optimization

```typescript
// Tailwind CSS - إزالة CSS غير المستخدم
// postcss.config.js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
    ...(process.env.NODE_ENV === 'production' ? { cssnano: {} } : {}),
  },
};
```

### 5. مذكرة التخزين المؤقت (Memoization)

```typescript
import { useMemo, useCallback } from 'react';

// useMemo للبيانات المحسوبة
const sortedFlights = useMemo(() => {
  return flights.sort((a, b) => a.price - b.price);
}, [flights]);

// useCallback للدوال
const handleBooking = useCallback((flightId: string) => {
  // ...
}, []);
```

### 6. Virtualization

```typescript
// للقوائم الطويلة
import { FixedSizeList } from 'react-window';

<FixedSizeList
  height={600}
  itemCount={flights.length}
  itemSize={100}
  width="100%"
>
  {({ index, style }) => (
    <FlightCard flight={flights[index]} style={style} />
  )}
</FixedSizeList>
```

### 7. تحسين الخطوط

```html
<!-- في index.html -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>

<!-- تحميل الخطوط بشكل غير متزامن -->
<link rel="preload" href="/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
```

---

## 🔧 تحسين Backend

### 1. Database Connection Pooling

```typescript
// server/db.ts
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  connectionLimit: 10, // عدد الاتصالات المتزامنة
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

export const db = drizzle(pool);
```

### 2. Request Batching

```typescript
// استخدم tRPC batching
import { httpBatchLink } from '@trpc/client';

export const trpc = createTRPCReact<AppRouter>();

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: '/trpc',
      maxURLLength: 2083,
    }),
  ],
});
```

### 3. Compression

```typescript
// server/_core/index.ts
import compression from 'compression';

app.use(compression({
  level: 6, // مستوى الضغط (0-9)
  threshold: 1024, // حد أدنى 1KB
}));
```

### 4. Rate Limiting

```typescript
// server/_core/rateLimiter.ts
import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 100, // 100 طلب
  message: 'Too many requests',
  standardHeaders: true,
  legacyHeaders: false,
});

// تطبيق على routes محددة
app.use('/api/', apiLimiter);
```

### 5. Async Operations

```typescript
// استخدم Promise.all للعمليات المتوازية
const [flights, airlines, airports] = await Promise.all([
  db.select().from(flights),
  db.select().from(airlines),
  db.select().from(airports),
]);

// بدلاً من
const flights = await db.select().from(flights);
const airlines = await db.select().from(airlines);
const airports = await db.select().from(airports);
```

### 6. Streaming Responses

```typescript
// للبيانات الكبيرة
import { Readable } from 'stream';

app.get('/api/export', async (req, res) => {
  const dataStream = Readable.from(generateLargeData());
  res.setHeader('Content-Type', 'application/json');
  dataStream.pipe(res);
});
```

---

## 🗄️ تحسين قاعدة البيانات

### 1. الفهارس (Indexes)

```sql
-- إضافة فهارس للأعمدة المستخدمة في WHERE
CREATE INDEX idx_flight_departure ON flights(departureTime);
CREATE INDEX idx_booking_user ON bookings(userId);

-- فهارس مركبة للاستعلامات المعقدة
CREATE INDEX idx_flight_route_date ON flights(
  originId, 
  destinationId, 
  departureTime
);

-- عرض الفهارس المستخدمة
SHOW INDEX FROM flights;
```

### 2. Query Optimization

```typescript
// ❌ سيء - يجلب جميع الأعمدة
const flights = await db.select().from(flights);

// ✅ جيد - يجلب الأعمدة المطلوبة فقط
const flights = await db
  .select({
    id: flights.id,
    flightNumber: flights.flightNumber,
    departureTime: flights.departureTime,
    price: flights.economyPrice,
  })
  .from(flights);
```

### 3. Pagination

```typescript
// تنفيذ pagination بشكل صحيح
const page = 1;
const perPage = 20;
const offset = (page - 1) * perPage;

const results = await db
  .select()
  .from(flights)
  .limit(perPage)
  .offset(offset);

// عدد النتائج الإجمالي
const [{ count }] = await db
  .select({ count: sql<number>`count(*)` })
  .from(flights);
```

### 4. Batch Operations

```typescript
// ❌ سيء - إدراج واحد في كل مرة
for (const passenger of passengers) {
  await db.insert(passengers).values(passenger);
}

// ✅ جيد - إدراج دفعة واحدة
await db.insert(passengers).values(passengers);
```

### 5. Connection Management

```typescript
// استخدم transactions للعمليات المترابطة
await db.transaction(async (tx) => {
  await tx.insert(bookings).values(bookingData);
  await tx.insert(passengers).values(passengersData);
  await tx.update(flights)
    .set({ economyAvailable: sql`${flights.economyAvailable} - 1` })
    .where(eq(flights.id, flightId));
});
```

### 6. Database Partitioning

```sql
-- تقسيم جدول الرحلات حسب التاريخ
ALTER TABLE flights
PARTITION BY RANGE (YEAR(departureTime)) (
  PARTITION p2024 VALUES LESS THAN (2025),
  PARTITION p2025 VALUES LESS THAN (2026),
  PARTITION p2026 VALUES LESS THAN (2027),
  PARTITION pmax VALUES LESS THAN MAXVALUE
);
```

---

## 💾 التخزين المؤقت (Caching)

### 1. Browser Caching

```typescript
// server/_core/index.ts
app.use(express.static('dist/public', {
  maxAge: '1y', // الموارد الثابتة
  immutable: true,
}));

// للـ API responses
res.set('Cache-Control', 'public, max-age=300'); // 5 دقائق
```

### 2. In-Memory Caching

```typescript
// استخدام Map بسيطة للتخزين المؤقت
const cache = new Map<string, { data: any; expiry: number }>();

function getCached<T>(key: string): T | null {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiry) {
    cache.delete(key);
    return null;
  }
  return item.data as T;
}

function setCache<T>(key: string, data: T, ttl: number = 300000) {
  cache.set(key, {
    data,
    expiry: Date.now() + ttl,
  });
}

// استخدام
const flights = getCached<Flight[]>('flights_list');
if (!flights) {
  const freshFlights = await db.select().from(flights);
  setCache('flights_list', freshFlights);
  return freshFlights;
}
```

### 3. Redis (للإنتاج)

```typescript
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

// تخزين
await redis.setex('flights:list', 300, JSON.stringify(flights));

// استرجاع
const cached = await redis.get('flights:list');
if (cached) {
  return JSON.parse(cached);
}
```

### 4. React Query Caching

```typescript
// client/src/lib/trpc.ts
export const trpc = createTRPCReact<AppRouter>();

export const trpcClient = trpc.createClient({
  links: [httpBatchLink({ url: '/trpc' })],
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 دقائق
      cacheTime: 10 * 60 * 1000, // 10 دقائق
    },
  },
});
```

---

## 📈 الحمل والتوسع (Load & Scalability)

### 1. Horizontal Scaling

```yaml
# docker-compose.yml
services:
  app:
    image: ais-app:latest
    deploy:
      replicas: 3 # عدة نسخ
    environment:
      - NODE_ENV=production
```

### 2. Load Balancer

```nginx
# nginx.conf
upstream ais_backend {
    least_conn; # أقل اتصالات
    server app1:3000;
    server app2:3000;
    server app3:3000;
}

server {
    listen 80;
    
    location / {
        proxy_pass http://ais_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 3. Database Read Replicas

```typescript
// قراءة من replica
const readDb = drizzle(process.env.READ_REPLICA_URL);

// كتابة على master
const writeDb = drizzle(process.env.DATABASE_URL);

// استخدام
const flights = await readDb.select().from(flights); // قراءة
await writeDb.insert(bookings).values(data); // كتابة
```

### 4. CDN

```html
<!-- استخدام CDN للموارد الثابتة -->
<script src="https://cdn.example.com/ais-app/main.js"></script>
<link rel="stylesheet" href="https://cdn.example.com/ais-app/styles.css">
```

---

## 📊 المراقبة والتنبيهات

### 1. Application Monitoring

```typescript
// server/_core/monitoring.ts
import { performance } from 'perf_hooks';

export function measurePerformance(name: string) {
  const start = performance.now();
  
  return {
    end: () => {
      const duration = performance.now() - start;
      logger.info({ 
        metric: 'performance',
        name,
        duration,
        slow: duration > 1000
      });
      return duration;
    }
  };
}

// استخدام
const perf = measurePerformance('search_flights');
const flights = await searchFlights(params);
perf.end();
```

### 2. Database Monitoring

```sql
-- عرض الاستعلامات الجارية
SHOW PROCESSLIST;

-- عرض حالة قاعدة البيانات
SHOW STATUS LIKE '%thread%';
SHOW STATUS LIKE '%connection%';

-- عرض استخدام الذاكرة
SHOW STATUS LIKE '%innodb%';
```

### 3. Error Tracking

```typescript
// integration مع Sentry (مثال)
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1, // 10% من الطلبات
});

// تتبع الأخطاء
try {
  await someOperation();
} catch (error) {
  Sentry.captureException(error);
  throw error;
}
```

### 4. Alerts

```typescript
// تنبيهات بسيطة
function checkPerformance(metric: string, value: number, threshold: number) {
  if (value > threshold) {
    logger.error({
      alert: 'PERFORMANCE_DEGRADATION',
      metric,
      value,
      threshold,
    });
    // إرسال تنبيه (email, SMS, Slack, etc.)
  }
}
```

---

## 🎯 Best Practices

### Checklist للأداء

- [ ] **Frontend**
  - [ ] Code splitting مُفعّل
  - [ ] Images محسّنة (WebP, lazy loading)
  - [ ] CSS مُنظف (no unused styles)
  - [ ] Bundle size < 500KB
  - [ ] Lighthouse score > 90

- [ ] **Backend**
  - [ ] Database connection pooling
  - [ ] Request batching
  - [ ] Compression مُفعّل
  - [ ] Rate limiting مُطبق
  - [ ] API response time < 500ms

- [ ] **Database**
  - [ ] Indexes على جميع foreign keys
  - [ ] Composite indexes للاستعلامات المعقدة
  - [ ] Pagination على جميع القوائم
  - [ ] Query time < 100ms
  - [ ] Regular backups

- [ ] **Caching**
  - [ ] Browser caching للموارد الثابتة
  - [ ] In-memory caching للبيانات المتكررة
  - [ ] CDN للموارد العامة
  - [ ] Redis للإنتاج

- [ ] **Monitoring**
  - [ ] Application monitoring
  - [ ] Database monitoring
  - [ ] Error tracking
  - [ ] Performance alerts

---

## 📚 موارد إضافية

- [Web.dev Performance](https://web.dev/performance/)
- [React Performance Optimization](https://react.dev/learn/render-and-commit)
- [MySQL Performance Tuning](https://dev.mysql.com/doc/refman/8.0/en/optimization.html)
- [Node.js Performance](https://nodejs.org/en/docs/guides/simple-profiling/)

---

**للمزيد من التفاصيل، راجع**:
- [دليل المطور](DEVELOPER_GUIDE.md)
- [البنية المعمارية](ARCHITECTURE.md)
- [دليل المراقبة](MONITORING.md)
