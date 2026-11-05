import { BookingAncillariesDisplay } from "@/components/BookingAncillariesDisplay";
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
import { BaggageEntitlement } from "@/components/BaggageEntitlement";
import { PassengerTravelDocuments } from "@/components/PassengerTravelDocuments";
import { useRawSearch } from "@/lib/useRawSearch";
import { loginPath } from "@shared/return-to";
import { readCheckInLink, validCheckInCode } from "@shared/check-in-link";

function BoardingPass({
  bookingId,
  flightId,
  passengerId,
}: {
  bookingId: number;
  flightId: number;
  passengerId: number;
}) {
  const { t } = useTranslation();
  const { data, error, isFetching, isPaused } =
    trpc.seatMap.getBoardingPass.useQuery(
      { flightId, passengerId },
      { retry: false, refetchOnWindowFocus: true, staleTime: 0 }
    );
  const [qr, setQr] = useState<{ token: string; image: string }>();
  // IATA BCBP (Resolution 792) PDF417 for airport readers; rendered lazily so
  // the barcode library stays out of the main bundle.
  const [pdf417, setPdf417] = useState<{ bcbp: string; image: string }>();
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
  useEffect(() => {
    let active = true;
    if (data)
      import("@/lib/boarding-pass-pdf417")
        .then(({ renderBoardingPassPDF417 }) => {
          const svg = renderBoardingPassPDF417(data.bcbp);
          if (active)
            setPdf417({
              bcbp: data.bcbp,
              image: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
            });
        })
        .catch(() => {
          if (active) setPdf417(undefined);
        });
    return () => {
      active = false;
    };
  }, [data]);
  if (isFetching || isPaused) return <p role="status">{t("common.loading")}</p>;
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
      <figure className="space-y-1">
        {pdf417?.bcbp === data.bcbp && (
          <img
            src={pdf417.image}
            alt={t("checkIn.bcbpBarcode")}
            className="w-full max-w-xl mx-auto bg-white"
          />
        )}
        <figcaption className="text-xs text-muted-foreground text-center">
          {t("checkIn.bcbpBarcode")}
        </figcaption>
        <code
          className="block font-mono text-[10px] break-all text-center"
          data-testid="bcbp-string"
        >
          {data.bcbp}
        </code>
      </figure>
      <figure className="space-y-1">
        <img
          src={qr.image}
          width={320}
          height={320}
          alt={t("checkIn.boardingPass")}
          className="max-w-full mx-auto"
        />
        <figcaption className="text-xs text-muted-foreground text-center">
          {t("checkIn.signedQr")}
        </figcaption>
      </figure>
      <BaggageEntitlement
        bookingId={bookingId}
        passengerId={passengerId}
        flightId={flightId}
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
  const search = useRawSearch();
  const { user, isAuthenticated } = useAuth();
  return (
    <CheckInForm
      key={JSON.stringify([user?.id, user?.tenantId, search])}
      search={search}
      isAuthenticated={isAuthenticated}
    />
  );
}

