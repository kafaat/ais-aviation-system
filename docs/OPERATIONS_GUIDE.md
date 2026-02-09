# دليل تشغيل النظام - نظام الطيران المتكامل (AIS)

## Operations Guide - Aviation Integrated System

> **الإصدار**: 4.0 | **آخر تحديث**: فبراير 2026
>
> هذا الدليل مخصص لفريق التشغيل والصيانة. يغطي جميع جوانب تثبيت وتشغيل ومراقبة وصيانة نظام الطيران المتكامل AIS.

---

## جدول المحتويات

1. [متطلبات النظام](#1-متطلبات-النظام-system-requirements)
2. [التثبيت والإعداد الأولي](#2-التثبيت-والإعداد-الأولي-initial-setup)
3. [تشغيل بيئة التطوير](#3-تشغيل-بيئة-التطوير-development-environment)
4. [تشغيل بيئة الإنتاج](#4-تشغيل-بيئة-الإنتاج-production-deployment)
5. [إدارة قاعدة البيانات](#5-إدارة-قاعدة-البيانات-database-management)
6. [المراقبة والصيانة](#6-المراقبة-والصيانة-monitoring--maintenance)
7. [إدارة المستخدمين](#7-إدارة-المستخدمين-user-management)
8. [الميزات الرئيسية وإدارتها](#8-الميزات-الرئيسية-وإدارتها-core-features-management)
9. [استكشاف الأخطاء وإصلاحها](#9-استكشاف-الأخطاء-وإصلاحها-troubleshooting)
10. [النسخ الاحتياطي والاسترداد](#10-النسخ-الاحتياطي-والاسترداد-backup--recovery)
11. [أوامر مرجعية سريعة](#11-أوامر-مرجعية-سريعة-quick-reference-commands)

---

## 1. متطلبات النظام (System Requirements)

### 1.1 البرمجيات المطلوبة

| المتطلب            | الإصدار الأدنى | ملاحظات                                                   |
| ------------------ | -------------- | --------------------------------------------------------- |
| **Node.js**        | 22+            | بيئة التشغيل الأساسية للخادم                              |
| **pnpm**           | 10.28+         | مدير الحزم (محدد في `packageManager` بملف `package.json`) |
| **Python**         | 3.10+          | مطلوب لخدمة المصادقة FastAPI                              |
| **MySQL**          | 8.0+           | قاعدة البيانات الرئيسية (أو TiDB كبديل متوافق)            |
| **Redis**          | 7+             | مطلوب لطوابير المهام BullMQ والتخزين المؤقت               |
| **Docker**         | 24+            | اختياري - لتشغيل البيئة عبر الحاويات                      |
| **Docker Compose** | 2.0+           | اختياري - لتنسيق الحاويات                                 |

### 1.2 متطلبات الأجهزة

#### بيئة التطوير (Development)

| المورد                | الحد الأدنى        | الموصى به |
| --------------------- | ------------------ | --------- |
| **المعالج (CPU)**     | 2 أنوية            | 4 أنوية   |
| **الذاكرة (RAM)**     | 4 GB               | 8 GB      |
| **التخزين (Storage)** | 20 GB              | 50 GB     |
| **الشبكة**            | اتصال إنترنت مستقر | -         |

#### بيئة الإنتاج (Production)

| المورد                | الحد الأدنى | الموصى به       |
| --------------------- | ----------- | --------------- |
| **المعالج (CPU)**     | 4 أنوية     | 8+ أنوية        |
| **الذاكرة (RAM)**     | 16 GB       | 32 GB           |
| **التخزين (Storage)** | 100 GB SSD  | 500 GB NVMe SSD |
| **الشبكة**            | 100 Mbps    | 1 Gbps          |

> **ملاحظة**: يعتمد تكوين الإنتاج على 3 نسخ من خادم API، كل واحدة محدودة بـ 2 CPU و 2GB RAM. قاعدة البيانات MySQL تحتاج 4 CPU و 8GB RAM. Redis يحتاج 2 CPU و 4GB RAM.

### 1.3 المنافذ المطلوبة (Required Ports)

| المنفذ | الخدمة            | الوصف                                   |
| ------ | ----------------- | --------------------------------------- |
| `3000` | Node.js / Express | الخادم الرئيسي (API + واجهة المستخدم)   |
| `8000` | FastAPI           | خدمة المصادقة (Auth Service)            |
| `3306` | MySQL             | قاعدة البيانات                          |
| `6379` | Redis             | التخزين المؤقت وطوابير المهام           |
| `8080` | phpMyAdmin        | إدارة قاعدة البيانات (بيئة التطوير فقط) |
| `80`   | Nginx             | HTTP (بيئة الإنتاج)                     |
| `443`  | Nginx             | HTTPS (بيئة الإنتاج)                    |

---

## 2. التثبيت والإعداد الأولي (Initial Setup)

### 2.1 استنساخ المشروع

```bash
git clone https://github.com/kafaat/ais-aviation-system.git
cd ais-aviation-system
```

### 2.2 تثبيت التبعيات (Node.js)

```bash
# تثبيت جميع حزم Node.js
pnpm install
```

### 2.3 إعداد ملف البيئة (.env)

```bash
# نسخ ملف البيئة النموذجي
cp .env.example .env
```

افتح ملف `.env` وعدّل المتغيرات التالية حسب بيئتك:

#### المتغيرات الأساسية (مطلوبة)

```bash
# قاعدة البيانات
DATABASE_URL=mysql://ais_dev:ais_dev_password@localhost:3306/ais_aviation_dev

# Redis
REDIS_URL=redis://localhost:6379

# المصادقة
JWT_SECRET=<مفتاح-سري-قوي-32-حرف-على-الأقل>
CSRF_SECRET=<مفتاح-سري-آخر-32-حرف-على-الأقل>
AUTH_SERVICE_URL=http://localhost:8000
OWNER_EMAIL=admin@ais-aviation.local

# المدفوعات (Stripe)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...

# عنوان التطبيق
FRONTEND_URL=http://localhost:3000
VITE_APP_URL=http://localhost:3000
PORT=3000
```

#### المتغيرات الاختيارية

```bash
# البريد الإلكتروني
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password

# الذكاء الاصطناعي
OPENAI_API_KEY=sk-...

# التخزين السحابي (S3)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=ais-aviation-files

# تتبع الأخطاء (Sentry)
# SENTRY_DSN=https://...@sentry.io/...
# VITE_SENTRY_DSN=https://...@sentry.io/...

# أعلام الميزات (Feature Flags)
ENABLE_AI_CHAT=true
ENABLE_LOYALTY_PROGRAM=true
ENABLE_MULTI_CURRENCY=true
ENABLE_PWA=true
```

### 2.4 إعداد قاعدة البيانات

```bash
# تطبيق المخطط على قاعدة البيانات (يُنشئ جميع الجداول الـ 71)
pnpm db:push
```

> **تحذير**: أمر `db:push` يطبق التغييرات مباشرة. في بيئة الإنتاج، استخدم `db:migrate` بدلاً من ذلك.

### 2.5 إعداد خدمة المصادقة (Auth Service)

```bash
cd auth-service

# تثبيت تبعيات Python
pip install -r requirements.txt

# أو باستخدام بيئة افتراضية (الأفضل)
python -m venv venv
source venv/bin/activate  # على Linux/macOS
pip install -r requirements.txt

cd ..
```

التبعيات الرئيسية لخدمة المصادقة:

- `fastapi` 0.115+ - إطار العمل
- `uvicorn` 0.34+ - خادم ASGI
- `sqlalchemy` 2.0+ - ORM لقاعدة البيانات
- `passlib[bcrypt]` + `bcrypt` - تشفير كلمات المرور
- `python-jose` - التعامل مع JWT tokens

### 2.6 التحقق من التثبيت

```bash
# التحقق من أنواع TypeScript
pnpm check

# تشغيل الاختبارات
pnpm test

# التحقق من أسلوب الكود
pnpm lint
```

---

## 3. تشغيل بيئة التطوير (Development Environment)

### 3.1 التشغيل اليدوي (بدون Docker)

يتطلب تشغيل كل خدمة في terminal منفصل:

**Terminal 1 - قاعدة البيانات MySQL:**

```bash
# تأكد من أن MySQL يعمل محلياً
sudo systemctl start mysql
# أو
mysql.server start
```

**Terminal 2 - Redis:**

```bash
redis-server
```

**Terminal 3 - خدمة المصادقة:**

```bash
cd auth-service
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

> خيار `--reload` يفعّل إعادة التحميل التلقائي عند تعديل الكود.

**Terminal 4 - خادم التطوير الرئيسي:**

```bash
pnpm dev
```

> يبدأ الخادم على المنفذ `3000` مع إعادة تحميل تلقائي عبر `tsx watch`.

### 3.2 التشغيل باستخدام Docker Compose (الأسهل)

```bash
# تشغيل جميع الخدمات المساعدة (MySQL + Redis + phpMyAdmin + Auth Service)
docker-compose up -d

# ثم تشغيل خادم التطوير
pnpm dev
```

الخدمات المتاحة بعد التشغيل:

| الخدمة        | العنوان                 | الوصف                            |
| ------------- | ----------------------- | -------------------------------- |
| التطبيق       | `http://localhost:3000` | واجهة المستخدم + API             |
| خدمة المصادقة | `http://localhost:8000` | FastAPI Auth Service             |
| phpMyAdmin    | `http://localhost:8080` | إدارة قاعدة البيانات عبر المتصفح |
| MySQL         | `localhost:3306`        | قاعدة البيانات                   |
| Redis         | `localhost:6379`        | التخزين المؤقت                   |

### 3.3 التحقق من صحة الخدمات

```bash
# فحص صحة خدمة المصادقة
curl http://localhost:8000/auth/health

# فحص صحة التطبيق (يحتاج صلاحيات admin)
# عبر المتصفح: http://localhost:3000/api/trpc/health.ready

# التحقق من حالة حاويات Docker
docker-compose ps
```

### 3.4 اختبار Stripe Webhooks محلياً

```bash
# تثبيت Stripe CLI
# https://stripe.com/docs/stripe-cli

# الاستماع للأحداث وتوجيهها للخادم المحلي
stripe listen --forward-to localhost:3000/api/stripe/webhook

# انسخ الـ webhook secret المعروض وأضفه في .env
# STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## 4. تشغيل بيئة الإنتاج (Production Deployment)

### 4.1 بناء المشروع (Build)

```bash
# بناء الواجهة الأمامية والخادم
pnpm build
```

ينتج عن البناء:

- `dist/index.js` - الخادم الرئيسي (Express + tRPC + ملفات React الثابتة)
- `dist/worker.js` - عامل المهام الخلفية (BullMQ worker)
- `dist/public/` - ملفات الواجهة الأمامية المبنية (HTML, CSS, JS)

### 4.2 التشغيل المباشر (بدون Docker)

**الخادم الرئيسي:**

```bash
NODE_ENV=production node dist/index.js
```

**عامل المهام الخلفية:**

```bash
NODE_ENV=production node dist/worker.js
```

**خدمة المصادقة:**

```bash
cd auth-service
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

> في بيئة الإنتاج، استخدم `--workers 4` (أو أكثر حسب عدد الأنوية) بدلاً من `--reload`.

### 4.3 التشغيل باستخدام Docker (الطريقة الموصى بها)

#### الإنتاج المبسط (Production Lite)

```bash
docker-compose -f docker-compose.prod.yml up -d
```

#### الإنتاج الكامل (Full Production)

```bash
docker-compose -f docker-compose.production.yml up -d
```

هيكل الإنتاج الكامل يتضمن:

| الخدمة                     | النسخ | الموارد (CPU/RAM)     | الوصف                         |
| -------------------------- | ----- | --------------------- | ----------------------------- |
| **Nginx**                  | 1     | -                     | موازن الأحمال (Load Balancer) |
| **API (api1, api2, api3)** | 3     | 2 CPU / 2 GB لكل نسخة | خوادم التطبيق                 |
| **Worker**                 | 1     | 1 CPU / 1 GB          | معالج المهام الخلفية          |
| **Auth Service**           | 1     | 1 CPU / 512 MB        | خدمة المصادقة                 |
| **MySQL**                  | 1     | 4 CPU / 8 GB          | قاعدة البيانات                |
| **Redis**                  | 1     | 2 CPU / 4 GB          | التخزين المؤقت والطوابير      |

### 4.4 إعداد SSL/TLS

```bash
# ضع شهادات SSL في مجلد ssl/
mkdir -p ssl
cp /path/to/cert.pem ssl/cert.pem
cp /path/to/key.pem ssl/key.pem
```

يقرأ Nginx الشهادات تلقائياً من مجلد `./ssl/` ويخدم المنفذ `443` (HTTPS).

### 4.5 جدول متغيرات البيئة الكامل (Production)

#### إعدادات التطبيق الأساسية

| المتغير          | مطلوب | الوصف                        | مثال                      |
| ---------------- | ----- | ---------------------------- | ------------------------- |
| `NODE_ENV`       | نعم   | بيئة التشغيل                 | `production`              |
| `PORT`           | لا    | منفذ الخادم (افتراضي: 3000)  | `3000`                    |
| `VITE_APP_ID`    | لا    | معرف التطبيق                 | `ais-aviation-system`     |
| `VITE_APP_TITLE` | لا    | عنوان التطبيق في المتصفح     | `AIS Aviation System`     |
| `VITE_APP_URL`   | لا    | رابط الواجهة الأمامية        | `https://ais.example.com` |
| `FRONTEND_URL`   | نعم   | رابط الواجهة (CORS و Stripe) | `https://ais.example.com` |

#### قاعدة البيانات

| المتغير              | مطلوب | الوصف                     | مثال                             |
| -------------------- | ----- | ------------------------- | -------------------------------- |
| `DATABASE_URL`       | نعم   | رابط اتصال MySQL          | `mysql://user:pass@host:3306/db` |
| `DB_POOL_SIZE`       | لا    | حجم مجمع الاتصالات        | `10`                             |
| `DB_MAX_IDLE`        | لا    | أقصى عدد اتصالات خاملة    | `10`                             |
| `DB_IDLE_TIMEOUT`    | لا    | مهلة الخمول (مللي ثانية)  | `60000`                          |
| `DB_CONNECT_TIMEOUT` | لا    | مهلة الاتصال (مللي ثانية) | `10000`                          |

#### Redis

| المتغير          | مطلوب       | الوصف                       | مثال                     |
| ---------------- | ----------- | --------------------------- | ------------------------ |
| `REDIS_URL`      | نعم (إنتاج) | رابط اتصال Redis            | `redis://localhost:6379` |
| `REDIS_HOST`     | لا          | بديل عن REDIS_URL           | `localhost`              |
| `REDIS_PORT`     | لا          | منفذ Redis                  | `6379`                   |
| `REDIS_PASSWORD` | لا          | كلمة مرور Redis             | `secret`                 |
| `CACHE_PREFIX`   | لا          | بادئة مفاتيح التخزين المؤقت | `ais`                    |

#### المصادقة والأمان

| المتغير            | مطلوب | الوصف                      | مثال                       |
| ------------------ | ----- | -------------------------- | -------------------------- |
| `JWT_SECRET`       | نعم   | مفتاح توقيع JWT (32+ حرف)  | `your-strong-secret...`    |
| `CSRF_SECRET`      | نعم   | مفتاح حماية CSRF (32+ حرف) | `your-csrf-secret...`      |
| `AUTH_SERVICE_URL` | نعم   | رابط خدمة المصادقة         | `http://auth-service:8000` |
| `OWNER_EMAIL`      | لا    | بريد المسؤول الرئيسي       | `admin@example.com`        |
| `OAUTH_SERVER_URL` | لا    | رابط خادم OAuth            | `https://ais.example.com`  |
| `OWNER_OPEN_ID`    | لا    | معرف OAuth للمالك          | `owner-123`                |
| `COOKIE_DOMAIN`    | لا    | نطاق الكوكيز               | `.example.com`             |
| `COOKIE_SECURE`    | لا    | كوكيز آمنة فقط (HTTPS)     | `true`                     |
| `COOKIE_SAME_SITE` | لا    | سياسة SameSite             | `strict`                   |

#### المدفوعات (Stripe)

| المتغير                       | مطلوب | الوصف                   | مثال          |
| ----------------------------- | ----- | ----------------------- | ------------- |
| `STRIPE_SECRET_KEY`           | نعم   | المفتاح السري لـ Stripe | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET`       | نعم   | مفتاح توقيع Webhooks    | `whsec_...`   |
| `VITE_STRIPE_PUBLISHABLE_KEY` | نعم   | المفتاح العام لـ Stripe | `pk_live_...` |

#### البريد الإلكتروني

| المتغير          | مطلوب | الوصف            | مثال                    |
| ---------------- | ----- | ---------------- | ----------------------- |
| `EMAIL_HOST`     | لا    | خادم SMTP        | `smtp.gmail.com`        |
| `EMAIL_PORT`     | لا    | منفذ SMTP        | `587`                   |
| `EMAIL_USER`     | لا    | مستخدم البريد    | `noreply@example.com`   |
| `EMAIL_PASSWORD` | لا    | كلمة مرور البريد | `app-password`          |
| `EMAIL_FROM`     | لا    | اسم المرسل       | `AIS <noreply@ais.com>` |

#### الرسائل النصية (SMS)

| المتغير               | مطلوب | الوصف                         | مثال          |
| --------------------- | ----- | ----------------------------- | ------------- |
| `SMS_PROVIDER`        | لا    | مزود SMS (`twilio` أو `mock`) | `twilio`      |
| `TWILIO_ACCOUNT_SID`  | لا    | معرف حساب Twilio              | `AC...`       |
| `TWILIO_AUTH_TOKEN`   | لا    | رمز مصادقة Twilio             | `...`         |
| `TWILIO_PHONE_NUMBER` | لا    | رقم الهاتف المرسل             | `+1234567890` |

#### المراقبة والتسجيل

| المتغير                     | مطلوب | الوصف                              | مثال                        |
| --------------------------- | ----- | ---------------------------------- | --------------------------- |
| `LOG_LEVEL`                 | لا    | مستوى التسجيل                      | `info`                      |
| `LOG_FORMAT`                | لا    | تنسيق السجلات (`json` أو `pretty`) | `json`                      |
| `LOG_FILE_PATH`             | لا    | مسار ملف السجلات                   | `./logs/app.log`            |
| `LOG_SERVICE_NAME`          | لا    | اسم الخدمة في السجلات              | `ais-aviation`              |
| `SENTRY_DSN`                | لا    | رابط Sentry للخادم                 | `https://...@sentry.io/...` |
| `VITE_SENTRY_DSN`           | لا    | رابط Sentry للواجهة                | `https://...@sentry.io/...` |
| `SENTRY_TRACES_SAMPLE_RATE` | لا    | معدل تتبع الأداء (0.0-1.0)         | `0.1`                       |
| `SLOW_QUERY_THRESHOLD_MS`   | لا    | عتبة الاستعلام البطيء              | `1000`                      |

#### تحديد المعدل (Rate Limiting)

| المتغير                | مطلوب | الوصف                    | مثال     |
| ---------------------- | ----- | ------------------------ | -------- |
| `RATE_LIMIT_MAX`       | لا    | أقصى طلبات لكل نافذة     | `100`    |
| `RATE_LIMIT_WINDOW_MS` | لا    | حجم النافذة (مللي ثانية) | `900000` |

#### أعلام الميزات (Feature Flags)

| المتغير                  | مطلوب | الوصف                     | مثال   |
| ------------------------ | ----- | ------------------------- | ------ |
| `ENABLE_AI_CHAT`         | لا    | تفعيل الدردشة الذكية      | `true` |
| `ENABLE_LOYALTY_PROGRAM` | لا    | تفعيل برنامج الولاء       | `true` |
| `ENABLE_MULTI_CURRENCY`  | لا    | تفعيل العملات المتعددة    | `true` |
| `ENABLE_PWA`             | لا    | تفعيل Progressive Web App | `true` |

#### خدمات خارجية

| المتغير                 | مطلوب | الوصف                         | مثال                 |
| ----------------------- | ----- | ----------------------------- | -------------------- |
| `OPENAI_API_KEY`        | لا    | مفتاح OpenAI (للدردشة الذكية) | `sk-...`             |
| `AWS_REGION`            | لا    | منطقة AWS                     | `us-east-1`          |
| `AWS_ACCESS_KEY_ID`     | لا    | مفتاح وصول AWS                | `AKIA...`            |
| `AWS_SECRET_ACCESS_KEY` | لا    | المفتاح السري لـ AWS          | `...`                |
| `AWS_S3_BUCKET`         | لا    | اسم حاوية S3                  | `ais-aviation-files` |

#### Docker (بيئة الإنتاج)

| المتغير            | مطلوب | الوصف                   | مثال              |
| ------------------ | ----- | ----------------------- | ----------------- |
| `DB_ROOT_PASSWORD` | نعم   | كلمة مرور root لـ MySQL | `strong-password` |
| `DB_NAME`          | نعم   | اسم قاعدة البيانات      | `ais_aviation`    |
| `DB_USER`          | نعم   | مستخدم قاعدة البيانات   | `ais_user`        |
| `DB_PASSWORD`      | نعم   | كلمة مرور المستخدم      | `strong-password` |

---

## 5. إدارة قاعدة البيانات (Database Management)

### 5.1 نظرة عامة

- **ORM**: Drizzle ORM
- **قاعدة البيانات**: MySQL 8.0+ / TiDB
- **ملف المخطط الرئيسي**: `drizzle/schema.ts` (71 جدول)
- **مخطط الولاء**: `drizzle/loyalty-schema.ts` (جداول برنامج الولاء)
- **جميع الأسعار**: بالهللات (SAR cents) - مثلاً: 100 = 1 ريال سعودي

### 5.2 تعديل المخطط (Schema Changes)

```bash
# 1. عدّل ملف drizzle/schema.ts

# 2. في بيئة التطوير: تطبيق مباشر
pnpm db:push

# 3. في بيئة الإنتاج: إنشاء migration ثم تطبيقه
pnpm db:generate    # ينشئ ملف migration في drizzle/migrations/
pnpm db:migrate     # يطبق الـ migrations المعلقة
```

### 5.3 تفقد قاعدة البيانات

```bash
# فتح واجهة Drizzle Studio (متصفح)
pnpm db:studio

# أو عبر phpMyAdmin (في Docker)
# http://localhost:8080
```

### 5.4 الجداول الرئيسية

| الجدول              | الوصف                           |
| ------------------- | ------------------------------- |
| `users`             | حسابات المستخدمين والأدوار      |
| `airlines`          | شركات الطيران                   |
| `airports`          | المطارات                        |
| `flights`           | جداول الرحلات والأسعار          |
| `bookings`          | الحجوزات (PNR: varchar(6))      |
| `passengers`        | بيانات الركاب لكل حجز           |
| `payments`          | المعاملات المالية (Stripe)      |
| `loyaltyAccounts`   | حسابات برنامج الولاء            |
| `ancillaryServices` | الخدمات الإضافية (أمتعة، وجبات) |
| `airportGates`      | بوابات المطار                   |
| `gateAssignments`   | تعيينات البوابات للرحلات        |
| `vouchers`          | قسائم الخصم                     |
| `userCredits`       | أرصدة المستخدمين                |
| `waitlist`          | قوائم الانتظار                  |
| `corporateAccounts` | حسابات الشركات                  |
| `travelAgents`      | وكلاء السفر                     |
| `notifications`     | إشعارات المستخدمين              |
| `refreshTokens`     | رموز التحديث (JWT)              |

### 5.5 النسخ الاحتياطي لقاعدة البيانات

```bash
# نسخ احتياطي كامل
mysqldump -u root -p ais_aviation > backup_$(date +%Y%m%d_%H%M%S).sql

# نسخ احتياطي مع ضغط
mysqldump -u root -p ais_aviation | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz

# نسخ احتياطي لجدول محدد
mysqldump -u root -p ais_aviation bookings payments > bookings_payments_backup.sql

# نسخ احتياطي للبنية فقط (بدون بيانات)
mysqldump -u root -p --no-data ais_aviation > schema_backup.sql
```

### 5.6 استعادة قاعدة البيانات

```bash
# استعادة من ملف SQL
mysql -u root -p ais_aviation < backup_20260209_120000.sql

# استعادة من ملف مضغوط
gunzip < backup_20260209_120000.sql.gz | mysql -u root -p ais_aviation
```

### 5.7 صيانة قاعدة البيانات

```bash
# تحسين الجداول (بعد حذف كميات كبيرة من البيانات)
mysqlcheck -u root -p --optimize ais_aviation

# فحص سلامة الجداول
mysqlcheck -u root -p --check ais_aviation

# عرض حجم قاعدة البيانات
mysql -u root -p -e "
  SELECT table_name AS 'الجدول',
         ROUND(data_length/1024/1024, 2) AS 'حجم البيانات (MB)',
         ROUND(index_length/1024/1024, 2) AS 'حجم الفهارس (MB)',
         table_rows AS 'عدد الصفوف'
  FROM information_schema.tables
  WHERE table_schema = 'ais_aviation'
  ORDER BY data_length DESC;
"
```

---

## 6. المراقبة والصيانة (Monitoring & Maintenance)

### 6.1 فحوصات الصحة (Health Checks)

النظام يوفر ثلاثة مستويات من فحوصات الصحة عبر tRPC:

| النقطة         | النوع  | المصادقة  | الاستخدام                  |
| -------------- | ------ | --------- | -------------------------- |
| `health.check` | شامل   | Admin فقط | فحص تفصيلي لجميع المكونات  |
| `health.ready` | جاهزية | عام       | Kubernetes readiness probe |
| `health.live`  | حيوية  | عام       | Kubernetes liveness probe  |

```bash
# فحص الجاهزية (لا يحتاج مصادقة)
curl http://localhost:3000/api/trpc/health.ready

# فحص الحيوية
curl http://localhost:3000/api/trpc/health.live

# فحص صحة خدمة المصادقة
curl http://localhost:8000/auth/health
```

#### إعداد Kubernetes Probes

```yaml
livenessProbe:
  httpGet:
    path: /api/trpc/health.live
    port: 3000
  initialDelaySeconds: 40
  periodSeconds: 30

readinessProbe:
  httpGet:
    path: /api/trpc/health.ready
    port: 3000
  initialDelaySeconds: 40
  periodSeconds: 30
```

### 6.2 تتبع الأخطاء (Sentry)

النظام يدعم Sentry لتتبع الأخطاء في الخادم والواجهة الأمامية:

```bash
# الخادم (Node.js)
SENTRY_DSN=https://your-key@sentry.io/your-project-id
SENTRY_TRACES_SAMPLE_RATE=0.1    # 10% من الطلبات
SENTRY_PROFILES_SAMPLE_RATE=0.1  # 10% من العمليات

# الواجهة الأمامية (React)
VITE_SENTRY_DSN=https://your-key@sentry.io/your-project-id
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE=0.1
VITE_SENTRY_REPLAYS_ERROR_SAMPLE_RATE=1.0  # 100% عند حدوث خطأ
```

> **ملاحظة**: النظام يتحقق من صحة DSN قبل التهيئة ويتراجع بسلاسة إذا كان الرابط placeholder أو غير صالح. يمكن ترك المتغيرات معلقة (commented out) لتعطيل Sentry.

### 6.3 مستويات التسجيل (Logging)

النظام يستخدم `pino` للتسجيل المنظم:

```bash
# مستويات التسجيل المتاحة (من الأقل إلى الأكثر)
LOG_LEVEL=debug   # جميع الرسائل (للتطوير فقط)
LOG_LEVEL=info    # معلومات + تحذيرات + أخطاء (الافتراضي)
LOG_LEVEL=warn    # تحذيرات + أخطاء
LOG_LEVEL=error   # أخطاء فقط

# التنسيق
LOG_FORMAT=json    # JSON منظم (الافتراضي في الإنتاج)
LOG_FORMAT=pretty  # قابل للقراءة (الافتراضي في التطوير)

# التسجيل في ملف
LOG_FILE_PATH=./logs/app.log
```

### 6.4 مراقبة الاستعلامات البطيئة

```bash
# تفعيل مراقبة الاستعلامات البطيئة
SLOW_QUERY_THRESHOLD_MS=1000    # تسجيل الاستعلامات أبطأ من 1 ثانية
SLOW_QUERY_WARNING_MS=500       # تحذير للاستعلامات أبطأ من 500ms
MAX_SLOW_QUERIES=100            # الاحتفاظ بآخر 100 استعلام بطيء
SLOW_QUERY_LOGGING=true         # تفعيل التسجيل
```

### 6.5 مراقبة Redis

```bash
# الاتصال بـ Redis CLI
redis-cli

# عرض معلومات الذاكرة
redis-cli INFO memory

# عرض الإحصائيات
redis-cli INFO stats

# مراقبة الأوامر في الوقت الفعلي
redis-cli MONITOR

# عرض عدد المفاتيح
redis-cli DBSIZE

# عرض طوابير BullMQ
redis-cli KEYS "bull:*"
```

### 6.6 لوحة SLA Monitoring

الوصول: `/admin/sla`

تعرض لوحة مراقبة SLA:

- نسبة وقت التشغيل (Uptime percentage)
- متوسط زمن الاستجابة (Average response time)
- تتبع الأعطال وأوقات التوقف
- مؤشرات أداء الخدمة

---

## 7. إدارة المستخدمين (User Management)

### 7.1 أدوار المستخدمين

| الدور           | الوصف            | الصلاحيات                                         |
| --------------- | ---------------- | ------------------------------------------------- |
| `user`          | مستخدم عادي      | البحث، الحجز، الدفع، عرض الحجوزات                 |
| `admin`         | مسؤول            | جميع صلاحيات المستخدم + إدارة الرحلات والمستخدمين |
| `super_admin`   | مسؤول أعلى       | جميع الصلاحيات بما فيها إدارة المسؤولين           |
| `airline_admin` | مسؤول شركة طيران | إدارة رحلات شركة طيران محددة                      |
| `finance`       | الشؤون المالية   | الوصول للتقارير المالية والمحاسبة                 |
| `ops`           | العمليات         | إدارة العمليات التشغيلية والرحلات                 |
| `support`       | الدعم الفني      | الوصول لبيانات الحجوزات والمستخدمين للمساعدة      |

### 7.2 آلية المصادقة

تتم المصادقة عبر خدمة FastAPI مستقلة (microservice):

```
المستخدم → Node.js API → FastAPI Auth Service → MySQL
                ↓
           JWT Token (Access + Refresh)
```

**تسجيل مستخدم جديد:**

```
POST /auth/register
{
  "email": "user@example.com",
  "password": "StrongPassword123!",
  "name": "اسم المستخدم"
}
```

**تسجيل الدخول:**

```
POST /auth/login
{
  "email": "user@example.com",
  "password": "StrongPassword123!"
}
→ يُرجع: access_token + refresh_token
```

**التحقق من كلمة المرور (استخدام داخلي):**

```
POST /auth/verify-password
{
  "email": "user@example.com",
  "password": "StrongPassword123!"
}
```

### 7.3 المصادقة متعددة العوامل (MFA/TOTP)

النظام يدعم المصادقة الثنائية عبر TOTP (Time-based One-Time Password):

- تفعيل MFA من إعدادات الحساب
- مسح رمز QR باستخدام تطبيق مثل Google Authenticator أو Authy
- إدخال رمز التحقق عند كل تسجيل دخول
- إدارة MFA عبر router: `mfa`

### 7.4 إدارة الجلسات

```
auth.getActiveSessions  → عرض جميع الجلسات النشطة
auth.revokeSession      → إلغاء جلسة محددة
auth.logoutAllDevices   → إلغاء جميع الجلسات (تسجيل الخروج من كل الأجهزة)
```

### 7.5 تعيين مسؤول النظام

المتغير `OWNER_EMAIL` في ملف `.env` يحدد البريد الإلكتروني الذي يحصل تلقائياً على صلاحيات المسؤول عند التسجيل. يمكن أيضاً تعيين الأدوار عبر لوحة الإدارة (`/admin`).

---

## 8. الميزات الرئيسية وإدارتها (Core Features Management)

### 8.1 الميزات الأساسية (Core)

| الميزة                  | الوصف                            | واجهة الإدارة | Router          |
| ----------------------- | -------------------------------- | ------------- | --------------- |
| **إدارة الرحلات**       | البحث، الإضافة، التعديل، الإلغاء | `/admin`      | `flights`       |
| **نظام الحجز**          | إنشاء، تعديل، إلغاء الحجوزات     | `/admin`      | `bookings`      |
| **المدفوعات**           | معالجة الدفع عبر Stripe          | `/admin`      | `payments`      |
| **الاسترداد**           | معالجة طلبات الاسترداد           | `/admin`      | `refunds`       |
| **التذاكر الإلكترونية** | إصدار وإدارة التذاكر             | -             | `eticket`       |
| **برنامج الولاء**       | نقاط الأميال والمكافآت           | -             | `loyalty`       |
| **الخدمات الإضافية**    | أمتعة، وجبات، مقاعد              | -             | `ancillary`     |
| **التقييمات**           | تقييمات الرحلات                  | -             | `reviews`       |
| **الإشعارات**           | إشعارات المستخدمين               | -             | `notifications` |
| **التحليلات**           | تقارير وإحصائيات                 | `/admin`      | `analytics`     |

### 8.2 ميزات الحجز المتقدمة

| الميزة                   | الوصف                                     | واجهة الإدارة        | Router          |
| ------------------------ | ----------------------------------------- | -------------------- | --------------- |
| **حجوزات المجموعات**     | حجز لمجموعات كبيرة بأسعار خاصة            | `/group-booking`     | `groupBookings` |
| **قائمة الانتظار**       | الانضمام لقائمة الانتظار للرحلات الممتلئة | `/waitlist`          | `waitlist`      |
| **الدفع المقسم**         | تقسيم تكلفة الحجز بين عدة أشخاص           | `/pay-share/:token`  | `splitPayments` |
| **تقويم الأسعار**        | عرض الأسعار حسب التاريخ                   | -                    | `priceCalendar` |
| **تنبيهات الأسعار**      | إشعار عند انخفاض الأسعار                  | `/price-alerts`      | `priceAlerts`   |
| **قفل السعر**            | تجميد السعر مؤقتاً قبل الدفع              | -                    | `priceLock`     |
| **رحلات متعددة الوجهات** | حجز رحلات Multi-City                      | -                    | `multiCity`     |
| **إعادة الحجز**          | إعادة حجز من حجز سابق                     | `/rebook/:bookingId` | `rebooking`     |

### 8.3 إدارة الشركات والوكلاء

| الميزة                | الوصف                  | واجهة الإدارة | Router        |
| --------------------- | ---------------------- | ------------- | ------------- |
| **حسابات الشركات**    | إدارة حجوزات الأعمال   | `/corporate`  | `corporate`   |
| **بوابة وكلاء السفر** | بوابة حجز لوكلاء السفر | `/agent`      | `travelAgent` |

### 8.4 العمليات والتحكم في المغادرة

| الميزة                          | الوصف                             | واجهة الإدارة            | Router           |
| ------------------------------- | --------------------------------- | ------------------------ | ---------------- |
| **إدارة البوابات**              | تعريف وتعيين بوابات المطار        | `/admin/gates`           | `gates`          |
| **نظام التحكم بالمغادرة (DCS)** | إدارة عمليات المغادرة             | `/admin/dcs`             | `dcs`            |
| **مركز عمليات الطوارئ (IROPS)** | إدارة العمليات غير المنتظمة       | `/admin/irops`           | `irops`          |
| **تعيين الطاقم**                | جدولة وتعيين أطقم الطيران         | `/admin/crew-assignment` | `crew`           |
| **الوزن والتوازن**              | حسابات وزن وتوازن الطائرة         | `/admin/weight-balance`  | `weightBalance`  |
| **تخطيط الحمولة**               | تخطيط حمولة الركاب والبضائع       | `/admin/load-planning`   | `loadPlanning`   |
| **إدارة الاضطرابات**            | معالجة اضطرابات الرحلات تلقائياً  | -                        | `disruptions`    |
| **تتبع الرحلات**                | تتبع حالة الرحلات في الوقت الفعلي | -                        | `flightTracking` |

### 8.5 خدمات المسافرين في المطار

| الميزة                   | الوصف                         | واجهة الإدارة      | Router            |
| ------------------------ | ----------------------------- | ------------------ | ----------------- |
| **APIS**                 | نظام معلومات الركاب المسبقة   | `/admin/apis`      | `apis`            |
| **الصعود البيومتري**     | التعرف على الوجه للصعود       | `/admin/biometric` | `biometric`       |
| **أكشاك الخدمة الذاتية** | تسجيل الوصول عبر الأكشاك      | `/admin/kiosk`     | `kiosk`           |
| **تسليم الأمتعة الآلي**  | تسليم الأمتعة بالخدمة الذاتية | `/admin/bag-drop`  | `bagDrop`         |
| **إدارة الأمتعة**        | تتبع وإدارة الأمتعة           | -                  | `baggage`         |
| **الخدمات الخاصة**       | خدمات ذوي الاحتياجات الخاصة   | -                  | `specialServices` |

### 8.6 المالية والمحاسبة

| الميزة                    | الوصف                                | واجهة الإدارة               | Router              |
| ------------------------- | ------------------------------------ | --------------------------- | ------------------- |
| **القسائم والأرصدة**      | قسائم خصم وأرصدة المستخدمين          | `/admin/vouchers`           | `vouchers`          |
| **المحفظة**               | محفظة المستخدم الرقمية               | -                           | `wallet`            |
| **مجمع العائلة**          | مشاركة نقاط الولاء بين أفراد العائلة | -                           | `familyPool`        |
| **محاسبة الإيرادات**      | الاعتراف بالإيرادات وإعداد التقارير  | `/admin/revenue-accounting` | `revenueAccounting` |
| **تقارير BSP**            | تقارير تسوية IATA BSP                | `/admin/bsp-reporting`      | `bspReporting`      |
| **التعويضات (EU261/DOT)** | إدارة تعويضات الركاب التنظيمية       | `/admin/compensation`       | `compensation`      |
| **سجل المدفوعات**         | سجل تفصيلي لجميع المعاملات           | -                           | `paymentHistory`    |

### 8.7 خدمات الطوارئ والأولوية

| الميزة            | الوصف                            | واجهة الإدارة               | Router              |
| ----------------- | -------------------------------- | --------------------------- | ------------------- |
| **فنادق الطوارئ** | إقامة فندقية لاضطرابات IROPS     | `/admin/emergency-hotel`    | `emergencyHotel`    |
| **أولوية الركاب** | نظام تسجيل الأولوية لإعادة الحجز | `/admin/passenger-priority` | `passengerPriority` |

### 8.8 الذكاء الاصطناعي والتحليلات

| الميزة                   | الوصف                           | واجهة الإدارة           | Router          |
| ------------------------ | ------------------------------- | ----------------------- | --------------- |
| **الدردشة الذكية**       | مساعد حجز ذكي بالذكاء الاصطناعي | `/ai-chat`              | `aiChat`        |
| **التسعير الذكي**        | تحسين الأسعار بالذكاء الاصطناعي | -                       | `aiPricing`     |
| **مستودع البيانات / BI** | تحليلات ذكاء الأعمال            | `/admin/data-warehouse` | `dataWarehouse` |
| **التقارير**             | تقارير تشغيلية ومالية           | `/admin`                | `reports`       |
| **الاقتراحات الذكية**    | اقتراحات رحلات مخصصة            | -                       | `suggestions`   |

### 8.9 التوزيع ومعايير الصناعة (Phase 5)

| الميزة            | الوصف                                                        | Router      |
| ----------------- | ------------------------------------------------------------ | ----------- |
| **NDC**           | معيار التوزيع الجديد (IATA NDC)                              | `ndc`       |
| **GDS**           | التكامل مع أنظمة التوزيع العالمية                            | `gds`       |
| **Interline**     | اتفاقيات النقل المشترك بين شركات الطيران                     | `interline` |
| **Codeshare**     | رحلات مشتركة بين شركات الطيران                               | `codeshare` |
| **قواعد الأسعار** | محرك قواعد الأسعار المتقدم                                   | `fareRules` |
| **خريطة المقاعد** | عرض وإدارة خريطة مقاعد الطائرة                               | `seatMap`   |
| **EMD**           | مستندات متنوعة إلكترونية (Electronic Miscellaneous Document) | `emd`       |
| **إدارة المخزون** | إدارة مخزون المقاعد                                          | `inventory` |

### 8.10 البنية التحتية والأمان

| الميزة                   | الوصف                          | واجهة الإدارة              | Router             |
| ------------------------ | ------------------------------ | -------------------------- | ------------------ |
| **مراقبة SLA**           | تتبع اتفاقيات مستوى الخدمة     | `/admin/sla`               | `sla`              |
| **التعافي من الكوارث**   | خطط استمرارية الأعمال          | `/admin/disaster-recovery` | `disasterRecovery` |
| **المناطق المتعددة**     | إعدادات النشر متعدد المناطق    | -                          | `multiRegion`      |
| **الموافقة على الكوكيز** | إدارة موافقة GDPR/CCPA         | -                          | `consent`          |
| **GDPR**                 | أدوات الامتثال لحماية البيانات | -                          | `gdpr`             |
| **MFA**                  | المصادقة متعددة العوامل        | -                          | `mfa`              |
| **الأمان**               | إدارة الأمان وتدقيق الوصول     | -                          | `security`         |
| **تحديد المعدل**         | التحكم بمعدل الطلبات           | -                          | `rateLimit`        |
| **المقاييس**             | مقاييس أداء النظام             | -                          | `metrics`          |
| **التخزين المؤقت**       | إدارة التخزين المؤقت           | -                          | `cache`            |

### 8.11 سيناريوهات السفر

| الميزة                  | الوصف                                          | Router            |
| ----------------------- | ---------------------------------------------- | ----------------- |
| **سيناريوهات السفر**    | حسابات البصمة الكربونية والتحقق من وثائق السفر | `travelScenarios` |
| **تفضيلات المستخدم**    | حفظ تفضيلات البحث والمقاعد                     | `userPreferences` |
| **المسافرون المحفوظون** | حفظ بيانات المسافرين المتكررين                 | `savedPassengers` |
| **المفضلة**             | حفظ الرحلات المفضلة                            | `favorites`       |

---

## 9. استكشاف الأخطاء وإصلاحها (Troubleshooting)

### 9.1 أخطاء الاتصال بقاعدة البيانات

**المشكلة**: `Error: Database not available` أو `ECONNREFUSED`

**الحلول**:

```bash
# 1. تأكد من أن MySQL يعمل
docker-compose ps mysql
# أو
sudo systemctl status mysql

# 2. تحقق من رابط الاتصال في .env
# DATABASE_URL=mysql://user:password@host:3306/database

# 3. اختبر الاتصال يدوياً
mysql -u ais_dev -p -h localhost -P 3306 ais_aviation_dev

# 4. تحقق من أن المنفذ 3306 مفتوح
netstat -tlnp | grep 3306

# 5. إذا كنت تستخدم Docker، تأكد من صحة اسم المضيف
# في Docker: host = اسم الخدمة (مثل "mysql")
# محلياً: host = localhost أو 127.0.0.1
```

### 9.2 خدمة المصادقة لا تستجيب

**المشكلة**: `ECONNREFUSED` عند الاتصال بـ `localhost:8000`

**الحلول**:

```bash
# 1. تحقق من حالة الخدمة
curl http://localhost:8000/auth/health

# 2. إذا كانت الخدمة في Docker
docker-compose logs auth-service

# 3. تشغيل الخدمة يدوياً للتشخيص
cd auth-service
uvicorn main:app --host 0.0.0.0 --port 8000 --log-level debug

# 4. تأكد من أن Python و pip مثبتان
python --version
pip list | grep fastapi

# 5. أعد تثبيت التبعيات
pip install -r requirements.txt

# 6. تحقق من أن DATABASE_URL صحيح في بيئة Auth Service
# يستخدم تنسيق SQLAlchemy: mysql+pymysql://user:pass@host:3306/db
```

### 9.3 أخطاء Stripe Webhooks

**المشكلة**: `Webhook signature verification failed`

**الحلول**:

```bash
# 1. تحقق من STRIPE_WEBHOOK_SECRET في .env
# يجب أن يبدأ بـ whsec_

# 2. للاختبار المحلي، استخدم Stripe CLI
stripe listen --forward-to localhost:3000/api/stripe/webhook
# انسخ الـ webhook signing secret المعروض

# 3. في بيئة الإنتاج
# - تأكد من تسجيل عنوان Webhook في لوحة Stripe Dashboard
# - العنوان: https://your-domain.com/api/stripe/webhook
# - اختر الأحداث: checkout.session.completed, payment_intent.succeeded, إلخ

# 4. اختبر Webhook يدوياً
stripe trigger checkout.session.completed
```

### 9.4 أخطاء البناء (Build Failures)

**المشكلة**: فشل `pnpm build`

**الحلول**:

```bash
# 1. تحقق من أخطاء TypeScript
pnpm check

# 2. تحقق من ESLint
pnpm lint

# 3. نظف التثبيت وأعد المحاولة
rm -rf node_modules
pnpm install
pnpm build

# 4. إذا كان الخطأ متعلقاً بـ esbuild
# تأكد من أن المكتبات المستوردة ديناميكياً تستخدم await import()
# وليس static imports (خاصة trpc-openapi)

# 5. تحقق من إصدار Node.js
node --version  # يجب أن يكون 22+
```

### 9.5 أخطاء TypeScript بعد تغيير المخطط

**المشكلة**: أخطاء أنواع بعد تعديل `drizzle/schema.ts`

**الحلول**:

```bash
# 1. أنشئ أنواع جديدة من المخطط
pnpm db:generate

# 2. تحقق من الأنواع
pnpm check

# 3. أعد تشغيل TypeScript Language Server في المحرر
# في VS Code: Ctrl+Shift+P → "TypeScript: Restart TS Server"
```

### 9.6 مشاكل Redis

**المشكلة**: `ECONNREFUSED` عند الاتصال بـ Redis

```bash
# 1. تحقق من حالة Redis
redis-cli ping  # يجب أن يرد: PONG

# 2. إذا كنت تستخدم Docker
docker-compose logs redis

# 3. تحقق من استخدام الذاكرة
redis-cli INFO memory | grep used_memory_human

# 4. مسح التخزين المؤقت (عند الضرورة فقط)
redis-cli FLUSHDB
```

### 9.7 مشاكل CORS

**المشكلة**: `Access-Control-Allow-Origin` errors

```bash
# تأكد من تطابق المتغيرات التالية:
# FRONTEND_URL=http://localhost:3000
# CORS_ORIGINS=http://localhost:3000 (في Auth Service)
# VITE_APP_URL=http://localhost:3000
```

### 9.8 مشاكل Docker

```bash
# عرض سجلات جميع الخدمات
docker-compose logs -f

# عرض سجلات خدمة محددة
docker-compose logs -f api1

# إعادة بناء الحاويات
docker-compose build --no-cache

# إعادة تشغيل خدمة محددة
docker-compose restart auth-service

# حذف جميع الحاويات والبيانات (تحذير: يحذف البيانات!)
docker-compose down -v
```

---

## 10. النسخ الاحتياطي والاسترداد (Backup & Recovery)

### 10.1 استراتيجية النسخ الاحتياطي

| المكون                   | التكرار     | النوع               | الاحتفاظ   |
| ------------------------ | ----------- | ------------------- | ---------- |
| **قاعدة البيانات MySQL** | يومي        | كامل (Full Dump)    | 30 يوم     |
| **قاعدة البيانات MySQL** | كل 6 ساعات  | تزايدي (Binary Log) | 7 أيام     |
| **Redis**                | مستمر       | AOF + RDB snapshots | حسب الحاجة |
| **ملفات التطبيق**        | عند النشر   | Git tag             | دائم       |
| **ملف .env**             | عند التعديل | نسخة مشفرة          | دائم       |
| **شهادات SSL**           | عند التجديد | نسخة مشفرة          | دائم       |

### 10.2 نسخ احتياطي تلقائي لـ MySQL

أنشئ cron job للنسخ الاحتياطي اليومي:

```bash
# إضافة مهمة مجدولة
crontab -e

# نسخ احتياطي يومي في الساعة 2:00 صباحاً
0 2 * * * /usr/bin/mysqldump -u root -p'password' ais_aviation | gzip > /backups/ais_$(date +\%Y\%m\%d).sql.gz

# حذف النسخ الأقدم من 30 يوم
0 3 * * * find /backups -name "ais_*.sql.gz" -mtime +30 -delete
```

#### في بيئة Docker:

```bash
# النسخ الاحتياطي (مجلد backups/ مربوط تلقائياً في docker-compose.production.yml)
docker exec ais_mysql mysqldump -u root -p"${DB_ROOT_PASSWORD}" ${DB_NAME} | gzip > /backups/ais_$(date +%Y%m%d_%H%M%S).sql.gz
```

### 10.3 استمرار بيانات Redis

إعدادات Redis في بيئة الإنتاج (مضبوطة في `docker-compose.production.yml`):

```
# نقاط حفظ RDB (Snapshot)
save 900 1      # حفظ إذا تغير مفتاح واحد خلال 15 دقيقة
save 300 10     # حفظ إذا تغيرت 10 مفاتيح خلال 5 دقائق
save 60 10000   # حفظ إذا تغيرت 10,000 مفتاح خلال دقيقة

# AOF (Append Only File)
appendonly yes          # تفعيل AOF
appendfsync everysec    # مزامنة كل ثانية
```

### 10.4 إجراءات الاستعادة

#### استعادة قاعدة البيانات

```bash
# 1. إيقاف التطبيق
docker-compose stop api1 api2 api3 worker

# 2. استعادة النسخة الاحتياطية
gunzip < /backups/ais_20260209.sql.gz | mysql -u root -p ais_aviation

# 3. إعادة تشغيل التطبيق
docker-compose start api1 api2 api3 worker
```

#### استعادة Redis

```bash
# 1. إيقاف Redis
docker-compose stop redis

# 2. نسخ ملف dump.rdb أو appendonly.aof
cp /backup/dump.rdb /var/lib/redis/dump.rdb

# 3. إعادة تشغيل Redis
docker-compose start redis
```

### 10.5 لوحة التعافي من الكوارث

الوصول: `/admin/disaster-recovery`

توفر لوحة التعافي من الكوارث:

- حالة جميع مكونات النظام
- إجراءات التعافي المحددة مسبقاً
- خطط استمرارية الأعمال (BCP)
- اختبار إجراءات التعافي
- تقارير RTO (Recovery Time Objective) و RPO (Recovery Point Objective)

### 10.6 خطة التعافي من الكوارث (DR Plan)

| السيناريو           | RTO المستهدف | RPO المستهدف | الإجراء                                 |
| ------------------- | ------------ | ------------ | --------------------------------------- |
| تعطل خادم API واحد  | < 30 ثانية   | 0            | موازن الأحمال يوجه تلقائياً لخوادم أخرى |
| تعطل قاعدة البيانات | < 15 دقيقة   | < 6 ساعات    | استعادة من آخر نسخة احتياطية            |
| تعطل Redis          | < 5 دقائق    | < 1 ثانية    | إعادة تشغيل مع استعادة AOF              |
| تعطل كامل للموقع    | < 1 ساعة     | < 6 ساعات    | تفعيل DR site / إعادة النشر             |

---

## 11. أوامر مرجعية سريعة (Quick Reference Commands)

### 11.1 أوامر pnpm

| الأمر                  | الوصف                                                 |
| ---------------------- | ----------------------------------------------------- |
| `pnpm install`         | تثبيت جميع التبعيات                                   |
| `pnpm dev`             | تشغيل خادم التطوير (port 3000، مع hot-reload)         |
| `pnpm build`           | بناء التطبيق للإنتاج (dist/index.js + dist/worker.js) |
| `pnpm start`           | تشغيل خادم الإنتاج                                    |
| `pnpm check`           | فحص أنواع TypeScript                                  |
| `pnpm lint`            | فحص أسلوب الكود (ESLint)                              |
| `pnpm lint:fix`        | إصلاح مشاكل ESLint تلقائياً                           |
| `pnpm format`          | تنسيق الكود (Prettier)                                |
| `pnpm test`            | تشغيل جميع الاختبارات (Vitest)                        |
| `pnpm test <file>`     | تشغيل ملف اختبار محدد                                 |
| `pnpm test:watch`      | تشغيل الاختبارات مع المراقبة المستمرة                 |
| `pnpm test:coverage`   | تشغيل الاختبارات مع تقرير التغطية                     |
| `pnpm test:e2e`        | تشغيل اختبارات E2E (Playwright)                       |
| `pnpm test:e2e:ui`     | تشغيل E2E مع واجهة بصرية                              |
| `pnpm test:e2e:headed` | تشغيل E2E في متصفح مرئي                               |
| `pnpm db:push`         | تطبيق المخطط على قاعدة البيانات مباشرة                |
| `pnpm db:generate`     | إنشاء ملفات Migration                                 |
| `pnpm db:migrate`      | تطبيق Migrations المعلقة                              |
| `pnpm db:studio`       | فتح Drizzle Studio لتفقد البيانات                     |
| `pnpm workers`         | تشغيل عمال الطوابير (BullMQ)                          |
| `pnpm reconcile`       | تشغيل مهمة المطابقة المالية                           |
| `pnpm docs:generate`   | إنشاء وثائق OpenAPI                                   |
| `pnpm typecheck`       | فحص TypeScript (بديل لـ pnpm check)                   |
| `pnpm analyze`         | تحليل حجم حزم JavaScript                              |

### 11.2 أوامر Docker

| الأمر                                                   | الوصف                                                   |
| ------------------------------------------------------- | ------------------------------------------------------- |
| `docker-compose up -d`                                  | تشغيل خدمات التطوير (MySQL + Redis + phpMyAdmin + Auth) |
| `docker-compose down`                                   | إيقاف جميع الخدمات                                      |
| `docker-compose down -v`                                | إيقاف الخدمات وحذف البيانات                             |
| `docker-compose ps`                                     | عرض حالة الحاويات                                       |
| `docker-compose logs -f`                                | عرض السجلات في الوقت الفعلي                             |
| `docker-compose logs -f <service>`                      | عرض سجلات خدمة محددة                                    |
| `docker-compose restart <service>`                      | إعادة تشغيل خدمة                                        |
| `docker-compose build --no-cache`                       | إعادة بناء الحاويات                                     |
| `docker-compose -f docker-compose.prod.yml up -d`       | تشغيل بيئة الإنتاج المبسطة                              |
| `docker-compose -f docker-compose.production.yml up -d` | تشغيل بيئة الإنتاج الكاملة                              |

### 11.3 أوامر قاعدة البيانات

| الأمر                                            | الوصف                    |
| ------------------------------------------------ | ------------------------ |
| `mysql -u root -p ais_aviation`                  | الاتصال بقاعدة البيانات  |
| `mysqldump -u root -p ais_aviation > backup.sql` | نسخ احتياطي كامل         |
| `mysql -u root -p ais_aviation < backup.sql`     | استعادة من نسخة احتياطية |
| `mysqlcheck -u root -p --optimize ais_aviation`  | تحسين الجداول            |
| `mysqlcheck -u root -p --check ais_aviation`     | فحص سلامة الجداول        |

### 11.4 أوامر Redis

| الأمر                     | الوصف                          |
| ------------------------- | ------------------------------ |
| `redis-cli ping`          | اختبار اتصال Redis             |
| `redis-cli INFO memory`   | عرض استخدام الذاكرة            |
| `redis-cli INFO stats`    | عرض إحصائيات Redis             |
| `redis-cli DBSIZE`        | عرض عدد المفاتيح               |
| `redis-cli KEYS "bull:*"` | عرض طوابير BullMQ              |
| `redis-cli MONITOR`       | مراقبة الأوامر في الوقت الفعلي |
| `redis-cli FLUSHDB`       | مسح جميع البيانات (تحذير!)     |

### 11.5 أوامر خدمة المصادقة

| الأمر                                         | الوصف                               |
| --------------------------------------------- | ----------------------------------- |
| `uvicorn main:app --host 0.0.0.0 --port 8000` | تشغيل الخدمة                        |
| `uvicorn main:app --reload`                   | تشغيل مع إعادة تحميل تلقائي (تطوير) |
| `uvicorn main:app --workers 4`                | تشغيل مع 4 عمال (إنتاج)             |
| `curl http://localhost:8000/auth/health`      | فحص صحة الخدمة                      |
| `curl http://localhost:8000/docs`             | عرض وثائق API (Swagger UI)          |

### 11.6 أوامر Stripe CLI

| الأمر                                                          | الوصف                 |
| -------------------------------------------------------------- | --------------------- |
| `stripe listen --forward-to localhost:3000/api/stripe/webhook` | توجيه Webhooks محلياً |
| `stripe trigger checkout.session.completed`                    | اختبار حدث Checkout   |
| `stripe trigger payment_intent.succeeded`                      | اختبار حدث دفع ناجح   |
| `stripe logs tail`                                             | عرض سجلات Stripe      |

---

## الملحق: مخطط الهيكل العام للنظام

```
                                    ┌─────────────┐
                                    │   Nginx     │
                                    │  (Port 80/  │
                                    │   443)      │
                                    └──────┬──────┘
                                           │
                         ┌─────────────────┼─────────────────┐
                         │                 │                 │
                   ┌─────┴─────┐     ┌─────┴─────┐    ┌─────┴─────┐
                   │  API #1   │     │  API #2   │    │  API #3   │
                   │ (Port     │     │ (Port     │    │ (Port     │
                   │  3000)    │     │  3000)    │    │  3000)    │
                   └─────┬─────┘     └─────┬─────┘    └─────┬─────┘
                         │                 │                 │
                         └────────┬────────┴────────┬────────┘
                                  │                 │
                           ┌──────┴──────┐   ┌──────┴──────┐
                           │   MySQL     │   │   Redis     │
                           │ (Port 3306) │   │ (Port 6379) │
                           └──────┬──────┘   └──────┬──────┘
                                  │                 │
                           ┌──────┴──────┐   ┌──────┴──────┐
                           │ Auth Service│   │   Worker    │
                           │ (Port 8000) │   │ (BullMQ)   │
                           └─────────────┘   └─────────────┘
```

---

> **ملاحظة للفريق**: هذا الدليل يغطي الإصدار 4.0 من النظام (فبراير 2026) مع 71 جدولاً في قاعدة البيانات و 80+ مسار API. للمزيد من التفاصيل التقنية، راجع:
>
> - [دليل المطور](DEVELOPER_GUIDE.md)
> - [توثيق الهيكل](ARCHITECTURE.md)
> - [توثيق API](API_DOCUMENTATION.md)
> - [دليل الأمان](SECURITY.md)
> - [دليل استكشاف الأخطاء](TROUBLESHOOTING.md)
