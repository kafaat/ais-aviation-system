import { useState } from "react";
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
  const [customAmount, setCustomAmount] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const utils = trpc.useUtils();

  const { data: balance, isLoading } = trpc.wallet.balance.useQuery(undefined, {
    retry: false,
  });

  const { data: transactions } = trpc.wallet.transactions.useQuery(
    { limit: 10 },
    { enabled: showHistory, retry: false }
  );

  const topUp = trpc.wallet.topUp.useMutation({
    onSuccess: data => {
      toast.success(
        t("wallet.topUpSuccess", {
          amount: (data.transactionAmount / 100).toFixed(0),
        })
      );
      utils.wallet.balance.invalidate();
      utils.wallet.transactions.invalidate();
      setCustomAmount("");
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const handleTopUp = (amountCents: number) => {
    topUp.mutate({ amount: amountCents });
  };

  if (isLoading) {
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
          {((balance?.balance || 0) / 100).toFixed(2)} {t("common.sar")}
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
            disabled={topUp.isPending}
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
          className="flex-1"
        />
        <Button
          onClick={() => handleTopUp(parseInt(customAmount) * 100)}
          disabled={
            !customAmount || parseInt(customAmount) < 10 || topUp.isPending
          }
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
      {showHistory && transactions && (
        <>
          <Separator className="my-3" />
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {transactions.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-4">
                {t("wallet.noTransactions")}
              </p>
            ) : (
              transactions.map(tx => (
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
                        {new Date(tx.createdAt).toLocaleDateString()}
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
        </>
      )}
    </Card>
  );
}
