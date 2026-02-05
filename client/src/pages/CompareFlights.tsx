/**
 * CompareFlights Page
 *
 * Full page for comparing selected flights side-by-side.
 * Shows detailed comparison with highlighting for best values.
 */

import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { SEO } from "@/components/SEO";
import { FlightCompare } from "@/components/FlightCompare";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useFlightCompare, MIN_FLIGHTS } from "@/contexts/FlightCompareContext";
import { ChevronLeft, Scale, Search } from "lucide-react";

export default function CompareFlights() {
  const { t } = useTranslation();
  const { selectedFlights, removeFlight, clearAll } = useFlightCompare();

  const hasEnoughFlights = selectedFlights.length >= MIN_FLIGHTS;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      <SEO
        title={t("compare.pageTitle")}
        description={t("compare.pageDescription")}
        keywords="flight comparison, compare flights, best flight deals"
      />

      {/* Header */}
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b sticky top-0 z-40 shadow-sm">
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/search">
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  aria-label={t("common.back")}
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold flex items-center gap-2">
                  <Scale className="h-5 w-5 text-primary" />
                  {t("compare.title")}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t("compare.subtitle")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-8">
        {hasEnoughFlights ? (
          <FlightCompare
            flights={selectedFlights}
            onRemove={removeFlight}
            onClearAll={clearAll}
          />
        ) : (
          /* Not enough flights selected */
          <Card className="p-12 text-center border-dashed max-w-lg mx-auto">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted mb-6">
              <Scale className="h-10 w-10 text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-semibold mb-2">
              {t("compare.notEnoughFlights")}
            </h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              {selectedFlights.length === 0
                ? t("compare.noFlightsSelected")
                : t("compare.needMoreFlights", {
                    current: selectedFlights.length,
                    needed: MIN_FLIGHTS,
                  })}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild variant="default" size="lg">
                <Link href="/search">
                  <Search className="h-4 w-4 mr-2" />
                  {t("compare.searchFlights")}
                </Link>
              </Button>
              {selectedFlights.length > 0 && (
                <Button variant="outline" size="lg" onClick={clearAll}>
                  {t("common.clearAll")}
                </Button>
              )}
            </div>

            {/* Show selected flights if any */}
            {selectedFlights.length > 0 && (
              <div className="mt-8 pt-8 border-t">
                <p className="text-sm text-muted-foreground mb-4">
                  {t("compare.currentlySelected")}:
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {selectedFlights.map(flight => (
                    <div
                      key={flight.id}
                      className="flex items-center gap-2 bg-muted px-3 py-1.5 rounded-full text-sm"
                    >
                      <span className="font-medium">{flight.flightNumber}</span>
                      <span className="text-muted-foreground">
                        ({flight.origin.code} - {flight.destination.code})
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 rounded-full hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() => removeFlight(flight.id)}
                      >
                        <span className="sr-only">{t("common.delete")}</span>
                        <span aria-hidden="true">&times;</span>
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Tips Section */}
        {hasEnoughFlights && (
          <div className="mt-8">
            <Card className="p-6 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
              <h3 className="font-semibold mb-2 text-blue-800 dark:text-blue-200">
                {t("compare.tips.title")}
              </h3>
              <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                <li>{t("compare.tips.tip1")}</li>
                <li>{t("compare.tips.tip2")}</li>
                <li>{t("compare.tips.tip3")}</li>
              </ul>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
