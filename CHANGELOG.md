# Changelog

## What's Changed in v1.12.0

### Features

- feat: add live flight tracking, inventory locking, overbooking management, and quick rebooking (dc4981b)
- feat: add admin overbooking management page and fix unused imports (3f0310c)

### Bug Fixes

- fix: rewrite CHANGELOG.md with consistent format and fix version-bump script (f5da47f)
- fix: close critical integration gaps for inventory, rebooking, and overbooking (97399fd)

### Documentation

- docs: add comprehensive system comparison analysis (AR/EN) (0a2f08a)

### Other Changes

- style: apply prettier formatting to OverbookingManagement (2dbc1eb)
- Merge pull request #64 from kafaat/claude/implement-todo-zrBPj (fa25bf1)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.11.0...v1.12.0

---

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.11.0] - 2026-02-08

### Added

- Sanaa, Aden, and Muscat destinations with airlines and flights (0be56d6)
- Aircraft type models to seed data: A320, A330, A350, B727, B737, B777, B787 (9c26281)
- SeatMap displays aircraft-specific seat layouts (8b47507)
- SeatMap component integrated into booking flow (bad4715)

### Documentation

- Update documentation for new destinations and currencies (cf01410)

**Full Changelog**: [v1.10.1...v1.11.0](https://github.com/kafaat/ais-aviation-system/compare/v1.10.1...v1.11.0)

---

## [1.10.1] - 2026-02-08

### Fixed

- Improve accessibility across all major pages — WCAG compliance (3d7e966)
- Add kubeconfig validation to prevent deploy failures (1fb1a88)
- Auth service not registered (9668b04)

**Full Changelog**: [v1.10.0...v1.10.1](https://github.com/kafaat/ais-aviation-system/compare/v1.10.0...v1.10.1)

---

## [1.10.0] - 2026-02-08

### Added

- FastAPI auth service with password-based authentication (c525250)
  - New `auth-service/` microservice (FastAPI + SQLAlchemy + bcrypt)
  - User registration, login, and password verification endpoints
  - Auth service client for Node.js backend communication
  - Docker Compose integration for all environments
  - Updated Login page with email/password form alongside OAuth

### Fixed

- Resolve non-DB E2E test failures (87d2f90)
- Resolve login 404 by fixing CSP, service worker, and PWA config (d3da166)

### Security

- Upgrade python-jose 3.3.0 → 3.4.0 (CVE-2024-33663, CVE-2024-33664)
- Upgrade python-multipart 0.0.20 → 0.0.22 (CVE-2026-24486)
- Upgrade cryptography 44.0.0 → 44.0.1 (CVE-2024-12797)

**Full Changelog**: [v1.9.0...v1.10.0](https://github.com/kafaat/ais-aviation-system/compare/v1.9.0...v1.10.0)

---

## [1.9.0] - 2026-02-08

### Added

- AI dynamic pricing system with ML demand forecasting, customer segmentation, revenue optimization, and A/B testing (afbe66f)

### Fixed

- Integrate AI pricing with booking flow and add comprehensive tests (57195da)
- Add E2E test support with data-testid attributes and dev login form (953a4b3)

**Full Changelog**: [v1.8.4...v1.9.0](https://github.com/kafaat/ais-aviation-system/compare/v1.8.4...v1.9.0)

---

## [1.8.4] - 2026-02-08

### Fixed

- Address security vulnerabilities and race conditions (bdf1e8e)
- UI fixes — icons, RTL support, accessibility, and dead links (7c11bad)
- Resolve CI lint warnings and Docker build failure (e135804)
- Deep UI audit — critical bugs, RTL, accessibility, and cleanup (9369970)
- Resolve 5 critical middleware bugs found in deep review (96ef1a5)
- Comprehensive backend review — 28 files, security and correctness fixes (ebd4b1e)
- Phase 2 — architecture, integration, and infrastructure deep review (49 files) (9b7bb52)
- Remove stale patchedDependencies from lockfile (2084105)
- Resolve 8 failing test cases across 4 test files (df7b0b8)
- Fix duplicate 'db' variable declaration in flight-status test (e33e840)

**Full Changelog**: [v1.8.3...v1.8.4](https://github.com/kafaat/ais-aviation-system/compare/v1.8.3...v1.8.4)

---

## [1.8.3] - 2026-02-07

### Fixed

- Login button now navigates to dedicated /login page (a6a9475)

**Full Changelog**: [v1.8.2...v1.8.3](https://github.com/kafaat/ais-aviation-system/compare/v1.8.2...v1.8.3)

---

## [1.8.2] - 2026-02-07

### Fixed

- Prevent crash when VITE_OAUTH_PORTAL_URL is not configured (4244894)

### Documentation

- Comprehensive documentation update for all sessions and phases (27b16ac)

**Full Changelog**: [v1.8.1...v1.8.2](https://github.com/kafaat/ais-aviation-system/compare/v1.8.1...v1.8.2)

---

## [1.8.1] - 2026-02-07

### Fixed

- Mock loyalty tests and add missing env vars documentation (ad11c89)
- Prevent Sentry crash with invalid/placeholder DSN values (2de0629)

**Full Changelog**: [v1.8.0...v1.8.1](https://github.com/kafaat/ais-aviation-system/compare/v1.8.0...v1.8.1)

---

## [1.8.0] - 2026-02-07

### Added

- Comprehensive admin, notifications, email, error handling, and security improvements (c039ce9)
- Background job worker (`server/worker.ts` → `dist/worker.js`)
- Inventory lock conversion after payment confirmation
- Price alerts notification delivery (in-app + email)
- Docker `.dockerignore` for optimized builds
- `.env.prod.example` with Docker-specific URLs
- HEALTHCHECK in Dockerfile.prod
- Redis service in docker-compose.prod.yml
- Admin sidebar links for Baggage, Corporate, Travel Agents
- 7 new routes: /baggage, /admin/baggage, /admin/corporate, /admin/travel-agents, /corporate, /corporate/bookings
- 78+ i18n translation keys (Arabic analytics, cancel/modify booking dialogs)
- Queue service: cancellation, refund, and push notification delivery
- Carbon offset calculation with DB-backed airport coordinates

### Fixed

- Seats now deducted from flight availability after Stripe payment
- AccessibilityProvider missing in App.tsx (Home page crash)
- Vite dev server config not resolving (defineConfig function spread)
- `throw new Error()` replaced with `TRPCError` in bookings router
- Currency default changed from USD to SAR in payment service
- E-ticket generation blocked for cancelled/pending bookings
- Group bookings always using economy price (cabinClass now passed)
- Corporate credit calculation Math.abs bug
- Waitlist seat deduction on offer to prevent overbooking
- Travel agent monthly booking limit enforcement
- Split payment server-side amount and expiry validation
- AI chat date comparison (eq → lt) for archiving old conversations
- AI guardrails returning safe:true for warning severity
- Rebooking status eligibility check (only confirmed/pending)
- Stripe webhook path mismatch in nginx.conf
- Disruption queries optimized with SQL WHERE IN
- BaggageStatus.tsx wrong useAuth import source
- JoinWaitlistDialog not passing notification preferences
- DCS aircraft seat validation (totalSeats >= economy + business)

### Changed

- Build script now produces both dist/index.js and dist/worker.js
- `allowNonAppliedPatches` updated to `allowUnusedPatches` in pnpm config
- CI pipeline: build job no longer depends on E2E tests
- family-pool.service imports from main schema.ts instead of loyalty-schema.ts
- AIChatBox demo code corrected: trpc.ai.chat → trpc.aiChat.sendMessage

### Removed

- 4 duplicate schema files (loyalty-schema, flight-status-history-schema, inventory-locks-schema, modification-schema)

**Full Changelog**: [v1.7.2...v1.8.0](https://github.com/kafaat/ais-aviation-system/compare/v1.7.2...v1.8.0)

---

## [1.7.2] - 2026-02-07

### Fixed

- Critical frontend issues — missing providers, routes, and navigation (1f2e14e)
- Critical Phase 1 & 2 bugs — seat deduction, pricing, validation (a01b959)
- Consolidate schema imports and fix demo code router name (7659fdd)
- Phase 3 bugs + Docker configuration fixes (d348b22)
- Worker entry point, inventory locks, price alerts, and prettier (93b7789)
- Complete all remaining issues with i18n, todos, and documentation (9a49d52)
- Replace hardcoded strings with i18n, fix TODOs in MultiCity and email worker (3ff81ff)

### Refactored

- Remove duplicate schema files in favor of main schema.ts (279f443)

**Full Changelog**: [v1.7.1...v1.7.2](https://github.com/kafaat/ais-aviation-system/compare/v1.7.1...v1.7.2)

---

## [1.7.1] - 2026-02-06

### Fixed

- CI pipeline and project issues (b0e7be8)
- Resolve vite config function before spreading in dev server (a6e5ace)

**Full Changelog**: [v1.7.0...v1.7.1](https://github.com/kafaat/ais-aviation-system/compare/v1.7.0...v1.7.1)

---

## [1.7.0] - 2026-02-06

### Added

- Phase 5: AI guardrails, chat UX, and production enhancements (5cda54a)

### Fixed

- Add shamefully-hoist for pnpm to fix E2E server startup (4d4bdf2)
- Use dynamic imports for trpc-openapi to prevent server crash at startup (4ead878)
- Wrap OpenAPI document generation in try/catch (92bf803)
- Make E2E tests non-blocking and wrap OpenAPI middleware in try/catch (474c2ec)

**Full Changelog**: [v1.6.0...v1.7.0](https://github.com/kafaat/ais-aviation-system/compare/v1.6.0...v1.7.0)

---

## [1.6.0] - 2026-02-06

### Added

- Rebooking from previous booking feature (5b73f4b)
- 6 travel scenarios: pricing, validation, auto check-in, sharing, carbon, travel docs (86391d0)
- Phase 3 DCS — Departure Control System (29b11b2)
- Phase 4: payment history and soft delete for bookings (f9d94b8)

### Fixed

- Resolve 5 pre-existing test failures in CI (5f4079d)
- Resolve CI failures: vouchers reserved word and idempotency null check (47e7bf3)
- Rewrite idempotency to check-first approach for MySQL NULL handling (f4bc165)
- Change OAuth server URL from manus.space to localhost (475dafc)

**Full Changelog**: [v1.4.0...v1.6.0](https://github.com/kafaat/ais-aviation-system/compare/v1.4.0...v1.6.0)

---

## [1.4.0] - 2026-02-06

### Added

- Interactive seat map integration into check-in (bb708fb)
- Price lock, meal pre-order, and family mile pooling features (ad8c5e1)
- Digital wallet, enhanced price calendar, and disruption hub (8a448ea)

### Fixed

- Improve test mocks to work without database connection (434ba94)
- Add default value of 1 for numberOfPassengers in bookings table (6b282b7)
- Correct stripeEvents column names in critical-paths tests (0e11ca8)

**Full Changelog**: [v1.3.3...v1.4.0](https://github.com/kafaat/ais-aviation-system/compare/v1.3.3...v1.4.0)

---

## [1.3.3] - 2026-02-05

### Fixed

- Resolve 41 lint warnings across client and server (0708071)
- Update critical-paths.test.ts to use correct schema (a7048f1)
- Update CodeQL to v4 and fix coverage thresholds (4278905)

**Full Changelog**: [v1.3.2...v1.3.3](https://github.com/kafaat/ais-aviation-system/compare/v1.3.2...v1.3.3)

---

## [1.3.2] - 2026-02-05

### Fixed

- Add booking ownership verification to ancillary service endpoints (2181b21)
- Align test fixtures with current database schema (e967302)
- Remove non-existent password field from test user inserts (dba030b)

**Full Changelog**: [v1.3.1...v1.3.2](https://github.com/kafaat/ais-aviation-system/compare/v1.3.1...v1.3.2)

---

## [1.3.1] - 2026-02-05

### Fixed

- Resolve lint errors: duplicate imports and prefer-const (1317f22)
- Resolve gitleaks commit range error in CI (17c1a5d)
- Add --force flag to db:push for non-interactive CI (253dd66)
- Resolve test failures in CI (7d0fc45)

### Documentation

- Update CLAUDE.md with Phase 2 features documentation (9bc474c)

**Full Changelog**: [v1.3.0...v1.3.1](https://github.com/kafaat/ais-aviation-system/compare/v1.3.0...v1.3.1)

---

## [1.3.0] - 2026-02-05

### Added

- Phase 2 components, services, and TypeScript fixes (505ceae)
- Voucher/credits system and Phase 2 features (041ccec)
- Gate management UI and translations (5ee327a)

**Full Changelog**: [v1.2.0...v1.3.0](https://github.com/kafaat/ais-aviation-system/compare/v1.2.0...v1.3.0)

---

## [1.2.0] - 2026-02-05

### Added

- Phase 2 features: advanced aviation system capabilities (ac7ce89)

**Full Changelog**: [v1.1.1...v1.2.0](https://github.com/kafaat/ais-aviation-system/compare/v1.1.1...v1.2.0)

---

## [1.1.1] - 2026-02-05

### Fixed

- Handle repository-dispatch permission issue gracefully (2c3fe3c)
- Resolve duplicate import errors in MyBookings and SearchResults (248c94c)
- Make dependency review optional when Dependency Graph is disabled (f14c385)
- Update lockfile and fix breaking changes check script (6134101)

**Full Changelog**: [v1.1.0...v1.1.1](https://github.com/kafaat/ais-aviation-system/compare/v1.1.0...v1.1.1)

---

## [1.1.0] - 2026-02-05

### Added

- Production-ready improvements: security, monitoring, and testing (e953154)
- Comprehensive CLAUDE.md for AI assistant guidelines (a8e87b6)
- AI chat booking system and enhanced features (804f546)
- Reports dashboard, price calendar, SMS service, loyalty admin (91688a5)
- Favorites, check-in reminders, search history (944814b)
- Advanced features: lazy loading, accessibility, PWA, WebSocket (4dbd34d)

### Fixed

- Update wouter version and fix pnpm lockfile (955aa36)
- Fix TypeScript errors in Stripe services (8495681)
- Fix all 55 TypeScript errors in the codebase (e91b108)

**Full Changelog**: [v1.0.0...v1.1.0](https://github.com/kafaat/ais-aviation-system/compare/v1.1.0-beta...v1.1.0)

---

## [1.0.0] - 2025-10-01

### Added

- Flight search by route and date
- Complete booking flow from search to payment
- Stripe checkout and webhooks integration
- OAuth user authentication
- Admin dashboard for flight and booking management
- Online check-in with seat selection
- React 19 + TypeScript frontend
- Express + tRPC backend
- MySQL/TiDB with Drizzle ORM
- Tailwind CSS + shadcn/ui
- Vite build system
