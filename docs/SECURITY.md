# AIS Aviation System - Security Guide

**Version:** 3.0
**Last Updated:** November 2026 (disclosure and dependency maintenance)

## Reporting a Vulnerability

Use this repository's [private vulnerability reporting form](https://github.com/kafaat/ais-aviation-system/security/advisories) and select **Report a vulnerability**. Private vulnerability reporting is enabled for this repository. Maintainers see advisory-management controls on the same page.

Include the affected release or commit, component, reproduction steps, expected and observed behavior, and security impact. Use synthetic accounts and redacted evidence; do not include live credentials, passenger records, or payment data. Keep vulnerability details in the private report while maintainers assess the issue and coordinate a fix.

For ordinary bugs without security impact, use the repository's issue tracker. For an incident in a deployed airline environment, also contact that deployment's established incident-response team through its internal escalation channel.

## Dependency Maintenance

Dependabot checks npm, the auth service's Python packages and container base, contract-test Python packages, and GitHub Actions weekly. Routine update pull requests are bounded and require the normal review and CI checks. Security alerts and security update pull requests remain enabled separately in repository settings.

Security changes must be verified against the resolved dependency graph and the affected runtime. A clean package audit describes the advisories known to that audit at the time; it does not replace application tests or container scans. Any false-positive classification must identify the exact advisory and dependency version and preserve its supporting evidence.

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
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// Admin endpoint — role-based via isAdmin() (server/services/rbac.service.ts)
export const adminProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user || !isAdmin(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
```

### Resource Ownership & Tenant Isolation

`protectedProcedure` only guarantees that **a** user is authenticated — it does
**not** guarantee the caller owns the resource referenced by their input. Any
endpoint that accepts a resource ID from the client (`bookingId`, `splitId`,
`passengerId`, `modificationId`, …) and then reads/mutates by that ID **must**
verify ownership, otherwise it is vulnerable to IDOR (Insecure Direct Object
Reference) and cross-tenant data leakage.

Ownership checks are centralized in
[`server/services/access-control.service.ts`](../server/services/access-control.service.ts):

| Helper                                                       | Use when the input is a… | Behavior                                         |
| ------------------------------------------------------------ | ------------------------ | ------------------------------------------------ |
| `assertBookingOwnership(bookingId, userId, role?)`           | booking ID               | `NOT_FOUND` if missing, `FORBIDDEN` if not owner |
| `assertSplitOwnership(splitId, userId, role?)`               | split-payment ID         | resolves split → booking → owner                 |
| `assertPassengerOwnership(passengerId, userId, role?)`       | passenger ID             | resolves passenger → booking → owner             |
| `assertModificationOwnership(modificationId, userId, role?)` | modification ID          | checks `bookingModifications.userId`             |
| `isBookingOwnedBy(bookingId, userId)`                        | boolean check            | non-throwing variant                             |

Admins (per `isAdmin(role)`) bypass the ownership check so support staff can
service any tenant.

**Required pattern:**

```typescript
getStatus: protectedProcedure
  .input(z.object({ bookingId: z.number() }))
  .query(async ({ input, ctx }) => {
    // Reject access to bookings the caller does not own (admins bypass)
    await assertBookingOwnership(input.bookingId, ctx.user.id, ctx.user.role);
    return await service.getSplitPaymentStatus(input.bookingId);
  });
```

Endpoints currently protected by these helpers include refunds
(`checkRefundable`, `calculateCancellationFee`), split payments (`getStatus`,
`sendRequest`, `resendRequest`, `sendAllRequests`, `cancelSplit`, `cancelAll`,
`checkAllPaid`), baggage (`register`, `getBookingBaggage`,
`getPassengerBaggage`), and booking modifications (`getDetails`). Bookings,
payments, wallet, saved-passengers, price-alerts, notifications and favorites
enforce ownership inline by scoping every query to `ctx.user.id`.

> **Review rule:** when adding any `protectedProcedure` that takes a resource ID
> as input, add the matching `assert*Ownership` call (or scope the query to
> `ctx.user.id`) before touching the resource.

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

### Webhook Event Safety

Stripe sends multiple events for a single payment (`checkout.session.completed` and `payment_intent.succeeded`). To prevent double-processing:

- **Seat deduction** happens exclusively in `checkout.session.completed` handler
- `payment_intent.succeeded` is a status-only fallback (no seat deduction)
- Each event is deduplicated via the `stripeEvents` table
- All webhook handlers run inside database transactions

**Refund seat restoration:**

```typescript
// Full refund → cancel booking + restore seats (atomically in transaction)
if (isFullRefund && previousStatus === "confirmed") {
  await tx
    .update(flights)
    .set({
      economyAvailable: sql`${flights.economyAvailable} + ${booking.numberOfPassengers}`,
    })
    .where(eq(flights.id, booking.flightId));
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

### Prometheus Scrape Authentication

`GET /api/metrics` exposes operational route labels and resource metrics. In
`NODE_ENV=production`, an absent, empty or invalid `METRICS_TOKEN` disables the
endpoint with HTTP 503; the application and readiness APIs remain unchanged.
With a configured token, missing, malformed or incorrect bearer authorization
returns HTTP 401. Metrics are returned only on a successful scrape (HTTP 200).
Development and test modes allow unauthenticated scrapes when the token is absent;
a configured token still requires authentication in those modes.

Generate a dedicated random token, for example with `openssl rand -hex 32`, and
set it as the web process's `METRICS_TOKEN` through your secret manager. Use the
token alone, not the `Bearer` scheme prefix. In production tokens require at
least 32 ASCII characters; use a cryptographically random secret (length alone
does not prove entropy). Allowed characters are ASCII letters, digits or
`-._~+/`, optionally followed by `=` padding; whitespace,
quotes and other characters are invalid. Do not commit the value or log request
authorization headers.

Provision the same token in a private file readable by Prometheus and configure
the scrape job (replace the illustrative hostname with your authorized target):

```yaml
scrape_configs:
  - job_name: ais
    metrics_path: /api/metrics
    scheme: https
    authorization:
      type: "Bearer"
      credentials_file: /etc/prometheus/secrets/ais-metrics-token
    static_configs:
      - targets: ["ais.example.com"]
```

Prometheus sends the token in the Authorization header using the `Bearer` scheme;
it does not expand environment variables in `credentials_file`. Keep TLS
verification enabled, restrict network access to the scrape endpoint, and ensure
any reverse proxy forwards this header.
Rotate both copies together and verify that anonymous and wrong-token scrapes
fail while the authorized scrape succeeds. No Kubernetes credentials are
provided or created by this configuration.

### Service-to-Service Auth Credential

The FastAPI auth service answers password questions for any e-mail address, so
only the Node backend may call it. Both processes share one secret,
`AUTH_SERVICE_TOKEN`, presented on every call in the `X-Auth-Service-Token`
header and compared in constant time. The boundary fails closed on both sides:

| Side                    | Condition                                                                                  | Behaviour                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Auth service (any mode) | Credential configured, header missing or wrong                                             | HTTP 401 `Service credential required.` on register, login, verify        |
| Auth service (any mode) | Credential not configured (only possible with `DEBUG=true`)                                | HTTP 503 `Service credential not configured.`; nothing is read or written |
| Auth service start-up   | `DEBUG` unset or false and token missing, blank, placeholder or shorter than 32 characters | Settings validation fails before the database engine is created           |
| Node web start-up       | `NODE_ENV=production` and token missing, blank, placeholder or shorter than 32 characters  | `startServer` throws; the process does not listen                         |
| Node client (any mode)  | Unusable credential                                                                        | No request is sent; the caller sees `Auth service unavailable`            |
| Compose                 | `AUTH_SERVICE_TOKEN` unset in the shell or `.env`                                          | `docker compose` refuses to interpolate; no service starts                |

`GET /auth/health` stays public so orchestration can observe readiness.
Known placeholders rejected everywhere include `CHANGE_ME`, `changeme`,
`secret`, `token` and the former fixed development-example token. Uniform
repeated-character values are also rejected; a minimum length is not proof of
entropy. The `.env.example` token is intentionally blank: for development,
generate a fresh value locally and configure it on both sides. For deployment,
generate the secret with `openssl rand -hex 32` and provision the identical
value on the auth service and on every Node API replica (`api1`..`api3` in
`docker-compose.production.yml`, `app` in `docker-compose.prod.yml`,
`ais-web` and `ais-auth` on Railway).

**Rotation is not automatically zero downtime:** the protocol accepts one
current token, so restarting either side with a different value before the
other may temporarily break logins. Coordinate an approved maintenance window
or a staged shared-variable rollout, verify the private service handshake
afterward, and retain a working matching value as the configuration rollback.
Do not roll back the code to its previous fail-open behavior.

Evidence: `auth-service/test_config.py` (start-up refusal), `auth-service/test_http_contract.py`
(401/503 contracts), `server/__tests__/auth-service-credential.test.ts` (Node
start-up and client policy), `scripts/ci/test_compose_auth_service_token.py`
(real `docker compose config` interpolation, negative and positive), and the
CI step "Verify auth service credential boundary over real HTTP", which runs
`scripts/ci/auth_service_credential_probe.py` and the Node client against the
live Uvicorn process with the correct and a wrong credential.

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

Deployment owners must keep their security, operations, database, and legal escalation contacts in their internal incident-response runbook. This repository does not verify or publish those deployment-specific contacts. Repository vulnerability reports should use the private reporting route above.

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

For Saudi personal data incidents use the [controller notification and evidence procedure](operations/saudi-privacy-incident.md).

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
