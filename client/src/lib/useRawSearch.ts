import { useRouter } from "wouter";

/**
 * Wouter's useSearch applies decodeURI before URLSearchParams can parse it.
 * Preserve percent encoding for nested values such as returnTo, search and
 * multi-city data, while retaining the router's browser/SSR/memory reactivity.
 */
export function useRawSearch(): string {
  const router = useRouter();
  const search = router.searchHook(router);
  return search.startsWith("?") ? search.slice(1) : search;
}
