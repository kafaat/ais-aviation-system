import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
export default function MyGroups() {
  const { t } = useTranslation();
  const query = trpc.groupBookings.myAllocations.useQuery();
  return (
    <main className="container max-w-3xl py-8 space-y-4">
      <h1 className="text-2xl font-bold">{t("groupBooking.myAllocations")}</h1>
      <p>{t("groupBooking.allocationNote")}</p>
      {query.isLoading && <p role="status">{t("common.loading")}</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      {query.data?.map(g => (
        <Card key={g.id} className="p-4 space-y-3">
          <h2>
            #{g.id} · {g.groupSize} {t("checkIn.passengers")}
          </h2>
          <p>
            {t(`groupBooking.status.${g.status}`)} ·{" "}
            {g.totalPrice === null
              ? "—"
              : `${(g.totalPrice / 100).toFixed(2)} SAR`}
          </p>
          <p>
            {g.allocationExpiresAt
              ? new Date(g.allocationExpiresAt).toLocaleString()
              : "—"}
          </p>
          {g.bookingId ? (
            <Link href="/my-bookings">{t("nav.myBookings")}</Link>
          ) : (
            g.status === "confirmed" &&
            g.allocationExpiresAt &&
            new Date(g.allocationExpiresAt) > new Date() && (
              <Button asChild>
                <Link
                  href={`/booking/${g.flightId}?class=${g.cabinClass}&groupBookingId=${g.id}`}
                >
                  {t("groupBooking.completeAllocation")}
                </Link>
              </Button>
            )
          )}
        </Card>
      ))}
    </main>
  );
}
