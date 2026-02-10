/**
 * PriceAlerts Page
 * Manage price alerts for flight routes
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { CreatePriceAlertDialog } from "@/components/CreatePriceAlertDialog";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Bell,
  Trash2,
  Loader2,
  ArrowRight,
  TrendingDown,
  Clock,
  Edit2,
  Search,
  Heart,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

export default function PriceAlerts() {
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === "ar" ? ar : enUS;
  const [editingAlertId, setEditingAlertId] = useState<number | null>(null);
  const [editTargetPrice, setEditTargetPrice] = useState<string>("");

  const {
    data: alerts,
    isLoading,
    refetch,
  } = trpc.priceAlerts.getAll.useQuery();

  const toggleAlert = trpc.priceAlerts.toggle.useMutation({
    onSuccess: () => {
      toast.success(t("priceAlerts.alertToggled"));
      refetch();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const deleteAlert = trpc.priceAlerts.delete.useMutation({
    onSuccess: () => {
      toast.success(t("priceAlerts.alertDeleted"));
      refetch();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const updatePrice = trpc.priceAlerts.updatePrice.useMutation({
    onSuccess: () => {
      toast.success(t("priceAlerts.priceUpdated"));
      setEditingAlertId(null);
      setEditTargetPrice("");
      refetch();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const formatPrice = (priceInCents: number) => {
    return (priceInCents / 100).toLocaleString(
      i18n.language === "ar" ? "ar-SA" : "en-US",
      {
        style: "currency",
        currency: "SAR",
        maximumFractionDigits: 0,
      }
    );
  };

  const formatDateTime = (date: Date | string | null) => {
    if (!date) return t("priceAlerts.neverChecked");
    return format(new Date(date), "d MMM yyyy HH:mm", {
      locale: currentLocale,
    });
  };

  const handleUpdatePrice = (alertId: number) => {
    const price = parseFloat(editTargetPrice);
    if (isNaN(price) || price <= 0) {
      toast.error(t("favorites.invalidPrice"));
      return;
    }
    updatePrice.mutate({
      alertId,
      targetPrice: Math.round(price * 100), // Convert to cents
    });
  };

  const alertsList = alerts || [];

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 p-6 md:p-8 text-white">
          <div className="absolute inset-0 bg-black/10" />
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/10 rounded-full translate-y-1/2 -translate-x-1/2 blur-2xl" />

          <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/20 backdrop-blur-sm rounded-xl">
                <Bell className="h-8 w-8" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">
                  {t("priceAlerts.title")}
                </h1>
                <p className="text-white/80 mt-1">
                  {t("priceAlerts.subtitle")}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <CreatePriceAlertDialog onSuccess={refetch} />
              <Button
                asChild
                variant="secondary"
                className="bg-white/20 hover:bg-white/30 backdrop-blur-sm border-white/30 text-white"
              >
                <Link href="/favorites">
                  <Heart className="h-4 w-4 mr-2" />
                  {t("priceAlerts.viewFavorites")}
                </Link>
              </Button>
            </div>
          </div>
        </div>

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-gradient-to-br from-white to-blue-50/50 border-blue-100">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Bell className="h-4 w-4 text-blue-500" />
                {t("priceAlerts.howItWorks.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {t("priceAlerts.howItWorks.description")}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-white to-green-50/50 border-green-100">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-green-500" />
                {t("priceAlerts.savings.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {t("priceAlerts.savings.description")}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-white to-amber-50/50 border-amber-100">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" />
                {t("priceAlerts.realtime.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {t("priceAlerts.realtime.description")}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Alerts List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-primary" />
                {t("priceAlerts.yourAlerts")}
              </span>
              <Badge variant="outline">
                {alertsList.length} {t("priceAlerts.active")}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : alertsList.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Bell className="h-16 w-16 mx-auto mb-4 opacity-20" />
                <p className="text-lg font-medium mb-2">
                  {t("priceAlerts.noAlerts")}
                </p>
                <p className="text-sm mb-6">{t("priceAlerts.noAlertsHint")}</p>
                <CreatePriceAlertDialog onSuccess={refetch} />
              </div>
            ) : (
              <div className="space-y-4">
                {alertsList.map(item => {
                  const isPriceBelow =
                    item.alert.currentPrice &&
                    item.alert.currentPrice <= item.alert.targetPrice;

                  return (
                    <div
                      key={item.alert.id}
                      className={`p-4 border rounded-lg transition-colors ${
                        item.alert.isActive
                          ? isPriceBelow
                            ? "bg-green-50 border-green-200"
                            : "hover:bg-muted/50"
                          : "bg-muted/30 opacity-70"
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        {/* Route Info */}
                        <div className="flex-1">
                          <div className="flex items-center gap-4 mb-2">
                            <div className="flex items-center gap-2">
                              <div className="text-center">
                                <div className="font-bold text-lg">
                                  {item.origin.code}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {item.origin.city}
                                </div>
                              </div>

                              <ArrowRight className="h-4 w-4 text-muted-foreground" />

                              <div className="text-center">
                                <div className="font-bold text-lg">
                                  {item.destination.code}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {item.destination.city}
                                </div>
                              </div>
                            </div>

                            <Badge
                              variant={
                                item.alert.cabinClass === "business"
                                  ? "secondary"
                                  : "outline"
                              }
                            >
                              {t(`cabin.${item.alert.cabinClass}`)}
                            </Badge>

                            {!item.alert.isActive && (
                              <Badge variant="secondary">
                                {t("priceAlerts.paused")}
                              </Badge>
                            )}
                          </div>

                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {t("priceAlerts.lastChecked")}:{" "}
                              {formatDateTime(item.alert.lastChecked)}
                            </span>
                          </div>
                        </div>

                        {/* Pricing */}
                        <div className="flex items-center gap-6">
                          <div className="text-center">
                            <div className="text-xs text-muted-foreground">
                              {t("priceAlerts.targetPrice")}
                            </div>
                            <div className="text-lg font-bold text-primary">
                              {formatPrice(item.alert.targetPrice)}
                            </div>
                          </div>

                          <div className="text-center">
                            <div className="text-xs text-muted-foreground">
                              {t("priceAlerts.currentPrice")}
                            </div>
                            <div
                              className={`text-lg font-bold flex items-center gap-1 ${
                                isPriceBelow
                                  ? "text-green-600"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {item.alert.currentPrice
                                ? formatPrice(item.alert.currentPrice)
                                : "-"}
                              {isPriceBelow && (
                                <TrendingDown className="h-4 w-4" />
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                          {isPriceBelow && item.alert.isActive && (
                            <Button asChild size="sm" variant="default">
                              <Link
                                href={`/search?from=${item.origin.id}&to=${item.destination.id}`}
                              >
                                <Search className="h-4 w-4 mr-1" />
                                {t("priceAlerts.searchNow")}
                              </Link>
                            </Button>
                          )}

                          <Dialog
                            open={editingAlertId === item.alert.id}
                            onOpenChange={open => {
                              if (!open) {
                                setEditingAlertId(null);
                                setEditTargetPrice("");
                              }
                            }}
                          >
                            <DialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setEditingAlertId(item.alert.id);
                                  setEditTargetPrice(
                                    (item.alert.targetPrice / 100).toString()
                                  );
                                }}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>
                                  {t("priceAlerts.editTargetPrice")}
                                </DialogTitle>
                              </DialogHeader>
                              <div className="space-y-4 py-4">
                                <div className="flex items-center gap-4 mb-4">
                                  <span className="font-bold">
                                    {item.origin.code}
                                  </span>
                                  <ArrowRight className="h-4 w-4" />
                                  <span className="font-bold">
                                    {item.destination.code}
                                  </span>
                                </div>
                                <div className="flex gap-2">
                                  <Input
                                    type="number"
                                    value={editTargetPrice}
                                    onChange={e =>
                                      setEditTargetPrice(e.target.value)
                                    }
                                    placeholder={t("favorites.enterPrice")}
                                  />
                                  <Button
                                    onClick={() =>
                                      handleUpdatePrice(item.alert.id)
                                    }
                                    disabled={updatePrice.isPending}
                                  >
                                    {updatePrice.isPending ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      t("common.save")
                                    )}
                                  </Button>
                                </div>
                              </div>
                            </DialogContent>
                          </Dialog>

                          <Switch
                            checked={item.alert.isActive}
                            onCheckedChange={() =>
                              toggleAlert.mutate({ alertId: item.alert.id })
                            }
                            disabled={toggleAlert.isPending}
                          />

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              deleteAlert.mutate({ alertId: item.alert.id })
                            }
                            disabled={deleteAlert.isPending}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            {deleteAlert.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
