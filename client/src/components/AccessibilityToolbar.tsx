import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAccessibility } from "../contexts/AccessibilityContext";

/* ==========================================================================
   Types
   ========================================================================== */

type FontSize = "normal" | "large" | "larger";

interface ToolbarLabels {
  title: string;
  highContrast: string;
  increaseFontSize: string;
  decreaseFontSize: string;
  reducedMotion: string;
  enhancedFocus: string;
  on: string;
  off: string;
  fontNormal: string;
  fontLarge: string;
  fontLarger: string;
  openToolbar: string;
  closeToolbar: string;
}

/* ==========================================================================
   Constants
   ========================================================================== */

const ENHANCED_FOCUS_KEY = "a11y-enhanced-focus";
const TOOLBAR_OPEN_KEY = "a11y-toolbar-open";

const FONT_SIZE_LEVELS: FontSize[] = ["normal", "large", "larger"];

const LABELS_EN: ToolbarLabels = {
  title: "Accessibility",
  highContrast: "High Contrast",
  increaseFontSize: "Increase Font Size",
  decreaseFontSize: "Decrease Font Size",
  reducedMotion: "Reduced Motion",
  enhancedFocus: "Focus Indicators",
  on: "On",
  off: "Off",
  fontNormal: "Normal",
  fontLarge: "Large",
  fontLarger: "Larger",
  openToolbar: "Open accessibility toolbar",
  closeToolbar: "Close accessibility toolbar",
};

const LABELS_AR: ToolbarLabels = {
  title:
    "\u0625\u0645\u0643\u0627\u0646\u064A\u0629 \u0627\u0644\u0648\u0635\u0648\u0644",
  highContrast: "\u062A\u0628\u0627\u064A\u0646 \u0639\u0627\u0644\u064D",
  increaseFontSize: "\u062A\u0643\u0628\u064A\u0631 \u0627\u0644\u062E\u0637",
  decreaseFontSize: "\u062A\u0635\u063A\u064A\u0631 \u0627\u0644\u062E\u0637",
  reducedMotion:
    "\u062A\u0642\u0644\u064A\u0644 \u0627\u0644\u062D\u0631\u0643\u0629",
  enhancedFocus:
    "\u0645\u0624\u0634\u0631\u0627\u062A \u0627\u0644\u062A\u0631\u0643\u064A\u0632",
  on: "\u0645\u064F\u0641\u0639\u0651\u0644",
  off: "\u0645\u064F\u0639\u0637\u0651\u0644",
  fontNormal: "\u0639\u0627\u062F\u064A",
  fontLarge: "\u0643\u0628\u064A\u0631",
  fontLarger: "\u0623\u0643\u0628\u0631",
  openToolbar:
    "\u0641\u062A\u062D \u0634\u0631\u064A\u0637 \u0625\u0645\u0643\u0627\u0646\u064A\u0629 \u0627\u0644\u0648\u0635\u0648\u0644",
  closeToolbar:
    "\u0625\u063A\u0644\u0627\u0642 \u0634\u0631\u064A\u0637 \u0625\u0645\u0643\u0627\u0646\u064A\u0629 \u0627\u0644\u0648\u0635\u0648\u0644",
};

const FONT_SIZE_LABELS_EN: Record<FontSize, string> = {
  normal: "Normal",
  large: "Large",
  larger: "Larger",
};

const FONT_SIZE_LABELS_AR: Record<FontSize, string> = {
  normal: "\u0639\u0627\u062F\u064A",
  large: "\u0643\u0628\u064A\u0631",
  larger: "\u0623\u0643\u0628\u0631",
};

/* ==========================================================================
   SVG Icons (inline to avoid external dependencies)
   ========================================================================== */

function ContrastIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" />
    </svg>
  );
}

function FontIncreaseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 19h8" />
      <path d="M8 19V5" />
      <path d="M4 5h8" />
      <path d="M18 8v8" />
      <path d="M14 12h8" />
    </svg>
  );
}

function FontDecreaseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 19h8" />
      <path d="M8 19V5" />
      <path d="M4 5h8" />
      <path d="M14 12h8" />
    </svg>
  );
}

function MotionIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="M4.93 4.93l2.83 2.83" />
      <path d="M16.24 16.24l2.83 2.83" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
      <path d="M4.93 19.07l2.83-2.83" />
      <path d="M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function FocusIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3" />
      <path d="M12 19v3" />
      <path d="M2 12h3" />
      <path d="M19 12h3" />
    </svg>
  );
}

/* ==========================================================================
   Component
   ========================================================================== */

/**
 * A floating accessibility toolbar that provides quick access to common
 * accessibility settings. Positioned in the bottom-right corner (or
 * bottom-left in RTL layouts).
 *
 * Features:
 * - Toggle high contrast mode
 * - Increase / decrease font size (3 levels: normal, large, larger)
 * - Toggle reduced motion
 * - Toggle enhanced focus indicators
 * - Collapsible with a universal access icon button
 * - Preferences are persisted in localStorage via the AccessibilityContext
 * - Full keyboard support (Escape to close, Tab navigation within panel)
 *
 * @example
 * ```tsx
 * <AccessibilityToolbar />
 * ```
 */
export function AccessibilityToolbar() {
  const { i18n } = useTranslation();
  const {
    highContrast,
    setHighContrast,
    reducedMotion,
    setReducedMotion,
    fontSize,
    setFontSize,
  } = useAccessibility();

  const isArabic = i18n.language === "ar";
  const labels = isArabic ? LABELS_AR : LABELS_EN;
  const fontLabels = isArabic ? FONT_SIZE_LABELS_AR : FONT_SIZE_LABELS_EN;

  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(TOOLBAR_OPEN_KEY) === "true";
  });

  const [enhancedFocus, setEnhancedFocusState] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(ENHANCED_FOCUS_KEY) === "true";
  });

  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  /* ---- Persist toolbar open state ---- */
  useEffect(() => {
    localStorage.setItem(TOOLBAR_OPEN_KEY, String(isOpen));
  }, [isOpen]);

  /* ---- Sync enhanced focus with DOM ---- */
  useEffect(() => {
    const root = document.documentElement;
    if (enhancedFocus) {
      root.classList.add("a11y-enhanced-focus");
    } else {
      root.classList.remove("a11y-enhanced-focus");
    }
    localStorage.setItem(ENHANCED_FOCUS_KEY, String(enhancedFocus));
  }, [enhancedFocus]);

  /* ---- Close on Escape ---- */
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        toggleRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  /* ---- Close on click outside ---- */
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        toggleRef.current &&
        !toggleRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  /* ---- Handlers ---- */
  const handleToggle = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  const handleHighContrast = useCallback(() => {
    setHighContrast(!highContrast);
  }, [highContrast, setHighContrast]);

  const handleIncreaseFontSize = useCallback(() => {
    const currentIndex = FONT_SIZE_LEVELS.indexOf(fontSize);
    if (currentIndex < FONT_SIZE_LEVELS.length - 1) {
      setFontSize(FONT_SIZE_LEVELS[currentIndex + 1]);
    }
  }, [fontSize, setFontSize]);

  const handleDecreaseFontSize = useCallback(() => {
    const currentIndex = FONT_SIZE_LEVELS.indexOf(fontSize);
    if (currentIndex > 0) {
      setFontSize(FONT_SIZE_LEVELS[currentIndex - 1]);
    }
  }, [fontSize, setFontSize]);

  const handleReducedMotion = useCallback(() => {
    setReducedMotion(!reducedMotion);
  }, [reducedMotion, setReducedMotion]);

  const handleEnhancedFocus = useCallback(() => {
    setEnhancedFocusState(prev => !prev);
  }, []);

  const canIncrease =
    FONT_SIZE_LEVELS.indexOf(fontSize) < FONT_SIZE_LEVELS.length - 1;
  const canDecrease = FONT_SIZE_LEVELS.indexOf(fontSize) > 0;

  return (
    <div className="a11y-toolbar" role="region" aria-label={labels.title}>
      {/* Collapsible panel */}
      {isOpen && (
        <div
          ref={panelRef}
          className="a11y-toolbar__panel"
          role="group"
          aria-label={labels.title}
        >
          <div className="a11y-toolbar__heading">{labels.title}</div>

          {/* High Contrast */}
          <button
            type="button"
            className={`a11y-toolbar__item ${highContrast ? "a11y-toolbar__item--active" : ""}`}
            onClick={handleHighContrast}
            aria-pressed={highContrast}
            title={labels.highContrast}
          >
            <span className="a11y-toolbar__item-icon">
              <ContrastIcon />
            </span>
            <span className="a11y-toolbar__item-label">
              {labels.highContrast}
            </span>
            <span className="a11y-toolbar__item-status">
              {highContrast ? labels.on : labels.off}
            </span>
          </button>

          {/* Increase Font Size */}
          <button
            type="button"
            className="a11y-toolbar__item"
            onClick={handleIncreaseFontSize}
            disabled={!canIncrease}
            aria-label={`${labels.increaseFontSize} (${fontLabels[fontSize]})`}
            title={labels.increaseFontSize}
          >
            <span className="a11y-toolbar__item-icon">
              <FontIncreaseIcon />
            </span>
            <span className="a11y-toolbar__item-label">
              {labels.increaseFontSize}
            </span>
            <span className="a11y-toolbar__item-status">
              {fontLabels[fontSize]}
            </span>
          </button>

          {/* Decrease Font Size */}
          <button
            type="button"
            className="a11y-toolbar__item"
            onClick={handleDecreaseFontSize}
            disabled={!canDecrease}
            aria-label={`${labels.decreaseFontSize} (${fontLabels[fontSize]})`}
            title={labels.decreaseFontSize}
          >
            <span className="a11y-toolbar__item-icon">
              <FontDecreaseIcon />
            </span>
            <span className="a11y-toolbar__item-label">
              {labels.decreaseFontSize}
            </span>
            <span className="a11y-toolbar__item-status">
              {fontLabels[fontSize]}
            </span>
          </button>

          {/* Reduced Motion */}
          <button
            type="button"
            className={`a11y-toolbar__item ${reducedMotion ? "a11y-toolbar__item--active" : ""}`}
            onClick={handleReducedMotion}
            aria-pressed={reducedMotion}
            title={labels.reducedMotion}
          >
            <span className="a11y-toolbar__item-icon">
              <MotionIcon />
            </span>
            <span className="a11y-toolbar__item-label">
              {labels.reducedMotion}
            </span>
            <span className="a11y-toolbar__item-status">
              {reducedMotion ? labels.on : labels.off}
            </span>
          </button>

          {/* Enhanced Focus Indicators */}
          <button
            type="button"
            className={`a11y-toolbar__item ${enhancedFocus ? "a11y-toolbar__item--active" : ""}`}
            onClick={handleEnhancedFocus}
            aria-pressed={enhancedFocus}
            title={labels.enhancedFocus}
          >
            <span className="a11y-toolbar__item-icon">
              <FocusIcon />
            </span>
            <span className="a11y-toolbar__item-label">
              {labels.enhancedFocus}
            </span>
            <span className="a11y-toolbar__item-status">
              {enhancedFocus ? labels.on : labels.off}
            </span>
          </button>
        </div>
      )}

      {/* Toggle button */}
      <button
        ref={toggleRef}
        type="button"
        className="a11y-toolbar__toggle"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-label={isOpen ? labels.closeToolbar : labels.openToolbar}
        title={isOpen ? labels.closeToolbar : labels.openToolbar}
      >
        <span aria-hidden="true">{"\u267F"}</span>
      </button>
    </div>
  );
}
