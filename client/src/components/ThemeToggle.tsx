import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ThemeToggleProps {
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  showLabel?: boolean;
  className?: string;
}

export function ThemeToggle({
  variant = "ghost",
  size = "icon",
  showLabel = false,
  className = "",
}: ThemeToggleProps) {
  const { t } = useTranslation();
  const { theme, toggleTheme, switchable } = useTheme();

  if (!switchable || !toggleTheme) {
    return null;
  }

  const isDark = theme === "dark";
  const label = isDark ? t("theme.lightMode") : t("theme.darkMode");

  if (showLabel) {
    return (
      <Button
        variant={variant}
        size={size}
        onClick={toggleTheme}
        className={className}
      >
        {isDark ? (
          <Sun className="h-4 w-4 mr-2" />
        ) : (
          <Moon className="h-4 w-4 mr-2" />
        )}
        {label}
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant}
          size={size}
          onClick={toggleTheme}
          className={className}
          aria-label={label}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}
