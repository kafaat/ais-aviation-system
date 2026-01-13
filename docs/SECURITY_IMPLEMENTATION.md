# Security Implementation Guide

## Overview

This document describes the security features implemented in the AIS Aviation System based on the comprehensive technical audit.

## 🔐 Role-Based Access Control (RBAC)

### User Roles

The system implements a comprehensive role hierarchy with 7 distinct roles:

| Role              | Level | Description          | Key Capabilities                              |
| ----------------- | ----- | -------------------- | --------------------------------------------- |
| **user**          | 1     | Regular customer     | Book flights, manage own bookings             |
| **support**       | 2     | Customer support     | View/modify all bookings, process refunds     |
| **ops**           | 3     | Operations team      | Update flight status, manage schedules        |
| **finance**       | 4     | Finance team         | Access financial data, update pricing         |
| **airline_admin** | 5     | Airline management   | Manage flights, routes, pricing               |
| **admin**         | 6     | System administrator | Full system access except user management     |
| **super_admin**   | 7     | Super administrator  | Complete system control, user role management |

### Role Implementation

Roles are enforced through:

1. **Database Level**: `users` table has `role` enum field
2. **Middleware Level**: `createRBACMiddleware()` in `rbac.service.ts`
3. **Router Level**: Protected procedures with required roles

### Usage Example

```typescript
import { createRBACMiddleware } from "../services/rbac.service";

// Create a procedure that requires admin access
const adminProcedure = protectedProcedure.use(
  createRBACMiddleware(["admin", "super_admin"])
);

// Use in router
export const adminRouter = router({
  deleteUser: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input }) => {
      // Only admin and super_admin can execute this
    }),
});
```

## 📝 Audit Logging

### Overview

All sensitive operations are logged to the `audit_logs` table with complete metadata for compliance and security monitoring.

### What Gets Logged

- ✅ Login attempts (success/failure)
- ✅ Booking operations (create/modify/cancel)
- ✅ Payment transactions
- ✅ Refund operations
- ✅ User role changes
- ✅ Flight updates
- ✅ Price changes
- ✅ Admin actions
- ✅ Sensitive data access

### Audit Log Structure

```typescript
{
  eventId: string;           // Unique identifier
  eventType: string;         // e.g., "LOGIN_SUCCESS", "BOOKING_CREATED"
  eventCategory: string;     // auth, booking, payment, etc.
  outcome: "success" | "failure" | "error";
  severity: "low" | "medium" | "high" | "critical";
  userId?: number;
  userRole?: string;
  actorType: "user" | "admin" | "system" | "api";
  sourceIp?: string;
  userAgent?: string;
  requestId?: string;        // For correlation
  resourceType?: string;
  resourceId?: string;
  previousValue?: any;       // JSON of old state
  newValue?: any;           // JSON of new state
  changeDescription?: string;
  metadata?: any;
  timestamp: Date;
}
```

### Usage Example

```typescript
import { auditLogin, auditBookingChange } from "../services/audit.service";

// Audit login
await auditLogin(
  userId,
  email,
  "success",
  req.ip,
  req.headers["user-agent"],
  req.id
);

// Audit booking change
await auditBookingChange(
  bookingId,
  bookingReference,
  userId,
  userRole,
  "modified",
  { status: "pending" },
  { status: "confirmed" },
  req.ip,
  req.id
);
```

## 🔄 Booking State Machine

### State Diagram

```
INITIATED → PENDING → RESERVED → PAID → CONFIRMED → CHECKED_IN → BOARDED → COMPLETED
    ↓           ↓          ↓        ↓         ↓           ↓
 EXPIRED    EXPIRED    EXPIRED  CANCELLED  NO_SHOW   CANCELLED
                                   ↓           ↓
    PAYMENT_FAILED → PENDING    REFUNDED   REFUNDED
        ↓
    CANCELLED
```

### Valid Transitions

The system enforces valid state transitions:

- ✅ `pending` → `paid` (payment successful)
- ✅ `paid` → `confirmed` (booking confirmed)
- ✅ `confirmed` → `checked_in` (passenger checked in)
- ❌ `confirmed` → `pending` (INVALID)
- ❌ `completed` → `cancelled` (INVALID)

### State History Tracking

Every status change is recorded in `booking_status_history` table with:

- Previous and new status
- Transition reason
- Actor information (who/what triggered the change)
- Validation status
- Payment intent ID (if applicable)
- Timestamp

### Usage Example

