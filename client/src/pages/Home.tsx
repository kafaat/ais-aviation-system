import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plane, Calendar as CalendarIcon, MapPin, Users, Shield, Clock, Globe } from "lucide-react";
import { APP_LOGO, APP_TITLE, getLoginUrl } from "@/const";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [departureDate, setDepartureDate] = useState<Date>();
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");

  const { data: airports } = trpc.reference.airports.useQuery();

  const handleSearch = () => {
    if (origin && destination && departureDate) {
      const params = new URLSearchParams({
        origin,
        destination,
        date: departureDate.toISOString(),
      });
      navigate(`/search?${params.toString()}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Plane className="h-8 w-8 text-primary" />
              <h1 className="text-2xl font-bold text-primary">{APP_TITLE}</h1>
            </div>
            <nav className="flex items-center gap-6">
              <Link href="/">
                <a className="text-sm font-medium hover:text-primary transition-colors">
                  الرئيسية
                </a>
              </Link>
              {isAuthenticated ? (
                <>
                  <Link href="/my-bookings">
                    <a className="text-sm font-medium hover:text-primary transition-colors">
                      حجوزاتي
                    </a>
                  </Link>
                  <Link href="/check-in">
                    <a className="text-sm font-medium hover:text-primary transition-colors">
                      تسجيل الوصول
                    </a>
                  </Link>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{user?.name}</span>
                  </div>
                </>
              ) : (
                <Button asChild variant="default">
                  <a href={getLoginUrl()}>تسجيل الدخول</a>
                </Button>
              )}
            </nav>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-5xl font-bold text-gray-900 mb-4">
              احجز رحلتك القادمة
            </h2>
            <p className="text-xl text-gray-600">
              اكتشف أفضل العروض على رحلات الطيران حول العالم
            </p>
          </div>

          {/* Search Card */}
          <Card className="max-w-4xl mx-auto p-8 shadow-2xl">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Origin */}
              <div className="space-y-2">
                <Label htmlFor="origin" className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  من
                </Label>
                <Select value={origin} onValueChange={setOrigin}>
                  <SelectTrigger id="origin">
                    <SelectValue placeholder="اختر المدينة" />
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

              {/* Destination */}
              <div className="space-y-2">
                <Label htmlFor="destination" className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  إلى
                </Label>
                <Select value={destination} onValueChange={setDestination}>
                  <SelectTrigger id="destination">
                    <SelectValue placeholder="اختر المدينة" />
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

              {/* Date */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4" />
                  تاريخ المغادرة
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-right font-normal"
                    >
                      {departureDate ? (
                        format(departureDate, "PPP", { locale: ar })
                      ) : (
                        <span>اختر التاريخ</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={departureDate}
                      onSelect={setDepartureDate}
                      disabled={(date) => date < new Date()}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Search Button */}
              <div className="flex items-end">
                <Button 
                  onClick={handleSearch} 
                  className="w-full h-10"
                  disabled={!origin || !destination || !departureDate}
                >
                  بحث عن رحلات
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-white">
        <div className="container">
          <h3 className="text-3xl font-bold text-center mb-12">لماذا تختارنا؟</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card className="p-6 text-center hover:shadow-lg transition-shadow">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                <Shield className="h-8 w-8 text-primary" />
              </div>
              <h4 className="text-xl font-semibold mb-2">حجز آمن</h4>
              <p className="text-gray-600">
                نضمن لك تجربة حجز آمنة ومحمية بأحدث تقنيات الأمان
              </p>
            </Card>

            <Card className="p-6 text-center hover:shadow-lg transition-shadow">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                <Clock className="h-8 w-8 text-primary" />
              </div>
              <h4 className="text-xl font-semibold mb-2">دعم على مدار الساعة</h4>
              <p className="text-gray-600">
                فريق الدعم متاح 24/7 لمساعدتك في أي وقت
              </p>
            </Card>

            <Card className="p-6 text-center hover:shadow-lg transition-shadow">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                <Globe className="h-8 w-8 text-primary" />
              </div>
              <h4 className="text-xl font-semibold mb-2">وجهات عالمية</h4>
              <p className="text-gray-600">
                احجز رحلات إلى أكثر من 1000 وجهة حول العالم
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <h5 className="font-bold mb-4">{APP_TITLE}</h5>
              <p className="text-gray-400 text-sm">
                نظام الطيران المتكامل لحجز التذاكر وإدارة الرحلات
              </p>
            </div>
            <div>
              <h5 className="font-bold mb-4">روابط سريعة</h5>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white">عن الشركة</a></li>
                <li><a href="#" className="hover:text-white">اتصل بنا</a></li>
                <li><a href="#" className="hover:text-white">الشروط والأحكام</a></li>
              </ul>
            </div>
            <div>
              <h5 className="font-bold mb-4">خدماتنا</h5>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white">حجز التذاكر</a></li>
                <li><a href="#" className="hover:text-white">إدارة الحجوزات</a></li>
                <li><a href="#" className="hover:text-white">تسجيل الوصول</a></li>
              </ul>
            </div>
            <div>
              <h5 className="font-bold mb-4">تواصل معنا</h5>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>البريد: info@ais.com</li>
                <li>الهاتف: +966 11 234 5678</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm text-gray-400">
            <p>&copy; 2025 {APP_TITLE}. جميع الحقوق محفوظة.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
