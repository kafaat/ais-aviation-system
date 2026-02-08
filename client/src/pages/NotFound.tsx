import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SEO } from "@/components/SEO";
import { Home, Search, Plane, ArrowLeft, MapPin } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useTranslation } from "react-i18next";

export default function NotFound() {
  const [, setLocation] = useLocation();
  const { t } = useTranslation();

  const handleGoHome = () => {
    setLocation("/");
  };

  const handleGoBack = () => {
    window.history.back();
  };

  // Popular destinations for suggestions
  const suggestions = [
    { name: t("nav.home"), path: "/", icon: Home },
    { name: t("nav.searchFlights"), path: "/", icon: Search },
    { name: t("nav.myBookings"), path: "/my-bookings", icon: Plane },
    { name: t("nav.checkIn"), path: "/check-in", icon: MapPin },
  ];

  return (
    <main className="min-h-screen w-full flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 dark:from-slate-950 dark:via-blue-950/20 dark:to-slate-950">
      <SEO
        title={t("errors.pageNotFound")}
        description={t("errors.pageNotFoundDescription")}
      />

      <div className="w-full max-w-2xl">
        <Card className="shadow-2xl border-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm overflow-hidden">
          {/* Illustration Area */}
          <div className="relative bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 p-8 pb-16">
            {/* Animated clouds/elements */}
            <div className="absolute top-4 left-8 w-16 h-8 bg-white/20 rounded-full blur-sm animate-pulse" />
            <div className="absolute top-8 right-12 w-12 h-6 bg-white/15 rounded-full blur-sm animate-pulse delay-300" />
            <div className="absolute bottom-12 left-16 w-20 h-10 bg-white/10 rounded-full blur-sm animate-pulse delay-700" />

            {/* Main 404 */}
            <div className="relative text-center">
              <div className="flex items-center justify-center gap-4">
                <span className="text-8xl md:text-9xl font-black text-white/90">
                  4
                </span>
                <div className="relative">
                  <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-white/20 flex items-center justify-center animate-bounce">
                    <Plane
                      className="w-12 h-12 md:w-14 md:h-14 text-white transform -rotate-45"
                      aria-hidden="true"
                    />
                  </div>
                </div>
                <span className="text-8xl md:text-9xl font-black text-white/90">
                  4
                </span>
              </div>
            </div>
          </div>

          <CardContent className="pt-8 pb-8 text-center -mt-8">
            {/* Content Card overlapping illustration */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 mb-6 -mt-12 relative z-10 mx-4">
              <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white mb-2">
                {t("errors.pageNotFound")}
              </h1>

              <p className="text-slate-600 dark:text-slate-400 mb-2">
                {t("errors.pageNotFoundDescription")}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-500">
                {t("errors.pageNotFoundHint")}
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8 px-4">
              <Button
                onClick={handleGoBack}
                variant="outline"
                className="px-6 py-2.5 rounded-xl transition-all duration-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
                {t("common.back")}
              </Button>
              <Button
                onClick={handleGoHome}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-6 py-2.5 rounded-xl transition-all duration-200 shadow-md hover:shadow-lg"
              >
                <Home className="w-4 h-4 mr-2" aria-hidden="true" />
                {t("errors.goHome")}
              </Button>
            </div>

            {/* Quick Links */}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-6 px-4">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                {t("errors.popularPages")}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {suggestions.map(item => (
                  <Link key={item.path + item.name} href={item.path}>
                    <div className="flex flex-col items-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer group">
                      <item.icon
                        className="w-5 h-5 text-slate-400 group-hover:text-blue-500 mb-2 transition-colors"
                        aria-hidden="true"
                      />
                      <span className="text-xs text-slate-600 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {item.name}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Help text */}
        <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-6">
          {t("errors.needHelp")}{" "}
          <a
            href="mailto:support@ais.com"
            className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline"
          >
            {t("errors.contactSupport")}
          </a>
        </p>
      </div>
    </main>
  );
}
