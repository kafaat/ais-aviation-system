/**
 * SplitPaymentForm Component
 *
 * Allows users to divide a booking payment among multiple payers.
 * Each payer will receive an email with a payment link.
 */

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
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
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  Trash2,
  Users,
  Mail,
  AlertCircle,
  Check,
  Loader2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface Payer {
  id: string;
  email: string;
  name: string;
  amount: number;
  percentage: number;
}

interface SplitPaymentFormProps {
  bookingId: number;
  totalAmount: number; // Amount in cents (SAR)
  bookingReference: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

const generateId = () => Math.random().toString(36).substring(2, 11);

export function SplitPaymentForm({
  bookingId,
  totalAmount,
  bookingReference,
  onSuccess,
  onCancel,
}: SplitPaymentFormProps) {
  const { t } = useTranslation();

  // Initialize with 2 payers
  const [payers, setPayers] = useState<Payer[]>([
    {
      id: generateId(),
      email: "",
      name: "",
      amount: Math.floor(totalAmount / 2),
      percentage: 50,
    },
    {
      id: generateId(),
      email: "",
      name: "",
      amount: totalAmount - Math.floor(totalAmount / 2),
      percentage: 50,
    },
  ]);
  const [equalSplit, setEqualSplit] = useState(true);

  const initiateMutation = trpc.splitPayments.initiate.useMutation({
    onSuccess: () => {
      toast.success(t("splitPayment.initiateSuccess"));
      onSuccess?.();
    },
    onError: error => {
      toast.error(error.message || t("splitPayment.initiateError"));
    },
  });

  // Calculate remaining amount
  const allocatedAmount = payers.reduce((sum, p) => sum + p.amount, 0);
  const remainingAmount = totalAmount - allocatedAmount;
  const isValid =
    remainingAmount === 0 &&
    payers.every(p => p.email && p.name && p.amount > 0);

  // Add a new payer
  const addPayer = useCallback(() => {
    if (payers.length >= 10) return; // Max 10 payers

    const newPayer: Payer = {
      id: generateId(),
      email: "",
      name: "",
      amount: 0,
      percentage: 0,
    };

    setPayers([...payers, newPayer]);
    setEqualSplit(false);
  }, [payers]);

  // Remove a payer
  const removePayer = useCallback(
    (id: string) => {
      if (payers.length <= 2) return; // Min 2 payers
      setPayers(payers.filter(p => p.id !== id));
      setEqualSplit(false);
    },
    [payers]
  );

  // Update payer field
  const updatePayer = useCallback(
    (id: string, field: keyof Payer, value: string | number) => {
      setPayers(prev =>
        prev.map(p => {
          if (p.id !== id) return p;

          if (field === "amount") {
            const amount = Math.max(0, Math.min(Number(value), totalAmount));
            return { ...p, amount, percentage: (amount / totalAmount) * 100 };
          }

          return { ...p, [field]: value };
        })
      );

      if (field === "amount") {
        setEqualSplit(false);
      }
    },
    [totalAmount]
  );

  // Split equally among all payers
  const splitEqually = useCallback(() => {
    const count = payers.length;
    const baseAmount = Math.floor(totalAmount / count);
    const remainder = totalAmount - baseAmount * count;

    setPayers(prev =>
      prev.map((p, idx) => ({
        ...p,
        amount: baseAmount + (idx === 0 ? remainder : 0),
        percentage: 100 / count,
      }))
    );
    setEqualSplit(true);
  }, [payers.length, totalAmount]);

  // Handle amount slider change
  const handleSliderChange = useCallback(
    (id: string, value: number[]) => {
      const percentage = value[0];
      const amount = Math.round((percentage / 100) * totalAmount);
      updatePayer(id, "amount", amount);
    },
    [totalAmount, updatePayer]
  );

  // Submit the split payment
  const handleSubmit = () => {
    if (!isValid) return;

    initiateMutation.mutate({
      bookingId,
      splits: payers.map(p => ({
        email: p.email,
        name: p.name,
        amount: p.amount,
      })),
    });
  };

  const formatAmount = (amount: number) => {
    return `${(amount / 100).toFixed(2)} ${t("common.currency")}`;
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <CardTitle>{t("splitPayment.title")}</CardTitle>
        </div>
        <CardDescription>{t("splitPayment.description")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Booking Summary */}
        <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
          <div>
            <p className="text-sm text-muted-foreground">
              {t("splitPayment.bookingRef")}
            </p>
            <p className="font-semibold">{bookingReference}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">
              {t("splitPayment.totalAmount")}
            </p>
            <p className="text-xl font-bold text-primary">
              {formatAmount(totalAmount)}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={splitEqually}
            disabled={initiateMutation.isPending}
          >
            <Check className="h-4 w-4 mr-2" />
            {t("splitPayment.splitEqually")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={addPayer}
            disabled={payers.length >= 10 || initiateMutation.isPending}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t("splitPayment.addPayer")}
          </Button>
        </div>

        <Separator />

        {/* Payers List */}
        <div className="space-y-4">
          {payers.map((payer, index) => (
            <div
              key={payer.id}
              className="p-4 border rounded-lg space-y-4 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{index + 1}</Badge>
                  <span className="font-medium">
                    {t("splitPayment.payer")} {index + 1}
                  </span>
                </div>
                {payers.length > 2 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removePayer(payer.id)}
                    disabled={initiateMutation.isPending}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`name-${payer.id}`}>
                    {t("splitPayment.payerName")}
                  </Label>
                  <Input
                    id={`name-${payer.id}`}
                    value={payer.name}
                    onChange={e =>
                      updatePayer(payer.id, "name", e.target.value)
                    }
                    placeholder={t("splitPayment.payerNamePlaceholder")}
                    disabled={initiateMutation.isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`email-${payer.id}`}>
                    {t("splitPayment.payerEmail")}
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id={`email-${payer.id}`}
                      type="email"
                      value={payer.email}
                      onChange={e =>
                        updatePayer(payer.id, "email", e.target.value)
                      }
                      placeholder={t("splitPayment.payerEmailPlaceholder")}
                      className="pl-10"
                      disabled={initiateMutation.isPending}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t("splitPayment.amount")}</Label>
                  <span className="text-sm text-muted-foreground">
                    {payer.percentage.toFixed(1)}%
                  </span>
                </div>
                <Slider
                  value={[(payer.amount / totalAmount) * 100]}
                  onValueChange={value => handleSliderChange(payer.id, value)}
                  max={100}
                  step={1}
                  disabled={initiateMutation.isPending}
                />
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={(payer.amount / 100).toFixed(2)}
                    onChange={e =>
                      updatePayer(
                        payer.id,
                        "amount",
                        Math.round(parseFloat(e.target.value || "0") * 100)
                      )
                    }
                    className="w-32"
                    disabled={initiateMutation.isPending}
                  />
                  <span className="text-sm text-muted-foreground">
                    {t("common.currency")}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="p-4 bg-muted rounded-lg space-y-2">
          <div className="flex justify-between text-sm">
            <span>{t("splitPayment.allocated")}</span>
            <span className="font-medium">{formatAmount(allocatedAmount)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>{t("splitPayment.remaining")}</span>
            <span
              className={`font-medium ${remainingAmount !== 0 ? "text-destructive" : "text-green-600"}`}
            >
              {formatAmount(remainingAmount)}
            </span>
          </div>
        </div>

        {/* Validation Error */}
        {remainingAmount !== 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {remainingAmount > 0
                ? t("splitPayment.underallocated", {
                    amount: formatAmount(remainingAmount),
                  })
                : t("splitPayment.overallocated", {
                    amount: formatAmount(Math.abs(remainingAmount)),
                  })}
            </AlertDescription>
          </Alert>
        )}

        {/* Info */}
        <Alert>
          <Mail className="h-4 w-4" />
          <AlertDescription>{t("splitPayment.emailNotice")}</AlertDescription>
        </Alert>

        {/* Actions */}
        <div className="flex gap-3 pt-4">
          {onCancel && (
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={initiateMutation.isPending}
              className="flex-1"
            >
              {t("common.cancel")}
            </Button>
          )}
          <Button
            onClick={handleSubmit}
            disabled={!isValid || initiateMutation.isPending}
            className="flex-1"
          >
            {initiateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("splitPayment.processing")}
              </>
            ) : (
              <>
                <Mail className="h-4 w-4 mr-2" />
                {t("splitPayment.sendRequests")}
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default SplitPaymentForm;
