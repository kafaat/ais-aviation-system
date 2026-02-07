# AIS Aviation System - Security Guide

**Version:** 3.0
**Last Updated:** February 2026

---

## Table of Contents

1. [Security Overview](#security-overview)
2. [Authentication & Authorization](#authentication--authorization)
3. [Data Protection](#data-protection)
4. [Input Validation](#input-validation)
5. [Payment Security](#payment-security)
6. [API Security](#api-security)
7. [Database Security](#database-security)
8. [Infrastructure Security](#infrastructure-security)
9. [Security Best Practices](#security-best-practices)
10. [Incident Response](#incident-response)

---

## Security Overview

AIS Aviation System implements multiple layers of security to protect user data, prevent unauthorized access, and ensure secure payment processing.

### Security Principles

1. **Defense in Depth** - Multiple security layers
2. **Least Privilege** - Minimum necessary permissions
3. **Secure by Default** - Security enabled out of the box
4. **Zero Trust** - Verify everything, trust nothing
5. **Data Minimization** - Collect only necessary data

---

## Authentication & Authorization

### Authentication Flow

```
User → OAuth Server (Manus) → JWT Token → Backend Validation → Access Granted
```

### JWT Token Security

**Configuration:**

```typescript
{
  algorithm: 'HS256',
  expiresIn: '7d',
  issuer: 'ais-aviation',
  audience: 'ais-users',
}
```

**Token Storage:**

- **httpOnly Cookie** - Prevents XSS attacks
- **Secure Flag** - HTTPS only in production
- **SameSite: 'lax'** - CSRF protection
- **Domain-specific** - Limits scope

### Authorization Levels

1. **Public** - No authentication required
2. **User** - Authenticated users
3. **Admin** - Admin role required

**Example Implementation:**

```typescript
// Public endpoint
export const publicProcedure = t.procedure;

// Protected endpoint
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// Admin endpoint
export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.user.isAdmin) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next();
});
```

### Session Management

- **Session Duration:** 7 days
- **Refresh Mechanism:** Automatic on activity
- **Logout:** Server-side session invalidation
- **Concurrent Sessions:** Allowed (track devices in future)

---

## Data Protection

### Encryption

**In Transit:**

- **TLS 1.3** for all HTTPS connections
- **Minimum cipher suite:** TLS_AES_256_GCM_SHA384

**At Rest:**

- Database encryption (MySQL native encryption)
- Sensitive fields hashed (passwords, if stored)
- Payment data tokenized (Stripe)

### PII (Personally Identifiable Information)

**Identified PII Fields:**

- Email addresses
- Phone numbers
- Passport numbers
- Credit card numbers
- Addresses

**Protection Measures:**

1. **Logging Redaction:**

```typescript
// Automatic PII masking in logs
logger.info({
  email: "user@example.com", // Logged as: 'u***@example.com'
  phone: "+966501234567", // Logged as: '+966*****4567'
});
```

2. **Database Access Control:**

```sql
-- Principle of least privilege
GRANT SELECT, INSERT, UPDATE ON bookings TO 'app_user';
REVOKE DELETE ON bookings FROM 'app_user';
```

3. **Data Retention:**

- Active bookings: Indefinite
- Completed bookings: 7 years (compliance)
- Cancelled bookings: 2 years
- Logs: 90 days
- Personal data: Deletable on request (GDPR)

---

## Input Validation

### Zod Schema Validation

All inputs validated using Zod schemas:

```typescript
const bookingSchema = z.object({
  flightId: z.number().positive(),
  passengers: z
    .array(
      z.object({
        firstName: z.string().min(1).max(100),
        lastName: z.string().min(1).max(100),
        passportNumber: z.string().regex(/^[A-Z0-9]{6,20}$/),
        email: z.string().email().optional(),
        phone: z
          .string()
          .regex(/^\+?[1-9]\d{1,14}$/)
          .optional(),
      })
    )
    .min(1)
    .max(9),
});
```

### SQL Injection Prevention

**Using Drizzle ORM:**

```typescript
// ✅ SAFE - Parameterized query
await db.select().from(flights).where(eq(flights.id, flightId));

// ❌ UNSAFE - Never do this
await db.execute(sql`SELECT * FROM flights WHERE id = ${flightId}`);
```

### XSS Prevention

**React Auto-Escaping:**

```tsx
// ✅ SAFE - React escapes by default
<div>{userInput}</div>

// ⚠️ DANGEROUS - Only use with trusted content
<div dangerouslySetInnerHTML={{ __html: trustedHTML }} />
```

### CSRF Protection

**SameSite Cookies:**

```typescript
res.cookie("auth_token", token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax", // CSRF protection
  maxAge: 7 * 24 * 60 * 60 * 1000,
});
```

---

## Payment Security

### PCI DSS Compliance

**Stripe Integration:**

- **No card data** touches our servers
- Stripe is **PCI DSS Level 1 certified**
- All payments processed via Stripe Checkout
- Tokenization for saved cards

**Webhook Security:**

```typescript
import { stripe } from "./stripe";

export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  try {
    // Verify webhook signature
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);

    // Process verified event
    await processPaymentEvent(event);
  } catch (err) {
    logger.error("Webhook signature verification failed");
    return res.status(400).send("Invalid signature");
  }
}
```

### Payment Idempotency

Prevent duplicate charges:

```typescript
const idempotencyKey = `booking-${bookingId}-${timestamp}`;

const existingPayment = await db.query.payments.findFirst({
  where: eq(payments.idempotencyKey, idempotencyKey),
});

if (existingPayment) {
  return existingPayment; // Return existing payment
}

// Create new payment with idempotency key
```

### Refund Security

```typescript
// Verify ownership before refund
const booking = await db.query.bookings.findFirst({
  where: and(
    eq(bookings.id, bookingId),
    eq(bookings.userId, ctx.user.id) // Ownership check
  ),
});

if (!booking) {
  throw new TRPCError({ code: "FORBIDDEN" });
}

// Process refund
```

---

## API Security

### Rate Limiting

**Implementation:**

```typescript
import rateLimit from "express-rate-limit";

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: "Too many requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/trpc", apiLimiter);
```

**Custom Limits:**

- Public APIs: 100 req/15min
- Authenticated: 200 req/15min
- Admin: 500 req/15min
- Webhooks: 1000 req/15min

### Request ID Tracking

Every request gets a unique ID for tracing:

```typescript
export function requestIdMiddleware(req, res, next) {
  req.id = nanoid(16);
  res.setHeader("X-Request-ID", req.id);
  next();
}
```

### CORS Configuration

```typescript
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
```

---

## Database Security

### Connection Security

```typescript
const connectionConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl:
    process.env.NODE_ENV === "production"
      ? {
          rejectUnauthorized: true,
          ca: fs.readFileSync("/path/to/ca-cert.pem"),
        }
      : false,
};
```

### Database User Permissions

```sql
-- Application user (limited permissions)
CREATE USER 'ais_app'@'%' IDENTIFIED BY 'secure_password';
GRANT SELECT, INSERT, UPDATE ON ais_aviation.* TO 'ais_app'@'%';

-- Admin user (full permissions)
CREATE USER 'ais_admin'@'localhost' IDENTIFIED BY 'admin_password';
GRANT ALL PRIVILEGES ON ais_aviation.* TO 'ais_admin'@'localhost';

-- Read-only user (for analytics)
CREATE USER 'ais_readonly'@'%' IDENTIFIED BY 'readonly_password';
GRANT SELECT ON ais_aviation.* TO 'ais_readonly'@'%';
```

### Backup & Recovery

```bash
# Daily automated backups
0 2 * * * mysqldump -u backup_user -p ais_aviation > /backups/ais_$(date +\%Y\%m\%d).sql

# Encrypt backups
gpg --encrypt --recipient backup@ais.com ais_20260112.sql

# Offsite storage
aws s3 cp ais_20260112.sql.gpg s3://ais-backups/
```

### Audit Logging

Track all sensitive operations:

```typescript
await db.insert(auditLog).values({
  userId: ctx.user.id,
  action: "booking_cancelled",
  resourceType: "booking",
  resourceId: bookingId,
  ipAddress: req.ip,
  userAgent: req.headers["user-agent"],
  timestamp: new Date(),
});
```

---

## Infrastructure Security

### Environment Variables

**Never commit secrets:**

```bash
# ✅ Good - Use environment variables
DATABASE_URL=mysql://user:pass@localhost/db

# ❌ Bad - Hardcoded credentials
const db = mysql.connect('mysql://root:admin123@localhost/db');
```

**Validation:**

```typescript
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  JWT_SECRET: z.string().min(32),
});

const env = envSchema.parse(process.env);
```

### Docker Security

```dockerfile
# Use specific version (not 'latest')
FROM node:22-alpine

# Run as non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

# Copy only necessary files
COPY --chown=nodejs:nodejs package.json ./
RUN npm install --production

# Use multi-stage build
FROM node:22-alpine AS builder
# ... build steps
FROM node:22-alpine AS runner
COPY --from=builder /app/dist ./dist
```

### HTTPS Enforcement

```typescript
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    if (req.header("x-forwarded-proto") !== "https") {
      return res.redirect(`https://${req.header("host")}${req.url}`);
    }
    next();
  });
}
```

---

## Security Best Practices

### For Developers

1. **✅ DO:**
   - Validate all inputs
   - Use parameterized queries
   - Keep dependencies updated
   - Log security events
   - Use TypeScript strict mode
   - Review code for security issues

2. **❌ DON'T:**
   - Store secrets in code
   - Trust user input
   - Use `eval()` or `Function()`
   - Expose error stack traces
   - Use weak encryption
   - Disable security features

### Secure Coding Checklist

```
□ Input validated with Zod
□ SQL queries parameterized
□ Authentication checked
□ Authorization verified
□ Sensitive data masked in logs
□ Error handling doesn't leak info
□ Rate limiting applied
□ HTTPS enforced
□ Dependencies up to date
□ Security tests written
```

### Dependency Security

```bash
# Check for vulnerabilities
pnpm audit

# Fix automatically
pnpm audit fix

# Update dependencies
pnpm update

# Use lockfile
# Always commit pnpm-lock.yaml
```

---

## Incident Response

### Security Incident Procedure

1. **Detect** - Monitor logs and alerts
2. **Contain** - Isolate affected systems
3. **Investigate** - Determine scope and impact
4. **Eradicate** - Remove threat
5. **Recover** - Restore normal operations
6. **Learn** - Post-incident review

### Emergency Contacts

| Role           | Contact          | Availability   |
| -------------- | ---------------- | -------------- |
| Security Lead  | security@ais.com | 24/7           |
| DevOps Team    | devops@ais.com   | 24/7           |
| Database Admin | dba@ais.com      | Business hours |
| Legal Team     | legal@ais.com    | Business hours |

### Data Breach Response

```
1. Immediately revoke all API keys and tokens
2. Rotate database credentials
3. Notify affected users within 72 hours (GDPR)
4. Document incident details
5. Contact regulatory authorities if required
6. Conduct forensic analysis
7. Implement preventive measures
```

### Error Tracking with Sentry

The system integrates Sentry for real-time error tracking on both client and server:

```typescript
// Client: client/src/lib/sentry.ts
// Server: server/services/sentry.service.ts
```

**Security considerations:**

- DSN values validated before initialization (placeholder values are rejected)
- Invalid DSN causes graceful fallback, not a crash
- PII is scrubbed from error reports by default
- Sentry DSN should be kept in environment variables, never hardcoded

### Security Monitoring

**Key Metrics:**

- Failed login attempts
- Rate limit violations
- Payment failures
- Admin action logs
- Database access patterns
- API error rates
- Sentry error rates and trends

**Alerting Thresholds:**

- > 10 failed logins/minute
- > 5 payment failures from same IP
- Unusual admin activity
- Database performance degradation
- Suspicious SQL patterns

---

## Security Checklist for Production

### Pre-Launch

```
□ Environment variables validated
□ Secrets rotated (not using dev keys)
□ HTTPS enforced
□ Rate limiting enabled
□ Database backups configured
□ Monitoring and alerting set up
□ Incident response plan documented
□ Security audit completed
□ Penetration testing done
□ GDPR compliance verified
```

### Regular Maintenance

```
□ Weekly: Review security logs
□ Monthly: Update dependencies
□ Quarterly: Security audit
□ Annually: Penetration testing
□ Ongoing: Monitor vulnerabilities
```

---

## Compliance

### GDPR (General Data Protection Regulation)

**User Rights:**

1. **Right to Access** - Download personal data
2. **Right to Rectification** - Update incorrect data
3. **Right to Erasure** - Delete account and data
4. **Right to Portability** - Export data in standard format

**Implementation:**

```typescript
// Data export
export async function exportUserData(userId: number) {
  const data = {
    profile: await getUserProfile(userId),
    bookings: await getUserBookings(userId),
    payments: await getUserPayments(userId),
    loyaltyAccount: await getLoyaltyAccount(userId),
  };
  return JSON.stringify(data, null, 2);
}

// Data deletion
export async function deleteUserData(userId: number) {
  await db.transaction(async tx => {
    await tx.delete(loyaltyAccounts).where(eq(loyaltyAccounts.userId, userId));
    await tx
      .update(bookings)
      .set({ userId: null })
      .where(eq(bookings.userId, userId));
    await tx.delete(users).where(eq(users.id, userId));
  });
}
```

### PCI DSS (Payment Card Industry Data Security Standard)

**Compliance through Stripe:**

- All card data processed by Stripe (PCI Level 1)
- No card numbers stored on our servers
- Tokenization for recurring payments
- Secure communication channels

---

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Stripe Security](https://stripe.com/docs/security/stripe)
- [GDPR Compliance](https://gdpr.eu/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

---

**Remember:** Security is everyone's responsibility. When in doubt, ask the security team!

**Last Updated:** February 2026
