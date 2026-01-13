# CI/CD Pipeline Documentation

## Overview

The AIS Aviation System uses GitHub Actions for continuous integration and deployment. This document describes the pipeline configuration and deployment procedures.

## 🔄 Pipeline Stages

### 1. Lint Stage

**Purpose**: Ensure code quality and consistency

**Steps**:

- Code formatting check (Prettier)
- TypeScript type checking
- ESLint validation

**Duration**: ~2-3 minutes

**Triggers**: All pushes and pull requests

### 2. Test Stage

**Purpose**: Verify functionality and prevent regressions

**Steps**:

- Setup MySQL test database
- Run database migrations
- Execute unit tests
- Execute integration tests
- Generate coverage report

**Duration**: ~5-7 minutes

**Database**: Ephemeral MySQL 8.0 container

**Environment Variables**:

```bash
DATABASE_URL=mysql://root:test_password@127.0.0.1:3306/ais_test
NODE_ENV=test
JWT_SECRET=test-secret-key-for-ci
STRIPE_SECRET_KEY=sk_test_mock_key
STRIPE_WEBHOOK_SECRET=whsec_mock_secret
```

### 3. Security Scan Stage

**Purpose**: Detect vulnerabilities in dependencies

**Steps**:

- Run `pnpm audit`
- Check for known CVEs
- Generate security report

**Duration**: ~2-3 minutes

**Artifacts**: `audit-results.json` (30 days retention)

### 4. Build Stage

**Purpose**: Verify the application builds successfully

**Steps**:

- Install dependencies
- Build frontend (Vite)
- Build backend (esbuild)
- Upload build artifacts

**Duration**: ~3-5 minutes

**Artifacts**: `build-output` (7 days retention)

### 5. Deploy Stage (Production Only)

**Purpose**: Deploy to production environment

**Trigger**: Push to `main` branch only

**Steps**:

- Download build artifacts
- Deploy to hosting provider
- Run production migrations
- Health check verification

**Duration**: ~5-10 minutes

## 📋 Workflow Configuration

### File: `.github/workflows/ci-cd.yml`

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop, "copilot/**"]
  pull_request:
    branches: [main, develop]
```

### Branch Strategy

- **main**: Production branch, triggers full pipeline + deployment
- **develop**: Development branch, runs full pipeline except deployment
- **copilot/**: Feature branches, runs full pipeline except deployment
- **Pull Requests**: Runs lint, test, security, build

## 🚀 Deployment Process

### Automatic Deployment

Deployments to production are triggered automatically when:

1. Code is pushed to `main` branch
2. All pipeline stages pass
3. Manual approval (if configured)

### Manual Deployment

To deploy manually:

```bash
# 1. Ensure you're on main branch
git checkout main
git pull origin main

# 2. Build the application
pnpm run build

# 3. Run database migrations
pnpm run db:generate
pnpm run db:migrate

# 4. Deploy (using your deployment method)
# Example: Deploy to cloud provider
```

### Deployment Checklist

Before deploying to production:

- [ ] All tests pass
- [ ] Security audit clean
- [ ] Database migrations tested in staging
- [ ] Environment variables configured
- [ ] Backup current database
- [ ] Prepare rollback plan
- [ ] Schedule maintenance window (if needed)
- [ ] Notify team

## 🔧 Database Migrations

### Development Workflow

```bash
# 1. Make schema changes in drizzle/schema.ts

# 2. Generate migration
pnpm run db:generate

# 3. Review generated SQL in drizzle/*.sql

# 4. Apply migration
pnpm run db:migrate

# 5. Commit migration files
git add drizzle/
git commit -m "Add migration: description"
```

### Production Deployment

1. **Test in Staging**: Apply migrations to staging database first
2. **Backup**: Create database backup before migration
3. **Apply**: Run migrations in production
4. **Verify**: Check migration status and application health
5. **Monitor**: Watch logs for any issues

### Rollback Procedure

If migration fails:

```bash
# 1. Identify the migration to rollback
# 2. Manually create rollback SQL
# 3. Apply rollback
mysql -u root -p ais_aviation < rollback.sql

