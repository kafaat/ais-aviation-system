/**
 * BSP Settlement - Admin Panel
 *
 * Link specifications, outbound DISH RET files, inbound HOT files, bank
 * remittances and the reconciliation gate. Direction: the airline sends RET
 * and receives HOT.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const api = trpc.bspSettlement;
const money = (minor: number, currency = "SAR") =>
  `${(minor / 100).toFixed(2)} ${currency}`;
const today = () => new Date().toISOString().slice(0, 10);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type LinkForm = {
  id?: number;
  bspCountry: string;
  settlementPlan: "bsp" | "arc" | "other";
  linkType: "ndclink" | "ifg" | "direct";
  dishVersion: string;
  airlineNumericCode: string;
  reportingSystemId: string;
  currency: string;
  timeZone: string;
  retCutoffLocalTime: string;
  hotCutoffLocalTime: string;
  effectiveFrom: string;
  effectiveTo: string;
};

const emptyLink = (country: string): LinkForm => ({
  bspCountry: country,
  settlementPlan: "bsp",
  linkType: "ndclink",
  dishVersion: "23.1",
  airlineNumericCode: "",
  reportingSystemId: "AIS",
  currency: "SAR",
  timeZone: "Asia/Riyadh",
  retCutoffLocalTime: "23:59",
  hotCutoffLocalTime: "23:59",
  effectiveFrom: today(),
  effectiveTo: "",
});

function statusBadge(status: string) {
  const tone =
    status === "confirmed" ||
    status === "accepted" ||
    status === "complete" ||
    status === "matched"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : status === "rejected" ||
          status === "revoked" ||
          status === "blocked" ||
          status === "amount_mismatch" ||
          status === "unexpected_in_hot"
        ? "bg-red-100 text-red-800 border-red-200"
        : "bg-amber-100 text-amber-800 border-amber-200";
  return (
    <Badge variant="outline" className={tone}>
      {status}
    </Badge>
  );
}

export default function BSPSettlement() {
  const { t } = useTranslation();
  const [country, setCountry] = useState("SA");
  const [tab, setTab] = useState("links");
  const utils = trpc.useUtils();
  const invalidate = () => utils.bspSettlement.invalidate();

  // ---- Link specifications ----
  const specs = api.listLinkSpecifications.useQuery({ bspCountry: country });
  const [link, setLink] = useState<LinkForm>(emptyLink("SA"));
  const [confirmRef, setConfirmRef] = useState("");
  const saveLink = api.saveLinkSpecification.useMutation({
    onSuccess: () => {
      toast.success(t("bspSettlement.links.saved"));
      invalidate();
    },
    onError: e =>
      toast.error(t("bspSettlement.links.failed", { error: e.message })),
  });
  const confirmLink = api.confirmLinkSpecification.useMutation({
    onSuccess: () => {
      toast.success(t("bspSettlement.links.confirmed"));
      invalidate();
    },
    onError: e =>
      toast.error(t("bspSettlement.links.failed", { error: e.message })),
  });
  const revokeLink = api.revokeLinkSpecification.useMutation({
    onSuccess: () => {
      toast.success(t("bspSettlement.links.revoked"));
      invalidate();
    },
    onError: e =>
      toast.error(t("bspSettlement.links.failed", { error: e.message })),
  });

  // ---- RET ----
  const retFiles = api.listRetFiles.useQuery({ bspCountry: country });
  const [reportingDate, setReportingDate] = useState(today());
  const [ackReason, setAckReason] = useState("");
  const retError = (e: { message: string }) =>
    toast.error(t("bspSettlement.ret.failed", { error: e.message }));
  const generateRet = api.generateRet.useMutation({
    onSuccess: data => {
      toast.success(
        t("bspSettlement.ret.generated", { count: data.transactionCount })
      );
      invalidate();
    },
    onError: retError,
  });
  const transmitRet = api.transmitRet.useMutation({
    onSuccess: () => {
      toast.success(t("bspSettlement.ret.transmitted"));
      invalidate();
    },
    onError: retError,
  });
  const acknowledgeRet = api.acknowledgeRet.useMutation({
    onSuccess: () => {
      toast.success(t("bspSettlement.ret.acknowledged"));
      invalidate();
    },
    onError: retError,
  });

  // ---- HOT ----
  const hotFiles = api.listHotFiles.useQuery({ bspCountry: country });
  const [hotName, setHotName] = useState("");
  const [hotContent, setHotContent] = useState("");
  const ingestHot = api.ingestHot.useMutation({
    onSuccess: data => {
      toast.success(
        t("bspSettlement.hot.ingested", { count: data.transactionCount })
      );
      setHotContent("");
      invalidate();
    },
    onError: e =>
      toast.error(t("bspSettlement.hot.failed", { error: e.message })),
  });

  // ---- Bank ----
  const remittances = api.listBankRemittances.useQuery({ bspCountry: country });
  const [csv, setCsv] = useState("");
  const [bankCurrency, setBankCurrency] = useState("SAR");
  const importBank = api.importBankStatement.useMutation({
    onSuccess: data => {
      toast.success(
        t("bspSettlement.bank.imported", { count: data.lineCount })
      );
      setCsv("");
      invalidate();
    },
    onError: e =>
      toast.error(t("bspSettlement.bank.failed", { error: e.message })),
  });

  // ---- Reconciliation ----
  const runs = api.listReconciliationRuns.useQuery({ bspCountry: country });
  const [periodStart, setPeriodStart] = useState(today());
  const [periodEnd, setPeriodEnd] = useState(today());
  const [runId, setRunId] = useState<number | null>(null);
  const report = api.getReconciliationReport.useQuery(
    { runId: runId ?? 0 },
    { enabled: runId !== null }
  );
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const runReconciliation = api.runReconciliation.useMutation({
    onSuccess: data => {
      toast.success(
        t("bspSettlement.reconcile.reconciled", { id: data.run.id })
      );
      setRunId(data.run.id);
      invalidate();
    },
    onError: e =>
      toast.error(t("bspSettlement.reconcile.failed", { error: e.message })),
  });
  const disposition = api.dispositionItem.useMutation({
    onSuccess: () => {
      toast.success(t("bspSettlement.reconcile.dispositioned"));
      invalidate();
    },
    onError: e =>
      toast.error(t("bspSettlement.reconcile.failed", { error: e.message })),
  });

  const field = (key: keyof LinkForm, label: string, type = "text") => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        type={type}
        value={link[key] ?? ""}
        onChange={e => setLink({ ...link, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 dark:from-blue-950/20 dark:via-indigo-950/20 dark:to-purple-950/20 p-6 rounded-xl space-y-2">
        <h1 className="text-2xl font-bold">{t("bspSettlement.title")}</h1>
        <p className="text-muted-foreground">{t("bspSettlement.subtitle")}</p>
        <p className="text-sm">{t("bspSettlement.direction")}</p>
        <div className="flex items-end gap-2 max-w-xs">
          <div className="space-y-1">
            <Label>{t("bspSettlement.country")}</Label>
            <Input
              value={country}
              maxLength={2}
              onChange={e => setCountry(e.target.value.toUpperCase())}
            />
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-5">
          {(["links", "ret", "hot", "bank", "reconcile"] as const).map(k => (
            <TabsTrigger key={k} value={k}>
              {t(`bspSettlement.tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="links" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("bspSettlement.links.title")}</CardTitle>
              <CardDescription>
                {t("bspSettlement.links.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>{t("bspSettlement.links.settlementPlan")}</Label>
                  <select
                    className="w-full border rounded-md h-9 px-2 bg-background"
                    value={link.settlementPlan}
                    onChange={e =>
                      setLink({
                        ...link,
                        settlementPlan: e.target
                          .value as LinkForm["settlementPlan"],
                      })
                    }
                  >
                    <option value="bsp">IATA BSP</option>
                    <option value="arc">
                      ARC ({t("bspSettlement.links.stub")})
                    </option>
                    <option value="other">
                      Other ({t("bspSettlement.links.stub")})
                    </option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>{t("bspSettlement.links.linkType")}</Label>
                  <select
                    className="w-full border rounded-md h-9 px-2 bg-background"
                    value={link.linkType}
                    onChange={e =>
                      setLink({
                        ...link,
                        linkType: e.target.value as LinkForm["linkType"],
                      })
                    }
                  >
                    <option value="ndclink">NDCLink</option>
                    <option value="ifg">IFG</option>
                    <option value="direct">Direct</option>
                  </select>
                </div>
                {field("dishVersion", t("bspSettlement.links.dishVersion"))}
                {field(
                  "airlineNumericCode",
                  t("bspSettlement.links.airlineCode")
                )}
                {field("reportingSystemId", t("bspSettlement.links.systemId"))}
                {field("currency", t("bspSettlement.links.currency"))}
                {field("timeZone", t("bspSettlement.links.timeZone"))}
                {field(
                  "retCutoffLocalTime",
                  t("bspSettlement.links.retCutoff")
                )}
                {field(
                  "hotCutoffLocalTime",
                  t("bspSettlement.links.hotCutoff")
                )}
                {field(
                  "effectiveFrom",
                  t("bspSettlement.links.effectiveFrom"),
                  "date"
                )}
                {field(
                  "effectiveTo",
                  t("bspSettlement.links.effectiveTo"),
                  "date"
                )}
              </div>
              <Button
                disabled={saveLink.isPending}
                onClick={() =>
                  saveLink.mutate({
                    ...link,
                    bspCountry: country,
                    effectiveTo: link.effectiveTo || null,
                  })
                }
              >
                {t("bspSettlement.links.save")}
              </Button>
              <div className="space-y-2">
                {specs.data?.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("bspSettlement.links.none")}
                  </p>
                )}
                {specs.data?.map(s => (
                  <div
                    key={s.id}
                    className="border rounded-lg p-3 flex flex-wrap items-center gap-3 text-sm"
                  >
                    <span className="font-mono">#{s.id}</span>
                    <span>
                      {s.settlementPlan.toUpperCase()} / {s.linkType} / DISH{" "}
                      {s.dishVersion}
                    </span>
                    <span>
                      {s.effectiveFrom} → {s.effectiveTo ?? "…"}
                    </span>
                    <span>
                      RET {s.retCutoffLocalTime} · HOT {s.hotCutoffLocalTime} (
                      {s.timeZone})
                    </span>
                    {statusBadge(s.confirmationStatus)}
                    {s.confirmationReference && (
                      <span className="font-mono text-xs">
                        {s.confirmationReference}
                      </span>
                    )}
                    <div className="flex gap-2 ml-auto">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setLink({
                            id: s.id,
                            bspCountry: s.bspCountry,
                            settlementPlan: s.settlementPlan,
                            linkType: s.linkType,
                            dishVersion: s.dishVersion,
                            airlineNumericCode: s.airlineNumericCode,
                            reportingSystemId: s.reportingSystemId,
                            currency: s.currency,
                            timeZone: s.timeZone,
                            retCutoffLocalTime: s.retCutoffLocalTime,
                            hotCutoffLocalTime: s.hotCutoffLocalTime,
                            effectiveFrom: s.effectiveFrom,
                            effectiveTo: s.effectiveTo ?? "",
                          })
                        }
                      >
                        Edit
                      </Button>
                      {s.confirmationStatus === "draft" && (
                        <>
                          <Input
                            className="h-8 w-44"
                            placeholder={t(
                              "bspSettlement.links.confirmReference"
                            )}
                            value={confirmRef}
                            onChange={e => setConfirmRef(e.target.value)}
                          />
                          <Button
                            size="sm"
                            disabled={!confirmRef || confirmLink.isPending}
                            onClick={() =>
                              confirmLink.mutate({
                                id: s.id,
                                confirmationReference: confirmRef,
                              })
                            }
                          >
                            {t("bspSettlement.links.confirm")}
                          </Button>
                        </>
                      )}
                      {s.confirmationStatus === "confirmed" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => revokeLink.mutate({ id: s.id })}
                        >
                          {t("bspSettlement.links.revoke")}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ret" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("bspSettlement.ret.title")}</CardTitle>
              <CardDescription>
                {t("bspSettlement.ret.description")}{" "}
                {t("bspSettlement.ret.fallbackHint")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <Label>{t("bspSettlement.ret.reportingDate")}</Label>
                  <Input
                    type="date"
                    value={reportingDate}
                    onChange={e => setReportingDate(e.target.value)}
                  />
                </div>
                <Button
                  disabled={generateRet.isPending}
                  onClick={() =>
                    generateRet.mutate({ bspCountry: country, reportingDate })
                  }
                >
                  {t("bspSettlement.ret.generate")}
                </Button>
                <Input
                  className="w-72"
                  placeholder={t("bspSettlement.ret.ackReason")}
                  value={ackReason}
                  onChange={e => setAckReason(e.target.value)}
                />
              </div>
              {retFiles.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("bspSettlement.ret.none")}
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="p-2">{t("bspSettlement.ret.file")}</th>
                      <th className="p-2">{t("bspSettlement.ret.records")}</th>
                      <th className="p-2">
                        {t("bspSettlement.ret.transactions")}
                      </th>
                      <th className="p-2">{t("bspSettlement.ret.net")}</th>
                      <th className="p-2">{t("bspSettlement.ret.fallback")}</th>
                      <th className="p-2">{t("bspSettlement.ret.status")}</th>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {retFiles.data?.map(f => {
                      const totals = f.controlTotals as {
                        netRemittance?: number;
                        currency?: string;
                      } | null;
                      return (
                        <tr key={f.id} className="border-t">
                          <td className="p-2">
                            <div className="font-mono text-xs">
                              {f.fileName}
                            </div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {f.sha256.slice(0, 16)}…
                            </div>
                          </td>
                          <td className="p-2">{f.recordCount}</td>
                          <td className="p-2">{f.transactionCount}</td>
                          <td className="p-2">
                            {typeof totals?.netRemittance === "number"
                              ? money(totals.netRemittance, totals.currency)
                              : "—"}
                          </td>
                          <td className="p-2">{f.fallbackLineCount}</td>
                          <td className="p-2">{statusBadge(f.status)}</td>
                          <td className="p-2 flex gap-1">
                            {f.status === "generated" && (
                              <Button
                                size="sm"
                                disabled={transmitRet.isPending}
                                onClick={() =>
                                  transmitRet.mutate({ fileId: f.id })
                                }
                              >
                                {t("bspSettlement.ret.transmit")}
                              </Button>
                            )}
                            {f.status === "transmitted" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!ackReason}
                                  onClick={() =>
                                    acknowledgeRet.mutate({
                                      fileId: f.id,
                                      outcome: "accepted",
                                      reason: ackReason,
                                    })
                                  }
                                >
                                  {t("bspSettlement.ret.accepted")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={!ackReason}
                                  onClick={() =>
                                    acknowledgeRet.mutate({
                                      fileId: f.id,
                                      outcome: "rejected",
                                      reason: ackReason,
                                    })
                                  }
                                >
                                  {t("bspSettlement.ret.rejected")}
                                </Button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hot" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("bspSettlement.hot.title")}</CardTitle>
              <CardDescription>
                {t("bspSettlement.hot.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t("bspSettlement.hot.fileName")}</Label>
                <Input
                  value={hotName}
                  onChange={e => setHotName(e.target.value)}
                />
                <Label>{t("bspSettlement.hot.content")}</Label>
                <textarea
                  className="w-full border rounded-md p-2 font-mono text-xs h-40 bg-background"
                  value={hotContent}
                  onChange={e => setHotContent(e.target.value)}
                />
                <Button
                  disabled={!hotName || !hotContent || ingestHot.isPending}
                  onClick={() =>
                    ingestHot.mutate({
                      bspCountry: country,
                      fileName: hotName,
                      content: hotContent,
                    })
                  }
                >
                  {t("bspSettlement.hot.ingest")}
                </Button>
              </div>
              {hotFiles.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("bspSettlement.hot.none")}
                </p>
              )}
              <div className="space-y-2">
                {hotFiles.data?.map(f => {
                  const totals = f.totals as { netRemittance?: number } | null;
                  const warnings = Array.isArray(f.warnings)
                    ? (f.warnings as string[])
                    : [];
                  return (
                    <div
                      key={f.id}
                      className="border rounded-lg p-3 text-sm space-y-1"
                    >
                      <div className="flex flex-wrap gap-3">
                        <span className="font-mono text-xs">{f.fileName}</span>
                        <span>
                          {t("bspSettlement.hot.processingDate")}:{" "}
                          {f.processingDate ?? "—"}
                        </span>
                        <span>
                          {t("bspSettlement.hot.transactions")}:{" "}
                          {f.transactionCount}
                        </span>
                        <span>
                          {t("bspSettlement.hot.netRemittance")}:{" "}
                          {typeof totals?.netRemittance === "number"
                            ? money(totals.netRemittance)
                            : "—"}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {f.sha256.slice(0, 16)}…
                        </span>
                      </div>
                      {warnings.length > 0 && (
                        <ul className="text-xs text-amber-700 list-disc ps-5">
                          {warnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bank" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("bspSettlement.bank.title")}</CardTitle>
              <CardDescription>
                {t("bspSettlement.bank.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t("bspSettlement.bank.currency")}</Label>
                <Input
                  className="w-24"
                  value={bankCurrency}
                  maxLength={3}
                  onChange={e => setBankCurrency(e.target.value.toUpperCase())}
                />
                <Label>{t("bspSettlement.bank.csv")}</Label>
                <textarea
                  className="w-full border rounded-md p-2 font-mono text-xs h-32 bg-background"
                  placeholder="date,amount,reference"
                  value={csv}
                  onChange={e => setCsv(e.target.value)}
                />
                <Button
                  disabled={!csv || importBank.isPending}
                  onClick={() =>
                    importBank.mutate({
                      bspCountry: country,
                      currency: bankCurrency,
                      csv,
                    })
                  }
                >
                  {t("bspSettlement.bank.import")}
                </Button>
              </div>
              {remittances.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("bspSettlement.bank.none")}
                </p>
              )}
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="p-2">{t("bspSettlement.bank.valueDate")}</th>
                    <th className="p-2">{t("bspSettlement.bank.amount")}</th>
                    <th className="p-2">{t("bspSettlement.bank.reference")}</th>
                    <th className="p-2">
                      {t("bspSettlement.bank.counterparty")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {remittances.data?.map(r => (
                    <tr key={r.id} className="border-t">
                      <td className="p-2">{r.valueDate}</td>
                      <td className="p-2">{money(r.amount, r.currency)}</td>
                      <td className="p-2 font-mono text-xs">{r.reference}</td>
                      <td className="p-2">{r.counterparty ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reconcile" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("bspSettlement.reconcile.title")}</CardTitle>
              <CardDescription>
                {t("bspSettlement.reconcile.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label>{t("bspSettlement.reconcile.periodStart")}</Label>
                  <Input
                    type="date"
                    value={periodStart}
                    onChange={e => setPeriodStart(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t("bspSettlement.reconcile.periodEnd")}</Label>
                  <Input
                    type="date"
                    value={periodEnd}
                    onChange={e => setPeriodEnd(e.target.value)}
                  />
                </div>
                <Button
                  disabled={runReconciliation.isPending}
                  onClick={() =>
                    runReconciliation.mutate({
                      bspCountry: country,
                      periodStart,
                      periodEnd,
                      settlementPlan: "bsp",
                    })
                  }
                >
                  {t("bspSettlement.reconcile.run")}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {runs.data?.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("bspSettlement.reconcile.none")}
                  </p>
                )}
                {runs.data?.map(r => (
                  <Button
                    key={r.id}
                    size="sm"
                    variant={runId === r.id ? "default" : "outline"}
                    onClick={() => setRunId(r.id)}
                  >
                    #{r.id} {r.periodStart}→{r.periodEnd} · {r.status}
                  </Button>
                ))}
              </div>
              {report.data && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {statusBadge(report.data.gate.status)}
                    <span className="font-medium">
                      {report.data.gate.status === "complete"
                        ? t("bspSettlement.reconcile.complete")
                        : t("bspSettlement.reconcile.blocked", {
                            count: report.data.gate.openItems,
                          })}
                    </span>
                    {Object.entries(report.data.counts).map(([k, v]) => (
                      <span key={k} className="text-xs">
                        {t(`bspSettlement.reconcile.classes.${k}`)}: {v}
                      </span>
                    ))}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-muted-foreground">
                        <tr>
                          <th className="p-2">
                            {t("bspSettlement.reconcile.document")}
                          </th>
                          <th className="p-2">
                            {t("bspSettlement.reconcile.code")}
                          </th>
                          <th className="p-2">
                            {t("bspSettlement.reconcile.expected")}
                          </th>
                          <th className="p-2">
                            {t("bspSettlement.reconcile.hotAmount")}
                          </th>
                          <th className="p-2">
                            {t("bspSettlement.reconcile.classification")}
                          </th>
                          <th className="p-2">
                            {t("bspSettlement.reconcile.disposition")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.data.items.map(item => (
                          <tr key={item.id} className="border-t">
                            <td className="p-2 font-mono text-xs">
                              {item.documentNumber}
                              {item.retLineId === null &&
                                item.classification !== "unexpected_in_hot" && (
                                  <span className="ml-1 text-amber-700">
                                    ({t("bspSettlement.reconcile.notReported")})
                                  </span>
                                )}
                            </td>
                            <td className="p-2">{item.transactionCode}</td>
                            <td className="p-2">
                              {item.expectedAmount === null
                                ? "—"
                                : money(item.expectedAmount)}
                            </td>
                            <td className="p-2">
                              {item.hotAmount === null
                                ? "—"
                                : money(item.hotAmount)}
                            </td>
                            <td className="p-2">
                              {statusBadge(item.classification)}
                            </td>
                            <td className="p-2">
                              {item.classification === "matched" ? (
                                "—"
                              ) : item.dispositionReason ? (
                                <span className="text-xs">
                                  {item.dispositionReason}
                                </span>
                              ) : (
                                <div className="flex gap-1">
                                  <Input
                                    className="h-8 w-56"
                                    placeholder={t(
                                      "bspSettlement.reconcile.dispositionReason"
                                    )}
                                    value={reasons[item.id] ?? ""}
                                    onChange={e =>
                                      setReasons({
                                        ...reasons,
                                        [item.id]: e.target.value,
                                      })
                                    }
                                  />
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                      (reasons[item.id] ?? "").length < 5 ||
                                      disposition.isPending
                                    }
                                    onClick={() =>
                                      disposition.mutate({
                                        itemId: item.id,
                                        reason: reasons[item.id],
                                      })
                                    }
                                  >
                                    {t(
                                      "bspSettlement.reconcile.disposition_btn"
                                    )}
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {report.error && (
                <p className="text-sm text-red-700">
                  {errorText(report.error)}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
