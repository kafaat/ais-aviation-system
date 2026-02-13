import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "wouter";
import { ChevronLeft, Plus, Plane, Calendar as CalendarIcon } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { getLoginUrl } from "@/const";

export default function AdminDashboard() {
  const { user, isAuthenticated } = useAuth();
  const [showAddFlight, setShowAddFlight] = useState(false);

  // Form state
  const [flightNumber, setFlightNumber] = useState("");
  const [airlineId, setAirlineId] = useState("");
  const [originId, setOriginId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [departureTime, setDepartureTime] = useState<Date>();
  const [arrivalTime, setArrivalTime] = useState<Date>();
  const [economySeats, setEconomySeats] = useState("");
  const [businessSeats, setBusinessSeats] = useState("");
  const [economyPrice, setEconomyPrice] = useState("");
  const [businessPrice, setBusinessPrice] = useState("");

  const { data: airlines } = trpc.reference.airlines.useQuery();
  const { data: airports } = trpc.reference.airports.useQuery();
  
  const createFlightMutation = trpc.admin.createFlight.useMutation({
    onSuccess: () => {
      toast.success("تم إضافة الرحلة بنجاح!");
      setShowAddFlight(false);
      // Reset form
      setFlightNumber("");
      setAirlineId("");
      setOriginId("");
      setDestinationId("");
      setDepartureTime(undefined);
      setArrivalTime(undefined);
      setEconomySeats("");
      setBusinessSeats("");
      setEconomyPrice("");
      setBusinessPrice("");
    },
    onError: (error) => {
      toast.error(error.message || "حدث خطأ أثناء إضافة الرحلة");
    },
  });

  const handleSubmit = async () => {
    if (!departureTime || !arrivalTime) {
      toast.error("يرجى تحديد أوقات الرحلة");
      return;
    }

    await createFlightMutation.mutateAsync({
      flightNumber,
      airlineId: parseInt(airlineId),
      originId: parseInt(originId),
      destinationId: parseInt(destinationId),
      departureTime,
      arrivalTime,
      economySeats: parseInt(economySeats),
      businessSeats: parseInt(businessSeats),
      economyPrice: Math.round(parseFloat(economyPrice) * 100),
      businessPrice: Math.round(parseFloat(businessPrice) * 100),
    });
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <h2 className="text-2xl font-bold mb-4">يرجى تسجيل الدخول</h2>
          <Button asChild className="w-full">
            <a href={getLoginUrl()}>تسجيل الدخول</a>
          </Button>
        </Card>
      </div>
    );
  }

  if (user?.role !== "admin") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <h2 className="text-2xl font-bold mb-4">غير مصرح</h2>
          <p className="text-muted-foreground mb-6">
            ليس لديك صلاحيات الوصول لهذه الصفحة
          </p>
          <Button asChild>
            <Link href="/">
              <a>العودة للرئيسية</a>
            </Link>
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="icon">
                  <ChevronLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold">لوحة التحكم الإدارية</h1>
                <p className="text-sm text-muted-foreground">
                  إدارة الرحلات والحجوزات
                </p>
              </div>
            </div>
            <Button onClick={() => setShowAddFlight(!showAddFlight)}>
              <Plus className="h-4 w-4 ml-2" />
              إضافة رحلة جديدة
            </Button>
          </div>
        </div>
      </header>

      <div className="container py-8">
        {/* Add Flight Form */}
        {showAddFlight && (
          <Card className="p-6 mb-8">
            <h2 className="text-xl font-semibold mb-6">إضافة رحلة جديدة</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>رقم الرحلة</Label>
                <Input
                  value={flightNumber}
                  onChange={(e) => setFlightNumber(e.target.value)}
                  placeholder="مثال: SV123"
                />
              </div>

              <div className="space-y-2">
                <Label>شركة الطيران</Label>
                <Select value={airlineId} onValueChange={setAirlineId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر شركة الطيران" />
                  </SelectTrigger>
                  <SelectContent>
                    {airlines?.map((airline) => (
                      <SelectItem key={airline.id} value={airline.id.toString()}>
                        {airline.name} ({airline.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>مطار المغادرة</Label>
                <Select value={originId} onValueChange={setOriginId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر المطار" />
                  </SelectTrigger>
                  <SelectContent>
                    {airports?.map((airport) => (
                      <SelectItem key={airport.id} value={airport.id.toString()}>
                        {airport.city} ({airport.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>مطار الوصول</Label>
                <Select value={destinationId} onValueChange={setDestinationId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر المطار" />
                  </SelectTrigger>
                  <SelectContent>
                    {airports?.map((airport) => (
                      <SelectItem key={airport.id} value={airport.id.toString()}>
                        {airport.city} ({airport.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>وقت المغادرة</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      {departureTime ? format(departureTime, "PPP HH:mm", { locale: ar }) : "اختر الوقت"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={departureTime}
                      onSelect={setDepartureTime}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>وقت الوصول</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      {arrivalTime ? format(arrivalTime, "PPP HH:mm", { locale: ar }) : "اختر الوقت"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={arrivalTime}
                      onSelect={setArrivalTime}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>عدد مقاعد الدرجة السياحية</Label>
                <Input
                  type="number"
                  value={economySeats}
                  onChange={(e) => setEconomySeats(e.target.value)}
                  placeholder="150"
                />
              </div>

              <div className="space-y-2">
                <Label>عدد مقاعد درجة الأعمال</Label>
                <Input
                  type="number"
                  value={businessSeats}
                  onChange={(e) => setBusinessSeats(e.target.value)}
                  placeholder="30"
                />
              </div>

              <div className="space-y-2">
                <Label>سعر الدرجة السياحية (ر.س)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={economyPrice}
                  onChange={(e) => setEconomyPrice(e.target.value)}
                  placeholder="500.00"
                />
              </div>

              <div className="space-y-2">
                <Label>سعر درجة الأعمال (ر.س)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={businessPrice}
                  onChange={(e) => setBusinessPrice(e.target.value)}
                  placeholder="1500.00"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button 
                onClick={handleSubmit}
                disabled={createFlightMutation.isPending}
              >
                {createFlightMutation.isPending ? "جاري الإضافة..." : "إضافة الرحلة"}
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setShowAddFlight(false)}
              >
                إلغاء
              </Button>
            </div>
          </Card>
        )}

        {/* Dashboard Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">إجمالي الرحلات</p>
                <p className="text-3xl font-bold mt-2">--</p>
              </div>
              <Plane className="h-12 w-12 text-primary/20" />
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">الحجوزات اليوم</p>
                <p className="text-3xl font-bold mt-2">--</p>
              </div>
              <CalendarIcon className="h-12 w-12 text-primary/20" />
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">الإيرادات</p>
                <p className="text-3xl font-bold mt-2">-- ر.س</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-2xl">💰</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