function CheckInForm({
  search,
  isAuthenticated,
}: {
  search: string;
  isAuthenticated: boolean;
}) {
  const { t } = useTranslation();
  const [linkTarget, setLinkTarget] = useState(() => readCheckInLink(search));
  const [pnr, setPnr] = useState(() => {
    if (linkTarget?.kind === "pnr") return linkTarget.value;
    if (linkTarget) return "";
    const issuedPnr: unknown = window.history.state?.checkInPnr;
    return validCheckInCode(issuedPnr) ? issuedPnr : "";
  });
  const [searched, setSearched] = useState(pnr);
  const [flightId, setFlightId] = useState<number>();
  const [selection, setSelection] = useState<{
    key: string;
    seats: string[];
  }>();
  const [excluded, setExcluded] = useState<number[]>([]);
  const utils = trpc.useUtils();
  const legacyReference =
    linkTarget?.kind === "bookingReference" ? linkTarget.value : null;
  const ownedBookings = trpc.bookings.myBookings.useQuery(undefined, {
    enabled: isAuthenticated && legacyReference !== null,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  });
  // Never reinterpret an old booking reference as a PNR. Resolve only a current
  // authenticated owner's list, not a cached result while it is refreshing.
  const legacyPnr =
    isAuthenticated &&
    legacyReference &&
    !ownedBookings.isFetching &&
    !ownedBookings.isPaused &&
    !ownedBookings.error
      ? ownedBookings.data?.find(
          row => row.bookingReference === legacyReference
        )?.pnr
      : undefined;
  const lookupPnr = legacyReference
    ? validCheckInCode(legacyPnr)
      ? legacyPnr
      : ""
    : searched;
  useEffect(() => {
    if (legacyReference && validCheckInCode(legacyPnr)) setPnr(legacyPnr);
  }, [legacyReference, legacyPnr]);
  const bookingQuery = trpc.bookings.getByPNR.useQuery(
    { pnr: lookupPnr },
    {
      enabled: isAuthenticated && validCheckInCode(lookupPnr),
      retry: false,
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: "always",
    }
  );
  const booking = {
    ...bookingQuery,
    data:
      !isAuthenticated ||
      bookingQuery.isFetching ||
      bookingQuery.isPaused ||
      bookingQuery.error
        ? undefined
        : bookingQuery.data,
  };
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
  const eligible =
    leg?.passengers.filter(
      p =>
        p.departureState === "not_checked_in" ||
        p.departureState === "offloaded"
    ) ?? [];
  const chosen = eligible.filter(p => !excluded.includes(p.passengerId));
  const seatMapKey = [
    booking.data?.id,
    leg?.flightId,
    ...chosen.map(p => p.passengerId),
  ].join(":");
  const checkIn = trpc.bookings.checkIn.useMutation({
    onSuccess: async () => {
      setSelection(undefined);
      setExcluded([]);
      await utils.bookings.getDepartureState.invalidate();
      await utils.seatMap.invalidate();
      toast.success(t("checkIn.successMessage"));
    },
    onError: async error => {
      toast.error(error.message);
      await utils.bookings.getDepartureState.invalidate();
    },
  });
  if (!isAuthenticated)
    return (
      <main className="container py-10">
        <p>{t("checkIn.loginRequiredDesc")}</p>
        <Link href={loginPath(`/check-in${search ? `?${search}` : ""}`)}>
          {t("common.login")}
        </Link>
      </main>
    );
  return (
    <main className="container max-w-3xl py-8 space-y-6">
      <h1 className="text-2xl font-bold print:hidden">{t("checkIn.title")}</h1>
      <form
        className="flex items-end gap-3 print:hidden"
        onSubmit={event => {
          event.preventDefault();
          if (!validCheckInCode(pnr)) {
            toast.error(t("checkIn.invalidPnr"));
            return;
          }
          setFlightId(undefined);
          setSelection(undefined);
          setExcluded([]);
          setLinkTarget(null);
          setSearched(pnr);
        }}
      >
        <div className="flex-1">
          <Label htmlFor="pnr">{t("checkIn.pnrLabel")}</Label>
          <Input
            id="pnr"
            value={pnr}
            maxLength={6}
            onChange={e => {
              setPnr(e.target.value.toUpperCase());
              if (linkTarget) {
                setLinkTarget(null);
                setSearched("");
              }
            }}
          />
        </div>
        <Button type="submit">{t("checkIn.search")}</Button>
      </form>
      {linkTarget?.kind === "invalid" && (
        <p role="alert">{t("checkIn.invalidPnr")}</p>
      )}
      {legacyReference && ownedBookings.isError && (
        <p role="alert">{ownedBookings.error.message}</p>
      )}
      {legacyReference &&
        ownedBookings.isSuccess &&
        !ownedBookings.isFetching &&
        !validCheckInCode(legacyPnr) && (
          <p role="alert">{t("checkIn.notFound")}</p>
        )}
      {((legacyReference && ownedBookings.isLoading) ||
        ((booking.isLoading || states.isLoading) && lookupPnr)) && (
        <p role="status">{t("common.loading")}</p>
      )}
      {(booking.error || states.error) && (
        <p role="alert">{booking.error?.message || states.error?.message}</p>
      )}
      {booking.data && (
        <div className="print:hidden">
          <BookingAncillariesDisplay bookingId={booking.data.id} />
        </div>
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
                  setSelection(undefined);
                  setExcluded([]);
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
                {passengers.data?.map(p => {
                  const row = leg.passengers.find(s => s.passengerId === p.id);
                  if (!row) return null;
                  const name = p.firstName + " " + p.lastName;
                  return (
                    <div key={p.id}>
                      {leg.open &&
                      eligible.some(e => e.passengerId === p.id) ? (
                        <label>
                          <input
                            type="checkbox"
                            checked={!excluded.includes(p.id)}
                            disabled={checkIn.isPending}
                            onChange={event => {
                              setExcluded(
                                event.target.checked
                                  ? excluded.filter(id => id !== p.id)
                                  : [...excluded, p.id]
                              );
                              setSelection(undefined);
                            }}
                          />{" "}
                          {name}
                        </label>
                      ) : (
                        name
                      )}
                      {" · "}
                      {row.departureState === "boarding_denied"
                        ? t("checkIn.boardingDenied")
                        : row.departureState === "boarded"
                          ? t("checkIn.alreadyBoarded")
                          : (row.seatNumber ?? t("checkIn.autoAssign"))}
                    </div>
                  );
                })}
              </div>
              {passengers.data && (
                <PassengerTravelDocuments
                  key={`${booking.data.id}:${leg.flightId}`}
                  bookingId={booking.data.id}
                  flightId={leg.flightId}
                  passengers={passengers.data.filter(passenger =>
                    leg.passengers.some(row => row.passengerId === passenger.id)
                  )}
                />
              )}
              {eligible.length > 0 && (
                <section className="space-y-4 print:hidden">
                  {leg.open ? (
                    <>
                      {chosen.length > 0 && (
                        <SeatMap
                          key={seatMapKey}
                          flightId={leg.flightId}
                          cabinClass={booking.data.cabinClass}
                          maxSeats={chosen.length}
                          onSeatSelect={seats =>
                            setSelection({
                              key: seatMapKey,
                              seats: seats.map(s => s.id),
                            })
                          }
                        />
                      )}
                      <Button
                        disabled={
                          checkIn.isPending ||
                          states.isFetching ||
                          !chosen.length ||
                          !passengers.data?.length
                        }
                        onClick={() => {
                          if (!booking.data) return;
                          checkIn.mutate({
                            bookingId: booking.data.id,
                            flightId: leg.flightId,
                            seatAssignments: chosen.map((p, index) => ({
                              passengerId: p.passengerId,
                              seatNumber:
                                selection?.key === seatMapKey
                                  ? selection.seats[index]
                                  : undefined,
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
                .filter(p => p.departureState === "checked_in")
                .map(
                  p =>
                    booking.data && (
                      <BoardingPass
                        bookingId={booking.data.id}
                        key={`${leg.flightId}:${p.passengerId}`}
                        flightId={leg.flightId}
                        passengerId={p.passengerId}
                      />
                    )
                )}
            </>
          )}
        </>
      )}
    </main>
  );
}
