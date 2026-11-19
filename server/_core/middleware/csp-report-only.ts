import { createHash } from "node:crypto";

/**
 * Stage 1 of the CSP rollout (#355): a NON-enforcing Content-Security-Policy-Report-Only
 * header. Inline script/style blocks are allowed only by SHA-256 hash, computed from the
 * built client/index.html at startup, so the policy is bound to the build output.
 * There is no blanket 'unsafe-inline' and no 'unsafe-eval'.
 */

const sha256 = (body: string) =>
  `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;

/** Inline (src-less) <script>/<style> blocks, hashed over their exact text. */
export function inlineBlockHashes(html: string): {
  script: string[];
  style: string[];
} {
  const out = { script: [] as string[], style: [] as string[] };
  const re = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  for (const m of html.matchAll(re)) {
    const tag = m[1].toLowerCase() as "script" | "style";
    const attrs = m[2];
    const body = m[3];
    if (body === "") continue;
    if (tag === "script") {
      if (/\ssrc\s*=/i.test(attrs)) continue;
      const type = /\stype\s*=\s*["']?([^"'\s>]+)/i
        .exec(attrs)?.[1]
        ?.toLowerCase();
      // Data blocks (application/json, importmap excluded) are never executed.
      if (
        type &&
        !["module", "text/javascript", "application/javascript"].includes(type)
      )
        continue;
    }
    const h = sha256(body);
    if (!out[tag].includes(h)) out[tag].push(h);
  }
  return out;
}

export function buildReportOnlyPolicy(
  indexHtml: string | undefined,
  frameAncestors: string[]
): string {
  const { script, style } = indexHtml
    ? inlineBlockHashes(indexHtml)
    : { script: [], style: [] };
  return [
    "default-src 'self'",
    ["script-src 'self'", ...script, "https://js.stripe.com"].join(" "),
    ["style-src 'self'", ...style].join(" "),
    "img-src 'self' data: blob: https://*.stripe.com https://*.amazonaws.com",
    "font-src 'self' data:",
    "connect-src 'self' https://api.stripe.com wss: ws:",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors.join(" ")}`,
  ].join("; ");
}
