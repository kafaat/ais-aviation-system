/** A deployment may publish an airline-operated help desk to passengers. */
export function airlineSupportUrl(): URL | undefined {
  const configuredUrl = import.meta.env.VITE_AIRLINE_SUPPORT_URL;
  if (!configuredUrl) return;
  try {
    const url = new URL(configuredUrl);
    if (url.protocol === "https:" && !url.username && !url.password) return url;
  } catch {
    // An invalid deployment setting falls back to offline contact guidance.
  }
}
