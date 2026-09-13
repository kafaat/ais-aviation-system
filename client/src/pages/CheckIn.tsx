import { useState, useEffect } from "react";
import QRCode from "qrcode";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SeatMap } from "@/components/SeatMap";
import { Link } from "wouter";
import { toast } from "sonner";

function BoardingPass({
  flightId,
  passengerId,
}: {
  flightId: number;
  passengerId: number;
}) {
  const { t } = useTranslation();
  const { data, error, isLoading } = trpc.seatMap.getBoardingPass.useQuery(
    { flightId, passengerId },
    { retry: false, refetchOnWindowFocus: true, staleTime: 0 }
  );
  const [qr, setQr] = useState<{ token: string; image: string }>();
  useEffect(() => {
    let active = true;
    if (data)
      QRCode.toDataURL(data.barcodeData, {
        width: 420,
        margin: 4,
        errorCorrectionLevel: "M",
      })
        .then(image => {
          if (active) setQr({ token: data.barcodeData, image });
        })
        .catch(() => {
          if (active) setQr(undefined);
        });
    return () => {
      active = false;
    };
  }, [data]);
  if (isLoading) return <p role="status">{t("common.loading")}</p>;
  if (error || !data || qr?.token !== data.barcodeData)
    return <p role="alert">{error?.message || t("checkIn.passUnavailable")}</p>;
  return (
    <Card className="p-6 space-y-4 break-inside-avoid">
      <h2 className="text-xl font-bold">
        {t("checkIn.boardingPass")} · {data.airline.name}
      </h2>
      <p className="text-lg">
        {data.passenger.firstName} {data.passenger.lastName}
      </p>
      <p>
        {data.flightNumber} · {data.origin.code} → {data.destination.code}
      </p>
      <p>
        {t("checkIn.departure")}:{" "}
        {new Date(data.departureTime).toLocaleString()}
      </p>
      <p>
        {t("checkIn.seat")}: <strong>{data.seat.seatNumber}</strong> ·{" "}
        {t(`cabin.${data.seat.cabinClass}`)}
      </p>
      <p>
        {t("checkIn.gate")}: {data.gate ?? "—"} · {t("checkIn.boardingTime")}:{" "}
        {data.boardingTime
          ? new Date(data.boardingTime).toLocaleTimeString()
          : "—"}
      </p>
      <img
        src={qr.image}
        width={420}
        height={420}
        alt={t("checkIn.boardingPass")}
        className="max-w-full mx-auto"
      />
      <p className="text-sm text-muted-foreground">
        {t("checkIn.onlineVerification")}
      </p>
      <Button
        type="button"
        className="print:hidden"
        onClick={() => window.print()}
      >
        {t("checkIn.printBoardingPass")}
      </Button>
    </Card>
  );
}
export default function CheckIn() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [pnr, setPnr] = useState("");
  const [searched, setSearched] = useState("");
  const [flightId, setFlightId] = useState<number>();
  const [selected, setSelected] = useState<string[]>([]);
  const utils = trpc.useUtils();
  const booking = trpc.bookings.getByPNR.useQuery(
    { pnr: searched },
    { enabled: isAuthenticated && searched.length === 6, retry: false }
  );
  const states = trpc.bookings.getDepartureState.useQuery(
    { bookingId: booking.data?.id ?? 0 },
    { enabled: Boolean(booking.data), retry: false }
  );
  const passengers = trpc.bookings.getPassengers.useQuery(
    { bookingId: booking.data?.id ?? 0 },
    { enabled: Boolean(booking.data) }
  );
  const leg =
    states.data?.find(l => l.flightId === flightId) ?? states.data?.[0];
  const checkIn = trpc.bookings.checkIn.useMutation({
    onSuccess: async () => {
      setSelected([]);
      await utils.bookings.getDepartureState.invalidate();
      await utils.seatMap.invalidate();
      toast.success(t("checkIn.successMessage"));
    },
    onError: error => toast.error(error.message),
  });
  if (!isAuthenticated)
    return (
      <main className="container py-10">
        <p>{t("checkIn.loginRequiredDesc")}</p>
        <Link href="/login">{t("common.login")}</Link>
      </main>
    );
  return (
    <main className="container max-w-3xl py-8 space-y-6">
      <h1 className="text-2xl font-bold print:hidden">{t("checkIn.title")}</h1>
      <form
        className="flex items-end gap-3 print:hidden"
        onSubmit={event => {
          event.preventDefault();
          if (pnr.length !== 6) {
            toast.error(t("checkIn.invalidPnr"));
            return;
          }
          setFlightId(undefined);
          setSelected([]);
          setSearched(pnr);
        }}
      >
        <div className="flex-1">
          <Label htmlFor="pnr">{t("checkIn.pnrLabel")}</Label>
          <Input
            id="pnr"
            value={pnr}
            maxLength={6}
            onChange={e => setPnr(e.target.value.toUpperCase())}
          />
        </div>
        <Button type="submit">{t("checkIn.search")}</Button>
      </form>
      {(booking.isLoading || states.isLoading) && searched && (
        <p role="status">{t("common.loading")}</p>
      )}
      {(booking.error || states.error) && (
        <p role="alert">{booking.error?.message || states.error?.message}</p>
      )}
      {booking.data && states.data && (
        <>
          <div className="flex flex-wrap gap-2 print:hidden">
            {states.data.map(l => (
              <Button
                key={l.flightId}
                variant={l.flightId === leg?.flightId ? "default" : "outline"}
                onClick={() => {
                  setFlightId(l.flightId);
                  setSelected([]);
                }}
              >
                {l.flightNumber} ·{" "}
                {new Date(l.departureTime).toLocaleDateString()}
              </Button>
            ))}
          </div>
          {leg && (
            <>
              <p>
                {leg.flightNumber} ·{" "}
                {new Date(leg.departureTime).toLocaleString()}
              </p>
              <div className="space-y-2 print:hidden">
                {passengers.data?.map(p => (
                  <p key={p.id}>
                    {p.firstName} {p.lastName} ·{" "}
                    {leg.passengers.find(s => s.passengerId === p.id)
                      ?.seatNumber ?? t("checkIn.autoAssign")}
                  </p>
                ))}
              </div>
              {leg.passengers.some(p => !p.checkedIn) && (
                <section className="space-y-4 print:hidden">
                  {leg.open ? (
                    <>
                      <SeatMap
                        key={`${booking.data.id}:${leg.flightId}`}
                        flightId={leg.flightId}
                        cabinClass={booking.data.cabinClass}
                        maxSeats={
                          leg.passengers.filter(p => !p.checkedIn).length
                        }
                        onSeatSelect={seats =>
                          setSelected(seats.map(s => s.id))
                        }
                      />
                      <Button
                        disabled={checkIn.isPending || !passengers.data?.length}
                        onClick={() => {
                          let next = 0;
                          checkIn.mutate({
                            bookingId: booking.data.id,
                            flightId: leg.flightId,
                            seatAssignments: leg.passengers.map(p => ({
                              passengerId: p.passengerId,
                              seatNumber: p.checkedIn
                                ? (p.seatNumber ?? undefined)
                                : selected[next++],
                            })),
                          });
                        }}
                      >
                        {checkIn.isPending
                          ? t("checkIn.processing")
                          : t("checkIn.checkInButton")}
                      </Button>
                    </>
                  ) : (
                    <p role="status">{t("checkIn.windowClosed")}</p>
                  )}
                </section>
              )}
              {leg.passengers
                .filter(p => p.checkedIn)
                .map(p => (
                  <BoardingPass
                    key={`${leg.flightId}:${p.passengerId}`}
                    flightId={leg.flightId}
                    passengerId={p.passengerId}
                  />
                ))}
            </>
          )}
        </>
      )}
    </main>
  );
}
