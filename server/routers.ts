import { systemRouter } from "./_core/systemRouter";
import { router } from "./_core/trpc";

// Import domain routers
import { flightsRouter } from "./routers/flights";
import { bookingsRouter } from "./routers/bookings";
import { paymentsRouter } from "./routers/payments";
import { refundsRouter } from "./routers/refunds";
import { adminRouter } from "./routers/admin";
import { analyticsRouter } from "./routers/analytics";
import { referenceRouter } from "./routers/reference";
import { modificationsRouter } from "./routers/modifications";
import { loyaltyRouter } from "./routers/loyalty";
import { eticketRouter } from "./routers/eticket";
import { userPreferencesRouter } from "./routers/user-preferences";
import { ancillaryRouter } from "./routers/ancillary";
import { healthRouter } from "./routers/health";
import { reviewsRouter } from "./routers/reviews";
import { favoritesRouter } from "./routers/favorites";
import { priceAlertsRouter } from "./routers/price-alerts";
import { aiChatRouter } from "./routers/ai-chat";
import { reportsRouter } from "./routers/reports";
import { gdprRouter } from "./routers/gdpr";
import { rateLimitRouter } from "./routers/rate-limit";
import { metricsRouter } from "./routers/metrics";
import { authRouter } from "./routers/auth";
import { cacheRouter } from "./routers/cache";
import { groupBookingsRouter } from "./routers/group-bookings";
import { specialServicesRouter } from "./routers/special-services";

/**
 * Main Application Router
 * Combines all domain routers into a single API
 */
export const appRouter = router({
  // System router (AI, notifications, etc.)
  system: systemRouter,

  // Authentication routes (JWT token-based auth with refresh)
  // Endpoints:
  //   - me: Get current authenticated user (works with cookie or JWT)
  //   - login: Login with email/password -> returns access + refresh tokens
  //   - refreshToken: Refresh access token using refresh token (implements rotation)
  //   - logout: Revoke refresh token (for JWT clients)
  //   - logoutCookie: Clear session cookie (for web clients)
  //   - logoutAllDevices: Revoke all refresh tokens for user
  //   - getActiveSessions: List all active sessions for user
  //   - revokeSession: Revoke a specific session
  //   - verifyToken: Verify and decode an access token
  auth: authRouter,

  // Domain routers
  flights: flightsRouter,
  bookings: bookingsRouter,
  payments: paymentsRouter,
  refunds: refundsRouter,
  admin: adminRouter,
  analytics: analyticsRouter,
  reference: referenceRouter,
  modifications: modificationsRouter,
  loyalty: loyaltyRouter,
  eticket: eticketRouter,
  userPreferences: userPreferencesRouter,
  ancillary: ancillaryRouter,
  health: healthRouter,
  reviews: reviewsRouter,
  favorites: favoritesRouter,
  priceAlerts: priceAlertsRouter,
  aiChat: aiChatRouter,
  reports: reportsRouter,
  gdpr: gdprRouter,
  rateLimit: rateLimitRouter,
  metrics: metricsRouter,
  cache: cacheRouter,
  groupBookings: groupBookingsRouter,
  specialServices: specialServicesRouter,
});

export type AppRouter = typeof appRouter;
