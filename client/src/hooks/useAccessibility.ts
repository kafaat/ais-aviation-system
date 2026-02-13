import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAccessibility as useAccessibilityContext } from "../contexts/AccessibilityContext";

/* ==========================================================================
   Types
   ========================================================================== */

type FontSize = "normal" | "large" | "larger";

interface UseAccessibilityReturn {
  /* ---- State ---- */
  /** Current font size preference */
  fontSize: FontSize;
  /** Whether high contrast mode is active */
  highContrast: boolean;
  /** Whether reduced motion is active */
  reducedMotion: boolean;
  /** Whether the user's OS prefers reduced motion */
  prefersReducedMotion: boolean;
  /** Whether enhanced focus indicators are active */
  enhancedFocus: boolean;

  /* ---- Actions ---- */
  /** Set the font size level */
  setFontSize: (size: FontSize) => void;
  /** Increase font size by one level. No-op if already at max. */
  increaseFontSize: () => void;
  /** Decrease font size by one level. No-op if already at min. */
  decreaseFontSize: () => void;
  /** Toggle high contrast mode */
  toggleHighContrast: () => void;
  /** Toggle reduced motion */
  toggleReducedMotion: () => void;
  /** Toggle enhanced focus indicators */
  toggleEnhancedFocus: () => void;

  /* ---- Utilities ---- */
  /**
   * Trap Tab focus within a container element.
   * Returns a cleanup function that removes the listener.
   *
   * Useful for modals, dialogs, and drawers.
   */
  trapFocus: (container: HTMLElement) => () => void;
}

/* ==========================================================================
   Constants
   ========================================================================== */

const FONT_SIZE_LEVELS: FontSize[] = ["normal", "large", "larger"];
const ENHANCED_FOCUS_KEY = "a11y-enhanced-focus";

/* CSS classes applied to document root */
const A11Y_FONT_CLASSES: Record<FontSize, string> = {
  normal: "a11y-font-normal",
  large: "a11y-font-large",
  larger: "a11y-font-larger",
};

/* ==========================================================================
   Route name helpers
   ========================================================================== */

/**
 * Human-readable route label map for screen reader announcements.
 * Keys are path prefixes; values are labels.
 */
const ROUTE_LABELS: Record<string, string> = {
  "/": "Home",
  "/login": "Login",
  "/search": "Search Results",
  "/booking": "Booking",
  "/my-bookings": "My Bookings",
  "/check-in": "Check In",
  "/profile": "Profile",
  "/loyalty": "Loyalty Dashboard",
  "/favorites": "Favorites",
  "/price-alerts": "Price Alerts",
  "/compare": "Compare Flights",
  "/group-booking": "Group Booking",
  "/saved-passengers": "Saved Passengers",
  "/notifications": "Notifications",
  "/my-waitlist": "My Waitlist",
  "/multi-city": "Multi-City Results",
  "/track-flight": "Live Flight Tracking",
  "/rebook": "Rebooking",
  "/payment-history": "Payment History",
  "/ai-chat": "AI Chat Assistant",
  "/pay": "Pay Your Share",
  "/baggage": "Baggage Status",
  "/corporate": "Corporate Dashboard",
  "/corporate/bookings": "Corporate Bookings",
  "/admin": "Admin Dashboard",
  "/analytics": "Analytics Dashboard",
  "/admin/refunds": "Refunds Management",
  "/admin/reports": "Reports Dashboard",
  "/admin/group-bookings": "Group Bookings Management",
  "/admin/vouchers": "Voucher Management",
  "/admin/gates": "Gate Management",
  "/admin/dcs": "Departure Control System",
  "/admin/deleted-bookings": "Deleted Bookings",
  "/admin/baggage": "Baggage Management",
  "/admin/corporate": "Corporate Management",
  "/admin/ai-pricing": "AI Pricing Dashboard",
  "/admin/travel-agents": "Travel Agent Management",
  "/admin/overbooking": "Overbooking Management",
  "/404": "Page Not Found",
};

function getRouteLabel(path: string): string {
  // Try exact match first
  if (ROUTE_LABELS[path]) {
    return ROUTE_LABELS[path];
  }

  // Try prefix match (for routes with params like /booking/:id)
  const sortedKeys = Object.keys(ROUTE_LABELS).sort(
    (a, b) => b.length - a.length
  );
  for (const key of sortedKeys) {
    if (key !== "/" && path.startsWith(key)) {
      return ROUTE_LABELS[key];
    }
  }

  return "Page";
}

/* ==========================================================================
   Hook
   ========================================================================== */

/**
 * Comprehensive accessibility management hook.
 *
 * Wraps the AccessibilityContext with additional capabilities:
 * - Font size increase/decrease helpers
 * - Enhanced focus indicator toggle (persisted to localStorage)
 * - CSS class management on <html> element
 * - Route change announcements to screen readers
 * - Focus trap utility for modal dialogs
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const {
 *     fontSize,
 *     increaseFontSize,
 *     highContrast,
 *     toggleHighContrast,
 *     trapFocus,
 *   } = useA11y();
 *
 *   // Trap focus in a dialog ref
 *   useEffect(() => {
 *     if (dialogRef.current && isOpen) {
 *       return trapFocus(dialogRef.current);
 *     }
 *   }, [isOpen, trapFocus]);
 * }
 * ```
 */
