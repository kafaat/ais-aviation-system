# Changelog

## [1.8.0] - 2026-02-06

### Added

- Background job worker (`server/worker.ts` → `dist/worker.js`)
- Inventory lock conversion after payment confirmation
- Price alerts notification delivery (in-app + email)
- Docker `.dockerignore` for optimized builds
- `.env.prod.example` with Docker-specific URLs
- HEALTHCHECK in Dockerfile.prod
- Redis service in docker-compose.prod.yml
- Admin sidebar links for Baggage, Corporate, Travel Agents
- Routes for /baggage, /admin/baggage, /admin/corporate, /admin/travel-agents, /corporate, /corporate/bookings
- Arabic analytics section translations (20 keys)

### Fixed

- Critical: Seats now deducted from flight availability after payment
- Critical: AccessibilityProvider missing in App.tsx (Home page crash)
- Critical: Vite dev server config not resolving (defineConfig function spread)
- Fix: throw new Error() → TRPCError in bookings router
- Fix: Currency default USD → SAR in payment service
- Fix: E-ticket generation for cancelled/pending bookings blocked
- Fix: Group bookings always using economy price
- Fix: Corporate credit calculation Math.abs bug
- Fix: Waitlist seat deduction on offer
- Fix: Travel agent monthly limit enforcement
- Fix: Split payment server-side amount validation
- Fix: AI chat date comparison (eq → lt) for archiving
- Fix: AI guardrails returning safe for warnings
- Fix: Rebooking status eligibility check
- Fix: Stripe webhook path mismatch in nginx.conf
- Fix: Disruption queries using SQL WHERE IN
- Fix: BaggageStatus.tsx wrong useAuth import

### Changed

- Build script now produces both dist/index.js and dist/worker.js
- Deprecated allowNonAppliedPatches → allowUnusedPatches in pnpm config
- CI pipeline: build job no longer depends on E2E tests

### Removed

- 4 duplicate schema files (loyalty, flight-status-history, inventory-locks, modification)

---

## What's Changed in v1.7.1

### Bug Fixes
- fix: CI pipeline and project issues (b0e7be8)
- fix: resolve vite config function before spreading in dev server (a6e5ace)

### Other Changes
- Merge pull request #53 from kafaat/claude/implement-todo-zrBPj (bc4d7d6)


**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.7.0...v1.7.1

---

## What's Changed in v1.7.0

### Features

- feat: Phase 5 - AI guardrails, chat UX, and production enhancements (5cda54a)

### Bug Fixes

- fix: add shamefully-hoist for pnpm to fix E2E server startup (4d4bdf2)
- fix: add server startup diagnostic and show E2E server output in CI (91da29c)
- fix: capture server startup error output in E2E diagnostic step (efcb653)
- fix: write server diagnostic to GITHUB_STEP_SUMMARY for visibility (6ae6e6d)
- fix: output server crash details as GitHub annotations (2b2b24c)
- fix: wrap OpenAPI document generation in try/catch to prevent server crash (92bf803)
- fix: wrap createOpenApiExpressMiddleware in try/catch to prevent server crash (9ffa6ef)
- fix: make E2E tests non-blocking and wrap OpenAPI middleware in try/catch (474c2ec)
- fix: use dynamic imports for trpc-openapi to prevent server crash at startup (4ead878)

### Maintenance

- chore: fix CHANGELOG.md formatting after rebase (69268c7)

### Other Changes

- Merge pull request #52 from kafaat/claude/implement-todo-zrBPj (244bafc)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.6.0...v1.7.0

---

## What's Changed in v1.6.0

### Features

- feat: add rebooking from previous booking feature (5b73f4b)
- feat: add 6 travel scenarios - pricing, validation, auto check-in, sharing, carbon, travel docs (86391d0)
- feat: implement Phase 3 DCS (Departure Control System) (29b11b2)
- feat: complete Phase 4 - payment history and soft delete for bookings (f9d94b8)

### Bug Fixes

