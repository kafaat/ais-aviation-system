# Production Topology - AIS Aviation System

**التاريخ:** 26 يناير 2026  
**الهدف:** تصميم بنية تشغيلية بسيطة وقابلة للتوسع بدون تعقيد زائد

---

## 🏗️ البنية المعمارية

```
                    ┌─────────────────────┐
                    │   Mobile App / Web  │
                    └──────────┬──────────┘
                               │
                               │ HTTPS
                               ▼
                    ┌─────────────────────┐
                    │  Nginx / Cloud LB   │
                    │  (Load Balancer)    │
                    └──────────┬──────────┘
                               │
                ┌──────────────┼──────────────┐
                │              │              │
                ▼              ▼              ▼
         ┌──────────┐   ┌──────────┐   ┌──────────┐
         │ AIS API  │   │ AIS API  │   │ AIS API  │
         │ (Node.js)│   │ (Node.js)│   │ (Node.js)│
         │ Replica 1│   │ Replica 2│   │ Replica 3│
         └─────┬────┘   └─────┬────┘   └─────┬────┘
               │              │              │
               └──────────────┼──────────────┘
                              │
                ┌─────────────┼─────────────┐
                │             │             │
                ▼             ▼             ▼
         ┌──────────┐  ┌──────────┐  ┌──────────┐
         │ Postgres │  │  Redis   │  │  Stripe  │
         │   (DB)   │  │ (Cache + │  │   API    │
         │          │  │  Queue)  │  │ (External)│
         └──────────┘  └──────────┘  └──────────┘
```

---

## 📦 المكونات

### 1. Load Balancer (Nginx)

**الدور:** توزيع الحمل على replicas الـ API

**المميزات:**
- Round-robin load balancing
- Health checks
- SSL termination
- Rate limiting
- Static file serving

**التكوين:**
```nginx
upstream ais_api {
    least_conn;
    server api1:3000 max_fails=3 fail_timeout=30s;
    server api2:3000 max_fails=3 fail_timeout=30s;
    server api3:3000 max_fails=3 fail_timeout=30s;
}

server {
    listen 80;
    server_name ais.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ais.example.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req zone=api_limit burst=20 nodelay;

    location /api/ {
        proxy_pass http://ais_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location / {
        root /var/www/html;
        try_files $uri $uri/ /index.html;
    }
}
```

---

### 2. AIS API (Node.js) - 3 Replicas

**الدور:** معالجة طلبات API

**المواصفات (لكل replica):**
- **CPU:** 2 cores
- **RAM:** 2GB
- **Storage:** 10GB

**المميزات:**
- Stateless (لا session state محلي)
- Horizontal scaling
- Auto-restart on failure

**Environment Variables:**
```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:pass@postgres:5432/ais
REDIS_URL=redis://redis:6379
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
JWT_SECRET=...
SENTRY_DSN=...
```

---

### 3. PostgreSQL Database

**الدور:** قاعدة البيانات الرئيسية

**المواصفات:**
- **CPU:** 4 cores
- **RAM:** 8GB
- **Storage:** 100GB SSD

**المميزات:**
- Connection pooling (pgBouncer)
- Daily backups
- Point-in-time recovery
- Read replicas (مستقبلاً)

**التكوين:**
```yaml
postgres:
  image: postgres:15-alpine
  environment:
    POSTGRES_DB: ais
    POSTGRES_USER: ais_user
    POSTGRES_PASSWORD: ${DB_PASSWORD}
  volumes:
    - postgres_data:/var/lib/postgresql/data
    - ./backups:/backups
  command: >
    postgres
    -c max_connections=200
    -c shared_buffers=2GB
    -c effective_cache_size=6GB
    -c maintenance_work_mem=512MB
    -c checkpoint_completion_target=0.9
    -c wal_buffers=16MB
    -c default_statistics_target=100
```

---

### 4. Redis

**الدور:** Caching + Queue + Rate Limiting

**المواصفات:**
- **CPU:** 2 cores
- **RAM:** 4GB
- **Storage:** 20GB

**الاستخدامات:**
1. **Caching:**
   - نتائج البحث (TTL: 5 دقائق)
   - بيانات المطارات (TTL: 1 ساعة)
   - بيانات الشركات (TTL: 1 ساعة)

2. **Queue (BullMQ):**
   - Email sending
   - Webhook retries
   - Reconciliation jobs

3. **Rate Limiting:**
   - API rate limits
   - Login attempts

**التكوين:**
```yaml
redis:
  image: redis:7-alpine
  command: >
    redis-server
    --maxmemory 3gb
    --maxmemory-policy allkeys-lru
    --appendonly yes
  volumes:
    - redis_data:/data
```

---

## 🚀 Deployment Strategy

### 1. Blue-Green Deployment

**الخطوات:**
1. نشر النسخة الجديدة (Green)
2. اختبار Green environment
3. تحويل الـ traffic من Blue إلى Green
4. مراقبة لمدة 24 ساعة
5. إيقاف Blue environment

**المميزات:**
- Zero downtime
- سهولة الـ rollback
- اختبار في بيئة إنتاج حقيقية

---

### 2. Rolling Update

**الخطوات:**
1. تحديث replica 1
2. انتظار health check
3. تحديث replica 2
4. انتظار health check
5. تحديث replica 3

