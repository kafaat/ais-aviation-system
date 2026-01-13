# AIS Aviation System - Quick Reference Guide

**Version:** 2.0  
**Last Updated:** January 2026

---

## 🚀 Quick Start (30 seconds)

```bash
# 1. Clone and install
git clone https://github.com/kafaat/ais-aviation-system.git
cd ais-aviation-system
pnpm install

# 2. Setup environment
cp .env.example .env
# Edit .env with your database credentials

# 3. Setup database
pnpm db:push
npx tsx scripts/seed-data.mjs

# 4. Start development
pnpm dev
# Open http://localhost:3000
```

---

## 📦 Common Commands

### Development

```bash
# Start dev server with hot reload
pnpm dev

# Type checking
pnpm check

# Format code
pnpm format

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch
```

### Database

```bash
# Generate migration
pnpm drizzle-kit generate

# Run migrations
pnpm drizzle-kit migrate

# Combined (generate + migrate)
pnpm db:push

# Seed database
npx tsx scripts/seed-data.mjs

# Open Drizzle Studio (DB viewer)
pnpm drizzle-kit studio
```

### Build & Deploy

```bash
# Build for production
pnpm build

# Start production server
pnpm start

# Build and start
pnpm build && pnpm start
```

---

## 🔧 Environment Variables

### Required Variables

```env
# Database
DATABASE_URL=mysql://user:password@localhost:3306/ais_aviation

# Auth
JWT_SECRET=your-secret-key-min-32-chars
OAUTH_SERVER_URL=https://your-oauth.com
OWNER_OPEN_ID=your-owner-id

# Manus AI
VITE_APP_ID=your-app-id
BUILT_IN_FORGE_API_URL=https://api.manus.space
BUILT_IN_FORGE_API_KEY=your-api-key

# Stripe (optional for basic testing)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Optional Variables

```env
# Node
NODE_ENV=development

# Server
PORT=3000
FRONTEND_URL=http://localhost:3000

# Logging
LOG_LEVEL=info
LOG_PRETTY=true
```

---

## 🗄️ Database Quick Reference

### Connect to Database

```bash
# MySQL CLI
mysql -h localhost -u root -p ais_aviation

# Show all tables
SHOW TABLES;

# Describe table structure
DESCRIBE flights;

# Count records
SELECT COUNT(*) FROM bookings;
```

### Backup & Restore

```bash
# Backup
mysqldump -u root -p ais_aviation > backup.sql

# Restore
mysql -u root -p ais_aviation < backup.sql
```

---

## 🔍 Debugging

### Enable Debug Mode

```env
# In .env
LOG_LEVEL=debug
DEBUG=true
ENABLE_QUERY_LOGGING=true
```

### View Logs

```bash
# Server console logs (dev mode)
pnpm dev

# Check specific log file
tail -f logs/error.log
tail -f logs/combined.log
```

### Database Query Debugging

```typescript
// In code, enable Drizzle logger
import { drizzle } from "drizzle-orm/mysql2";

const db = drizzle(connection, {
  logger: {
    logQuery: query => console.log("Query:", query),
  },
});
```

---

## 🧪 Testing

### Run All Tests

```bash
# Unit + Integration
pnpm test

# With coverage
pnpm test:coverage

# Specific file
pnpm test flights.test.ts

# Watch mode
pnpm test:watch
```

### E2E Tests

```bash
# Run Playwright tests
pnpm test:e2e

# Interactive mode
pnpm test:e2e:ui

# Debug mode
pnpm test:e2e:debug
```

---

## 📝 Common Tasks

### Add a New Feature

```bash
# 1. Create feature branch
git checkout -b feature/new-feature

# 2. Write code
# - Add service in server/services/
# - Add router in server/routers/
# - Add tests in server/__tests__/

# 3. Run tests
pnpm test

# 4. Commit changes
git add .
git commit -m "Add new feature"

# 5. Push and create PR
git push origin feature/new-feature
```

### Add Database Table

```typescript
// 1. Edit drizzle/schema.ts
export const newTable = mysqlTable("new_table", {
  id: int("id").primaryKey().autoincrement(),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// 2. Generate migration
// pnpm drizzle-kit generate

// 3. Run migration
// pnpm drizzle-kit migrate
```

### Add API Endpoint

```typescript
// server/routers/example.ts
import { router, publicProcedure } from "../_core/trpc";
import { z } from "zod";

export const exampleRouter = router({
  getData: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      // Your logic here
      return { id: input.id, data: "..." };
    }),
});

// Add to server/routers.ts
export const appRouter = router({
  // ...
  example: exampleRouter,
});
```

### Add Frontend Page

```tsx
// client/src/pages/NewPage.tsx
export function NewPage() {
  const { data } = trpc.example.getData.useQuery({ id: 1 });

  return (
    <div>
      <h1>New Page</h1>
      <p>{data?.data}</p>
    </div>
  );
}

// Add route in client/src/App.tsx
<Route path="/new" component={NewPage} />;
```

---

## 🚨 Troubleshooting Quick Fixes

### "Database connection failed"

```bash
# Check if MySQL is running
sudo systemctl status mysql

# Start MySQL
sudo systemctl start mysql

# Test connection
mysql -h localhost -u root -p
```

### "Port 3000 already in use"

```bash
# Find process using port 3000
lsof -ti:3000

# Kill process
kill -9 $(lsof -ti:3000)

# Or use different port
PORT=3001 pnpm dev
```

### "Module not found"

```bash
# Clear node_modules and reinstall
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### Build errors

```bash
# Clean build artifacts
rm -rf dist .tsbuildinfo

# Rebuild
pnpm build
```

---

## 🔐 Security Checklist

### Before Production

- [ ] All secrets in .env (not in code)
- [ ] HTTPS enabled
- [ ] Rate limiting configured
- [ ] Database backups scheduled
- [ ] Error logging configured
- [ ] Monitoring set up
- [ ] Security headers configured
- [ ] CORS properly configured

---

## 📊 Health Checks

```bash
# Check API health
curl http://localhost:3000/api/health/check

# Expected response:
{
  "status": "ok",
  "timestamp": "2026-01-12T...",
  "services": {
    "database": "ok",
    "stripe": "ok"
  }
}
```

---

## 🎯 Useful URLs

### Local Development

- **App:** http://localhost:3000
- **API:** http://localhost:3000/api/trpc
- **Health:** http://localhost:3000/api/health/check

### Stripe Testing

- **Test Cards:** https://stripe.com/docs/testing#cards
- **Dashboard:** https://dashboard.stripe.com/test
- **Webhooks:** Use Stripe CLI

---

## 📚 Documentation Links

- [Developer Guide](docs/DEVELOPER_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API Documentation](docs/API_DOCUMENTATION.md)
- [Security Guide](docs/SECURITY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

---

## 💡 Pro Tips

1. **Use TypeScript strict mode** - Catch errors early
2. **Write tests first** - TDD approach
3. **Use Drizzle Studio** - Visual DB editor
4. **Enable debug logs** - When troubleshooting
5. **Read error messages** - They usually tell you what's wrong
6. **Check documentation** - Before asking for help
7. **Use Git branches** - Never commit to main
8. **Test locally first** - Before pushing

---

## 🆘 Getting Help

1. Check [Troubleshooting Guide](docs/TROUBLESHOOTING.md)
2. Search [GitHub Issues](https://github.com/kafaat/ais-aviation-system/issues)
3. Ask in project chat/forum
4. Email: support@ais.com

---

**Remember:** Most issues are solved by:

1. Reading the error message
2. Checking environment variables
3. Restarting the server
4. Clearing caches

**Happy Coding! 🚀**