- fix: resolve 5 pre-existing test failures in CI (5f4079d)
- fixing pnpm dev error (d085ffc)
- fixing pnpm dev error (6a18d36)
- fix: resolve CI failures - vouchers reserved word and idempotency null check (47e7bf3)
- fix: resolve test failures in CI (dbfcb3e)
- fix: resolve remaining CI test failures (04130ec)
- fix: rewrite idempotency to check-first approach for MySQL NULL handling (f4bc165)

### Maintenance

- chore: add pnpm mirror registry configuration (2548c13)
- chore: add binary mirrors for blocked packages in .npmrc (ce4735b)
- chore: remove unnecessary binary mirrors from .npmrc (be4837c)
- chore(release): v1.5.0 (2243366)
- chore: change OAuth server URL from manus.space to localhost (475dafc)
- chore: fix CHANGELOG.md formatting for Prettier (5df7774)

### Other Changes

- style: format migration meta files (a31a226)
- Merge remote-tracking branch 'origin/main' into claude/implement-todo-zrBPj (8c1f92a)
- Merge remote-tracking branch 'origin/main' into claude/implement-todo-zrBPj (bcc677f)
- style: fix Prettier formatting on files from main merge (8852e39)
- Merge pull request #50 from kafaat/claude/implement-todo-zrBPj (1ebc785)
- Merge pull request #51 from kafaat/claude/implement-todo-zrBPj (8f05a36)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.4.0...v1.6.0

---

## What's Changed in v1.5.0

### Features

- feat: add rebooking from previous booking feature (5b73f4b)
- feat: add 6 travel scenarios - pricing, validation, auto check-in, sharing, carbon, travel docs (86391d0)
- feat: implement Phase 3 DCS (Departure Control System) (29b11b2)

### Bug Fixes

- fix: resolve 5 pre-existing test failures in CI (5f4079d)
- fixing pnpm dev error (d085ffc)
- fixing pnpm dev error (6a18d36)

### Maintenance

- chore: add pnpm mirror registry configuration (2548c13)
- chore: add binary mirrors for blocked packages in .npmrc (ce4735b)
- chore: remove unnecessary binary mirrors from .npmrc (be4837c)

### Other Changes

- style: format migration meta files (a31a226)
- Merge remote-tracking branch 'origin/main' into claude/implement-todo-zrBPj (8c1f92a)
- Merge remote-tracking branch 'origin/main' into claude/implement-todo-zrBPj (bcc677f)
- style: fix Prettier formatting on files from main merge (8852e39)
- Merge pull request #50 from kafaat/claude/implement-todo-zrBPj (1ebc785)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.4.0...v1.5.0

---

## What's Changed in v1.4.0

### Features

- feat: integrate interactive seat map into check-in and add calendar export (bb708fb)
- feat: add price lock, meal pre-order, and family mile pooling features (ad8c5e1)
- feat: add digital wallet, enhanced price calendar, and disruption hub (8a448ea)

### Bug Fixes

- fix: improve test mocks to work without database connection (434ba94)
- fix: add default value of 1 for numberOfPassengers in bookings table (6b282b7)
- fix: correct stripeEvents column names in critical-paths tests (0e11ca8)
- fix: use insertId fallback pattern in test beforeAll hooks (dd0e2c4)

### Other Changes

- style: fix Prettier formatting across 9 files (ed0ed39)
- Initial plan (972f925)
- style: fix Prettier formatting in corporate.service.test.ts (a82277f)
- Merge pull request #47 from kafaat/copilot/update-action-job-config (2610fa8)
- Merge pull request #46 from kafaat/claude/implement-todo-zrBPj (1f54cbc)
- Merge pull request #45 from kafaat/claude/add-claude-documentation-hFQZh (aedd882)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.3.3...v1.4.0

---

## What's Changed in v1.3.3

### Bug Fixes

- fix: resolve 41 lint warnings across client and server (0708071)
- fix: update critical-paths.test.ts to use correct schema (a7048f1)

### Maintenance

