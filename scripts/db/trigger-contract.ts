import { createHash } from "node:crypto";

export interface Trigger {
  table: string;
  timing: string;
  event: string;
  bodyHash: string;
}

export function triggerBodyHash(body: string): string {
  // Compare the SQL text exactly, including whitespace inside string literals.
  return createHash("sha256").update(body.trim()).digest("hex");
}

/** Drizzle snapshots omit triggers. Derive their state at each journal boundary
 * from the immutable SQL statements executed by the migrator. */
export function applyTriggerDDL(
  triggers: Record<string, Trigger>,
  sql: string
): void {
  for (const statement of sql.split("--> statement-breakpoint")) {
    const ddl = statement
      .replace(/^(?:\s+|--[^\n]*(?:\n|$)|\/\*(?![!])[\s\S]*?\*\/)+/, "")
      .trim()
      .replace(/;$/, "");
    if (!/^(?:CREATE|DROP)\b/i.test(ddl) || !/\bTRIGGER\b/i.test(ddl)) continue;
    const create =
      /^CREATE\s+TRIGGER\s+`?(\w+)`?\s+(BEFORE|AFTER)\s+(INSERT|UPDATE|DELETE)\s+ON\s+`?(\w+)`?\s+FOR\s+EACH\s+ROW\s+([\s\S]+)$/i.exec(
        ddl
      );
    if (create) {
      const [, name, timing, event, table, body] = create;
      // Multiple triggers for one event require an explicit execution order.
      if (
        /^(?:FOLLOWS|PRECEDES)\b/i.test(body) ||
        Object.values(triggers).some(
          t =>
            t.table === table &&
            t.timing === timing.toUpperCase() &&
            t.event === event.toUpperCase()
        )
      )
        throw new Error(`UNSUPPORTED_TRIGGER_ORDER: ${name}`);
      triggers[name] = {
        table,
        timing: timing.toUpperCase(),
        event: event.toUpperCase(),
        bodyHash: triggerBodyHash(body),
      };
      continue;
    }
    const drop = /^DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?`?(\w+)`?$/i.exec(ddl);
    if (drop) {
      delete triggers[drop[1]];
      continue;
    }
    if (/^(?:CREATE\s+(?:DEFINER\s*=\s*\S+\s+)?|DROP\s+)TRIGGER\b/i.test(ddl))
      throw new Error("UNSUPPORTED_TRIGGER_DDL");
  }
}
