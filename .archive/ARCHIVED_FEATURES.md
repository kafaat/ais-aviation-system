# Archived Incomplete Features

This directory contains incomplete feature implementations that were started but not fully integrated into the system.

## Location

`.archive/incomplete-features/`

## Contents

### 1. Currency Support (Multi-Currency)

**Files:**

- `currency/` - Currency selector component
- `CurrencyContext.tsx` - Currency context
- `new-features/currency.service.ts` - Currency service
- `tests/currency.test.ts` - Currency tests

**Status:** Partially implemented

- Has basic structure
- Missing schema integration
- Not connected to main router

**Requirements to Complete:**

1. Create `drizzle/schema-currency.ts` with proper tables
2. Add exchange rate API integration
3. Connect currency router to main app router
4. Update payment system to support multiple currencies
5. Add currency conversion logic to all price displays

---

### 2. Advanced Analytics

**Files:**

- `new-features/analytics.service.ts` - Analytics service

**Status:** Partially implemented

- Basic service structure exists
- Missing schema definitions
- Not integrated with existing analytics

**Requirements to Complete:**

1. Create `drizzle/schema-analytics.ts`
2. Integrate with existing analytics router
3. Add proper data aggregation
4. Create dashboard UI components

---

### 3. Account Security Features

**Files:**

- `new-features/account-lock.service.ts` - Account locking service

**Status:** Partially implemented

- Has login attempt tracking
- Missing database schema
- Not integrated with auth flow

**Requirements to Complete:**

1. Create `drizzle/schema-security.ts`
2. Integrate with OAuth login flow
3. Add unlock mechanisms
4. Create admin UI for managing locked accounts

---

### 4. Internationalization (i18n)

**Files:**

- `new-features/i18n.service.ts` - i18n service

**Status:** Partially implemented

- Service structure exists
- Missing translation storage
- Not connected to react-i18next

**Note:** The system already has basic i18n with react-i18next for AR/EN.
This service was for advanced features like:

- Dynamic translation updates
- User-contributed translations
- Translation management dashboard

**Requirements to Complete:**

1. Decide if advanced i18n features are needed
2. Current basic i18n might be sufficient
3. If needed, create proper schema and integration

---

### 5. Cache Service (Redis)

**Files:**

- `cache.service.ts` - Redis caching service

**Status:** Not integrated

- Requires Redis to be installed
- Not configured in production
- Missing connection pooling

**Requirements to Complete:**

1. Install Redis in production environment
2. Configure Redis connection
3. Integrate with API endpoints
4. Add cache invalidation logic
5. Monitor cache performance

---

### 6. Unified Logger

**Files:**

- `unified-logger.ts` - Advanced logging service
- `tests/unified-logger.test.ts` - Logger tests

**Status:** Partially implemented

- Has PII masking
- Missing request ID middleware integration
- Conflicts with existing logger

**Note:** System already has `logger.ts` in `_core/`.

**Requirements to Complete:**

1. Decide between unified-logger and existing logger
2. If using unified-logger, migrate all logging calls
3. Ensure request ID middleware exists
4. Update all services to use new logger

---

## Why Archived?

These features were started as part of the "NEW_FEATURES" update but were not fully integrated into the system. They have import errors and missing dependencies that prevent TypeScript compilation.

## How to Use These Features

### Option 1: Complete Implementation

1. Review the specific feature's requirements above
2. Create missing database schemas
3. Add required dependencies
4. Integrate with main application
5. Write comprehensive tests
6. Update documentation

### Option 2: Start Fresh

For some features (like currency support), it might be easier to:

1. Review the archived code for ideas
2. Design a proper implementation plan
3. Implement from scratch with full integration
4. Test thoroughly before merging

## Recommendations

### High Priority (Implement Soon)

- **Multi-Currency Support** - Important for international expansion
- **Redis Caching** - Will significantly improve performance

### Medium Priority (Future Enhancement)

- **Advanced Analytics** - Current analytics might be sufficient
- **Account Security Features** - Basic security is already good

### Low Priority (Evaluate Need)

- **Advanced i18n** - Current basic i18n is working well
- **Unified Logger** - Existing logger is adequate

---

## Notes for Developers

When implementing these features:

1. **Start with Schema** - Always design database schema first
2. **Test Thoroughly** - Write tests before implementation
3. **Document Well** - Update all relevant documentation
4. **Incremental Integration** - Integrate piece by piece, not all at once
5. **Code Review** - Get thorough review before merging

---

**Last Updated:** January 12, 2026
**Status:** Archived for future implementation