- chore: update CodeQL to v4 and fix coverage thresholds (4278905)

### Other Changes

- style: fix prettier formatting (bdd140a)
- Merge pull request #44 from kafaat/claude/add-claude-documentation-hFQZh (033032d)

## **Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.3.2...v1.3.3

## What's Changed in v1.3.2

### Bug Fixes

- fix: add booking ownership verification to ancillary service endpoints (2181b21)
- fix: align test fixtures with current database schema (e967302)
- fix: remove non-existent password field from test user inserts (dba030b)

### Other Changes

- style: fix Prettier formatting in ancillary router (8adf46d)
- style: fix Prettier formatting in CHANGELOG.md (dc876f2)
- Merge pull request #43 from kafaat/claude/implement-todo-zrBPj (2fc7daa)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.3.1...v1.3.2

---

## What's Changed in v1.3.1

### Bug Fixes

- fix: resolve lint errors (duplicate imports and prefer-const) (1317f22)
- fix: resolve gitleaks commit range error in CI (17c1a5d)
- fix: add fetch-depth for gitleaks to access commit history (aeb2448)
- fix: add --force flag to db:push for non-interactive CI (253dd66)
- fix: resolve test failures in CI (7d0fc45)

### Documentation

- docs: update CLAUDE.md with Phase 2 features documentation (9bc474c)

### Other Changes

- Merge main into feature branch (23ffdef)
- Merge pull request #42 from kafaat/claude/add-claude-documentation-hFQZh (05cf171)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.3.0...v1.3.1

---

## What's Changed in v1.3.0

### Features

- feat: add Phase 2 components, services, and fix TypeScript errors (505ceae)
- feat: complete voucher/credits system and Phase 2 features (041ccec)
- feat: add gate management UI and translations (5ee327a)

### Other Changes

- style: fix prettier formatting issues (d17eef5)
- Merge branch 'main' into claude/add-claude-documentation-hFQZh (bde54da)
- Update CHANGELOG.md for version 1.2.0 (f8d159f)
- Merge pull request #41 from kafaat/claude/add-claude-documentation-hFQZh (b348882)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.2.0...v1.3.0

---

## What's Changed in v1.2.0

### Features

- feat: implement Phase 2 features - advanced aviation system capabilities (ac7ce89)

### Other Changes

- Merge branch 'main' into claude/add-claude-documentation-hFQZh (3631b0c)
- Merge pull request #40 from kafaat/claude/add-claude-documentation-hFQZh (cb9ee3a)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.1.1...v1.2.0

---

## What's Changed in v1.1.1

### Bug Fixes

- fix: handle repository-dispatch permission issue gracefully (2c3fe3c)
- fix: resolve duplicate import errors in MyBookings and SearchResults (248c94c)
- fix: make dependency review optional when Dependency Graph is disabled (f14c385)
- fix: update lockfile and fix breaking changes check script (6134101)

### Maintenance

- chore: trigger CI rebuild (bea3dff)

### Other Changes

- style: fix Prettier formatting issues across codebase (40ebac1)
- Merge branch 'main' into claude/add-claude-documentation-hFQZh (3de320d)
- Merge pull request #39 from kafaat/claude/add-claude-documentation-hFQZh (b6c18e5)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.1.0...v1.1.1

---

## What's Changed in v1.1.0

### Features

- feat: add production-ready improvements with security, monitoring, and testing (e953154)

### Bug Fixes

- fix: Update wouter version and fix pnpm lockfile (955aa36)
- fix: Fix TypeScript errors in Stripe services (8495681)
- fix: remove explicit pnpm version from CI workflows (d477e4e)
- fix: remove conflicting deny-licenses from dependency review (5923db5)

### Documentation

- docs: Add comprehensive project audit reports and update .env with Redis configuration (9bdf970)

### Maintenance

- chore: Add final fixes summary document (9cd3403)

### Other Changes

