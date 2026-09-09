/** Credentials can be nested inside tRPC's serialized input. Never export the
 * raw HTTP payload or query through automatic error/transaction telemetry. */
export function redactTelemetryRequest<
  T extends {
    request?: {
      url?: string;
      headers?: Record<string, string>;
      data?: unknown;
      cookies?: unknown;
      query_string?: unknown;
    };
  },
>(event: T): T {
  if (!event.request) return event;
  const request = { ...event.request };
  delete request.data;
  delete request.cookies;
  delete request.query_string;
  if (request.url) {
    request.url = request.url
      .split(/[?#]/, 1)[0]
      .replace(/(https?:\/\/)[^/]*@/, "$1");
  }
  if (request.headers) {
    request.headers = Object.fromEntries(
      Object.entries(request.headers).filter(
        ([key]) =>
          ![
            "authorization",
            "cookie",
            "set-cookie",
            "x-api-key",
            "x-api-secret",
            "x-auth-token",
          ].includes(key.toLowerCase())
      )
    );
  }
  return { ...event, request };
}
