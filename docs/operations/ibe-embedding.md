# Public booking search embedding and deployment identity

`/embed/search` is an optional anonymous **search-only** document. It does not
render the account application router, sign-in, passenger forms, or payment UI.
A conservative client entry classifier also isolates encoded, duplicate-slash,
and dot-segment variants that a reverse proxy could normalize to this document.
The server continues to grant its framing exception only to the exact path.
A normal GET form with `target="_top"` opens `/search` on the booking origin after
the user submits. Authentication and checkout continue in the normal application.

## Operator configuration

| Variable                    | Default | Contract                                                                                                                                                                                                                                          |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IBE_EMBED_ALLOWED_ORIGINS` | Empty   | Comma-separated explicit HTTPS origins, for example `https://www.airline.example,https://airline.example`. No wildcard, credentials, paths, query strings, fragments, encoded origins, or control characters. Invalid configuration fails closed. |
| `IBE_BRAND_NAME`            | `AIS`   | Operator-owned display name, at most 80 characters. Rendered as text.                                                                                                                                                                             |
| `IBE_BRAND_LOGO_PATH`       | Empty   | Same-origin image asset path, such as `/branding/airline.svg`; no external URL, query string, path traversal, or encoded path. The operator supplies and serves this asset.                                                                       |

The public `ibePublic.config` query exposes only the display name, logo path, and
whether search embedding is enabled. The allowed origins, credentials, and tenant
settings are not returned. Request parameters cannot override branding or select
a tenant. This configuration is deployment-wide; it is not a new tenant policy.
Existing authenticated tenant and ownership checks remain authoritative.

With an empty origin list, the embed form is not offered and external framing
remains blocked. On the exact `GET`/`HEAD /embed/search` document, an enabled
allowlist changes only `frame-ancestors` to `'self'` plus the configured origins,
and omits X-Frame-Options, which cannot represent a multi-origin allowlist. This
ancestor policy remains active during development even when other CSP directives
are disabled for Vite. Other URLs and HTTP methods retain the ordinary policy.

## Host page

Serve the corporate page over HTTPS on an origin in the allowlist:

```html
<iframe
  title="Find a flight"
  src="https://book.airline.example/embed/search?currency=USD&country=US&adults=2&children=1&infants=0"
  width="100%"
  height="620"
  sandbox="allow-scripts allow-forms allow-same-origin allow-top-navigation-by-user-activation"
></iframe>
```

The form accepts origin/destination airport IDs, a civil departure date
(`YYYY-MM-DD`), and the shared public search preferences. Values are validated,
and arbitrary source query parameters are not forwarded. `currency` selects a
display preference; it does not alter the invoice's settlement currency.
Do not add passenger names, passports, credentials, or booking references to the
iframe URL. No parent-origin postMessage API or session sharing is introduced.

The parent's own CSP must also permit the booking origin in `frame-src`.
The parent must permit scripts, forms and user-activated top navigation. The app
does not automatically navigate the parent, read its DOM, or depend on third-party
cookies for public search. Selecting search opens the normal booking origin at
the top level, where existing cookie/session rules apply.

## Reverse proxies

The repository's `nginx.conf` keeps `X-Frame-Options: DENY` for every other URI.
Only the exact `/embed/search` URI takes XFO from the upstream app: SAMEORIGIN
when disabled, absent when the configured CSP ancestor policy is enabled. It
continues to forward the app's Content-Security-Policy. Its additional CSP does
not set `frame-ancestors`, so it does not override the app's ancestor policy.

The production ingress manifest retains its original DENY annotation on `/` and
adds a separate **Exact** `/embed/search` ingress for the same hosts and service.
That location forwards application CSP/XFO without a DENY override. A controller
or CDN that injects DENY globally will still prevent embedding and must preserve
the application policy on this exact public route. Do not remove protections
from `/login`, `/my-bookings`, `/booking/*`, or checkout routes.

Before enabling the feature behind a deployed proxy, inspect the rendered nginx
configuration (`nginx -T`, or the ingress controller's rendered configuration)
and verify the response headers on that deployment:

```sh
curl -sSI https://book.airline.example/embed/search
curl -sSI https://book.airline.example/my-bookings
curl -sSI https://book.airline.example/login
```

With embedding enabled, the first response must contain exactly the intended
`frame-ancestors` list and no conflicting XFO or additional ancestor restriction.
The account and login responses must retain their default framing restriction.
Also check an unlisted HTTPS parent is blocked, a listed parent can display the
form, and a real click opens the normal search page with the chosen parameters.
These checks are required after any CDN/proxy configuration change.

## Display estimates

Country and currency are independent display preferences. Selecting Yemen
(`YE`) and the Yemeni rial (`YER`) carries those preferences through the
native booking journey. Fares, invoices and wallet charges remain in SAR.

`ibePublic.displayRate` reads the newest effective direct SAR quote for the
selected currency from `exchange_rates`. The rate is target major units per
one SAR. Operators may record a verified observation with source `manual`,
`bank` or `openexchangerates`. Use the observation time for `validFrom` and
the provider's earlier expiry, if any, for `validTo`. Quotes expire at the
earlier of that expiry or 24 hours after observation. An edit to the row does
not extend its validity. Without an eligible quote, AIS displays the SAR price
and explains why no local estimate is shown. No YER quote is seeded.

## Verification limits

The browser suite runs the built AIS application with an isolated MySQL database
and two test corporate origins. It checks browser enforcement of the frame
allowlist, a user-activated top-level search, mobile entry links, operator
branding and display currency. DNS, TLS and the deployed proxy still require
verification on each operator's own domain.
