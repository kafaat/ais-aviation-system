import { useState, useEffect } from "react";
import { useLocation, useRoute, Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, Plus, Trash2, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { getLoginUrl } from "@/const";

type Passenger = {
  type: "adult" | "child" | "infant";
  title?: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: Date;
  passportNumber?: string;
  nationality?: string;
};

export default function BookingPage() {
  const [, params] = useRoute("/booking/:id");
  const [location] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  
  const flightId = params?.id ? parseInt(params.id) : 0;
  const searchParams = new URLSearchParams(location.split('?')[1]);
  const cabinClass = (searchParams.get('class') || 'economy') as "economy" | "business";

  const [passengers, setPassengers] = useState<Passenger[]>([
    { type: "adult", firstName: "", lastName: "" }
  ]);

  const { data: flight, isLoading } = trpc.flights.getById.useQuery({ id: flightId });
  const createBooking = trpc.bookings.create.useMutation();
  const createPayment = trpc.payments.create.useMutation();

  const addPassenger = () => {
    setPassengers([...passengers, { type: "adult", firstName: "", lastName: "" }]);
  };

  const removePassenger = (index: number) => {
    if (passengers.length > 1) {
      setPassengers(passengers.filter((_, i) => i !== index));
    }
  };

  const updatePassenger = (index: number, field: keyof Passenger, value: any) => {
    const updated = [...passengers];
    updated[index] = { ...updated[index], [field]: value };
    setPassengers(updated);
  };

  const handleSubmit = async () => {
    if (!isAuthenticated) {
      window.location.href = getLoginUrl();
      return;
    }

    // Validate passengers
    const isValid = passengers.every(p => p.firstName && p.lastName);
    if (!isValid) {
      toast.error("يرجى إدخال جميع بيانات الركاب");
      return;
    }

    try {
      // Create booking
      const booking = await createBooking.mutateAsync({
        flightId,
        cabinClass,
        passengers,
      });

      // Process payment
      await createPayment.mutateAsync({
        bookingId: booking.bookingId,
        amount: booking.totalAmount,
        method: "card",
      });

      toast.success("تم الحجز بنجاح!");
      navigate(`/my-bookings`);
    } catch (error: any) {
      toast.error(error.message || "حدث خطأ أثناء الحجز");
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="container py-8">
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!flight) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="p-8 text-center">
          <h2 className="text-2xl font-bold mb-4">الرحلة غير موجودة</h2>
          <Button asChild>
            <Link href="/">
              <a>العودة للرئيسية</a>
            </Link>
          </Button>
        </Card>
      </div>
    );
  }

  const price = cabinClass === "economy" ? flight.economyPrice : flight.businessPrice;
  const totalAmount = (price * passengers.length) / 100;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="container py-4">
          <div className="flex items-center gap-4">
            <Link href="/search">
              <Button variant="ghost" size="icon">
                <ChevronLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">إكمال الحجز</h1>
          </div>
        </div>
      </header>

      <div className="container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Passenger Details */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">معلومات الركاب</h2>
                <Button onClick={addPassenger} variant="outline" size="sm">
                  <Plus className="h-4 w-4 ml-2" />
                  إضافة راكب
                </Button>
              </div>

              <div className="space-y-6">
                {passengers.map((passenger, index) => (
                  <div key={index} className="p-4 border rounded-lg">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-medium">الراكب {index + 1}</h3>
                      {passengers.length > 1 && (
                        <Button
                          onClick={() => removePassenger(index)}
                          variant="ghost"
                          size="sm"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>نوع الراكب</Label>
                        <Select
                          value={passenger.type}
                          onValueChange={(value: any) => updatePassenger(index, "type", value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="adult">بالغ</SelectItem>
                            <SelectItem value="child">طفل</SelectItem>
                            <SelectItem value="infant">رضيع</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>اللقب</Label>
                        <Select
                          value={passenger.title || ""}
                          onValueChange={(value) => updatePassenger(index, "title", value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="اختر" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Mr">السيد</SelectItem>
                            <SelectItem value="Mrs">السيدة</SelectItem>
                            <SelectItem value="Ms">الآنسة</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>الاسم الأول</Label>
                        <Input
                          value={passenger.firstName}
                          onChange={(e) => updatePassenger(index, "firstName", e.target.value)}
                          placeholder="الاسم الأول"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>اسم العائلة</Label>
                        <Input
                          value={passenger.lastName}
                          onChange={(e) => updatePassenger(index, "lastName", e.target.value)}
                          placeholder="اسم العائلة"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>رقم الجواز (اختياري)</Label>
                        <Input
                          value={passenger.passportNumber || ""}
                          onChange={(e) => updatePassenger(index, "passportNumber", e.target.value)}
                          placeholder="رقم الجواز"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>الجنسية (اختياري)</Label>
                        <Input
                          value={passenger.nationality || ""}
                          onChange={(e) => updatePassenger(index, "nationality", e.target.value)}
                          placeholder="الجنسية"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Booking Summary */}
          <div className="lg:col-span-1">
            <Card className="p-6 sticky top-24">
              <h2 className="text-xl font-semibold mb-4">ملخص الحجز</h2>
              
              <div className="space-y-4 mb-6">
                <div>
                  <p className="text-sm text-muted-foreground">رقم الرحلة</p>
                  <p className="font-medium">{flight.flightNumber}</p>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground">المسار</p>
                  <p className="font-medium">
                    {flight.origin.city} → {flight.destination.city}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground">الدرجة</p>
                  <p className="font-medium">
                    {cabinClass === "economy" ? "السياحية" : "الأعمال"}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground">عدد الركاب</p>
                  <p className="font-medium">{passengers.length}</p>
                </div>

                <div className="border-t pt-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm">سعر التذكرة</span>
                    <span>{(price / 100).toFixed(2)} ر.س</span>
                  </div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm">عدد الركاب</span>
                    <span>× {passengers.length}</span>
                  </div>
                  <div className="flex justify-between items-center text-lg font-bold mt-4 pt-4 border-t">
                    <span>المجموع</span>
                    <span className="text-primary">{totalAmount.toFixed(2)} ر.س</span>
                  </div>
                </div>
              </div>

              <Button 
                onClick={handleSubmit} 
                className="w-full" 
                size="lg"
                disabled={createBooking.isPending || createPayment.isPending}
              >
                <CreditCard className="h-5 w-5 ml-2" />
                {createBooking.isPending || createPayment.isPending ? "جاري المعالجة..." : "إتمام الحجز والدفع"}
              </Button>

              <p className="text-xs text-muted-foreground text-center mt-4">
                بالضغط على "إتمام الحجز" فإنك توافق على الشروط والأحكام
              </p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
