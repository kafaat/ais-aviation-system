import { useOperationalLabels } from "./OperationalReadState";
import { matchesPaidSeatProduct } from "@shared/paid-seat";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Package,
  UtensilsCrossed,
  Armchair,
  Shield,
  Coffee,
  Zap,
  Plus,
  Minus,
  Trash2,
  type LucideIcon,
} from "lucide-react";

interface ManageAncillariesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: number;
  cabinClass: "economy" | "business";
  numberOfPassengers: number;
  editable: boolean;
}

const categoryIcons: Record<string, LucideIcon> = {
  baggage: Package,
  meal: UtensilsCrossed,
  seat: Armchair,
  insurance: Shield,
  lounge: Coffee,
  priority_boarding: Zap,
};

const categoryNameKeys: Record<string, string> = {
  baggage: "ancillary.categories.baggage",
  meal: "ancillary.categories.meal",
  seat: "ancillary.categories.seat",
  insurance: "ancillary.categories.insurance",
  lounge: "ancillary.categories.lounge",
  priority_boarding: "ancillary.categories.priority_boarding",
};

type ServiceScope = {
  passengerId: number;
  flightId: number;
  seatNumber?: string;
};
function permits(
  restriction: string | null,
  value: string | number | undefined
) {
  if (restriction == null) return true;
  try {
    const values: unknown = JSON.parse(restriction);
    return Array.isArray(values) && values.includes(value);
  } catch {
    return false;
  }
}
function ScopedPurchaseControls({
  bookingId,
  cabinClass,
  service,
  disabled,
  onAdd,
}: {
  bookingId: number;
  cabinClass: "economy" | "business";
  service: {
    code: string;
    price: number;
    category: string;
    applicableAirlines: string | null;
  };
  disabled: boolean;
  onAdd: (selection: ServiceScope, quantity: number) => void;
}) {
  const { t } = useTranslation();
  const l = useOperationalLabels();
  const isSeat = service.category === "seat";
  const [quantity, setQuantity] = useState("1");
  const [flightId, setFlightId] = useState(0);
  const [passengerId, setPassengerId] = useState(0);
  const [number, setNumber] = useState("");
  const legs = trpc.bookings.getDepartureState.useQuery({ bookingId });
  const pax = trpc.bookings.getPassengers.useQuery({ bookingId });
  const map = trpc.seatMap.getFlightSeatMap.useQuery(
    { flightId },
    { enabled: isSeat && flightId > 0 }
  );
  const carrier = trpc.flights.getById.useQuery(
    { id: flightId },
    { enabled: !!service.applicableAirlines && flightId > 0 }
  );
  const eligibleLegs = legs.data?.filter(
    leg =>
      ["scheduled", "delayed"].includes(leg.status) &&
      new Date(leg.departureTime).getTime() > Date.now()
  );
  const sector = eligibleLegs?.find(leg => leg.flightId === flightId);
  const eligiblePassengers = sector?.passengers.filter(
    p => !isSeat || !p.seatNumber
  );
  const options =
    map.data?.cabins
      .filter(c => c.cabinClass === cabinClass)
      .flatMap(c => c.rows.flatMap(r => r.seats))
      .filter(
        seat =>
          seat.status === "available" &&
          !seat.isAssigned &&
          seat.seatPrice === service.price &&
          matchesPaidSeatProduct(service.code, seat)
      ) ?? [];
  const valid =
    !legs.isError &&
    !pax.isError &&
    !(isSeat && map.isError) &&
    !(service.applicableAirlines && carrier.isError) &&
    eligiblePassengers?.some(p => p.passengerId === passengerId) &&
    pax.data?.some(p => p.id === passengerId) &&
    permits(service.applicableAirlines, carrier.data?.airline.id) &&
    (isSeat
      ? options.some(s => s.seatNumber === number)
      : /^[1-9]$|^10$/.test(quantity));
  const selectClass = "border rounded px-2 py-1 text-sm";
  return (
    <div className="grid gap-2">
      <label>
        {t("manageAncillaries.sector")}{" "}
        <select
          className={selectClass}
          value={flightId}
          onChange={e => {
            setFlightId(Number(e.target.value));
            setPassengerId(0);
            setNumber("");
          }}
        >
          <option value={0}>{t("manageAncillaries.choose")}</option>
          {legs.data?.map(
            (leg, i) =>
              eligibleLegs?.includes(leg) && (
                <option key={leg.flightId} value={leg.flightId}>
                  {i + 1} · {leg.flightNumber}
                </option>
              )
          )}
        </select>
      </label>
      <label>
        {t("manageAncillaries.passenger")}{" "}
        <select
          className={selectClass}
          disabled={!sector}
          value={passengerId}
          onChange={e => setPassengerId(Number(e.target.value))}
        >
          <option value={0}>{t("manageAncillaries.choose")}</option>
          {pax.data
            ?.filter(p => eligiblePassengers?.some(s => s.passengerId === p.id))
            .map(p => (
              <option key={p.id} value={p.id}>
                {p.firstName} {p.lastName}
              </option>
            ))}
        </select>
      </label>
      {isSeat ? (
        <label>
          {t("manageAncillaries.seat")}{" "}
          <select
            className={selectClass}
            disabled={!options.length}
            value={number}
            onChange={e => setNumber(e.target.value)}
          >
            <option value="">{t("manageAncillaries.choose")}</option>
            {options.map(s => (
              <option key={s.id} value={s.seatNumber}>
                {s.seatNumber}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          {t("manageAncillaries.quantity")}{" "}
          <input
            type="number"
            min={1}
            max={10}
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
          />
        </label>
      )}
      {sector &&
        !permits(service.applicableAirlines, carrier.data?.airline.id) &&
        !carrier.isLoading && (
          <p role="status">
            {l(
              "هذه الخدمة غير متاحة للناقل المختار.",
              "This service is unavailable for the selected carrier."
            )}
          </p>
        )}
      {legs.isError ||
      pax.isError ||
      (isSeat && map.isError) ||
      (service.applicableAirlines && carrier.isError) ? (
        <p role="alert">
          {l(
            "تعذر تحميل خيارات الخدمة.",
            "Service options could not be loaded."
          )}{" "}
          <button
            type="button"
            onClick={() => {
              if (legs.isError) void legs.refetch();
              if (pax.isError) void pax.refetch();
              if (isSeat && map.isError) void map.refetch();
              if (service.applicableAirlines && carrier.isError)
                void carrier.refetch();
            }}
          >
            {l("إعادة المحاولة", "Retry")}
          </button>
        </p>
      ) : (
        isSeat &&
        sector &&
        !map.isLoading &&
        !options.length && <p role="status">{t("manageAncillaries.noSeats")}</p>
      )}
      <Button
        size="sm"
        disabled={disabled || !valid}
        onClick={() =>
          onAdd(
            { flightId, passengerId, ...(isSeat && { seatNumber: number }) },
            isSeat ? 1 : Number(quantity)
          )
        }
      >
        {t("common.add")}
      </Button>
    </div>
  );
}

export function ManageAncillariesDialog({
  open,
  onOpenChange,
  bookingId,
  cabinClass,
  editable,
  numberOfPassengers,
}: ManageAncillariesDialogProps) {
  const { t } = useTranslation();
  const l = useOperationalLabels();
  const utils = trpc.useUtils();
  const [selectedServices, setSelectedServices] = useState<
    Record<number, number>
  >({});

  const { data: availableServices, isLoading: loadingAvailable } =
    trpc.ancillary.getAvailable.useQuery({}, { enabled: open });

  const { data: currentAncillaries, isLoading: loadingCurrent } =
    trpc.ancillary.getBookingAncillaries.useQuery(
      { bookingId },
      { enabled: open }
    );

  const addAncillary = trpc.ancillary.addToBooking.useMutation({
    onSuccess: () => {
      utils.bookings.getDepartureState.invalidate({ bookingId });
      utils.seatMap.getFlightSeatMap.invalidate();
      utils.ancillary.getBookingAncillaries.invalidate({ bookingId });
      utils.bookings.myBookings.invalidate();
      toast.success(t("manageAncillaries.addSuccess"));
    },
    onError: error => {
      if (
        error.data?.code === "CONFLICT" ||
        error.data?.code === "PRECONDITION_FAILED"
      ) {
        void utils.ancillary.getAvailable.invalidate();
      }
      toast.error(error.message || t("manageAncillaries.addError"));
    },
  });

  const removeAncillary = trpc.ancillary.removeFromBooking.useMutation({
    onSuccess: () => {
      utils.bookings.getDepartureState.invalidate({ bookingId });
      utils.seatMap.getFlightSeatMap.invalidate();
      utils.ancillary.getBookingAncillaries.invalidate({ bookingId });
      utils.bookings.myBookings.invalidate();
      toast.success(t("manageAncillaries.removeSuccess"));
    },
    onError: error => {
      toast.error(error.message || t("manageAncillaries.removeError"));
    },
  });

  const pendingCommands = useRef(
    new Map<string, { key: string; expectedUnitPrice: number }>()
  );
  const handleAddService = (
    service: { id: number; price: number },
    scope?: ServiceScope,
    quantity = selectedServices[service.id] || 1
  ) => {
    const serviceId = service.id;
    const signature = JSON.stringify([bookingId, serviceId, quantity, scope]);
    const command = pendingCommands.current.get(signature) ?? {
      key: crypto.randomUUID(),
      expectedUnitPrice: service.price,
    };
    pendingCommands.current.set(signature, command);
    addAncillary.mutate(
      {
        idempotencyKey: command.key,
        expectedUnitPrice: command.expectedUnitPrice,
        bookingId,
        ancillaryServiceId: serviceId,
        quantity,
        ...scope,
      },
      {
        onError(error) {
          if (
            error.data?.code === "CONFLICT" ||
            error.data?.code === "PRECONDITION_FAILED"
          )
            pendingCommands.current.delete(signature);
        },
        onSuccess: () => {
          pendingCommands.current.delete(signature);
          setSelectedServices(prev => ({ ...prev, [serviceId]: 0 }));
        },
      }
    );
  };

  const handleRemoveAncillary = (ancillaryId: number) => {
    removeAncillary.mutate({ ancillaryId });
  };

  const incrementQuantity = (serviceId: number) => {
    setSelectedServices(prev => ({
      ...prev,
      [serviceId]: Math.min(
        (prev[serviceId] || 0) + 1,
        numberOfPassengers * 3,
        10
      ),
    }));
  };

  const decrementQuantity = (serviceId: number) => {
    setSelectedServices(prev => ({
      ...prev,
      [serviceId]: Math.max((prev[serviceId] || 0) - 1, 0),
    }));
  };

  const groupedServices = availableServices?.reduce(
    (acc, service) => {
      if (!acc[service.category]) {
        acc[service.category] = [];
      }
      acc[service.category].push(service);
      return acc;
    },
    {} as Record<string, typeof availableServices>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("manageAncillaries.title")}</DialogTitle>
          <DialogDescription>
            {t("manageAncillaries.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Current Ancillaries */}
          {loadingCurrent ? (
            <Skeleton className="h-32 w-full" />
          ) : currentAncillaries && currentAncillaries.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold mb-3">
                {t("manageAncillaries.currentServices")}
              </h3>
              <div className="space-y-2">
                {currentAncillaries.map(ancillary => {
                  if (!ancillary.service) return null;
                  const Icon =
                    categoryIcons[ancillary.service.category] || Package;
                  return (
                    <div
                      key={ancillary.id}
                      data-testid={`extra-line-${ancillary.id}`}
                      className="flex items-center justify-between p-3 border rounded-lg bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="h-5 w-5 text-primary" />
                        <div>
                          <p className="font-medium">
                            {ancillary.service.name}
                          </p>
                          {["meal", "baggage", "seat"].includes(
                            ancillary.service.category
                          ) && (
                            <p className="text-sm">
                              {[
                                ancillary.passengerFirstName,
                                ancillary.passengerLastName,
                              ]
                                .filter(Boolean)
                                .join(" ") ||
                                l(
                                  "الراكب غير محدد",
                                  "Passenger not assigned"
                                )}{" "}
                              ·{" "}
                              {ancillary.scopeState === "all_segments"
                                ? l("كل المقاطع", "All sectors")
                                : ancillary.scopeState === "specific_segment" &&
                                    ancillary.segmentOrder != null
                                  ? [
                                      t("manageAncillaries.sector") +
                                        " " +
                                        ancillary.segmentOrder,
                                      ancillary.flightNumber,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")
                                  : l("المقطع غير محدد", "Sector not assigned")}
                            </p>
                          )}
                          <p className="text-sm text-muted-foreground">
                            {t("manageAncillaries.quantity")}:{" "}
                            {ancillary.quantity} •{" "}
                            {(ancillary.totalPrice / 100).toFixed(2)}{" "}
                            {t("common.sar")}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={l("إزالة", "Remove")}
                        onClick={() => handleRemoveAncillary(ancillary.id)}
                        disabled={!editable || removeAncillary.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t("manageAncillaries.noServices")}
            </p>
          )}

          {/* Available Services */}
          {!editable ? (
            <p>{t("manageAncillaries.settled")}</p>
          ) : loadingAvailable ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div>
              <h3 className="text-sm font-semibold mb-3">
                {t("manageAncillaries.availableServices")}
              </h3>
              <div className="space-y-4">
                {groupedServices &&
                  Object.entries(groupedServices).map(
                    ([category, services]) => {
                      const Icon = categoryIcons[category] || Package;
                      return (
                        <div key={category}>
                          <div className="flex items-center gap-2 mb-2">
                            <Icon className="h-4 w-4 text-primary" />
                            <h4 className="text-sm font-medium">
                              {t(categoryNameKeys[category] || category)}
                            </h4>
                          </div>
                          <div className="space-y-2">
                            {services.map(service => (
                              <div
                                key={service.id}
                                data-testid={`extra-offer-${service.id}`}
                                className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50"
                              >
                                <div className="flex-1">
                                  <p className="font-medium text-sm">
                                    {service.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {service.description}
                                  </p>
                                  <p className="text-sm font-semibold text-primary mt-1">
                                    {(service.price / 100).toFixed(2)}{" "}
                                    {t("common.sar")}
                                  </p>
                                </div>
                                {!permits(
                                  service.applicableCabinClasses,
                                  cabinClass
                                ) ||
                                service.currency !== "SAR" ||
                                (category === "baggage" &&
                                  !(
                                    service.weightGrams &&
                                    service.weightGrams > 0
                                  )) ||
                                category === "insurance" ||
                                category === "lounge" ? (
                                  <p>
                                    {l(
                                      "غير متاح للشراء لهذا الحجز.",
                                      "Unavailable for purchase on this booking."
                                    )}
                                  </p>
                                ) : ["seat", "meal", "baggage"].includes(
                                    category
                                  ) ? (
                                  <ScopedPurchaseControls
                                    key={bookingId}
                                    bookingId={bookingId}
                                    cabinClass={cabinClass}
                                    service={service}
                                    disabled={addAncillary.isPending}
                                    onAdd={(scope, quantity) =>
                                      handleAddService(service, scope, quantity)
                                    }
                                  />
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-1 border rounded-lg">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                          decrementQuantity(service.id)
                                        }
                                        disabled={!selectedServices[service.id]}
                                      >
                                        <Minus className="h-3 w-3" />
                                      </Button>
                                      <span className="px-3 text-sm font-medium">
                                        {selectedServices[service.id] || 0}
                                      </span>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                          incrementQuantity(service.id)
                                        }
                                      >
                                        <Plus className="h-3 w-3" />
                                      </Button>
                                    </div>
                                    <Button
                                      size="sm"
                                      onClick={() => handleAddService(service)}
                                      disabled={
                                        !selectedServices[service.id] ||
                                        addAncillary.isPending
                                      }
                                    >
                                      {t("common.add")}
                                    </Button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    }
                  )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
