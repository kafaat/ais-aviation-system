import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { ChevronLeft, Search, Plane } from "lucide-react";
import { toast } from "sonner";
import { getLoginUrl } from "@/const";

interface Passenger {
  id: number;
  title?: string;
  firstName: string;
  lastName: string;
  type: "adult" | "child" | "infant";
  seatNumber?: string;
}

export default function CheckIn() {
  const { isAuthenticated } = useAuth();
  const [pnr, setPnr] = useState("");
  const [searchPerformed, setSearchPerformed] = useState(false);

  const {
    data: booking,
    isLoading,
    refetch,
  } = trpc.bookings.getByPNR.useQuery({ pnr }, { enabled: false });

  const { data: passengers } = trpc.bookings.getPassengers.useQuery(
    { bookingId: booking?.id || 0 },
    { enabled: !!booking?.id }
  );

  const checkInMutation = trpc.bookings.checkIn.useMutation({
    onSuccess: () => {
      toast.success("تم تسجيل الوصول بنجاح!");
      refetch();
    },
    onError: error => {
      toast.error(error.message || "حدث خطأ أثناء تسجيل الوصول");
    },
  });

  const handleSearch = async () => {
    if (pnr.length !== 6) {
      toast.error("يرجى إدخال رقم PNR صحيح (6 أحرف)");
      return;
    }
    setSearchPerformed(true);
    await refetch();
  };

  const handleCheckIn = async () => {
    if (!booking || !passengers) return;

    // Generate seat assignments for all passengers
    const seatAssignments = (passengers as Passenger[]).map(
      (passenger, index) => ({
        passengerId: passenger.id,
        seatNumber:
          passenger.seatNumber ||
          `${Math.floor(index / 6) + 1}${String.fromCharCode(65 + (index % 6))}`,
      })
    );

    await checkInMutation.mutateAsync({
      bookingId: booking.id,
      seatAssignments,
    });
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <h2 className="text-2xl font-bold mb-4">يرجى تسجيل الدخول</h2>
          <p className="text-muted-foreground mb-6">
            يجب تسجيل الدخول لإتمام عملية تسجيل الوصول
          </p>
          <Button asChild className="w-full">
            <a href={getLoginUrl()}>تسجيل الدخول</a>
          </Button>
        </Card>
      </div>
    );
  }

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
              <h1 className="text-xl font-bold">تسجيل الوصول</h1>
              <p className="text-sm text-muted-foreground">
                أدخل رقم PNR لتسجيل الوصول
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="container py-8">
        <div className="max-w-2xl mx-auto">
          {/* Search Card */}
          <Card className="p-6 mb-8">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pnr">رقم الحجز (PNR)</Label>
                <div className="flex gap-2">
                  <Input
                    id="pnr"
                    value={pnr}
                    onChange={e => setPnr(e.target.value.toUpperCase())}
                    placeholder="أدخل رقم PNR (6 أحرف)"
                    maxLength={6}
                    className="flex-1"
                  />
                  <Button onClick={handleSearch} disabled={isLoading}>
                    <Search className="h-4 w-4 ml-2" />
                    بحث
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  يمكنك العثور على رقم PNR في رسالة تأكيد الحجز
                </p>
              </div>
            </div>
          </Card>

          {/* Booking Details */}
          {searchPerformed && !isLoading && (
            <>
              {!booking ? (
                <Card className="p-12 text-center">
                  <Plane className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <h2 className="text-2xl font-semibold mb-2">
                    لم يتم العثور على حجز
                  </h2>
                  <p className="text-muted-foreground">
                    تأكد من رقم PNR وحاول مرة أخرى
                  </p>
                </Card>
              ) : (
                <Card className="p-6">
                  <h2 className="text-xl font-semibold mb-6">تفاصيل الحجز</h2>

                  <div className="space-y-4 mb-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          رقم الرحلة
                        </p>
                        <p className="font-medium">{booking.flightId}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">
                          رقم الحجز
                        </p>
                        <p className="font-medium">
                          {booking.bookingReference}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">الحالة</p>
                        <p className="font-medium">{booking.status}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">
                          عدد الركاب
                        </p>
                        <p className="font-medium">
                          {booking.numberOfPassengers}
                        </p>
                      </div>
                    </div>

                    <div className="border-t pt-4">
                      <h3 className="font-semibold mb-3">الركاب</h3>
                      <div className="space-y-2">
                        {(passengers as Passenger[] | undefined)?.map(
                          (passenger, index) => (
                            <div
                              key={passenger.id || index}
                              className="flex items-center justify-between p-3 bg-gray-50 rounded"
                            >
                              <span>
                                {passenger.title} {passenger.firstName}{" "}
                                {passenger.lastName}
                              </span>
                              <span className="text-sm text-muted-foreground">
                                {passenger.type === "adult"
                                  ? "بالغ"
                                  : passenger.type === "child"
                                    ? "طفل"
                                    : "رضيع"}
                              </span>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>

                  {booking.checkedIn ? (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                      <p className="text-green-800 font-semibold">
                        ✓ تم تسجيل الوصول بنجاح
                      </p>
                      <p className="text-sm text-green-600 mt-1">
                        يمكنك التوجه إلى بوابة الصعود
                      </p>
                    </div>
                  ) : (
                    <Button
                      onClick={handleCheckIn}
                      className="w-full"
                      size="lg"
                      disabled={checkInMutation.isPending}
                    >
                      {checkInMutation.isPending
                        ? "جاري التسجيل..."
                        : "تسجيل الوصول"}
                    </Button>
                  )}
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
