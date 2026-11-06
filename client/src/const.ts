import { safeReturnTo } from "@shared/return-to";
export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const APP_TITLE = import.meta.env.VITE_APP_TITLE || "App";

export const APP_LOGO = "https://placehold.co/128x128/E1E7EF/1F2937?text=App";

// The server binds a one-use state to this browser before redirecting to OAuth.
export const getLoginUrl = (returnTo?: string): string => {
  const target = safeReturnTo(returnTo);
  return target === "/"
    ? "/api/oauth/start"
    : `/api/oauth/start?${new URLSearchParams({ returnTo: target })}`;
};
