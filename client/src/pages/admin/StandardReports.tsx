import { useEffect, useRef, useState } from "react";
import { Link, Redirect } from "wouter";
import { useTranslation } from "react-i18next";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import {
  STANDARD_REPORT_FORMATS,
  type ReportCell,
  type StandardReportCategory,
  type StandardReportDefinition,
  type StandardReportFilterKey,
  type StandardReportFilters,
  type StandardReportFormat,
  type StandardReportResult,
} from "@shared/standard-reports";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { downloadFile } from "@/lib/downloadFile";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  Download,
  FileText,
  History,
  Info,
  Library,
  Loader2,
  Play,
  Save,
  Search,
  ShieldAlert,
} from "lucide-react";
import {
  standardReportCopy,
  type StandardReportCopy,
} from "./standard-report-copy";

type Outputs = inferRouterOutputs<AppRouter>["standardReports"];
type Template = Outputs["templates"][number];
type Run = Outputs["runs"][number];
type Tab = "catalog" | "templates" | "history";
type FilterDraft = Partial<Record<StandardReportFilterKey, string>>;
type TemplateDraft = {
  name: string;
  format: StandardReportFormat;
  cadence: "manual" | "daily" | "weekly" | "monthly";
  time: string;
  rolling: boolean;
  lookbackDays: string;
  emailToOwner: boolean;
  enabled: boolean;
};
const initialTemplate = (): TemplateDraft => ({
  name: "",
  format: "csv",
  cadence: "manual",
  time: "08:00",
  rolling: false,
  lookbackDays: "1",
  emailToOwner: false,
  enabled: true,
});
const numberFilters = new Set<StandardReportFilterKey>([
  "flightId",
  "couponNumber",
  "memberId",
  "officeId",
]);
const selectClass =
  "border-input bg-background flex h-10 w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const checkboxClass =
  "size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const PAGE_SIZE = 100;

function requiredFilters(
  report: StandardReportDefinition
): StandardReportFilterKey[] {
  // These are lookup hints; the registered reader remains the authority.
  const keys: StandardReportFilterKey[] = [];
  if ([5, 15, 16].includes(report.id)) keys.push("startDate");
  if ([2, 3, 17, 18, 19, 20, 22, 23, 25, 53, 56, 62].includes(report.id))
    keys.push("flightId");
  if ([11, 12, 26, 57, 64].includes(report.id)) keys.push("origin");
  if (report.id === 12) keys.push("destination");
  if (report.id === 31) keys.push("memberId");
  if ([9, 59, 60].includes(report.id)) keys.push("bookingReference");
  if ([6, 90].includes(report.id)) keys.push("ticketNumber");
  if (report.id === 90) keys.push("couponNumber");
  if (report.category === "finance" && ![89, 95].includes(report.id)) {
    if (report.filters.includes("startDate")) keys.push("startDate");
    if (report.filters.includes("endDate")) keys.push("endDate");
  }
  return [...new Set(keys)].filter(key => report.filters.includes(key));
}

function defaultFilters(report: StandardReportDefinition): FilterDraft {
  const today = new Date().toISOString().slice(0, 10);
  return Object.fromEntries(
    report.filters
      .filter(key => key === "startDate" || key === "endDate")
      .map(key => [key, today])
  );
}

function toFilters(
  report: StandardReportDefinition,
  draft: FilterDraft,
  copy: StandardReportCopy
): StandardReportFilters {
  const values: StandardReportFilters = {};
  for (const key of report.filters) {
    const value = draft[key]?.trim();
    if (!value) {
      if (requiredFilters(report).includes(key))
        throw new Error(`${copy.requiredError} ${copy[key]}`);
      continue;
    }
    if (numberFilters.has(key)) {
      const number = Number(value);
      if (
        !Number.isSafeInteger(number) ||
        number < 1 ||
        number > (key === "couponNumber" ? 99 : 2_147_483_647)
      )
        throw new Error(`${copy.numberError} ${copy[key]}`);
      Object.assign(values, { [key]: number });
    } else {
      if (key === "startDate" || key === "endDate") {
        const date = new Date(`${value}T00:00:00.000Z`);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(date.getTime()) ||
          date.toISOString().slice(0, 10) !== value
        )
          throw new Error(`${copy.invalidDate} ${copy[key]}`);
      }
      Object.assign(values, {
        [key]: ["origin", "destination", "bookingReference"].includes(key)
          ? value.toUpperCase()
          : value,
      });
    }
  }
  if (values.startDate && values.endDate && values.startDate > values.endDate)
    throw new Error(copy.dateError);
  return values;
}

