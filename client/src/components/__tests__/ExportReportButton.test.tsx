import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExportReportButton,
  type ExportFormat,
  type ReportType,
} from "../ExportReportButton";
import { createTrpcFixture, deferred } from "@/test/trpc-fixture";

const state = vi.hoisted(() => ({
  user: { id: 11, tenantId: 101, role: "finance" },
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: state.user }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({
  toast: { success: state.success, error: state.error },
}));

const routes: Record<ReportType, Record<ExportFormat, string>> = {
  bookings: {
    csv: "exportBookingsCSV",
    excel: "exportBookingsExcel",
    pdf: "generateBookingsPDF",
  },
  revenue: {
    csv: "exportRevenueCSV",
    excel: "exportRevenueExcel",
    pdf: "generateRevenuePDF",
  },
  flights: {
    csv: "exportFlightPerformanceCSV",
    excel: "exportFlightPerformanceExcel",
    pdf: "generateFlightPerformancePDF",
  },
  refunds: {
    csv: "exportRefundsCSV",
    excel: "exportRefundsExcel",
    pdf: "generateRefundsPDF",
  },
};
const formats: ExportFormat[] = ["csv", "excel", "pdf"];
const filters = {
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  status: "completed",
};
const originalCreateUrl = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL"
);
const originalRevokeUrl = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL"
);
let blobs: Blob[];
let anchors: Array<{ name: string; href: string }>;
let revoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state.user = { id: 11, tenantId: 101, role: "finance" };
  vi.clearAllMocks();
  blobs = [];
  anchors = [];
  revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:report-fixture";
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revoke,
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    anchors.push({ name: this.download, href: this.href });
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  if (originalCreateUrl)
    Object.defineProperty(URL, "createObjectURL", originalCreateUrl);
  else Reflect.deleteProperty(URL, "createObjectURL");
  if (originalRevokeUrl)
    Object.defineProperty(URL, "revokeObjectURL", originalRevokeUrl);
  else Reflect.deleteProperty(URL, "revokeObjectURL");
});

function output(format: ExportFormat = "csv") {
  const content =
    format === "csv"
      ? "reference,amount\nاختبار,12.34"
      : format === "pdf"
        ? "%PDF-fixture-bytes"
        : "PK-fixture-bytes";
  return {
    filename: `response.${format === "excel" ? "xlsx" : format}`,
    content: format === "csv" ? content : btoa(content),
    contentType:
      format === "csv"
        ? "text/csv;charset=utf-8"
        : format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ...(format === "csv" ? {} : { encoding: "base64" }),
  };
}
async function choose(format: ExportFormat) {
  const trigger = screen.getByRole("button");
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const label =
    format === "csv"
      ? "reports.exportCSV"
      : format === "pdf"
        ? "reports.exportPDF"
        : "reports.exportExcel";
  fireEvent.click(await screen.findByRole("menuitem", { name: label }));
}
async function bytes(blob: Blob): Promise<Uint8Array> {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buffer);
}

describe("report export interactions through real tRPC hooks", () => {
  it.each(
    (Object.keys(routes) as ReportType[]).flatMap(reportType =>
      formats.map(format => ({
        reportType,
        format,
        procedure: routes[reportType][format],
      }))
    )
  )(
    "routes $reportType $format and preserves the server's filename, MIME and bytes",
    async ({ reportType, format, procedure }) => {
      const response = output(format);
      const fixture = createTrpcFixture({
        [`reports.${procedure}`]: () => response,
      });
      render(<ExportReportButton reportType={reportType} filters={filters} />, {
        wrapper: fixture.Wrapper,
      });
      await choose(format);
      await waitFor(() =>
        expect(state.success).toHaveBeenCalledWith("reports.exportSuccess")
      );
      expect(fixture.requests).toEqual([
        { path: `reports.${procedure}`, input: filters },
      ]);
      expect(anchors).toEqual([
        { name: response.filename, href: "blob:report-fixture" },
      ]);
      expect(blobs).toHaveLength(1);
      expect(blobs[0].type).toBe(response.contentType);
      expect(new TextDecoder().decode(await bytes(blobs[0]))).toBe(
        response.encoding ? atob(response.content) : response.content
      );
      expect(revoke).toHaveBeenCalledWith("blob:report-fixture");
      expect(document.querySelector("a[download]")).toBeNull();
      expect(screen.getByRole("button")).toBeEnabled();
      fixture.cache.clear();
    }
  );

  it("restores the export controls after a failed API request and permits a fresh retry", async () => {
    let attempt = 0;
    const fixture = createTrpcFixture({
      "reports.exportRefundsCSV": () => {
        if (++attempt === 1) throw new Error("Report unavailable");
        return output();
      },
    });
    render(<ExportReportButton reportType="refunds" filters={filters} />, {
      wrapper: fixture.Wrapper,
    });
    await choose("csv");
    await waitFor(() =>
      expect(state.error).toHaveBeenCalledWith("reports.exportError")
    );
    expect(blobs).toHaveLength(0);
    expect(state.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toBeEnabled();
    await choose("csv");
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(state.success).toHaveBeenCalledOnce();
    expect(fixture.requests).toHaveLength(2);
    fixture.cache.clear();
  });

  it.each(["filters", "report", "account", "tenant", "unmount"])(
    "discards a late export after the %s context changes",
    async change => {
      const response = deferred<ReturnType<typeof output>>();
      const fixture = createTrpcFixture({
        "reports.exportRefundsCSV": () => response.promise,
      });
      const view = render(
        <ExportReportButton reportType="refunds" filters={filters} />,
        { wrapper: fixture.Wrapper }
      );
      await choose("csv");
      await waitFor(() => expect(fixture.requests).toHaveLength(1));
      if (change === "account") state.user = { ...state.user, id: 22 };
      if (change === "tenant") state.user = { ...state.user, tenantId: 202 };
      if (change === "unmount") view.unmount();
      else
        view.rerender(
          <ExportReportButton
            reportType={change === "report" ? "bookings" : "refunds"}
            filters={
              change === "filters"
                ? { ...filters, startDate: "2026-10-15" }
                : filters
            }
          />
        );
      await act(async () => response.resolve(output()));
      await waitFor(() => expect(fixture.cache.isMutating()).toBe(0));
      expect(blobs).toHaveLength(0);
      expect(anchors).toHaveLength(0);
      expect(state.success).not.toHaveBeenCalled();
      fixture.cache.clear();
    }
  );

  it("can start a new filter's export while discarding an older pending response", async () => {
    const old = deferred<ReturnType<typeof output>>();
    const fixture = createTrpcFixture({
      "reports.exportRefundsCSV": input =>
        (input as typeof filters).startDate === filters.startDate
          ? old.promise
          : output(),
    });
    const view = render(
      <ExportReportButton reportType="refunds" filters={filters} />,
      { wrapper: fixture.Wrapper }
    );
    await choose("csv");
    await waitFor(() => expect(fixture.requests).toHaveLength(1));
    view.rerender(
      <ExportReportButton
        reportType="refunds"
        filters={{ ...filters, startDate: "2026-10-15" }}
      />
    );
    expect(screen.getByRole("button")).toBeEnabled();
    await choose("csv");
    await waitFor(() => expect(blobs).toHaveLength(1));
    await act(async () =>
      old.resolve({ ...output(), filename: "obsolete.csv" })
    );
    await waitFor(() => expect(fixture.cache.isMutating()).toBe(0));
    expect(anchors).toEqual([
      { name: "response.csv", href: "blob:report-fixture" },
    ]);
    expect(state.success).toHaveBeenCalledOnce();
    fixture.cache.clear();
  });
});
