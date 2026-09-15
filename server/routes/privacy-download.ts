import type { Request, Response } from "express";
import { createContext } from "../_core/context";
import { downloadDataExport } from "../services/gdpr.service";
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
    const file = await downloadDataExport(user.id, requestId);
    res.setHeader("Content-Type", `${file.contentType}; charset=utf-8`);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="privacy-${requestId}.${file.contentType === "text/csv" ? "csv" : "json"}"`
    );
    res.send(file.content);
  } catch (error) {
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
