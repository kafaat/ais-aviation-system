# HTTP QUERY pilot: Load Factors preview

## Scope and decision

This pilot exposes report **44, Load Factors**, at
`/api/rest/reports/preview` using the HTTP `QUERY` method. It also accepts `POST`
with the same JSON contract for clients that need a conventional transport.
The existing Standard Reports screen uses `QUERY` for report 44 and falls back
to the existing `standardReports.run` tRPC operation only when the first HTTP
response has status `404`, `405`, or `501`. Other reports continue through their
existing transport.

The purpose is to prove an authenticated query with a body through AIS's real
report authorization and reader. It does not establish a performance benefit or
support by a deployed gateway. The staging and production ingress manifests
allow `QUERY` in CORS and expose `Accept-Query` and `Allow`; the gateway journey
below still needs evidence from the exact deployment being evaluated.

Report 44 reads flight inventory and calculates booked load factors. It uses
the existing repeatable-read report transaction and fixed, parameterized reader.
It does not reconcile baggage, expire holds, modify bookings, allocate inventory,
create scheduled report runs, or send reports. Those operations are outside this
pilot. Do not extend the allowlist to another report merely because its tRPC
procedure is named a query; inspect the complete service call path first.

## HTTP contract

| Property         | Contract                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------- |
| Path             | `/api/rest/reports/preview`                                                                  |
| Methods          | `QUERY`, `POST`, `OPTIONS`                                                                   |
| Input media type | `application/json`, including a supported charset parameter                                  |
| Input body limit | 1 MiB, matching the application JSON request limit                                           |
| Report allowlist | `reportId: 44` only                                                                          |
| Authorization    | Existing authenticated report staff and report-category checks                               |
| Tenant scope     | Derived from the authenticated user; the existing platform-admin scope is preserved          |
| Success body     | The existing `StandardReportResult` JSON object, without a tRPC envelope                     |
| Discovery        | `OPTIONS` returns `204`, `Allow: QUERY, POST, OPTIONS`, and `Accept-Query: application/json` |
| Caching          | `Cache-Control: no-store` for the preview route                                              |

The handler uses the original server caller, preserving input and output
validation, role checks, tenant checks, and the report service. The method name
is not an authentication or authorization signal. The input cannot select an
arbitrary procedure, tenant, table, or SQL expression.

Example request body:

```json
{
  "reportId": 44,
  "filters": {
    "startDate": "2026-11-01",
    "endDate": "2026-11-05"
  },
  "columns": ["flightNumber", "capacity", "sold", "loadFactorPercent"]
}
```

`filters` defaults to an empty object. Report 44 accepts `startDate`, `endDate`,
`flightId`, `origin`, `destination`, and `status`; the existing report contract
rejects unsupported filters and invalid values. Date filters select whole UTC
departure days, including the end date. Airport filters use IATA codes. Optional
`columns` must be a nonempty, unique selection from this report's known columns.
Unknown fields are rejected rather than interpreted as a query language.
Input must be in the body; this resource rejects URL query parameters rather
than merging them with body fields. Clients must accept a JSON response.

The existing reader rejects results exceeding 10,000 rows, and the report
service rejects a preview table exceeding 8 MiB. These are output bounds, not a
claim that every allowed query is cheap. Prefer a useful date or flight filter.
The booked load factor is based on recorded sold inventory; it is not a flown
passenger measure. Zero-capacity flights have a null load factor. Active holds
and effective availability remain separate values.

