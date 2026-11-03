import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/SiteFooter";
import { formatFlightDate, formatFlightTime } from "@/lib/flight-time";
import { trpc } from "@/lib/trpc";

export default function CodeshareFlights() {
  const { t, i18n } = useTranslation();
  const [airlineId, setAirlineId] = useState(0);
  const carriers = trpc.reference.airlines.useQuery();
  const flights = trpc.codeshare.getCodeshareFlights.useQuery(
    { airlineId },
    { enabled: airlineId > 0 }
  );
  return (
    <>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-3xl space-y-5 px-4 py-12"
      >
        <Link href="/" className="underline">
          {t("nav.home")}
        </Link>
        <h1 className="text-3xl font-bold">
          {t("codeshare.codeshareFlights")}
        </h1>
        <p>{t("codeshare.browseDescription")}</p>
        <label htmlFor="marketing-carrier" className="block font-medium">
          {t("codeshare.marketingAirline")}
        </label>
        <select
          id="marketing-carrier"
          className="w-full rounded-md border bg-background p-2"
          value={airlineId}
          onChange={event => setAirlineId(Number(event.target.value))}
          disabled={!carriers.data?.length}
        >
          <option value={0}>{t("codeshare.selectCarrier")}</option>
          {carriers.data?.map(carrier => (
            <option key={carrier.id} value={carrier.id}>
              {carrier.name} ({carrier.code})
            </option>
          ))}
        </select>
        {(carriers.isLoading || (airlineId > 0 && flights.isLoading)) && (
          <p role="status">{t("common.loading")}</p>
        )}
        {(carriers.isError || flights.isError) && (
          <div role="alert">
            <p>
              {t(
                carriers.isError
                  ? "codeshare.carrierReadError"
                  : "codeshare.flightReadError"
              )}
            </p>
            <Button
              variant="outline"
              onClick={() =>
                void (carriers.isError ? carriers.refetch() : flights.refetch())
              }
            >
              {t("common.retry")}
            </Button>
          </div>
        )}
        {flights.isSuccess && flights.data.data.length === 0 && (
          <p role="status">{t("codeshare.noFlights")}</p>
        )}
        {flights.isSuccess && flights.data.data.length > 0 && (
          <ul className="space-y-3">
            {flights.data.data.map(flight => (
              <li
                key={flight.flightId}
                className="space-y-1 rounded-lg border p-4"
              >
                <h2 className="font-semibold">{flight.flightNumber}</h2>
                <p>
                  <bdi>
                    {flight.origin.code} → {flight.destination.code}
                  </bdi>
                </p>
                <p>
                  {t("codeshare.operatingAirline")}:{" "}
                  {flight.operatingAirline.name} ({flight.operatingAirline.code}
                  )
                </p>
                <p>
                  {t("codeshare.departureUtc")}:{" "}
                  <time dateTime={flight.departureTime.toISOString()}>
                    {formatFlightDate(
                      flight.departureTime,
                      "UTC",
                      i18n.language
                    )}{" "}
                    {formatFlightTime(
                      flight.departureTime,
                      "UTC",
                      i18n.language
                    )}
                  </time>
                </p>
              </li>
            ))}
          </ul>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
