import { useState } from "react";
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
  const [selectedTab, setSelectedTab] = useState<"date" | "upgrade">("date");
  const [selectedFlightId, _setSelectedFlightId] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

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

  const requestChangeDateMutation =
    trpc.modifications.requestChangeDate.useMutation({
      onSuccess: async data => {
        if (data.requiresPayment && data.totalCost > 0) {
          toast.success(
            "Modification request created! Redirecting to payment..."
          );
          // TODO: Create Stripe payment intent for the difference
        } else if (data.totalCost < 0) {
          toast.success(
            `Modification approved! You'll receive a refund of ${Math.abs(data.totalCost / 100)} SAR`
          );
        } else {
          toast.success("Modification request submitted successfully!");
        }
        await utils.bookings.myBookings.invalidate();
        onOpenChange(false);
        setIsProcessing(false);
      },
      onError: error => {
        toast.error(error.message || "Failed to request modification");
        setIsProcessing(false);
      },
    });

  const requestUpgradeMutation = trpc.modifications.requestUpgrade.useMutation({
    onSuccess: async _data => {
      toast.success("Upgrade request created! Redirecting to payment...");
      // TODO: Create Stripe payment intent for upgrade
      await utils.bookings.myBookings.invalidate();
      onOpenChange(false);
      setIsProcessing(false);
    },
    onError: error => {
      toast.error(error.message || "Failed to request upgrade");
      setIsProcessing(false);
    },
  });

  const _handleChangeDate = () => {
    if (!selectedFlightId) {
      toast.error("Please select a new flight");
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
            تعديل الحجز
            <Badge variant="outline">{booking.bookingReference}</Badge>
          </DialogTitle>
          <DialogDescription>
            رحلة {booking.flightNumber} • {booking.originName} →{" "}
            {booking.destinationName}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={selectedTab}
          onValueChange={v => setSelectedTab(v as "date" | "upgrade")}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="date" className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              تغيير التاريخ
            </TabsTrigger>
            <TabsTrigger
              value="upgrade"
              className="flex items-center gap-2"
              disabled={booking.cabinClass === "business"}
            >
              <ArrowUpCircle className="h-4 w-4" />
              ترقية الدرجة
            </TabsTrigger>
          </TabsList>

          <TabsContent value="date" className="space-y-4">
            <div className="rounded-lg border p-4 bg-muted/50">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium mb-1">سياسة تغيير التاريخ</p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>• أكثر من 7 أيام: بدون رسوم</li>
                    <li>• 3-7 أيام: رسوم 5%</li>
                    <li>• 1-3 أيام: رسوم 10%</li>
                    <li>• أقل من 24 ساعة: رسوم 15%</li>
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
                  يرجى التواصل مع خدمة العملاء لتغيير تاريخ الرحلة
                </p>
                <p className="text-xs text-muted-foreground">
                  سيتم إضافة خاصية البحث عن رحلات بديلة قريباً
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="upgrade" className="space-y-4">
            <div className="rounded-lg border p-4 bg-muted/50">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium mb-1">ترقية إلى درجة الأعمال</p>
                  <p className="text-muted-foreground">
                    استمتع بمقاعد أوسع، خدمة مميزة، وأولوية في الصعود
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-sm text-muted-foreground">
                  السعر الحالي (درجة الاقتصاد)
                </span>
                <span className="font-medium">
                  {(booking.totalAmount / 100).toFixed(2)} ر.س
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-sm text-muted-foreground">
                  السعر بعد الترقية (تقديري)
                </span>
                <span className="font-medium">
                  {((booking.totalAmount * 2) / 100).toFixed(2)} ر.س
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-sm font-medium">الفرق المطلوب دفعه</span>
                <span className="font-bold text-lg text-primary">
                  {(booking.totalAmount / 100).toFixed(2)} ر.س
                </span>
              </div>
            </div>

            <div className="rounded-lg border p-4 bg-green-50 dark:bg-green-950/20">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-green-900 dark:text-green-100 mb-1">
                    مزايا درجة الأعمال
                  </p>
                  <ul className="space-y-1 text-green-700 dark:text-green-200">
                    <li>• مقاعد قابلة للإمالة بالكامل</li>
                    <li>• وجبات فاخرة ومشروبات مجانية</li>
                    <li>• أولوية في تسجيل الوصول والصعود</li>
                    <li>• حقيبة إضافية مجاناً</li>
                  </ul>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
          >
            إلغاء
          </Button>
          {selectedTab === "upgrade" && booking.cabinClass !== "business" && (
            <Button onClick={handleUpgrade} disabled={isProcessing}>
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  جاري المعالجة...
                </>
              ) : (
                "تأكيد الترقية"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
