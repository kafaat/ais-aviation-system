import { Moon, Sun, Monitor, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme, type ThemeMode } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface DarkModeToggleProps {
  /** Button style variant. */
  variant?: "default" | "outline" | "ghost";
  /** Button size. */
  size?: "default" | "sm" | "lg" | "icon";
  /** Additional CSS classes for the trigger button. */
  className?: string;
  /** Alignment of the dropdown relative to the trigger. */
  align?: "start" | "center" | "end";
}

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemeMode;
  labelKey: string;
  icon: typeof Sun;
}> = [
  { value: "light", labelKey: "theme.light", icon: Sun },
  { value: "dark", labelKey: "theme.dark", icon: Moon },
  { value: "system", labelKey: "theme.system", icon: Monitor },
] as const;

/**
 * Returns the icon component for the current resolved theme,
 * with a special indicator when "system" mode is active.
 */
function CurrentThemeIcon({
  mode,
  theme,
}: {
  mode: ThemeMode;
  theme: "light" | "dark";
}) {
  if (mode === "system") {
    return (
      <div className="relative">
        <Monitor className="h-4 w-4" />
        {theme === "dark" ? (
          <Moon className="absolute -bottom-0.5 -right-0.5 h-2 w-2 text-blue-400" />
        ) : (
          <Sun className="absolute -bottom-0.5 -right-0.5 h-2 w-2 text-amber-500" />
        )}
      </div>
    );
  }

  if (theme === "dark") {
    return <Moon className="h-4 w-4" />;
  }

  return <Sun className="h-4 w-4" />;
}

/**
 * Enhanced dark mode toggle with a dropdown menu offering three modes:
 * Light, Dark, and System (follows OS preference).
 *
 * Compact design suitable for placement in the navbar.
 */
export function DarkModeToggle({
  variant = "ghost",
  size = "icon",
  className,
  align = "end",
}: DarkModeToggleProps) {
  const { t } = useTranslation();
  const { mode, theme, setMode, switchable } = useTheme();

  // Don't render if theme switching is disabled
  if (!switchable) {
    return null;
  }

  const currentLabel =
    mode === "light"
      ? t("theme.light", "Light")
      : mode === "dark"
        ? t("theme.dark", "Dark")
        : t("theme.system", "System");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={cn(
            "relative h-9 w-9 rounded-md focus-visible:ring-2 focus-visible:ring-ring",
            className
          )}
          aria-label={t("theme.toggleTheme", "Toggle theme")}
        >
          {/* Animated icon swap */}
          <Sun
            className={cn(
              "h-4 w-4 transition-transform duration-300",
              theme === "dark" ? "scale-0 rotate-90" : "scale-100 rotate-0"
            )}
            style={{ position: theme === "dark" ? "absolute" : "relative" }}
          />
          <Moon
            className={cn(
              "h-4 w-4 transition-transform duration-300",
              theme === "dark" ? "scale-100 rotate-0" : "scale-0 -rotate-90"
            )}
            style={{ position: theme === "light" ? "absolute" : "relative" }}
          />
          <span className="sr-only">{currentLabel}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align={align} className="min-w-[160px]">
        {THEME_OPTIONS.map(({ value, labelKey, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setMode(value)}
            className={cn(
              "flex items-center gap-2 cursor-pointer",
              mode === value && "font-medium"
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1">{t(labelKey, value)}</span>
            {mode === value && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
