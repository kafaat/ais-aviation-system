import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  ChevronLeft,
  Plane,
  Calendar,
  MapPin,
  XCircle,
  Edit,
  Download,
  FileText,
  Package,
} from "lucide-react";
import { CancelBookingDialog } from "@/components/CancelBookingDialog";
import {
  DownloadETicketButton,
  DownloadBoardingPassButton,
} from "@/components/DownloadTicketButtons";
import { ModifyBookingDialog } from "@/components/ModifyBookingDialog";
import { BookingAncillariesDisplay } from "@/components/BookingAncillariesDisplay";
import { ManageAncillariesDialog } from "@/components/ManageAncillariesDialog";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { getLoginUrl } from "@/const";

export default function MyBookings() {
  const { user, isAuthenticated, loading } = useAuth();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [modifyDialogOpen, setModifyDialogOpen] = useState(false);
  const [manageAncillariesOpen, setManageAncillariesOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<any>(null);

  const { data: bookings, isLoading } = trpc.bookings.myBookings.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  if (loading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="container py-8">
          <Skeleton className="h-8 w-64 mb-8" />
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <h2 className="text-2xl font-bold mb-4">يرجى تسجيل الدخول</h2>
          <p className="text-muted-foreground mb-6">
            يجب تسجيل الدخول لعرض حجوزاتك
          </p>
          <Button asChild className="w-full">
            <a href={getLoginUrl()}>تسجيل الدخول</a>
          </Button>
        </Card>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: any; label: string }> = {
      pending: { variant: "secondary", label: "قيد الانتظار" },
      confirmed: { variant: "default", label: "مؤكد" },
      cancelled: { variant: "destructive", label: "ملغي" },
      completed: { variant: "outline", label: "مكتمل" },
    };
    return variants[status] || variants.pending;
  };

  const getPaymentBadge = (status: string) => {
    const variants: Record<string, { variant: any; label: string }> = {
      pending: { variant: "secondary", label: "معلق" },
      paid: { variant: "default", label: "مدفوع" },
      refunded: { variant: "outline", label: "مسترد" },
      failed: { variant: "destructive", label: "فشل" },
    };
    return variants[status] || variants.pending;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="container py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ChevronLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold">حجوزاتي</h1>
              <p className="text-sm text-muted-foreground">
                عرض وإدارة جميع حجوزاتك
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Bookings List */}
      <div className="container py-8">
        {!bookings || bookings.length === 0 ? (
          <Card className="p-12 text-center">
            <Plane className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-2xl font-semibold mb-2">لا توجد حجوزات</h2>
            <p className="text-muted-foreground mb-6">لم تقم بأي حجوزات بعد</p>
            <Button asChild>
              <Link href="/">
                <a>ابحث عن رحلات</a>
              </Link>
            </Button>
          </Card>
        ) : (
          <div className="space-y-4">
            {bookings.map(booking => (
              <Card
                key={booking.id}
                className="p-6 hover:shadow-lg transition-shadow"
              >
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Booking Info */}
                  <div className="lg:col-span-8">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-semibold">
                            {booking.flight.flightNumber}
                          </h3>
                          <Badge
                            variant={getStatusBadge(booking.status).variant}
                          >
                            {getStatusBadge(booking.status).label}
                          </Badge>
                          <Badge
                            variant={
                              getPaymentBadge(booking.paymentStatus).variant
                            }
                          >
                            {getPaymentBadge(booking.paymentStatus).label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span>رقم الحجز: {booking.bookingReference}</span>
                          <span>•</span>
                          <span>PNR: {booking.pnr}</span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex items-center gap-3">
                        <MapPin className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="text-sm text-muted-foreground">من</p>
                          <p className="font-medium">{booking.flight.origin}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <MapPin className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="text-sm text-muted-foreground">إلى</p>
                          <p className="font-medium">
                            {booking.flight.destination}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <Calendar className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="text-sm text-muted-foreground">
                            تاريخ المغادرة
                          </p>
                          <p className="font-medium">
                            {format(
                              new Date(booking.flight.departureTime),
                              "PPP",
                              { locale: ar }
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div>
                          <p className="text-sm text-muted-foreground">
                            عدد الركاب
                          </p>
                          <p className="font-medium">
                            {booking.numberOfPassengers}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="lg:col-span-4 flex flex-col justify-between">
                    <div className="text-left lg:text-right mb-4">
                      <p className="text-sm text-muted-foreground mb-1">
                        المبلغ الإجمالي
                      </p>
                      <p className="text-2xl font-bold text-primary">
                        {(booking.totalAmount / 100).toFixed(2)} ر.س
                      </p>
                    </div>

                    <div className="flex flex-col gap-2">
                      {booking.status === "confirmed" && !booking.checkedIn && (
                        <Button asChild variant="default" className="w-full">
                          <Link href="/check-in">
                            <a>تسجيل الوصول</a>
                          </Link>
                        </Button>
                      )}
                      {booking.checkedIn && (
                        <Badge
                          variant="default"
                          className="w-full justify-center py-2"
                        >
                          تم تسجيل الوصول
                        </Badge>
                      )}
                      {booking.paymentStatus === "paid" && (
                        <div className="space-y-3">
                          {/* Passengers List with Download Buttons */}
                          <div className="border-t pt-3">
                            <p className="text-sm font-medium mb-2">
                              الركاب ({booking.passengers.length})
                            </p>
                            <div className="space-y-2">
                              {booking.passengers.map(
                                (passenger: any, index: number) => (
                                  <div
                                    key={passenger.id}
                                    className="flex items-center justify-between p-2 bg-gray-50 rounded"
                                  >
                                    <div className="flex-1">
                                      <p className="text-sm font-medium">
                                        {index + 1}. {passenger.firstName}{" "}
                                        {passenger.lastName}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {passenger.type === "adult"
                                          ? "بالغ"
                                          : passenger.type === "child"
                                            ? "طفل"
                                            : "رضيع"}
                                        {passenger.seatNumber &&
                                          ` • مقعد ${passenger.seatNumber}`}
                                      </p>
                                    </div>
                                    <div className="flex gap-1">
                                      <DownloadETicketButton
                                        bookingId={booking.id}
                                        passengerId={passenger.id}
                                      />
                                      {(booking.status === "confirmed" ||
                                        booking.status === "completed") && (
                                        <DownloadBoardingPassButton
                                          bookingId={booking.id}
                                          passengerId={passenger.id}
                                        />
                                      )}
                                    </div>
                                  </div>
                                )
                              )}
                            </div>
                          </div>

                          {/* Ancillaries Display */}
                          <BookingAncillariesDisplay bookingId={booking.id} />

                          {/* Modify/Cancel/Manage Buttons */}
                          {booking.status !== "cancelled" &&
                            booking.status !== "completed" && (
                              <div className="space-y-2">
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    className="flex-1"
                                    onClick={() => {
                                      setSelectedBooking(booking);
                                      setModifyDialogOpen(true);
                                    }}
                                  >
                                    <Edit className="mr-2 h-4 w-4" />
                                    تعديل
                                  </Button>
                                  <Button
                                    variant="outline"
                                    className="flex-1"
                                    onClick={() => {
                                      setSelectedBooking(booking);
                                      setCancelDialogOpen(true);
                                    }}
                                  >
                                    <XCircle className="mr-2 h-4 w-4" />
                                    إلغاء
                                  </Button>
                                </div>
                                <Button
                                  variant="outline"
                                  className="w-full"
                                  onClick={() => {
                                    setSelectedBooking(booking);
                                    setManageAncillariesOpen(true);
                                  }}
                                >
                                  <Package className="mr-2 h-4 w-4" />
                                  إدارة الخدمات الإضافية
                                </Button>
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Cancel Booking Dialog */}
      {selectedBooking && (
        <CancelBookingDialog
          bookingId={selectedBooking.id}
          bookingReference={selectedBooking.bookingReference}
          totalAmount={selectedBooking.totalAmount}
          open={cancelDialogOpen}
          onOpenChange={setCancelDialogOpen}
          onSuccess={() => {
            setSelectedBooking(null);
          }}
        />
      )}

      {/* Modify Booking Dialog */}
      {selectedBooking && (
        <ModifyBookingDialog
          open={modifyDialogOpen}
          onOpenChange={setModifyDialogOpen}
          booking={{
            id: selectedBooking.id,
            bookingReference: selectedBooking.bookingReference,
            flightNumber: selectedBooking.flightNumber,
            cabinClass: selectedBooking.cabinClass,
            totalAmount: selectedBooking.totalAmount,
            originName: selectedBooking.originName,
            destinationName: selectedBooking.destinationName,
          }}
        />
      )}

      {/* Manage Ancillaries Dialog */}
      {selectedBooking && (
        <ManageAncillariesDialog
          open={manageAncillariesOpen}
          onOpenChange={setManageAncillariesOpen}
          bookingId={selectedBooking.id}
          cabinClass={selectedBooking.cabinClass}
          numberOfPassengers={selectedBooking.numberOfPassengers}
        />
      )}
    </div>
  );
}
