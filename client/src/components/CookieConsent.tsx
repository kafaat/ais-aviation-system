import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import {
  Cookie,
  ChevronDown,
  ChevronUp,
  Shield,
  BarChart3,
  Megaphone,
  SlidersHorizontal,
  ExternalLink,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Inline translations (AR / EN) -- no i18n import needed
// ---------------------------------------------------------------------------

const translations = {
  en: {
    title: "We value your privacy",
    description:
      "We use cookies to enhance your browsing experience, serve personalized content, and analyze our traffic. Please choose your cookie preferences below.",
    acceptAll: "Accept All",
    rejectAll: "Reject All",
    customize: "Customize",
    savePreferences: "Save Preferences",
    privacyPolicy: "Privacy Policy",
    poweredBy: "Cookie consent powered by AIS Aviation",
    categories: {
      essential: {
        label: "Essential",
        description:
          "Required for the website to function properly. These cookies enable core functionality such as security, session management, and accessibility. They cannot be disabled.",
      },
      analytics: {
        label: "Analytics",
        description:
          "Help us understand how visitors interact with our website by collecting anonymous usage data. This helps us improve performance and user experience.",
      },
      marketing: {
        label: "Marketing",
        description:
          "Used to deliver relevant advertisements and track campaign effectiveness across platforms. These cookies may share data with third-party advertisers.",
      },
      preferences: {
        label: "Preferences",
        description:
          "Allow the website to remember your settings such as language, region, and display preferences to provide a more personalized experience.",
      },
    },
    alwaysOn: "Always on",
    cookieSettings: "Cookie Settings",
  },
  ar: {
    title:
      "\u0646\u062D\u0646 \u0646\u0642\u062F\u0631 \u062E\u0635\u0648\u0635\u064A\u062A\u0643",
    description:
      "\u0646\u0633\u062A\u062E\u062F\u0645 \u0645\u0644\u0641\u0627\u062A \u062A\u0639\u0631\u064A\u0641 \u0627\u0644\u0627\u0631\u062A\u0628\u0627\u0637 \u0644\u062A\u062D\u0633\u064A\u0646 \u062A\u062C\u0631\u0628\u0629 \u0627\u0644\u062A\u0635\u0641\u062D \u0648\u062A\u0642\u062F\u064A\u0645 \u0645\u062D\u062A\u0648\u0649 \u0645\u062E\u0635\u0635 \u0648\u062A\u062D\u0644\u064A\u0644 \u062D\u0631\u0643\u0629 \u0627\u0644\u0645\u0631\u0648\u0631. \u064A\u0631\u062C\u0649 \u0627\u062E\u062A\u064A\u0627\u0631 \u062A\u0641\u0636\u064A\u0644\u0627\u062A\u0643 \u0623\u062F\u0646\u0627\u0647.",
    acceptAll: "\u0642\u0628\u0648\u0644 \u0627\u0644\u0643\u0644",
    rejectAll: "\u0631\u0641\u0636 \u0627\u0644\u0643\u0644",
    customize: "\u062A\u062E\u0635\u064A\u0635",
    savePreferences:
      "\u062D\u0641\u0638 \u0627\u0644\u062A\u0641\u0636\u064A\u0644\u0627\u062A",
    privacyPolicy:
      "\u0633\u064A\u0627\u0633\u0629 \u0627\u0644\u062E\u0635\u0648\u0635\u064A\u0629",
    poweredBy:
      "\u0625\u062F\u0627\u0631\u0629 \u0645\u0648\u0627\u0641\u0642\u0629 \u0645\u0644\u0641\u0627\u062A \u062A\u0639\u0631\u064A\u0641 \u0627\u0644\u0627\u0631\u062A\u0628\u0627\u0637 \u0628\u0648\u0627\u0633\u0637\u0629 AIS Aviation",
    categories: {
      essential: {
        label: "\u0623\u0633\u0627\u0633\u064A\u0629",
        description:
          "\u0645\u0637\u0644\u0648\u0628\u0629 \u0644\u0639\u0645\u0644 \u0627\u0644\u0645\u0648\u0642\u0639 \u0628\u0634\u0643\u0644 \u0635\u062D\u064A\u062D. \u062A\u0645\u0643\u0651\u0646 \u0647\u0630\u0647 \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0627\u0644\u0648\u0638\u0627\u0626\u0641 \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u0629 \u0645\u062B\u0644 \u0627\u0644\u0623\u0645\u0627\u0646 \u0648\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u062C\u0644\u0633\u0627\u062A. \u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u0639\u0637\u064A\u0644\u0647\u0627.",
      },
      analytics: {
        label: "\u062A\u062D\u0644\u064A\u0644\u064A\u0629",
        description:
          "\u062A\u0633\u0627\u0639\u062F\u0646\u0627 \u0641\u064A \u0641\u0647\u0645 \u0643\u064A\u0641\u064A\u0629 \u062A\u0641\u0627\u0639\u0644 \u0627\u0644\u0632\u0648\u0627\u0631 \u0645\u0639 \u0645\u0648\u0642\u0639\u0646\u0627 \u0645\u0646 \u062E\u0644\u0627\u0644 \u062C\u0645\u0639 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0645\u062C\u0647\u0648\u0644\u0629.",
      },
      marketing: {
        label: "\u062A\u0633\u0648\u064A\u0642\u064A\u0629",
        description:
          "\u062A\u064F\u0633\u062A\u062E\u062F\u0645 \u0644\u062A\u0642\u062F\u064A\u0645 \u0625\u0639\u0644\u0627\u0646\u0627\u062A \u0645\u0646\u0627\u0633\u0628\u0629 \u0648\u062A\u062A\u0628\u0639 \u0641\u0639\u0627\u0644\u064A\u0629 \u0627\u0644\u062D\u0645\u0644\u0627\u062A \u0639\u0628\u0631 \u0627\u0644\u0645\u0646\u0635\u0627\u062A.",
      },
      preferences: {
        label: "\u062A\u0641\u0636\u064A\u0644\u0627\u062A",
        description:
          "\u062A\u0633\u0645\u062D \u0644\u0644\u0645\u0648\u0642\u0639 \u0628\u062A\u0630\u0643\u0631 \u0625\u0639\u062F\u0627\u062F\u0627\u062A\u0643 \u0645\u062B\u0644 \u0627\u0644\u0644\u063A\u0629 \u0648\u0627\u0644\u0645\u0646\u0637\u0642\u0629 \u0644\u062A\u0642\u062F\u064A\u0645 \u062A\u062C\u0631\u0628\u0629 \u0645\u062E\u0635\u0635\u0629.",
      },
    },
    alwaysOn:
      "\u0645\u0641\u0639\u0651\u0644 \u062F\u0627\u0626\u0645\u064B\u0627",
    cookieSettings:
      "\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0645\u0644\u0641\u0627\u062A \u062A\u0639\u0631\u064A\u0641 \u0627\u0644\u0627\u0631\u062A\u0628\u0627\u0637",
  },
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CookiePreferences {
  essential: boolean;
  analytics: boolean;
  marketing: boolean;
  preferences: boolean;
}

const CONSENT_STORAGE_KEY = "ais_cookie_consent";
const CONSENT_VERSION = "1.0";

interface StoredConsent {
  version: string;
  preferences: CookiePreferences;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectLanguage(): "en" | "ar" {
  if (typeof document !== "undefined") {
    const htmlLang = document.documentElement.lang;
    if (htmlLang?.startsWith("ar")) return "ar";
  }
  if (typeof navigator !== "undefined") {
    const navLang = navigator.language;
    if (navLang?.startsWith("ar")) return "ar";
  }
  return "en";
}

function getStoredConsent(): StoredConsent | null {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: StoredConsent = JSON.parse(raw);
    if (parsed.version !== CONSENT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function storeConsent(preferences: CookiePreferences): void {
  const data: StoredConsent = {
    version: CONSENT_VERSION,
    preferences,
    timestamp: new Date().toISOString(),
  };
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(data));
    // Also set a simple cookie so the server can detect consent status
    const maxAge = 365 * 24 * 60 * 60; // 1 year
    document.cookie = `ais_cookie_consent=${encodeURIComponent(JSON.stringify(data))};path=/;max-age=${maxAge};SameSite=Lax`;
  } catch {
    // localStorage or cookies may be unavailable in some environments
  }
}

// ---------------------------------------------------------------------------
// Category icon mapping
// ---------------------------------------------------------------------------

const categoryIcons = {
  essential: Shield,
  analytics: BarChart3,
  marketing: Megaphone,
  preferences: SlidersHorizontal,
} as const;

type CategoryKey = keyof typeof categoryIcons;

// ---------------------------------------------------------------------------
// CookieConsent component
// ---------------------------------------------------------------------------

export function CookieConsent() {
  const lang = detectLanguage();
  const t = translations[lang];
  const isRtl = lang === "ar";

  const [visible, setVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [preferences, setPreferences] = useState<CookiePreferences>({
    essential: true,
    analytics: false,
    marketing: false,
    preferences: false,
  });

  // tRPC mutation to persist consent on the server (fire-and-forget)
  const recordConsentMutation = trpc.consent.recordConsent.useMutation();

  // Check for existing consent on mount
  useEffect(() => {
    const stored = getStoredConsent();
    if (stored) {
      setPreferences(stored.preferences);
      setVisible(false);
    } else {
      setVisible(true);
    }
    // Delay mount animation
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const persistConsent = useCallback(
    (prefs: CookiePreferences) => {
      storeConsent(prefs);
      setPreferences(prefs);
      setVisible(false);
      setShowDetails(false);

      // Record on server (best-effort for anonymous users too)
      recordConsentMutation.mutate({
        essential: prefs.essential,
        analytics: prefs.analytics,
        marketing: prefs.marketing,
        preferences: prefs.preferences,
        consentVersion: CONSENT_VERSION,
      });
    },
    [recordConsentMutation]
  );

  const handleAcceptAll = useCallback(() => {
    persistConsent({
      essential: true,
      analytics: true,
      marketing: true,
      preferences: true,
    });
  }, [persistConsent]);

  const handleRejectAll = useCallback(() => {
    persistConsent({
      essential: true,
      analytics: false,
      marketing: false,
      preferences: false,
    });
  }, [persistConsent]);

  const handleSavePreferences = useCallback(() => {
    persistConsent({ ...preferences, essential: true });
  }, [persistConsent, preferences]);

  const toggleCategory = useCallback((key: CategoryKey) => {
    if (key === "essential") return; // Cannot toggle essential
    setPreferences(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  if (!visible) return null;

  const categories: CategoryKey[] = [
    "essential",
    "analytics",
    "marketing",
    "preferences",
  ];

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className={cn(
        "fixed inset-x-0 bottom-0 z-[9999] transition-transform duration-500 ease-out",
        mounted ? "translate-y-0" : "translate-y-full"
      )}
      role="dialog"
      aria-label={t.title}
    >
      {/* Backdrop shadow */}
      <div className="pointer-events-none absolute inset-x-0 -top-16 h-16 bg-gradient-to-t from-black/10 to-transparent" />

      <div className="border-t bg-background/95 backdrop-blur-md shadow-2xl">
        <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 lg:px-8">
          {/* Header row */}
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Cookie className="h-5 w-5" />
            </div>
            <div className="flex-1 space-y-1">
              <h2 className="text-base font-semibold leading-tight">
                {t.title}
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t.description}
              </p>
            </div>
          </div>

          {/* Expandable detail panel */}
          <div
            className={cn(
              "overflow-hidden transition-all duration-300 ease-in-out",
              showDetails
                ? "mt-4 max-h-[500px] opacity-100"
                : "max-h-0 opacity-0"
            )}
          >
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              {categories.map(key => {
                const Icon = categoryIcons[key];
                const cat = t.categories[key];
                const isEssential = key === "essential";
                const isChecked = preferences[key];

                return (
                  <div
                    key={key}
                    className="flex items-start gap-3 rounded-md border bg-background p-3 transition-colors"
                  >
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{cat.label}</span>
                        {isEssential ? (
                          <span className="text-xs font-medium text-muted-foreground">
                            {t.alwaysOn}
                          </span>
                        ) : (
                          <Switch
                            checked={isChecked}
                            onCheckedChange={() => toggleCategory(key)}
                            aria-label={cat.label}
                          />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {cat.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action buttons */}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <a
                href="/privacy-policy"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
              >
                {t.privacyPolicy}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              {showDetails ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDetails(false)}
                    className="gap-1"
                  >
                    <ChevronDown className="h-4 w-4" />
                    {t.customize}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleRejectAll}>
                    {t.rejectAll}
                  </Button>
                  <Button size="sm" onClick={handleSavePreferences}>
                    {t.savePreferences}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDetails(true)}
                    className="gap-1"
                  >
                    <ChevronUp className="h-4 w-4" />
                    {t.customize}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleRejectAll}>
                    {t.rejectAll}
                  </Button>
                  <Button size="sm" onClick={handleAcceptAll}>
                    {t.acceptAll}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CookieSettingsButton -- re-opens the consent banner from footer / settings
// ---------------------------------------------------------------------------

export function CookieSettingsButton({ className }: { className?: string }) {
  const lang = detectLanguage();
  const t = translations[lang];

  const handleClick = () => {
    // Remove stored consent so the banner re-appears
    try {
      localStorage.removeItem(CONSENT_STORAGE_KEY);
      // Remove the cookie as well
      document.cookie = "ais_cookie_consent=;path=/;max-age=0;SameSite=Lax";
    } catch {
      // ignore
    }
    // Force re-render by dispatching a storage event
    window.dispatchEvent(
      new StorageEvent("storage", { key: CONSENT_STORAGE_KEY })
    );
    // Reload to show banner again
    window.location.reload();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline transition-colors",
        className
      )}
    >
      <Cookie className="h-4 w-4" />
      {t.cookieSettings}
    </button>
  );
}
