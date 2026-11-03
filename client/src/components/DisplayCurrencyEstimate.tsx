import { useEffect } from "react";
import {
  readSearchPreferences as searchPreferences,
  rememberDisplayPreferences,
} from "@/lib/ibe-display-context";
import type { DisplayCurrency } from "@shared/ibe-search";
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
  currency: DisplayCurrency;
  country: string;
}) {
  const { t, i18n } = useTranslation();
  const rate = trpc.ibePublic.displayRate.useQuery(
    { currency },
    {
      // React Query marks the quote stale at its effective expiry, even on an idle page.
      staleTime: ({ state }) =>
        state.data
          ? Math.max(0, state.data.expiresAt.getTime() - state.dataUpdatedAt)
          : 60_000,
      refetchInterval: 60_000,
      retry: false,
    }
  );
  const estimate =
    rate.isStale || rate.isError
      ? null
      : displayEstimate(amountMinor, currency, rate.data);
  if (rate.isPending) return null;
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
