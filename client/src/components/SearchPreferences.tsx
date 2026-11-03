import { useTranslation } from "react-i18next";
import {
  DISPLAY_COUNTRIES,
  DISPLAY_CURRENCIES,
  validTravelerCounts,
  type SearchPreferences as Preferences,
} from "@shared/ibe-search";

export function SearchPreferences({
  value,
  onChange,
}: {
  value: Preferences;
  onChange: (value: Preferences) => void;
}) {
  const { t, i18n } = useTranslation();
  const names = new Intl.DisplayNames([i18n.language === "ar" ? "ar" : "en"], {
    type: "region",
  });
  return (
    <fieldset className="space-y-2 mb-6">
      <legend className="text-sm font-medium mb-2">
        {t("ibe.searchPreferences")}
      </legend>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(["adults", "children", "infants"] as const).map(key => (
          <label key={key} className="text-sm space-y-1">
            <span className="block">{t(`ibe.${key}`)}</span>
            <select
              aria-label={t(`ibe.${key}`)}
              className="w-full h-10 rounded-md border bg-background px-2"
              value={value[key]}
              onChange={event =>
                onChange({ ...value, [key]: Number(event.target.value) })
              }
            >
              {Array.from(
                { length: 9 },
                (_, index) => index + (key === "adults" ? 1 : 0)
              ).map(count => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="text-sm space-y-1">
          <span className="block">{t("ibe.country")}</span>
          <select
            aria-label={t("ibe.country")}
            className="w-full h-10 rounded-md border bg-background px-2"
            value={value.country}
            onChange={event =>
              onChange({
                ...value,
                country: event.target.value as Preferences["country"],
              })
            }
          >
            {DISPLAY_COUNTRIES.map(country => (
              <option key={country} value={country}>
                {names.of(country)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm space-y-1">
          <span className="block">{t("ibe.displayCurrency")}</span>
          <select
            aria-label={t("ibe.displayCurrency")}
            className="w-full h-10 rounded-md border bg-background px-2"
            value={value.currency}
            onChange={event =>
              onChange({
                ...value,
                currency: event.target.value as Preferences["currency"],
              })
            }
          >
            {DISPLAY_CURRENCIES.map(currency => (
              <option key={currency}>{currency}</option>
            ))}
          </select>
        </label>
      </div>
      {!validTravelerCounts(value) && (
        <p role="alert" className="text-sm text-destructive">
          {t("ibe.passengerLimit")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{t("ibe.currencyHelp")}</p>
    </fieldset>
  );
}
