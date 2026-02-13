/**
 * PayYourShare Page
 *
 * Landing page for payers who receive a split payment request.
 * Accessed via unique payment token from email link.
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useRoute, useLocation } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plane,
  Calendar,
  MapPin,
  CreditCard,
  AlertCircle,
  CheckCircle,
  Clock,
  XCircle,
  Loader2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

function LoadingSkeleton() {
  return (
    <Card className="w-full max-w-lg mx-auto">
      <CardHeader>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64 mt-2" />
      </CardHeader>
      <CardContent className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  );
}

function PaymentSuccess({ bookingReference }: { bookingReference: string }) {
  const { t } = useTranslation();

  return (
    <Card className="w-full max-w-lg mx-auto text-center">
      <CardContent className="pt-12 pb-8 space-y-6">
        <div className="flex justify-center">
          <div className="p-4 rounded-full bg-green-100 text-green-600">
            <CheckCircle className="h-12 w-12" />
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">
            {t("splitPayment.paymentComplete")}
          </h2>
          <p className="text-muted-foreground">
            {t("splitPayment.paymentCompleteDescription")}
          </p>
        </div>
        <Alert className="text-left">
          <CheckCircle className="h-4 w-4" />
          <AlertTitle>{t("splitPayment.bookingRef")}</AlertTitle>
          <AlertDescription className="font-mono text-lg">
            {bookingReference}
          </AlertDescription>
        </Alert>
        <p className="text-sm text-muted-foreground">
          {t("splitPayment.confirmationEmailSent")}
        </p>
      </CardContent>
    </Card>
  );
}

function PaymentExpired() {
  const { t } = useTranslation();

  return (
    <Card className="w-full max-w-lg mx-auto text-center">
      <CardContent className="pt-12 pb-8 space-y-6">
        <div className="flex justify-center">
          <div className="p-4 rounded-full bg-orange-100 text-orange-600">
            <Clock className="h-12 w-12" />
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">
            {t("splitPayment.paymentExpired")}
          </h2>
          <p className="text-muted-foreground">
            {t("splitPayment.paymentExpiredDescription")}
          </p>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {t("splitPayment.contactOrganizer")}
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

function PaymentNotFound() {
  const { t } = useTranslation();

  return (
    <Card className="w-full max-w-lg mx-auto text-center">
      <CardContent className="pt-12 pb-8 space-y-6">
        <div className="flex justify-center">
          <div className="p-4 rounded-full bg-destructive/10 text-destructive">
            <XCircle className="h-12 w-12" />
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">{t("splitPayment.notFound")}</h2>
          <p className="text-muted-foreground">
            {t("splitPayment.notFoundDescription")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function AlreadyPaid({ payerName }: { payerName: string }) {
  const { t } = useTranslation();

  return (
    <Card className="w-full max-w-lg mx-auto text-center">
      <CardContent className="pt-12 pb-8 space-y-6">
        <div className="flex justify-center">
          <div className="p-4 rounded-full bg-green-100 text-green-600">
            <CheckCircle className="h-12 w-12" />
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">
            {t("splitPayment.alreadyPaid")}
          </h2>
          <p className="text-muted-foreground">
            {t("splitPayment.alreadyPaidDescription", { name: payerName })}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function PayYourShare() {
  const { t } = useTranslation();
  const [, params] = useRoute("/pay/:token/:status?");
  const [, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const wasCancelled = searchParams.get("cancelled") === "true";
  const sessionId = searchParams.get("session_id");

  const paymentToken = params?.token || "";
  const successStatus = params?.status === "success";

  const {
    data: paymentDetails,
    isLoading,
    error,
  } = trpc.splitPayments.getPayerDetails.useQuery(
    { paymentToken },
    { enabled: !!paymentToken && paymentToken.length === 64 }
  );

  const checkoutMutation = trpc.splitPayments.createPayerCheckout.useMutation({
    onSuccess: data => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: error => {
      toast.error(error.message || t("splitPayment.checkoutError"));
    },
  });

  // Show toast if payment was cancelled
  useEffect(() => {
    if (wasCancelled) {
      toast.error(t("splitPayment.paymentCancelled"));
      // Clear the query params
      setLocation(`/pay/${paymentToken}`, { replace: true });
    }
  }, [wasCancelled, paymentToken, setLocation, t]);

  // Handle successful payment return
  if (successStatus && sessionId && paymentDetails) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <PaymentSuccess bookingReference={paymentDetails.bookingReference} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <LoadingSkeleton />
      </div>
    );
  }

  if (error || !paymentDetails) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <PaymentNotFound />
      </div>
    );
  }

  // Check for expired or cancelled status
  if (
    paymentDetails.status === "expired" ||
    (paymentDetails.expiresAt &&
      new Date(paymentDetails.expiresAt) < new Date())
  ) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <PaymentExpired />
      </div>
    );
  }

  // Check if already paid
  if (paymentDetails.status === "paid") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <AlreadyPaid payerName={paymentDetails.payerName} />
      </div>
    );
  }

  // Check if cancelled
  if (paymentDetails.status === "cancelled") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg mx-auto text-center">
          <CardContent className="pt-12 pb-8 space-y-6">
            <div className="flex justify-center">
              <div className="p-4 rounded-full bg-destructive/10 text-destructive">
                <XCircle className="h-12 w-12" />
              </div>
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold">
                {t("splitPayment.paymentCancelledTitle")}
              </h2>
              <p className="text-muted-foreground">
                {t("splitPayment.paymentCancelledDescription")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handlePay = () => {
    checkoutMutation.mutate({ paymentToken });
  };

  const formatAmount = (amount: number) => {
    return `${(amount / 100).toFixed(2)} ${t("common.currency")}`;
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("ar-SA", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-lg mx-auto">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 rounded-full bg-primary/10 text-primary">
              <CreditCard className="h-8 w-8" />
            </div>
          </div>
          <CardTitle className="text-2xl">
            {t("splitPayment.payYourShareTitle")}
          </CardTitle>
          <CardDescription>
            {t("splitPayment.payYourShareDescription", {
              name: paymentDetails.payerName,
            })}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Flight Details */}
          <div className="p-4 bg-muted rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Plane className="h-4 w-4" />
                <span className="text-sm">
                  {t("splitPayment.flightNumber")}
                </span>
              </div>
              <Badge variant="outline">{paymentDetails.flightNumber}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span className="text-sm">{t("splitPayment.route")}</span>
              </div>
              <span className="font-medium">{paymentDetails.route}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span className="text-sm">{t("splitPayment.departure")}</span>
              </div>
              <span className="text-sm">
                {formatDate(paymentDetails.departureTime)}
              </span>
            </div>
          </div>

          <Separator />

          {/* Amount to Pay */}
          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              {t("splitPayment.yourShare")}
            </p>
            <p className="text-4xl font-bold text-primary">
              {formatAmount(paymentDetails.amount)}
            </p>
          </div>

          {/* Expiration Notice */}
          {paymentDetails.expiresAt && (
            <Alert>
              <Clock className="h-4 w-4" />
              <AlertDescription>
                {t("splitPayment.expiresAt", {
                  date: new Date(paymentDetails.expiresAt).toLocaleDateString(
                    "ar-SA"
                  ),
                })}
              </AlertDescription>
            </Alert>
          )}

          <Separator />

          {/* Pay Button */}
          <Button
            onClick={handlePay}
            disabled={checkoutMutation.isPending}
            className="w-full h-12 text-lg"
          >
            {checkoutMutation.isPending ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                {t("splitPayment.redirecting")}
              </>
            ) : (
              <>
                <CreditCard className="h-5 w-5 mr-2" />
                {t("splitPayment.payNow")}
              </>
            )}
          </Button>

          {/* Booking Reference */}
          <div className="text-center text-sm text-muted-foreground">
            <span>{t("splitPayment.bookingRef")}: </span>
            <span className="font-mono font-medium">
              {paymentDetails.bookingReference}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default PayYourShare;
