# دليل النشر لنظام الطيران المتكامل (AIS)

**الإصدار:** 1.0  
**تاريخ التحديث:** 23 نوفمبر 2025  
**المؤلف:** Manus AI

---

## 1. نظرة عامة

هذا الدليل يوفر إرشادات مفصلة لنشر نظام الطيران المتكامل (AIS) في بيئة الإنتاج. يفترض الدليل أن لديك فهمًا أساسيًا لـ Docker، Docker Compose، و Nginx.

## 2. متطلبات بيئة الإنتاج

- **نظام التشغيل:** Linux (Ubuntu 22.04 أو أحدث موصى به)
- **Docker:** أحدث إصدار
- **Docker Compose:** أحدث إصدار
- **Nginx:** لتكوين Reverse Proxy و SSL
- **قاعدة بيانات:** MySQL أو TiDB (يمكن تشغيلها كحاوية Docker أو على خادم منفصل)
- **اسم نطاق (Domain Name):** موجه إلى عنوان IP الخاص بالخادم.

## 3. إعداد البيئة

### 3.1 تثبيت Docker و Docker Compose

اتبع التعليمات الرسمية لتثبيت Docker و Docker Compose على الخادم الخاص بك.

### 3.2 إعداد قاعدة البيانات

- **موصى به:** استخدم قاعدة بيانات مُدارة (Managed Database) مثل Amazon RDS أو Google Cloud SQL لضمان الموثوقية والنسخ الاحتياطي.
- **بديل:** يمكنك تشغيل قاعدة بيانات MySQL في حاوية Docker باستخدام ملف `docker-compose.prod.yml` المرفق.

### 3.3 إعداد متغيرات البيئة

1. انسخ ملف `.env.example` إلى `.env.prod`:

   ```bash
   cp .env.example .env.prod
   ```

2. قم بتحرير ملف `.env.prod` وتعبئة جميع المتغيرات المطلوبة:
   - `DATABASE_URL`: رابط الاتصال بقاعدة البيانات.
   - `STRIPE_SECRET_KEY`: مفتاح Stripe السري.
   - `STRIPE_WEBHOOK_SECRET`: سر Webhook الخاص بـ Stripe.
   - `JWT_SECRET`: مفتاح سري لتوقيع JWT.
   - `OWNER_OPENID`: معرف OpenID الخاص بالمسؤول.
   - `NODE_ENV`: يجب أن تكون `production`.

## 4. بناء وتشغيل التطبيق باستخدام Docker

### 4.1 ملفات Docker للإنتاج

- **`Dockerfile.prod`:** ملف Docker مخصص لبناء صورة الإنتاج.
- **`docker-compose.prod.yml`:** ملف Compose لتشغيل خدمات الإنتاج (التطبيق وقاعدة البيانات).

### 4.2 خطوات التشغيل

1. **بناء وتشغيل الحاويات:**

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod up --build -d
   ```

   - `-f docker-compose.prod.yml`: يحدد ملف Compose الخاص بالإنتاج.
   - `--env-file .env.prod`: يحدد ملف متغيرات البيئة للإنتاج.
   - `--build`: يقوم ببناء الصور من جديد.
   - `-d`: يعمل في الخلفية.

2. **تطبيق Migrations (إذا لزم الأمر):**

   ```bash
   docker compose -f docker-compose.prod.yml exec app pnpm db:push
   ```

3. **التحقق من حالة الحاويات:**
   ```bash
   docker compose -f docker-compose.prod.yml ps
   ```
   يجب أن تكون جميع الخدمات في حالة `running`.

## 5. إعداد Nginx كـ Reverse Proxy

### 5.1 تثبيت Nginx

```bash
sudo apt update
sudo apt install nginx
```

### 5.2 إعداد SSL/TLS (موصى به)

استخدم Certbot لتثبيت شهادة SSL مجانية من Let's Encrypt.

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 5.3 تكوين Nginx

1. قم بإنشاء ملف تكوين جديد في `/etc/nginx/sites-available/ais`:

   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       # Redirect HTTP to HTTPS
       return 301 https://$host$request_uri;
   }

   server {
       listen 443 ssl http2;
       server_name your-domain.com;

       ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

       # Security headers
       add_header X-Frame-Options "SAMEORIGIN";
       add_header X-Content-Type-Options "nosniff";
       add_header Referrer-Policy "strict-origin-when-cross-origin";

       location / {
           proxy_pass http://localhost:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
       }

       # Increase max body size for file uploads
       client_max_body_size 10M;
   }
   ```

2. قم بتفعيل الموقع:

   ```bash
   sudo ln -s /etc/nginx/sites-available/ais /etc/nginx/sites-enabled/
   ```

3. اختبر التكوين وأعد تشغيل Nginx:
   ```bash
   sudo nginx -t
   sudo systemctl restart nginx
   ```

## 6. المراقبة والصيانة

### 6.1 السجلات (Logs)

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

### 6.2 النسخ الاحتياطي

- **قاعدة البيانات:** قم بإعداد نسخ احتياطي دوري لقاعدة البيانات. إذا كنت تستخدم قاعدة بيانات مُدارة، فسيتم التعامل مع هذا تلقائيًا.
- **الملفات المرفوعة:** إذا كان النظام يدعم رفع الملفات، فقم بنسخ المجلدات احتياطيًا بانتظام.

### 6.3 التحديثات

لتحديث التطبيق إلى إصدار جديد:

1. **سحب آخر التغييرات:**

   ```bash
   git pull origin main
   ```

2. **إعادة بناء وتشغيل الحاويات:**

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod up --build -d
   ```

3. **تطبيق أي Migrations جديدة:**
   ```bash
   docker compose -f docker-compose.prod.yml exec app pnpm db:push
   ```

---

**نهاية الدليل**
