import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Wallet, Clock, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

interface CreditBalanceProps {
  onUseCredits?: (amount: number) => void;
  selectedCredits?: number;
  maxAmount?: number;
  showUsageOption?: boolean;
  className?: string;
}

export function CreditBalance({
  onUseCredits,
  selectedCredits = 0,
  maxAmount,
  showUsageOption = false,
  className,
}: CreditBalanceProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? ar : enUS;
  const [useFullBalance, setUseFullBalance] = useState(false);

  const { data: creditData, isLoading } = trpc.vouchers.myCredits.useQuery();

  const balance = creditData?.balance ?? 0;
  const credits = creditData?.credits ?? [];

  const applicableAmount = maxAmount ? Math.min(balance, maxAmount) : balance;

  const handleToggleCredits = (checked: boolean) => {
    setUseFullBalance(checked);
    if (onUseCredits) {
      onUseCredits(checked ? applicableAmount : 0);
    }
  };

  if (isLoading) {
    return (
      <Card className={cn("", className)}>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-24" />
          <Skeleton className="mt-2 h-4 w-48" />
        </CardContent>
      </Card>
    );
  }

  if (balance === 0 && !showUsageOption) {
    return null;
  }

  return (
    <Card className={cn("", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="h-4 w-4" />
          {t("credits.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Balance Display */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-2xl font-bold">
              {(balance / 100).toFixed(2)}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                {t("common.sar")}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">
              {t("credits.availableBalance")}
            </p>
          </div>
          {balance > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Info className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs">
                <p className="text-sm">{t("credits.infoTooltip")}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Credits Breakdown */}
        {credits.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">
              {t("credits.breakdown")}
            </Label>
            <div className="max-h-32 space-y-1 overflow-y-auto">
              {credits.map(credit => (
                <div
                  key={credit.id}
                  className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {(credit.available / 100).toFixed(2)} {t("common.sar")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({t(`credits.source.${credit.source}`)})
                    </span>
                  </div>
                  {credit.expiresAt && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {format(new Date(credit.expiresAt), "PP", { locale })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Use Credits Option */}
        {showUsageOption && balance > 0 && (
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <Checkbox
                id="use-credits"
                checked={useFullBalance || selectedCredits > 0}
                onCheckedChange={handleToggleCredits}
              />
              <Label
                htmlFor="use-credits"
                className="cursor-pointer text-sm font-medium"
              >
                {t("credits.useBalance")}
              </Label>
            </div>
            <span className="text-sm font-semibold text-green-600">
              -{(applicableAmount / 100).toFixed(2)} {t("common.sar")}
            </span>
          </div>
        )}

        {/* Selected Credits Display */}
        {selectedCredits > 0 && (
          <div className="rounded-lg bg-green-50 p-3 dark:bg-green-950">
            <p className="text-sm font-medium text-green-700 dark:text-green-300">
              {t("credits.applying", {
                amount: (selectedCredits / 100).toFixed(2),
              })}
            </p>
          </div>
        )}

        {balance === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            {t("credits.noCredits")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function CreditBalanceMini({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { data: creditData, isLoading } = trpc.vouchers.myCredits.useQuery();

  if (isLoading) {
    return <Skeleton className={cn("h-6 w-20", className)} />;
  }

  const balance = creditData?.balance ?? 0;

  if (balance === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300",
        className
      )}
    >
      <Wallet className="h-3 w-3" />
      {(balance / 100).toFixed(2)} {t("common.sar")}
    </div>
  );
}