export function useA11y(): UseAccessibilityReturn {
  const {
    fontSize,
    setFontSize,
    highContrast,
    setHighContrast,
    reducedMotion,
    setReducedMotion,
    prefersReducedMotion,
  } = useAccessibilityContext();

  const [location] = useLocation();
  const previousLocationRef = useRef(location);

  /* ---- Enhanced focus state (stored in localStorage, applied to DOM) ---- */
  const enhancedFocusRef = useRef<boolean>(
    typeof window !== "undefined"
      ? localStorage.getItem(ENHANCED_FOCUS_KEY) === "true"
      : false
  );

  // Initialize enhanced focus from localStorage on first render
  useEffect(() => {
    const stored = localStorage.getItem(ENHANCED_FOCUS_KEY) === "true";
    enhancedFocusRef.current = stored;
    const root = document.documentElement;
    if (stored) {
      root.classList.add("a11y-enhanced-focus");
    } else {
      root.classList.remove("a11y-enhanced-focus");
    }
  }, []);

  /* ---- Apply accessibility CSS classes to document root ---- */
  useEffect(() => {
    const root = document.documentElement;

    // Font size classes
    Object.values(A11Y_FONT_CLASSES).forEach(cls => root.classList.remove(cls));
    root.classList.add(A11Y_FONT_CLASSES[fontSize]);

    // Reduced motion class
    if (reducedMotion) {
      root.classList.add("a11y-reduce-motion");
    } else {
      root.classList.remove("a11y-reduce-motion");
    }
  }, [fontSize, reducedMotion]);

  /* ---- Route change announcements ---- */
  useEffect(() => {
    if (previousLocationRef.current === location) return;
    previousLocationRef.current = location;

    const label = getRouteLabel(location);
    const message = `Navigated to ${label}`;

    // Use the polite announcer region that is rendered by A11yAnnouncer
    const politeRegion = document.querySelector<HTMLElement>(
      '[data-testid="a11y-announcer-polite"]'
    );

    if (politeRegion) {
      // Clear then set to ensure screen readers detect the change
      politeRegion.textContent = "";
      requestAnimationFrame(() => {
        politeRegion.textContent = message;
      });
    }

    // Also update the document title for screen readers
    const baseTitle = "Aviation Integrated System";
    document.title = `${label} - ${baseTitle}`;
  }, [location]);

  /* ---- Font size helpers ---- */
  const increaseFontSize = useCallback(() => {
    const currentIndex = FONT_SIZE_LEVELS.indexOf(fontSize);
    if (currentIndex < FONT_SIZE_LEVELS.length - 1) {
      setFontSize(FONT_SIZE_LEVELS[currentIndex + 1]);
    }
  }, [fontSize, setFontSize]);

  const decreaseFontSize = useCallback(() => {
    const currentIndex = FONT_SIZE_LEVELS.indexOf(fontSize);
    if (currentIndex > 0) {
      setFontSize(FONT_SIZE_LEVELS[currentIndex - 1]);
    }
  }, [fontSize, setFontSize]);

  /* ---- Toggle helpers ---- */
  const toggleHighContrast = useCallback(() => {
    setHighContrast(!highContrast);
  }, [highContrast, setHighContrast]);

  const toggleReducedMotion = useCallback(() => {
    setReducedMotion(!reducedMotion);
  }, [reducedMotion, setReducedMotion]);

  const toggleEnhancedFocus = useCallback(() => {
    const newValue = !enhancedFocusRef.current;
    enhancedFocusRef.current = newValue;
    localStorage.setItem(ENHANCED_FOCUS_KEY, String(newValue));
    const root = document.documentElement;
    if (newValue) {
      root.classList.add("a11y-enhanced-focus");
    } else {
      root.classList.remove("a11y-enhanced-focus");
    }
    // Force a re-render by toggling a DOM attribute
    root.setAttribute("data-a11y-focus", String(newValue));
  }, []);

  /* ---- Focus trap utility ---- */
  const trapFocus = useCallback((container: HTMLElement): (() => void) => {
    const FOCUSABLE_SELECTOR = [
      'a[href]:not([tabindex="-1"])',
      'button:not(:disabled):not([tabindex="-1"])',
      'input:not(:disabled):not([tabindex="-1"])',
      'select:not(:disabled):not([tabindex="-1"])',
      'textarea:not(:disabled):not([tabindex="-1"])',
      '[tabindex]:not([tabindex="-1"])',
      '[contenteditable="true"]',
    ].join(", ");

    function getFocusableElements(): HTMLElement[] {
      return Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter(el => {
        // Additional check: element must be visible
        const style = window.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden";
      });
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];
      const activeElement = document.activeElement as HTMLElement;

      if (event.shiftKey) {
        // Shift+Tab: if on first element, wrap to last
        if (
          activeElement === firstElement ||
          !container.contains(activeElement)
        ) {
          event.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab: if on last element, wrap to first
        if (
          activeElement === lastElement ||
          !container.contains(activeElement)
        ) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    }

    // Store previously focused element to restore on cleanup
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the first focusable element inside the container
    const focusable = getFocusableElements();
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      // If no focusable elements, make the container itself focusable
      container.setAttribute("tabindex", "-1");
      container.focus();
    }

    container.addEventListener("keydown", handleKeyDown);

    // Return cleanup function
    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      // Restore focus to previously focused element
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, []);

  return {
    fontSize,
    highContrast,
    reducedMotion,
    prefersReducedMotion,
    enhancedFocus: enhancedFocusRef.current as unknown as boolean,
    setFontSize,
    increaseFontSize,
    decreaseFontSize,
    toggleHighContrast,
    toggleReducedMotion,
    toggleEnhancedFocus,
    trapFocus,
  };
}
