/**
 * A proxy can decode/normalize the request path before applying the server's
 * exact embed policy. Classify at least those paths as the isolated public
 * document, even when location.pathname retains the original encoding.
 * This deliberately does not grant permission to frame any server route.
 */
export function isEmbeddedSearchDocument(pathname: string): boolean {
  let candidate = pathname;
  for (let depth = 0; depth < 8; depth++) {
    const parts: string[] = [];
    const path = candidate.replaceAll("\\", "/").split(/[?#]/, 1)[0];
    for (const part of path.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") parts.pop();
      else parts.push(part);
    }
    if (`/${parts.join("/")}`.toLowerCase() === "/embed/search") return true;
    // The target is ASCII; decoding percent bytes also handles malformed UTF-8
    // without letting an unrelated invalid byte mask an encoded path separator.
    const decoded = candidate.replace(
      /%([0-9a-f]{2})/gi,
      (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))
    );
    if (decoded === candidate) return false;
    candidate = decoded;
  }
  // An ambiguously deep encoding must never opt in to the account application.
  return true;
}