```typescript
import { transitionBookingStatus } from "../services/booking-state-machine.service";

// Transition booking status
const result = await transitionBookingStatus(
  bookingId,
  bookingReference,
  "pending", // current status
  "paid", // new status
  {
    reason: "Payment successful via Stripe",
    changedBy: userId,
    changedByRole: "user",
    actorType: "payment_gateway",
    paymentIntentId: "pi_123456",
  }
);

if (!result.success) {
  throw new Error(result.error);
}
```

## 🛡️ Security Headers

### Helmet Configuration

The system uses Helmet.js to set secure HTTP headers:

- **Content Security Policy (CSP)**: Prevents XSS attacks
- **HSTS**: Forces HTTPS in production
- **X-Frame-Options**: Prevents clickjacking
- **X-Content-Type-Options**: Prevents MIME sniffing
- **Referrer-Policy**: Controls referrer information
- **X-XSS-Protection**: Enables browser XSS filter

### CSRF Protection

- Double-submit cookie pattern
- Token validation on all state-changing operations
- Exempt endpoints: GET, HEAD, OPTIONS, webhooks
- Token available at `/api/csrf-token`

### CORS Configuration

Strict origin validation:

```typescript
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  process.env.PRODUCTION_URL,
];
```

## 🔑 Secure Cookie Configuration

Production cookie settings:

```typescript
{
  httpOnly: true,        // Prevents JavaScript access
  secure: true,          // HTTPS only
  sameSite: "strict",    // CSRF protection
  maxAge: 7 days,
  path: "/",
}
```

## 🔐 Webhook Security

### Stripe Webhook Verification

All Stripe webhooks are verified using signature validation:

```typescript
import { verifyStripeWebhookSignature } from "../services/security.service";

const isValid = verifyStripeWebhookSignature(
  payload,
  signature,
  process.env.STRIPE_WEBHOOK_SECRET
);

if (!isValid) {
  throw new Error("Invalid webhook signature");
}
```

## 🚨 Security Best Practices

### Environment Variables

Required security-related environment variables:

```bash
# JWT Secret (min 32 characters)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# CSRF Secret
CSRF_SECRET=your-csrf-secret-change-this-in-production

# Stripe Webhook Secret
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Cookie Settings
COOKIE_SECURE=true
COOKIE_SAME_SITE=strict
```

### Password Requirements

While OAuth is used, service passwords should:

- Minimum 12 characters
- Include uppercase, lowercase, numbers, special chars
- Not contain common patterns
- Expire regularly for admin accounts

### Session Management

- JWT tokens expire after 7 days
- Refresh tokens should be implemented for production
- Sessions invalidated on password change
- Session fixation prevention

### Input Validation

All inputs are validated using Zod schemas:

```typescript
z.object({
  email: z.string().email(),
  amount: z.number().positive().int(),
  bookingReference: z.string().length(6),
});
```

## 📊 Monitoring & Alerts

### Critical Security Events

Set up alerts for:

- Multiple failed login attempts
- Unauthorized access attempts
- Role changes
- Large refunds
- Unusual booking patterns
- Database schema changes
- Failed webhook verifications

### Log Analysis

Query audit logs for security monitoring:

```sql
-- Failed login attempts in last hour
SELECT * FROM audit_logs
WHERE eventType = 'LOGIN_FAILED'
  AND timestamp > NOW() - INTERVAL 1 HOUR
ORDER BY timestamp DESC;

-- Sensitive data access
SELECT * FROM audit_logs
WHERE eventType = 'SENSITIVE_DATA_ACCESS'
  AND severity = 'high'
ORDER BY timestamp DESC
LIMIT 100;

-- Admin role changes
SELECT * FROM audit_logs
WHERE eventType = 'USER_ROLE_CHANGED'
ORDER BY timestamp DESC;
```

## 🔍 Compliance

### GDPR Compliance

- Audit logs track all personal data access
- Data retention policies enforced
- Right to be forgotten implementation
- Consent tracking

### PCI DSS Compliance

- No card data stored (tokenization via Stripe)
- Secure transmission (HTTPS)
- Audit logging of payment events
- Access control to payment data

## 🧪 Testing Security

### Security Test Checklist

- [ ] RBAC: Test unauthorized access attempts
- [ ] CSRF: Test token validation
- [ ] XSS: Test input sanitization
- [ ] SQL Injection: Test query parameterization
- [ ] Session: Test session hijacking prevention
- [ ] Webhook: Test signature verification
- [ ] Rate Limiting: Test DDoS protection
- [ ] Audit: Verify all events are logged

## 📚 References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Helmet.js Documentation](https://helmetjs.github.io/)
- [Stripe Webhook Security](https://stripe.com/docs/webhooks/signatures)
- [GDPR Guidelines](https://gdpr.eu/)
- [PCI DSS Requirements](https://www.pcisecuritystandards.org/)
