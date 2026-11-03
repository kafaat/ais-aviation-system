import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { SEO } from "@/components/SEO";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const CHANNELS = ["direct", "ndc", "gds", "ota"] as const;
const ACTIONS = [
  "shop",
  "price",
  "order_create",
  "pay",
  "order_change_voluntary",
  "order_change_involuntary",
  "passenger_split",
  "seat_move",
  "seat_fee_refund",
  "ancillary_change",
  "refund",
  "reissue",
  "name_correction",
] as const;
const SUPPORTS = ["supported", "unsupported", "partial"] as const;
const CONFIRMATIONS = ["confirmed", "unconfirmed"] as const;
type Channel = (typeof CHANNELS)[number];
type Action = (typeof ACTIONS)[number];

interface Form {
  id?: number;
  carrierCode: string;
  sellerId: string;
  channel: Channel;
  schemaVersion: string;
  action: Action;
  support: (typeof SUPPORTS)[number];
  confirmation: (typeof CONFIRMATIONS)[number];
  evidenceUrl: string;
  evidenceNote: string;
  idempotencyKeyHeader: string;
  traceIdHeader: string;
  effectiveFrom: string;
  effectiveTo: string;
}
const emptyForm: Form = {
  carrierCode: "*",
  sellerId: "*",
  channel: "ndc",
  schemaVersion: "24.1",
  action: "order_change_voluntary",
  support: "unsupported",
  confirmation: "unconfirmed",
  evidenceUrl: "",
  evidenceNote: "",
  idempotencyKeyHeader: "",
  traceIdHeader: "",
  effectiveFrom: "",
  effectiveTo: "",
};
const day = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString().slice(0, 10) : "";

