import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** The user's theme preference: explicit light/dark, or follow the OS. */
export type ThemeMode = "light" | "dark" | "system";

/** The resolved (applied) theme after evaluating system preference. */
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "ais-theme";
const VALID_MODES: readonly ThemeMode[] = ["light", "dark", "system"] as const;

interface ThemeContextType {
  /** The user's raw preference (light | dark | system). */
  mode: ThemeMode;
  /** The resolved theme actually applied to the document (light | dark). */
  theme: ResolvedTheme;
  /** Set the theme mode explicitly. */
  setMode: (mode: ThemeMode) => void;
  /** Cycle through modes: light -> dark -> system -> light. */
  toggleTheme: () => void;
  /** Whether theme switching is enabled. Always true when using this provider. */
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Reads the system color-scheme preference.
 */
function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Reads the persisted theme mode from localStorage.
 * Returns the stored value if valid, otherwise the provided default.
 */
function getStoredMode(defaultMode: ThemeMode): ThemeMode {
  if (typeof window === "undefined") return defaultMode;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (VALID_MODES as readonly string[]).includes(stored)) {
      return stored as ThemeMode;
    }
  } catch {
    // localStorage may be unavailable (e.g. private browsing quota exceeded)
  }
  return defaultMode;
}

/**
 * Applies the resolved theme class to the document root element.
 */
function applyThemeToDOM(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  // Set a meta theme-color for mobile browsers
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved === "dark" ? "#0f172a" : "#ffffff");
  }
}

interface ThemeProviderProps {
  children: ReactNode;
  /** The default theme mode if nothing is persisted. Defaults to "system". */
  defaultTheme?: ThemeMode;
  /** Whether theme switching is enabled. Defaults to true. */
  switchable?: boolean;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  switchable = true,
}: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(() =>
    switchable ? getStoredMode(defaultTheme) : defaultTheme
  );

  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  // Listen for OS color-scheme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  // Resolve the effective theme
  const theme: ResolvedTheme = useMemo(() => {
    if (mode === "system") return systemTheme;
    return mode;
  }, [mode, systemTheme]);

  // Apply theme class to DOM whenever the resolved theme changes
  useEffect(() => {
    applyThemeToDOM(theme);
  }, [theme]);

  // Persist preference to localStorage
  const setMode = useCallback(
    (newMode: ThemeMode) => {
      setModeState(newMode);
      if (switchable) {
        try {
          localStorage.setItem(STORAGE_KEY, newMode);
        } catch {
          // Silently fail if localStorage is unavailable
        }
      }
    },
    [switchable]
  );

  // Cycle: light -> dark -> system -> light
  const toggleTheme = useCallback(() => {
    setMode(mode === "light" ? "dark" : mode === "dark" ? "system" : "light");
  }, [mode, setMode]);

  const value = useMemo<ThemeContextType>(
    () => ({
      mode,
      theme,
      setMode,
      toggleTheme,
      switchable,
    }),
    [mode, theme, setMode, toggleTheme, switchable]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/**
 * Hook to access theme state and controls.
 * Must be used within a <ThemeProvider>.
 */
export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a <ThemeProvider>");
  }
  return context;
}
