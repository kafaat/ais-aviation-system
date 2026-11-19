import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { request, type IncomingHttpHeaders } from "node:http";
import express from "express";
import { afterAll, describe, expect, it } from "vitest";
import { buildReportOnlyPolicy, inlineBlockHashes } from "./csp-report-only";
import { createSecurityHeaders } from "./security-headers";

const sha = (s: string) =>
  `'sha256-${createHash("sha256").update(s).digest("base64")}'`;

const HTML = `<!doctype html><html><head>
<script type="module" crossorigin src="/assets/index-x.js"></script>
<style>body{margin:0}</style>
<style media="print">p{color:#000}</style>
</head><body><script id="rt">window.a = 1;</script>
<script type="application/json">{"x":1}</script></body></html>`;

describe("inlineBlockHashes", () => {
  it("hashes inline scripts and styles exactly, skipping external and data scripts", () => {
    const h = inlineBlockHashes(HTML);
    expect(h.script).toEqual([sha("window.a = 1;")]);
    expect(h.style).toEqual([sha("body{margin:0}"), sha("p{color:#000}")]);
  });
});

describe("buildReportOnlyPolicy", () => {
  it("never allows blanket unsafe-inline or unsafe-eval", () => {
    const p = buildReportOnlyPolicy(HTML, ["'self'"]);
    expect(p).not.toContain("unsafe-inline");
    expect(p).not.toContain("unsafe-eval");
    expect(p).toContain(
      `script-src 'self' ${sha("window.a = 1;")} https://js.stripe.com`
    );
    expect(p).toContain("style-src 'self' " + sha("body{margin:0}"));
  });
  it("keeps the Stripe, tRPC, websocket, image and data defaults", () => {
    const p = buildReportOnlyPolicy(HTML, ["'self'"]);
    expect(p).toContain("connect-src 'self' https://api.stripe.com wss: ws:");
    expect(p).toContain(
      "img-src 'self' data: blob: https://*.stripe.com https://*.amazonaws.com"
    );
    expect(p).toContain(
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com"
    );
    expect(p).toContain("font-src 'self' data:");
    expect(p).toContain("frame-ancestors 'self'");
  });
  it("falls back to no inline allowance when there is no build", () => {
    expect(buildReportOnlyPolicy(undefined, ["'self'"])).toContain(
      "script-src 'self' https://js.stripe.com"
    );
  });
});

describe("security headers middleware", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "csp-"));
  writeFileSync(path.join(dir, "index.html"), HTML);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  async function get(staticRoot: string | undefined, dev = false) {
    const app = express();
    app.use(
      createSecurityHeaders({
        isDevelopment: dev,
        embedAllowedOrigins: "",
        staticRoot,
      })
    );
    app.get("*", (_q, r) => r.send("ok"));
    const server = await new Promise<import("node:http").Server>(res => {
      const s = app.listen(0, "127.0.0.1", () => res(s));
    });
    const port = (server.address() as { port: number }).port;
    try {
      return await new Promise<IncomingHttpHeaders>((resolve, reject) => {
        const q = request({ hostname: "127.0.0.1", port, path: "/" }, r => {
          r.resume();
          r.once("end", () => resolve(r.headers));
        });
        q.once("error", reject);
        q.end();
      });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }

  it("sends Report-Only bound to the build and leaves the enforcing header alone", async () => {
    const h = await get(dir);
    expect(h["content-security-policy-report-only"]).toContain(
      sha("window.a = 1;")
    );
    expect(h["content-security-policy-report-only"]).not.toContain(
      "unsafe-inline"
    );
    expect(h["content-security-policy"]).toContain("'unsafe-inline'");
    expect(h["content-security-policy"]).not.toContain("sha256-");
  });

  it("is not sent in development", async () => {
    const h = await get(dir, true);
    expect(h["content-security-policy-report-only"]).toBeUndefined();
  });
});

describe("edge config", () => {
  it("nginx does not hide or replace the application's Report-Only header", () => {
    const conf = readFileSync("nginx.conf", "utf8");
    expect(conf).not.toMatch(/proxy_hide_header\s+Content-Security-Policy/i);
    expect(conf).not.toMatch(
      /add_header\s+Content-Security-Policy-Report-Only/i
    );
  });
});

// Runs against the real Vite output when present (CI runs it after `pnpm build`).
const built = path.resolve("dist/public/index.html");
describe.skipIf(!existsSync(built))("actual built client", () => {
  it("every inline script and style in index.html is covered by a hash", () => {
    const html = readFileSync(built, "utf8");
    const policy = buildReportOnlyPolicy(html, ["'self'"]);
    const { script, style } = inlineBlockHashes(html);
    for (const h of [...script, ...style]) expect(policy).toContain(h);
    expect(script.length).toBeGreaterThan(0);
    expect(policy).not.toContain("unsafe-inline");
  });
});
