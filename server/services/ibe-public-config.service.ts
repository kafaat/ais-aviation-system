import { isIP } from "node:net";

/** Operator-owned deployment configuration, never derived from request data. */
export function parseEmbedOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value))
    throw new Error(
      "IBE_EMBED_ALLOWED_ORIGINS cannot contain control characters"
    );
  const entries = value.split(",").map(origin => origin.trim());
  if (entries.length > 20 || value.length > 4096)
    throw new Error("IBE_EMBED_ALLOWED_ORIGINS contains too many origins");
  return [
    ...new Set(
      entries.map(origin => {
        try {
          if (!/^https:\/\/[^/]/i.test(origin) || /[\s\\%*?#@]/.test(origin))
            throw new Error();
          const url = new URL(origin);
          const dnsName =
            url.hostname.length <= 253 &&
            url.hostname
              .split(".")
              .every(label =>
                /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)
              );
          const ipv6 =
            url.hostname.startsWith("[") &&
            isIP(url.hostname.slice(1, -1)) === 6;
          if (
            url.protocol !== "https:" ||
            (!dnsName && !ipv6) ||
            url.username ||
            url.password ||
            url.pathname !== "/" ||
            url.search ||
            url.hash
          )
            throw new Error();
          return url.origin;
        } catch {
          throw new Error(
            "IBE_EMBED_ALLOWED_ORIGINS must contain only explicit HTTPS origins"
          );
        }
      })
    ),
  ];
}

export function publicIbeConfiguration(environment = process.env) {
  const brandName = environment.IBE_BRAND_NAME?.trim() || "AIS";
  if (brandName.length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(brandName))
    throw new Error("IBE_BRAND_NAME must be a short display name");
  const logoPath = environment.IBE_BRAND_LOGO_PATH?.trim() || null;
  if (
    logoPath &&
    (!/^\/[a-zA-Z0-9/_.,-]+\.(?:svg|png|jpe?g|webp|avif|gif)$/i.test(
      logoPath
    ) ||
      logoPath.startsWith("//") ||
      logoPath.split("/").some(part => part === "." || part === "..") ||
      new URL(logoPath, "https://branding.invalid").pathname !== logoPath)
  )
    throw new Error(
      "IBE_BRAND_LOGO_PATH must be a same-origin image asset path"
    );
  return {
    brandName,
    logoPath,
    embedSearchEnabled:
      parseEmbedOrigins(environment.IBE_EMBED_ALLOWED_ORIGINS).length > 0,
  };
}
