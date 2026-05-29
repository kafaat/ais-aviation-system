import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plane, Ticket, Cpu, TrendingUp } from "lucide-react";

/** Format SAR cents → "1,234.56". */
function money(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      {hint && (
        <CardContent className="pt-0 text-xs text-muted-foreground">
          {hint}
        </CardContent>
      )}
    </Card>
  );
}

export default function SeatEconomics() {
  const { t } = useTranslation();

  const [flightInput, setFlightInput] = useState("");
  const [flightId, setFlightId] = useState<number | null>(null);
  const [bookingInput, setBookingInput] = useState("");
  const [bookingId, setBookingId] = useState<number | null>(null);

  const flightEcon = trpc.seatEconomics.getByFlight.useQuery(
    { flightId: flightId ?? 0 },
    { enabled: flightId != null && flightId > 0 }
  );

  const bookingEcon = trpc.seatEconomics.getByBooking.useQuery(
    { bookingId: bookingId ?? 0 },
    { enabled: bookingId != null && bookingId > 0 }
  );

  const aiCost = trpc.agentGovernance.getAiCostBreakdown.useQuery(undefined);

  return (
    <div className="container py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <TrendingUp className="h-7 w-7" />
          {t("seatEconomics.title", "Seat Economics & AI Cost")}
        </h1>
        <p className="text-muted-foreground">
          {t(
            "seatEconomics.subtitle",
            "Per-seat revenue vs. cost (net contribution) and AI spend per tenant/feature."
          )}
        </p>
      </div>

      {/* Flight economics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plane className="h-5 w-5" />
            {t("seatEconomics.byFlight", "Flight economics")}
          </CardTitle>
          <CardDescription>
            {t(
              "seatEconomics.byFlightDesc",
              "Aggregate net contribution across paid bookings on a flight."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 max-w-sm">
            <Input
              type="number"
              min={1}
              placeholder={t("seatEconomics.flightId", "Flight ID")}
              value={flightInput}
              onChange={e => setFlightInput(e.target.value)}
            />
            <Button onClick={() => setFlightId(Number(flightInput) || null)}>
              {t("common.load", "Load")}
            </Button>
          </div>

          {flightEcon.isFetching && <Skeleton className="h-24 w-full" />}
          {flightEcon.data && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label={t("seatEconomics.seatsSold", "Seats sold")}
                value={String(flightEcon.data.seatCount)}
                hint={t("seatEconomics.bookings", {
                  count: flightEcon.data.bookingCount,
                  defaultValue: "{{count}} bookings",
                })}
              />
              <Stat
                label={t("seatEconomics.gross", "Gross revenue")}
                value={`${money(flightEcon.data.gross)} ${flightEcon.data.currency}`}
              />
              <Stat
                label={t("seatEconomics.netContribution", "Net contribution")}
                value={`${money(flightEcon.data.netContribution)} ${flightEcon.data.currency}`}
                hint={`${flightEcon.data.marginPct}% ${t("seatEconomics.margin", "margin")}`}
              />
              <Stat
                label={t("seatEconomics.avgPerSeat", "Avg / seat")}
                value={`${money(flightEcon.data.avgNetContributionPerSeat)} ${flightEcon.data.currency}`}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Booking (per-seat) economics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5" />
            {t("seatEconomics.byBooking", "Per-seat breakdown")}
          </CardTitle>
          <CardDescription>
            {t(
              "seatEconomics.byBookingDesc",
              "Revenue (base + ancillaries − discounts) vs. cost (payment fee + commission)."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 max-w-sm">
            <Input
              type="number"
              min={1}
              placeholder={t("seatEconomics.bookingId", "Booking ID")}
              value={bookingInput}
              onChange={e => setBookingInput(e.target.value)}
            />
            <Button onClick={() => setBookingId(Number(bookingInput) || null)}>
              {t("common.load", "Load")}
            </Button>
          </div>

          {bookingEcon.isFetching && <Skeleton className="h-40 w-full" />}
          {bookingEcon.data && (
            <div className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("seatEconomics.seat", "Seat")}</TableHead>
                    <TableHead>
                      {t("seatEconomics.passenger", "Passenger")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("seatEconomics.gross", "Gross")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("seatEconomics.discounts", "Discounts")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("seatEconomics.cost", "Cost")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("seatEconomics.net", "Net")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("seatEconomics.margin", "Margin")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookingEcon.data.seats.map((s, i) => (
                    <TableRow key={s.passengerId ?? i}>
                      <TableCell>{s.seatNumber ?? "—"}</TableCell>
                      <TableCell>{s.passengerName}</TableCell>
                      <TableCell className="text-right">
                        {money(s.revenue.gross)}
                      </TableCell>
                      <TableCell className="text-right">
                        {money(s.revenue.discounts)}
                      </TableCell>
                      <TableCell className="text-right">
                        {money(s.cost.totalCost)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {money(s.netContribution)}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.marginPct}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-sm text-muted-foreground">
                {t("seatEconomics.bookingTotal", "Booking net contribution")}:{" "}
                <span className="font-semibold text-foreground">
                  {money(bookingEcon.data.summary.netContribution)}{" "}
                  {bookingEcon.data.currency}
                </span>{" "}
                ({bookingEcon.data.summary.marginPct}%)
              </p>
              <p className="text-xs text-muted-foreground">
                {bookingEcon.data.assumptions.note}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI cost attribution */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            {t("seatEconomics.aiCost", "AI cost by tenant & feature")}
          </CardTitle>
          <CardDescription>
            {t(
              "seatEconomics.aiCostDesc",
              "LLM gateway spend attributed per airline tenant and product feature."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {aiCost.isLoading && <Skeleton className="h-40 w-full" />}
          {aiCost.data && aiCost.data.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("seatEconomics.noAiCost", "No AI usage recorded yet.")}
            </p>
          )}
          {aiCost.data && aiCost.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("seatEconomics.tenant", "Tenant")}</TableHead>
                  <TableHead>{t("seatEconomics.feature", "Feature")}</TableHead>
                  <TableHead className="text-right">
                    {t("seatEconomics.calls", "Calls")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("seatEconomics.tokens", "Tokens (in/out)")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("seatEconomics.costUsd", "Cost (USD)")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aiCost.data.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.tenantId ?? "—"}</TableCell>
                    <TableCell>{r.feature ?? "—"}</TableCell>
                    <TableCell className="text-right">{r.calls}</TableCell>
                    <TableCell className="text-right">
                      {r.totalInputTokens} / {r.totalOutputTokens}
                    </TableCell>
                    <TableCell className="text-right">
                      ${r.totalCostUsd.toFixed(4)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
