import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Award, TrendingUp, Gift, Plane, Calendar, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { toast } from "sonner";

export default function LoyaltyDashboard() {
  const { t, i18n } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const [milesToRedeem, setMilesToRedeem] = useState("");

  const { data: account, isLoading: accountLoading } = trpc.loyalty.myAccount.useQuery(
    undefined,
    { enabled: !!user }
  );

  const { data: transactions, isLoading: transactionsLoading } = trpc.loyalty.myTransactions.useQuery(
    { limit: 50 },
    { enabled: !!user }
  );

  const redeemMiles = trpc.loyalty.redeemMiles.useMutation({
    onSuccess: (data) => {
      toast.success(t("loyalty.redeemSuccess", { discount: data.discountAmount }));
      setMilesToRedeem("");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  if (authLoading || accountLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>{t("loyalty.loginRequired")}</CardTitle>
            <CardDescription>{t("loyalty.loginRequiredDesc")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const tierInfo = {
    bronze: { name: t("loyalty.tiers.bronze"), color: "bg-amber-700", multiplier: 1, nextTier: 10000, benefits: 3 },
    silver: { name: t("loyalty.tiers.silver"), color: "bg-gray-400", multiplier: 1.25, nextTier: 50000, benefits: 5 },
    gold: { name: t("loyalty.tiers.gold"), color: "bg-yellow-500", multiplier: 1.5, nextTier: 100000, benefits: 7 },
    platinum: { name: t("loyalty.tiers.platinum"), color: "bg-purple-600", multiplier: 2, nextTier: null, benefits: 10 },
  };

  const currentTier = (account?.tier || "bronze") as keyof typeof tierInfo;
  const currentTierInfo = tierInfo[currentTier];
  const totalMiles = account?.totalMilesEarned || 0;
  const availableMiles = account?.currentMilesBalance || 0;
  const nextTierMiles = currentTierInfo.nextTier;
  const progress = nextTierMiles ? Math.min((totalMiles / nextTierMiles) * 100, 100) : 100;

  const handleRedeem = () => {
    const miles = parseInt(milesToRedeem);
    if (isNaN(miles) || miles <= 0) {
      toast.error(t("loyalty.invalidMiles"));
      return;
    }
    if (miles > availableMiles) {
      toast.error(t("loyalty.insufficientMiles"));
      return;
    }
    redeemMiles.mutate({ milesToRedeem: miles });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="container py-6">
          <div className="flex items-center gap-3">
            <Award className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">{t("loyalty.title")}</h1>
              <p className="text-sm text-muted-foreground">{t("loyalty.subtitle")}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="container py-8 space-y-6">
        {/* Account Overview */}
        <div className="grid gap-6 md:grid-cols-3">
          {/* Tier Card */}
          <Card className="md:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{t("loyalty.accountOverview")}</CardTitle>
                  <CardDescription>{t("loyalty.memberSince", { date: account?.createdAt ? format(account.createdAt, "MMMM yyyy", { locale: i18n.language === "ar" ? ar : undefined }) : "-" })}</CardDescription>
                </div>
                <Badge className={`${currentTierInfo.color} text-white text-lg px-4 py-2`}>
                  {currentTierInfo.name}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Miles Balance */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{t("loyalty.availableMiles")}</p>
                  <p className="text-3xl font-bold text-primary">{availableMiles.toLocaleString()}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{t("loyalty.totalEarned")}</p>
                  <p className="text-3xl font-bold">{totalMiles.toLocaleString()}</p>
                </div>
              </div>

              {/* Tier Progress */}
              {nextTierMiles && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>{t("loyalty.progressToNext")}</span>
                    <span className="font-semibold">
                      {totalMiles.toLocaleString()} / {nextTierMiles.toLocaleString()}
                    </span>
                  </div>
                  <Progress value={progress} className="h-3" />
                  <p className="text-xs text-muted-foreground">
                    {t("loyalty.milesRemaining", { miles: (nextTierMiles - totalMiles).toLocaleString() })}
                  </p>
                </div>
              )}

              {/* Tier Benefits */}
              <div className="space-y-2">
                <p className="text-sm font-semibold">{t("loyalty.tierBenefits")}</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    <span>{t("loyalty.earnMultiplier", { multiplier: currentTierInfo.multiplier })}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Gift className="h-4 w-4 text-primary" />
                    <span>{t("loyalty.exclusiveBenefits", { count: currentTierInfo.benefits })}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Redeem Miles Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gift className="h-5 w-5" />
                {t("loyalty.redeemMiles")}
              </CardTitle>
              <CardDescription>{t("loyalty.redeemDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t("loyalty.milesToRedeem")}</Label>
                <Input
                  type="number"
                  placeholder="1000"
                  value={milesToRedeem}
                  onChange={(e) => setMilesToRedeem(e.target.value)}
                  min="0"
                  max={availableMiles}
                />
                {milesToRedeem && parseInt(milesToRedeem) > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("loyalty.discountValue")}: {(parseInt(milesToRedeem) / 10).toFixed(2)} {t("common.currency")}
                  </p>
                )}
              </div>
              <Button
                onClick={handleRedeem}
                disabled={!milesToRedeem || redeemMiles.isPending}
                className="w-full"
              >
                {redeemMiles.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t("common.loading")}
                  </>
                ) : (
                  <>
                    <ArrowRight className="h-4 w-4 mr-2" />
                    {t("loyalty.redeem")}
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                {t("loyalty.redeemNote")}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Transactions History */}
        <Card>
          <CardHeader>
            <CardTitle>{t("loyalty.transactionHistory")}</CardTitle>
            <CardDescription>{t("loyalty.transactionHistoryDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            {transactionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : !transactions || transactions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Plane className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>{t("loyalty.noTransactions")}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("loyalty.date")}</TableHead>
                      <TableHead>{t("loyalty.type")}</TableHead>
                      <TableHead>{t("loyalty.description")}</TableHead>
                      <TableHead className="text-right">{t("loyalty.miles")}</TableHead>
                      <TableHead className="text-right">{t("loyalty.balance")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((tx: any) => (
                      <TableRow key={tx.id}>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            {format(tx.createdAt, "dd MMM yyyy", { locale: i18n.language === "ar" ? ar : undefined })}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={tx.type === "earned" ? "default" : "secondary"}>
                            {t(`loyalty.transactionTypes.${tx.type}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          {tx.description || "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={tx.type === "earned" ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
                            {tx.type === "earned" ? "+" : "-"}{tx.miles.toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {tx.balanceAfter.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* How to Earn Miles */}
        <Card>
          <CardHeader>
            <CardTitle>{t("loyalty.howToEarn")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex gap-3">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Plane className="h-5 w-5 text-primary" />
                  </div>
                </div>
                <div>
                  <p className="font-semibold">{t("loyalty.earnByFlying")}</p>
                  <p className="text-sm text-muted-foreground">{t("loyalty.earnByFlyingDesc")}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <TrendingUp className="h-5 w-5 text-primary" />
                  </div>
                </div>
                <div>
                  <p className="font-semibold">{t("loyalty.tierBonus")}</p>
                  <p className="text-sm text-muted-foreground">{t("loyalty.tierBonusDesc")}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Gift className="h-5 w-5 text-primary" />
                  </div>
                </div>
                <div>
                  <p className="font-semibold">{t("loyalty.specialOffers")}</p>
                  <p className="text-sm text-muted-foreground">{t("loyalty.specialOffersDesc")}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
