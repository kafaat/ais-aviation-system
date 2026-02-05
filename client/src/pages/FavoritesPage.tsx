/**
 * Favorites Page
 * Shows user's favorite flight routes with price alerts
 */

import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { FavoriteFlights } from "@/components/FavoriteFlights";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Heart, Search, Bell, TrendingDown } from "lucide-react";
import { useLocation } from "wouter";

export default function FavoritesPage() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t("favoritesPage.title")}</h1>
            <p className="text-muted-foreground">
              {t("favoritesPage.subtitle")}
            </p>
          </div>
          <Button onClick={() => setLocation("/search")}>
            <Search className="h-4 w-4 mr-2" />
            {t("favoritesPage.searchFlights")}
          </Button>
        </div>

        {/* Features Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Heart className="h-4 w-4 text-red-500" />
                {t("favoritesPage.features.saveRoutes.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {t("favoritesPage.features.saveRoutes.description")}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Bell className="h-4 w-4 text-primary" />
                {t("favoritesPage.features.priceAlerts.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {t("favoritesPage.features.priceAlerts.description")}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-green-500" />
                {t("favoritesPage.features.trackPrices.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {t("favoritesPage.features.trackPrices.description")}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Favorites List */}
        <FavoriteFlights />
      </div>
    </DashboardLayout>
  );
}
