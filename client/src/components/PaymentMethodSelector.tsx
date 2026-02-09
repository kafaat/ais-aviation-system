import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CreditCard, Wallet, Smartphone, Globe, Landmark } from "lucide-react";

interface PaymentMethodSelectorProps {
  onProviderSelect: (providerId: string) => void;
  selectedProvider?: string;
  amount?: number; // in SAR cents
}

const providerIcons: Record<string, React.ReactNode> = {
  stripe: <CreditCard className="h-5 w-5" />,
  hyperpay: <Landmark className="h-5 w-5" />,
  tabby: <Wallet className="h-5 w-5" />,
  tamara: <Wallet className="h-5 w-5" />,
  stc_pay: <Smartphone className="h-5 w-5" />,
  moyasar: <CreditCard className="h-5 w-5" />,
  floosak: <Smartphone className="h-5 w-5" />,
  jawali: <Smartphone className="h-5 w-5" />,
  onecash: <Wallet className="h-5 w-5" />,
  easycash: <Wallet className="h-5 w-5" />,
};

const regionLabels: Record<string, { en: string; ar: string }> = {
  international: { en: "International", ar: "دولي" },
  saudi: { en: "Saudi Arabia", ar: "السعودية" },
  yemen: { en: "Yemen", ar: "اليمن" },
  mena: { en: "MENA Region", ar: "الشرق الأوسط" },
};

export function PaymentMethodSelector({
  onProviderSelect,
  selectedProvider = "stripe",
  amount,
}: PaymentMethodSelectorProps) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const [selected, setSelected] = useState(selectedProvider);

  const { data: providers, isLoading } = trpc.payments.getProviders.useQuery(
    { includeUnavailable: true },
    { staleTime: 60000 }
  );

  const handleSelect = (value: string) => {
    setSelected(value);
    onProviderSelect(value);
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-40" />
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!providers || providers.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-4 border rounded-lg text-center">
        {t("payment.noProvidersAvailable")}
      </div>
    );
  }

  // Group providers by region
  const grouped = providers.reduce(
    (acc, provider) => {
      const region = provider.region;
      if (!acc[region]) acc[region] = [];
      acc[region].push(provider);
      return acc;
    },
    {} as Record<string, typeof providers>
  );

  // Order: international first, then saudi, mena, yemen
  const regionOrder = ["international", "saudi", "mena", "yemen"];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">
        {t("payment.selectPaymentMethod")}
      </h3>

      <RadioGroup value={selected} onValueChange={handleSelect}>
        {regionOrder.map(region => {
          const regionProviders = grouped[region];
          if (!regionProviders || regionProviders.length === 0) return null;

          return (
            <div key={region} className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {isAr ? regionLabels[region]?.ar : regionLabels[region]?.en}
              </p>

              {regionProviders.map(provider => {
                const isDisabled = !provider.enabled;
                const isAmountOutOfRange =
                  amount !== undefined &&
                  (amount < provider.minAmount || amount > provider.maxAmount);

                return (
                  <div key={provider.id}>
                    <Label
                      htmlFor={`provider-${provider.id}`}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        selected === provider.id
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:bg-accent/50"
                      } ${isDisabled || isAmountOutOfRange ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <RadioGroupItem
                        value={provider.id}
                        id={`provider-${provider.id}`}
                        disabled={isDisabled || isAmountOutOfRange}
                      />

                      <div className="flex items-center gap-2 text-muted-foreground">
                        {providerIcons[provider.id] || (
                          <Globe className="h-5 w-5" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {isAr ? provider.nameAr : provider.name}
                          </span>
                          {provider.supportsBNPL && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0"
                            >
                              {t("payment.bnpl")}
                            </Badge>
                          )}
                        </div>
                        {isDisabled && (
                          <p className="text-xs text-muted-foreground">
                            {t("payment.providerNotConfigured")}
                          </p>
                        )}
                        {isAmountOutOfRange && !isDisabled && (
                          <p className="text-xs text-destructive">
                            {t("payment.amountOutOfRange", {
                              min: (provider.minAmount / 100).toFixed(0),
                              max: (provider.maxAmount / 100).toFixed(0),
                            })}
                          </p>
                        )}
                      </div>
                    </Label>
                  </div>
                );
              })}
            </div>
          );
        })}
      </RadioGroup>
    </div>
  );
}
