import helmet from "helmet";
import type { RequestHandler } from "express";
import { parseEmbedOrigins } from "../../services/ibe-public-config.service";

function headerSet(
  isDevelopment: boolean,
  frameAncestors: string[],
  embedded = false
) {
  return helmet({
    // Development keeps the existing HMR policy except on the embeddable
    // document, where the ancestor restriction must always be enforced.
    contentSecurityPolicy:
      isDevelopment && !embedded
        ? false
        : {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: [
                "'self'",
                "https://js.stripe.com",
                // Allow inline scripts for React hydration if needed
                "'unsafe-inline'",
              ],
              styleSrc: [
                "'self'",
                // Required for inline styles in React components and Tailwind
                "'unsafe-inline'",
              ],
              imgSrc: [
                "'self'",
                "data:",
                "blob:",
                "https://*.stripe.com",
                // Allow common CDNs for images
                "https://*.amazonaws.com",
              ],
              fontSrc: ["'self'", "data:"],
              connectSrc: [
                "'self'",
                "https://api.stripe.com",
                // WebSocket connections
                "wss:",
                "ws:",
              ],
              frameSrc: [
                "'self'",
                "https://js.stripe.com",
                "https://hooks.stripe.com",
              ],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
              frameAncestors,
              upgradeInsecureRequests: isDevelopment ? null : [],
            },
          },
    // Cross-Origin-Embedder-Policy - set to false to allow Stripe iframe embedding
    crossOriginEmbedderPolicy: false,
    // Cross-Origin-Opener-Policy - allow popups for Stripe payment flows
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    // Cross-Origin-Resource-Policy - allow cross-origin for API responses
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // DNS Prefetch Control - allow DNS prefetching for performance
    dnsPrefetchControl: { allow: true },
    // Expect-CT header (deprecated but still useful for some browsers)
    // Frameguard - X-Frame-Options: SAMEORIGIN (prevents clickjacking)
    frameguard: embedded ? false : { action: "sameorigin" },
    // Hide X-Powered-By header
    hidePoweredBy: true,
    // HTTP Strict Transport Security (HSTS)
    hsts: {
      maxAge: 31536000, // 1 year in seconds
      includeSubDomains: true,
      preload: true,
    },
    // IE No Open - X-Download-Options for IE8+
    ieNoOpen: true,
    // No Sniff - X-Content-Type-Options: nosniff
    noSniff: true,
    // Origin Agent Cluster header
    originAgentCluster: true,
    // Permitted Cross-Domain Policies - X-Permitted-Cross-Domain-Policies
    permittedCrossDomainPolicies: { permittedPolicies: "none" },
    // Referrer Policy
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // X-XSS-Protection (legacy but still useful)
    xssFilter: true,
  });
}

/** Only the dedicated anonymous search document may have external ancestors. */
export function createSecurityHeaders(
  options: {
    isDevelopment?: boolean;
    embedAllowedOrigins?: string;
  } = {}
): RequestHandler {
  const isDevelopment =
    options.isDevelopment ?? process.env.NODE_ENV === "development";
  const origins = parseEmbedOrigins(
    options.embedAllowedOrigins ?? process.env.IBE_EMBED_ALLOWED_ORIGINS
  );
  const ordinary = headerSet(isDevelopment, ["'self'"]);
  const embedded = headerSet(isDevelopment, ["'self'", ...origins], true);
  return (req, res, next) => {
    const allowEmbed =
      origins.length > 0 &&
      req.path === "/embed/search" &&
      (req.method === "GET" || req.method === "HEAD");
    if (allowEmbed) res.removeHeader("X-Frame-Options");
    return (allowEmbed ? embedded : ordinary)(req, res, next);
  };
}