function utcDate(value: Date | string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`
    : "—";
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message
    ? `${fallback} ${error.message}`
    : fallback;
}

function Failure({
  message,
  retry,
  copy,
}: {
  message: string;
  retry: () => void;
  copy: StandardReportCopy;
}) {
  return (
    <Alert variant="destructive">
      <ShieldAlert aria-hidden="true" />
      <AlertDescription>
        <p>{message}</p>
        <Button size="sm" variant="outline" onClick={retry}>
          {copy.retry}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function Availability({
  value,
  copy,
}: {
  value: StandardReportDefinition["availability"];
  copy: StandardReportCopy;
}) {
  return (
    <Badge
      variant="outline"
      className={
        value === "available"
          ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          : value === "partial"
            ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            : "border-slate-300 bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200"
      }
    >
      {copy[value]}
    </Badge>
  );
}

function Cell({
  value,
  copy,
}: {
  value: ReportCell | undefined;
  copy: StandardReportCopy;
}) {
  if (value === null || value === undefined)
    return (
      <span className="text-muted-foreground italic">{copy.notRecorded}</span>
    );
  if (typeof value === "boolean") return <>{value ? copy.yes : copy.no}</>;
  return (
    <span
      className={
        typeof value === "number"
          ? "tabular-nums"
          : "whitespace-pre-wrap break-words"
      }
      dir="auto"
    >
      {value}
    </span>
  );
}

export default function StandardReports() {
  const { user, loading } = useAuth();
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const copy = standardReportCopy(language);
  const platform = user && ["admin", "super_admin"].includes(user.role);
  const allowed = Boolean(
    user &&
    (platform ||
      (["airline_admin", "finance", "ops"].includes(user.role) &&
        user.tenantId != null))
  );
  if (loading)
    return (
      <div
        className="flex min-h-64 items-center justify-center gap-3"
        role="status"
      >
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        {copy.loading}
      </div>
    );
  if (!allowed || !user) return <Redirect to="/" />;
  return (
    <DashboardLayout>
      <ScopedReportWorkspace
        key={`${user.id}:${user.role}:${user.tenantId}`}
        language={language}
        email={user.email ?? null}
      />
    </DashboardLayout>
  );
}

function ScopedReportWorkspace(props: {
  language: string;
  email: string | null;
}) {
  const { client } = trpc.useUtils();
  const parentCache = useQueryClient();
  // These endpoints deliberately take no client-supplied tenant or role. Their
  // ordinary tRPC keys therefore cannot distinguish authorization scopes. The
  // keyed parent creates a fresh, private cache before the first render after
  // a user, role, or tenant change, including tabs whose queries are disabled.
  // Late responses can only populate the old cache; they cannot become a new
  // scope's data. Zero GC time removes its records once observers unmount.
  const [cache] = useState(() => {
    const defaults = parentCache.getDefaultOptions();
    return new QueryClient({
      defaultOptions: {
        ...defaults,
        queries: { ...defaults.queries, gcTime: 0 },
        mutations: { ...defaults.mutations, gcTime: 0 },
      },
    });
  });
  return (
    <trpc.Provider client={client} queryClient={cache} abortOnUnmount>
      <QueryClientProvider client={cache}>
        <ReportWorkspace {...props} />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

function ReportWorkspace({
  language,
  email,
}: {
  language: string;
  email: string | null;
}) {
  const copy = standardReportCopy(language);
  const rtl = language.startsWith("ar");
  const [tab, setTab] = useState<Tab>("catalog");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<StandardReportCategory | "all">(
    "all"
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filters, setFilters] = useState<FilterDraft>({});
  const [result, setResult] = useState<StandardReportResult | null>(null);
  const [columns, setColumns] = useState<string[] | undefined>();
  const [page, setPage] = useState(0);
  const [template, setTemplate] = useState<TemplateDraft>(initialTemplate);
  const [editingId, setEditingId] = useState<number | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [historyCursors, setHistoryCursors] = useState<number[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const revision = useRef(0);
  const manualRequestIds = useRef(new Map<number, string>());
  const utils = trpc.useUtils();
  const catalogQuery = trpc.standardReports.catalog.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const templatesQuery = trpc.standardReports.templates.useQuery(undefined, {
    enabled: tab === "templates",
    retry: false,
    refetchOnWindowFocus: false,
  });
  const historyQuery = trpc.standardReports.runs.useQuery(
    { beforeId: historyCursors.at(-1) },
    { enabled: tab === "history", retry: false, refetchOnWindowFocus: false }
  );
  const runMutation = trpc.standardReports.run.useMutation();
  const exportMutation = trpc.standardReports.export.useMutation();
  const saveMutation = trpc.standardReports.saveTemplate.useMutation();
  const deleteMutation = trpc.standardReports.deleteTemplate.useMutation();
  const enabledMutation = trpc.standardReports.setTemplateEnabled.useMutation();
  const templateRunMutation = trpc.standardReports.runTemplate.useMutation();
  const downloadRunMutation = trpc.standardReports.downloadRun.useMutation();
  const templateBusy =
    saveMutation.isPending ||
    deleteMutation.isPending ||
    templateRunMutation.isPending ||
    enabledMutation.isPending;
  const catalog = catalogQuery.isError ? [] : (catalogQuery.data ?? []);
  const selected = catalog.find(report => report.id === selectedId);
  const required = selected ? requiredFilters(selected) : [];
  const rollingAllowed = Boolean(
    selected?.filters.includes("startDate") &&
    selected.filters.includes("endDate")
  );
  const visibleReports = catalog.filter(
    report =>
      (category === "all" || report.category === category) &&
      `${report.id} ${report.title}`
        .toLowerCase()
        .includes(search.toLowerCase().trim())
  );
  const selectedColumns = result
    ? (columns ?? result.columns.map(column => column.key))
    : [];
  const projectedColumns = result
    ? selectedColumns.flatMap(key => {
        const column = result.columns.find(item => item.key === key);
        return column ? [column] : [];
      })
    : [];
  const pageCount = result
    ? Math.max(1, Math.ceil(result.rows.length / PAGE_SIZE))
    : 1;
  const safePage = Math.min(page, pageCount - 1);
  const rows =
    result?.rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE) ?? [];

  useEffect(
    () => () => {
      revision.current += 1;
    },
    []
  );
  useEffect(() => {
    if (selectedId !== null || !catalogQuery.data?.length) return;
    const first =
      catalogQuery.data.find(report => report.availability !== "blocked") ??
      catalogQuery.data[0];
    if (first) {
      setSelectedId(first.id);
      setFilters(defaultFilters(first));
    }
  }, [catalogQuery.data, selectedId]);

  function invalidatePreview() {
    revision.current += 1;
    setResult(null);
    setPage(0);
    setActionError(null);
    setMessage(null);
  }

  function chooseReport(report: StandardReportDefinition) {
    invalidatePreview();
    setSelectedId(report.id);
    setFilters(defaultFilters(report));
    setColumns(undefined);
    setTemplate(initialTemplate());
    setEditingId(undefined);
  }

  function changeFilter(key: StandardReportFilterKey, value: string) {
    invalidatePreview();
    setFilters(current => ({ ...current, [key]: value }));
  }

  async function previewReport() {
    if (!selected || selected.availability === "blocked") return;
    const requestRevision = ++revision.current;
    setResult(null);
    setPage(0);
    setActionError(null);
    setMessage(null);
    try {
      const request = {
        reportId: selected.id,
        filters: toFilters(selected, filters, copy),
      };
      const data = await runMutation.mutateAsync(request);
      if (requestRevision !== revision.current) return;
      if (data.reportId !== request.reportId) throw new Error(copy.changed);
      setResult(data);
      setColumns(current =>
        current
          ? current.filter(key =>
              data.columns.some(column => column.key === key)
            )
          : data.columns.map(column => column.key)
      );
    } catch (error) {
      if (requestRevision === revision.current)
        setActionError(errorText(error, copy.reportError));
    }
  }

  function changeColumns(next: string[]) {
    revision.current += 1;
    setColumns(next);
    setPage(0);
    setActionError(null);
    setMessage(null);
  }

  function moveColumn(key: string, amount: -1 | 1) {
    const order = [...selectedColumns];
    const index = order.indexOf(key);
    const target = index + amount;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    changeColumns(order);
  }

  async function exportReport(format: StandardReportFormat) {
    if (!selected || !result || !projectedColumns.length) return;
    const requestRevision = revision.current;
    setActionError(null);
    setMessage(null);
    try {
      const exported = await exportMutation.mutateAsync({
        reportId: selected.id,
        filters: toFilters(selected, filters, copy),
        columns: selectedColumns,
        format,
      });
      if (requestRevision !== revision.current) return;
      downloadFile(exported.content, exported.filename, exported.contentType);
      setMessage(copy.downloaded);
    } catch (error) {
      if (requestRevision === revision.current)
        setActionError(errorText(error, copy.exportError));
    }
  }

  function cacheTemplate(saved: Template) {
    utils.standardReports.templates.setData(undefined, current =>
      current === undefined
        ? undefined
        : [saved, ...current.filter(item => item.id !== saved.id)].sort(
            (left, right) => right.id - left.id
          )
    );
  }

  async function saveReport() {
    if (!selected || !result || !projectedColumns.length) return;
    const requestRevision = revision.current;
    setActionError(null);
    setMessage(null);
    try {
      if (!template.name.trim()) throw new Error(copy.nameRequired);
      const [hourUtc, minuteUtc] = template.time.split(":").map(Number);
      if (
        !/^\d{2}:\d{2}$/.test(template.time) ||
        !Number.isInteger(hourUtc) ||
        !Number.isInteger(minuteUtc) ||
        hourUtc < 0 ||
        hourUtc > 23 ||
        minuteUtc < 0 ||
        minuteUtc > 59
      )
        throw new Error(copy.timeInvalid);
      const days = Number(template.lookbackDays);
      if (
        template.rolling &&
        (!rollingAllowed || !Number.isInteger(days) || days < 1 || days > 366)
      )
        throw new Error(copy.rollingInvalid);
      const saved = await saveMutation.mutateAsync({
        id: editingId,
        template: {
          reportId: selected.id,
          filters: toFilters(selected, filters, copy),
          columns: selectedColumns,
          name: template.name.trim(),
          format: template.format,
          cadence: template.cadence,
          hourUtc,
          minuteUtc,
          lookbackDays: template.rolling ? days : null,
          emailToOwner: template.emailToOwner && Boolean(email),
          enabled: template.enabled,
        },
      });
      cacheTemplate(saved);
      await utils.standardReports.templates.invalidate();
      if (requestRevision !== revision.current) return;
      setEditingId(saved.id);
      setMessage(copy.saveSuccess);
      setTab("templates");
    } catch (error) {
      if (requestRevision === revision.current)
        setActionError(errorText(error, copy.saveError));
    }
  }

  function editReport(saved: Template) {
    const definition = catalog.find(report => report.id === saved.reportId);
    if (!definition) {
      setActionError(copy.unavailableTemplate);
      return;
    }
    invalidatePreview();
    setSelectedId(saved.reportId);
    setFilters(
      Object.fromEntries(
        Object.entries(saved.filters)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, String(value)])
      )
    );
    setColumns(saved.columns);
    setEditingId(saved.id);
    setTemplate({
      name: saved.name,
      format: saved.format,
      cadence: saved.cadence,
      time: `${String(saved.hourUtc).padStart(2, "0")}:${String(saved.minuteUtc).padStart(2, "0")}`,
      rolling: saved.lookbackDays !== null,
      lookbackDays: String(saved.lookbackDays ?? 1),
      emailToOwner: saved.emailToOwner,
      enabled: saved.enabled,
    });
    setTab("catalog");
  }

  async function toggleSchedule(saved: Template) {
    setActionError(null);
    setMessage(null);
    try {
      const updated = await enabledMutation.mutateAsync({
        id: saved.id,
        enabled: !saved.enabled,
      });
      cacheTemplate(updated);
      await utils.standardReports.templates.invalidate();
      setMessage(copy.saveSuccess);
    } catch (error) {
      setActionError(errorText(error, copy.saveError));
    }
  }

  async function deleteReport(saved: Template) {
    setActionError(null);
    setMessage(null);
    try {
      const deleted = await deleteMutation.mutateAsync({ id: saved.id });
      if (!deleted.deleted) throw new Error(copy.deleteError);
      utils.standardReports.templates.setData(undefined, current =>
        current?.filter(item => item.id !== saved.id)
      );
      await utils.standardReports.templates.invalidate();
      if (editingId === saved.id) {
        setEditingId(undefined);
        setTemplate(initialTemplate());
      }
      setConfirmDelete(null);
      setMessage(copy.deleted);
    } catch (error) {
      setActionError(errorText(error, copy.deleteError));
    }
  }

  async function runSavedReport(saved: Template) {
    setActionError(null);
    setMessage(null);
    // Retain an uncertain request ID so a retry cannot create a duplicate run.
    const requestId =
      manualRequestIds.current.get(saved.id) ?? crypto.randomUUID();
    manualRequestIds.current.set(saved.id, requestId);
    try {
      const run = await templateRunMutation.mutateAsync({
        id: saved.id,
        requestId,
      });
      if (run.status !== "generating")
        manualRequestIds.current.delete(saved.id);
      setHistoryCursors([]);
      await utils.standardReports.runs.invalidate();
      setTab("history");
      if (run.status === "failed")
        setActionError(
          run.errorMessage
            ? `${copy.runFailed} ${run.errorMessage}`
            : copy.runFailed
        );
      else
        setMessage(run.status === "ready" ? copy.runCreated : copy.runPending);
    } catch (error) {
      setActionError(errorText(error, copy.runRequestError));
    }
  }

  async function downloadRun(run: Run) {
    const requestRevision = revision.current;
    setActionError(null);
    setMessage(null);
    try {
      const output = await downloadRunMutation.mutateAsync({ id: run.id });
      if (requestRevision !== revision.current) return;
      downloadFile(output.content, output.filename, output.contentType);
      setMessage(copy.downloaded);
    } catch (error) {
      setActionError(errorText(error, copy.exportError));
    }
  }

  return (
    <div
      className="mx-auto w-full max-w-[1500px] space-y-6 p-4 sm:p-6"
      dir={rtl ? "rtl" : "ltr"}
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Library className="size-4" aria-hidden="true" />
            AIS · {copy.catalog}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {copy.title}
          </h1>
          <p className="text-muted-foreground">{copy.lead}</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/admin/reports">
            <FileText className="size-4" aria-hidden="true" />
            {copy.classic}
          </Link>
        </Button>
      </header>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
        {copy.scope}
      </p>
      <nav className="flex flex-wrap gap-2" aria-label={copy.title}>
        {(
          [
            ["catalog", copy.catalog, Library],
            ["templates", copy.saved, Save],
            ["history", copy.history, History],
          ] as const
        ).map(([key, label, Icon]) => (
          <Button
            key={key}
            variant={tab === key ? "default" : "outline"}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setActionError(null);
              setMessage(null);
            }}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Button>
        ))}
      </nav>
      {actionError && (
        <Alert variant="destructive">
          <ShieldAlert aria-hidden="true" />
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}
      {message && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm"
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {message}
        </div>
      )}
      {catalogQuery.isError ? (
        <Failure
          message={copy.catalogError}
          retry={() => void catalogQuery.refetch()}
          copy={copy}
        />
      ) : catalogQuery.isLoading ? (
        <p role="status" className="flex gap-2 p-6">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          {copy.loading}
        </p>
      ) : tab === "catalog" ? (
        <section aria-label={copy.catalog} className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-sm text-muted-foreground">{copy.registered}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {catalog.length}
              </p>
            </div>
            {(["available", "partial", "blocked"] as const).map(status => (
              <div key={status} className="rounded-xl border p-4">
                <Availability value={status} copy={copy} />
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {
                    catalog.filter(report => report.availability === status)
                      .length
                  }
                </p>
              </div>
            ))}
          </div>
          {!catalog.length ? (
            <p className="rounded-xl border p-8 text-muted-foreground">
              {copy.noCatalog}
            </p>
          ) : (
            <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
              <Card>
                <CardHeader className="space-y-3">
                  <CardTitle className="text-base">{copy.catalog}</CardTitle>
                  <div className="space-y-1">
                    <Label htmlFor="standard-search">{copy.search}</Label>
                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute start-3 top-3 size-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        id="standard-search"
                        className="ps-9"
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        placeholder={copy.searchHint}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="standard-category">{copy.category}</Label>
                    <select
                      id="standard-category"
                      className={selectClass}
                      value={category}
                      onChange={event =>
                        setCategory(
                          event.target.value as StandardReportCategory | "all"
                        )
                      }
                    >
                      <option value="all">{copy.allCategories}</option>
                      {(["operations", "finance", "commercial"] as const).map(
                        value => (
                          <option key={value} value={value}>
                            {copy[value]}
                          </option>
                        )
                      )}
                    </select>
                  </div>
                </CardHeader>
                <CardContent className="p-2 pt-0">
                  <ul
                    className="max-h-[620px] space-y-1 overflow-y-auto px-1"
                    aria-label={copy.catalog}
                  >
                    {visibleReports.map(report => (
                      <li key={report.id}>
                        <button
                          type="button"
                          data-testid={`standard-report-option-${report.id}`}
                          className={`w-full rounded-lg border p-3 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${selected?.id === report.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"}`}
                          aria-pressed={selected?.id === report.id}
                          onClick={() => chooseReport(report)}
                        >
                          <span
                            className="mb-2 block text-sm font-medium"
                            dir="ltr"
                            lang="en"
                          >
                            <span className="me-2 text-xs text-muted-foreground">
                              #{report.id}
                            </span>
                            {report.title}
                          </span>
                          <Availability
                            value={report.availability}
                            copy={copy}
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                  {!visibleReports.length && (
                    <p className="p-4 text-sm text-muted-foreground">
                      {copy.noMatches}
                    </p>
                  )}
                </CardContent>
              </Card>
              <div className="min-w-0 space-y-5">
                {!selected ? (
                  <Card>
                    <CardContent className="py-10 text-center text-muted-foreground">
                      {copy.choose}
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    <Card data-testid="standard-report-definition">
                      <CardHeader>
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-sm text-muted-foreground">
                            #{selected.id}
                          </span>
                          <Availability
                            value={selected.availability}
                            copy={copy}
                          />
                          <Badge variant="secondary">
                            {copy[selected.category]}
                          </Badge>
                        </div>
                        <CardTitle className="text-xl" lang="en" dir="ltr">
                          {selected.title}
                        </CardTitle>
                        <CardDescription lang="en" dir="ltr">
                          {selected.description}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        {!!selected.limitations.length && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/30">
                            <h3 className="mb-2 font-semibold">
                              {copy.sourceLimits}
                            </h3>
                            <ul
                              className="list-disc space-y-2 ps-5"
                              lang="en"
                              dir="ltr"
                            >
                              {selected.limitations.map(note => (
                                <li key={note}>{note}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {selected.availability === "blocked" ? (
                          <p className="flex items-start gap-2 text-sm text-muted-foreground">
                            <ShieldAlert
                              className="size-4 shrink-0"
                              aria-hidden="true"
                            />
                            {copy.sourceRequired}
                          </p>
                        ) : (
                          <form
                            onSubmit={event => {
                              event.preventDefault();
                              void previewReport();
                            }}
                            className="space-y-4"
                          >
                            <div>
                              <h3 className="font-medium">{copy.filters}</h3>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {copy.utc}
                              </p>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                              {selected.filters.map(key => (
                                <div key={key} className="space-y-1.5">
                                  <Label htmlFor={`standard-filter-${key}`}>
                                    {copy[key]}
                                    {required.includes(key) && (
                                      <span className="text-xs text-muted-foreground">
                                        {" "}
                                        · {copy.required}
                                      </span>
                                    )}
                                  </Label>
                                  <Input
                                    id={`standard-filter-${key}`}
                                    aria-label={copy[key]}
                                    type={
                                      numberFilters.has(key)
                                        ? "number"
                                        : key === "startDate" ||
                                            key === "endDate"
                                          ? "date"
                                          : "text"
                                    }
                                    min={numberFilters.has(key) ? 1 : undefined}
                                    max={
                                      key === "couponNumber" ? 99 : undefined
                                    }
                                    step={
                                      numberFilters.has(key) ? 1 : undefined
                                    }
                                    maxLength={
                                      key === "ticketNumber" ||
                                      key === "bookingReference"
                                        ? 32
                                        : key === "status"
                                          ? 40
                                          : 100
                                    }
                                    required={required.includes(key)}
                                    value={filters[key] ?? ""}
                                    onChange={event =>
                                      changeFilter(key, event.target.value)
                                    }
                                    aria-describedby={
                                      key === "status"
                                        ? "standard-status-help"
                                        : undefined
                                    }
                                    dir="ltr"
                                  />
                                  {key === "status" && (
                                    <p
                                      id="standard-status-help"
                                      className="text-xs text-muted-foreground"
                                    >
                                      {copy.statusHint}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="submit"
                                data-testid="standard-run-report"
                                disabled={
                                  runMutation.isPending ||
                                  exportMutation.isPending
                                }
                              >
                                {runMutation.isPending ? (
                                  <Loader2
                                    className="size-4 animate-spin"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <Play className="size-4" aria-hidden="true" />
                                )}
                                {runMutation.isPending
                                  ? copy.running
                                  : copy.run}
                              </Button>
                              {!!selected.filters.length && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => {
                                    invalidatePreview();
                                    setFilters({});
                                  }}
                                >
                                  {copy.clearFilters}
                                </Button>
                              )}
                            </div>
                          </form>
                        )}
                      </CardContent>
                    </Card>
                    {selected.availability !== "blocked" && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg">
                            {copy.preview}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-5">
                          {!result ? (
                            <p className="py-4 text-sm text-muted-foreground">
                              {copy.previewFirst}
                            </p>
                          ) : (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p
                                  role="status"
                                  className="text-sm font-medium"
                                >
                                  {result.total.toLocaleString(language)}{" "}
                                  {copy.rows}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {copy.generated}:{" "}
                                  <span dir="ltr">
                                    {utcDate(result.generatedAt)}
                                  </span>
                                </p>
                              </div>
                              {!!result.notes.length && (
                                <details
                                  open
                                  className="rounded-lg border bg-muted/20 p-3 text-sm"
                                >
                                  <summary className="cursor-pointer font-medium">
                                    {copy.evidence}
                                  </summary>
                                  <ul
                                    className="mt-2 list-disc space-y-1 ps-5"
                                    lang="en"
                                    dir="ltr"
                                  >
                                    {[...new Set(result.notes)].map(note => (
                                      <li key={note}>{note}</li>
                                    ))}
                                  </ul>
                                </details>
                              )}
                              <details className="rounded-lg border p-3" open>
                                <summary className="cursor-pointer text-sm font-medium">
                                  {copy.columns} · {selectedColumns.length}/
                                  {result.columns.length}
                                </summary>
                                <p className="my-3 text-xs text-muted-foreground">
                                  {copy.columnsHelp}
                                </p>
                                <div className="mb-3 flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      changeColumns(
                                        result.columns.map(column => column.key)
                                      )
                                    }
                                  >
                                    {copy.allColumns}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => changeColumns([])}
                                  >
                                    {copy.noColumns}
                                  </Button>
                                </div>
                                <ul className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
                                  {[
                                    ...projectedColumns,
                                    ...result.columns.filter(
                                      column =>
                                        !selectedColumns.includes(column.key)
                                    ),
                                  ].map(column => (
                                    <li
                                      key={column.key}
                                      className="flex items-center gap-2 rounded border px-2 py-1.5"
                                    >
                                      <input
                                        type="checkbox"
                                        id={`standard-column-${column.key}`}
                                        className={checkboxClass}
                                        aria-label={`${copy.selectColumn} ${column.label}`}
                                        checked={selectedColumns.includes(
                                          column.key
                                        )}
                                        onChange={event =>
                                          changeColumns(
                                            event.target.checked
                                              ? [...selectedColumns, column.key]
                                              : selectedColumns.filter(
                                                  key => key !== column.key
                                                )
                                          )
                                        }
                                      />
                                      <label
                                        htmlFor={`standard-column-${column.key}`}
                                        className="min-w-0 flex-1 break-words text-xs"
                                        dir="auto"
                                      >
                                        {column.label}
                                      </label>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="size-7"
                                        aria-label={`${copy.moveUp} ${column.label}`}
                                        disabled={
                                          selectedColumns.indexOf(column.key) <=
                                          0
                                        }
                                        onClick={() =>
                                          moveColumn(column.key, -1)
                                        }
                                      >
                                        <ArrowUp
                                          className="size-3.5"
                                          aria-hidden="true"
                                        />
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="size-7"
                                        aria-label={`${copy.moveDown} ${column.label}`}
                                        disabled={
                                          !selectedColumns.includes(
                                            column.key
                                          ) ||
                                          selectedColumns.indexOf(
                                            column.key
                                          ) ===
                                            selectedColumns.length - 1
                                        }
                                        onClick={() =>
                                          moveColumn(column.key, 1)
                                        }
                                      >
                                        <ArrowDown
                                          className="size-3.5"
                                          aria-hidden="true"
                                        />
                                      </Button>
                                    </li>
                                  ))}
                                </ul>
                              </details>
                              {!projectedColumns.length ? (
                                <p className="text-sm text-amber-700 dark:text-amber-300">
                                  {copy.chooseColumns}
                                </p>
                              ) : (
                                <div className="overflow-x-auto rounded-lg border">
                                  <table
                                    data-testid="standard-report-table"
                                    className="w-full border-collapse text-start text-sm"
                                  >
                                    <caption className="sr-only">
                                      {result.title}
                                    </caption>
                                    <thead className="bg-muted/50">
                                      <tr>
                                        {projectedColumns.map(column => (
                                          <th
                                            key={column.key}
                                            scope="col"
                                            className="min-w-28 border-b px-3 py-3 text-start align-top font-medium"
                                            lang="en"
                                          >
                                            {column.label}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {rows.map((row, index) => (
                                        <tr
                                          key={safePage * PAGE_SIZE + index}
                                          className="border-b last:border-b-0 even:bg-muted/15"
                                        >
                                          {projectedColumns.map(column => (
                                            <td
                                              key={column.key}
                                              className="max-w-lg px-3 py-2.5 align-top"
                                            >
                                              <Cell
                                                value={row[column.key]}
                                                copy={copy}
                                              />
                                            </td>
                                          ))}
                                        </tr>
                                      ))}
                                      {!rows.length && (
                                        <tr>
                                          <td
                                            colSpan={projectedColumns.length}
                                            className="p-8 text-center text-muted-foreground"
                                          >
                                            {copy.empty}
                                          </td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                              {pageCount > 1 && (
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={safePage === 0}
                                    onClick={() => setPage(safePage - 1)}
                                  >
                                    {copy.previous}
                                  </Button>
                                  <span className="text-sm text-muted-foreground">
                                    {copy.page} {safePage + 1} {copy.of}{" "}
                                    {pageCount}
                                  </span>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={safePage + 1 >= pageCount}
                                    onClick={() => setPage(safePage + 1)}
                                  >
                                    {copy.next}
                                  </Button>
                                </div>
                              )}
                              <div className="space-y-2">
                                <div className="flex flex-wrap gap-2">
                                  {STANDARD_REPORT_FORMATS.map(format => (
                                    <Button
                                      key={format}
                                      variant="outline"
                                      disabled={
                                        !projectedColumns.length ||
                                        exportMutation.isPending ||
                                        runMutation.isPending
                                      }
                                      onClick={() => void exportReport(format)}
                                    >
                                      <Download
                                        className="size-4"
                                        aria-hidden="true"
                                      />
                                      {copy.download} {format.toUpperCase()}
                                    </Button>
                                  ))}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {copy.exportHelp}
                                </p>
                              </div>
                            </>
                          )}
                        </CardContent>
                      </Card>
                    )}
                    {selected.availability !== "blocked" && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-lg">
                            <CalendarClock
                              className="size-5"
                              aria-hidden="true"
                            />
                            {editingId === undefined
                              ? copy.saveHeading
                              : copy.editingHeading}
                          </CardTitle>
                          <CardDescription>
                            {copy.templateScope}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <form
                            data-testid="standard-template-editor"
                            className="space-y-4"
                            onSubmit={event => {
                              event.preventDefault();
                              void saveReport();
                            }}
                          >
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="space-y-1.5 sm:col-span-2">
                                <Label htmlFor="standard-template-name">
                                  {copy.name}
                                </Label>
                                <Input
                                  id="standard-template-name"
                                  value={template.name}
                                  maxLength={120}
                                  required
                                  placeholder={copy.nameHint}
                                  onChange={event =>
                                    setTemplate(current => ({
                                      ...current,
                                      name: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor="standard-template-format">
                                  {copy.format}
                                </Label>
                                <select
                                  id="standard-template-format"
                                  className={selectClass}
                                  value={template.format}
                                  onChange={event =>
                                    setTemplate(current => ({
                                      ...current,
                                      format: event.target
                                        .value as StandardReportFormat,
                                    }))
                                  }
                                >
                                  {STANDARD_REPORT_FORMATS.map(format => (
                                    <option key={format} value={format}>
                                      {format.toUpperCase()}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor="standard-template-cadence">
                                  {copy.cadence}
                                </Label>
                                <select
                                  id="standard-template-cadence"
                                  className={selectClass}
                                  value={template.cadence}
                                  onChange={event =>
                                    setTemplate(current => ({
                                      ...current,
                                      cadence: event.target
                                        .value as TemplateDraft["cadence"],
                                    }))
                                  }
                                >
                                  {(
                                    [
                                      "manual",
                                      "daily",
                                      "weekly",
                                      "monthly",
                                    ] as const
                                  ).map(cadence => (
                                    <option key={cadence} value={cadence}>
                                      {copy[cadence]}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            {template.cadence !== "manual" && (
                              <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                                <div className="max-w-48 space-y-1.5">
                                  <Label htmlFor="standard-template-time">
                                    {copy.runTime}
                                  </Label>
                                  <Input
                                    id="standard-template-time"
                                    type="time"
                                    required
                                    value={template.time}
                                    onChange={event =>
                                      setTemplate(current => ({
                                        ...current,
                                        time: event.target.value,
                                      }))
                                    }
                                    dir="ltr"
                                  />
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {copy.cadenceHelp}
                                </p>
                                <label className="flex items-center gap-2 text-sm">
                                  <input
                                    id="standard-template-enabled"
                                    className={checkboxClass}
                                    type="checkbox"
                                    checked={template.enabled}
                                    onChange={event =>
                                      setTemplate(current => ({
                                        ...current,
                                        enabled: event.target.checked,
                                      }))
                                    }
                                  />
                                  {copy.enabled}
                                </label>
                              </div>
                            )}
                            {rollingAllowed && (
                              <div className="space-y-3 rounded-lg border p-4">
                                <label className="flex items-start gap-2 text-sm">
                                  <input
                                    id="standard-template-rolling"
                                    className={`${checkboxClass} mt-0.5`}
                                    type="checkbox"
                                    checked={template.rolling}
                                    onChange={event =>
                                      setTemplate(current => ({
                                        ...current,
                                        rolling: event.target.checked,
                                      }))
                                    }
                                  />
                                  {copy.rolling}
                                </label>
                                {template.rolling ? (
                                  <>
                                    <div className="max-w-48 space-y-1.5">
                                      <Label htmlFor="standard-template-lookback">
                                        {copy.rollingDays}
                                      </Label>
                                      <Input
                                        id="standard-template-lookback"
                                        type="number"
                                        min={1}
                                        max={366}
                                        step={1}
                                        required
                                        value={template.lookbackDays}
                                        onChange={event =>
                                          setTemplate(current => ({
                                            ...current,
                                            lookbackDays: event.target.value,
                                          }))
                                        }
                                      />
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      {copy.rollingHelp}
                                    </p>
                                  </>
                                ) : (
                                  <p className="text-xs text-muted-foreground">
                                    {copy.fixedPeriod}
                                  </p>
                                )}
                              </div>
                            )}
                            <div className="space-y-2 rounded-lg border p-4">
                              <label className="flex items-start gap-2 text-sm">
                                <input
                                  id="standard-template-email"
                                  className={`${checkboxClass} mt-0.5`}
                                  type="checkbox"
                                  checked={template.emailToOwner}
                                  disabled={!email}
                                  onChange={event =>
                                    setTemplate(current => ({
                                      ...current,
                                      emailToOwner: event.target.checked,
                                    }))
                                  }
                                />
                                {copy.email}
                              </label>
                              <p className="text-xs text-muted-foreground">
                                {copy.emailHelp}
                              </p>
                              {email ? (
                                <p
                                  dir="ltr"
                                  className="text-xs text-muted-foreground"
                                >
                                  {email}
                                </p>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  {copy.emailUnavailable}
                                </p>
                              )}
                            </div>
                            {!result && (
                              <p className="text-sm text-muted-foreground">
                                {copy.previewFirst}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="submit"
                                disabled={
                                  !result ||
                                  !projectedColumns.length ||
                                  templateBusy ||
                                  runMutation.isPending
                                }
                              >
                                <Save className="size-4" aria-hidden="true" />
                                {editingId === undefined
                                  ? copy.save
                                  : copy.update}
                              </Button>
                              {editingId !== undefined && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => {
                                    setEditingId(undefined);
                                    setTemplate(initialTemplate());
                                  }}
                                >
                                  {copy.cancelEdit}
                                </Button>
                              )}
                            </div>
                          </form>
                        </CardContent>
                      </Card>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      ) : tab === "templates" ? (
        <section aria-label={copy.saved} className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold">{copy.saved}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {copy.templateScope}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={templatesQuery.isFetching}
              onClick={() => void templatesQuery.refetch()}
            >
              {copy.refresh}
            </Button>
          </div>
          {templatesQuery.isError ? (
            <Failure
              message={copy.templatesError}
              retry={() => void templatesQuery.refetch()}
              copy={copy}
            />
          ) : templatesQuery.isLoading ? (
            <p role="status">{copy.loading}</p>
          ) : !templatesQuery.data?.length ? (
            <Card>
              <CardContent className="space-y-2 py-10 text-center">
                <p className="font-medium">{copy.noTemplates}</p>
                <p className="text-sm text-muted-foreground">
                  {copy.noTemplatesHelp}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {templatesQuery.data.map(saved => (
                <Card
                  key={saved.id}
                  data-testid={`standard-template-${saved.id}`}
                >
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <CardTitle className="break-words text-lg">
                        {saved.name}
                      </CardTitle>
                      <Badge variant="secondary">
                        {saved.cadence === "manual"
                          ? copy.manual
                          : saved.enabled
                            ? copy.scheduled
                            : copy.paused}
                      </Badge>
                    </div>
                    <CardDescription>
                      <span lang="en" dir="ltr">
                        #{saved.reportId} ·{" "}
                        {catalog.find(report => report.id === saved.reportId)
                          ?.title ?? ""}
                      </span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-muted-foreground">{copy.format}</dt>
                        <dd className="mt-1 font-medium">
                          {saved.format.toUpperCase()}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">
                          {copy.cadence}
                        </dt>
                        <dd className="mt-1">{copy[saved.cadence]}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-muted-foreground">
                          {copy.nextRun}
                        </dt>
                        <dd className="mt-1" dir="ltr">
                          {utcDate(saved.nextRunAt)}
                        </dd>
                      </div>
                    </dl>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        aria-label={`${copy.runNow} ${saved.name}`}
                        disabled={
                          templateBusy ||
                          catalog.find(report => report.id === saved.reportId)
                            ?.availability === "blocked"
                        }
                        onClick={() => void runSavedReport(saved)}
                      >
                        <Play className="size-4" aria-hidden="true" />
                        {copy.runNow}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`${copy.edit} ${saved.name}`}
                        disabled={templateBusy}
                        onClick={() => editReport(saved)}
                      >
                        {copy.edit}
                      </Button>
                      {saved.cadence !== "manual" && (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`${saved.enabled ? copy.pause : copy.resume} ${saved.name}`}
                          disabled={templateBusy}
                          onClick={() => void toggleSchedule(saved)}
                        >
                          {saved.enabled ? copy.pause : copy.resume}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`${copy.remove} ${saved.name}`}
                        disabled={templateBusy}
                        onClick={() => setConfirmDelete(saved.id)}
                      >
                        {copy.remove}
                      </Button>
                    </div>
                    {confirmDelete === saved.id && (
                      <div className="space-y-3 rounded-lg border border-destructive/30 p-3">
                        <p className="text-sm">{copy.deletePrompt}</p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={templateBusy}
                            onClick={() => void deleteReport(saved)}
                          >
                            {copy.confirmRemove}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmDelete(null)}
                          >
                            {copy.cancel}
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section aria-label={copy.history} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{copy.history}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {copy.historyPage}
              </p>
            </div>
            <div className="flex gap-2">
              {!!historyCursors.length && (
                <Button variant="outline" onClick={() => setHistoryCursors([])}>
                  {copy.latest}
                </Button>
              )}
              <Button
                variant="outline"
                disabled={historyQuery.isFetching}
                onClick={() => void historyQuery.refetch()}
              >
                {copy.refresh}
              </Button>
            </div>
          </div>
          {historyQuery.isError ? (
            <Failure
              message={copy.historyError}
              retry={() => void historyQuery.refetch()}
              copy={copy}
            />
          ) : historyQuery.isLoading ? (
            <p role="status">{copy.loading}</p>
          ) : !historyQuery.data?.length ? (
            <Card>
              <CardContent className="space-y-2 py-10 text-center">
                <p className="font-medium">{copy.noRuns}</p>
                <p className="text-sm text-muted-foreground">
                  {copy.noRunsHelp}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {historyQuery.data.map(run => (
                <Card key={run.id} data-testid={`standard-run-${run.id}`}>
                  <CardContent className="space-y-3 pt-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          {copy.runId} #{run.id} · {run.format.toUpperCase()}
                        </p>
                        <h3 className="mt-1 font-semibold">{run.name}</h3>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            run.status === "failed"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {run.status === "ready" && (
                            <CheckCircle2
                              className="size-3"
                              aria-hidden="true"
                            />
                          )}
                          {copy[run.status]}
                        </Badge>
                        {run.status === "ready" && (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`${copy.download} ${run.name}`}
                            disabled={downloadRunMutation.isPending}
                            onClick={() => void downloadRun(run)}
                          >
                            <Download className="size-4" aria-hidden="true" />
                            {copy.download}
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                      <span>
                        {run.recordCount.toLocaleString(language)} {copy.rows}
                      </span>
                      <span>
                        {copy.generated}:{" "}
                        <span dir="ltr">{utcDate(run.createdAt)}</span>
                      </span>
                      <span>
                        {copy.delivery}:{" "}
                        <strong
                          className={
                            run.deliveryStatus === "unknown" ||
                            run.deliveryStatus === "failed"
                              ? "text-amber-700 dark:text-amber-300"
                              : "font-medium"
                          }
                        >
                          {copy[run.deliveryStatus]}
                        </strong>
                      </span>
                    </div>
                    {run.errorMessage && (
                      <p
                        className="rounded border border-amber-200 bg-amber-50/50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/20"
                        lang="en"
                        dir="ltr"
                      >
                        {run.errorMessage}
                      </p>
                    )}
                    {run.deliveryStatus === "unknown" && (
                      <p className="text-sm text-amber-700 dark:text-amber-300">
                        {copy.unknownDelivery}
                      </p>
                    )}
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        {copy.runDetails}
                      </summary>
                      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div>
                          <dt className="text-muted-foreground">
                            {copy.completed}
                          </dt>
                          <dd className="mt-1" dir="ltr">
                            {utcDate(run.completedAt)}
                          </dd>
                        </div>
                        {run.checksum && (
                          <div>
                            <dt className="text-muted-foreground">
                              {copy.checksum}
                            </dt>
                            <dd className="mt-1 break-all font-mono" dir="ltr">
                              {run.checksum}
                            </dd>
                          </div>
                        )}
                        {run.emailReceiptId && (
                          <div>
                            <dt className="text-muted-foreground">
                              {copy.receipt}
                            </dt>
                            <dd className="mt-1 break-all font-mono" dir="ltr">
                              {run.emailReceiptId}
                            </dd>
                          </div>
                        )}
                        {run.emailAcceptedAt && (
                          <div>
                            <dt className="text-muted-foreground">
                              {copy.acceptedAt}
                            </dt>
                            <dd className="mt-1" dir="ltr">
                              {utcDate(run.emailAcceptedAt)}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </details>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!historyCursors.length || historyQuery.isFetching}
              onClick={() => setHistoryCursors(current => current.slice(0, -1))}
            >
              {copy.previous}
            </Button>
            <span className="text-sm text-muted-foreground">
              {copy.page} {historyCursors.length + 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={
                historyQuery.isError ||
                historyQuery.isFetching ||
                (historyQuery.data?.length ?? 0) < 100
              }
              onClick={() => {
                const last = historyQuery.data?.at(-1);
                if (last) setHistoryCursors(current => [...current, last.id]);
              }}
            >
              {copy.next}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