**المميزات:**
- لا يتطلب موارد إضافية
- تدريجي وآمن

---

## 📊 Monitoring & Observability

### 1. Health Checks

**Endpoints:**
- `GET /health` - basic health
- `GET /health/ready` - readiness (DB + Redis)
- `GET /health/live` - liveness

**Nginx Health Check:**
```nginx
location /health {
    access_log off;
    proxy_pass http://ais_api/health;
    proxy_connect_timeout 2s;
    proxy_read_timeout 2s;
}
```

---

### 2. Metrics

**المقاييس المطلوبة:**
- Request rate (req/s)
- Response time (p50, p95, p99)
- Error rate (%)
- CPU usage (%)
- Memory usage (%)
- DB connections
- Redis memory usage

**الأدوات:**
- Prometheus + Grafana
- أو Cloud provider metrics (AWS CloudWatch, Azure Monitor)

---

### 3. Logging

**المستويات:**
- ERROR - الأخطاء الحرجة
- WARN - تحذيرات
- INFO - معلومات عامة
- DEBUG - تفاصيل للتطوير

**التنسيق:**
```json
{
  "timestamp": "2026-01-26T10:00:00Z",
  "level": "INFO",
  "correlationId": "abc123",
  "service": "ais-api",
  "message": "Booking created",
  "data": {
    "bookingId": "BK123",
    "userId": "USR456"
  }
}
```

**الأدوات:**
- Sentry (للأخطاء)
- ELK Stack أو Cloud logging

---

## 🔒 Security

### 1. Network Security

- **Firewall:** فقط ports 80, 443 مفتوحة للخارج
- **Internal Network:** API, DB, Redis في شبكة داخلية
- **DB Access:** فقط من API servers

---

### 2. Secrets Management

**لا تخزن secrets في:**
- Git repository
- Docker images
- Environment files في الكود

**استخدم:**
- AWS Secrets Manager
- Azure Key Vault
- HashiCorp Vault
- أو Docker secrets

---

### 3. SSL/TLS

- **Let's Encrypt** للـ SSL certificates
- **Auto-renewal** للـ certificates
- **TLS 1.2+** فقط
- **HTTPS** إجباري

---

## 💾 Backup Strategy

### 1. Database Backups

**Daily Full Backup:**
```bash
#!/bin/bash
# backup.sh
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/backups/ais_db_$DATE.sql.gz"

pg_dump -h postgres -U ais_user ais | gzip > $BACKUP_FILE

# Keep last 30 days
find /backups -name "ais_db_*.sql.gz" -mtime +30 -delete
```

**Retention:**
- Daily backups: 30 يوم
- Weekly backups: 3 أشهر
- Monthly backups: 1 سنة

---

### 2. Redis Backups

**AOF (Append Only File):**
- تلقائي مع كل write
- يسمح بـ point-in-time recovery

**RDB Snapshots:**
- كل 6 ساعات
- Retention: 7 أيام

---

## 📈 Scaling Strategy

### 1. Vertical Scaling (Short-term)

**عند الحاجة:**
- زيادة CPU/RAM للـ API servers
- زيادة DB resources
- زيادة Redis memory

**الحدود:**
- API: حتى 8 cores, 16GB RAM
- DB: حتى 16 cores, 32GB RAM
- Redis: حتى 8GB memory

---

### 2. Horizontal Scaling (Long-term)

**عند الحاجة:**
- إضافة المزيد من API replicas (4, 5, 6...)
- إضافة DB read replicas
- Redis clustering

**المؤشرات:**
- CPU usage > 70% لمدة طويلة
- Response time > 500ms
- Request rate > 1000 req/s

---

## 🎯 Performance Targets

| المقياس | الهدف | الحد الأقصى |
|---------|--------|-------------|
| Response Time (p95) | < 200ms | < 500ms |
| Response Time (p99) | < 500ms | < 1000ms |
| Error Rate | < 0.1% | < 1% |
| Uptime | 99.9% | 99.5% |
| DB Connections | < 100 | < 150 |
| Redis Memory | < 70% | < 90% |

---

## 🔄 Disaster Recovery

### 1. RTO (Recovery Time Objective)

**الهدف:** 1 ساعة

**الخطوات:**
1. تحديد المشكلة (15 دقيقة)
2. اتخاذ قرار الـ recovery (15 دقيقة)
3. تنفيذ الـ recovery (30 دقيقة)

---

### 2. RPO (Recovery Point Objective)

**الهدف:** 1 ساعة

**الآلية:**
- Point-in-time recovery من DB backups
- Redis AOF للـ queue data

---

## 📝 الخلاصة

هذه البنية:
- ✅ بسيطة وسهلة الإدارة
- ✅ قابلة للتوسع
- ✅ آمنة
- ✅ مراقبة جيدة
- ✅ بدون تعقيد زائد (لا Kong، لا Kubernetes)

**مناسبة لـ:**
- 100-10,000 مستخدم نشط
- 1,000-100,000 حجز/شهر
- فريق صغير (2-5 مطورين)

**التوسع المستقبلي:**
- عند الحاجة، يمكن الانتقال إلى Kubernetes
- أو استخدام managed services (AWS ECS, Azure App Service)

---

**آخر تحديث:** 26 يناير 2026
