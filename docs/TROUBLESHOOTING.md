# AIS Aviation System - Troubleshooting Guide

**Version:** 2.0  
**Last Updated:** January 2026

---

## Table of Contents

1. [Quick Diagnostics](#quick-diagnostics)
2. [Installation Issues](#installation-issues)
3. [Database Problems](#database-problems)
4. [API Errors](#api-errors)
5. [Frontend Issues](#frontend-issues)
6. [Payment Issues](#payment-issues)
7. [Performance Problems](#performance-problems)
8. [Deployment Issues](#deployment-issues)
9. [Common Error Messages](#common-error-messages)
10. [Getting Help](#getting-help)

---

## Quick Diagnostics

### Health Check Commands

```bash
# Check if services are running
pnpm health:check

# Or manually:
curl http://localhost:3000/api/health/check

# Expected response:
{
  "status": "ok",
  "timestamp": "2026-01-12T10:00:00.000Z",
  "services": {
    "database": "ok",
    "stripe": "ok"
  }
}
```

### System Requirements Check

```bash
# Node.js version (should be 22+)
node --version

# pnpm version
pnpm --version

# MySQL version (should be 8.0+)
mysql --version

# Available disk space
df -h
```

---

## Installation Issues

### Problem: `pnpm install` fails

**Symptoms:**

```
ERR_PNPM_FETCH_404 GET https://registry.npmjs.org/...
```

**Solutions:**

1. **Clear pnpm cache:**

```bash
pnpm store prune
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

2. **Check network/proxy settings:**

```bash
pnpm config set registry https://registry.npmjs.org/
```

3. **Use different Node version:**

```bash
nvm install 22
nvm use 22
pnpm install
```

---

### Problem: TypeScript compilation errors after install

**Symptoms:**

```
error TS2307: Cannot find module '@/components/...'
error TS2339: Property 'xyz' does not exist on type 'ABC'
```

**Solutions:**

1. **Ensure all dependencies are installed:**

```bash
# Check for missing peer dependencies
pnpm install

# If you see missing packages like uuid, jsonwebtoken, etc.
pnpm add uuid jsonwebtoken @types/uuid @types/jsonwebtoken
```

2. **Regenerate TypeScript declarations:**

```bash
pnpm check
```

3. **Clean build cache:**

```bash
rm -rf dist .tsbuildinfo
pnpm build
```

4. **Check tsconfig.json paths:**

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./client/src/*"]
    }
  }
}
```

---

### Problem: ESLint configuration errors

**Symptoms:**

```
ESLint couldn't find an eslint.config.(js|mjs|cjs) file
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@eslint/js'
```

**Solutions:**

1. **Ensure ESLint v9 configuration exists:**

```bash
# Check if eslint.config.js exists
ls -la eslint.config.js

# If missing, ESLint v9 requires this file instead of .eslintrc.cjs
```

2. **Install required ESLint dependencies:**

```bash
pnpm add -D @eslint/js @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint-config-prettier
```

3. **Run ESLint:**

```bash
pnpm lint

# To auto-fix issues:
pnpm lint:fix
```

---

### Problem: Test failures with database connection

**Symptoms:**

```
ECONNREFUSED: Connection refused
DrizzleQueryError: Failed query
Tests failing with database errors
```

**Solutions:**

1. **Set up test database:**

```bash
# Create test database
mysql -u root -p
CREATE DATABASE ais_aviation_test;
EXIT;

# Configure .env.test with test database URL
echo "DATABASE_URL=mysql://username:password@localhost:3306/ais_aviation_test" > .env.test
```

2. **Run migrations on test database:**

```bash
# Load .env.test environment
export $(cat .env.test | xargs)

# Apply database schema
pnpm db:push

# Optionally seed test data
npx tsx scripts/seed-data.mjs
```

3. **Run tests:**

```bash
pnpm test
```

---

## Database Problems

### Problem: "Database connection failed"

**Symptoms:**

```
Error: connect ECONNREFUSED 127.0.0.1:3306
```

**Solutions:**

1. **Check if MySQL is running:**

```bash
# macOS/Linux
sudo systemctl status mysql
# or
ps aux | grep mysql

# Start MySQL
sudo systemctl start mysql
```

2. **Verify DATABASE_URL in .env:**

```bash
# Correct format:
DATABASE_URL=mysql://username:password@localhost:3306/database_name

# Test connection:
mysql -h localhost -u username -p database_name
```

3. **Check firewall/network:**

```bash
# Test port accessibility
telnet localhost 3306
# or
nc -zv localhost 3306
```

---

### Problem: "Table doesn't exist" errors

**Symptoms:**

```
Error: Table 'ais_aviation.flights' doesn't exist
```

**Solutions:**

1. **Run migrations:**

```bash
pnpm db:push
```

2. **Verify database schema:**

```bash
mysql -u root -p
USE ais_aviation;
SHOW TABLES;
```

3. **Reset database (development only):**

```bash
# WARNING: This deletes all data!
mysql -u root -p -e "DROP DATABASE ais_aviation; CREATE DATABASE ais_aviation;"
pnpm db:push
npx tsx scripts/seed-data.mjs
```

---

### Problem: Migration failures

**Symptoms:**

```
Error applying migration: Duplicate column name 'status'
```

**Solutions:**

1. **Check migration history:**

```bash
pnpm drizzle-kit studio
# View __drizzle_migrations table
```

2. **Manual migration rollback:**

```sql
-- View migrations
SELECT * FROM __drizzle_migrations ORDER BY id DESC;

-- Manually revert if needed
-- (Be careful with this!)
```

3. **Regenerate migrations:**

```bash
rm -rf drizzle/migrations
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

---

## API Errors

### Problem: 401 Unauthorized

**Symptoms:**

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required"
  }
}
```

**Solutions:**

1. **Check cookie:**

```javascript
// In browser console
document.cookie;
// Should contain 'auth_token=...'
```

2. **Verify JWT_SECRET:**

```bash
# .env file should have JWT_SECRET
cat .env | grep JWT_SECRET
```

3. **Re-authenticate:**

```bash
# Clear cookies and log in again
# In browser: DevTools > Application > Cookies > Clear
```

---

### Problem: 500 Internal Server Error

**Symptoms:**

```json
{
  "error": {
    "code": "INTERNAL_SERVER_ERROR",
    "message": "An error occurred"
  }
}
```

**Solutions:**

1. **Check server logs:**

```bash
# If using pnpm dev
# Logs appear in terminal

# Production logs
tail -f logs/error.log
```

2. **Enable debug mode:**

```bash
# In .env
LOG_LEVEL=debug
DEBUG=true

# Restart server
pnpm dev
```

3. **Check error stack trace:**

```typescript
// Look for error details in server console
// Example error might show:
// Error: Stripe API key not configured
```

---

### Problem: CORS errors

**Symptoms:**

```
Access to fetch at 'http://localhost:3000/api/trpc' has been blocked by CORS policy
```

**Solutions:**

1. **Check FRONTEND_URL in .env:**

```bash
FRONTEND_URL=http://localhost:3000
```

2. **Verify CORS configuration:**

```typescript
// server/_core/index.ts
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  })
);
```

3. **Use correct protocol (http vs https):**

```bash
# Development: http://localhost:3000
# Production: https://your-domain.com
```

---

## Frontend Issues

### Problem: White screen / App won't load

**Symptoms:**

- Blank page
- No errors in console
- Network tab shows no requests

**Solutions:**

1. **Check browser console:**

```
F12 > Console tab
# Look for JavaScript errors
```

2. **Clear browser cache:**

```
Ctrl+Shift+Delete > Clear cache
# or
Hard reload: Ctrl+Shift+R
```

3. **Rebuild frontend:**

```bash
rm -rf dist client/dist
pnpm build
```

---

### Problem: Components not rendering / style issues

**Symptoms:**

- UI looks broken
- Components appear unstyled
- Tailwind classes not working

**Solutions:**

1. **Check Tailwind configuration:**

```bash
# Ensure tailwind is installed
pnpm list tailwindcss

# Restart dev server
pnpm dev
```

2. **Verify CSS imports:**

```typescript
// client/src/main.tsx should have:
import "./index.css";
```

3. **Clear Vite cache:**

```bash
rm -rf node_modules/.vite
pnpm dev
```

---

### Problem: React Query / tRPC errors

**Symptoms:**

```
useQuery is not a function
trpc.flights.search is undefined
```

**Solutions:**

1. **Verify tRPC client setup:**

```typescript
// client/src/lib/trpc.ts
import { createTRPCReact } from "@trpc/react-query";
export const trpc = createTRPCReact<AppRouter>();
```

2. **Check Provider wrapping:**

```typescript
// client/src/main.tsx
<QueryClientProvider client={queryClient}>
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <App />
  </trpc.Provider>
</QueryClientProvider>
```

3. **Ensure router types are exported:**

```typescript
// server/routers.ts
export type AppRouter = typeof appRouter;
```

---

## Payment Issues

### Problem: Stripe checkout doesn't open

**Symptoms:**

- Payment button does nothing
- No redirect to Stripe

**Solutions:**

1. **Verify STRIPE_SECRET_KEY:**

```bash
cat .env | grep STRIPE_SECRET_KEY
# Should start with sk_test_ or sk_live_
```

2. **Check Stripe initialization:**

```typescript
// server/stripe.ts
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY not set");
}
```

3. **Test Stripe connection:**

```bash
# Install Stripe CLI
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

---

### Problem: Webhook signature verification failed

**Symptoms:**

```
Stripe webhook signature verification failed
```

**Solutions:**

1. **Use correct webhook secret:**

```bash
# Get from Stripe CLI
stripe listen
# Copy the webhook signing secret (whsec_...)

# Add to .env
STRIPE_WEBHOOK_SECRET=whsec_...
```

2. **Check webhook endpoint:**

```typescript
// Should be raw body, not parsed JSON
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);
```

3. **Verify Stripe CLI forwarding:**

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook --print-secret
```

---

### Problem: Payment succeeds but booking not confirmed

**Symptoms:**

- Money charged
- Booking still in "pending" status

**Solutions:**

1. **Check webhook logs:**

```bash
# Server logs should show:
# "Webhook received: checkout.session.completed"
```

2. **Manually trigger webhook:**

```bash
stripe trigger checkout.session.completed
```

3. **Check database:**

```sql
SELECT * FROM payments WHERE booking_id = ?;
SELECT * FROM bookings WHERE id = ?;
```

---

## Performance Problems

### Problem: Slow API responses

**Symptoms:**

- Requests taking >1 second
- Timeouts

**Solutions:**

1. **Enable query logging:**

```typescript
// drizzle.config.ts
export default {
  // ...
  verbose: true,
  strict: true,
};
```

2. **Check for missing indexes:**

```sql
EXPLAIN SELECT * FROM flights WHERE origin_airport_id = 1;
-- Should show "Using index"
```

3. **Add database indexes:**

```sql
CREATE INDEX idx_flight_route ON flights(origin_airport_id, destination_airport_id);
CREATE INDEX idx_booking_user ON bookings(user_id);
```

---

### Problem: High memory usage

**Symptoms:**

- Server crashes
- "JavaScript heap out of memory"

**Solutions:**

1. **Increase Node.js memory:**

```bash
NODE_OPTIONS=--max-old-space-size=4096 pnpm dev
```

2. **Check for memory leaks:**

```bash
# Use Node inspector
node --inspect server/_core/index.ts
# Open chrome://inspect
```

3. **Review database connection pooling:**

```typescript
// Ensure connections are properly closed
await db.transaction(async tx => {
  // ... operations
}); // Auto-closes connection
```

---

## Deployment Issues

### Problem: Build fails in production

**Symptoms:**

```
Error: Cannot find module './config'
```

**Solutions:**

1. **Check TypeScript compilation:**

```bash
pnpm check
pnpm build
```

2. **Ensure all dependencies in package.json:**

```bash
# Check for missing dependencies
pnpm install --frozen-lockfile
```

3. **Verify environment variables:**

```bash
# Production should have all required vars
node -e "require('dotenv').config(); console.log(process.env.DATABASE_URL)"
```

---

### Problem: Docker container fails to start

**Symptoms:**

```
Container exited with code 1
```

**Solutions:**

1. **Check Docker logs:**

```bash
docker logs <container_id>
```

2. **Verify Dockerfile:**

```dockerfile
# Ensure all build steps complete
FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install
COPY . .
RUN pnpm build
CMD ["pnpm", "start"]
```

3. **Test build locally:**

```bash
docker build -t ais-test .
docker run -p 3000:3000 ais-test
```

---

## Common Error Messages

### "Cannot read property 'id' of undefined"

**Cause:** Accessing user data without checking authentication

**Fix:**

```typescript
// Always check if user exists
if (!ctx.user) {
  throw new TRPCError({ code: "UNAUTHORIZED" });
}
const userId = ctx.user.id; // Now safe
```

---

### "Flight is fully booked"

**Cause:** No available seats

**Fix:**

```typescript
// Check availability before booking
const flight = await db.query.flights.findFirst({
  where: eq(flights.id, flightId),
});

if (flight.availableSeats < passengers.length) {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "Not enough seats available",
  });
}
```

---

### "Idempotency key already used"

**Cause:** Duplicate payment attempt

**Fix:**

```typescript
// This is expected behavior - return existing payment
const existing = await getPaymentByIdempotencyKey(key);
if (existing) {
  return existing; // Return existing instead of error
}
```

---

## Debug Tools

### Enable verbose logging

```bash
# .env
LOG_LEVEL=debug
DEBUG=true
ENABLE_QUERY_LOGGING=true
```

### Database query debugging

```typescript
// Enable Drizzle debug mode
import { drizzle } from "drizzle-orm/mysql2";

const db = drizzle(connection, {
  logger: {
    logQuery: query => console.log("Query:", query),
  },
});
```

### Network debugging

```bash
# Monitor all HTTP requests
curl -v http://localhost:3000/api/health/check

# Test specific endpoint
curl -X POST http://localhost:3000/api/trpc/flights.search \
  -H "Content-Type: application/json" \
  -d '{"origin":"RUH","destination":"JED","date":"2026-02-15"}'
```

---

## Getting Help

### Before asking for help, collect:

1. **Error message** (full stack trace)
2. **Environment** (OS, Node version, database version)
3. **Steps to reproduce**
4. **Expected vs actual behavior**
5. **Recent changes** (what did you change before the error?)

### Where to get help:

1. **Documentation:** Check `docs/` folder
2. **GitHub Issues:** https://github.com/kafaat/ais-aviation-system/issues
3. **Email:** support@ais.com
4. **Stack Overflow:** Tag with `ais-aviation-system`

### Create a good bug report:

```markdown
## Bug Report

**Environment:**

- Node.js: v22.0.0
- Database: MySQL 8.0
- OS: Ubuntu 22.04

**Steps to Reproduce:**

1. Start server with `pnpm dev`
2. Navigate to /flights
3. Click "Search" button

**Expected:**
Flight results should appear

**Actual:**
500 Internal Server Error

**Error Message:**
```

Error: Cannot connect to database
at Connection.connect (db.ts:45)
...

```

**Additional Context:**
This started happening after updating dependencies
```

---

## Maintenance Commands

```bash
# Check for outdated packages
pnpm outdated

# Update dependencies
pnpm update

# Security audit
pnpm audit

# Clean everything
rm -rf node_modules dist .tsbuildinfo
pnpm install
pnpm build

# Database backup
mysqldump -u root -p ais_aviation > backup_$(date +%Y%m%d).sql

# View application logs
tail -f logs/combined.log

# Monitor system resources
top
htop  # if installed
```

---

**Remember:** Most issues can be solved by:

1. Reading error messages carefully
2. Checking environment variables
3. Restarting the server
4. Clearing caches
5. Reading the documentation

**Last Updated:** January 2026
