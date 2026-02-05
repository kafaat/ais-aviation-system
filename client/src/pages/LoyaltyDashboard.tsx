import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardSkeleton } from "@/components/skeletons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Award,
  TrendingUp,
  Gift,
  Plane,
  Calendar,
  ArrowRight,
  Star,
  Crown,
  Shield,
  Zap,
  Check,
  X,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { format, subMonths } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// Tier configuration with colors and gradients
const tierConfig = {
  bronze: {
    gradient: "from-amber-600 via-amber-700 to-amber-800",
    bgGradient: "from-amber-50 to-amber-100",
    borderColor: "border-amber-300",
    textColor: "text-amber-800",
    iconColor: "text-amber-600",
    icon: Shield,
    multiplier: 1,
    nextTier: 10000,
    benefits: ["seatSelection", "bonusMiles", "exclusiveOffers"],
  },
  silver: {
    gradient: "from-gray-400 via-gray-500 to-gray-600",
    bgGradient: "from-gray-50 to-gray-100",
    borderColor: "border-gray-300",
    textColor: "text-gray-700",
    iconColor: "text-gray-500",
    icon: Star,
    multiplier: 1.25,
    nextTier: 50000,
    benefits: [
      "seatSelection",
      "bonusMiles",
      "exclusiveOffers",
      "priorityBoarding",
      "extraBaggage",
    ],
  },
  gold: {
    gradient: "from-yellow-400 via-yellow-500 to-yellow-600",
    bgGradient: "from-yellow-50 to-yellow-100",
    borderColor: "border-yellow-400",
    textColor: "text-yellow-800",
    iconColor: "text-yellow-500",
    icon: Crown,
    multiplier: 1.5,
    nextTier: 100000,
    benefits: [
      "seatSelection",
      "bonusMiles",
      "exclusiveOffers",
      "priorityBoarding",
      "extraBaggage",
      "loungeAccess",
      "flexibleBooking",
    ],
  },
  platinum: {
    gradient: "from-purple-500 via-purple-600 to-purple-700",
    bgGradient: "from-purple-50 to-purple-100",
    borderColor: "border-purple-400",
    textColor: "text-purple-800",
    iconColor: "text-purple-500",
    icon: Zap,
    multiplier: 2,
    nextTier: null,
    benefits: [
      "seatSelection",
      "bonusMiles",
      "exclusiveOffers",
      "priorityBoarding",
      "extraBaggage",
      "loungeAccess",
      "flexibleBooking",
      "upgrades",
      "dedicatedSupport",
      "partnerBenefits",
    ],
  },
};

const allBenefits = [
  "seatSelection",
  "bonusMiles",
  "exclusiveOffers",
  "priorityBoarding",
  "extraBaggage",
  "loungeAccess",
  "flexibleBooking",
  "upgrades",
  "dedicatedSupport",
  "partnerBenefits",
];

// Animated Progress Bar Component
function AnimatedProgressBar({
  value,
  className,
  gradient,
}: {
  value: number;
  className?: string;
  gradient: string;
}) {
  return (
    <div
      className={`relative h-4 w-full overflow-hidden rounded-full bg-gray-200 ${className}`}
    >
      <motion.div
        className={`absolute inset-y-0 left-0 bg-gradient-to-r ${gradient} rounded-full`}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(value, 100)}%` }}
        transition={{ duration: 1.5, ease: "easeOut" }}
      />
      <motion.div
        className="absolute inset-y-0 left-0 bg-white/30 rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(value, 100)}%` }}
        transition={{ duration: 1.5, ease: "easeOut", delay: 0.1 }}
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)",
          backgroundSize: "200% 100%",
          animation: "shimmer 2s infinite",
        }}
      />
    </div>
  );
}

// Loading Skeleton Component - imported from @/components/skeletons
// Using DashboardSkeleton for consistent loading state

