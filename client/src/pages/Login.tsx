import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { APP_LOGO, getLoginUrl } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { Loader2, LogIn, AlertTriangle } from "lucide-react";

export default function Login() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const [redirecting, setRedirecting] = useState(false);

  const loginUrl = getLoginUrl();
  const isOAuthConfigured =
    loginUrl !== "#login-not-configured" && loginUrl.startsWith("http");

  // If already authenticated, redirect to home
  useEffect(() => {
    if (!loading && user) {
      navigate("/", { replace: true });
    }
  }, [user, loading, navigate]);

  // If OAuth is configured, auto-redirect
  useEffect(() => {
    if (!loading && !user && isOAuthConfigured) {
      setRedirecting(true);
      window.location.href = loginUrl;
    }
  }, [loading, user, isOAuthConfigured, loginUrl]);

  if (loading || redirecting) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  // Already authenticated - will redirect via useEffect
  if (user) {
    return null;
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      <Card className="flex flex-col items-center gap-8 p-8 max-w-md w-full mx-4 shadow-xl">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-purple-500/20 rounded-full blur-xl" />
            <img
              src={APP_LOGO}
              alt={t("common.appName")}
              className="relative h-20 w-20 rounded-2xl shadow-lg"
            />
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
              {t("common.appName")}
            </h1>
          </div>
        </div>

        {isOAuthConfigured ? (
          <Button
            onClick={() => {
              setRedirecting(true);
              window.location.href = loginUrl;
            }}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90"
          >
            <LogIn className="mr-2 h-4 w-4" />
            {t("common.login")}
          </Button>
        ) : (
          <div className="w-full space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
              <p className="text-sm text-amber-700 dark:text-amber-400">
                {t("login.notConfigured")}
              </p>
            </div>
            <Button
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => navigate("/")}
            >
              {t("login.backToHome")}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
