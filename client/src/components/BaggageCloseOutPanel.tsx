import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Luggage, RefreshCw } from "lucide-react";

const DAY = 86400000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * DCS baggage close-out (IATA Resolution 753): bags accepted but not loaded,
 * bags loaded for passengers not boarded and boarded passengers with
 * unloaded bags, plus the mishandled-bag proxy per 1,000 passengers.
 */
export function BaggageCloseOutPanel() {
  const { t } = useTranslation();
  const [flightId, setFlightId] = useState("");
  const parsedFlightId = flightId ? parseInt(flightId, 10) : 0;
  const closeOut = trpc.dcs.getBaggageCloseOut.useQuery(
    { flightId: parsedFlightId },
    { enabled: parsedFlightId > 0 }
  );
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 30 * DAY)));
  const [to, setTo] = useState(isoDay(new Date()));
  const kpi = trpc.dcs.getBaggageMishandlingKpi.useQuery(
    {
      from: new Date(`${from}T00:00:00Z`).toISOString(),
      to: new Date(`${to}T23:59:59Z`).toISOString(),
    },
    { enabled: Boolean(from && to) && from <= to }
  );
  const data = closeOut.data;

  const bagRows = (
    bags: NonNullable<typeof data>["acceptedNotLoaded"],
    empty: string
  ) =>
    bags.length === 0 ? (
      <p className="text-sm text-muted-foreground">{empty}</p>
    ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1">{t("baggage.tracking.licensePlate")}</th>
            <th className="py-1">{t("baggage.passenger")}</th>
            <th className="py-1">PNR</th>
            <th className="py-1">{t("baggage.tracking.container")}</th>
          </tr>
        </thead>
        <tbody>
          {bags.map(bag => (
            <tr key={bag.baggageId} className="border-t">
              <td className="py-1 font-mono">
                {bag.licensePlate ?? bag.tagNumber}
                {!bag.trackedOnFlight && (
                  <Badge variant="outline" className="ms-2">
                    {t("dcs.baggage.untracked", "No tracking event")}
                  </Badge>
                )}
              </td>
              <td className="py-1">{bag.passengerSurname}</td>
              <td className="py-1 font-mono">{bag.pnr}</td>
              <td className="py-1">{bag.containerId ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );

  return (
    <div className="space-y-6" data-testid="baggage-close-out">
      <Card className="p-4">
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <Label>{t("dcs.manifest.flightId", "Flight ID")}</Label>
            <Input
              type="number"
              value={flightId}
              onChange={e => setFlightId(e.target.value)}
              placeholder={t("dcs.manifest.enterFlightId", "Enter flight ID")}
            />
          </div>
          <Button onClick={() => closeOut.refetch()} disabled={!parsedFlightId}>
            <Luggage className="h-4 w-4 me-2" />
            {t("dcs.baggage.reconcile", "Reconcile baggage")}
          </Button>
        </div>
      </Card>

      {closeOut.isLoading && parsedFlightId > 0 && (
        <Card className="p-6 animate-pulse">
          <div className="h-32 bg-muted rounded" />
        </Card>
      )}
      {closeOut.error && (
        <Card className="p-4 border-red-200 bg-red-50 text-sm text-red-700">
          {closeOut.error.message}
        </Card>
      )}

      {data && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">
                  {data.flight.flightNumber} · {data.flight.originCode} →{" "}
                  {data.flight.destinationCode}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(data.flight.departureTime).toISOString()} UTC
                </p>
              </div>
              <div className="flex gap-4 text-sm">
                <span>
                  {t("dcs.baggage.bags", "Bags")}: {data.totals.bags}
                </span>
                <span>
                  {t("dcs.baggage.accepted", "Accepted")}:{" "}
                  {data.totals.accepted}
                </span>
                <span>
                  {t("dcs.baggage.loaded", "Loaded")}: {data.totals.loaded}
                </span>
                <span>
                  {t("dcs.baggage.passengers", "Passengers")}:{" "}
                  {data.totals.passengers}
                </span>
              </div>
            </div>
          </Card>

          <Card className="p-4 space-y-2">
            <h3 className="font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              {t(
                "dcs.baggage.acceptedNotLoaded",
                "Accepted, not loaded (offload candidates)"
              )}{" "}
              <Badge variant="secondary">{data.acceptedNotLoaded.length}</Badge>
            </h3>
            {bagRows(data.acceptedNotLoaded, t("dcs.baggage.none", "None"))}
          </Card>

          <Card className="p-4 space-y-2">
            <h3 className="font-semibold">
              {t(
                "dcs.baggage.loadedForNotBoarded",
                "Loaded for passengers not boarded (must offload)"
              )}
            </h3>
            {data.loadedForNotBoarded === null ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  "dcs.baggage.noBoardingRecord",
                  "No per-passenger boarding record is available to this DCS; this set is not computed rather than shown as clear."
                )}
              </p>
            ) : (
              bagRows(data.loadedForNotBoarded, t("dcs.baggage.none", "None"))
            )}
          </Card>

          <Card className="p-4 space-y-2">
            <h3 className="font-semibold">
              {t(
                "dcs.baggage.boardedWithoutBags",
                "Boarded passengers with unloaded bags"
              )}
            </h3>
            {data.boardedWithoutLoadedBags === null ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  "dcs.baggage.noBoardingRecord",
                  "No per-passenger boarding record is available to this DCS; this set is not computed rather than shown as clear."
                )}
              </p>
            ) : data.boardedWithoutLoadedBags.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("dcs.baggage.none", "None")}
              </p>
            ) : (
              <ul className="text-sm space-y-1">
                {data.boardedWithoutLoadedBags.map(p => (
                  <li key={p.passengerId}>
                    {p.surname}, {p.givenName} ·{" "}
                    <span className="font-mono">{p.pnr}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <Label>{t("dcs.baggage.from", "From")}</Label>
            <Input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
            />
          </div>
          <div>
            <Label>{t("dcs.baggage.to", "To")}</Label>
            <Input
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={() => kpi.refetch()}>
            <RefreshCw className="h-4 w-4 me-2" />
            {t("common.refresh")}
          </Button>
        </div>
        {kpi.data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">
                {t(
                  "dcs.baggage.kpi",
                  "Bags without arrival per 1,000 passengers"
                )}
              </p>
              <p className="text-3xl font-bold">
                {kpi.data.perThousandPassengers ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("dcs.baggage.benchmark", "SITA 2025 global")}:{" "}
                {kpi.data.benchmarks.sita2025GlobalPerThousand} · MEA 2024:{" "}
                {kpi.data.benchmarks.sita2024MiddleEastAfricaPerThousand}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {t("dcs.baggage.flightsDue", "Flights past window")}
              </p>
              <p className="text-3xl font-bold">{kpi.data.flights.length}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {t("dcs.baggage.tracked", "Tracked bags")}
              </p>
              <p className="text-3xl font-bold">{kpi.data.bagsTracked}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {t("dcs.baggage.withoutArrival", "Without arrival")}
              </p>
              <p className="text-3xl font-bold">
                {kpi.data.bagsWithoutArrival}
              </p>
            </div>
            <p className="col-span-full text-xs text-muted-foreground">
              {kpi.data.method}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