// Tier Benefit Card
function TierBenefitCard({
  tier,
  tierKey,
  isCurrentTier,
  t,
}: {
  tier: (typeof tierConfig)[keyof typeof tierConfig];
  tierKey: string;
  isCurrentTier: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const TierIcon = tier.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <Card
        className={`relative overflow-hidden transition-all duration-300 hover:shadow-lg ${
          isCurrentTier ? `ring-2 ring-offset-2 ${tier.borderColor}` : ""
        }`}
      >
        {isCurrentTier && (
          <div className="absolute top-2 right-2">
            <Badge
              variant="secondary"
              className="bg-primary text-primary-foreground"
            >
              {t("loyalty.yourTier")}
            </Badge>
          </div>
        )}
        <div className={`h-2 bg-gradient-to-r ${tier.gradient}`} />
        <CardHeader className={`bg-gradient-to-br ${tier.bgGradient}`}>
          <div className="flex items-center gap-3">
            <div
              className={`p-3 rounded-full bg-gradient-to-br ${tier.gradient}`}
            >
              <TierIcon className="h-6 w-6 text-white" />
            </div>
            <div>
              <CardTitle className={tier.textColor}>
                {t(`loyalty.tiers.${tierKey}`)}
              </CardTitle>
              <CardDescription>
                {t("loyalty.earnMultiplier", { multiplier: tier.multiplier })}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="space-y-3">
            {allBenefits.map(benefit => {
              const hasBenefit = tier.benefits.includes(benefit);
              return (
                <div
                  key={benefit}
                  className={`flex items-center gap-2 text-sm ${
                    hasBenefit ? "text-foreground" : "text-muted-foreground/50"
                  }`}
                >
                  {hasBenefit ? (
                    <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                  ) : (
                    <X className="h-4 w-4 text-gray-300 flex-shrink-0" />
                  )}
                  <span className={hasBenefit ? "" : "line-through"}>
                    {t(`loyalty.benefits.${benefit}`)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 pt-4 border-t">
            <p className="text-xs text-muted-foreground">
              {tier.nextTier
                ? t("loyalty.milesRequired", {
                    miles: tier.nextTier.toLocaleString(),
                  })
                : t("loyalty.unlimitedBenefits")}
            </p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function LoyaltyDashboard() {
  const { t, i18n } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const [milesToRedeem, setMilesToRedeem] = useState("");

  const dateLocale = i18n.language === "ar" ? ar : enUS;

  const { data: account, isLoading: accountLoading } =
    trpc.loyalty.myAccount.useQuery(undefined, { enabled: !!user });

  const { data: transactions, isLoading: transactionsLoading } =
    trpc.loyalty.myTransactions.useQuery({ limit: 50 }, { enabled: !!user });

  const redeemMiles = trpc.loyalty.redeemMiles.useMutation({
    onSuccess: data => {
      toast.success(
        t("loyalty.redeemSuccess", { discount: data.discountAmount })
      );
      setMilesToRedeem("");
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  // Transaction type from the API
  type Transaction = {
    id: number;
    createdAt: Date;
    type: "earn" | "redeem" | "expire" | "bonus" | "adjustment";
    amount: number;
    balanceAfter: number;
    description: string;
  };

  // Generate chart data from transactions
  const chartData = useMemo(() => {
    if (!transactions) return [];

    const months: { [key: string]: { earned: number; redeemed: number } } = {};
    const now = new Date();

    // Initialize last 6 months
    for (let i = 5; i >= 0; i--) {
      const monthDate = subMonths(now, i);
      const key = format(monthDate, "MMM yyyy", { locale: dateLocale });
      months[key] = { earned: 0, redeemed: 0 };
    }

    // Aggregate transactions
    (transactions as Transaction[]).forEach(tx => {
      const txDate = new Date(tx.createdAt);
      const sixMonthsAgo = subMonths(now, 6);
      if (txDate >= sixMonthsAgo) {
        const key = format(txDate, "MMM yyyy", { locale: dateLocale });
        if (months[key]) {
          if (tx.type === "earn" || tx.type === "bonus") {
            months[key].earned += tx.amount;
          } else if (tx.type === "redeem") {
            months[key].redeemed += tx.amount;
          }
        }
      }
    });

    return Object.entries(months).map(([month, data]) => ({
      month,
      earned: data.earned,
      redeemed: data.redeemed,
    }));
  }, [transactions, dateLocale]);

  // Calculate monthly stats
  const monthlyStats = useMemo(() => {
    if (!transactions) return { earned: 0, redeemed: 0 };

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    return (transactions as Transaction[]).reduce(
      (acc, tx) => {
        const txDate = new Date(tx.createdAt);
        if (
          txDate.getMonth() === currentMonth &&
          txDate.getFullYear() === currentYear
        ) {
          if (tx.type === "earn" || tx.type === "bonus") {
            acc.earned += tx.amount;
          } else if (tx.type === "redeem") {
            acc.redeemed += tx.amount;
          }
        }
        return acc;
      },
      { earned: 0, redeemed: 0 }
    );
  }, [transactions]);

  if (authLoading || accountLoading) {
    return <DashboardSkeleton />;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <Card className="max-w-md shadow-xl">
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                <Award className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">
                {t("loyalty.loginRequired")}
              </CardTitle>
              <CardDescription className="text-base">
                {t("loyalty.loginRequiredDesc")}
              </CardDescription>
            </CardHeader>
          </Card>
        </motion.div>
      </div>
    );
  }

  const currentTier = (account?.tier || "bronze") as keyof typeof tierConfig;
  const currentTierConfig = tierConfig[currentTier];
  const totalMiles = account?.totalMilesEarned || 0;
  const availableMiles = account?.currentMilesBalance || 0;
  const nextTierMiles = currentTierConfig.nextTier;
  const progress = nextTierMiles
    ? Math.min((totalMiles / nextTierMiles) * 100, 100)
    : 100;

  const TierIcon = currentTierConfig.icon;

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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50">
      {/* Animated Header */}
      <header className="relative overflow-hidden">
        <div
          className={`absolute inset-0 bg-gradient-to-r ${currentTierConfig.gradient} opacity-90`}
        />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4xIj48Y2lyY2xlIGN4PSIzMCIgY3k9IjMwIiByPSIyIi8+PC9nPjwvZz48L3N2Zz4=')] opacity-30" />
        <div className="container py-8 relative">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex items-center gap-4"
          >
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <TierIcon className="h-8 w-8 text-white" />
              </div>
              <motion.div
                className="absolute -inset-1 rounded-full border-2 border-white/30"
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            </div>
            <div className="text-white">
              <h1 className="text-3xl font-bold flex items-center gap-2">
                {t("loyalty.title")}
                <Sparkles className="h-6 w-6" />
              </h1>
              <p className="text-white/80">{t("loyalty.subtitle")}</p>
              <Badge className="mt-2 bg-white/20 text-white border-white/30">
                {t(`loyalty.tiers.${currentTier}`)} -{" "}
                {t("loyalty.memberSince", {
                  date: account?.createdAt
                    ? format(account.createdAt, "MMMM yyyy", {
                        locale: dateLocale,
                      })
                    : "-",
                })}
              </Badge>
            </div>
          </motion.div>
        </div>
      </header>

      {/* Content */}
      <div className="container py-8 space-y-8">
        {/* Stats Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
        >
          {/* Available Miles */}
          <Card className="relative overflow-hidden group hover:shadow-lg transition-shadow">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-blue-600 opacity-0 group-hover:opacity-5 transition-opacity" />
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("loyalty.availableMiles")}
                  </p>
                  <p className="text-3xl font-bold text-primary">
                    {availableMiles.toLocaleString()}
                  </p>
                </div>
                <div className="p-3 rounded-full bg-primary/10">
                  <Plane className="h-6 w-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Total Earned */}
          <Card className="relative overflow-hidden group hover:shadow-lg transition-shadow">
            <div className="absolute inset-0 bg-gradient-to-br from-green-500 to-green-600 opacity-0 group-hover:opacity-5 transition-opacity" />
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("loyalty.totalEarned")}
                  </p>
                  <p className="text-3xl font-bold text-green-600">
                    {totalMiles.toLocaleString()}
                  </p>
                </div>
                <div className="p-3 rounded-full bg-green-100">
                  <TrendingUp className="h-6 w-6 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Earned This Month */}
          <Card className="relative overflow-hidden group hover:shadow-lg transition-shadow">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500 to-purple-600 opacity-0 group-hover:opacity-5 transition-opacity" />
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("loyalty.earnedThisMonth")}
                  </p>
                  <p className="text-3xl font-bold text-purple-600">
                    +{monthlyStats.earned.toLocaleString()}
                  </p>
                </div>
                <div className="p-3 rounded-full bg-purple-100">
                  <Sparkles className="h-6 w-6 text-purple-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Redeemed This Month */}
          <Card className="relative overflow-hidden group hover:shadow-lg transition-shadow">
            <div className="absolute inset-0 bg-gradient-to-br from-orange-500 to-orange-600 opacity-0 group-hover:opacity-5 transition-opacity" />
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("loyalty.redeemedThisMonth")}
                  </p>
                  <p className="text-3xl font-bold text-orange-600">
                    -{monthlyStats.redeemed.toLocaleString()}
                  </p>
                </div>
                <div className="p-3 rounded-full bg-orange-100">
                  <Gift className="h-6 w-6 text-orange-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Tier Progress Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <Card className="overflow-hidden">
            <CardHeader
              className={`bg-gradient-to-r ${currentTierConfig.bgGradient}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{t("loyalty.progressToNext")}</CardTitle>
                  <CardDescription>
                    {nextTierMiles
                      ? t("loyalty.milesRemaining", {
                          miles: (nextTierMiles - totalMiles).toLocaleString(),
                        })
                      : t("loyalty.unlimitedBenefits")}
                  </CardDescription>
                </div>
                <Badge
                  className={`bg-gradient-to-r ${currentTierConfig.gradient} text-white text-lg px-4 py-2 border-0`}
                >
                  <TierIcon className="h-5 w-5 mr-2" />
                  {t(`loyalty.tiers.${currentTier}`)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {totalMiles.toLocaleString()} {t("loyalty.miles")}
                  </span>
                  {nextTierMiles && (
                    <span className="text-muted-foreground">
                      {nextTierMiles.toLocaleString()} {t("loyalty.miles")}
                    </span>
                  )}
                </div>
                <AnimatedProgressBar
                  value={progress}
                  gradient={currentTierConfig.gradient}
                />
                {nextTierMiles && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{t(`loyalty.tiers.${currentTier}`)}</span>
                    <span>
                      {t(
                        `loyalty.tiers.${
                          Object.keys(tierConfig)[
                            Object.keys(tierConfig).indexOf(currentTier) + 1
                          ]
                        }`
                      )}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Main Grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column - Charts and History */}
          <div className="lg:col-span-2 space-y-6">
            {/* Miles History Chart */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    {t("loyalty.milesHistory")}
                  </CardTitle>
                  <CardDescription>{t("loyalty.last6Months")}</CardDescription>
                </CardHeader>
                <CardContent>
                  {transactionsLoading ? (
                    <Skeleton className="h-64" />
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient
                            id="earnedGradient"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#10b981"
                              stopOpacity={0.8}
                            />
                            <stop
                              offset="95%"
                              stopColor="#10b981"
                              stopOpacity={0.1}
                            />
                          </linearGradient>
                          <linearGradient
                            id="redeemedGradient"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#f97316"
                              stopOpacity={0.8}
                            />
                            <stop
                              offset="95%"
                              stopColor="#f97316"
                              stopOpacity={0.1}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "rgba(255, 255, 255, 0.95)",
                            borderRadius: "8px",
                            border: "1px solid #e5e7eb",
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="earned"
                          stroke="#10b981"
                          fillOpacity={1}
                          fill="url(#earnedGradient)"
                          name={t("loyalty.transactionTypes.earned")}
                        />
                        <Area
                          type="monotone"
                          dataKey="redeemed"
                          stroke="#f97316"
                          fillOpacity={1}
                          fill="url(#redeemedGradient)"
                          name={t("loyalty.transactionTypes.redeemed")}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Transaction History */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Calendar className="h-5 w-5 text-primary" />
                        {t("loyalty.transactionHistory")}
                      </CardTitle>
                      <CardDescription>
                        {t("loyalty.transactionHistoryDesc")}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {transactionsLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3, 4, 5].map(i => (
                        <Skeleton key={i} className="h-16" />
                      ))}
                    </div>
                  ) : !transactions || transactions.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                        <Plane className="h-8 w-8 text-gray-400" />
                      </div>
                      <p className="text-muted-foreground">
                        {t("loyalty.noTransactions")}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead className="font-semibold">
                              {t("loyalty.date")}
                            </TableHead>
                            <TableHead className="font-semibold">
                              {t("loyalty.type")}
                            </TableHead>
                            <TableHead className="font-semibold">
                              {t("loyalty.description")}
                            </TableHead>
                            <TableHead className="text-right font-semibold">
                              {t("loyalty.miles")}
                            </TableHead>
                            <TableHead className="text-right font-semibold">
                              {t("loyalty.balance")}
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <AnimatePresence>
                            {(transactions as Transaction[])
                              .slice(0, 10)
                              .map((tx, index) => {
                                const isEarning =
                                  tx.type === "earn" || tx.type === "bonus";
                                const typeKey =
                                  tx.type === "earn"
                                    ? "earned"
                                    : tx.type === "redeem"
                                      ? "redeemed"
                                      : tx.type;
                                return (
                                  <motion.tr
                                    key={tx.id}
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: index * 0.05 }}
                                    className="group hover:bg-muted/50 transition-colors"
                                  >
                                    <TableCell className="whitespace-nowrap">
                                      <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                                          <Calendar className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                                        </div>
                                        <span className="text-sm">
                                          {format(tx.createdAt, "dd MMM yyyy", {
                                            locale: dateLocale,
                                          })}
                                        </span>
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <Badge
                                        variant={
                                          isEarning ? "default" : "secondary"
                                        }
                                        className={
                                          isEarning
                                            ? "bg-green-100 text-green-800 hover:bg-green-200"
                                            : tx.type === "redeem"
                                              ? "bg-orange-100 text-orange-800 hover:bg-orange-200"
                                              : "bg-gray-100 text-gray-800"
                                        }
                                      >
                                        {t(
                                          `loyalty.transactionTypes.${typeKey}`
                                        )}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="max-w-xs truncate text-muted-foreground">
                                      {tx.description || "-"}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <span
                                        className={`font-semibold ${
                                          isEarning
                                            ? "text-green-600"
                                            : "text-orange-600"
                                        }`}
                                      >
                                        {isEarning ? "+" : "-"}
                                        {tx.amount.toLocaleString()}
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-right font-medium">
                                      {tx.balanceAfter.toLocaleString()}
                                    </TableCell>
                                  </motion.tr>
                                );
                              })}
                          </AnimatePresence>
                        </TableBody>
                      </Table>
                      {transactions.length > 10 && (
                        <div className="mt-4 text-center">
                          <Button variant="ghost" size="sm">
                            {t("loyalty.viewAll")}
                            <ChevronRight className="h-4 w-4 ml-1" />
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Right Column - Redeem & How to Earn */}
          <div className="space-y-6">
            {/* Redeem Miles Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
            >
              <Card className="overflow-hidden">
                <div className="h-2 bg-gradient-to-r from-primary via-purple-500 to-pink-500" />
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Gift className="h-5 w-5 text-primary" />
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
                      onChange={e => setMilesToRedeem(e.target.value)}
                      min="0"
                      max={availableMiles}
                      className="text-lg"
                    />
                    {milesToRedeem && parseInt(milesToRedeem) > 0 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        className="p-3 bg-green-50 rounded-lg border border-green-200"
                      >
                        <p className="text-sm text-green-800">
                          {t("loyalty.discountValue")}:{" "}
                          <span className="font-bold">
                            {(parseInt(milesToRedeem) / 10).toFixed(2)}{" "}
                            {t("common.currency")}
                          </span>
                        </p>
                      </motion.div>
                    )}
                  </div>
                  <Button
                    onClick={handleRedeem}
                    disabled={!milesToRedeem || redeemMiles.isPending}
                    className="w-full bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90"
                  >
                    {redeemMiles.isPending ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{
                          duration: 1,
                          repeat: Infinity,
                          ease: "linear",
                        }}
                        className="mr-2"
                      >
                        <Gift className="h-4 w-4" />
                      </motion.div>
                    ) : (
                      <ArrowRight className="h-4 w-4 mr-2" />
                    )}
                    {redeemMiles.isPending
                      ? t("common.loading")
                      : t("loyalty.redeem")}
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    {t("loyalty.redeemNote")}
                  </p>
                </CardContent>
              </Card>
            </motion.div>

            {/* How to Earn Miles */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle>{t("loyalty.howToEarn")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {[
                    {
                      icon: Plane,
                      title: t("loyalty.earnByFlying"),
                      desc: t("loyalty.earnByFlyingDesc"),
                      color: "bg-blue-100 text-blue-600",
                    },
                    {
                      icon: TrendingUp,
                      title: t("loyalty.tierBonus"),
                      desc: t("loyalty.tierBonusDesc"),
                      color: "bg-green-100 text-green-600",
                    },
                    {
                      icon: Gift,
                      title: t("loyalty.specialOffers"),
                      desc: t("loyalty.specialOffersDesc"),
                      color: "bg-purple-100 text-purple-600",
                    },
                  ].map((item, index) => (
                    <motion.div
                      key={item.title}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.5 + index * 0.1 }}
                      className="flex gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div
                        className={`flex-shrink-0 w-10 h-10 rounded-full ${item.color} flex items-center justify-center`}
                      >
                        <item.icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.desc}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>

        {/* Tier Comparison Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <Card className="overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-gray-50 to-gray-100">
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5 text-primary" />
                {t("loyalty.compareTiers")}
              </CardTitle>
              <CardDescription>{t("loyalty.compareTiersDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {(
                  Object.entries(tierConfig) as [
                    keyof typeof tierConfig,
                    (typeof tierConfig)[keyof typeof tierConfig],
                  ][]
                ).map(([tierKey, tier]) => (
                  <TierBenefitCard
                    key={tierKey}
                    tier={tier}
                    tierKey={tierKey}
                    isCurrentTier={tierKey === currentTier}
                    t={t}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* CSS for shimmer animation */}
      <style>{`
        @keyframes shimmer {
          0% {
            background-position: -200% 0;
          }
          100% {
            background-position: 200% 0;
          }
        }
      `}</style>
    </div>
  );
}
