# Deployment Guide - AIS Aviation System

This guide provides step-by-step instructions for deploying the AIS Aviation System to production environments.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Database Setup](#database-setup)
- [CI/CD Pipeline](#cicd-pipeline)
- [Deployment Strategies](#deployment-strategies)
- [Monitoring & Observability](#monitoring--observability)
- [Rollback Procedures](#rollback-procedures)

## Prerequisites

### Required Tools
- Node.js 22.x or higher
- pnpm 10.x or higher
- MySQL 8.0 or TiDB
- Git
- Docker (optional, for containerized deployment)

### Cloud Provider Access
Choose one of:
- AWS (EC2, RDS, S3, Secrets Manager)
- Azure (App Service, Database, Blob Storage, Key Vault)
- Google Cloud (Compute Engine, Cloud SQL, Cloud Storage, Secret Manager)
- DigitalOcean (Droplets, Managed Databases, Spaces)

### Required Accounts
- Stripe account (for payments)
- Manus OAuth (for authentication)
- SendGrid or similar (for emails)
- Monitoring service (Sentry, Datadog, New Relic)

## Environment Setup

### 1. Clone Repository
```bash
git clone https://github.com/kafaat/ais-aviation-system.git
cd ais-aviation-system
```

### 2. Install Dependencies
```bash
pnpm install --frozen-lockfile
```

### 3. Environment Variables

**Create production environment file:**
```bash
cp .env.production .env
```

**Required Variables:**
```env
# Database (use managed database service)
DATABASE_URL=mysql://user:password@prod-db-host:3306/ais_aviation_prod
DATABASE_POOL_MIN=10
DATABASE_POOL_MAX=50

# Authentication
JWT_SECRET=<64-character-random-string>
OAUTH_SERVER_URL=https://oauth.manus.space
OWNER_OPEN_ID=<production-owner-id>

# Payment (LIVE keys)
STRIPE_SECRET_KEY=sk_live_<your-key>
STRIPE_WEBHOOK_SECRET=whsec_<your-secret>

# Email
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_USER=apikey
EMAIL_PASSWORD=<sendgrid-api-key>

# Storage
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<access-key>
AWS_SECRET_ACCESS_KEY=<secret-key>
AWS_S3_BUCKET=ais-aviation-production

# Application
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://ais-aviation-system.com

# Security
COOKIE_DOMAIN=.ais-aviation-system.com
COOKIE_SECURE=true
COOKIE_SAME_SITE=strict

# Monitoring
SENTRY_DSN=<your-sentry-dsn>
DATADOG_API_KEY=<your-datadog-key>
```

**Store secrets securely:**
```bash
# AWS Secrets Manager
aws secretsmanager create-secret \
  --name ais-aviation-prod-secrets \
  --secret-string file://secrets.json

# Azure Key Vault
az keyvault secret set \
  --vault-name ais-aviation-vault \
  --name prod-secrets \
  --file secrets.json

# Google Secret Manager
gcloud secrets create ais-aviation-prod-secrets \
  --data-file=secrets.json
```

## Database Setup

### 1. Provision Database

**AWS RDS (MySQL):**
```bash
aws rds create-db-instance \
  --db-instance-identifier ais-aviation-prod \
  --db-instance-class db.t3.medium \
  --engine mysql \
  --engine-version 8.0 \
  --master-username admin \
  --master-user-password <secure-password> \
  --allocated-storage 100 \
  --backup-retention-period 7 \
  --multi-az \
  --storage-encrypted
```

**TiDB Cloud:**
```bash
# Create via TiDB Cloud Console
# https://tidbcloud.com/
# Select region, instance type, and storage
```

### 2. Run Migrations

```bash
# Generate migration files
pnpm db:generate

# Apply migrations to production
DATABASE_URL=<production-url> pnpm db:migrate
```

### 3. Verify Schema
```bash
# Connect to production database
mysql -h prod-db-host -u admin -p ais_aviation_prod

# Verify tables
SHOW TABLES;

# Check critical tables
DESCRIBE bookings;
DESCRIBE booking_status_history;
DESCRIBE audit_logs;
```

### 4. Create Database Indexes
```sql
-- Critical indexes for performance
CREATE INDEX idx_bookings_user_status ON bookings(userId, status);
CREATE INDEX idx_flights_route_date ON flights(originId, destinationId, departureTime);
CREATE INDEX idx_audit_logs_user_event ON audit_logs(userId, eventType, createdAt);
```

## CI/CD Pipeline

### GitHub Actions Setup

**1. Add Repository Secrets:**
```
Settings → Secrets and variables → Actions → New repository secret
```

Required secrets:
- `DATABASE_URL` - Production database connection
- `JWT_SECRET` - JWT signing secret
- `STRIPE_SECRET_KEY` - Stripe live key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook secret
- `AWS_ACCESS_KEY_ID` - AWS credentials
- `AWS_SECRET_ACCESS_KEY` - AWS credentials
- `SENTRY_DSN` - Error tracking

**2. Configure Deployment Environments:**
```
Settings → Environments → New environment
```

Create two environments:
- `staging` (auto-deploy from develop branch)
- `production` (auto-deploy from main branch, requires approval)

**3. Pipeline Workflow:**

The CI/CD pipeline automatically runs on every push:

```yaml
Trigger → Lint → Test → Security Scan → Build → Deploy
```

**Stages:**
1. **Lint** - Code style and formatting checks
2. **Test** - Unit and integration tests
3. **Security** - Vulnerability scanning (npm audit, dependency check)
4. **Build** - TypeScript compilation and bundling
5. **Deploy** - Push to staging/production

### Manual Deployment Trigger

```bash
# Trigger deployment via GitHub CLI
gh workflow run ci-cd.yml \
  --ref main \
  -f environment=production
```

## Deployment Strategies

### Option 1: Docker Deployment

**Build Docker Image:**
```bash
docker build -f Dockerfile.prod -t ais-aviation:latest .
```

**Push to Registry:**
```bash
# AWS ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

docker tag ais-aviation:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/ais-aviation:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/ais-aviation:latest
```

**Deploy to ECS/Kubernetes:**
```bash
# ECS
aws ecs update-service \
  --cluster ais-aviation-cluster \
  --service ais-aviation-service \
  --force-new-deployment

# Kubernetes
kubectl set image deployment/ais-aviation \
  ais-aviation=<account-id>.dkr.ecr.us-east-1.amazonaws.com/ais-aviation:latest
kubectl rollout status deployment/ais-aviation
```

### Option 2: PM2 Deployment

**Install PM2:**
```bash
npm install -g pm2
```

**PM2 Ecosystem File:**
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'ais-aviation',
    script: 'dist/index.js',
    instances: 'max',
    exec_mode: 'cluster',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/ais-aviation/error.log',
    out_file: '/var/log/ais-aviation/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    max_memory_restart: '1G',
  }]
};
```

**Deploy:**
```bash
# Build application
pnpm build

# Start with PM2
pm2 start ecosystem.config.js --env production

# Save configuration
pm2 save

# Setup auto-restart on reboot
pm2 startup
```

### Option 3: Serverless Deployment (AWS Lambda)

**Install Serverless Framework:**
```bash
npm install -g serverless
```

**Serverless Configuration:**
```yaml
# serverless.yml
service: ais-aviation

provider:
  name: aws
  runtime: nodejs22.x
  region: us-east-1
  environment:
    DATABASE_URL: ${env:DATABASE_URL}
    JWT_SECRET: ${env:JWT_SECRET}
  
functions:
  api:
    handler: dist/lambda.handler
    events:
      - http:
          path: /{proxy+}
          method: ANY
          cors: true
```

**Deploy:**
```bash
serverless deploy --stage production
```

## Monitoring & Observability

### 1. Application Monitoring

**Sentry Integration:**
```typescript
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
});
```

**Datadog APM:**
```typescript
import tracer from 'dd-trace';

