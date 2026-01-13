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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";

interface CancelBookingDialogProps {
  bookingId: number;
  bookingReference: string;
  totalAmount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CancelBookingDialog({
  bookingId,
  bookingReference,
  totalAmount,
  open,
  onOpenChange,
  onSuccess,
}: CancelBookingDialogProps) {
  const [reason, setReason] = useState<string>("requested_by_customer");
  const [notes, setNotes] = useState("");

  const utils = trpc.useUtils();

  // Check if booking is refundable
  const { data: refundCheck, isLoading: checkingRefundable } =
    trpc.refunds.checkRefundable.useQuery({ bookingId }, { enabled: open });

  // Calculate cancellation fee
  const { data: cancellationFee } =
    trpc.refunds.calculateCancellationFee.useQuery(
      { bookingId },
      { enabled: open && refundCheck?.refundable === true }
    );

  // Create refund mutation
  const createRefund = trpc.refunds.create.useMutation({
    onSuccess: () => {
      toast.success("تم إلغاء الحجز واسترداد المبلغ بنجاح");
      utils.bookings.myBookings.invalidate();
      onSuccess();
      onOpenChange(false);
    },
    onError: error => {
      toast.error(error.message || "حدث خطأ أثناء إلغاء الحجز");
    },
  });

  const handleCancel = () => {
    if (!refundCheck?.refundable) {
      toast.error("لا يمكن إلغاء هذا الحجز");
      return;
    }

    createRefund.mutate({
      bookingId,
      reason,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>إلغاء الحجز واسترداد المبلغ</DialogTitle>
          <DialogDescription>رقم الحجز: {bookingReference}</DialogDescription>
        </DialogHeader>

        {checkingRefundable ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !refundCheck?.refundable ? (
          <div className="py-4">
            <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
              <div>
                <p className="font-medium text-destructive mb-1">
                  لا يمكن إلغاء هذا الحجز
                </p>
                <p className="text-sm text-muted-foreground">
                  {refundCheck?.reason || "الحجز غير قابل للإلغاء"}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {/* Refund Amount with Cancellation Fee */}
            {cancellationFee ? (
              <div
                className={`p-4 border rounded-lg ${
                  cancellationFee.cancellationFee > 0
                    ? "bg-orange-50 border-orange-200"
                    : "bg-primary/5 border-primary/20"
                }`}
              >
                <p className="text-sm font-semibold mb-3">
                  {cancellationFee.tier === "full"
                    ? "استرداد كامل (100%)"
                    : `استرداد ${cancellationFee.refundPercentage}%`}
                </p>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      المبلغ الأصلي:
                    </span>
                    <span className="font-medium">
                      {(cancellationFee.totalAmount / 100).toFixed(2)} ر.س
                    </span>
                  </div>

                  {cancellationFee.cancellationFee > 0 && (
                    <div className="flex justify-between text-orange-700">
                      <span>
                        رسوم الإلغاء ({100 - cancellationFee.refundPercentage}
                        %):
                      </span>
                      <span className="font-medium">
                        -{(cancellationFee.cancellationFee / 100).toFixed(2)}{" "}
                        ر.س
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between pt-2 border-t">
                    <span className="font-semibold">المبلغ المسترد:</span>
                    <span className="text-2xl font-bold text-green-600">
                      {(cancellationFee.refundAmount / 100).toFixed(2)} ر.س
                    </span>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground mt-3">
                  سيتم استرداد المبلغ إلى طريقة الدفع الأصلية خلال 5-10 أيام عمل
                </p>
              </div>
            ) : (
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">
                  المبلغ المسترد
                </p>
                <p className="text-2xl font-bold text-primary">
                  {(totalAmount / 100).toFixed(2)} ر.س
                </p>
              </div>
            )}

            {/* Cancellation Reason */}
            <div className="space-y-2">
              <Label>سبب الإلغاء</Label>
              <RadioGroup value={reason} onValueChange={setReason}>
                <div className="flex items-center space-x-2 space-x-reverse">
                  <RadioGroupItem value="requested_by_customer" id="customer" />
                  <Label
                    htmlFor="customer"
                    className="font-normal cursor-pointer"
                  >
                    تغيير في الخطط
                  </Label>
                </div>
                <div className="flex items-center space-x-2 space-x-reverse">
                  <RadioGroupItem value="duplicate" id="duplicate" />
                  <Label
                    htmlFor="duplicate"
                    className="font-normal cursor-pointer"
                  >
                    حجز مكرر
                  </Label>
                </div>
                <div className="flex items-center space-x-2 space-x-reverse">
                  <RadioGroupItem value="other" id="other" />
                  <Label htmlFor="other" className="font-normal cursor-pointer">
                    أخرى
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Additional Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">ملاحظات إضافية (اختياري)</Label>
              <Textarea
                id="notes"
                placeholder="أضف أي ملاحظات إضافية..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
              />
            </div>

            {/* Warning */}
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
              <p className="text-xs text-amber-800">
                بمجرد إلغاء الحجز، لن تتمكن من التراجع عن هذا الإجراء. سيتم
                استرداد المبلغ تلقائياً.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createRefund.isPending}
          >
            إلغاء
          </Button>
          {refundCheck?.refundable && (
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={createRefund.isPending}
            >
              {createRefund.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  جاري الإلغاء...
                </>
              ) : (
                "تأكيد الإلغاء"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