- Initial plan (12e0251)
- Add comprehensive documentation for repository visibility and contribution guidelines (110aff3)
- style: Fix code formatting with Prettier (efe69cf)
- Initial plan (9379b3e)
- Initial plan (5ce8442)
- Merge pull request #16 from kafaat/copilot/make-repository-public (be51f68)
- Fix: Add uuid dependency, create .env, update ESLint config, fix import paths and ctx.userId issues (eb953ed)
- Fix: BullMQ worker status, CSRF config, and reconciliation worker null handling (fa5b857)
- Initial plan (a0da60a)
- Merge pull request #30 from kafaat/copilot/fix-action-run-error (b464c05)
- Initial plan (826beee)
- Merge pull request #31 from kafaat/copilot/fix-action-step-issue (044a703)
- Initial plan (0fef16f)
- Fix uuid, jsonwebtoken, AppError, and logger imports (a27b0b4)
- Fix database access patterns in service files (c3c4128)
- Improve variable naming in mobile-auth.service.ts (a69a40e)
- Merge pull request #33 from kafaat/copilot/fix-issue-in-job-step (cd78dce)
- Merge pull request #27 from kafaat/copilot/audit-project-errors-and-improvements (d93672c)
- Merge branch 'main' into copilot/update-workflow-and-files (0ca3188)
- Initial plan (b54b64f)
- Fix Prettier formatting issues in 4 files (63d86a6)
- Merge pull request #34 from kafaat/copilot/fix-code-formatting-issues (0e445ba)
- Merge pull request #25 from kafaat/copilot/update-workflow-and-files (8518e9c)
- Initial plan (3114b56)
- Initial plan for fixing all TypeScript errors in branches (0b635cd)
- Fix Pino logger parameter order across all files (aa58b35)
- Remove trailing colon from CORS logger message (dfc36d2)
- Fix TypeScript errors in currency, idempotency, stripe-webhook and queue services (17482a0)
- Fix all 55 TypeScript errors in the codebase (e91b108)
- Fix remaining linting errors: duplicate imports and const declarations (91aeb1d)
- Address code review feedback: fix redundant conditions and standardize patterns (cb0c96b)
- Merge pull request #36 from kafaat/copilot/fix-all-branch-issues (a7b7191)
- Add comprehensive CLAUDE.md for AI assistant guidelines (a8e87b6)
- Fix critical issues: Stripe API, idempotency, tests, and code quality (bddb248)
- Update database, Docker, and seed configurations (701cc94)
- Fix frontend hooks and Stripe API version compatibility (23ceb60)
- Improve type safety in frontend components (7464172)
- Add AI chat booking system and enhanced features (804f546)
- Add frontend chat component and admin report endpoints (41a7a51)
- Fix Prettier formatting issues (c9ec91e)
- Fix Prettier formatting across all modified files (dc5f532)
- Merge pull request #37 from kafaat/claude/add-claude-documentation-hFQZh (24ebe9e)
- Add reports dashboard, price calendar, SMS service, and loyalty admin endpoints (91688a5)
- Add FavoriteFlights component, email enhancements, and admin routes (3986a2e)
- Add favorites page, check-in reminder job, and search history component (944814b)
- Add navigation menu items and search history integration (79c343d)
- Enhance UI design for sidebar, favorites page, and search history (8d8630f)
- Add favorites and search history integration across pages (0b8c14b)
- Enhance UI/UX across multiple pages with interactive features (9fe6362)
- Add advanced features: lazy loading, accessibility, PWA, and WebSocket (4dbd34d)
- Add production-ready improvements: security, monitoring, testing, and CI/CD (98be1e1)
- Fix TypeScript errors and test setup for production readiness (f4e0b88)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.1.0-beta...v1.1.0

---

All notable changes to the AIS Aviation System will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

#### CI/CD Pipeline

- Complete deployment pipeline with staging and production environments
- Docker image building and pushing to GitHub Container Registry (GHCR)
- Kubernetes deployment manifests with HPA, PDB, and resource limits
- Horizontal Pod Autoscaler for automatic scaling
- Pod Disruption Budget for high availability
- Network policies for security isolation

