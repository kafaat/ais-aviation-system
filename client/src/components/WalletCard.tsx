import { useAuth } from "@/_core/hooks/useAuth";
import { prepareValueIntent } from "@/lib/redemption-intent";
import { useSearch } from "wouter";
import { useState } from "react";
import { useOperationalLabels } from "./OperationalReadState";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import {
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  RotateCcw,
  Loader2,
  Plus,
  History,
} from "lucide-react";
import { toast } from "sonner";

const QUICK_AMOUNTS = [5000, 10000, 25000, 50000]; // SAR cents

export function WalletCard() {
  const { t } = useTranslation();
  const l = useOperationalLabels();
  const { user } = useAuth();
  const [customAmount, setCustomAmount] = useState("");
  const search = useSearch();
  const [showHistory, setShowHistory] = useState(
    () => new URLSearchParams(search).get("wallet") === "history"
  );
  const pageSize = 10;
  const [offset, setOffset] = useState(0);

  const balanceQuery = trpc.wallet.balance.useQuery(undefined, {
    retry: false,
  });

  const balance = balanceQuery.data;
  const transactionQuery = trpc.wallet.transactions.useQuery(
    { limit: pageSize + 1, offset },
    { enabled: showHistory, retry: false }
  );

  const transactions = transactionQuery.data;
  const customMinor = /^\d+(\.\d{1,2})?$/.test(customAmount)
    ? Math.round(Number(customAmount) * 100)
    : 0;
  const topUp = trpc.wallet.topUp.useMutation();
  const canTopUp =
    balance?.status === "active" &&
    balance.currency === "SAR" &&
    !topUp.isPending;
  const handleTopUp = async (amountCents: number) => {
    if (!user || topUp.isPending) return;
    try {
      const intent = prepareValueIntent(
        sessionStorage,
        `ais:wallet:topup:${user.id}:${amountCents}`
      );
      if (!intent) return;
      const result = await topUp.mutateAsync({
        amount: amountCents,
        idempotencyKey: intent.key,
      });
      if (!result.url) throw new Error(t("wallet.topUpError"));
      window.location.assign(result.url);
      intent.acknowledge();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("wallet.topUpError")
      );
    }
  };

  if (balanceQuery.isError)
    return (
      <Card role="alert" className="p-6">
        <p>
          {l("تعذّر تحميل رصيد المحفظة", "Wallet balance could not be loaded")}
        </p>
        <Button variant="outline" onClick={() => void balanceQuery.refetch()}>
          {l("إعادة المحاولة", "Retry")}
        </Button>
      </Card>
    );

  if (!balance) {
    return (
      <Card className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-1/3" />
          <div className="h-16 bg-muted rounded" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      {/* Header + Balance */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          <h3 className="font-semibold">{t("wallet.title")}</h3>
        </div>
        <Badge
          variant={balance && balance.balance > 0 ? "default" : "secondary"}
          className="text-lg px-4 py-1"
        >
          {(balance.balance / 100).toFixed(2)} {balance.currency}
        </Badge>
      </div>

      {/* Quick Top-up */}
      <p className="text-sm text-muted-foreground mb-3">
        {t("wallet.quickTopUp")}
      </p>
      <div className="grid grid-cols-4 gap-2 mb-4">
        {QUICK_AMOUNTS.map(amount => (
          <Button
            key={amount}
            variant="outline"
            size="sm"
            onClick={() => handleTopUp(amount)}
            disabled={!canTopUp}
            className="text-xs"
          >
            {topUp.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              `${(amount / 100).toFixed(0)} ${t("common.sar")}`
            )}
          </Button>
        ))}
      </div>

      {/* Custom Amount */}
      <div className="flex gap-2 mb-4">
        <Input
          value={customAmount}
          onChange={e => setCustomAmount(e.target.value)}
          placeholder={t("wallet.customAmount")}
          type="number"
          min={10}
          max={10000}
          step="0.01"
          aria-label={t("wallet.customAmount")}
          className="flex-1"
        />
        <Button
          aria-label={t("wallet.quickTopUp")}
          onClick={() => handleTopUp(customMinor)}
          disabled={!canTopUp || customMinor < 1000 || customMinor > 1_000_000}
          size="sm"
        >
          {topUp.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Transaction History Toggle */}
      <Button
        variant="ghost"
        size="sm"
        className="w-full"
        onClick={() => setShowHistory(!showHistory)}
      >
        <History className="h-4 w-4 mr-2" />
        {t("wallet.history")}
      </Button>

      {/* Transaction History */}
      {showHistory && transactionQuery.isError && (
        <div role="alert">
          {l(
            "تعذّر تحميل حركات المحفظة",
            "Wallet transactions could not be loaded"
          )}
          <Button
            variant="outline"
            onClick={() => void transactionQuery.refetch()}
          >
            {l("إعادة المحاولة", "Retry")}
          </Button>
        </div>
      )}
      {showHistory && transactionQuery.isLoading && (
        <p role="status">{t("common.loading")}</p>
      )}
      {showHistory && !transactionQuery.isError && transactions && (
        <>
          <Separator className="my-3" />
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {transactions.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-4">
                {t("wallet.noTransactions")}
              </p>
            ) : (
              transactions.slice(0, pageSize).map(tx => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    {tx.type === "top_up" ||
                    tx.type === "refund" ||
                    tx.type === "bonus" ? (
                      <ArrowUpCircle className="h-4 w-4 text-green-500" />
                    ) : tx.type === "payment" || tx.type === "withdrawal" ? (
                      <ArrowDownCircle className="h-4 w-4 text-red-500" />
                    ) : (
                      <RotateCcw className="h-4 w-4 text-blue-500" />
                    )}
                    <div>
                      <p className="text-sm">{tx.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(tx.createdAt).toLocaleDateString()} ·{" "}
                        {t(`paymentHistory.${tx.status}`)}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-sm font-medium ${
                      tx.amount > 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {tx.amount > 0 ? "+" : ""}
                    {(tx.amount / 100).toFixed(2)}
                  </span>
                </div>
              ))
            )}
          </div>
          {(offset > 0 || transactions.length > pageSize) && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={offset === 0}
                onClick={() => setOffset(offset - pageSize)}
              >
                {t("common.previous")}
              </Button>
              <Button
                variant="outline"
                disabled={transactions.length <= pageSize}
                onClick={() => setOffset(offset + pageSize)}
              >
                {t("common.next")}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
