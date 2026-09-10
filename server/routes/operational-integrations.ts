import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createContext } from "../_core/context";
import { isAdmin } from "../services/rbac.service";
import { readExportContent } from "../services/data-warehouse.service";
import { consumeLocalEvent } from "../services/event-inbox.service";

export const operationalIntegrations = Router();
operationalIntegrations.get(
  "/data-warehouse/download/:id",
  async (req, res, next) => {
    try {
      const ctx = await createContext({ req, res });
      if (!ctx.user || !isAdmin(ctx.user.role)) {
        res.status(403).json({ error: "Administrator access required" });
        return;
      }
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const file = await readExportContent(id);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ais-export-${id}.${file.format}"`
      );
      res.setHeader("X-Content-SHA256", file.checksum);
      res
        .type(
          file.format === "csv"
            ? "text/csv"
            : file.format === "jsonl"
              ? "application/x-ndjson"
              : "application/json"
        )
        .send(file.content);
    } catch (error) {
      next(error);
    }
  }
);

const event = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1).max(100),
  aggregateId: z.string().min(1).max(255),
  aggregateType: z.string().min(1).max(100),
  tenantId: z.number().int().positive().nullable(),
  payload: z.record(z.string(), z.json()),
});
operationalIntegrations.post("/events/inbox", async (req, res, next) => {
  try {
    const expected = process.env.OUTBOX_PUBLISH_TOKEN;
    const supplied = req.headers.authorization?.replace(/^Bearer /, "");
    if (
      !expected ||
      expected.length < 32 ||
      !supplied ||
      Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
    ) {
      res.status(401).json({ error: "Receiver authentication required" });
      return;
    }
    const input = event.parse(req.body);
    if (req.headers["idempotency-key"] !== input.eventId) {
      res.status(400).json({ error: "Event identity mismatch" });
      return;
    }
    res.json({ accepted: true, ...(await consumeLocalEvent(input)) });
  } catch (error) {
    next(error);
  }
});