#### Deployment Automation

- Automated database migrations during deployment
- Pre-deployment database backup for production
- Blue-green deployment strategy with health checks
- Automated rollback on smoke test failure
- Post-deployment monitoring for 5 minutes

#### Testing &amp; Verification

- Smoke tests script for deployment verification
- E2E critical path tests for production deployments
- Health check verification before traffic switching
- Synthetic test triggering (Datadog integration)

#### Release Automation

- Automatic changelog generation from conventional commits
- Version bumping with semantic versioning
- GitHub Release creation with release notes
- PR title validation for conventional commits
- Dependency review for security vulnerabilities

#### Scripts &amp; Tools

- `scripts/smoke-tests.sh` - Deployment verification tests
- `scripts/e2e-critical.sh` - Critical path E2E tests
- `scripts/rollback.sh` - Manual rollback script
- `scripts/version-bump.sh` - Version management script
- Commitlint configuration for commit message validation

#### Kubernetes Manifests

- Base deployment with probes and resource limits
- Service with ClusterIP and headless service
- ConfigMap for non-sensitive configuration
- Staging ingress with TLS and rate limiting
- Production ingress with security headers and HSTS
- Resource quotas and limit ranges per environment

#### Notifications

- Slack notifications for deployment status
- Deployment success/failure alerts
- Release publication notifications

### Security

- Trivy vulnerability scanning for filesystem and containers
- Gitleaks secret detection
- SBOM generation for container images
- SARIF report uploads to GitHub Security
- Network policies for pod communication
- Security headers in production ingress

---

## [2.0.0] - 2026-01-12

### 🎉 Major Release - Comprehensive Documentation &amp; Review

This release focuses on comprehensive system documentation, analysis, and best practices documentation.

### Added

#### Documentation

- **DEVELOPER_GUIDE.md** - Complete developer onboarding guide with:
  - Getting started instructions
  - Project structure explanation
  - Development workflow
  - API development guide
  - Frontend development guide
  - Testing guide
  - Best practices

- **ARCHITECTURE.md** - Detailed system architecture documentation:
  - System overview and diagrams
  - Architecture patterns (Layered, DDD)
  - Technology stack breakdown
  - Database design with ERD
  - API architecture
  - Frontend architecture
  - Security architecture
  - Payment flow documentation
  - Deployment architecture
  - Scalability and performance strategies

- **API_DOCUMENTATION.md** - Complete API reference:
  - All endpoints documented with examples
  - Input/output schemas
  - Error handling guide
  - Rate limiting details
  - Authentication guide
  - Pagination documentation

- **SECURITY.md** - Comprehensive security guide:
  - Authentication and authorization
  - Data protection and encryption
  - Input validation
  - Payment security (PCI DSS)
  - API security
  - Database security
  - Infrastructure security
  - Security best practices
  - Incident response procedures
  - GDPR compliance guide

- **TROUBLESHOOTING.md** - Detailed troubleshooting guide:
  - Quick diagnostics
  - Installation issues
  - Database problems
  - API errors
  - Frontend issues
  - Payment issues
  - Performance problems
  - Deployment issues
  - Common error messages
  - Debug tools

- **.env.example** - Comprehensive environment variables template:
  - All required and optional variables
  - Detailed comments for each variable
  - Grouped by category
  - Security notes and best practices

- **CHANGELOG.md** - This file for tracking changes

### Documentation Improvements

- Enhanced README.md with better structure and clarity
- Added comprehensive inline comments throughout codebase
- Documented all environment variables
- Created troubleshooting flowcharts
- Added security best practices
- Documented database schema in detail
- Added API usage examples

### Developer Experience

- Improved error messages with actionable suggestions
- Added health check endpoints for monitoring
- Enhanced logging with structured format
- Better TypeScript type definitions
- Comprehensive test coverage documentation

### System Analysis

- Completed comprehensive system audit
- Identified and documented all features
- Analyzed architecture and design patterns
- Reviewed security implementation
- Evaluated performance characteristics
- Documented scalability considerations