| HTTP status   | Meaning and client behavior                                                                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200`         | A validated report result is returned.                                                                                                                                                                   |
| `204`         | Successful `OPTIONS` discovery; no response body.                                                                                                                                                        |
| `400`         | Invalid JSON or request contract, missing `Content-Type`, URL query parameters, a report outside the pilot, unsupported report filters/columns, or existing report bounds. Fix the input.                |
| `401` / `403` | Authentication, role, or tenant access failed. Do not fall back or weaken the checks.                                                                                                                    |
| `404`         | The route may be absent on an older deployment, or the existing reader may report that a selected flight is outside its scope. The UI permits one compatibility fallback using the same validated input. |
| `405`         | This path does not accept the requested method; inspect `Allow`.                                                                                                                                         |
| `406`         | The client's `Accept` header does not permit `application/json`.                                                                                                                                         |
| `413`         | Request body exceeds 1 MiB. Narrow the request.                                                                                                                                                          |
| `415`         | Unsupported content type or JSON encoding.                                                                                                                                                               |
| `429`         | Existing request limits were reached. Surface the error and respect the server's retry guidance.                                                                                                         |
| `5xx`         | Server, database, or gateway failure. The UI falls back only for `501`, which can indicate unsupported transport.                                                                                        |

Application errors use the existing JSON `code` and `message` convention. A
gateway may generate its own response before AIS sees the request; record which
layer answered. No fallback is added for network failures, malformed successful
responses, authorization failures, timeouts, or rate limits. No general retry
loop is added: each additional query still consumes resources and rate limits.

## QUERY versus tRPC query

HTTP `QUERY` is the method on the wire. A tRPC `.query()` is a procedure kind;
the project's tRPC HTTP transport uses `GET` for that kind by default. React
Query's `.useQuery()` is client state management, not an HTTP method selection.
The project uses an explicit preview route because the pinned tRPC transport
does not natively accept `QUERY` for arbitrary procedures. This pilot does not
rewrite incoming methods or globally enable another method on tRPC routes.

RFC 10008 defines `QUERY` as safe and idempotent with respect to its target.
Repeating report 44 must not change flight or booking state, but its result can
change when inventory changes or holds expire. `generatedAt` also changes on
each run. Successful repeated responses are not required to be byte-identical.

`Accept-Query` advertises accepted media types for this resource. It is not CORS
permission and does not imply support by an intermediary. It is a Structured
Field; future changes must preserve that syntax. This pilot does not cache
responses. Any future cache would need the request body, its media metadata, and
the applicable authorization scope in its design, with tests for different
bodies and tenants sharing one URL.

## Manual checks

Use an authorized test account and fixtures in the environment being evaluated.
Set `AIS_QUERY_BASE_URL` to the API origin and `AIS_QUERY_TEST_TOKEN` to a valid
test bearer token. Do not include token values in an evidence receipt.

### Resource discovery

```bash
curl --silent --show-error --include \
  --request OPTIONS \
  "${AIS_QUERY_BASE_URL}/api/rest/reports/preview"
```

At the application boundary, expect `204`, `Allow: QUERY, POST, OPTIONS`,
`Accept-Query: application/json`, and `Cache-Control: no-store`.

### Query and compatible POST

```bash
curl --silent --show-error --include \
  --request QUERY \
  "${AIS_QUERY_BASE_URL}/api/rest/reports/preview" \
  --header "Authorization: Bearer ${AIS_QUERY_TEST_TOKEN}" \
  --header 'Content-Type: application/json' \
  --data-raw '{"reportId":44,"filters":{"startDate":"2026-11-01","endDate":"2026-11-05"},"columns":["flightNumber","capacity","sold","loadFactorPercent"]}'
```

Repeat with `--request POST` and the same body. Against stable fixtures, compare
the report ID, columns, and rows; do not compare `generatedAt`. Both transports
must enforce the same permissions. Inspect the response headers to confirm
`no-store`; a success status alone does not prove the cache policy.

Use another report ID, such as `17`, as a negative test. It must be rejected
without reaching that report's service. Test malformed JSON, a missing content
type, a body over 1 MiB, and `GET` on this path separately. None should execute
the report reader.

### Browser CORS preflight

For a browser UI served from another origin, set `AIS_QUERY_UI_ORIGIN` to its
actual allowed origin:

```bash
curl --silent --show-error --include \
  --request OPTIONS \
  "${AIS_QUERY_BASE_URL}/api/rest/reports/preview" \
  --header "Origin: ${AIS_QUERY_UI_ORIGIN}" \
  --header 'Access-Control-Request-Method: QUERY' \
  --header 'Access-Control-Request-Headers: content-type,authorization'
