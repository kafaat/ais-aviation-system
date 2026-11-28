# Go-Live Runbook - AIS Aviation System

**التاريخ:** 26 يناير 2026  
**الإصدار:** 1.0.0  
**الهدف:** دليل تفصيلي لإطلاق النظام في بيئة الإنتاج

---

## 📋 نظرة عامة

هذا الدليل يغطي جميع الخطوات المطلوبة لإطلاق AIS Aviation System في بيئة الإنتاج، من الإعداد الأولي إلى المراقبة بعد الإطلاق.

---

## ⏱️ الجدول الزمني

| المرحلة         | المدة     | التوقيت المقترح        |
| --------------- | --------- | ---------------------- |
| الإعداد الأولي  | 2-3 ساعات | قبل الإطلاق بـ 1 أسبوع |
| Staging Testing | 2-3 أيام  | قبل الإطلاق بـ 3 أيام  |
| Soft Launch     | 1-2 أيام  | يوم الإطلاق            |
| Full Launch     | مستمر     | بعد Soft Launch        |

---

## 🎯 المرحلة 1: الإعداد الأولي

### 1.1 إعداد الخادم

#### المتطلبات

- **OS:** Ubuntu 22.04 LTS
- **CPU:** 16 cores (minimum)
- **RAM:** 32GB (minimum)
- **Storage:** 200GB SSD
- **Network:** 1Gbps

#### الخطوات

```bash
# 1. تحديث النظام
sudo apt update && sudo apt upgrade -y

# 2. تثبيت Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# 3. تثبيت Docker Compose
docker compose version

# 4. تثبيت أدوات إضافية
sudo apt install -y git curl wget htop

# 5. إعداد Firewall
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

#### ✅ Checklist

- [ ] الخادم جاهز ومحدّث
- [ ] Docker مثبت ويعمل
- [ ] Docker Compose مثبت
- [ ] Firewall مُعد بشكل صحيح

---

### 1.2 نسخ المشروع

```bash
# 1. نسخ المستودع
cd /opt
sudo git clone https://github.com/kafaat/ais-aviation-system.git
cd ais-aviation-system

# 2. التبديل إلى production branch
sudo git checkout main

# 3. إعداد الصلاحيات
sudo chown -R $USER:$USER /opt/ais-aviation-system
```

#### ✅ Checklist

- [ ] المشروع منسوخ
- [ ] على الفرع الصحيح
- [ ] الصلاحيات صحيحة

---

### 1.3 إعداد Environment Variables

```bash
# 1. نسخ ملف البيئة
cp .env.production.example .env.production

# 2. تعديل القيم
nano .env.production

# 3. التحقق من عدم وجود قيم افتراضية
if grep -q "CHANGE_ME" .env.production; then echo "توجد قيم تحتاج إلى إعداد"; exit 1; fi
docker compose --env-file .env.production -f docker-compose.production.yml config --quiet

# 4. تأمين الملف
chmod 600 .env.production
```

#### القيم المطلوبة (الحد الأدنى)

يدير ملف Compose الكامل MySQL 8 ويشتق عنوان الاتصال من `DB_NAME` و`DB_USER` و`DB_PASSWORD`. تضبط `DB_ROOT_PASSWORD` كلمة مرور إدارة MySQL عند التهيئة الأولى. استخدم كلمات مرور آمنة لإدراجها في عنوان الاتصال، مثل قيم hex مولّدة عشوائيًا. تدوير سر قاعدة قائمة يحتاج تحديث الحساب داخل MySQL وتنسيق إعادة تشغيل الخدمات.

ولّد قيمًا مستقلة لـ `JWT_SECRET` و`CSRF_SECRET` و`AUTH_SERVICE_TOKEN` و`SELF_SERVICE_CAPABILITY_SECRET` و`MFA_ENCRYPTION_KEY`. اضبط `FRONTEND_URL` على أصل الموقع المنشور، و`STRIPE_SECRET_KEY` و`STRIPE_WEBHOOK_SECRET` لحساب وبيئة الدفع المقصودين. يتطلب البريد `RESEND_API_KEY` و`EMAIL_FROM` المقبول لدى Resend. يحوي القالب أسماء الإعدادات ولا يثبت قبول أي مزود.

#### ✅ Checklist

- [ ] ملف `.env.production` موجود
- [ ] جميع القيم المطلوبة مُعبأة
- [ ] لا توجد قيم `CHANGE_ME`
- [ ] الملف محمي (600)

---

### 1.4 إعداد SSL Certificates

#### خيار 1: Let's Encrypt (موصى به)

```bash
# 1. تثبيت Certbot
sudo apt install -y certbot

