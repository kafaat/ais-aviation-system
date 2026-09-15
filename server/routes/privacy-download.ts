import type { Request, Response } from "express";
import { createContext } from "../_core/context";
import { openPrivacyDownload } from "../services/privacy-export.service";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { TRPCError } from "@trpc/server";

export async function privacyDownload(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    const { user } = await createContext({ req, res });
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const requestId = Number(req.params.requestId);
    if (!Number.isSafeInteger(requestId) || requestId < 1) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const file = await openPrivacyDownload(user.id, requestId);
    res.setHeader("Content-Type", `${file.contentType}; charset=utf-8`);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="privacy-${requestId}.${file.contentType === "text/csv" ? "csv" : "json"}"`
    );
    await pipeline(Readable.from(file.content()), res);
  } catch (error) {
    if (res.headersSent || res.destroyed) {
      res.destroy();
      return;
    }
    res
      .status(
        error instanceof TRPCError && error.code === "UNAUTHORIZED"
          ? 401
          : error instanceof TRPCError &&
              ["NOT_FOUND", "FORBIDDEN"].includes(error.code)
            ? 404
            : 503
      )
      .json({ error: "Download unavailable" });
  }
}
