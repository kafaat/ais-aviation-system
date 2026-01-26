# Go-Live Runbook - AIS Aviation System

**التاريخ:** 26 يناير 2026  
**الإصدار:** 1.0.0  
**الهدف:** دليل تفصيلي لإطلاق النظام في بيئة الإنتاج

---

## 📋 نظرة عامة

هذا الدليل يغطي جميع الخطوات المطلوبة لإطلاق AIS Aviation System في بيئة الإنتاج، من الإعداد الأولي إلى المراقبة بعد الإطلاق.

---

## ⏱️ الجدول الزمني

| المرحلة | المدة | التوقيت المقترح |
|---------|-------|-----------------|
| الإعداد الأولي | 2-3 ساعات | قبل الإطلاق بـ 1 أسبوع |
| Staging Testing | 2-3 أيام | قبل الإطلاق بـ 3 أيام |
| Soft Launch | 1-2 أيام | يوم الإطلاق |
| Full Launch | مستمر | بعد Soft Launch |

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
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

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
grep "CHANGE_ME" .env.production
# يجب ألا يعيد أي نتائج

# 4. تأمين الملف
chmod 600 .env.production
```

#### القيم المطلوبة (الحد الأدنى)

```env
DATABASE_URL=postgresql://ais_user:STRONG_PASSWORD@postgres:5432/ais
DB_USER=ais_user
DB_PASSWORD=STRONG_PASSWORD
REDIS_URL=redis://redis:6379
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
JWT_SECRET=RANDOM_STRING_32_CHARS
MANUS_OAUTH_CLIENT_ID=...
MANUS_OAUTH_CLIENT_SECRET=...
SENTRY_DSN=https://...@sentry.io/...
EMAIL_SERVICE_API_KEY=...
```

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
docker-compose -f docker-compose.production.yml build

# 2. التحقق من الصور
docker images | grep ais
```

#### ✅ Checklist
- [ ] جميع الصور بُنيت بنجاح
- [ ] لا أخطاء في البناء

---

## 🧪 المرحلة 2: Staging Testing

### 2.1 إطلاق Staging Environment

```bash
# 1. إطلاق الخدمات
docker-compose -f docker-compose.production.yml up -d

# 2. التحقق من الحالة
docker-compose -f docker-compose.production.yml ps

# 3. فحص الـ logs
docker-compose -f docker-compose.production.yml logs -f
```

#### ✅ Checklist
- [ ] جميع الخدمات تعمل
- [ ] لا أخطاء في الـ logs
- [ ] Health checks تمر

---

### 2.2 تشغيل Database Migrations

```bash
# 1. الدخول إلى container
docker exec -it ais_api_1 sh

# 2. تشغيل migrations
npm run db:migrate

# 3. التحقق من الجداول
npm run db:studio
# أو
psql $DATABASE_URL -c "\dt"

# 4. الخروج
exit
```

#### ✅ Checklist
- [ ] Migrations نجحت
- [ ] جميع الجداول موجودة
- [ ] لا أخطاء في الـ schema

---

### 2.3 إنشاء بيانات اختبار

```bash
# 1. تشغيل seed script
docker exec -it ais_api_1 npm run db:seed

# 2. التحقق من البيانات
docker exec -it ais_api_1 npm run db:studio
```

#### ✅ Checklist
- [ ] بيانات الاختبار موجودة
- [ ] يمكن تسجيل الدخول
- [ ] يمكن البحث عن رحلات

---

### 2.4 اختبار E2E Flows

#### Flow 1: البحث والحجز

```bash
# 1. البحث عن رحلات
curl -X POST https://staging.ais.example.com/api/flights/search \
  -H "Content-Type: application/json" \
  -d '{
    "from": "RUH",
    "to": "JED",
    "date": "2026-02-01"
  }'

# 2. إنشاء حجز
curl -X POST https://staging.ais.example.com/api/bookings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "idempotencyKey": "test-123",
    "flightId": "...",
    "passengers": [...]
  }'

# 3. معالجة الدفع
curl -X POST https://staging.ais.example.com/api/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "bookingId": "...",
    "paymentMethodId": "pm_card_visa"
  }'
```

#### Flow 2: الإلغاء والاسترداد

```bash
# 1. إلغاء الحجز
curl -X POST https://staging.ais.example.com/api/bookings/{id}/cancel \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"reason": "Test cancellation"}'

# 2. معالجة الاسترداد
curl -X POST https://staging.ais.example.com/api/refunds/{id}/process \
  -H "Authorization: Bearer $TOKEN"
```

#### ✅ Checklist
- [ ] البحث يعمل
- [ ] الحجز يعمل
- [ ] الدفع يعمل
- [ ] الإلغاء يعمل
- [ ] الاسترداد يعمل
- [ ] Webhooks تعمل

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
docker-compose -f docker-compose.production.yml logs -f

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

| المقياس | الهدف | الإجراء عند التجاوز |
|---------|--------|---------------------|
| Response Time (p95) | < 500ms | تحقق من slow queries |
| Error Rate | < 1% | تحقق من logs |
| CPU Usage | < 70% | فكر في scaling |
| Memory Usage | < 80% | تحقق من memory leaks |
| DB Connections | < 100 | تحقق من connection pool |

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

```bash
# 1. تحديث feature flags
# في .env.production
REGISTRATION_ENABLED=true

# 2. إعادة تشغيل الخدمات
docker-compose -f docker-compose.production.yml restart api1 api2 api3
```

#### ✅ Checklist
- [ ] التسجيل مفتوح
- [ ] الإعلان عن الإطلاق
- [ ] فريق الدعم جاهز

---

### 4.2 إعداد النسخ الاحتياطي التلقائي

```bash
# 1. إنشاء backup script
cat > /opt/backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/opt/ais-aviation-system/backups"
BACKUP_FILE="$BACKUP_DIR/ais_db_$DATE.sql.gz"

# Backup database
docker exec ais_postgres pg_dump -U $DB_USER ais | gzip > $BACKUP_FILE

# Upload to S3 (optional)
# aws s3 cp $BACKUP_FILE s3://ais-backups/

# Keep last 30 days
find $BACKUP_DIR -name "ais_db_*.sql.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_FILE"
EOF

chmod +x /opt/backup.sh

# 2. إضافة إلى cron (يومياً في 2 صباحاً)
crontab -e
# أضف: 0 2 * * * /opt/backup.sh
```

#### ✅ Checklist
- [ ] Backup script يعمل
- [ ] Backup يومي مجدول
- [ ] Retention policy مطبق

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

```bash
# 1. إيقاف التسجيل
# في .env.production
REGISTRATION_ENABLED=false

# 2. إيقاف الخدمات
docker-compose -f docker-compose.production.yml down

# 3. استعادة النسخة الاحتياطية
gunzip < backups/ais_db_LATEST.sql.gz | \
  docker exec -i ais_postgres psql -U $DB_USER ais

# 4. العودة إلى commit سابق
git checkout PREVIOUS_COMMIT

# 5. إعادة البناء
docker-compose -f docker-compose.production.yml build

# 6. إعادة التشغيل
docker-compose -f docker-compose.production.yml up -d

# 7. التحقق
curl https://ais.example.com/health
```

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