# 2. الحصول على Certificate
sudo certbot certonly --standalone -d ais.example.com

# 3. نسخ Certificates
sudo mkdir -p ssl
sudo cp /etc/letsencrypt/live/ais.example.com/fullchain.pem ssl/cert.pem
sudo cp /etc/letsencrypt/live/ais.example.com/privkey.pem ssl/key.pem
sudo chown $USER:$USER ssl/*.pem

# 4. إعداد Auto-renewal
sudo crontab -e
# أضف: 0 0 * * 0 certbot renew --quiet
```

#### خيار 2: Self-signed (للاختبار فقط)

```bash
mkdir -p ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ssl/key.pem -out ssl/cert.pem \
  -subj "/CN=ais.example.com"
```

#### ✅ Checklist

- [ ] SSL certificates موجودة
- [ ] `ssl/cert.pem` موجود
- [ ] `ssl/key.pem` موجود
- [ ] Auto-renewal مُعد (إذا Let's Encrypt)

---

### 1.5 بناء Docker Images

```bash
# 1. بناء الصور
docker compose --env-file .env.production -f docker-compose.production.yml build

# 2. التحقق من الصور
docker images | grep ais
```

#### ✅ Checklist

- [ ] جميع الصور بُنيت بنجاح
- [ ] لا أخطاء في البناء

### 1.6 استكمال عناصر سياسة الخصوصية

صفحة سياسة الخصوصية (`/privacy-policy`، الملف `client/src/pages/PrivacyPolicy.tsx`) تصف ما يفعله النظام فعليًا، لكنها لا تعرف هوية الجهة المشغّلة لهذا النشر. لذلك تُعرض القيم التالية كعناصر نائبة بين قوسين مربعين، ويظهر تنبيه مرئي في الصفحة ما دامت موجودة. يجب استبدالها قبل الإطلاق:

| الثابت                            | الموقع                                  | القيمة المطلوبة                                                               |
| --------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| `OPERATOR_LEGAL_NAME_PLACEHOLDER` | `client/src/pages/PrivacyPolicy.tsx`    | الاسم القانوني للجهة المشغّلة (مراقب البيانات)                                 |
| `OPERATOR_CONTACT_PLACEHOLDER`    | `client/src/pages/PrivacyPolicy.tsx`    | قناة التواصل لطلبات الخصوصية (بريد إلكتروني أو عنوان أو مسؤول حماية البيانات) |
| `VITE_APP_TITLE`                  | `.env` (يُقرأ عبر `client/src/const.ts`) | اسم المنتج كما يظهر في السياسة                                                |
| `PRIVACY_POLICY_LAST_UPDATED`     | `client/src/pages/PrivacyPolicy.tsx`    | تاريخ آخر تعديل جوهري على نص السياسة (ISO)                                    |

- النصوص ثنائية اللغة في `client/src/i18n/locales/{en,ar}.json` تحت المفتاح `privacy`؛ أي تعديل في ممارسات المعالجة يستلزم مراجعة قانونية وتحديث التاريخ.
- مدد الاحتفاظ المذكورة في السياسة (التسجيل البيومتري، الحجوزات المحذوفة) تُقرأ من `shared/const.ts` ويطبّقها الخادم من المصدر نفسه.

#### ✅ Checklist

- [ ] استُبدلت العناصر النائبة ولم يعد التنبيه يظهر في `/privacy-policy`
- [ ] رُوجعت السياسة من جهة قانونية مختصة
- [ ] حُدّث `PRIVACY_POLICY_LAST_UPDATED`

---

## 🧪 المرحلة 2: Staging Testing

### 2.1 إطلاق Staging Environment

```bash
# 1. إطلاق الخدمات
docker compose --env-file .env.production -f docker-compose.production.yml up -d

# 2. التحقق من الحالة
docker compose --env-file .env.production -f docker-compose.production.yml ps

# 3. فحص الـ logs
docker compose --env-file .env.production -f docker-compose.production.yml logs -f
```

#### ✅ Checklist

- [ ] جميع الخدمات تعمل
- [ ] لا أخطاء في الـ logs
- [ ] Health checks تمر

---

### 2.2 التحقق من ترحيلات MySQL

يشغّل Compose خدمة `migrator` قبل API والعامل وخدمة المصادقة. راجع خروجها ثم طابق بنية القاعدة مع سجل الإصدار عبر الصورة المخصّصة للترحيل.

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps -a migrator
docker compose --env-file .env.production -f docker-compose.production.yml run --rm --no-deps migrator node --import tsx scripts/db/migrate.ts verify
```

### 2.3 بيانات القبول

ينظّف `scripts/seed-data.mjs` سجلات الرحلات والمطارات والتسعير قبل البذر. استخدم قاعدة اختبار مملوكة للتجربة ومعزولة عن بيانات التشغيل. تحتاج اختبارات البحث الإيجابية إلى مطارين مختلفين على الأقل في البيانات المرجعية.

### 2.4 التحقق من الإصدار

```bash
bash scripts/smoke-tests.sh https://staging.ais.example.com
bash scripts/e2e-critical.sh https://staging.ais.example.com
```

استبدل العنوان بالهدف المصرّح به. يتحقق الفحصان من HTTP وعقود التطبيق، ويعرضان الفحوص التي تعذّر تنفيذها. لاختبار الحجز والتحصيل والإلغاء والاسترداد استخدم عينات قاعدة الاختبار وفحوص المعاملات في `Production Gates`. يُسجّل قبول مزود الدفع في تجربة sandbox مستقلة موثّقة في [دليل قبول المزود](operations/provider-acceptance.md).

---

### 2.5 اختبار الأداء

```bash
# 1. تثبيت k6
sudo apt install -y k6

# 2. تشغيل load test
k6 run tests/load/booking-flow.js

# 3. مراجعة النتائج
# - Response time < 500ms
# - Error rate < 1%
# - Throughput > 100 req/s
```

#### ✅ Checklist

- [ ] Load test نجح
- [ ] Response times مقبولة
- [ ] Error rate منخفض
- [ ] النظام مستقر تحت الحمل

---

## 🚀 المرحلة 3: Soft Launch

### 3.1 إعداد المراقبة

#### Sentry

```bash
# 1. التحقق من Sentry DSN
echo $SENTRY_DSN

# 2. اختبار Sentry
docker exec -it ais_api_1 node -e "
  const Sentry = require('@sentry/node');
  Sentry.init({ dsn: process.env.SENTRY_DSN });
  Sentry.captureMessage('Test from production');
"

# 3. التحقق في Sentry dashboard
```

#### Health Monitoring

```bash
# 1. إعداد health check script
cat > /opt/health-check.sh << 'EOF'
#!/bin/bash
HEALTH_URL="https://ais.example.com/health"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)

if [ $RESPONSE -ne 200 ]; then
  echo "Health check failed: $RESPONSE"
  # Send alert
  curl -X POST $ALERT_SLACK_WEBHOOK \
    -H 'Content-Type: application/json' \
    -d '{"text":"AIS Health Check Failed: '$RESPONSE'"}'
fi
EOF

chmod +x /opt/health-check.sh

# 2. إضافة إلى cron (كل 5 دقائق)
crontab -e
# أضف: */5 * * * * /opt/health-check.sh
```

#### ✅ Checklist

- [ ] Sentry يعمل
- [ ] Health checks تعمل
- [ ] Alerts تعمل

---

### 3.2 إطلاق للمستخدمين المحدودين

#### الخطوات

1. **تفعيل النظام:**

```bash
# تحديث DNS للإشارة إلى الخادم الجديد
# A record: ais.example.com -> SERVER_IP
```

2. **دعوة مستخدمين محدودين:**
   - 10-20 مستخدم
   - موظفين داخليين أولاً
   - ثم عملاء مختارين

3. **المراقبة المكثفة:**

```bash
# مراقبة logs في الوقت الفعلي
docker compose --env-file .env.production -f docker-compose.production.yml logs -f

