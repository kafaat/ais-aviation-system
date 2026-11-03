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

The repository's `nginx.conf` keeps `X-Frame-Options: DENY` on the rest of the application except for the two optional Videcom brand documents below.
The exact `/embed/search` URI takes XFO from the upstream app: SAMEORIGIN
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

## Verification limits

Repository tests exercise actual Express/Helmet HTTP responses, invalid origin
configuration, public config behavior, and the real React form's native GET/top
navigation contract. They do not establish deployment-specific DNS, TLS, ingress
controller behavior, browser sandbox acceptance, or provider acceptance. No
infrastructure settings are mutated by enabling these source changes.

## Videcom-hosted reservations

Use the airline's assigned Videcom HTTPS booking host to offer its inventory
and manage its reservations separately from AIS reservations. Set
`VIDECOM_IBE_BASE_URL` to the assigned origin, with the airline prefix on a
shared host (for example, `https://customer.example/yourairline`). Omit
`VARS/Public/CustomerPanels` and the panel filename. Leave the variable empty
to hide the homepage link and return 404 on the three dedicated documents.
Set the same values on every API replica and restart them.

A normal link from the corporate site to `/videcom` opens the bilingual entry
page. Its public search and manage-booking panels are served directly by the
configured provider. Each panel also has a direct link for browsers that block
cross-site cookies or frames. The agent signs in on the provider's own page.
Only a two-letter `country` and three-letter `currency` can be sent to the
search panel, for example `?country=ye&currency=YER`. Videcom validates the
market and currency it supports, receives the browser request directly and determines its
own location, fares, currency policy and session. AIS never sends the booking
reference, credentials or AIS session token in a launch URL. Use host-only
session cookies on separate AIS and provider hosts.

| Corporate site integration | Destination relative to the assigned base        |
| -------------------------- | ------------------------------------------------ |
| Public search              | `VARS/Public/CustomerPanels/requirementsBS.aspx` |
| Manage booking             | `VARS/Public/CustomerPanels/MMBLoginbs.aspx`     |
| Travel agent               | `VARS/Public/CustomerPanels/AgentLoginBS.aspx`   |

The portal is a standalone top-level page. If the corporate CMS needs inline
panels on its homepage, embed the provider panel URLs directly in the CMS
and permit the assigned origin in the CMS frame policy. Request the provider
to allow the corporate origin to frame its panels. On a shared host, preserve
the airline prefix when copying URLs.

### Provider setup and acceptance

1. Obtain the assigned HTTPS URL and verify the three panel paths with Videcom.
   If using the airline's own booking subdomain, have its DNS owner set the A
   record to the IP supplied by Videcom and have Videcom provision the matching
   TLS certificate. The dedicated booking host and the AIS corporate site must
   be distinct origins.
2. Set `IBE_BRAND_NAME`, `IBE_BRAND_LOGO_PATH` and optionally
   `VIDECOM_BRAND_COLOR` (six-digit hex). Supply Videcom the absolute HTTPS URLs
   for `/videcom/brand/header` and `/videcom/brand/footer` on the AIS site, or
   supply equivalent documents from the airline's CMS. Ask Videcom to insert
   them into its hosted pages and configure the provider's own content colors.
   AIS serves the brand documents and cannot change provider-side templates.
3. On the target domain, verify DNS and TLS, then use the provider's test
   inventory and test accounts. Open the public panel, search, confirm that the
   top-level address is the assigned host and select a seat on that itinerary.
   Retrieve a test booking and sign in as a test agent. Verify the header and
   footer inside the provider page and compare the quoted fare to the one on the
   provider's own panel for the same market. Record date, origin, environment
   and outcome using non-personal test references.
4. To disable this entry, remove `VIDECOM_IBE_BASE_URL` on every replica and
   restart. Native AIS itineraries and account routes remain available.
