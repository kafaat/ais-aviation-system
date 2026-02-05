import { Download, X, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const INSTALL_DISMISSED_KEY = "pwa-install-dismissed";
const INSTALL_DISMISSED_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

export function InstallPrompt() {
  const { t } = useTranslation();
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [swRegistration, setSwRegistration] =
    useState<ServiceWorkerRegistration | null>(null);

  // Check if install was previously dismissed
  const isInstallDismissed = useCallback(() => {
    try {
      const dismissedAt = localStorage.getItem(INSTALL_DISMISSED_KEY);
      if (dismissedAt) {
        const dismissedTime = parseInt(dismissedAt, 10);
        if (Date.now() - dismissedTime < INSTALL_DISMISSED_DURATION) {
          return true;
        }
        // Clear expired dismissal
        localStorage.removeItem(INSTALL_DISMISSED_KEY);
      }
    } catch {
      // localStorage might not be available
    }
    return false;
  }, []);

  // Handle beforeinstallprompt event
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      setDeferredPrompt(promptEvent);

      // Only show if not dismissed recently
      if (!isInstallDismissed()) {
        setShowInstallPrompt(true);
      }
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
    };
  }, [isInstallDismissed]);

  // Handle service worker update event
  useEffect(() => {
    const handleSwUpdate = (e: CustomEvent<ServiceWorkerRegistration>) => {
      setSwRegistration(e.detail);
      setShowUpdatePrompt(true);
    };

    window.addEventListener("swUpdate", handleSwUpdate as EventListener);

    return () => {
      window.removeEventListener("swUpdate", handleSwUpdate as EventListener);
    };
  }, []);

  // Handle install button click
  const handleInstall = async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === "accepted") {
        console.info("[PWA] App installed");
      }

      setDeferredPrompt(null);
      setShowInstallPrompt(false);
    } catch (error) {
      console.error("[PWA] Installation failed:", error);
    }
  };

  // Handle dismiss button click
  const handleDismiss = () => {
    try {
      localStorage.setItem(INSTALL_DISMISSED_KEY, Date.now().toString());
    } catch {
      // localStorage might not be available
    }
    setShowInstallPrompt(false);
  };

  // Handle update button click
  const handleUpdate = () => {
    if (swRegistration?.waiting) {
      swRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
      window.location.reload();
    }
    setShowUpdatePrompt(false);
  };

  // Handle update dismiss
  const handleUpdateDismiss = () => {
    setShowUpdatePrompt(false);
  };

  // Don't render if nothing to show
  if (!showInstallPrompt && !showUpdatePrompt) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-4 md:max-w-sm">
      {/* Install Prompt */}
      {showInstallPrompt && deferredPrompt && (
        <Card className="shadow-lg border-primary/20">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <Download className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">{t("pwa.install")}</CardTitle>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 -mt-1 -mr-1"
                onClick={handleDismiss}
                aria-label={t("common.cancel")}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <CardDescription className="text-sm">
              {t("pwa.installPrompt")}
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={handleDismiss}
              >
                {t("common.cancel")}
              </Button>
              <Button size="sm" className="flex-1" onClick={handleInstall}>
                <Download className="h-4 w-4 mr-1" />
                {t("pwa.install")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Update Prompt */}
      {showUpdatePrompt && (
        <Card className="shadow-lg border-primary/20 mt-2">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">
                  {t("pwa.updateAvailable")}
                </CardTitle>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 -mt-1 -mr-1"
                onClick={handleUpdateDismiss}
                aria-label={t("common.cancel")}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pb-3">
            <Button size="sm" className="w-full" onClick={handleUpdate}>
              <RefreshCw className="h-4 w-4 mr-1" />
              {t("pwa.updateNow")}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
