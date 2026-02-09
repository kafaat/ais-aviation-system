import type { Request, Response, NextFunction } from "express";
import { createServiceLogger } from "../logger";

const log = createServiceLogger("request-timeout");

/** Default timeout: 30 seconds */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Express middleware that enforces a maximum request duration.
 * If the response is not sent within the timeout, a 408 is returned.
 */
export function requestTimeoutMiddleware(
  timeoutMs: number = DEFAULT_TIMEOUT_MS
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        log.warn(
          {
            method: req.method,
            path: req.path,
            timeoutMs,
          },
          "Request timed out"
        );
        res.status(408).json({
          error: "Request Timeout",
          message: `Request exceeded the ${timeoutMs}ms time limit`,
        });
      }
    }, timeoutMs);

    // Clean up timer when response finishes
    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));

    next();
  };
}
