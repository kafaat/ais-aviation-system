import { useCallback, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

/* ==========================================================================
   Types
   ========================================================================== */

interface SkipLink {
  /** The CSS selector or element ID to focus (without '#' prefix) */
  targetId: string;
  /** Label for English */
  labelEn: string;
  /** Label for Arabic */
  labelAr: string;
}

/* ==========================================================================
   Configuration
   ========================================================================== */

/**
 * Ordered list of skip navigation targets.
 * Add new targets here to extend the skip nav.
 */
const SKIP_LINKS: SkipLink[] = [
  {
    targetId: "main-content",
    labelEn: "Skip to main content",
    labelAr:
      "\u0627\u0646\u062A\u0642\u0644 \u0625\u0644\u0649 \u0627\u0644\u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0631\u0626\u064A\u0633\u064A",
  },
  {
    targetId: "search",
    labelEn: "Skip to search",
    labelAr:
      "\u0627\u0646\u062A\u0642\u0644 \u0625\u0644\u0649 \u0627\u0644\u0628\u062D\u062B",
  },
  {
    targetId: "navigation",
    labelEn: "Skip to navigation",
    labelAr:
      "\u0627\u0646\u062A\u0642\u0644 \u0625\u0644\u0649 \u0627\u0644\u062A\u0646\u0642\u0644",
  },
];

/* ==========================================================================
   Component
   ========================================================================== */

/**
 * Renders a set of skip navigation links that are visually hidden until
 * they receive keyboard focus. These links allow keyboard and screen reader
 * users to bypass repetitive navigation and jump directly to key regions.
 *
 * The links appear in a horizontal bar at the top of the viewport when focused.
 *
 * Target elements should have matching `id` attributes:
 * - `id="main-content"` on the main content area
 * - `id="search"` on the search input or search section
 * - `id="navigation"` on the primary navigation element
 *
 * Supports both English (LTR) and Arabic (RTL) layouts.
 *
 * @example
 * ```tsx
 * // In your layout:
 * <SkipNavigation />
 * <nav id="navigation">...</nav>
 * <main id="main-content">
 *   <input id="search" ... />
 *   ...
 * </main>
 * ```
 */
export function SkipNavigation() {
  const { i18n } = useTranslation();
  const navRef = useRef<HTMLElement>(null);

  const isArabic = i18n.language === "ar";

  /**
   * Attempts to focus the target element identified by the given ID.
   * If the element is not natively focusable, a tabindex is temporarily set.
   */
  const focusTarget = useCallback((targetId: string) => {
    const target = document.getElementById(targetId);
    if (!target) return;

    // Make the element focusable if it is not already
    if (!target.hasAttribute("tabindex")) {
      target.setAttribute("tabindex", "-1");

      // Remove the tabindex once the element loses focus so it does not
      // appear in the natural tab order permanently.
      const handleBlur = () => {
        target.removeAttribute("tabindex");
        target.removeEventListener("blur", handleBlur);
      };
      target.addEventListener("blur", handleBlur);
    }

    target.focus({ preventScroll: false });

    // Scroll the target into view smoothly
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, targetId: string) => {
      event.preventDefault();
      focusTarget(targetId);
    },
    [focusTarget]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLAnchorElement>, targetId: string) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        focusTarget(targetId);
      }
    },
    [focusTarget]
  );

  return (
    <nav
      ref={navRef}
      className="skip-nav"
      aria-label={
        isArabic
          ? "\u0631\u0648\u0627\u0628\u0637 \u0627\u0644\u062A\u062E\u0637\u064A"
          : "Skip links"
      }
    >
      {SKIP_LINKS.map(link => (
        <a
          key={link.targetId}
          href={`#${link.targetId}`}
          className="skip-nav__link"
          onClick={e => handleClick(e, link.targetId)}
          onKeyDown={e => handleKeyDown(e, link.targetId)}
        >
          {isArabic ? link.labelAr : link.labelEn}
        </a>
      ))}
    </nav>
  );
}
