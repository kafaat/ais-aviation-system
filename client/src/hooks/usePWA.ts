import { useCallback, useEffect, useRef, useState } from "react";

/**
 * BeforeInstallPromptEvent - fired by the browser when the PWA meets
 * installability criteria and the user hasn't installed it yet.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface UsePWAReturn {
  /** Whether the app can be installed (install prompt is available) */
  isInstallable: boolean;
  /** Whether the app is running as an installed PWA (standalone mode) */
  isInstalled: boolean;
  /** Whether the device is currently offline */
  isOffline: boolean;
  /** Whether a service worker update is available */
  hasUpdate: boolean;
  /** Trigger the browser's native install prompt */
  install: () => Promise<boolean>;
  /** Apply the pending service worker update and reload */
  update: () => void;
}

const SW_PATH = "/sw.js";
const SW_UPDATE_INTERVAL = 60 * 60 * 1000; // Check for updates every hour

/**
 * usePWA - React hook for Progressive Web App functionality.
 *
 * Handles:
 * - Service worker registration and lifecycle management
 * - Install prompt interception (beforeinstallprompt)
 * - Standalone display mode detection (is the app "installed"?)
 * - Online/offline connectivity tracking
 * - Service worker update detection and application
 *
 * @example
 * ```tsx
 * function App() {
 *   const { isInstallable, isInstalled, isOffline, install, update, hasUpdate } = usePWA();
 *
 *   return (
 *     <div>
 *       {isOffline && <OfflineBanner />}
 *       {isInstallable && <button onClick={install}>Install App</button>}
 *       {hasUpdate && <button onClick={update}>Update Available</button>}
 *     </div>
 *   );
 * }
 * ```
 */
export function usePWA(): UsePWAReturn {
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [hasUpdate, setHasUpdate] = useState(false);

  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  // ─── Detect Standalone (Installed) Mode ─────────────────────────────────────
  useEffect(() => {
    // Check if the app is running in standalone mode (installed PWA)
    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    setIsInstalled(
      mediaQuery.matches ||
        ("standalone" in navigator &&
          (navigator as { standalone?: boolean }).standalone === true)
    );

    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      setIsInstalled(e.matches);
    };

    mediaQuery.addEventListener("change", handleDisplayModeChange);
    return () => {
      mediaQuery.removeEventListener("change", handleDisplayModeChange);
    };
  }, []);

  // ─── Online/Offline Tracking ────────────────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // ─── Install Prompt Handling ────────────────────────────────────────────────
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the browser's default mini-infobar
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setIsInstallable(true);
    };

    // If the app gets installed, clear the prompt
    const handleAppInstalled = () => {
      deferredPromptRef.current = null;
      setIsInstallable(false);
      setIsInstalled(true);
      console.info("[PWA] App was installed");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  // ─── Service Worker Registration ────────────────────────────────────────────
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      console.info("[PWA] Service workers are not supported in this browser");
      return;
    }

    let updateInterval: ReturnType<typeof setInterval> | null = null;

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register(SW_PATH, {
          scope: "/",
        });
        registrationRef.current = registration;

        console.info("[PWA] Service worker registered successfully");

        // Check if there's already a waiting worker (update ready)
        if (registration.waiting) {
          setHasUpdate(true);
          dispatchSwUpdateEvent(registration);
        }

        // Listen for new service worker installing
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            // A new SW is installed and waiting to activate
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              setHasUpdate(true);
              dispatchSwUpdateEvent(registration);
            }
          });
        });

        // Periodically check for SW updates
        updateInterval = setInterval(() => {
          registration.update().catch(() => {
            // Update check failed (likely offline) - ignore
          });
        }, SW_UPDATE_INTERVAL);
      } catch (error) {
        console.error("[PWA] Service worker registration failed:", error);
      }
    };

    // Handle controller change (new SW took over)
    const handleControllerChange = () => {
      // The new service worker has taken control.
      // A reload ensures the page uses the updated resources.
      // Only auto-reload if there was a pending update the user accepted.
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange
    );

    registerSW();

    return () => {
      if (updateInterval) {
        clearInterval(updateInterval);
      }
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange
      );
    };
  }, []);

  // ─── Install Handler ────────────────────────────────────────────────────────
  const install = useCallback(async (): Promise<boolean> => {
    const prompt = deferredPromptRef.current;
    if (!prompt) {
      console.warn("[PWA] No install prompt available");
      return false;
    }

    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;

      // Clear the saved prompt regardless of outcome (it can only be used once)
      deferredPromptRef.current = null;
      setIsInstallable(false);

      if (outcome === "accepted") {
        console.info("[PWA] User accepted the install prompt");
        return true;
      }

      console.info("[PWA] User dismissed the install prompt");
      return false;
    } catch (error) {
      console.error("[PWA] Install prompt failed:", error);
      return false;
    }
  }, []);

  // ─── Update Handler ─────────────────────────────────────────────────────────
  const update = useCallback((): void => {
    const registration = registrationRef.current;
    if (!registration?.waiting) {
      console.warn("[PWA] No waiting service worker to activate");
      return;
    }

    // Tell the waiting SW to skip waiting and activate
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
    setHasUpdate(false);

    // Reload the page to use the new SW's assets
    window.location.reload();
  }, []);

  return {
    isInstallable,
    isInstalled,
    isOffline,
    hasUpdate,
    install,
    update,
  };
}

/**
 * Dispatch a custom 'swUpdate' event on the window.
 * This is consumed by the InstallPrompt component to show the update UI.
 */
function dispatchSwUpdateEvent(registration: ServiceWorkerRegistration): void {
  const event = new CustomEvent("swUpdate", { detail: registration });
  window.dispatchEvent(event);
}
