const LOCAL_ORIGIN = "https://navigation.invalid";
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\\]/;
const ENCODED_CONTROL_OR_BACKSLASH =
  /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)|%c2%(?:8[0-9a-f]|9[0-9a-f])|%e2%80%a[89]/i;

/** These endpoints must never be the destination after authentication. */
export function isAuthenticationPath(pathname: string): boolean {
  return /^\/(?:login|register|logout|auth|api)(?:\/|$)/i.test(pathname);
}

/**
 * Accept only an application path on this origin, preserving its query/hash.
 * Validate decoded paths as well: browsers, routers and proxies must not be
 * able to reinterpret an encoded slash, dot segment or auth endpoint.
 */
export function safeReturnTo(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 8192 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value !== value.trim()
  )
    return "/";

  // Unwrap encoded percent signs independently of query encoding. A literal
  // percent in a valid query must not mask an encoded newline or backslash.
  let inspected = value;
  for (let depth = 0; depth < 8; depth++) {
    if (
      CONTROL_OR_BACKSLASH.test(inspected) ||
      ENCODED_CONTROL_OR_BACKSLASH.test(inspected)
    )
      return "/";
    const unwrapped = inspected.replace(/%25/gi, "%");
    if (unwrapped === inspected) break;
    if (depth === 7) return "/";
    inspected = unwrapped;
  }

  try {
    const url = new URL(value, LOCAL_ORIGIN);
    if (url.origin !== LOCAL_ORIGIN) return "/";

    let pathname = url.pathname;
    for (let depth = 0; depth < 8; depth++) {
      if (
        !pathname.startsWith("/") ||
        pathname.startsWith("//") ||
        CONTROL_OR_BACKSLASH.test(pathname) ||
        /[?#]/.test(pathname)
      )
        return "/";
      const normalized = new URL(pathname, LOCAL_ORIGIN);
      if (
        normalized.origin !== LOCAL_ORIGIN ||
        isAuthenticationPath(normalized.pathname)
      )
        return "/";
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname)
        return `${url.pathname}${url.search}${url.hash}`;
      pathname = decoded;
    }
  } catch {
    // Malformed path encoding is not a valid navigation target.
  }
  return "/";
}

export function loginPath(returnTo: unknown): string {
  const target = safeReturnTo(returnTo);
  return target === "/"
    ? "/login"
    : `/login?${new URLSearchParams({ returnTo: target })}`;
}
