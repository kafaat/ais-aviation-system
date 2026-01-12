# Security Guide - AIS Aviation System

This document provides comprehensive security guidelines and best practices for the AIS Aviation System.

## Table of Contents
- [Authentication & Authorization](#authentication--authorization)
- [Role-Based Access Control (RBAC)](#role-based-access-control-rbac)
- [Payment Security](#payment-security)
- [Audit Logging](#audit-logging)
- [API Security](#api-security)
- [Data Protection](#data-protection)
- [Security Headers](#security-headers)

## Authentication & Authorization

### OAuth 2.0 Integration
The system uses OAuth 2.0 for authentication via Manus OAuth service.

**Configuration:**
```env
OAUTH_SERVER_URL=https://oauth.manus.space
JWT_SECRET=your-secure-secret-minimum-32-characters
```

**Best Practices:**
- JWT tokens are valid for 7 days
- Use `httpOnly`, `secure`, and `sameSite: 'strict'` cookies
- Implement token rotation for sensitive operations
- Never expose JWT_SECRET in client-side code

## Role-Based Access Control (RBAC)

### Available Roles

| Role | Description | Use Case |
|------|-------------|----------|
| `user` | Regular customer | Book flights, manage own bookings |
| `support` | Customer support agent | View/modify customer bookings |
| `finance` | Finance department | Handle payments, refunds, reports |
| `ops` | Operations team | Manage flight schedules, delays |
| `airline_admin` | Airline administrator | Full airline operations management |
| `super_admin` | System administrator | Full system access |

### Permission Model

```typescript
import { requireRoles } from '../_core/trpc';

// Restrict endpoint to specific roles
export const cancelFlight = protectedProcedure
  .use(requireRoles(['super_admin', 'airline_admin', 'ops']))
  .mutation(async ({ ctx, input }) => {
    // Only super_admin, airline_admin, and ops can cancel flights
  });
```

### Role Hierarchy

```
super_admin (Full Access)
    ├── airline_admin (Airline Management)
    ├── finance (Financial Operations)
    ├── ops (Operations Management)
    ├── support (Customer Service)
    └── user (Customer Access)
```

### Critical Permissions

**Flight Management:**
- `flight:create` - Create new flights (airline_admin, super_admin)
- `flight:update` - Modify flight details (airline_admin, ops, super_admin)
- `flight:delete` - Remove flights (airline_admin, super_admin)
- `flight:status:update` - Change flight status (airline_admin, ops, super_admin)

**Financial:**
- `payment:process` - Process payments (user, finance, airline_admin, super_admin)
- `refund:approve` - Approve refunds (finance, airline_admin, super_admin)
- `payment:view:all` - View all payments (finance, airline_admin, super_admin)

**User Management:**
- `user:role:change` - Change user roles (super_admin only)
- `user:delete` - Delete users (super_admin only)

**System:**
- `audit:log:read` - Read audit logs (airline_admin, super_admin)
- `system:config` - Modify system config (super_admin only)

## Payment Security

### Stripe Integration

**PCI DSS Compliance:**
- Never store raw card data
- Use Stripe.js for client-side tokenization
- Backend only handles payment intent IDs

**Webhook Security:**
```typescript
import { verifyWebhookSignature } from './services/payment-security.service';

// Verify webhook signature
const event = verifyWebhookSignature(
  request.body,
  request.headers['stripe-signature'],
  process.env.STRIPE_WEBHOOK_SECRET
);
```

**Idempotency Keys:**
```typescript
import { createPaymentIntent } from './services/payment-security.service';

// Create payment with idempotency key
const paymentIntent = await createPaymentIntent(
  amount,
  currency,
  metadata,
  idempotencyKey // Prevents duplicate charges
);
```

**Amount Validation:**
```typescript
import { validatePaymentAmount, validateCurrency } from './services/payment-security.service';

// Always validate amount and currency
if (!validatePaymentAmount(receivedAmount, expectedAmount, 'sar')) {
  throw new Error('Amount mismatch');
}

if (!validateCurrency(receivedCurrency, 'sar')) {
  throw new Error('Currency mismatch');
}
```

### Payment Flow

```
1. User selects flight → Create booking (status: initiated)
2. Lock inventory → Transition to: reserved
3. Create payment intent with idempotency key
4. User completes payment → Webhook received
5. Verify webhook signature
6. Validate amount and currency
7. Check idempotency key (prevent duplicate processing)
8. Update booking status → paid
9. Issue ticket → ticketed
```

## Audit Logging

### Critical Events

All security-sensitive operations are automatically logged:

**Authentication:**
- `LOGIN_SUCCESS` / `LOGIN_FAILURE`
- `LOGOUT`

**Bookings:**
- `BOOKING_CREATED`
- `BOOKING_MODIFIED`
- `BOOKING_CANCELLED`
- `BOOKING_STATUS_CHANGED`

**Payments:**
- `PAYMENT_INITIATED`
- `PAYMENT_SUCCESS` / `PAYMENT_FAILED`
- `REFUND_INITIATED` / `REFUND_COMPLETED`

**Admin Actions:**
- `USER_ROLE_CHANGED`
- `USER_DELETED`
- `FLIGHT_CREATED` / `FLIGHT_UPDATED` / `FLIGHT_CANCELLED`

**Data Access:**
- `PII_ACCESSED` - When admins view personal data
- `SENSITIVE_DATA_EXPORT`

### Using Audit Logs

```typescript
import { logBookingEvent } from './services/audit.service';

// Log booking modification
await logBookingEvent(
  'BOOKING_MODIFIED',
  bookingId,
  userId,
  userRole,
  previousValue,
  newValue,
  sourceIp,
  userAgent
);
```

### Audit Log Retention
- Keep audit logs for minimum 1 year
- Archive after 1 year to cold storage
- Never delete audit logs (compliance requirement)

## API Security

### Rate Limiting

**Configuration:**
```env
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
```

**Implementation:**
- Express rate limiter middleware
- 100 requests per 15-minute window
- Per IP address tracking
- Redis-backed for production (distributed systems)

### CORS Policy

**Development:**
```javascript
cors({
  origin: 'http://localhost:3000',
  credentials: true,
})
```

**Production:**
```javascript
cors({
  origin: process.env.CORS_ALLOWED_ORIGINS.split(','),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
})
```

### Input Validation

**All inputs are validated using Zod:**
```typescript
import { z } from 'zod';

const createBookingSchema = z.object({
  flightId: z.number().positive(),
  passengers: z.array(z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    // ... more validation
  })).min(1).max(9),
});
```

## Data Protection

### PII (Personally Identifiable Information)

**Sensitive Data:**
- Passport numbers
- Credit card data (tokenized only)
- Email addresses
- Phone numbers

**Protection Measures:**
- Log PII access (audit trail)
- Encrypt PII at rest (database encryption)
- TLS 1.3 for data in transit
- Field-level encryption for highly sensitive data

### GDPR Compliance

**User Rights:**
- Right to access data
- Right to deletion (data erasure)
- Right to data portability
- Right to rectification

**Implementation:**
- Data export API endpoint
- Data deletion workflow
- Consent management
- Privacy policy acceptance tracking

## Security Headers

### Recommended Headers

**Helmet.js Configuration:**
```javascript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.stripe.com"],
      frameSrc: ["https://js.stripe.com"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));
```

**Custom Security Headers:**
```javascript
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
```

## Booking State Machine Security

### State Transition Validation

**Prevents:**
- Unauthorized state changes
- Double booking
- Invalid transitions (e.g., expired → flown)
- Race conditions

**Valid Transitions:**
```
initiated → reserved → paid → ticketed → checked_in → boarded → flown
    ↓           ↓        ↓        ↓
  expired    expired  payment_failed  no_show
                         ↓
                    cancelled → refunded
```

### Seat Hold TTL
- Seats locked for 15 minutes during checkout
- Automatic expiration prevents inventory deadlock
- User can retry after expiration

## Security Checklist

### Development
- [ ] Never commit secrets to Git
- [ ] Use `.env.example` for documentation
- [ ] Enable query logging only in development
- [ ] Use test Stripe keys

### Staging
- [ ] Test Stripe webhooks with test mode
- [ ] Verify rate limiting works
- [ ] Test RBAC permissions
- [ ] Review audit logs

### Production
- [ ] Use secrets manager (AWS Secrets Manager/Vault)
- [ ] Enable HTTPS only (TLS 1.3)
- [ ] Set secure cookie flags
- [ ] Enable Helmet.js
- [ ] Configure WAF (Web Application Firewall)
- [ ] Set up monitoring/alerting (Sentry, Datadog)
- [ ] Enable database encryption at rest
- [ ] Regular security audits
- [ ] Dependency vulnerability scanning
- [ ] Penetration testing

## Incident Response

### Security Breach Procedure
1. **Detect** - Monitor audit logs and alerts
2. **Contain** - Disable affected accounts/services
3. **Investigate** - Review audit logs, identify scope
4. **Remediate** - Fix vulnerability, rotate secrets
5. **Notify** - Inform affected users (GDPR requirement)
6. **Document** - Post-mortem report

### Emergency Contacts
- Security Team: security@ais.com
- On-call: +966-XXX-XXXX
- Incident Response Lead: [Name]

## Further Reading
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Stripe Security Best Practices](https://stripe.com/docs/security)
- [GDPR Compliance Guide](https://gdpr.eu/)
- [PCI DSS Requirements](https://www.pcisecuritystandards.org/)
