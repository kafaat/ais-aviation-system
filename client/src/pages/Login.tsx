import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_LOGO, getLoginUrl } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  Loader2,
  LogIn,
  AlertTriangle,
  Eye,
  EyeOff,
  UserPlus,
} from "lucide-react";

export default function Login() {
  const { t } = useTranslation();
  const { user, loading, refresh } = useAuth();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const loginUrl = getLoginUrl();
  const isOAuthConfigured =
    loginUrl !== "#login-not-configured" && loginUrl.startsWith("http");

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async () => {
      setLoginError(null);
      await refresh();
      navigate("/", { replace: true });
    },
    onError: error => {
      setLoginError(error.message || t("login.invalidCredentials"));
    },
  });

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: async () => {
      setLoginError(null);
      // After registration, auto-login
      loginMutation.mutate({ email, password });
    },
    onError: error => {
      setLoginError(error.message || t("login.registrationFailed"));
    },
  });

  useEffect(() => {
    if (!loading && user) {
      navigate("/", { replace: true });
    }
  }, [user, loading, navigate]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (mode === "register") {
      registerMutation.mutate({ email, password, name: name || undefined });
    } else {
      loginMutation.mutate({ email, password });
    }
  };

  const isPending = loginMutation.isPending || registerMutation.isPending;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (user) {
    return null;
  }

  return (
    <main className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
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

        <form onSubmit={handleLoginSubmit} className="w-full space-y-4">
          {loginError && (
            <div
              role="alert"
              className="flex items-center gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
              data-testid="error-message"
            >
              <AlertTriangle
                className="h-5 w-5 text-red-500 shrink-0"
                aria-hidden="true"
              />
              <p className="text-sm text-red-700 dark:text-red-400">
                {loginError}
              </p>
            </div>
          )}

          {mode === "register" && (
            <div className="space-y-2">
              <Label htmlFor="name">{t("login.name")}</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t("login.namePlaceholder")}
                aria-label={t("login.name")}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">{t("login.email")}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t("login.emailPlaceholder") || "email@example.com"}
              required
              aria-label={t("login.email")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">{t("login.password")}</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t("login.passwordPlaceholder") || "********"}
                required
                minLength={mode === "register" ? 8 : 1}
                aria-label={t("login.password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 end-0 flex items-center pe-3 text-muted-foreground hover:text-foreground"
                data-testid="toggle-password-visibility"
                aria-label={
                  showPassword
                    ? t("login.hidePassword")
                    : t("login.showPassword")
                }
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90"
            disabled={isPending}
          >
            {isPending ? (
              <Loader2
                className="mr-2 h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            ) : mode === "register" ? (
              <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
            ) : (
              <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {mode === "register" ? t("login.register") : t("common.login")}
          </Button>

          <div className="text-center">
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setLoginError(null);
              }}
              className="text-sm text-primary hover:underline"
            >
              {mode === "login"
                ? t("login.noAccountRegister")
                : t("login.hasAccountLogin")}
            </button>
          </div>
        </form>

        {isOAuthConfigured && (
          <div className="w-full space-y-3">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  {t("login.orContinueWith")}
                </span>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                window.location.href = loginUrl;
              }}
              size="lg"
              className="w-full"
            >
              <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("login.oauthLogin")}
            </Button>
          </div>
        )}
      </Card>
    </main>
  );
}