function Select<T extends string>({
  id,
  value,
  options,
  label,
  onChange,
}: {
  id: string;
  value: T;
  options: readonly T[];
  label: (option: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <select
      id={id}
      className="block w-full rounded border bg-background p-2 text-sm"
      value={value}
      onChange={e => onChange(e.target.value as T)}
    >
      {options.map(option => (
        <option key={option} value={option}>
          {label(option)}
        </option>
      ))}
    </select>
  );
}

const supportVariant = (support: string) =>
  support === "supported"
    ? "default"
    : support === "partial"
      ? "secondary"
      : "destructive";

export default function NdcCapabilityMatrix() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [channelFilter, setChannelFilter] = useState<Channel | "">("");
  const [form, setForm] = useState<Form>(emptyForm);
  const [probe, setProbe] = useState({
    carrierCode: "LH",
    sellerId: "*",
    channel: "ndc" as Channel,
    schemaVersion: "24.1",
  });
  const rows = trpc.ndc.capabilities.list.useQuery({
    channel: channelFilter || undefined,
    includeSeeds: true,
  });
  const resolved = trpc.ndc.capabilities.resolve.useQuery(probe, {
    enabled: /^(\*|[A-Za-z0-9]{2,3})$/.test(probe.carrierCode),
  });
  const refresh = () => {
    void utils.ndc.capabilities.list.invalidate();
    void utils.ndc.capabilities.resolve.invalidate();
  };
  const upsert = trpc.ndc.capabilities.upsert.useMutation({
    onSuccess: () => {
      toast.success(t("ndcCapabilities.saved"));
      setForm(emptyForm);
      refresh();
    },
    onError: error => toast.error(error.message),
  });
  const remove = trpc.ndc.capabilities.remove.useMutation({
    onSuccess: () => {
      toast.success(t("ndcCapabilities.deleted"));
      refresh();
    },
    onError: error => toast.error(error.message),
  });
  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm(current => ({ ...current, [key]: value }));
  const submit = () =>
    upsert.mutate({
      id: form.id,
      carrierCode: form.carrierCode.trim() || "*",
      sellerId: form.sellerId.trim() || "*",
      channel: form.channel,
      schemaVersion: form.schemaVersion.trim() || "*",
      action: form.action,
      support: form.support,
      confirmation: form.confirmation,
      evidenceUrl: form.evidenceUrl.trim() || null,
      evidenceNote: form.evidenceNote.trim() || null,
      idempotencyKeyHeader: form.idempotencyKeyHeader.trim() || null,
      traceIdHeader: form.traceIdHeader.trim() || null,
      effectiveFrom: form.effectiveFrom ? new Date(form.effectiveFrom) : null,
      effectiveTo: form.effectiveTo ? new Date(form.effectiveTo) : null,
    });
  const field = (id: keyof Form, label: string, type = "text") => (
    <div>
      <Label htmlFor={`cap-${id}`}>{label}</Label>
      <Input
        id={`cap-${id}`}
        type={type}
        value={form[id] as string}
        onChange={e => set(id, e.target.value as never)}
      />
    </div>
  );
  return (
    <div className="space-y-6 p-4">
      <SEO title={t("ndcCapabilities.title")} />
      <header>
        <h1 className="text-2xl font-semibold">{t("ndcCapabilities.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("ndcCapabilities.subtitle")}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("ndcCapabilities.resolve")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("ndcCapabilities.resolveHint")}
          </p>
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <Label htmlFor="probe-carrier">
                {t("ndcCapabilities.carrier")}
              </Label>
              <Input
                id="probe-carrier"
                value={probe.carrierCode}
                onChange={e =>
                  setProbe({
                    ...probe,
                    carrierCode: e.target.value.toUpperCase(),
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="probe-seller">
                {t("ndcCapabilities.seller")}
              </Label>
              <Input
                id="probe-seller"
                value={probe.sellerId}
                onChange={e => setProbe({ ...probe, sellerId: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="probe-channel">
                {t("ndcCapabilities.channel")}
              </Label>
              <Select
                id="probe-channel"
                value={probe.channel}
                options={CHANNELS}
                label={c => t(`ndcCapabilities.channels.${c}`)}
                onChange={channel => setProbe({ ...probe, channel })}
              />
            </div>
            <div>
              <Label htmlFor="probe-version">
                {t("ndcCapabilities.schemaVersion")}
              </Label>
              <Input
                id="probe-version"
                value={probe.schemaVersion}
                onChange={e =>
                  setProbe({ ...probe, schemaVersion: e.target.value })
                }
              />
            </div>
          </div>
          {resolved.error && <p role="alert">{resolved.error.message}</p>}
          {resolved.data && (
            <ul className="grid gap-2 md:grid-cols-2" data-testid="resolved">
              {ACTIONS.map(action => {
                const decision = resolved.data.actions[action];
                return (
                  <li
                    key={action}
                    className="flex items-start justify-between gap-2 rounded border p-2 text-sm"
                  >
                    <div>
                      <div className="font-medium">
                        {t(`ndcCapabilities.actions.${action}`)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t(
                          `ndcCapabilities.precedences.${decision.precedence}`
                        )}{" "}
                        · {t(`ndcCapabilities.supports.${decision.support}`)} ·{" "}
                        {t(
                          `ndcCapabilities.confirmations.${decision.confirmation}`
                        )}
                      </div>
                    </div>
                    <Badge
                      variant={decision.allowed ? "default" : "destructive"}
                    >
                      {decision.allowed
                        ? t("ndcCapabilities.allowed")
                        : t("ndcCapabilities.blocked")}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("ndcCapabilities.add")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t("ndcCapabilities.wildcardHint")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("ndcCapabilities.idempotencyHint")}
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            {field("carrierCode", t("ndcCapabilities.carrier"))}
            {field("sellerId", t("ndcCapabilities.seller"))}
            <div>
              <Label htmlFor="cap-channel">
                {t("ndcCapabilities.channel")}
              </Label>
              <Select
                id="cap-channel"
                value={form.channel}
                options={CHANNELS}
                label={c => t(`ndcCapabilities.channels.${c}`)}
                onChange={v => set("channel", v)}
              />
            </div>
            {field("schemaVersion", t("ndcCapabilities.schemaVersion"))}
            <div>
              <Label htmlFor="cap-action">{t("ndcCapabilities.action")}</Label>
              <Select
                id="cap-action"
                value={form.action}
                options={ACTIONS}
                label={a => t(`ndcCapabilities.actions.${a}`)}
                onChange={v => set("action", v)}
              />
            </div>
            <div>
              <Label htmlFor="cap-support">
                {t("ndcCapabilities.support")}
              </Label>
              <Select
                id="cap-support"
                value={form.support}
                options={SUPPORTS}
                label={s => t(`ndcCapabilities.supports.${s}`)}
                onChange={v => set("support", v)}
              />
            </div>
            <div>
              <Label htmlFor="cap-confirmation">
                {t("ndcCapabilities.confirmation")}
              </Label>
              <Select
                id="cap-confirmation"
                value={form.confirmation}
                options={CONFIRMATIONS}
                label={c => t(`ndcCapabilities.confirmations.${c}`)}
                onChange={v => set("confirmation", v)}
              />
            </div>
            {field("evidenceUrl", t("ndcCapabilities.evidenceUrl"), "url")}
            {field("evidenceNote", t("ndcCapabilities.evidenceNote"))}
            {field(
              "idempotencyKeyHeader",
              t("ndcCapabilities.idempotencyKeyHeader")
            )}
            {field("traceIdHeader", t("ndcCapabilities.traceIdHeader"))}
            {field("effectiveFrom", t("ndcCapabilities.effectiveFrom"), "date")}
            {field("effectiveTo", t("ndcCapabilities.effectiveTo"), "date")}
          </div>
          <div className="flex gap-2">
            <Button onClick={submit} disabled={upsert.isPending}>
              {t("ndcCapabilities.save")}
            </Button>
            {form.id !== undefined && (
              <Button variant="outline" onClick={() => setForm(emptyForm)}>
                {t("common.cancel")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>{t("ndcCapabilities.matrix")}</CardTitle>
          <div className="w-48">
            <Label htmlFor="filter-channel">
              {t("ndcCapabilities.filterChannel")}
            </Label>
            <select
              id="filter-channel"
              className="block w-full rounded border bg-background p-2 text-sm"
              value={channelFilter}
              onChange={e => setChannelFilter(e.target.value as Channel | "")}
            >
              <option value="">{t("ndcCapabilities.allChannels")}</option>
              {CHANNELS.map(c => (
                <option key={c} value={c}>
                  {t(`ndcCapabilities.channels.${c}`)}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {rows.error && <p role="alert">{rows.error.message}</p>}
          {rows.data?.length === 0 && <p>{t("ndcCapabilities.noRows")}</p>}
          {!!rows.data?.length && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("ndcCapabilities.carrier")}</TableHead>
                  <TableHead>{t("ndcCapabilities.seller")}</TableHead>
                  <TableHead>{t("ndcCapabilities.channel")}</TableHead>
                  <TableHead>{t("ndcCapabilities.schemaVersion")}</TableHead>
                  <TableHead>{t("ndcCapabilities.action")}</TableHead>
                  <TableHead>{t("ndcCapabilities.support")}</TableHead>
                  <TableHead>{t("ndcCapabilities.confirmation")}</TableHead>
                  <TableHead>{t("ndcCapabilities.effective")}</TableHead>
                  <TableHead>
                    {t("ndcCapabilities.idempotencyKeyHeader")}
                  </TableHead>
                  <TableHead>{t("ndcCapabilities.traceIdHeader")}</TableHead>
                  <TableHead>{t("ndcCapabilities.evidence")}</TableHead>
                  <TableHead>{t("ndcCapabilities.source")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.data.map(row => (
                  <TableRow
                    key={`${row.source}-${row.id ?? ""}-${row.carrierCode}-${row.sellerId}-${row.channel}-${row.schemaVersion}-${row.action}`}
                  >
                    <TableCell>{row.carrierCode}</TableCell>
                    <TableCell>{row.sellerId}</TableCell>
                    <TableCell>
                      {t(`ndcCapabilities.channels.${row.channel}`)}
                    </TableCell>
                    <TableCell>{row.schemaVersion}</TableCell>
                    <TableCell>
                      {t(`ndcCapabilities.actions.${row.action}`)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={supportVariant(row.support)}>
                        {t(`ndcCapabilities.supports.${row.support}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {t(`ndcCapabilities.confirmations.${row.confirmation}`)}
                    </TableCell>
                    <TableCell>
                      {[day(row.effectiveFrom), day(row.effectiveTo)]
                        .filter(Boolean)
                        .join(" → ") || t("ndcCapabilities.open")}
                    </TableCell>
                    <TableCell className="max-w-xs text-xs">
                      {row.idempotencyKeyHeader ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-xs text-xs">
                      {row.traceIdHeader ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-xs text-xs">
                      {row.evidenceUrl ? (
                        <a
                          className="underline"
                          href={row.evidenceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {row.evidenceNote ?? row.evidenceUrl}
                        </a>
                      ) : (
                        row.evidenceNote
                      )}
                    </TableCell>
                    <TableCell>{t(`ndcCapabilities.${row.source}`)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setForm({
                            id: row.id ?? undefined,
                            carrierCode: row.carrierCode,
                            sellerId: row.sellerId,
                            channel: row.channel,
                            schemaVersion: row.schemaVersion,
                            action: row.action,
                            support: row.support,
                            confirmation: row.confirmation,
                            evidenceUrl: row.evidenceUrl ?? "",
                            evidenceNote: row.evidenceNote ?? "",
                            idempotencyKeyHeader:
                              row.idempotencyKeyHeader ?? "",
                            traceIdHeader: row.traceIdHeader ?? "",
                            effectiveFrom: day(row.effectiveFrom),
                            effectiveTo: day(row.effectiveTo),
                          })
                        }
                      >
                        {t("ndcCapabilities.edit")}
                      </Button>
                      {row.source === "database" && row.id != null && (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="ms-2"
                          disabled={remove.isPending}
                          onClick={() =>
                            remove.mutate({ id: row.id as number })
                          }
                        >
                          {t("ndcCapabilities.delete")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
