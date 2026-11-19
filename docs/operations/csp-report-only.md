# CSP Report-Only (stage 1, #355)

The API server (`server/_core/middleware/security-headers.ts`) sends
`Content-Security-Policy-Report-Only` on every non-development response, next to the
unchanged enforcing `Content-Security-Policy`. Inline script and style blocks are
allowed only by SHA-256 hash, computed at startup from `dist/public/index.html`
(`csp-report-only.ts`), so the policy follows the build. No `unsafe-inline`, no
`unsafe-eval`. `nginx.conf` is untouched; it proxies the header through.

Built client inventory (Vite 7 production build):

- Inline script: one, `<script id="manus-runtime">` (hashed).
- Inline style blocks or `style=` in index.html markup: none.
- Runtime-injected `<style>` elements (not hashable from index.html): the manus runtime
  and a vendor chunk (`appendChild(createTextNode)` style injection). A browser check
  against the built output reported 3 `style-src-elem` violations, all of these.

Not done, by design: enforcement. Before it, either remove or nonce the runtime style
injection (needs per-response nonce on a server-rendered index.html) and collect real
reports (no report endpoint exists yet; this stage is visible in the browser console).
