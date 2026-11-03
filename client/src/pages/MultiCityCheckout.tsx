import AncillarySelection, {
  ancillaryCommandLines,
  type SelectedAncillary,
} from "@/components/AncillarySelection";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearch } from "wouter";
import { z } from "zod";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

const itinerary = z.object({
  version: z.literal(1),
  sessionId: z.uuid(),
  passengerCount: z.number().int().min(1).max(9),
  cabinClass: z.enum(["economy", "business"]),
  segments: z
    .array(
      z.object({
        flightId: z.number().int().positive(),
        departureDate: z.iso.datetime().transform(value => new Date(value)),
      })
    )
    .min(2)
    .max(5),
});
type Passenger = {
  firstName: string;
  lastName: string;
  type: "adult" | "child" | "infant";
};

export default function MultiCityCheckout() {
  const { t } = useTranslation();
  const search = useSearch();
  const data = useMemo(() => {
    try {
      return itinerary.parse(
        JSON.parse(new URLSearchParams(search).get("data") ?? "")
      );
    } catch {
      return null;
    }
  }, [search]);
  if (!data)
    return (
      <main className="container py-8">
        <p role="alert">{t("multiCity.invalidItinerary")}</p>
        <Link href="/">{t("nav.searchFlights")}</Link>
      </main>
    );
  return <Checkout key={search} data={data} />;
}

function Checkout({ data }: { data: z.output<typeof itinerary> }) {
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();
  const [passengers, setPassengers] = useState<Passenger[]>(() =>
    Array.from({ length: data.passengerCount }, () => ({
      firstName: "",
      lastName: "",
      type: "adult",
    }))
  );
  const quote = trpc.multiCity.calculatePrice.useQuery({
    segments: data.segments.map(({ flightId }) => ({
      flightId,
      cabinClass: data.cabinClass,
    })),
    passengerCount: passengers.length,
    passengerTypes: passengers.map(p => p.type),
  });
  const utils = trpc.useUtils();
  const booking = trpc.multiCity.create.useMutation();
  const [submittedAmount, setSubmittedAmount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [extras, setExtras] = useState<SelectedAncillary[]>([]);
  const extrasTotal = extras.reduce((sum, row) => sum + row.totalPrice, 0);

  const total =
    submittedAmount ??
    (quote.data ? quote.data.totalPrice + extrasTotal : undefined);
  function edit(index: number, patch: Partial<Passenger>) {
    setPassengers(current =>
      current.map((p, i) => (i === index ? { ...p, ...patch } : p))
    );
  }
  return (
    <main className="container max-w-xl space-y-4 py-8">
      <h1 className="text-2xl font-semibold">
        {t("multiCity.proceedToBooking")}
      </h1>
      <form
        className="space-y-5"
        onSubmit={async event => {
          event.preventDefault();
          if (total === undefined || booking.isPending) return;
          setError("");
          setSubmittedAmount(total);
          try {
            await booking.mutateAsync({
              segments: data.segments,
              cabinClass: data.cabinClass,
              passengers,
              sessionId: data.sessionId,
              checkoutContractVersion: 1,
              expectedTotalMinor: total,
              ...(extras.length
                ? { ancillaries: ancillaryCommandLines(extras) }
                : {}),
            });
            navigate("/my-bookings");
          } catch (failure) {
            setError(
              failure instanceof Error ? failure.message : t("common.error")
            );
            // A transport failure is ambiguous: retain the exact submitted amount
            // and passenger list for replay, even if current availability changes.
            const code =
              failure && typeof failure === "object" && "data" in failure
                ? (failure.data as { code?: string } | null)?.code
                : undefined;
            if (
              code === "CONFLICT" ||
              code === "BAD_REQUEST" ||
              code === "PRECONDITION_FAILED"
            ) {
              setSubmittedAmount(null);
              await Promise.all([
                quote.refetch(),
                utils.ancillary.getAvailable.invalidate(),
              ]);
            }
          }
        }}
      >
        {passengers.map((p, i) => (
          <fieldset
            key={i}
            className="grid gap-2"
            disabled={submittedAmount !== null}
          >
            <legend>
              {t("booking.passengers")} {i + 1}
            </legend>
            <label>
              {t("booking.firstName")}{" "}
              <input
                required
                maxLength={100}
                value={p.firstName}
                onChange={e => edit(i, { firstName: e.target.value })}
              />
            </label>
            <label>
              {t("booking.lastName")}{" "}
              <input
                required
                maxLength={100}
                value={p.lastName}
                onChange={e => edit(i, { lastName: e.target.value })}
              />
            </label>
            <label>
              {t("booking.passengerType")}{" "}
              <select
                value={p.type}
                onChange={e =>
                  edit(i, { type: e.target.value as Passenger["type"] })
                }
              >
                {(["adult", "child", "infant"] as const).map(type => (
                  <option key={type} value={type}>
                    {t("booking." + type)}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        ))}
        <AncillarySelection
          cabinClass={data.cabinClass}
          flightIds={data.segments.map(s => s.flightId)}
          passengers={passengers}
          selected={extras}
          onChange={setExtras}
          disabled={submittedAmount !== null}
        />
        {total !== undefined && (
          <p>
            {t("booking.total")}{" "}
            {new Intl.NumberFormat(i18n.language, {
              style: "currency",
              currency: "SAR",
            }).format(total / 100)}
          </p>
        )}
        {(error || quote.error) && (
          <p role="alert">{error || quote.error?.message}</p>
        )}
        <Button
          type="submit"
          disabled={total === undefined || booking.isPending}
        >
          {t("search.bookNow")}
        </Button>
      </form>
      <Link href="/my-bookings">{t("nav.myBookings")}</Link>
    </main>
  );
}
