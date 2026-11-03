import { useRef } from "react";

/** A network retry must recover the same command; editing it creates a new one. */
export function useCommandIdempotencyKey() {
  const pending = useRef<{ payload: string; key: string } | null>(null);
  return {
    forPayload(payload: unknown) {
      const serialized = JSON.stringify(payload);
      if (pending.current?.payload !== serialized) {
        pending.current = { payload: serialized, key: crypto.randomUUID() };
      }
      return pending.current.key;
    },
    clear() {
      pending.current = null;
    },
  };
}