# مراقبة الموارد
docker stats
```

#### ✅ Checklist

- [ ] DNS محدّث
- [ ] مستخدمون محدودون مدعوون
- [ ] المراقبة نشطة
- [ ] فريق الدعم جاهز

---

### 3.3 مراقبة اليوم الأول

#### المقاييس المطلوب مراقبتها

| المقياس             | الهدف   | الإجراء عند التجاوز     |
| ------------------- | ------- | ----------------------- |
| Response Time (p95) | < 500ms | تحقق من slow queries    |
| Error Rate          | < 1%    | تحقق من logs            |
| CPU Usage           | < 70%   | فكر في scaling          |
| Memory Usage        | < 80%   | تحقق من memory leaks    |
| DB Connections      | < 100   | تحقق من connection pool |

#### الأوامر المفيدة

```bash
# مراقعة الموارد
docker stats

# عدد الطلبات
docker exec -it ais_nginx grep "POST /api/bookings" /var/log/nginx/access.log | wc -l

# معدل الأخطاء
docker exec -it ais_nginx grep " 500 " /var/log/nginx/access.log | wc -l

# أبطأ الطلبات
docker exec -it ais_nginx awk '{print $NF, $7}' /var/log/nginx/access.log | sort -rn | head -20
```

#### ✅ Checklist

- [ ] جميع المقاييس ضمن الحدود
- [ ] لا أخطاء حرجة
- [ ] المستخدمون راضون
- [ ] لا شكاوى

---

## 🎉 المرحلة 4: Full Launch

### 4.1 فتح التسجيل

اختبر تسجيل حساب اصطناعي في البيئة المعتمدة واختبر الدخول من الواجهة. نسّق طرح التسجيل مع قناة الوصول التي يديرها المشغّل. لا يوجد متغير تطبيق باسم `REGISTRATION_ENABLED` يتحكم في هذه العملية.

### 4.2 إعداد النسخ الاحتياطي لـ MySQL

ينشئ نشر Kubernetes نسخة قبل الترحيل عند تفعيل `ENABLE_DB_BACKUP` وتوفير وحدة التخزين وبيانات حساب النسخ. يضبط مشغّل Compose جدوله ووجهة التخزين وصلاحيات الوصول. أوقف تغييرات المخطط أثناء الالتقاط. يبيّن المثال استخدام أمر النسخ نفسه المضمّن في `scripts/k8s-backup-job.py` على الخدمة `mysql`؛ ابدأ من جذر الإصدار، واجعل `./backups` قابلاً للكتابة لحساب نظام التشغيل `mysql` على وحدة التخزين، ووفّر `MYSQL_USER` و`MYSQL_PWD` لحساب النسخ عبر مدير الأسرار.

```bash
set -euo pipefail
: "${MYSQL_USER:?}" "${MYSQL_PWD:?}"
export MYSQL_USER MYSQL_PWD
export BACKUP_NAME="ais-$(date -u +%Y%m%dT%H%M%SZ)"
python3 -c 'import runpy; print(runpy.run_path("scripts/k8s-backup-job.py")["BACKUP_COMMAND"])' |
  docker compose --env-file .env.production -f docker-compose.production.yml exec -T --user mysql \
    -e MYSQL_USER -e MYSQL_PWD -e BACKUP_NAME -e MYSQL_HOST=127.0.0.1 -e BACKUP_DIR=/backups mysql sh -es
