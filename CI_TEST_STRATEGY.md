# CI Test Strategy - Database Tests

## Overview

This document explains how database-dependent tests are handled in the CI/CD pipeline.

## Strategy: Exclude Database Tests from Unit Test Job

### Rationale

Database-dependent tests are **excluded** from the main unit test job in CI for the following reasons:

1. **Speed**: Unit tests run faster without database setup and migrations
2. **Reliability**: No dependency on external database service availability
3. **Focus**: Unit tests focus on business logic with proper mocking
4. **Consistency**: Aligns with the test design where database tests skip when `DATABASE_URL` is not set

### Test Coverage Breakdown

#### Unit Test Job (Stage 2)
- **Database Tests**: ❌ Skipped (no `DATABASE_URL` provided)
- **Purpose**: Fast feedback on code changes, business logic validation
- **Duration**: ~30-60 seconds
- **Test Count**: ~38 test files, ~786 tests pass, ~247 tests skip

#### E2E Test Job (Stage 4)
- **Database Tests**: ✅ Enabled (full MySQL + Redis services)
- **Purpose**: Integration testing, end-to-end workflow validation
- **Duration**: ~5-10 minutes
- **Coverage**: Critical user flows with real database

## Implementation Details

### Unit Test Configuration

```yaml
# No database services configured
# No DATABASE_URL in environment
env:
  NODE_ENV: test
  JWT_SECRET: test-secret-key-for-ci
  STRIPE_SECRET_KEY: sk_test_mock_key
  # ... other non-database env vars
```

### E2E Test Configuration

```yaml
services:
  mysql:
    image: mysql:8.0
    # ... full database setup

env:
  DATABASE_URL: mysql://root:test_password@127.0.0.1:3306/ais_test
  # ... other env vars
```

## Test File Behavior

Database-dependent test files use the pattern:

```typescript
describe.skipIf(!process.env.DATABASE_URL)("Database Test Suite", () => {
  // Tests that require database connection
});
```

This ensures:
- ✅ Tests run when DATABASE_URL is set (local development, E2E CI)
- ⏭️ Tests skip when DATABASE_URL is not set (unit test CI)
- ✅ No failures or errors, just graceful skipping

## Running Tests Locally

### Without Database (Fast)
```bash
# DATABASE_URL not set in .env.test
pnpm test
# Result: Unit tests pass, database tests skip
```

### With Database (Full Coverage)
```bash
# Uncomment DATABASE_URL in .env.test or set in environment
export DATABASE_URL="mysql://user:pass@localhost:3306/test_db"
pnpm test
# Result: All tests run including database integration tests
```

## Benefits

✅ **Fast CI Runs**: Unit tests complete in seconds, not minutes
✅ **Reduced Infrastructure**: No MySQL/Redis containers for unit tests
✅ **Better Separation**: Clear distinction between unit and integration tests
✅ **Reliable Pipeline**: No flaky database connection issues
✅ **Full Coverage**: E2E tests still validate database integration

## Files Affected

### Modified
- `.github/workflows/ci-cd.yml` - Removed database services and DATABASE_URL from unit test job

### Unchanged (Already Configured)
- `server/_core/env.ts` - DATABASE_URL optional
- `vitest.config.ts` - Conditional DATABASE_URL
- `.env.test` - DATABASE_URL commented out
- 19 test files - Using `describe.skipIf(!process.env.DATABASE_URL)` pattern

## Metrics

### Before Change
- Unit test job: ~3-5 minutes (with database setup + migrations)
- Database service: MySQL + Redis containers
- Test failures: Occasional connection issues

### After Change
- Unit test job: ~30-60 seconds (no database)
- Database service: None (unit tests), MySQL + Redis (E2E only)
- Test failures: None (graceful skipping)

## Troubleshooting

### "Many tests are skipped in CI"
✅ **Expected behavior** - Database tests skip in unit test job, run in E2E job

### "Want to run database tests in CI"
Set `DATABASE_URL` in the unit test job environment and re-enable database services

### "Database tests failing locally"
Ensure DATABASE_URL is set and database is running:
```bash
# Start database
docker-compose up -d mysql

# Set DATABASE_URL in .env.test (uncomment line 9)
# DATABASE_URL=mysql://test:test@localhost:3306/ais_aviation_test

# Run tests
pnpm test
```

## Related Documentation

- `TEST_FIXES_SUMMARY.md` - Details on test infrastructure changes
- `PLATFORM_REVIEW_SUMMARY.md` - Platform improvements
- `.github/workflows/ci-cd.yml` - CI/CD pipeline configuration

---

**Last Updated:** February 2026
**Status:** Active
