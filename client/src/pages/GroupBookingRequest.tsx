import { useState } from "react";
import { useLocation, useRoute, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  Users,
  Plane,
  Mail,
  Phone,
  User,
  Percent,
  CheckCircle2,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

export default function GroupBookingRequest() {
  const { t, i18n } = useTranslation();
  const [, params] = useRoute("/group-booking/:id");
  const [, navigate] = useLocation();

  const flightId = params?.id ? parseInt(params.id) : 0;
  const currentLocale = i18n.language === "ar" ? ar : enUS;

  // Form state
  const [formData, setFormData] = useState({
    organizerName: "",
    organizerEmail: "",
    organizerPhone: "",
    groupSize: 10,
    notes: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<{
    id: number;
    suggestedDiscount: number;
    message: string;
  } | null>(null);

  // Fetch flight data
  const { data: flight, isLoading: flightLoading } =
    trpc.flights.getById.useQuery({ id: flightId });

  // Fetch discount tiers
  const { data: discountTiers } =
    trpc.groupBookings.getDiscountTiers.useQuery();

  // Calculate discount based on group size
  const { data: discountInfo } = trpc.groupBookings.calculateDiscount.useQuery(
    { groupSize: formData.groupSize },
    { enabled: formData.groupSize >= 1 }
  );

  // Submit mutation
  const submitRequest = trpc.groupBookings.submitRequest.useMutation({
    onSuccess: data => {
      setSubmitted(true);
      setSubmissionResult(data);
      toast.success(t("groupBooking.submitSuccess"));
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]:
        name === "groupSize" ? Math.max(10, parseInt(value) || 10) : value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !formData.organizerName ||
      !formData.organizerEmail ||
      !formData.organizerPhone
    ) {
      toast.error(t("groupBooking.fillAllFields"));
      return;
    }

    if (formData.groupSize < 10) {
      toast.error(t("groupBooking.minGroupSize"));
      return;
    }

    submitRequest.mutate({
      ...formData,
      flightId,
    });
  };

  if (flightLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (!flight) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">{t("common.error")}</h1>
          <p className="text-muted-foreground mb-4">
            {t("groupBooking.flightNotFound")}
          </p>
          <Link href="/">
            <Button>{t("common.back")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Success state
  if (submitted && submissionResult) {
    return (
      <div className="container mx-auto px-4 py-8">
        <SEO
          title={t("groupBooking.requestSubmitted")}
          description={t("groupBooking.requestSubmittedDesc")}
        />
        <div className="max-w-2xl mx-auto">
          <Card className="p-8 text-center">
            <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">
              {t("groupBooking.requestSubmitted")}
            </h1>
            <p className="text-muted-foreground mb-6">
              {submissionResult.message}
            </p>
            <div className="bg-muted/50 rounded-lg p-4 mb-6">
              <p className="text-sm text-muted-foreground mb-2">
                {t("groupBooking.requestId")}
              </p>
              <p className="text-2xl font-bold">#{submissionResult.id}</p>
              <p className="text-sm text-muted-foreground mt-2">
                {t("groupBooking.suggestedDiscount")}:{" "}
                <span className="font-semibold text-green-600">
                  {submissionResult.suggestedDiscount}%
                </span>
              </p>
            </div>
            <div className="flex gap-4 justify-center">
              <Link href="/">
                <Button variant="outline">{t("common.back")}</Button>
              </Link>
              <Link href="/search">
                <Button>{t("groupBooking.searchMoreFlights")}</Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <SEO
        title={t("groupBooking.title")}
        description={t("groupBooking.subtitle")}
      />

      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link
            href={`/booking/${flightId}`}
            className="flex items-center text-primary hover:underline mb-4"
          >
            <ChevronLeft className="h-4 w-4" />
            {t("common.back")}
          </Link>
          <h1 className="text-3xl font-bold mb-2">{t("groupBooking.title")}</h1>
          <p className="text-muted-foreground">{t("groupBooking.subtitle")}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Main Form */}
          <div className="md:col-span-2 space-y-6">
            {/* Flight Summary Card */}
            <Card className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <Plane className="h-8 w-8 text-primary" />
                <div>
                  <h2 className="text-lg font-semibold">
                    {flight.flightNumber}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {flight.airline.name}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{flight.origin.city}</p>
                  <p className="text-sm text-muted-foreground">
                    {flight.origin.code}
                  </p>
                </div>
                <div className="text-center">
                  <Plane className="h-4 w-4 text-muted-foreground mx-auto" />
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(new Date(flight.departureTime), "PPP", {
                      locale: currentLocale,
                    })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{flight.destination.city}</p>
                  <p className="text-sm text-muted-foreground">
                    {flight.destination.code}
                  </p>
                </div>
              </div>
            </Card>

            {/* Organizer Information Form */}
            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <User className="h-5 w-5" />
                {t("groupBooking.organizerInfo")}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="organizerName">
                    {t("groupBooking.organizerName")} *
                  </Label>
                  <Input
                    id="organizerName"
                    name="organizerName"
                    value={formData.organizerName}
                    onChange={handleInputChange}
                    placeholder={t("groupBooking.organizerNamePlaceholder")}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="organizerEmail">
                    {t("groupBooking.organizerEmail")} *
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="organizerEmail"
                      name="organizerEmail"
                      type="email"
                      value={formData.organizerEmail}
                      onChange={handleInputChange}
                      placeholder={t("groupBooking.organizerEmailPlaceholder")}
                      className="pl-10"
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="organizerPhone">
                    {t("groupBooking.organizerPhone")} *
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="organizerPhone"
                      name="organizerPhone"
                      type="tel"
                      value={formData.organizerPhone}
                      onChange={handleInputChange}
                      placeholder={t("groupBooking.organizerPhonePlaceholder")}
                      className="pl-10"
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="groupSize">
                    {t("groupBooking.groupSize")} *
                  </Label>
                  <div className="relative">
                    <Users className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="groupSize"
                      name="groupSize"
                      type="number"
                      min={10}
                      value={formData.groupSize}
                      onChange={handleInputChange}
                      className="pl-10"
                      required
                    />
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t("groupBooking.minGroupSizeInfo")}
                  </p>
                </div>

                <div>
                  <Label htmlFor="notes">{t("groupBooking.notes")}</Label>
                  <Textarea
                    id="notes"
                    name="notes"
                    value={formData.notes}
                    onChange={handleInputChange}
                    placeholder={t("groupBooking.notesPlaceholder")}
                    rows={4}
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={submitRequest.isPending}
                >
                  {submitRequest.isPending
                    ? t("common.loading")
                    : t("groupBooking.submitRequest")}
                </Button>
              </form>
            </Card>
          </div>

          {/* Sidebar - Discount Information */}
          <div className="space-y-6">
            {/* Current Discount Card */}
            <Card className="p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Percent className="h-5 w-5 text-green-600" />
                {t("groupBooking.yourDiscount")}
              </h3>
              {discountInfo && (
                <div className="text-center">
                  <div className="text-4xl font-bold text-green-600 mb-2">
                    {discountInfo.discountPercent}%
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {discountInfo.tier}
                  </p>
                  {!discountInfo.eligible && (
                    <p className="text-sm text-destructive mt-2">
                      {t("groupBooking.notEligible")}
                    </p>
                  )}
                </div>
              )}
            </Card>

            {/* Discount Tiers Card */}
            <Card className="p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Info className="h-5 w-5" />
                {t("groupBooking.discountTiers")}
              </h3>
              {discountTiers && (
                <div className="space-y-3">
                  {discountTiers.tiers.map((tier, index) => (
                    <div
                      key={index}
                      className={`p-3 rounded-lg border ${
                        formData.groupSize >= tier.minPassengers &&
                        (tier.maxPassengers === null ||
                          formData.groupSize <= tier.maxPassengers)
                          ? "border-green-500 bg-green-50 dark:bg-green-950"
                          : "border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{tier.name}</span>
                        <Badge variant="secondary">
                          {tier.discountPercent}%
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {tier.minPassengers}
                        {tier.maxPassengers
                          ? `-${tier.maxPassengers}`
                          : "+"}{" "}
                        {t("groupBooking.passengers")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* How It Works Card */}
            <Card className="p-6">
              <h3 className="font-semibold mb-4">
                {t("groupBooking.howItWorks")}
              </h3>
              <ol className="space-y-3 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <span className="font-bold text-primary">1.</span>
                  {t("groupBooking.step1")}
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-primary">2.</span>
                  {t("groupBooking.step2")}
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-primary">3.</span>
                  {t("groupBooking.step3")}
                </li>
              </ol>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