(cd backups && sha256sum -c "$BACKUP_NAME.sql.sha256")
```

احفظ ملفي `.sql` و`.sql.sha256` في مخزن النسخ المعتمد، ودوّن وقت الالتقاط ونتيجة تحقق البصمة. لا يُحذف آخر ملف قابل للاستعادة بمجرد نجاح أمر النسخ. راجع [عقد النسخ والاستعادة وشروط اختبار قاعدة منفصلة](BACKUP_RESTORE_ACCEPTANCE.md).

---

### 4.3 توثيق الإطلاق

```bash
# إنشاء launch report
cat > /opt/launch-report.md << 'EOF'
# AIS Aviation System - Launch Report

**Date:** $(date)
**Version:** 1.0.0

## Metrics
- Total Users: X
- Total Bookings: Y
- Total Revenue: Z SAR
- Average Response Time: Xms
- Error Rate: X%
- Uptime: 99.9%

## Issues
- None

## Next Steps
- Monitor for 7 days
- Collect user feedback
- Plan Sprint 2 improvements
EOF
```

#### ✅ Checklist

- [ ] Launch report موثق
- [ ] Metrics مسجلة
- [ ] Lessons learned موثقة

---

## 🔄 Rollback Plan

### متى نحتاج Rollback؟

- Error rate > 5%
- Critical bugs
- Data corruption
- Security breach

### خطوات Rollback

1. اعزل الكتابات بالتنسيق مع مسؤول التشغيل، وحدد صور API والعامل والمصادقة والمخطط السابق ومدى توافقها مع ترحيلات الإصدار الحالي. سجّل وقت آخر كتابة ناجحة.
2. قد يكفي إرجاع صور التطبيق إلى إصدار متوافق. إذا لزمت استعادة البيانات، اختر نسخة محددة بوقت وبصمة، واحتفظ بالحالة الحالية وبسجل المعاملات اللاحقة. قد يؤدي تبديل قاعدة البيانات إلى فقد كتابات تمت بعد النسخة.
3. استعد إلى مثيل MySQL منفصل بقاعدة فارغة. يصف [دليل قبول الاستعادة](BACKUP_RESTORE_ACCEPTANCE.md) اختبار البصمة، رفض الوجهة غير الفارغة، ومقارنة الجداول والبيانات والإجراءات والأحداث. يعمل برنامج الاختبار المطابق على حاوية تحمل علامة الاختبار حصراً.
4. بعد مطابقة سجل الترحيل والأرصدة والحجوزات مع نقطة الاستعادة المعتمدة، ينفذ مسؤول التشغيل تبديل الاتصال وخطة المصالحة الموثقتين للبيئة. أعد التحقق من `health.ready` وحالة العامل وافحص الواجهة. يتطلب إعلان التعافي قياسًا على البنية المقصودة، واختبار Compose الموصوف أعلاه لم يُنفّذ على بيئة الإنتاج ضمن هذا الدليل.

#### ✅ Checklist

- [ ] النظام عاد للعمل
- [ ] البيانات سليمة
- [ ] المستخدمون أُعلموا

---

## 📞 جهات الاتصال

### فريق التطوير

- **المطور الرئيسي:** [الاسم] - [البريد] - [الهاتف]
- **مهندس DevOps:** [الاسم] - [البريد] - [الهاتف]

### فريق الدعم

- **مدير الدعم:** [الاسم] - [البريد] - [الهاتف]
- **البريد العام:** support@ais.example.com

### الطوارئ

- **On-call:** [الهاتف]
- **Slack:** #ais-alerts

---

## 📚 المراجع

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- [ROLLBACK_PLAN.md](./ROLLBACK_PLAN.md)

---

**آخر تحديث:** 26 يناير 2026
