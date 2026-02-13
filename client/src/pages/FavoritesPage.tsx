/**
 * Favorites Page
 * Shows user's favorite flight routes with price alerts
 */

import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { FavoriteFlights } from "@/components/FavoriteFlights";
import { FlightFavorites } from "@/components/FlightFavorites";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Heart,
  Search,
  Bell,
  TrendingDown,
  Sparkles,
  Plane,
  Route,
} from "lucide-react";

export default function FavoritesPage() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl mx-auto">
        {/* Header with gradient background */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-rose-500 via-pink-500 to-purple-500 p-6 md:p-8 text-white">
          <div className="absolute inset-0 bg-black/10" />
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/10 rounded-full translate-y-1/2 -translate-x-1/2 blur-2xl" />

          <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/20 backdrop-blur-sm rounded-xl">
                <Heart className="h-8 w-8" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">
                  {t("favoritesPage.title")}
                </h1>
                <p className="text-white/80 mt-1">
                  {t("favoritesPage.subtitle")}
                </p>
              </div>
            </div>
            <Button
              onClick={() => setLocation("/search")}
              variant="secondary"
              size="lg"
              className="bg-white/20 hover:bg-white/30 backdrop-blur-sm border-white/30 text-white"
            >
              <Search className="h-4 w-4 mr-2" />
              {t("favoritesPage.searchFlights")}
            </Button>
          </div>
        </div>

        {/* Features Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="group hover:shadow-lg transition-all duration-300 border-rose-100 hover:border-rose-200 bg-gradient-to-br from-white to-rose-50/50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-rose-100 rounded-lg group-hover:bg-rose-200 transition-colors">
                  <Heart className="h-5 w-5 text-rose-500" />
                </div>
                <CardTitle className="text-sm font-semibold">
                  {t("favoritesPage.features.saveRoutes.title")}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t("favoritesPage.features.saveRoutes.description")}
              </p>
            </CardContent>
          </Card>

          <Card className="group hover:shadow-lg transition-all duration-300 border-blue-100 hover:border-blue-200 bg-gradient-to-br from-white to-blue-50/50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg group-hover:bg-blue-200 transition-colors">
                  <Bell className="h-5 w-5 text-blue-500" />
                </div>
                <CardTitle className="text-sm font-semibold">
                  {t("favoritesPage.features.priceAlerts.title")}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t("favoritesPage.features.priceAlerts.description")}
              </p>
            </CardContent>
          </Card>

          <Card className="group hover:shadow-lg transition-all duration-300 border-emerald-100 hover:border-emerald-200 bg-gradient-to-br from-white to-emerald-50/50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100 rounded-lg group-hover:bg-emerald-200 transition-colors">
                  <TrendingDown className="h-5 w-5 text-emerald-500" />
                </div>
                <CardTitle className="text-sm font-semibold">
                  {t("favoritesPage.features.trackPrices.title")}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t("favoritesPage.features.trackPrices.description")}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* How it works section */}
        <Card className="border-dashed border-2 bg-muted/20">
          <CardContent className="py-6">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="h-5 w-5 text-amber-500" />
              <h3 className="font-semibold">
                {t("favoritesPage.howItWorks.title")}
              </h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                  1
                </div>
                <div>
                  <p className="font-medium text-sm">
                    {t("favoritesPage.howItWorks.step1.title")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("favoritesPage.howItWorks.step1.description")}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                  2
                </div>
                <div>
                  <p className="font-medium text-sm">
                    {t("favoritesPage.howItWorks.step2.title")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("favoritesPage.howItWorks.step2.description")}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                  3
                </div>
                <div>
                  <p className="font-medium text-sm">
                    {t("favoritesPage.howItWorks.step3.title")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("favoritesPage.howItWorks.step3.description")}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Favorites Tabs */}
        <Tabs defaultValue="flights" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="flights" className="flex items-center gap-2">
              <Plane className="h-4 w-4" />
              {t("favorites.flightsTab")}
            </TabsTrigger>
            <TabsTrigger value="routes" className="flex items-center gap-2">
              <Route className="h-4 w-4" />
              {t("favorites.routesTab")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="flights">
            <FlightFavorites />
          </TabsContent>

          <TabsContent value="routes">
            <FavoriteFlights />
          </TabsContent>
        </Tabs>

        {/* Price Alerts Link */}
        <Card className="mt-6 border-blue-100 bg-gradient-to-br from-white to-blue-50/50">
          <CardContent className="py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-100 rounded-xl">
                  <Bell className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">
                    {t("priceAlerts.manageAlerts")}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t("priceAlerts.manageAlertsDescription")}
                  </p>
                </div>
              </div>
              <Button asChild variant="outline">
                <Link href="/price-alerts">{t("priceAlerts.viewAlerts")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