tracer.init({
  service: 'ais-aviation',
  env: process.env.NODE_ENV,
});
```

### 2. Log Aggregation

**CloudWatch Logs (AWS):**
```bash
# Install CloudWatch agent
wget https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
sudo dpkg -i amazon-cloudwatch-agent.deb

# Configure log collection
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/config.json
```

### 3. Metrics & Dashboards

**Key Metrics to Monitor:**
- Request rate (req/s)
- Response time (p50, p95, p99)
- Error rate (%)
- Database connection pool usage
- Memory usage
- CPU usage
- Booking conversion rate
- Payment success rate

**Grafana Dashboard:**
```bash
# Import dashboard template
# Dashboard ID: ais-aviation-metrics
# Panels: API latency, Error rate, Active users, Bookings/hour
```

### 4. Alerting

**Alert Rules:**
```yaml
# Error rate > 5%
- name: high_error_rate
  condition: error_rate > 5
  duration: 5m
  notification: slack, email

# Response time > 2s
- name: slow_response
  condition: p95_latency > 2000
  duration: 5m
  notification: pagerduty

# Database connection pool exhausted
- name: db_pool_exhausted
  condition: db_pool_usage > 90
  duration: 2m
  notification: slack, pagerduty
```

## Health Checks

### Application Health Endpoint
```typescript
// server/routers/health.ts
export const healthRouter = router({
  check: publicProcedure.query(async () => {
    const checks = {
      database: await checkDatabaseHealth(),
      stripe: await checkStripeHealth(),
      redis: await checkRedisHealth(),
    };
    
    const healthy = Object.values(checks).every(c => c.status === 'pass');
    
    return {
      status: healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks,
    };
  }),
});
```

### Load Balancer Health Check
```nginx
# nginx.conf
upstream ais-aviation {
  server app1:3000 max_fails=3 fail_timeout=30s;
  server app2:3000 max_fails=3 fail_timeout=30s;
  
  # Health check
  check interval=3000 rise=2 fall=3 timeout=1000 type=http;
  check_http_send "GET /api/health HTTP/1.0\r\n\r\n";
  check_http_expect_alive http_2xx http_3xx;
}
```

## Rollback Procedures

### Quick Rollback (Docker)

```bash
# List previous images
docker images ais-aviation

