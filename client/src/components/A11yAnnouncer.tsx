import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

/* ==========================================================================
   Types
   ========================================================================== */

type Politeness = "polite" | "assertive";

interface AnnounceOptions {
  /** How urgently the message should be announced. Defaults to "polite". */
  politeness?: Politeness;
  /**
   * Delay in milliseconds before the message is set.
   * A short delay helps screen readers pick up rapid successive changes.
   * Defaults to 100ms.
   */
  delay?: number;
  /**
   * Whether to clear the message after a timeout so it does not linger.
   * Defaults to 5000ms. Set to 0 to disable auto-clear.
   */
  clearAfter?: number;
}

interface AnnounceFunction {
  (message: string, options?: AnnounceOptions): void;
}

interface A11yAnnouncerContextType {
  /** Announce a message to screen readers via aria-live regions. */
  announce: AnnounceFunction;
}

/* ==========================================================================
   Context
   ========================================================================== */

const A11yAnnouncerContext = createContext<
  A11yAnnouncerContextType | undefined
>(undefined);

/* ==========================================================================
   Hook
   ========================================================================== */

/**
 * Hook to access the screen reader announce function.
 *
 * @example
 * ```tsx
 * const { announce } = useAnnounce();
 * announce("Flight booked successfully!");
 * announce("Payment failed. Please try again.", { politeness: "assertive" });
 * ```
 */
export function useAnnounce(): A11yAnnouncerContextType {
  const context = useContext(A11yAnnouncerContext);
  if (!context) {
    throw new Error("useAnnounce must be used within an A11yAnnouncerProvider");
  }
  return context;
}

/* ==========================================================================
   Provider & Component
   ========================================================================== */

interface A11yAnnouncerProviderProps {
  children: ReactNode;
}

/**
 * Provides invisible aria-live regions and an `announce()` function that can be
 * used anywhere in the tree to push messages to screen readers.
 *
 * Two regions are rendered:
 * - `aria-live="polite"` for non-urgent updates (route changes, status messages)
 * - `aria-live="assertive"` for urgent alerts (errors, critical warnings)
 *
 * @example
 * ```tsx
 * <A11yAnnouncerProvider>
 *   <App />
 * </A11yAnnouncerProvider>
 * ```
 */
export function A11yAnnouncerProvider({
  children,
}: A11yAnnouncerProviderProps) {
  const [politeMessage, setPoliteMessage] = useState("");
  const [assertiveMessage, setAssertiveMessage] = useState("");

  // Refs to hold clear-timeout IDs so we can cancel pending clears
  const politeClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assertiveClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce: AnnounceFunction = useCallback(
    (message: string, options: AnnounceOptions = {}) => {
      const { politeness = "polite", delay = 100, clearAfter = 5000 } = options;

      const isAssertive = politeness === "assertive";
      const setter = isAssertive ? setAssertiveMessage : setPoliteMessage;
      const clearRef = isAssertive ? assertiveClearRef : politeClearRef;

      // Clear any pending clear timeout
      if (clearRef.current !== null) {
        clearTimeout(clearRef.current);
        clearRef.current = null;
      }

      // Briefly clear the region so screen readers detect the change even when
      // the same message is announced consecutively.
      setter("");

      setTimeout(() => {
        setter(message);

        // Auto-clear after the specified duration
        if (clearAfter > 0) {
          clearRef.current = setTimeout(() => {
            setter("");
            clearRef.current = null;
          }, clearAfter);
        }
      }, delay);
    },
    []
  );

  return (
    <A11yAnnouncerContext.Provider value={{ announce }}>
      {children}

      {/*
        Polite region: used for non-urgent updates like route changes,
        status messages, and informational announcements.
      */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="a11y-announcer"
        data-testid="a11y-announcer-polite"
      >
        {politeMessage}
      </div>

      {/*
        Assertive region: used for urgent messages like errors,
        validation failures, and critical alerts.
      */}
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="a11y-announcer"
        data-testid="a11y-announcer-assertive"
      >
        {assertiveMessage}
      </div>
    </A11yAnnouncerContext.Provider>
  );
}
