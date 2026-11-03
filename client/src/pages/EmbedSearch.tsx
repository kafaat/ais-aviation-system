import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useRawSearch } from "@/lib/useRawSearch";
import { BrandIdentity } from "@/components/BrandIdentity";
import { Button } from "@/components/ui/button";
import {
  DISPLAY_COUNTRIES,
  DISPLAY_CURRENCIES,
  isCivilDay,
  searchPreferences,
  validTravelerCounts,
  type DisplayCountry,
  type DisplayCurrency,
} from "@shared/ibe-search";

const copy = {
  en: {
    title: "Find a flight",
    from: "From",
    to: "To",
    choose: "Choose an airport",
    date: "Departure date",
    adults: "Adults",
    children: "Children",
    infants: "Infants",
    currency: "Display currency",
    country: "Display region",
    search: "Search flights",
    open: "Open flight search",
    loading: "Loading flight search…",
    unavailable: "Flight search is currently unavailable.",
    invalid:
      "Choose different airports, a valid date and between one and nine travelers.",
  },
  ar: {
    title: "ابحث عن رحلة",
    from: "من",
    to: "إلى",
    choose: "اختر مطارًا",
    date: "تاريخ المغادرة",
    adults: "البالغون",
    children: "الأطفال",
    infants: "الرضع",
    currency: "عملة العرض",
    country: "منطقة العرض",
    search: "بحث الرحلات",
    open: "فتح بحث الرحلات",
    loading: "جارٍ تحميل البحث…",
    unavailable: "بحث الرحلات غير متاح حاليًا.",
    invalid:
      "اختر مطارين مختلفين وتاريخًا صحيحًا ومن مسافر واحد إلى تسعة مسافرين.",
  },
};

/** Search-only document: native user-activated submission leaves the iframe. */
export default function EmbedSearch() {
  const { i18n } = useTranslation();
  const labels = copy[i18n.language.startsWith("ar") ? "ar" : "en"];
  const query = useRawSearch();
  const initial = new URLSearchParams(query);
  const [preferences, setPreferences] = useState(() =>
    searchPreferences(query)
  );
  const [origin, setOrigin] = useState(initial.get("origin") ?? "");
  const [destination, setDestination] = useState(
    initial.get("destination") ?? ""
  );
  const [date, setDate] = useState(initial.get("date") ?? "");
  const [error, setError] = useState(false);
  const config = trpc.ibePublic.config.useQuery(undefined, {
    staleTime: 300_000,
    retry: false,
  });
  const airports = trpc.reference.airports.useQuery(undefined, {
    enabled: config.data?.embedSearchEnabled === true,
    retry: false,
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    const known = (id: string) =>
      /^[1-9]\d*$/.test(id) &&
      airports.data?.some(airport => airport.id === Number(id));
    if (
      !known(origin) ||
      !known(destination) ||
      origin === destination ||
      !isCivilDay(date) ||
      !validTravelerCounts(preferences)
    ) {
      event.preventDefault();
      setError(true);
    }
  };
  const fieldClass = "w-full rounded-md border bg-background px-3 py-2";
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6" id="main-content">
      <BrandIdentity className="mb-4" />
      <h1 className="mb-4 text-xl font-semibold">{labels.title}</h1>
      {config.isLoading ? (
        <p role="status">{labels.loading}</p>
      ) : !config.data?.embedSearchEnabled || config.isError ? (
        <a href="/" target="_top" className="underline">
          {labels.open}
        </a>
      ) : airports.isError ? (
        <div role="alert">
          <p>{labels.unavailable}</p>
          <a href="/" target="_top" className="underline">
            {labels.open}
          </a>
        </div>
      ) : (
        <form
          action="/search"
          method="get"
          target="_top"
          onSubmit={submit}
          aria-label={labels.title}
          className="space-y-4"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <label>
              {labels.from}
              <select
                name="origin"
                value={origin}
                onChange={event => setOrigin(event.target.value)}
                required
                className={fieldClass}
              >
                <option value="">{labels.choose}</option>
                {airports.data?.map(airport => (
                  <option key={airport.id} value={airport.id}>
                    {airport.city} ({airport.code})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {labels.to}
              <select
                name="destination"
                value={destination}
                onChange={event => setDestination(event.target.value)}
                required
                className={fieldClass}
              >
                <option value="">{labels.choose}</option>
                {airports.data?.map(airport => (
                  <option key={airport.id} value={airport.id}>
                    {airport.city} ({airport.code})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {labels.date}
              <input
                type="date"
                name="date"
                value={date}
                onChange={event => setDate(event.target.value)}
                required
                className={fieldClass}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(["adults", "children", "infants"] as const).map(kind => (
              <label key={kind}>
                {labels[kind]}
                <input
                  type="number"
                  name={kind}
                  value={preferences[kind]}
                  min={kind === "adults" ? 1 : 0}
                  max={9}
                  required
                  className={fieldClass}
                  onChange={event =>
                    setPreferences(current => ({
                      ...current,
                      [kind]: Number(event.target.value),
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              {labels.currency}
              <select
                name="currency"
                value={preferences.currency}
                className={fieldClass}
                onChange={event =>
                  setPreferences(current => ({
                    ...current,
                    currency: event.target.value as DisplayCurrency,
                  }))
                }
              >
                {DISPLAY_CURRENCIES.map(currency => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
            </label>
            <label>
              {labels.country}
              <select
                name="country"
                value={preferences.country}
                className={fieldClass}
                onChange={event =>
                  setPreferences(current => ({
                    ...current,
                    country: event.target.value as DisplayCountry,
                  }))
                }
              >
                {DISPLAY_COUNTRIES.map(country => (
                  <option key={country}>{country}</option>
                ))}
              </select>
            </label>
          </div>
          {error && <p role="alert">{labels.invalid}</p>}
          <Button
            type="submit"
            disabled={airports.isLoading || !airports.data?.length}
          >
            {labels.search}
          </Button>
        </form>
      )}
    </main>
  );
}