# 4. Restore from backup if necessary
mysql -u root -p ais_aviation < backup.sql
```

## 🏗️ Environment Configuration

### Required Environment Variables

#### Development

```bash
NODE_ENV=development
DATABASE_URL=mysql://user:pass@localhost:3306/ais_dev
JWT_SECRET=dev-secret-key
STRIPE_SECRET_KEY=sk_test_...
```

#### Staging

```bash
NODE_ENV=staging
DATABASE_URL=mysql://user:pass@staging-host:3306/ais_staging
JWT_SECRET=staging-secret-key-32-chars
STRIPE_SECRET_KEY=sk_test_...
```

#### Production

```bash
NODE_ENV=production
DATABASE_URL=mysql://user:pass@prod-host:3306/ais_production
JWT_SECRET=production-secret-key-change-this
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
COOKIE_SECURE=true
```

## 📊 Monitoring & Observability

### Health Checks

The application exposes health check endpoints:

- `GET /api/health/check` - Overall health status
- `GET /api/health/ready` - Readiness probe (database connectivity)
- `GET /api/health/live` - Liveness probe (application running)

### Metrics to Monitor

**Application Metrics**:

- Request rate (requests/second)
- Response time (P50, P95, P99)
- Error rate (errors/second)
- Active connections

**Business Metrics**:

- Bookings per hour
- Revenue per hour
- Failed payments
- Booking conversion rate

**Infrastructure Metrics**:

- CPU usage
- Memory usage
- Database connections
- Disk I/O

### Logging

Structured logging with Pino:

```typescript
logger.info({ bookingId, userId }, "Booking created");
logger.error({ error, requestId }, "Payment failed");
```

**Log Levels**:

- `debug`: Detailed debugging information
- `info`: General informational messages
- `warn`: Warning messages
- `error`: Error messages
- `fatal`: Critical errors requiring immediate action

## 🐛 Troubleshooting

### Pipeline Failures

#### Lint Stage Fails

```bash
# Run locally
pnpm exec prettier --check .
pnpm run check

# Fix formatting
pnpm exec prettier --write .
```

#### Test Stage Fails

```bash
# Run tests locally
pnpm run test

# Run specific test
pnpm run test -- server/routers/bookings.test.ts

# Debug test
pnpm run test -- --inspect-brk
```

#### Build Stage Fails

```bash
# Clean and rebuild
rm -rf dist/ .output/
pnpm run build

# Check TypeScript errors
pnpm run check
```

### Deployment Issues

#### Database Connection Failed

- Verify DATABASE_URL is correct
- Check firewall rules
- Verify database is running
- Check connection pool limits

#### Migration Failed

- Review migration SQL
- Check for breaking changes
- Verify database user permissions
- Check for data conflicts

#### Application Won't Start

- Check environment variables
- Review application logs
- Verify all dependencies installed
- Check port availability

## 🔒 Security Considerations

### Secrets Management

**DO NOT** commit secrets to repository:

- Use environment variables
- Use secrets manager (AWS Secrets Manager, HashiCorp Vault)
- Rotate secrets regularly
- Use different secrets per environment

### GitHub Actions Secrets

Configure in GitHub repository settings:

- `DATABASE_URL` - Production database URL
- `JWT_SECRET` - JWT signing secret
- `STRIPE_SECRET_KEY` - Stripe API key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook secret

### Deployment Keys

- Use SSH keys for deployment
- Limit key permissions
- Rotate keys regularly
- Never share private keys

## 📈 Performance Optimization

### Build Optimization

```bash
# Analyze bundle size
pnpm run build -- --analyze

# Enable tree shaking
# Already configured in vite.config.ts

# Code splitting
# Implemented via dynamic imports
```

### Cache Strategy

GitHub Actions caches:

- pnpm store directory
- node_modules (via pnpm)
- Build artifacts

## 📚 Best Practices

### Commit Messages

Follow conventional commits:

```
feat: Add user role management
fix: Resolve booking state transition bug
docs: Update CI/CD documentation
test: Add tests for audit logging
refactor: Improve RBAC middleware
```

### Pull Request Process

1. Create feature branch from `develop`
2. Make changes and commit
3. Push and create pull request
4. Wait for CI checks to pass
5. Request code review
6. Address review comments
7. Merge to `develop`
8. Release to `main` when ready

### Release Process

1. Merge `develop` to `main`
2. Tag release: `git tag v1.2.3`
3. Push tag: `git push origin v1.2.3`
4. CI/CD pipeline automatically deploys
5. Monitor deployment
6. Update changelog

## 🆘 Support

For CI/CD issues:

1. Check GitHub Actions logs
2. Review recent changes
3. Consult this documentation
4. Contact DevOps team

## 📖 Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [pnpm Documentation](https://pnpm.io/)
- [Drizzle Kit CLI](https://orm.drizzle.team/kit-docs/overview)
- [Vite Build Guide](https://vitejs.dev/guide/build.html)
