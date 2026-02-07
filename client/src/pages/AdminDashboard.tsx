import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Link } from "wouter";
import {
  ChevronLeft,
  Plus,
  Plane,
  Calendar as CalendarIcon,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

export default function AdminDashboard() {
  const { t } = useTranslation();
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
      toast.success(t("admin.dashboard.flightAddedSuccess"));
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
    onError: error => {
      toast.error(error.message || t("admin.dashboard.flightAddError"));
    },
  });

  const handleSubmit = async () => {
    if (!departureTime || !arrivalTime) {
      toast.error(t("admin.dashboard.selectFlightTimes"));
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
          <h2 className="text-2xl font-bold mb-4">
            {t("common.loginRequired")}
          </h2>
          <Button asChild className="w-full">
            <a href="/login">{t("common.login")}</a>
          </Button>
        </Card>
      </div>
    );
  }

  if (user?.role !== "admin") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <h2 className="text-2xl font-bold mb-4">
            {t("admin.dashboard.unauthorized")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("admin.dashboard.noAccess")}
          </p>
          <Button asChild>
            <Link href="/">
              <a>{t("admin.dashboard.backToHome")}</a>
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
                <h1 className="text-xl font-bold">
                  {t("admin.dashboard.title")}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t("admin.dashboard.subtitle")}
                </p>
              </div>
            </div>
            <Button onClick={() => setShowAddFlight(!showAddFlight)}>
              <Plus className="h-4 w-4 ml-2" />
              {t("admin.dashboard.addFlight")}
            </Button>
          </div>
        </div>
      </header>

      <div className="container py-8">
        {/* Add Flight Form */}
        {showAddFlight && (
          <Card className="p-6 mb-8">
            <h2 className="text-xl font-semibold mb-6">
              {t("admin.dashboard.addFlight")}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>{t("admin.dashboard.flightNumber")}</Label>
                <Input
                  value={flightNumber}
                  onChange={e => setFlightNumber(e.target.value)}
                  placeholder={t("admin.dashboard.flightNumberPlaceholder")}
                />
              </div>

              <div className="space-y-2">
                <Label>{t("admin.dashboard.airline")}</Label>
                <Select value={airlineId} onValueChange={setAirlineId}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("admin.dashboard.selectAirline")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {airlines?.map(airline => (
                      <SelectItem
                        key={airline.id}
                        value={airline.id.toString()}
                      >
                        {airline.name} ({airline.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t("admin.dashboard.departureAirport")}</Label>
                <Select value={originId} onValueChange={setOriginId}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("admin.dashboard.selectAirport")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {airports?.map(airport => (
                      <SelectItem
                        key={airport.id}
                        value={airport.id.toString()}
                      >
                        {airport.city} ({airport.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t("admin.dashboard.arrivalAirport")}</Label>
                <Select value={destinationId} onValueChange={setDestinationId}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("admin.dashboard.selectAirport")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {airports?.map(airport => (
                      <SelectItem
                        key={airport.id}
                        value={airport.id.toString()}
                      >
                        {airport.city} ({airport.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t("admin.dashboard.departureTime")}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      {departureTime
                        ? format(departureTime, "PPP HH:mm", { locale: ar })
                        : t("admin.dashboard.selectTime")}
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
                <Label>{t("admin.dashboard.arrivalTime")}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      {arrivalTime
                        ? format(arrivalTime, "PPP HH:mm", { locale: ar })
                        : t("admin.dashboard.selectTime")}
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
                <Label>{t("admin.dashboard.economySeats")}</Label>
                <Input
                  type="number"
                  value={economySeats}
                  onChange={e => setEconomySeats(e.target.value)}
                  placeholder="150"
                />
              </div>

              <div className="space-y-2">
                <Label>{t("admin.dashboard.businessSeats")}</Label>
                <Input
                  type="number"
                  value={businessSeats}
                  onChange={e => setBusinessSeats(e.target.value)}
                  placeholder="30"
                />
              </div>

              <div className="space-y-2">
                <Label>{t("admin.dashboard.economyPrice")}</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={economyPrice}
                  onChange={e => setEconomyPrice(e.target.value)}
                  placeholder="500.00"
                />
              </div>

              <div className="space-y-2">
                <Label>{t("admin.dashboard.businessPrice")}</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={businessPrice}
                  onChange={e => setBusinessPrice(e.target.value)}
                  placeholder="1500.00"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button
                onClick={handleSubmit}
                disabled={createFlightMutation.isPending}
              >
                {createFlightMutation.isPending
                  ? t("admin.dashboard.adding")
                  : t("admin.dashboard.addFlightBtn")}
              </Button>
              <Button variant="outline" onClick={() => setShowAddFlight(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </Card>
        )}

        {/* Dashboard Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("admin.dashboard.totalFlights")}
                </p>
                <p className="text-3xl font-bold mt-2">--</p>
              </div>
              <Plane className="h-12 w-12 text-primary/20" />
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("admin.dashboard.todayBookings")}
                </p>
                <p className="text-3xl font-bold mt-2">--</p>
              </div>
              <CalendarIcon className="h-12 w-12 text-primary/20" />
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("admin.dashboard.revenue")}
                </p>
                <p className="text-3xl font-bold mt-2">-- {t("common.sar")}</p>
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