```

The gateway's successful preflight must allow the actual origin, `QUERY`, and
the requested headers. For cookie authentication, verify credentialed CORS with
the actual browser and the configured origin policy. The actual response must
expose `Accept-Query` and `Allow` if the client needs to read them across origins.
Also test a disallowed origin; adding `QUERY` must not broaden the origin policy.

Ingress can answer a CORS preflight before forwarding it to AIS. Such an
`OPTIONS` response may not contain the application's `Accept-Query` header.
Check CORS permission and application discovery separately. The UI does not
send a separate discovery request before every preview; normal browser CORS
preflight still applies when required. A successful curl request is not proof
that browser CORS succeeds.

## Gateway acceptance evidence

Record each result for the exact image digest, commit, runtime, and gateway
configuration tested. Leave unexecuted steps explicitly unverified.

1. **Runtime and parser:** record `process.version` and
   `process.versions.llhttp` from the actual AIS container. Send a real request
   and verify that the handler receives `req.method === "QUERY"` and the
   complete JSON body. `http.METHODS.includes("QUERY")` alone is insufficient.
2. **Application:** prove `QUERY` and `POST` return the expected report-44 rows;
   other report IDs and methods are rejected. Verify the JSON error cases and
   headers, including failures generated by the body parser and rate limiter.
3. **Authentication and scope:** test anonymous access, an allowed operations
   account, a role outside the report category, a revoked/inactive account, and
   two tenants with different fixtures. Preserve the existing platform-admin
   semantics instead of treating platform administrators as ordinary tenants.
4. **No business writes:** compare flight inventory, bookings, hold records,
   report-run records, and delivery/outbox records around repeated previews.
   Request metrics and ordinary access records are not business state changes.
5. **Gateway and browser:** send the same requests through the public staging
   URL and the intended browser origin, including OPTIONS and a disallowed
   origin. Verify that the body survives every proxy hop and that a cached
   result from another request is never returned.
6. **Compatibility fallback:** simulate `404`, `405`, and `501` at the preview
   transport and verify one existing tRPC POST fallback with unchanged input.
   Verify that `401`, `403`, `429`, other `5xx`, and network errors are surfaced.
7. **Rollout evidence:** retain method, status, request ID, body digest, output
   fixture identity, elapsed time, and relevant response headers. Do not record
   credentials or raw confidential report rows. Local tests and manifest edits
   do not establish production acceptance.

Node's corrected QUERY method mapping shipped in Node **22.2.0**. The repository
uses the Node 22 family for Docker/CI, but a major-version tag does not identify
the patch version or prove which image is running. Confirm the actual container
and all gateway method allowlists. Do not relax the HTTP parser to accept this
method.

## References

- [RFC 10008: The HTTP QUERY Method](https://www.rfc-editor.org/rfc/rfc10008.html)
- [IANA HTTP Method Registry](https://www.iana.org/assignments/http-methods/http-methods.xhtml)
- [WHATWG Fetch: methods and CORS](https://fetch.spec.whatwg.org/#methods)
- [tRPC HTTP RPC specification](https://trpc.io/docs/rpc)
- [tRPC v11.18.0 accepted HTTP methods](https://github.com/trpc/trpc/blob/v11.18.0/packages/server/src/unstable-core-do-not-import/http/resolveResponse.ts)
- [Node 22.2.0 release and HTTP method mapping fix](https://nodejs.org/en/blog/release/v22.2.0)
- [Express QUERY support investigation](https://github.com/expressjs/express/issues/5615)
