# دليل الإعداد التفصيلي - Setup Guide

## 🚀 مرحباً بك في دليل الإعداد

هذا الدليل سيساعدك على إعداد بيئة التطوير الكاملة لنظام الطيران المتكامل خطوة بخطوة.

---

## 📋 جدول المحتويات

1. [المتطلبات الأساسية](#المتطلبات-الأساسية)
2. [تثبيت الأدوات](#تثبيت-الأدوات)
3. [استنساخ المشروع](#استنساخ-المشروع)
4. [إعداد قاعدة البيانات](#إعداد-قاعدة-البيانات)
5. [إعداد متغيرات البيئة](#إعداد-متغيرات-البيئة)
6. [تثبيت الحزم](#تثبيت-الحزم)
7. [تشغيل المشروع](#تشغيل-المشروع)
8. [التحقق من التثبيت](#التحقق-من-التثبيت)
9. [المشاكل الشائعة](#المشاكل-الشائعة)

---

## 💻 المتطلبات الأساسية

### 1. نظام التشغيل

يعمل النظام على:
- ✅ **macOS** (Intel أو Apple Silicon)
- ✅ **Linux** (Ubuntu 20.04+, Debian 10+, Fedora, etc.)
- ✅ **Windows** (10/11 مع WSL2 يُنصح به)

### 2. متطلبات الأجهزة

**الحد الأدنى**:
- CPU: 2 cores
- RAM: 4 GB
- Storage: 10 GB

**الموصى به**:
- CPU: 4+ cores
- RAM: 8+ GB
- Storage: 20+ GB SSD

### 3. البرامج المطلوبة

قبل البدء، تأكد من تثبيت:

- **Node.js** 22+ ([تحميل](https://nodejs.org/))
- **pnpm** ([تحميل](https://pnpm.io/installation))
- **Git** ([تحميل](https://git-scm.com/downloads))
- **MySQL** 8.0+ أو **TiDB** ([تحميل](https://www.mysql.com/downloads/))

**اختياري** (لكن يُنصح به):
- **Docker** & **Docker Compose** ([تحميل](https://www.docker.com/))
- **VSCode** أو محرر نصوص آخر ([تحميل](https://code.visualstudio.com/))

---

## 🛠️ تثبيت الأدوات

### تثبيت Node.js

#### macOS (باستخدام Homebrew)

```bash
# تثبيت Homebrew إذا لم يكن مثبتاً
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# تثبيت Node.js
brew install node@22
```

#### Linux (Ubuntu/Debian)

```bash
# تحديث النظام
sudo apt update && sudo apt upgrade -y

# تثبيت Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### Windows

```powershell
# تحميل وتثبيت من الموقع الرسمي
# https://nodejs.org/en/download/

# أو باستخدام Chocolatey
choco install nodejs-lts
```

#### التحقق من التثبيت

```bash
node --version  # يجب أن يظهر v22.x.x
npm --version   # يجب أن يظهر 10.x.x
```

---

### تثبيت pnpm

```bash
# باستخدام npm
npm install -g pnpm

# أو باستخدام curl (macOS/Linux)
curl -fsSL https://get.pnpm.io/install.sh | sh -

# التحقق من التثبيت
pnpm --version  # يجب أن يظهر 10.x.x
```

---

### تثبيت MySQL

#### macOS

```bash
# باستخدام Homebrew
brew install mysql@8.0

# تشغيل MySQL
brew services start mysql@8.0

# تأمين التثبيت
mysql_secure_installation
```

#### Linux (Ubuntu/Debian)

```bash
# تثبيت MySQL
sudo apt install mysql-server

# تشغيل MySQL
sudo systemctl start mysql
sudo systemctl enable mysql

# تأمين التثبيت
sudo mysql_secure_installation
```

#### Windows

```powershell
# تحميل MySQL Installer
# https://dev.mysql.com/downloads/installer/

# أو باستخدام Chocolatey
choco install mysql
```

#### استخدام Docker (الأسهل)

```bash
# تشغيل MySQL في حاوية Docker
docker run --name ais-mysql \
  -e MYSQL_ROOT_PASSWORD=password \
  -e MYSQL_DATABASE=ais_aviation \
  -p 3306:3306 \
  -d mysql:8.0

# التحقق من أن MySQL يعمل
docker ps | grep ais-mysql
```

---

## 📥 استنساخ المشروع

### 1. استنساخ المستودع

```bash
# استنساخ المشروع
git clone https://github.com/kafaat/ais-aviation-system.git

# الانتقال إلى مجلد المشروع
cd ais-aviation-system
```

### 2. فحص الملفات

```bash
# عرض الملفات
ls -la

# يجب أن ترى:
# - package.json
# - pnpm-lock.yaml
# - .env.example
# - README.md
# - client/
# - server/
# - docs/
```

---

## 🗄️ إعداد قاعدة البيانات

### 1. إنشاء قاعدة البيانات

```bash
# تسجيل الدخول إلى MySQL
mysql -u root -p

# في MySQL shell:
CREATE DATABASE ais_aviation CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# إنشاء مستخدم (اختياري)
CREATE USER 'ais_user'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON ais_aviation.* TO 'ais_user'@'localhost';
FLUSH PRIVILEGES;

# الخروج
EXIT;
```

### 2. اختبار الاتصال

```bash
# اختبر الاتصال بقاعدة البيانات
mysql -u ais_user -p ais_aviation

# إذا نجح، أنت جاهز!
```

---

## ⚙️ إعداد متغيرات البيئة

### 1. نسخ ملف البيئة

```bash
# نسخ ملف .env.example إلى .env
cp .env.example .env
```

### 2. تحرير ملف .env

```bash
# فتح الملف في محرر نصوص
nano .env
# أو
code .env
# أو
vim .env
```

### 3. تحديث المتغيرات

```env
# ========================================
# App Configuration
# ========================================
VITE_APP_ID=ais-aviation-system
NODE_ENV=development

# ========================================
# Database Configuration
# ========================================
# قم بتحديث البيانات حسب إعداداتك
DATABASE_URL=mysql://ais_user:your_password@localhost:3306/ais_aviation

# ========================================
# Authentication & Security
# ========================================
# أنشئ مفتاح عشوائي قوي (32 حرف على الأقل)
JWT_SECRET=your-super-secret-jwt-key-min-32-chars-change-this
CSRF_SECRET=your-csrf-secret-min-32-chars-change-this

# OAuth Configuration
OAUTH_SERVER_URL=https://oauth.manus.space

# Admin user (لمنح صلاحيات الإدارة)
OWNER_OPEN_ID=your-manus-open-id

# ========================================
# Stripe Payment (للإنتاج)
# ========================================
# احصل على المفاتيح من https://dashboard.stripe.com/apikeys
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_publishable_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# ========================================
# Optional Features
# ========================================
# OpenAI (للميزات المدعومة بـ AI)
OPENAI_API_KEY=sk-your-openai-api-key

# AWS S3 (لتخزين الملفات)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_S3_BUCKET=ais-aviation-files

# ========================================
# Email Service (للإشعارات)
# ========================================
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM=noreply@ais-aviation.com
```

### 4. توليد مفاتيح سرية آمنة

```bash
# استخدم Node.js لتوليد مفاتيح عشوائية
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# انسخ النتيجة واستخدمها في JWT_SECRET و CSRF_SECRET
```

---

## 📦 تثبيت الحزم

### 1. تثبيت dependencies

```bash
# تثبيت جميع الحزم
pnpm install

# قد يستغرق هذا 2-5 دقائق حسب سرعة الإنترنت
```

### 2. التحقق من التثبيت

```bash
# التحقق من أن node_modules تم إنشاؤها
ls -la node_modules

# التحقق من أن الحزم الرئيسية مثبتة
pnpm list react
pnpm list express
pnpm list drizzle-orm
```

---

## 🔄 إعداد قاعدة البيانات (Migrations)

### 1. تطبيق Database Schema

```bash
# تطبيق schema على قاعدة البيانات
pnpm db:push

# يجب أن ترى:
# ✓ Schema applied successfully
```

### 2. إضافة بيانات تجريبية

```bash
# تشغيل seed script لإضافة بيانات تجريبية
npx tsx scripts/seed-data.mjs

# سيتم إضافة:
# - شركات طيران
# - مطارات
# - رحلات
# - مستخدمين تجريبيين
```

### 3. التحقق من البيانات

```bash
# الاتصال بقاعدة البيانات
mysql -u ais_user -p ais_aviation

# في MySQL shell:
SHOW TABLES;  # يجب أن ترى الجداول

SELECT COUNT(*) FROM flights;  # يجب أن ترى رحلات
SELECT COUNT(*) FROM airlines;  # يجب أن ترى شركات طيران

EXIT;
```

---

## 🚀 تشغيل المشروع

### 1. وضع التطوير (Development)

```bash
# تشغيل المشروع في وضع التطوير
pnpm dev

# سترى:
# ✓ Server running on http://localhost:3000
# ✓ Frontend ready
```

### 2. فتح المتصفح

```bash
# افتح المتصفح على
http://localhost:3000

# يجب أن ترى الصفحة الرئيسية
```

### 3. تسجيل الدخول

1. انقر على **"تسجيل الدخول"**
2. سجّل الدخول باستخدام **Manus OAuth**
3. بعد تسجيل الدخول، يمكنك استخدام النظام

---

## ✅ التحقق من التثبيت

### 1. اختبار Frontend

- ✅ الصفحة الرئيسية تعمل
- ✅ يمكنك البحث عن رحلات
- ✅ تظهر نتائج البحث
- ✅ يمكنك النقر على الرحلات

### 2. اختبار Backend

```bash
# في نافذة terminal أخرى
curl http://localhost:3000/api/health

# يجب أن ترى:
# {"status":"ok","database":"connected"}
```

### 3. تشغيل الاختبارات

```bash
# تشغيل جميع الاختبارات
pnpm test

# يجب أن تنجح جميع الاختبارات
# ✓ 70+ tests passed
```

### 4. فحص الأنواع (TypeScript)

```bash
# التحقق من عدم وجود أخطاء في الأنواع
pnpm check

# يجب أن ترى:
# ✓ No TypeScript errors
```

---

## 🛠️ أدوات التطوير (اختياري)

### 1. Drizzle Studio (لإدارة قاعدة البيانات)

```bash
# فتح Drizzle Studio
pnpm db:studio

# سيفتح على http://localhost:4983
# يمكنك عرض وتعديل البيانات بصرياً
```

### 2. تثبيت VSCode Extensions

إذا كنت تستخدم VSCode، ثبت:

- **ESLint**: للكشف عن الأخطاء
- **Prettier**: لتنسيق الكود
- **Tailwind CSS IntelliSense**: لدعم Tailwind
- **TypeScript Vue Plugin**: لدعم TypeScript أفضل

```bash
# في VSCode:
# Ctrl/Cmd + Shift + X
# ثم ابحث عن كل extension وثبته
```

---

## 🐛 المشاكل الشائعة

### المشكلة 1: "Cannot connect to database"

**الحل**:

```bash
# 1. تحقق من أن MySQL يعمل
mysql -u root -p

# 2. تحقق من DATABASE_URL في .env
echo $DATABASE_URL  # يجب أن يكون صحيحاً

# 3. تحقق من أن المستخدم لديه الصلاحيات
mysql -u ais_user -p ais_aviation
```

### المشكلة 2: "Port 3000 already in use"

**الحل**:

```bash
# ابحث عن العملية التي تستخدم المنفذ
lsof -ti:3000

# أوقف العملية
kill -9 $(lsof -ti:3000)

# أو غيّر المنفذ في .env
PORT=3001
```

### المشكلة 3: "pnpm: command not found"

**الحل**:

```bash
# أعد تثبيت pnpm
npm install -g pnpm

# أو استخدم npm بدلاً من pnpm
npm install
npm run dev
```

### المشكلة 4: "Module not found"

**الحل**:

```bash
# احذف node_modules وأعد التثبيت
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### المشكلة 5: "Database migration failed"

**الحل**:

```bash
# احذف قاعدة البيانات وأعد إنشاءها
mysql -u root -p

# في MySQL:
DROP DATABASE ais_aviation;
CREATE DATABASE ais_aviation;
EXIT;

# أعد تطبيق migrations
pnpm db:push
npx tsx scripts/seed-data.mjs
```

---

## 🔄 الخطوات التالية

بعد إعداد البيئة بنجاح:

1. 📖 **اقرأ الوثائق**:
   - [دليل المطور](DEVELOPER_GUIDE.md)
   - [البنية المعمارية](ARCHITECTURE.md)
   - [دليل المساهمة](../CONTRIBUTING.md)

2. 🧪 **جرّب الميزات**:
   - ابحث عن رحلات
   - أنشئ حجزاً تجريبياً
   - جرّب برنامج الولاء
   - اختبر لوحة الإدارة

3. 💻 **ابدأ التطوير**:
   - أنشئ فرع جديد
   - أضف ميزة جديدة
   - اكتب اختبارات
   - أرسل Pull Request

---

## 📞 الدعم

إذا واجهت مشاكل:

1. 📚 راجع [استكشاف الأخطاء](TROUBLESHOOTING.md)
2. 📧 راسلنا: info@ais.com
3. 🐛 افتح Issue على GitHub

---

**مبروك! 🎉 أنت الآن جاهز للبدء في التطوير!**
