import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Redirect } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Coins, Scale, Hourglass, PieChart, RefreshCw } from "lucide-react";

/** SAR minor units to a display string. */
function sar(minor: number, locale: string) {
  return (minor / 100).toLocaleString(locale === "ar" ? "ar-SA" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Admin panel: loyalty contract liability (IFRS 15), breakage estimate and
 * near-term expiry. Approval buttons record who approved; the SSP/breakage
 * decision itself remains a finance control outside the system.
 */
export default function LoyaltyAccounting() {
  const { t, i18n } = useTranslation();
  const { user, loading } = useAuth();
  const utils = trpc.useUtils();
  const summary = trpc.loyalty.accountingSummary.useQuery(undefined, {
    enabled: !!user,
  });
  const valuations = trpc.loyalty.listValuations.useQuery(undefined, {
    enabled: !!user,
  });
  const [ssp, setSsp] = useState("1.0000");
  const [breakage, setBreakage] = useState("0.00");
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const invalidate = () => {
    void utils.loyalty.accountingSummary.invalidate();
    void utils.loyalty.listValuations.invalidate();
  };
  const createValuation = trpc.loyalty.createValuation.useMutation({
    onSuccess: () => {
      toast.success(t("admin.loyaltyAccounting.valuationCreated"));
      invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const approveValuation = trpc.loyalty.approveValuation.useMutation({
    onSuccess: () => {
      toast.success(t("admin.loyaltyAccounting.valuationApproved"));
      invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const runLifecycle = trpc.loyalty.runLifecycle.useMutation({
    onSuccess: result => {
      toast.success(
        t("admin.loyaltyAccounting.lifecycleRan", {
          expired: result.milesExpired,
          notices: result.noticesCreated,
        })
      );
      invalidate();
    },
    onError: error => toast.error(error.message),
  });

  if (loading)
    return (
      <div className="container mx-auto max-w-7xl space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  if (!user || (user.role !== "admin" && user.role !== "super_admin"))
    return <Redirect to="/" />;

  const s = summary.data;
  const locale = i18n.language;
  const tiles = s
    ? [
        {
          icon: Coins,
          label: t("admin.loyaltyAccounting.outstandingMiles"),
          value: s.outstandingMiles.toLocaleString(),
          hint: t("admin.loyaltyAccounting.unvaluedMiles", {
            miles: s.unvaluedMiles.toLocaleString(),
          }),
        },
        {
          icon: Scale,
          label: t("admin.loyaltyAccounting.liability"),
          value: `${sar(s.liabilityMinor, locale)} SAR`,
          hint: t("admin.loyaltyAccounting.reconciliation", {
            amount: sar(s.reconciliationDifferenceMinor, locale),
          }),
        },
        {
          icon: PieChart,
          label: t("admin.loyaltyAccounting.breakageEstimate"),
          value: `${sar(s.expectedBreakageMinor, locale)} SAR`,
          hint: t("admin.loyaltyAccounting.breakageRate", {
            rate: s.valuation.breakageRatePercent,
          }),
        },
        {
          icon: Hourglass,
          label: t("admin.loyaltyAccounting.expiring90"),
          value: s.expiringNext90Days.miles.toLocaleString(),
          hint: t("admin.loyaltyAccounting.expiringAccounts", {
            count: s.expiringNext90Days.accounts,
          }),
        },
      ]
    : [];

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      <SEO
        title={t("admin.loyaltyAccounting.title")}
        description={t("admin.loyaltyAccounting.subtitle")}
      />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {t("admin.loyaltyAccounting.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("admin.loyaltyAccounting.subtitle")}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => runLifecycle.mutate()}
          disabled={runLifecycle.isPending}
          data-testid="run-lifecycle"
        >
          <RefreshCw className="me-2 h-4 w-4" />
          {t("admin.loyaltyAccounting.runLifecycle")}
        </Button>
      </div>

      {summary.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : summary.error ? (
        <Card className="p-6 text-destructive">{summary.error.message}</Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {tiles.map(tile => (
            <Card key={tile.label} data-testid="loyalty-accounting-tile">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  {tile.label}
                </CardTitle>
                <tile.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{tile.value}</div>
                <p className="text-xs text-muted-foreground">{tile.hint}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {s && (
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.loyaltyAccounting.policy")}</CardTitle>
            <CardDescription>
              {t("admin.loyaltyAccounting.policyDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <span className="text-muted-foreground">
                {t("admin.loyaltyAccounting.valuationStatus")}:{" "}
              </span>
              <Badge
                variant={
                  s.valuation.status === "approved" ? "default" : "secondary"
                }
              >
                {t(`admin.loyaltyAccounting.status.${s.valuation.status}`)}
              </Badge>{" "}
              {s.valuation.sspMinorPerMile}{" "}
              {t("admin.loyaltyAccounting.halalaPerMile")}
            </div>
            <div>
              <span className="text-muted-foreground">
                {t("admin.loyaltyAccounting.expiryRule")}:{" "}
              </span>
              {t(`admin.loyaltyAccounting.expiryMode.${s.rule.expiryMode}`, {
                months: s.rule.expiryMonths,
              })}{" "}
              <Badge variant="outline">{s.rule.source}</Badge>
            </div>
            <div>
              <span className="text-muted-foreground">
                {t("admin.loyaltyAccounting.earningBasis")}:{" "}
              </span>
              {t(`admin.loyaltyAccounting.earning.${s.rule.earningBasis}`, {
                rate: s.rule.milesPerSar,
              })}
            </div>
            <div>
              <span className="text-muted-foreground">
                {t("admin.loyaltyAccounting.ledger")}:{" "}
              </span>
              {t("admin.loyaltyAccounting.ledgerLine", {
                deferred: sar(s.ledger.deferredMinor, locale),
                revenue: sar(s.ledger.revenueMinor, locale),
                breakage: sar(s.ledger.breakageMinor, locale),
                reversal: sar(s.ledger.reversalMinor, locale),
              })}
            </div>
            <div>
              <span className="text-muted-foreground">
                {t("admin.loyaltyAccounting.pendingNotices")}:{" "}
              </span>
              {s.pendingNotices}
            </div>
            <p className="text-xs text-muted-foreground md:col-span-2">
              {t("admin.loyaltyAccounting.financeNote")}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("admin.loyaltyAccounting.valuations")}</CardTitle>
          <CardDescription>
            {t("admin.loyaltyAccounting.valuationsDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <Label htmlFor="ssp">{t("admin.loyaltyAccounting.ssp")}</Label>
              <Input
                id="ssp"
                type="number"
                step="0.0001"
                min="0.0001"
                value={ssp}
                onChange={e => setSsp(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="breakage">
                {t("admin.loyaltyAccounting.breakage")}
              </Label>
              <Input
                id="breakage"
                type="number"
                step="0.01"
                min="0"
                max="99.99"
                value={breakage}
                onChange={e => setBreakage(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="effectiveFrom">
                {t("admin.loyaltyAccounting.effectiveFrom")}
              </Label>
              <Input
                id="effectiveFrom"
                type="date"
                value={effectiveFrom}
                onChange={e => setEffectiveFrom(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={() =>
                  createValuation.mutate({
                    sspMinorPerMile: Number(ssp),
                    breakageRatePercent: Number(breakage),
                    effectiveFrom: new Date(`${effectiveFrom}T00:00:00Z`),
                  })
                }
                disabled={createValuation.isPending}
                data-testid="create-valuation"
              >
                {t("admin.loyaltyAccounting.propose")}
              </Button>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("admin.loyaltyAccounting.effectiveFrom")}
                </TableHead>
                <TableHead>{t("admin.loyaltyAccounting.ssp")}</TableHead>
                <TableHead>{t("admin.loyaltyAccounting.breakage")}</TableHead>
                <TableHead>
                  {t("admin.loyaltyAccounting.statusLabel")}
                </TableHead>
                <TableHead>{t("admin.loyaltyAccounting.approvedBy")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(valuations.data ?? []).map(row => (
                <TableRow key={row.id}>
                  <TableCell>
                    {new Date(row.effectiveFrom).toISOString().slice(0, 10)}
                  </TableCell>
                  <TableCell>{row.sspMinorPerMile}</TableCell>
                  <TableCell>{row.breakageRatePercent}%</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.status === "approved" ? "default" : "secondary"
                      }
                    >
                      {t(`admin.loyaltyAccounting.status.${row.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>{row.approvedBy ?? "—"}</TableCell>
                  <TableCell>
                    {row.status === "draft" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => approveValuation.mutate({ id: row.id })}
                        disabled={approveValuation.isPending}
                      >
                        {t("admin.loyaltyAccounting.approve")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!valuations.isLoading && !valuations.data?.length && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    {t("admin.loyaltyAccounting.noValuations")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
