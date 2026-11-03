import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useOperationalLabels } from "./OperationalReadState";

export interface SelectedAncillary {
  passengerIndex: number;
  segmentIndex: number;
  ancillaryServiceId: number;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  serviceName: string;
  flightNumber: string;
}

export function ancillaryCommandLines(items: SelectedAncillary[]) {
  return items.map(
    ({
      passengerIndex,
      segmentIndex,
      ancillaryServiceId,
      quantity,
      unitPrice,
      totalPrice,
    }) => ({
      passengerIndex,
      segmentIndex,
      ancillaryServiceId,
      quantity,
      unitPrice,
      totalPrice,
    })
  );
}

function applies(restriction: string | null, value: string | number) {
  if (restriction === null) return true;
  try {
    const list: unknown = JSON.parse(restriction);
    return Array.isArray(list) && list.includes(value);
  } catch {
    return false;
  }
}

export default function AncillarySelection({
  cabinClass,
  flightIds,
  passengers,
  selected,
  onChange,
  disabled = false,
}: {
  cabinClass: "economy" | "business";
  flightIds: number[];
  passengers: { firstName: string; lastName: string }[];
  selected: SelectedAncillary[];
  onChange: (items: SelectedAncillary[]) => void;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const l = useOperationalLabels();
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [passengerIndex, setPassengerIndex] = useState(0);
  const [productId, setProductId] = useState(0);
  const [quantity, setQuantity] = useState("1");
  const flightId = flightIds[segmentIndex];
  const flight = trpc.flights.getById.useQuery(
    { id: flightId },
    { enabled: !!flightId }
  );
  const catalog = trpc.ancillary.getAvailable.useQuery({});
  const sector = flight.data?.id === flightId ? flight.data : null;
  const applicableProducts =
    catalog.data?.filter(
      item =>
        sector &&
        item.available &&
        item.currency === "SAR" &&
        Number.isSafeInteger(item.price) &&
        item.price >= 0 &&
        applies(item.applicableCabinClasses, cabinClass) &&
        applies(item.applicableAirlines, sector.airline.id)
    ) ?? [];
  function unavailableReason(item: (typeof applicableProducts)[number]) {
    if (item.category === "seat")
      return l("يتطلب حجز مقعد محدد.", "Requires a specific seat assignment.");
    if (item.category === "insurance" || item.category === "lounge")
      return l(
        "يتطلب تأكيداً من مقدم الخدمة.",
        "Requires confirmation from the provider."
      );
    if (
      item.category === "baggage" &&
      !(item.weightGrams && item.weightGrams > 0)
    )
      return l(
        "لم يؤكد الناقل وزن الأمتعة.",
        "The carrier has not confirmed a baggage weight."
      );
    return null;
  }
  const products = applicableProducts.filter(item => !unavailableReason(item));
  const unavailable = applicableProducts.filter(item =>
    unavailableReason(item)
  );
  const product = products.find(p => p.id === productId);
  function changedQuote(line: SelectedAncillary) {
    if (!catalog.data || disabled) return false;
    const current = catalog.data.find(
      item => item.id === line.ancillaryServiceId
    );
    return !current || !current.available || current.price !== line.unitPrice;
  }
  const qty = Number(quantity);
  const alreadyAdded = selected.some(
    s =>
      s.segmentIndex === segmentIndex &&
      s.passengerIndex === passengerIndex &&
      s.ancillaryServiceId === productId
  );
  const canAdd = Boolean(
    product &&
    passengers[passengerIndex] &&
    sector &&
    !catalog.isError &&
    !flight.isError &&
    !alreadyAdded &&
    Number.isSafeInteger(qty) &&
    qty >= 1 &&
    qty <= 10
  );
  const money = (minor: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: "currency",
      currency: "SAR",
    }).format(minor / 100);
  const paxLabel = (index: number) => {
    const p = passengers[index];
    return [
      l("الراكب", "Passenger") + " " + (index + 1),
      p && (p.firstName + " " + p.lastName).trim(),
    ]
      .filter(Boolean)
      .join(" · ");
  };
  return (
    <Card className="space-y-4 p-5" data-testid="ancillary-services">
      <h2 className="text-xl font-semibold">{t("ancillary.title")}</h2>
      <fieldset disabled={disabled} className="grid gap-3">
        <label>
          {t("manageAncillaries.sector")}{" "}
          <select
            data-testid="ancillary-segment"
            value={segmentIndex}
            onChange={e => {
              setSegmentIndex(Number(e.target.value));
              setProductId(0);
            }}
          >
            {flightIds.map((id, i) => (
              <option key={i} value={i}>
                {i + 1} · {l("معرف الرحلة", "Flight ID")} {id}
              </option>
            ))}
          </select>
        </label>
        {sector && (
          <p>
            {sector.flightNumber} · {sector.origin.code} →{" "}
            {sector.destination.code}
          </p>
        )}
        <label>
          {t("manageAncillaries.passenger")}{" "}
          <select
            data-testid="ancillary-passenger"
            value={passengers[passengerIndex] ? passengerIndex : ""}
            onChange={e => setPassengerIndex(Number(e.target.value))}
          >
            <option value="" disabled>
              {t("manageAncillaries.choose")}
            </option>
            {passengers.map((_, i) => (
              <option key={i} value={i}>
                {paxLabel(i)}
              </option>
            ))}
          </select>
        </label>
        {catalog.isError || flight.isError ? (
          <div role="alert">
            {l(
              "تعذّر تحميل الخدمات لهذا القطاع.",
              "Services could not be loaded for this sector."
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void catalog.refetch();
                void flight.refetch();
              }}
            >
              {l("إعادة المحاولة", "Retry")}
            </Button>
          </div>
        ) : catalog.isLoading || flight.isLoading ? (
          <p role="status">{t("ancillary.loading")}</p>
        ) : products.length === 0 ? (
          <p>
            {l(
              "لا توجد خدمات إضافية متاحة لهذا القطاع.",
              "No extras are available for this sector."
            )}
          </p>
        ) : (
          <>
            <label>
              {l("الخدمة", "Service")}{" "}
              <select
                data-testid="ancillary-product"
                value={product?.id ?? ""}
                onChange={e => setProductId(Number(e.target.value))}
              >
                <option value="">{t("manageAncillaries.choose")}</option>
                {products.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {money(item.price)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {l("الكمية", "Quantity")}{" "}
              <input
                type="text"
                inputMode="numeric"
                data-testid="ancillary-quantity"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
              />
            </label>
            <Button
              type="button"
              data-testid="ancillary-add"
              disabled={!canAdd}
              onClick={() => {
                if (!canAdd || !product || !sector) return;
                onChange([
                  ...selected,
                  {
                    passengerIndex,
                    segmentIndex,
                    ancillaryServiceId: product.id,
                    quantity: qty,
                    unitPrice: product.price,
                    totalPrice: product.price * qty,
                    serviceName: product.name,
                    flightNumber: sector.flightNumber,
                  },
                ]);
                setProductId(0);
                setQuantity("1");
              }}
            >
              {l("إضافة الخدمة", "Add service")}
            </Button>
            {alreadyAdded && (
              <p>
                {l(
                  "أزل البند لتغيير كميته.",
                  "Remove the existing line to change its quantity."
                )}
              </p>
            )}
          </>
        )}
        {!catalog.isError && !flight.isError && unavailable.length > 0 && (
          <details>
            <summary>
              {l(
                "الخدمات غير المتاحة للشراء هنا",
                "Services unavailable for purchase here"
              )}
            </summary>
            <ul>
              {unavailable.map(item => (
                <li key={item.id}>
                  {item.name} · {unavailableReason(item)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </fieldset>
      {selected.length > 0 && (
        <div>
          <h3>
            {l("مراجعة الخدمات قبل الدفع", "Review extras before payment")}
          </h3>
          <ul data-testid="ancillary-review" className="space-y-2">
            {selected.map((item, i) => (
              <li
                key={
                  item.segmentIndex +
                  ":" +
                  item.passengerIndex +
                  ":" +
                  item.ancillaryServiceId
                }
              >
                {paxLabel(item.passengerIndex)} ·{" "}
                {t("manageAncillaries.sector")} {item.segmentIndex + 1} (
                {item.flightNumber}) · {item.serviceName} · {item.quantity} ×{" "}
                {money(item.unitPrice)} = {money(item.totalPrice)}{" "}
                {changedQuote(item) && (
                  <span role="status">
                    {l(
                      "تغير السعر أو التوفر. أزل البند واختره مجدداً لمراجعة العرض الحالي.",
                      "Price or availability changed. Remove this line and select again to review the current offer."
                    )}{" "}
                  </span>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => onChange(selected.filter((_, n) => n !== i))}
                >
                  {l("إزالة", "Remove")}
                </Button>
              </li>
            ))}
          </ul>
          <p>
            {t("ancillary.totalExtras")}{" "}
            {money(selected.reduce((sum, item) => sum + item.totalPrice, 0))}
          </p>
        </div>
      )}
    </Card>
  );
}
