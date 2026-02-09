import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Calendar,
  ArrowUpCircle,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { PaymentMethodSelector } from "./PaymentMethodSelector";

interface ModifyBookingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: {
    id: number;
    bookingReference: string;
    flightNumber: string;
    cabinClass: string;
    totalAmount: number;
    originName: string;
    destinationName: string;
    originId?: number;
    destinationId?: number;
  };
}

export function ModifyBookingDialog({
  open,
  onOpenChange,
  booking,
}: ModifyBookingDialogProps) {
  const { t } = useTranslation();
  const [selectedTab, setSelectedTab] = useState<"date" | "upgrade">("date");
  const [selectedFlightId, _setSelectedFlightId] = useState<number | null>(
    null
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState("stripe");

  const utils = trpc.useUtils();

  // Search for alternative flights on the same route
  // Only enabled when both origin and destination IDs are available
  const hasRouteIds = Boolean(booking.originId && booking.destinationId);
  const { data: _alternativeFlights, isLoading: isSearching } =
    trpc.flights.search.useQuery(
      {
        originId: booking.originId || 0,
        destinationId: booking.destinationId || 0,
        departureDate: new Date(),
      },
      { enabled: selectedTab === "date" && open && hasRouteIds }
    );

  const createModificationCheckout =
    trpc.payments.createModificationCheckout.useMutation({
      onSuccess: data => {
        if (data.url) {
          window.location.href = data.url;
        } else {
          toast.success(t("modifyBooking.paymentInitiated"));
        }
      },
      onError: error => {
        toast.error(error.message || t("modifyBooking.paymentError"));
        setIsProcessing(false);
      },
    });

  const requestChangeDateMutation =
    trpc.modifications.requestChangeDate.useMutation({
      onSuccess: async data => {
        if (data.requiresPayment && data.totalCost > 0) {
          toast.success(t("modifyBooking.dateChangePaymentRedirect"));
          createModificationCheckout.mutate({
            bookingId: booking.id,
            modificationId: data.modificationId,
            amount: data.totalCost,
            provider: selectedProvider as Parameters<
              typeof createModificationCheckout.mutate
            >[0]["provider"],
          });
        } else if (data.totalCost < 0) {
          toast.success(
            t("modifyBooking.dateChangeRefund", {
              amount: Math.abs(data.totalCost / 100),
            })
          );
          await utils.bookings.myBookings.invalidate();
          onOpenChange(false);
          setIsProcessing(false);
        } else {
          toast.success(t("modifyBooking.dateChangeSuccess"));
          await utils.bookings.myBookings.invalidate();
          onOpenChange(false);
          setIsProcessing(false);
        }
      },
      onError: error => {
        toast.error(error.message || t("modifyBooking.dateChangeError"));
        setIsProcessing(false);
      },
    });

  const requestUpgradeMutation = trpc.modifications.requestUpgrade.useMutation({
    onSuccess: async data => {
      toast.success(t("modifyBooking.upgradePaymentRedirect"));
      createModificationCheckout.mutate({
        bookingId: booking.id,
        modificationId: data.modificationId,
        amount: data.totalCost,
        provider: selectedProvider as Parameters<
          typeof createModificationCheckout.mutate
        >[0]["provider"],
      });
    },
    onError: error => {
      toast.error(error.message || t("modifyBooking.upgradeError"));
      setIsProcessing(false);
    },
  });

  const _handleChangeDate = () => {
    if (!selectedFlightId) {
      toast.error(t("modifyBooking.selectFlightError"));
      return;
    }

    setIsProcessing(true);
    requestChangeDateMutation.mutate({
      bookingId: booking.id,
      newFlightId: selectedFlightId,
      reason: "Customer requested date change",
    });
  };

  const handleUpgrade = () => {
    setIsProcessing(true);
    requestUpgradeMutation.mutate({
      bookingId: booking.id,
      reason: "Customer requested cabin upgrade",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("modifyBooking.title")}
            <Badge variant="outline">{booking.bookingReference}</Badge>
          </DialogTitle>
          <DialogDescription>
            {t("modifyBooking.flightInfo", {
              flightNumber: booking.flightNumber,
              origin: booking.originName,
              destination: booking.destinationName,
            })}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={selectedTab}
          onValueChange={v => setSelectedTab(v as "date" | "upgrade")}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="date" className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              {t("modifyBooking.changeDateTab")}
            </TabsTrigger>
            <TabsTrigger
              value="upgrade"
              className="flex items-center gap-2"
              disabled={booking.cabinClass === "business"}
            >
              <ArrowUpCircle className="h-4 w-4" />
              {t("modifyBooking.upgradeTab")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="date" className="space-y-4">
            <div className="rounded-lg border p-4 bg-muted/50">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium mb-1">
                    {t("modifyBooking.dateChangePolicy")}
                  </p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>{t("modifyBooking.policyMoreThan7Days")}</li>
                    <li>{t("modifyBooking.policy3to7Days")}</li>
                    <li>{t("modifyBooking.policy1to3Days")}</li>
                    <li>{t("modifyBooking.policyLessThan24Hours")}</li>
                  </ul>
                </div>
              </div>
            </div>

            {isSearching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t("modifyBooking.contactCustomerService")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("modifyBooking.alternativeFlightsComingSoon")}
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="upgrade" className="space-y-4">
            <div className="rounded-lg border p-4 bg-muted/50">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium mb-1">
                    {t("modifyBooking.upgradeTitle")}
                  </p>
                  <p className="text-muted-foreground">
                    {t("modifyBooking.upgradeDescription")}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-sm text-muted-foreground">
                  {t("modifyBooking.currentPrice")}
                </span>
                <span className="font-medium">
                  {(booking.totalAmount / 100).toFixed(2)} {t("common.sar")}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-sm text-muted-foreground">
                  {t("modifyBooking.upgradePrice")}
                </span>
                <span className="font-medium">
                  {((booking.totalAmount * 2) / 100).toFixed(2)}{" "}
                  {t("common.sar")}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-sm font-medium">
                  {t("modifyBooking.priceDifference")}
                </span>
                <span className="font-bold text-lg text-primary">
                  {(booking.totalAmount / 100).toFixed(2)} {t("common.sar")}
                </span>
              </div>
            </div>

            <div className="rounded-lg border p-4 bg-green-50 dark:bg-green-950/20">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-green-900 dark:text-green-100 mb-1">
                    {t("modifyBooking.businessBenefits")}
                  </p>
                  <ul className="space-y-1 text-green-700 dark:text-green-200">
                    <li>{t("modifyBooking.benefitFullyReclining")}</li>
                    <li>{t("modifyBooking.benefitGourmetMeals")}</li>
                    <li>{t("modifyBooking.benefitPriorityBoarding")}</li>
                    <li>{t("modifyBooking.benefitExtraBag")}</li>
                  </ul>
                </div>
              </div>
            </div>

            <PaymentMethodSelector
              onProviderSelect={setSelectedProvider}
              selectedProvider={selectedProvider}
              amount={booking.totalAmount}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
          >
            {t("common.cancel")}
          </Button>
          {selectedTab === "upgrade" && booking.cabinClass !== "business" && (
            <Button onClick={handleUpgrade} disabled={isProcessing}>
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("modifyBooking.processing")}
                </>
              ) : (
                t("modifyBooking.confirmUpgrade")
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
