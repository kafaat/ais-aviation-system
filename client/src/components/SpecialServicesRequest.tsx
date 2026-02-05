import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Utensils,
  Accessibility,
  Baby,
  Armchair,
  PawPrint,
  HeartPulse,
  Loader2,
  Plus,
  X,
  Check,
  Clock,
  AlertCircle,
} from "lucide-react";

interface Passenger {
  id: number;
  firstName: string;
  lastName: string;
  type: string;
}

interface SpecialServicesRequestProps {
  bookingId: number;
  passengers: Passenger[];
  onServiceAdded?: () => void;
}

type ServiceType =
  | "meal"
  | "wheelchair"
  | "unaccompanied_minor"
  | "extra_legroom"
  | "pet_in_cabin"
  | "medical_assistance";

const serviceTypeIcons: Record<
  ServiceType,
  React.ComponentType<{ className?: string }>
> = {
  meal: Utensils,
  wheelchair: Accessibility,
  unaccompanied_minor: Baby,
  extra_legroom: Armchair,
  pet_in_cabin: PawPrint,
  medical_assistance: HeartPulse,
};

const statusColors: Record<string, string> = {
  pending:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  confirmed:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

const statusIcons: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  pending: Clock,
  confirmed: Check,
  rejected: X,
  cancelled: AlertCircle,
};

