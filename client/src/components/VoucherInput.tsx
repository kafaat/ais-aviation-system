import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Ticket, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface VoucherInputProps {
  amount: number;
  onVoucherApplied: (discount: number, code: string) => void;
  onVoucherRemoved: () => void;
  appliedVoucher?: { code: string; discount: number } | null;
  className?: string;
  disabled?: boolean;
}

export function VoucherInput({
  amount,
  onVoucherApplied,
  onVoucherRemoved,
  appliedVoucher,
  className,
  disabled = false,
}: VoucherInputProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [isValidating, setIsValidating] = useState(false);

  const validateMutation = trpc.vouchers.validate.useMutation({
    onSuccess: data => {
      if (data.valid) {
        onVoucherApplied(data.discountAmount, data.voucher.code);
        toast.success(
          t("voucher.applied", {
            amount: (data.discountAmount / 100).toFixed(2),
          })
        );
        setCode("");
      }
    },
    onError: error => {
      toast.error(error.message);
    },
    onSettled: () => {
      setIsValidating(false);
    },
  });

  const handleApply = () => {
    if (!code.trim()) {
      toast.error(t("voucher.enterCode"));
      return;
    }

    setIsValidating(true);
    validateMutation.mutate({ code: code.trim(), amount });
  };

  const handleRemove = () => {
    onVoucherRemoved();
    toast.info(t("voucher.removed"));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !disabled && !isValidating && !appliedVoucher) {
      e.preventDefault();
      handleApply();
    }
  };

  if (appliedVoucher) {
    return (
      <div className={cn("space-y-2", className)}>
        <Label className="text-sm font-medium">{t("voucher.title")}</Label>
        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-green-600" />
            <Badge variant="secondary" className="font-mono">
              {appliedVoucher.code}
            </Badge>
            <span className="text-sm text-green-700 dark:text-green-300">
              -{(appliedVoucher.discount / 100).toFixed(2)} {t("common.sar")}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={disabled}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">{t("voucher.remove")}</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor="voucher-code" className="text-sm font-medium">
        {t("voucher.title")}
      </Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Ticket className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="voucher-code"
            type="text"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            placeholder={t("voucher.placeholder")}
            className="pl-10 uppercase"
            disabled={disabled || isValidating}
            maxLength={50}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleApply}
          disabled={disabled || isValidating || !code.trim()}
        >
          {isValidating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("common.validating")}
            </>
          ) : (
            t("voucher.apply")
          )}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("voucher.hint")}</p>
    </div>
  );
}
