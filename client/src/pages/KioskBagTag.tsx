import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import { interleaved2of5, drawingSVG } from "bwip-js/browser";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import "./kiosk-bag-tag.css";

export default function KioskBagTag() {
  const { t } = useTranslation();
  const prepare = trpc.kiosk.reprintRegisteredTag.useMutation({
    retry: false,
    gcTime: 0,
  });
  type PrintInput = Parameters<typeof prepare.mutateAsync>[0];
  type TagDocument = NonNullable<typeof prepare.data>;
  const [selection, setSelection] = useState<{
    input: PrintInput;
    document: TagDocument;
  }>();
  const [outcome, setOutcome] = useState<
    "ready" | "failed" | "unknown" | "reported" | "unavailable"
  >("ready");
  const busy = prepare.isPending;
  const { reset } = prepare;
  const printCopy = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const clear = useCallback(() => {
    generation.current += 1;
    setSelection(undefined);
    setOutcome("ready");
    // Detach the mutation observer too: gcTime alone cannot remove the
    // personal document while this mounted page still observes its result.
    reset();
  }, [reset]);

  useEffect(() => {
    if (!selection) return;
    // Clear personal information on an unattended shared kiosk.
    const timer = window.setTimeout(clear, 120000);
    return () => window.clearTimeout(timer);
  }, [selection, outcome, clear]);

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const tagNumber = String(fields.get("tagNumber")).trim();
    const request = ++generation.current;
    setOutcome("ready");
    try {
      const input = {
        bookingRef: String(fields.get("reference")).trim(),
        lastName: String(fields.get("surname")).trim(),
        tagNumber,
      };
      const document = await prepare.mutateAsync(input);
      if (request !== generation.current) return;
      setSelection({
        input: { ...input, expectedVersion: document.documentVersion },
        document,
      });
    } catch {
      if (request !== generation.current) return;
      setOutcome("unavailable");
    }
  }

  async function reprint() {
    const selectedCopy = printCopy.current;
    if (!selectedCopy || !selection || busy) return;
    const request = generation.current;
    try {
      // A station may have loaded the bag since the preview was opened.
      await prepare.mutateAsync(selection.input);
    } catch {
      if (request !== generation.current) return;
      clear();
      setOutcome("unavailable");
      return;
    }
    try {
      if (request !== generation.current || printCopy.current !== selectedCopy)
        return;
      window.print();
      setOutcome("unknown");
    } catch {
      setOutcome("failed");
    }
  }

  const tag = selection?.document.bagTags[0];
  const label = tag && (
    <section aria-label={t("kioskBagTag.document")} className="space-y-2">
      <h2 className="font-bold">{t("kioskBagTag.document")}</h2>
      <p>{selection.document.passengerName}</p>
      <p>
        <bdi>
          {tag.flightNumber} · {tag.origin} → {tag.destination}
        </bdi>
      </p>
      <p>
        <bdi>{tag.bookingReference}</bdi>
      </p>
      <img
        width="260"
        height="70"
        alt={t("kioskBagTag.barcode")}
        src={
          "data:image/svg+xml;charset=utf-8," +
          encodeURIComponent(
            interleaved2of5(
              {
                bcid: "interleaved2of5",
                text: tag.barcodeData,
                height: 14,
                paddingwidth: 6,
                scale: 2,
              },
              drawingSVG()
            )
          )
        }
      />
      <p className="font-mono text-lg">
        <bdi>{tag.tagNumber}</bdi>
      </p>
    </section>
  );

  return (
    <main className="container max-w-xl space-y-5 py-10" id="main-content">
      <Link href="/" className="underline">
        {t("manageBooking.backHome")}
      </Link>
      <h1 className="text-3xl font-bold">{t("kioskBagTag.title")}</h1>
      {!selection ? (
        <Card className="p-6">
          <p>{t("kioskBagTag.help")}</p>
          <form
            method="post"
            onSubmit={lookup}
            aria-busy={busy}
            autoComplete="off"
          >
            <fieldset disabled={busy} className="space-y-3">
              <Label htmlFor="kiosk-reference">
                {t("manageBooking.reference")}
              </Label>
              <Input
                id="kiosk-reference"
                name="reference"
                required
                maxLength={6}
                dir="ltr"
              />
              <Label htmlFor="kiosk-surname">
                {t("manageBooking.surname")}
              </Label>
              <Input
                id="kiosk-surname"
                name="surname"
                required
                maxLength={100}
              />
              <Label htmlFor="kiosk-tag">{t("kioskBagTag.number")}</Label>
              <Input
                id="kiosk-tag"
                name="tagNumber"
                required
                pattern="[0-9]{10}"
                maxLength={10}
                inputMode="numeric"
                dir="ltr"
              />
              <Button type="submit">{t("kioskBagTag.find")}</Button>
            </fieldset>
          </form>
          {outcome === "unavailable" && (
            <p role="alert">{t("kioskBagTag.unavailable")}</p>
          )}
        </Card>
      ) : (
        <Card className="p-6">
          {label}
          <p role="status">{t(`kioskBagTag.${outcome}`)}</p>
          {outcome === "unknown" && (
            <Button variant="outline" onClick={() => setOutcome("reported")}>
              {t("kioskBagTag.noCopy")}
            </Button>
          )}
          <Button onClick={reprint} disabled={busy}>
            {t("kioskBagTag.reprint")}
          </Button>
          <Button variant="outline" onClick={clear}>
            {t("kioskBagTag.finish")}
          </Button>
        </Card>
      )}
      {label &&
        createPortal(
          <div id="kiosk-print-copy" ref={printCopy}>
            {label}
          </div>,
          document.body
        )}
    </main>
  );
}