export default function SpecialServicesRequest({
  bookingId,
  passengers,
  onServiceAdded,
}: SpecialServicesRequestProps) {
  const { t } = useTranslation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedPassenger, setSelectedPassenger] = useState<string>("");
  const [selectedServiceType, setSelectedServiceType] = useState<
    ServiceType | ""
  >("");
  const [selectedServiceCode, setSelectedServiceCode] = useState<string>("");
  const [additionalDetails, setAdditionalDetails] = useState<string>("");

  // Fetch available services
  const { data: availableServices } =
    trpc.specialServices.getAvailableServices.useQuery();

  // Fetch existing services for this booking
  const {
    data: bookingServices,
    isLoading: isLoadingServices,
    refetch: refetchServices,
  } = trpc.specialServices.getBookingServices.useQuery({ bookingId });

  // Request service mutation
  const requestServiceMutation =
    trpc.specialServices.requestService.useMutation({
      onSuccess: () => {
        toast.success(t("specialServices.requestSuccess"), {
          description: t("specialServices.requestSuccessDesc"),
        });
        setIsDialogOpen(false);
        resetForm();
        refetchServices();
        onServiceAdded?.();
      },
      onError: error => {
        toast.error(t("common.error"), {
          description: error.message,
        });
      },
    });

  // Cancel service mutation
  const cancelServiceMutation = trpc.specialServices.cancelService.useMutation({
    onSuccess: () => {
      toast.success(t("specialServices.cancelSuccess"), {
        description: t("specialServices.cancelSuccessDesc"),
      });
      refetchServices();
    },
    onError: error => {
      toast.error(t("common.error"), {
        description: error.message,
      });
    },
  });

  const resetForm = () => {
    setSelectedPassenger("");
    setSelectedServiceType("");
    setSelectedServiceCode("");
    setAdditionalDetails("");
  };

  const handleSubmit = () => {
    if (!selectedPassenger || !selectedServiceType || !selectedServiceCode) {
      toast.error(t("common.error"), {
        description: t("specialServices.fillAllFields"),
      });
      return;
    }

    const details = additionalDetails.trim()
      ? { notes: additionalDetails.trim() }
      : undefined;

    requestServiceMutation.mutate({
      bookingId,
      passengerId: parseInt(selectedPassenger),
      serviceType: selectedServiceType,
      serviceCode: selectedServiceCode,
      details,
    });
  };

  const handleCancel = (serviceId: number) => {
    cancelServiceMutation.mutate({ serviceId });
  };

  const getServiceCodesForType = (type: ServiceType) => {
    return availableServices?.[type] || [];
  };

  if (isLoadingServices) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("specialServices.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle>{t("specialServices.title")}</CardTitle>
          <CardDescription>{t("specialServices.description")}</CardDescription>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              {t("specialServices.addService")}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{t("specialServices.requestService")}</DialogTitle>
              <DialogDescription>
                {t("specialServices.requestServiceDesc")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {/* Passenger Selection */}
              <div className="space-y-2">
                <Label htmlFor="passenger">
                  {t("specialServices.selectPassenger")}
                </Label>
                <Select
                  value={selectedPassenger}
                  onValueChange={setSelectedPassenger}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t(
                        "specialServices.selectPassengerPlaceholder"
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {passengers.map(passenger => (
                      <SelectItem
                        key={passenger.id}
                        value={passenger.id.toString()}
                      >
                        {passenger.firstName} {passenger.lastName} (
                        {t(`booking.${passenger.type}`)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Service Type Selection */}
              <div className="space-y-2">
                <Label htmlFor="serviceType">
                  {t("specialServices.selectServiceType")}
                </Label>
                <Select
                  value={selectedServiceType}
                  onValueChange={(value: ServiceType) => {
                    setSelectedServiceType(value);
                    setSelectedServiceCode("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t(
                        "specialServices.selectServiceTypePlaceholder"
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.keys(availableServices || {}) as ServiceType[]
                    ).map(type => {
                      const Icon = serviceTypeIcons[type];
                      return (
                        <SelectItem key={type} value={type}>
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4" />
                            {t(`specialServices.types.${type}`)}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* Service Code Selection */}
              {selectedServiceType && (
                <div className="space-y-2">
                  <Label htmlFor="serviceCode">
                    {t("specialServices.selectService")}
                  </Label>
                  <Select
                    value={selectedServiceCode}
                    onValueChange={setSelectedServiceCode}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={t(
                          "specialServices.selectServicePlaceholder"
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {getServiceCodesForType(selectedServiceType).map(
                        service => (
                          <SelectItem key={service.code} value={service.code}>
                            <div className="flex flex-col">
                              <span className="font-medium">
                                {service.name}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {service.code} - {service.description}
                              </span>
                            </div>
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Additional Details */}
              <div className="space-y-2">
                <Label htmlFor="details">
                  {t("specialServices.additionalDetails")}
                </Label>
                <Textarea
                  id="details"
                  placeholder={t(
                    "specialServices.additionalDetailsPlaceholder"
                  )}
                  value={additionalDetails}
                  onChange={e => setAdditionalDetails(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={requestServiceMutation.isPending}
              >
                {requestServiceMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {t("specialServices.submitRequest")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {bookingServices && bookingServices.length > 0 ? (
          <div className="space-y-4">
            <Accordion type="single" collapsible className="w-full">
              {(Object.keys(availableServices || {}) as ServiceType[]).map(
                type => {
                  const servicesOfType = bookingServices.filter(
                    s => s.serviceType === type
                  );
                  if (servicesOfType.length === 0) return null;

                  const Icon = serviceTypeIcons[type];

                  return (
                    <AccordionItem key={type} value={type}>
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-2">
                          <Icon className="h-5 w-5 text-primary" />
                          <span>{t(`specialServices.types.${type}`)}</span>
                          <Badge variant="secondary" className="ml-2">
                            {servicesOfType.length}
                          </Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-3 pt-2">
                          {servicesOfType.map(service => {
                            const StatusIcon = statusIcons[service.status];
                            const serviceInfo = getServiceCodesForType(
                              type as ServiceType
                            ).find(s => s.code === service.serviceCode);

                            return (
                              <div
                                key={service.id}
                                className="flex items-center justify-between rounded-lg border p-3"
                              >
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">
                                      {serviceInfo?.name || service.serviceCode}
                                    </span>
                                    <Badge
                                      variant="outline"
                                      className={statusColors[service.status]}
                                    >
                                      <StatusIcon className="mr-1 h-3 w-3" />
                                      {t(
                                        `specialServices.status.${service.status}`
                                      )}
                                    </Badge>
                                  </div>
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    {t("specialServices.for")}:{" "}
                                    {service.passengerName}
                                  </p>
                                  {service.adminNotes && (
                                    <p className="mt-1 text-sm text-muted-foreground">
                                      {t("specialServices.notes")}:{" "}
                                      {service.adminNotes}
                                    </p>
                                  )}
                                </div>
                                {(service.status === "pending" ||
                                  service.status === "confirmed") && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleCancel(service.id)}
                                    disabled={cancelServiceMutation.isPending}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                }
              )}
            </Accordion>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="rounded-full bg-muted p-3 mb-3">
              <Utensils className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">
              {t("specialServices.noServices")}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {t("specialServices.noServicesHint")}
            </p>
          </div>
        )}

        {/* Service Types Information */}
        <Separator className="my-6" />
        <div className="space-y-4">
          <h4 className="text-sm font-medium">
            {t("specialServices.availableTypes")}
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {(Object.keys(serviceTypeIcons) as ServiceType[]).map(type => {
              const Icon = serviceTypeIcons[type];
              return (
                <div
                  key={type}
                  className="flex items-center gap-2 rounded-lg border p-3"
                >
                  <Icon className="h-5 w-5 text-primary" />
                  <span className="text-sm">
                    {t(`specialServices.types.${type}`)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
