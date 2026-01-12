# Test Environment Setup

This file documents how to set up the test environment for the AIS Aviation System.

## Environment Variables for Testing

Tests require certain environment variables to be set. You have two options:

### Option 1: Use .env.test file (Recommended)

Create a `.env.test` file in the project root with minimal test configuration:

```env
# Test Database (use a separate test database!)
DATABASE_URL=mysql://root:password@localhost:3306/ais_test

# Test Auth (dummy values for testing)
JWT_SECRET=test-secret-key-for-testing-only-minimum-32-characters
OAUTH_SERVER_URL=http://localhost:3000/mock-oauth
OWNER_OPEN_ID=test-owner-id

# Test Manus Integration
VITE_APP_ID=test-app-id
BUILT_IN_FORGE_API_URL=http://localhost:3000/mock-forge
BUILT_IN_FORGE_API_KEY=test-forge-key

# Test Stripe (use Stripe test keys)
STRIPE_SECRET_KEY=sk_test_dummy_key_for_testing
STRIPE_WEBHOOK_SECRET=whsec_test_dummy_secret

# Test Node Environment
NODE_ENV=test
```

### Option 2: Set environment variables inline

```bash
DATABASE_URL=mysql://root:password@localhost:3306/ais_test \
JWT_SECRET=test-secret-minimum-32-chars \
OAUTH_SERVER_URL=http://localhost:3000 \
OWNER_OPEN_ID=test-owner \
VITE_APP_ID=test-app \
BUILT_IN_FORGE_API_URL=http://localhost \
BUILT_IN_FORGE_API_KEY=test-key \
pnpm test
```

## Test Database Setup

Before running tests, create a separate test database:

```sql
CREATE DATABASE ais_test;
```

Then run migrations on the test database:

```bash
DATABASE_URL=mysql://root:password@localhost:3306/ais_test pnpm db:push
```

## Running Tests

### All Tests

```bash
# With .env.test file
pnpm test

# Or inline (Unix/Linux/Mac)
DATABASE_URL=... pnpm test
```

### Specific Test File

```bash
pnpm test flights.test.ts
```

### Watch Mode

```bash
pnpm test:watch
```

### With Coverage

```bash
pnpm test:coverage
```

## Mocking External Services

Some tests may require mocking external services:

### Stripe

Tests that use Stripe should use Stripe test mode keys and mock webhooks:

```typescript
// In test setup
vi.mock('../stripe', () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
  },
}));
```

### OAuth

OAuth tests should mock the OAuth server:

```typescript
// Mock OAuth responses
vi.mock('../_core/oauth', () => ({
  validateToken: vi.fn(() => Promise.resolve({ userId: 1 })),
}));
```

## Test Database Cleanup

After running tests, you may want to clean up the test database:

```bash
# Drop all tables
mysql -u root -p ais_test -e "DROP DATABASE ais_test; CREATE DATABASE ais_test;"

# Re-run migrations
DATABASE_URL=mysql://root:password@localhost:3306/ais_test pnpm db:push
```

## CI/CD Configuration

For continuous integration, set environment variables in your CI/CD platform:

### GitHub Actions Example

``yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_DATABASE: ais_test
        ports:
          - 3306:3306
    
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: '22'
          cache: 'pnpm'
      
      - run: pnpm install
      
      - name: Run tests
        env:
          DATABASE_URL: mysql://root:root@localhost:3306/ais_test
          JWT_SECRET: test-secret-minimum-32-characters-long
          OAUTH_SERVER_URL: http://localhost:3000
          OWNER_OPEN_ID: test-owner
          VITE_APP_ID: test-app-id
          BUILT_IN_FORGE_API_URL: http://localhost
          BUILT_IN_FORGE_API_KEY: test-key
          NODE_ENV: test
        run: pnpm test
```

## Troubleshooting

### "Invalid environment configuration"

This error means required environment variables are missing. Check that:
1. `.env.test` exists and has all required variables
2. All required variables are set (see .env.example)
3. Variable values meet validation requirements (e.g., URLs are valid)

### "Database connection failed"

1. Ensure MySQL is running
2. Test database exists (`ais_test`)
3. DATABASE_URL is correct
4. Migrations have been run on test database

### Tests timing out

Increase test timeout in `vitest.config.ts`:

```typescript
export default defineConfig({
  test: {
    testTimeout: 30000, // 30 seconds
  },
});
```

## Best Practices

1. **Always use separate test database** - Never run tests on production or development database
2. **Clean up after tests** - Use `afterAll` or `afterEach` to clean up test data
3. **Mock external services** - Don't make real API calls in tests
4. **Use transactions** - Wrap tests in transactions that rollback
5. **Isolate tests** - Each test should be independent

---

**Last Updated:** January 12, 2026
