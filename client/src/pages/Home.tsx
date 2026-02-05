import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SearchHistory } from "@/components/SearchHistory";
import { Link, useLocation } from "wouter";
import {
  Plane,
  MapPin,
  Calendar as CalendarIcon,
  Shield,
  Clock,
  Globe as GlobeIcon,
  Heart,
} from "lucide-react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { APP_LOGO, getLoginUrl } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 },
};

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.1,
    },
  },
};

export default function Home() {
  const { t, i18n } = useTranslation();
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  const [originId, setOriginId] = useState<string>("");
  const [destinationId, setDestinationId] = useState<string>("");
  const [departureDate, setDepartureDate] = useState<Date>();

  const { data: airports } = trpc.reference.airports.useQuery();

  const handleSearch = () => {
    if (originId && destinationId && departureDate) {
      const params = new URLSearchParams({
        origin: originId,
        destination: destinationId,
        date: departureDate.toISOString(),
      });
      setLocation(`/search?${params.toString()}`);
    }
  };

  // Handle search history selection
  const handleHistorySelect = useCallback(
    (search: {
      originCode: string;
      destinationCode: string;
      departureDate: string;
    }) => {
      if (!airports) return;

      // Find airport IDs from codes
      const originAirport = airports.find(a => a.code === search.originCode);
      const destAirport = airports.find(a => a.code === search.destinationCode);

      if (originAirport) {
        setOriginId(originAirport.id.toString());
      }
      if (destAirport) {
        setDestinationId(destAirport.id.toString());
      }
      setDepartureDate(new Date(search.departureDate));
    },
    [airports]
  );

  const currentLocale = i18n.language === "ar" ? ar : enUS;

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 via-white to-blue-50">
      {/* Header */}
      <motion.header
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 100 }}
        className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50 shadow-sm"
      >
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <Link href="/">
              <div className="flex items-center gap-3 cursor-pointer group">
                <motion.div
                  whileHover={{ rotate: 360 }}
                  transition={{ duration: 0.6 }}
                >
                  <Plane className="h-8 w-8 text-primary" />
                </motion.div>
                <div>
                  <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
                    {t("common.appName")}
                  </h1>
                  <p className="text-xs text-muted-foreground">AIS</p>
                </div>
              </div>
            </Link>

            <nav className="hidden md:flex items-center gap-6">
              <Link href="/">
                <a className="text-sm font-medium hover:text-primary transition-colors">
                  {t("nav.home")}
                </a>
              </Link>
              <Link href="/my-bookings">
                <a className="text-sm font-medium hover:text-primary transition-colors">
                  {t("nav.myBookings")}
                </a>
              </Link>
              <Link href="/check-in">
                <a className="text-sm font-medium hover:text-primary transition-colors">
                  {t("nav.checkIn")}
                </a>
              </Link>
              {user && (
                <Link href="/profile">
                  <a className="text-sm font-medium hover:text-primary transition-colors">
                    {t("nav.profile")}
                  </a>
                </Link>
              )}
              {user && (
                <Link href="/loyalty">
                  <a className="text-sm font-medium hover:text-primary transition-colors">
                    {t("nav.loyalty")}
                  </a>
                </Link>
              )}
              {user?.role === "admin" && (
                <>
                  <Link href="/admin">
                    <a className="text-sm font-medium hover:text-primary transition-colors">
                      {t("nav.admin")}
                    </a>
                  </Link>
                  <Link href="/analytics">
                    <a className="text-sm font-medium hover:text-primary transition-colors">
                      {t("nav.analytics")}
                    </a>
                  </Link>
                </>
              )}
            </nav>

            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageSwitcher />
              {user ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground hidden md:block">
                    {user.name}
                  </span>
                </div>
              ) : (
                <Button asChild size="sm">
                  <a href={getLoginUrl()}>{t("common.login")}</a>
                </Button>
              )}
            </div>
          </div>
        </div>
      </motion.header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-blue-500/5 to-purple-500/5" />
        <div className="container py-20 relative">
          <motion.div
            className="max-w-3xl mx-auto text-center mb-12"
            {...fadeIn}
          >
            <motion.h2
              className="text-4xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-primary via-blue-600 to-purple-600 bg-clip-text text-transparent"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8 }}
            >
              {t("home.hero.title")}
            </motion.h2>
            <motion.p
              className="text-xl text-muted-foreground"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.8 }}
            >
              {t("home.hero.subtitle")}
            </motion.p>
          </motion.div>

          {/* Search Card */}
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.8 }}
          >
            <Card className="p-8 max-w-4xl mx-auto shadow-2xl border-0 bg-white/80 backdrop-blur-sm">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary" />
                    {t("home.search.from")}
                  </label>
                  <Select value={originId} onValueChange={setOriginId}>
                    <SelectTrigger className="h-12">
                      <SelectValue placeholder={t("home.search.selectCity")} />
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
                  <label className="text-sm font-medium flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary" />
                    {t("home.search.to")}
                  </label>
                  <Select
                    value={destinationId}
                    onValueChange={setDestinationId}
                  >
                    <SelectTrigger className="h-12">
                      <SelectValue placeholder={t("home.search.selectCity")} />
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
                  <label className="text-sm font-medium flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4 text-primary" />
                    {t("home.search.departureDate")}
                  </label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full h-12 justify-start text-left font-normal"
                      >
                        {departureDate ? (
                          format(departureDate, "PPP", {
                            locale: currentLocale,
                          })
                        ) : (
                          <span className="text-muted-foreground">
                            {t("home.search.selectDate")}
                          </span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={departureDate}
                        onSelect={setDepartureDate}
                        disabled={date => date < new Date()}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <motion.div
                className="mt-6 flex flex-col sm:flex-row gap-3"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Button
                  onClick={handleSearch}
                  size="lg"
                  className="flex-1 h-14 text-lg font-semibold shadow-lg"
                  disabled={!originId || !destinationId || !departureDate}
                >
                  {t("home.search.searchFlights")}
                </Button>
                {user && (
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-14 px-6 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                  >
                    <Link href="/favorites">
                      <Heart className="h-5 w-5 mr-2" />
                      {t("nav.favorites")}
                    </Link>
                  </Button>
                )}
              </motion.div>

              {/* Recent Searches (compact) */}
              <motion.div
                className="mt-6 pt-6 border-t"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
              >
                <SearchHistory compact onSelect={handleHistorySelect} />
              </motion.div>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-white">
        <div className="container">
          <motion.h3
            className="text-3xl font-bold text-center mb-12"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            {t("home.features.title")}
          </motion.h3>

          <motion.div
            className="grid grid-cols-1 md:grid-cols-3 gap-8"
            variants={staggerContainer}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
          >
            {[
              {
                icon: Shield,
                title: t("home.features.secure.title"),
                description: t("home.features.secure.description"),
                color: "text-green-600",
                bgColor: "bg-green-100",
              },
              {
                icon: Clock,
                title: t("home.features.support.title"),
                description: t("home.features.support.description"),
                color: "text-blue-600",
                bgColor: "bg-blue-100",
              },
              {
                icon: GlobeIcon,
                title: t("home.features.destinations.title"),
                description: t("home.features.destinations.description"),
                color: "text-purple-600",
                bgColor: "bg-purple-100",
              },
            ].map((feature, index) => (
              <motion.div
                key={index}
                variants={fadeIn}
                whileHover={{ y: -10, transition: { duration: 0.3 } }}
              >
                <Card className="p-8 text-center hover:shadow-xl transition-all duration-300 border-0 bg-gradient-to-br from-white to-gray-50">
                  <motion.div
                    className={`inline-flex p-4 rounded-full ${feature.bgColor} mb-6`}
                    whileHover={{ rotate: 360 }}
                    transition={{ duration: 0.6 }}
                  >
                    <feature.icon className={`h-8 w-8 ${feature.color}`} />
                  </motion.div>
                  <h4 className="text-xl font-semibold mb-3">
                    {feature.title}
                  </h4>
                  <p className="text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-12">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Plane className="h-6 w-6" />
                <h3 className="font-bold text-lg">{t("common.appName")}</h3>
              </div>
              <p className="text-sm text-gray-400">{t("footer.description")}</p>
            </div>

            <div>
              <h4 className="font-semibold mb-4">{t("footer.quickLinks")}</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    {t("footer.about")}
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    {t("footer.contact")}
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    {t("footer.terms")}
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">{t("footer.services")}</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    {t("footer.bookTickets")}
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    {t("footer.manageBookings")}
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    {t("footer.checkIn")}
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">{t("footer.contactUs")}</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>{t("footer.email")}: info@ais.com</li>
                <li>{t("footer.phone")}: +966 11 234 5678</li>
              </ul>
            </div>
          </div>

          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm text-gray-400">
            © 2025 AIS - {t("footer.rights")}
          </div>
        </div>
      </footer>
    </div>
  );
}
