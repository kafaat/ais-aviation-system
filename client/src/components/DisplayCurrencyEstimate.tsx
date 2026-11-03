import { useEffect } from "react";
import {
  readSearchPreferences as searchPreferences,
  rememberDisplayPreferences,
} from "@/lib/ibe-display-context";
import { useRawSearch } from "@/lib/useRawSearch";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { displayEstimate } from "@/lib/display-money";

/** A secondary estimate; callers retain the authoritative SAR price. */
export function DisplayCurrencyEstimate({
  amountMinor,
}: {
  amountMinor: number;
}) {
  const preferences = searchPreferences(useRawSearch());
  const { currency, country } = preferences;
  useEffect(() => {
    rememberDisplayPreferences(preferences);
  }, [currency, country]);
  if (currency === "SAR") return null;
  return (
    <Estimate amountMinor={amountMinor} currency={currency} country={country} />
  );
}

function Estimate({
  amountMinor,
  currency,
  country,
}: {
  amountMinor: number;
  currency: string;
  country: string;
}) {
  const { t, i18n } = useTranslation();
  const rate = trpc.pricing.getExchangeRate.useQuery(
    { fromCurrency: "SAR", toCurrency: currency },
    {
      staleTime: 60_000,
      retry: false,
    }
  );
  const estimate = displayEstimate(amountMinor, currency, rate.data?.data);
  return (
    <span
      className="block text-xs font-normal text-muted-foreground"
      data-testid="display-currency-estimate"
    >
      {estimate === null
        ? t("ibe.rateUnavailable", { currency })
        : t("ibe.estimate", {
            amount: new Intl.NumberFormat(
              `${i18n.language === "ar" ? "ar" : "en"}-${country}`,
              { style: "currency", currency }
            ).format(estimate),
          })}
    </span>
  );
}
