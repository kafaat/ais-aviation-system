import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Share2, Copy, Plane, Clock } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

interface ItineraryShareProps {
  bookingId: number;
}

export function ItineraryShare({ bookingId }: ItineraryShareProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === "ar" ? ar : enUS;

  const { data: itinerary } =
    trpc.travelScenarios.getShareableItinerary.useQuery(
      { bookingId },
      { enabled: bookingId > 0 }
    );

  const generateShareText = () => {
    if (!itinerary) return "";
    const dep = format(
      new Date(itinerary.departureTime),
      "EEEE, d MMMM yyyy HH:mm",
      { locale: dateLocale }
    );
    const arr = format(new Date(itinerary.arrivalTime), "HH:mm", {
      locale: dateLocale,
    });
    const passengerNames = itinerary.passengers
      .map(p => p.firstName)
      .join(", ");

    return [
      `✈️ ${itinerary.flightNumber}`,
      `${itinerary.origin.city} (${itinerary.origin.code}) → ${itinerary.destination.city} (${itinerary.destination.code})`,
      `📅 ${dep} - ${arr}`,
      `👤 ${passengerNames}`,
      `🎫 ${t("rebook.ref")}: ${itinerary.bookingReference}`,
    ].join("\n");
  };

  const handleCopy = async () => {
    const text = generateShareText();
    await navigator.clipboard.writeText(text);
    toast.success(t("itineraryShare.copied"));
  };

  const handleNativeShare = async () => {
    const text = generateShareText();
    if (navigator.share) {
      try {
        await navigator.share({
          title: t("itineraryShare.title"),
          text,
        });
      } catch {
        // User cancelled
      }
    } else {
      handleCopy();
    }
  };

  if (!itinerary) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-xl">
          <Share2 className="h-4 w-4 me-2" />
          {t("itineraryShare.share")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("itineraryShare.title")}</DialogTitle>
        </DialogHeader>

        <Card className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-0">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
              <Plane className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <p className="font-bold">{itinerary.flightNumber}</p>
              <p className="text-xs text-muted-foreground">
                {itinerary.bookingReference}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <span className="font-semibold text-blue-600">
              {itinerary.origin.code}
            </span>
            <div className="flex-1 border-t border-dashed" />
            <span className="font-semibold text-indigo-600">
              {itinerary.destination.code}
            </span>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Clock className="h-3 w-3" />
            <span>
              {format(
                new Date(itinerary.departureTime),
                "EEEE, d MMMM yyyy HH:mm",
                { locale: dateLocale }
              )}
            </span>
          </div>

          <p className="text-sm text-muted-foreground">
            {itinerary.passengers.map(p => p.firstName).join(", ")} (
            {itinerary.numberOfPassengers})
          </p>
        </Card>

        <div className="flex gap-2 mt-2">
          <Button onClick={handleNativeShare} className="flex-1">
            <Share2 className="h-4 w-4 me-2" />
            {t("itineraryShare.share")}
          </Button>
          <Button onClick={handleCopy} variant="outline" className="flex-1">
            <Copy className="h-4 w-4 me-2" />
            {t("itineraryShare.copy")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