# Rollback to previous version
docker tag ais-aviation:v1.2.0 ais-aviation:latest
docker restart ais-aviation

# Or via ECS
aws ecs update-service \
  --cluster ais-aviation-cluster \
  --service ais-aviation-service \
  --task-definition ais-aviation:42  # Previous task definition
```

### Database Rollback

```bash
# Restore from automated backup
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier ais-aviation-prod \
  --target-db-instance-identifier ais-aviation-restore \
  --restore-time 2025-01-12T10:00:00Z

# Or apply reverse migration
pnpm db:migrate:down
```

### PM2 Rollback

```bash
# Revert to previous deployment
cd /var/www/ais-aviation/releases/v1.2.0
pm2 reload ecosystem.config.js
```

## Post-Deployment Checklist

- [ ] Verify application is running (`/health` endpoint returns 200)
- [ ] Check logs for errors (CloudWatch, Datadog, Sentry)
- [ ] Test critical user flows (booking, payment, check-in)
- [ ] Verify database migrations applied successfully
- [ ] Confirm webhooks are receiving events (Stripe)
- [ ] Check monitoring dashboards for anomalies
- [ ] Verify rate limiting is working
- [ ] Test RBAC permissions for different roles
- [ ] Confirm audit logs are being written
- [ ] Run smoke tests on production

## Troubleshooting

### Common Issues

**Database Connection Refused:**
```bash
# Check database status
aws rds describe-db-instances --db-instance-identifier ais-aviation-prod

# Verify security group allows connections
# Check connection string format
```

**High Memory Usage:**
```bash
# Check PM2 memory usage
pm2 monit

# Restart with lower worker count
pm2 delete ais-aviation
pm2 start ecosystem.config.js --instances 2
```

**Slow Response Times:**
```bash
# Check database query performance
EXPLAIN SELECT * FROM bookings WHERE userId = 123;

# Add missing indexes
CREATE INDEX idx_bookings_user ON bookings(userId);

# Enable query caching
```

## Support

For deployment assistance:
- DevOps Team: devops@ais.com
- Documentation: https://docs.ais.com
- Slack Channel: #ais-deployment