---

## [1.5.0] - Previous Release

### Added

#### Features

- **E-Ticketing System** - PDF generation for tickets and boarding passes
- **Loyalty Program** - Miles earning and redemption with tier system
- **Booking Modifications** - Date changes and cabin upgrades
- **Refund Management** - Tiered cancellation fees and automatic refunds
- **Inventory Locking** - Prevents double booking with temporary locks
- **Multi-language Support** - Arabic and English (i18n)
- **Advanced Analytics** - Comprehensive admin dashboard with KPIs
- **Ancillary Services** - Extra services (baggage, meals, seats, etc.)
- **User Preferences** - Saved passenger information and preferences
- **Dynamic Pricing** - Occupancy and time-based pricing engine

#### Technical Improvements

- **Production-Ready Features:**
  - Environment validation with Zod
  - Graceful shutdown handling
  - Request ID tracking
  - Unified logging with PII masking
  - Health check endpoints
  - Idempotency for payments
  - Rate limiting
  - Database indexes optimization

#### Testing

- 70+ unit and integration tests
- Test coverage for all critical paths
- Vitest for backend testing
- Playwright for E2E testing

---

## [1.0.0] - Initial Release

### Added

#### Core Features

- **Flight Search** - Search flights by route and date
- **Booking System** - Complete booking flow from search to payment
- **Payment Integration** - Stripe checkout and webhooks
- **User Authentication** - OAuth via Manus
- **Admin Dashboard** - Flight and booking management
- **Check-in System** - Online check-in with seat selection

#### Technical Stack

- React 19 frontend with TypeScript
- Express + tRPC backend
- MySQL/TiDB database with Drizzle ORM
- Stripe payment integration
- Tailwind CSS + shadcn/ui
- Vite build system

#### Database Schema

- Users, Airlines, Airports tables
- Flights, Bookings, Passengers tables
- Payments, Refunds tables
- Flight status history
- Booking modifications

---

## Release Checklist Template

For future releases, ensure:

### Before Release

- [ ] All tests passing
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] Version bumped in package.json
- [ ] Environment variables documented
- [ ] Migration scripts tested
- [ ] Security audit completed
- [ ] Performance testing done

### Release Process

- [ ] Create release branch
- [ ] Run full test suite
- [ ] Build production bundle
- [ ] Tag release version
- [ ] Deploy to staging
- [ ] Smoke test on staging
- [ ] Deploy to production
- [ ] Monitor for errors

### Post-Release

- [ ] Verify production deployment
- [ ] Update documentation site
- [ ] Announce release
- [ ] Monitor metrics and logs
- [ ] Address any hotfixes

---

## Version History Summary

| Version | Date       | Highlights                                    |
| ------- | ---------- | --------------------------------------------- |
| 2.0.0   | 2026-01-12 | Comprehensive documentation and system review |
| 1.5.0   | 2025-11-23 | Production-ready features, loyalty program    |
| 1.0.0   | 2025-10-01 | Initial release with core booking system      |

---

## Upgrade Guide

### From 1.5.0 to 2.0.0

This is primarily a documentation release with no breaking changes to the API or database schema.

**Steps:**

1. Pull latest code: `git pull origin main`
2. Install any new dependencies: `pnpm install`
3. Review new documentation in `docs/` folder
4. Update your .env file using new .env.example as reference
5. No database migrations required

**New Documentation:**

- Read `docs/DEVELOPER_GUIDE.md` for development guidelines
- Review `docs/SECURITY.md` for security best practices
- Check `docs/TROUBLESHOOTING.md` if you encounter issues
- Refer to `docs/API_DOCUMENTATION.md` for API details

---

## Contributing

See our [Contributing Guidelines](CONTRIBUTING.md) for details on:

- Code style and standards
- Commit message format
- Pull request process
- Testing requirements

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

\*\*For detailed information about specific features, refer to the documentation in the `docs/` directory.
