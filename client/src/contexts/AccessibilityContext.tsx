import React, { createContext, useContext, useEffect, useState } from "react";

type FontSize = "normal" | "large" | "larger";

interface AccessibilityContextType {
  reducedMotion: boolean;
  setReducedMotion: (value: boolean) => void;
  highContrast: boolean;
  setHighContrast: (value: boolean) => void;
  fontSize: FontSize;
  setFontSize: (value: FontSize) => void;
  prefersReducedMotion: boolean;
}

const AccessibilityContext = createContext<
  AccessibilityContextType | undefined
>(undefined);

interface AccessibilityProviderProps {
  children: React.ReactNode;
}

const STORAGE_KEY = "accessibility-preferences";

interface StoredPreferences {
  reducedMotion?: boolean;
  highContrast?: boolean;
  fontSize?: FontSize;
}

export function AccessibilityProvider({
  children,
}: AccessibilityProviderProps) {
  // Detect system preference for reduced motion
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window !== "undefined") {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
    return false;
  });

  // Load stored preferences
  const [reducedMotion, setReducedMotionState] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const prefs: StoredPreferences = JSON.parse(stored);
        return (
          prefs.reducedMotion ??
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        );
      }
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
    return false;
  });

  const [highContrast, setHighContrastState] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const prefs: StoredPreferences = JSON.parse(stored);
        return prefs.highContrast ?? false;
      }
    }
    return false;
  });

  const [fontSize, setFontSizeState] = useState<FontSize>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const prefs: StoredPreferences = JSON.parse(stored);
        return prefs.fontSize ?? "normal";
      }
    }
    return "normal";
  });

  // Listen for system preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
      // Only update if user hasn't explicitly set a preference
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        setReducedMotionState(e.matches);
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  // Save preferences to localStorage
  const savePreferences = (
    prefs: Partial<{
      reducedMotion: boolean;
      highContrast: boolean;
      fontSize: FontSize;
    }>
  ) => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const current: StoredPreferences = stored ? JSON.parse(stored) : {};
    const updated = { ...current, ...prefs };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  // Apply reduced motion styles
  useEffect(() => {
    const root = document.documentElement;
    if (reducedMotion) {
      root.classList.add("reduce-motion");
    } else {
      root.classList.remove("reduce-motion");
    }
  }, [reducedMotion]);

  // Apply high contrast styles
  useEffect(() => {
    const root = document.documentElement;
    if (highContrast) {
      root.classList.add("high-contrast");
    } else {
      root.classList.remove("high-contrast");
    }
  }, [highContrast]);

  // Apply font size styles
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("font-large", "font-larger");
    if (fontSize === "large") {
      root.classList.add("font-large");
    } else if (fontSize === "larger") {
      root.classList.add("font-larger");
    }
  }, [fontSize]);

  const setReducedMotion = (value: boolean) => {
    setReducedMotionState(value);
    savePreferences({ reducedMotion: value });
  };

  const setHighContrast = (value: boolean) => {
    setHighContrastState(value);
    savePreferences({ highContrast: value });
  };

  const setFontSize = (value: FontSize) => {
    setFontSizeState(value);
    savePreferences({ fontSize: value });
  };

  return (
    <AccessibilityContext.Provider
      value={{
        reducedMotion,
        setReducedMotion,
        highContrast,
        setHighContrast,
        fontSize,
        setFontSize,
        prefersReducedMotion,
      }}
    >
      {children}
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility() {
  const context = useContext(AccessibilityContext);
  if (!context) {
    throw new Error(
      "useAccessibility must be used within AccessibilityProvider"
    );
  }
  return context;
}
