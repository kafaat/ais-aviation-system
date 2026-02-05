/**
 * FavoriteFlights Component
 * Displays user's favorite flight routes with price alerts
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Heart,
  Bell,
  BellOff,
  Plane,
  Trash2,
  Plus,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

interface FavoriteData {
  favorite: {
    id: number;
    originId: number;
    destinationId: number;
    enablePriceAlert: boolean;
    maxPrice: number | null;
  };
  origin: {
    code: string;
    city: string;
  };
  destination: {
    code: string;
    city: string;
  };
  airline: {
    name: string;
    code: string;
  } | null;
}

export function FavoriteFlights() {
  const { t } = useTranslation();
  const [editingAlert, setEditingAlert] = useState<number | null>(null);
  const [targetPrice, setTargetPrice] = useState<string>("");

  const {
    data: favorites,
    isLoading,
    refetch,
  } = trpc.favorites.getAll.useQuery();

  const updateFavorite = trpc.favorites.update.useMutation({
    onSuccess: () => {
      toast.success(t("favorites.alertUpdated"));
      setEditingAlert(null);
      setTargetPrice("");
      refetch();
    },
    onError: (error: { message: string }) => {
      toast.error(error.message);
    },
  });

  const removeFavorite = trpc.favorites.delete.useMutation({
    onSuccess: () => {
      toast.success(t("favorites.removed"));
      refetch();
    },
    onError: (error: { message: string }) => {
      toast.error(error.message);
    },
  });

  const handleSetAlert = (favoriteId: number) => {
    const price = parseFloat(targetPrice);
    if (isNaN(price) || price <= 0) {
      toast.error(t("favorites.invalidPrice"));
      return;
    }
    updateFavorite.mutate({
      favoriteId,
      maxPrice: price * 100, // Convert to cents
      enablePriceAlert: true,
    });
  };

  const handleToggleAlert = (favoriteId: number, enabled: boolean) => {
    updateFavorite.mutate({
      favoriteId,
      enablePriceAlert: enabled,
    });
  };

  const formatPrice = (priceInCents: number) => {
    return (priceInCents / 100).toLocaleString("ar-SA", {
      style: "currency",
      currency: "SAR",
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const favoritesList = (favorites as FavoriteData[]) || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Heart className="h-5 w-5 text-red-500" />
          {t("favorites.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {favoritesList.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Heart className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p>{t("favorites.empty")}</p>
            <p className="text-sm mt-2">{t("favorites.emptyHint")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {favoritesList.map(item => (
              <div
                key={item.favorite.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="text-center">
                      <div className="font-bold text-lg">
                        {item.origin.code}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {item.origin.city}
                      </div>
                    </div>
                    <Plane className="h-4 w-4 text-muted-foreground" />
                    <div className="text-center">
                      <div className="font-bold text-lg">
                        {item.destination.code}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {item.destination.city}
                      </div>
                    </div>
                  </div>

                  {item.favorite.maxPrice && (
                    <div className="text-right">
                      <div className="font-semibold text-sm text-muted-foreground">
                        {t("favorites.alertAt")}
                      </div>
                      <div className="font-semibold">
                        {formatPrice(item.favorite.maxPrice)}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {item.favorite.enablePriceAlert && (
                    <Badge variant="outline" className="text-xs">
                      <Bell className="h-3 w-3 mr-1" />
                      {t("favorites.enableAlert")}
                    </Badge>
                  )}

                  <Dialog
                    open={editingAlert === item.favorite.id}
                    onOpenChange={open => {
                      if (!open) {
                        setEditingAlert(null);
                        setTargetPrice("");
                      }
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingAlert(item.favorite.id);
                          if (item.favorite.maxPrice) {
                            setTargetPrice(
                              (item.favorite.maxPrice / 100).toString()
                            );
                          }
                        }}
                      >
                        {item.favorite.enablePriceAlert ? (
                          <Bell className="h-4 w-4 text-primary" />
                        ) : (
                          <BellOff className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>
                          {t("favorites.setPriceAlert")}
                        </DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="flex items-center justify-between">
                          <Label>{t("favorites.enableAlert")}</Label>
                          <Switch
                            checked={item.favorite.enablePriceAlert}
                            onCheckedChange={checked =>
                              handleToggleAlert(item.favorite.id, checked)
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>{t("favorites.targetPrice")}</Label>
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              value={targetPrice}
                              onChange={e => setTargetPrice(e.target.value)}
                              placeholder={t("favorites.enterPrice")}
                            />
                            <Button
                              onClick={() => handleSetAlert(item.favorite.id)}
                              disabled={updateFavorite.isPending}
                            >
                              {updateFavorite.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Plus className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t("favorites.alertDescription")}
                          </p>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      removeFavorite.mutate({ favoriteId: item.favorite.id })
                    }
                    disabled={removeFavorite.isPending}
                  >
                    {removeFavorite.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-destructive" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default FavoriteFlights;
