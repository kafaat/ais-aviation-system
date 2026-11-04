import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/base-test";
import { useBrowserSession } from "./fixtures/browser-session";
import { rpc } from "./fixtures/rpc";
import { useReportingStaff } from "./fixtures/reporting-tenants";
import {
  createStandardReportingTenants,
  STANDARD_REPORT_PRIVATE_VALUE,
} from "./fixtures/standard-reporting";

const financialColumns = [
  "paymentId",
  "bookingReference",
  "amountMinor",
  "transactionId",
  "createdAt",
  "officeId",
];
const financialLabels = [
  "Payment ID",
  "Booking reference",
  "Amount (minor units)",
  "Provider transaction reference",
  "Created UTC",
  "Sales office (unknown)",
];

async function openCatalog(page: Page, reportId: number) {
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  await page.goto("/admin/standard-reports");
  await expect(
    page.getByRole("heading", { name: "Standard reports", exact: true })
  ).toBeVisible();
  await page.getByTestId(`standard-report-option-${reportId}`).click();
}

async function paymentPreview(page: Page, day: string) {
  await openCatalog(page, 55);
  await page.getByLabel("Start date (UTC)", { exact: true }).fill(day);
  await page.getByLabel("End date (UTC)", { exact: true }).fill(day);
  await page.getByTestId("standard-run-report").click();
  await expect(
    page.getByTestId("standard-report-table").locator("tbody tr")
  ).toHaveCount(2);
}

async function selectColumns(page: Page, keys: string[]) {
  await page
    .getByRole("button", { name: "Clear column selection", exact: true })
    .click();
  for (const key of keys) await page.locator(`#standard-column-${key}`).check();
}

async function browserDownload(page: Page, buttonName: string) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const download = await pending;
  const path = await download.path();
  if (!path) throw new Error("Standard report download has no file");
  return {
    filename: download.suggestedFilename(),
    content: await readFile(path, "utf8"),
  };
}

/** RFC 4180 cells, including quoted commas/newlines and doubled quotes. */
function csvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  const text = content.replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index++;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\r" || character === "\n") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  if (quoted)
    throw new Error("Downloaded CSV contains an unterminated quoted field");
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

async function markupRows(page: Page, content: string, format: "html" | "xml") {
  return page.evaluate(
    ({ content, format }) => {
      const document = new DOMParser().parseFromString(
        content,
        format === "xml" ? "application/xml" : "text/html"
      );
      const malformed = document.querySelectorAll("parsererror").length;
      const activeElements = document.querySelectorAll(
        "script,img,svg,iframe,object"
      ).length;
      if (format === "html") {
        return {
          malformed,
          activeElements,
          columns: [...document.querySelectorAll("table thead th")].map(
            node => node.textContent ?? ""
          ),
          keys: [] as string[],
          rows: [...document.querySelectorAll("table tbody tr")].map(row =>
            [...row.querySelectorAll("td")].map(cell => cell.textContent ?? "")
          ),
          reportId: null as string | null,
        };
      }
      return {
        malformed,
        activeElements,
        columns: [...document.querySelectorAll("columns > column")].map(
          node => node.textContent ?? ""
        ),
        keys: [...document.querySelectorAll("columns > column")].map(
          node => node.getAttribute("key") ?? ""
        ),
        rows: [...document.querySelectorAll("rows > row")].map(row =>
          [...row.querySelectorAll("cell")].map(cell =>
            cell.getAttribute("nil") === "true"
              ? null
              : (cell.textContent ?? "")
          )
        ),
        reportId: document.documentElement.getAttribute("id"),
      };
    },
    { content, format }
  );
}

function displayRows(rows: Array<Array<string | number | null>>) {
  return rows.map(row =>
    row.map(value => (value === null ? "Not recorded" : String(value)))
  );
}

async function expectPreview(
  page: Page,
  columns: string[],
  rows: Array<Array<string | number | null>>
) {
  const table = page.getByTestId("standard-report-table");
  await expect(table.locator("thead th")).toHaveText(columns);
  await expect(table.locator("tbody tr")).toHaveCount(rows.length);
  for (const [index, row] of displayRows(rows).entries()) {
    await expect(table.locator("tbody tr").nth(index).locator("td")).toHaveText(
      row
    );
  }
  await expect(table.locator("svg,img,script,iframe")).toHaveCount(0);
}

async function expectThreeFormats(
  page: Page,
  reportId: number,
  keys: string[],
  labels: string[],
  values: Array<Array<string | number | null>>,
  forbiddenText: string[]
) {
  for (const format of ["csv", "html", "xml"] as const) {
    const file = await browserDownload(
      page,
      "Download " + format.toUpperCase()
    );
    expect(file.filename).toMatch(
      new RegExp(`^report-${reportId}-[0-9-]+\\.${format}$`)
    );
    for (const text of [...forbiddenText, STANDARD_REPORT_PRIVATE_VALUE])
      expect(file.content).not.toContain(text);
    if (format === "csv") {
      expect(csvRows(file.content)).toEqual([
        labels,
        ...values.map(row =>
          row.map(value => {
            if (value === null) return "";
            const text = String(value);
            return /^[=+@-]/.test(text) ? "'" + text : text;
          })
        ),
      ]);
    } else {
      const parsed = await markupRows(page, file.content, format);
      expect(parsed.malformed).toBe(0);
      expect(parsed.activeElements).toBe(0);
      expect(parsed.columns).toEqual(labels);
      if (format === "html") expect(parsed.rows).toEqual(displayRows(values));
      else {
        expect(parsed.reportId).toBe(String(reportId));
        expect(parsed.keys).toEqual(keys);
        expect(parsed.rows).toEqual(
          values.map(row =>
            row.map(value => (value === null ? null : String(value)))
          )
        );
      }
    }
  }
}

test("standard financial reports preserve tenant scope, UTC boundaries, unknowns and escaped values in three browser downloads", async ({
  page,
}) => {
  const day = "2035-06-17";
  const fixture = await createStandardReportingTenants(day);
  try {
    for (const [index, owner] of fixture.tenants.entries()) {
      const other = fixture.tenants[1 - index];
      await useReportingStaff(page, owner.finance);
      await paymentPreview(page, day);
      await expect(page.getByTestId("standard-report-option-15")).toHaveCount(
        0
      );
      await selectColumns(page, financialColumns);
      const rows = owner.payments.map(payment => [
        payment.id,
        owner.reference,
        payment.amount,
        payment.transactionId,
        payment.createdAt,
        null,
      ]);
      await expectPreview(page, financialLabels, rows);
      await expectThreeFormats(
        page,
        55,
        financialColumns,
        financialLabels,
        rows,
        [other.reference, "outside-before-", "outside-after-"]
      );
      const result = await rpc(page).standardReports.run.mutate({
        reportId: 55,
        filters: { startDate: day, endDate: day },
      });
      expect(result.rows.map(row => row.paymentId)).toEqual(
        owner.payments.map(payment => payment.id)
      );
      for (const id of owner.excludedPaymentIds)
        expect(result.rows.some(row => row.paymentId === id)).toBe(false);
      await expect(
        rpc(page).standardReports.run.mutate({
          reportId: 15,
          filters: { startDate: day },
        })
      ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    }
  } finally {
    await fixture.cleanup();
  }
});

test("standard operational reports export only the selected airline and reject a foreign flight identifier", async ({
  page,
}) => {
  const day = "2035-07-18";
  const fixture = await createStandardReportingTenants(day);
  const keys = [
    "flightId",
    "flightNumber",
    "economyAvailable",
    "businessAvailable",
    "loadFactorPercent",
  ];
  const labels = [
    "Flight ID",
    "Flight number",
    "Economy effective available",
    "Business effective available",
    "Booked load factor percent",
  ];
  try {
    for (const [index, owner] of fixture.tenants.entries()) {
      const other = fixture.tenants[1 - index];
      await useReportingStaff(page, owner.ops);
      await openCatalog(page, 15);
      await page.getByLabel("Start date (UTC)", { exact: true }).fill(day);
      await page.getByTestId("standard-run-report").click();
      await expect(
        page.getByTestId("standard-report-table").locator("tbody tr")
      ).toHaveCount(1);
      await expect(page.getByTestId("standard-report-option-55")).toHaveCount(
        0
      );
      await selectColumns(page, keys);
      const rows = [
        [
          owner.flightId,
          owner.flightNumber,
          10 - owner.bookedSeats,
          0,
          owner.bookedSeats * 10,
        ],
      ];
      await expectPreview(page, labels, rows);
      await expectThreeFormats(page, 15, keys, labels, rows, [
        other.flightNumber,
      ]);
      await expect(
        rpc(page).standardReports.run.mutate({
          reportId: 22,
          filters: { flightId: other.flightId },
        })
      ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
      await expect(
        rpc(page).standardReports.run.mutate({
          reportId: 55,
          filters: { startDate: day, endDate: day },
        })
      ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    }
  } finally {
    await fixture.cleanup();
  }
});

test("custom report columns, edits and manual runs persist with owner-only history and matching download checksums", async ({
  page,
}) => {
  const day = "2035-08-19";
  const fixture = await createStandardReportingTenants(day);
  const [owner, other] = fixture.tenants;
  const firstName = "Scoped custom " + owner.reference;
  const editedName = firstName + " edited";
  try {
    await useReportingStaff(page, owner.finance);
    await paymentPreview(page, day);
    await selectColumns(page, ["bookingReference", "amountMinor", "officeId"]);
    const editor = page.getByTestId("standard-template-editor");
    await editor.getByLabel("Report name", { exact: true }).fill(firstName);
    await expect(
      editor.getByLabel("Email a copy to my account address", { exact: true })
    ).not.toBeChecked();
    await editor
      .getByRole("button", { name: "Save report", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Saved reports", exact: true })
    ).toHaveAttribute("aria-pressed", "true");
    const saved = (await rpc(page).standardReports.templates.query()).find(
      template => template.name === firstName
    );
    if (!saved) throw new Error("Saved custom report was not persisted");
    expect(saved).toMatchObject({
      reportId: 55,
      filters: { startDate: day, endDate: day },
      columns: ["bookingReference", "amountMinor", "officeId"],
      format: "csv",
      cadence: "manual",
      emailToOwner: false,
    });
    await expect(
      page.getByTestId(`standard-template-${saved.id}`)
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Run now " + firstName, exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Run history", exact: true })
    ).toHaveAttribute("aria-pressed", "true");
    const initial = (await rpc(page).standardReports.runs.query({})).find(
      run => run.templateId === saved.id
    );
    if (!initial) throw new Error("Manual report run was not persisted");
    expect(initial).toMatchObject({
      status: "ready",
      format: "csv",
      recordCount: 2,
      deliveryStatus: "none",
      emailReceiptId: null,
      emailAcceptedAt: null,
    });
    const initialCard = page.getByTestId(`standard-run-${initial.id}`);
    await expect(initialCard).toContainText("Dashboard only");
    await initialCard.locator("summary", { hasText: "Output details" }).click();
    await expect(initialCard).toContainText(
      initial.checksum ?? "missing-checksum"
    );
    const first = await browserDownload(page, "Download " + firstName);
    expect(createHash("sha256").update(first.content).digest("hex")).toBe(
      initial.checksum
    );
    expect(csvRows(first.content)).toEqual([
      ["Booking reference", "Amount (minor units)", "Sales office (unknown)"],
      ...owner.payments.map(payment => [
        owner.reference,
        String(payment.amount),
        "",
      ]),
    ]);

    await useReportingStaff(page, other.finance);
    await openCatalog(page, 55);
    expect(await rpc(page).standardReports.templates.query()).toEqual([]);
    expect(await rpc(page).standardReports.runs.query({})).toEqual([]);
    await expect(
      rpc(page).standardReports.downloadRun.mutate({ id: initial.id })
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(
      rpc(page).standardReports.setTemplateEnabled.mutate({
        id: saved.id,
        enabled: false,
      })
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });

    await useReportingStaff(page, owner.finance);
    await openCatalog(page, 55);
    await page
      .getByRole("button", { name: "Saved reports", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit " + firstName, exact: true })
      .click();
    await page.getByTestId("standard-run-report").click();
    await expect(
      page.getByTestId("standard-report-table").locator("thead th")
    ).toHaveText([
      "Booking reference",
      "Amount (minor units)",
      "Sales office (unknown)",
    ]);
    await page
      .getByRole("button", {
        name: "Move column up: Amount (minor units)",
        exact: true,
      })
      .click();
    await editor.getByLabel("Report name", { exact: true }).fill(editedName);
    await editor
      .getByLabel("Saved format", { exact: true })
      .selectOption("xml");
    await editor
      .getByRole("button", { name: "Update report", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Saved reports", exact: true })
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      (await rpc(page).standardReports.templates.query()).find(
        template => template.id === saved.id
      )
    ).toMatchObject({
      name: editedName,
      format: "xml",
      columns: ["amountMinor", "bookingReference", "officeId"],
    });
    await page
      .getByRole("button", { name: "Run now " + editedName, exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Run history", exact: true })
    ).toHaveAttribute("aria-pressed", "true");
    const runs = (await rpc(page).standardReports.runs.query({})).filter(
      run => run.templateId === saved.id
    );
    expect(runs).toHaveLength(2);
    const latest = runs[0];
    expect(latest).toMatchObject({
      name: editedName,
      format: "xml",
      status: "ready",
      recordCount: 2,
      deliveryStatus: "none",
    });
    expect(runs[1]).toMatchObject({
      id: initial.id,
      name: firstName,
      format: "csv",
      checksum: initial.checksum,
    });
    const revised = await browserDownload(page, "Download " + editedName);
    expect(createHash("sha256").update(revised.content).digest("hex")).toBe(
      latest.checksum
    );
    const parsed = await markupRows(page, revised.content, "xml");
    expect(parsed.malformed).toBe(0);
    expect(parsed.keys).toEqual([
      "amountMinor",
      "bookingReference",
      "officeId",
    ]);
    expect(parsed.rows).toEqual(
      owner.payments.map(payment => [
        String(payment.amount),
        owner.reference,
        null,
      ])
    );
    expect(revised.content).not.toContain(other.reference);
  } finally {
    await fixture.cleanup();
  }
});

test("scheduled custom reports retain UTC time and rolling dates while pause, resume and deletion remain dashboard-only", async ({
  page,
}) => {
  const day = "2035-09-20";
  const fixture = await createStandardReportingTenants(day);
  const owner = fixture.tenants[0];
  const name = "Scheduled read " + owner.reference;
  const hourUtc = (new Date().getUTCHours() + 6) % 24;
  const runTime = String(hourUtc).padStart(2, "0") + ":45";
  try {
    await useReportingStaff(page, owner.finance);
    await paymentPreview(page, day);
    await selectColumns(page, ["bookingReference", "amountMinor"]);
    const editor = page.getByTestId("standard-template-editor");
    await editor.getByLabel("Report name", { exact: true }).fill(name);
    await editor
      .getByLabel("Saved format", { exact: true })
      .selectOption("html");
    await editor
      .getByLabel("Run frequency", { exact: true })
      .selectOption("weekly");
    await editor.getByLabel("Run time (UTC)", { exact: true }).fill(runTime);
    await editor
      .getByLabel("Use previous complete UTC days", { exact: true })
      .check();
    await editor
      .getByLabel("Number of previous days", { exact: true })
      .fill("7");
    await editor.getByLabel("Enable automatic runs", { exact: true }).uncheck();
    await expect(
      editor.getByLabel("Email a copy to my account address", { exact: true })
    ).not.toBeChecked();
    await editor
      .getByRole("button", { name: "Save report", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Saved reports", exact: true })
    ).toHaveAttribute("aria-pressed", "true");
    const saved = (await rpc(page).standardReports.templates.query()).find(
      template => template.name === name
    );
    if (!saved) throw new Error("Scheduled report was not persisted");
    expect(saved).toMatchObject({
      format: "html",
      cadence: "weekly",
      hourUtc,
      minuteUtc: 45,
      lookbackDays: 7,
      enabled: false,
      nextRunAt: null,
      emailToOwner: false,
    });
    const card = page.getByTestId(`standard-template-${saved.id}`);
    await expect(card).toContainText("Paused");
    await card
      .getByRole("button", { name: "Enable schedule " + name, exact: true })
      .click();
    await expect(
      card.getByRole("button", { name: "Pause schedule " + name, exact: true })
    ).toBeEnabled();
    const enabled = (await rpc(page).standardReports.templates.query()).find(
      template => template.id === saved.id
    );
    expect(enabled?.enabled).toBe(true);
    expect(enabled?.nextRunAt).toBeInstanceOf(Date);
    expect(enabled?.nextRunAt?.getUTCHours()).toBe(hourUtc);
    expect(enabled?.nextRunAt?.getUTCMinutes()).toBe(45);
    expect(enabled?.emailToOwner).toBe(false);
    await card
      .getByRole("button", { name: "Pause schedule " + name, exact: true })
      .click();
    await expect(
      card.getByRole("button", { name: "Enable schedule " + name, exact: true })
    ).toBeEnabled();
    expect(
      (await rpc(page).standardReports.templates.query()).find(
        template => template.id === saved.id
      )
    ).toMatchObject({ enabled: false, nextRunAt: null });
    expect(await rpc(page).standardReports.runs.query({})).toEqual([]);
    await card
      .getByRole("button", { name: "Delete " + name, exact: true })
      .click();
    await card
      .getByRole("button", { name: "Confirm deletion", exact: true })
      .click();
    await expect(card).toHaveCount(0);
    expect(await rpc(page).standardReports.templates.query()).toEqual([]);
  } finally {
    await fixture.cleanup();
  }
});

test("changed filters discard old output and blocked or unauthorized reports cannot become successful downloads", async ({
  page,
}) => {
  const day = "2035-10-21";
  const fixture = await createStandardReportingTenants(day);
  const [owner, other] = fixture.tenants;
  try {
    await useReportingStaff(page, owner.finance);
    await paymentPreview(page, day);
    await selectColumns(page, ["bookingReference", "amountMinor"]);
    await expect(page.getByTestId("standard-report-table")).toContainText(
      owner.reference
    );
    await page
      .getByLabel("Booking reference or PNR", { exact: true })
      .fill(other.reference);
    await expect(page.getByTestId("standard-report-table")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Download CSV", exact: true })
    ).toHaveCount(0);
    await page.getByTestId("standard-run-report").click();
    await expect(page.getByTestId("standard-report-table")).toContainText(
      "No records match these filters."
    );
    await expect(page.getByTestId("standard-report-table")).not.toContainText(
      owner.reference
    );
    const empty = await browserDownload(page, "Download CSV");
    expect(csvRows(empty.content)).toEqual([
      ["Booking reference", "Amount (minor units)"],
    ]);
    await expect(
      rpc(page).standardReports.run.mutate({
        reportId: 55,
        filters: { startDate: day, endDate: day, officeId: 1 },
      })
    ).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
    await page.getByTestId("standard-report-option-10").click();
    await expect(page.getByTestId("standard-report-definition")).toContainText(
      "Document validity dates"
    );
    await expect(page.getByTestId("standard-run-report")).toHaveCount(0);
    await expect(page.getByTestId("standard-report-table")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Download CSV", exact: true })
    ).toHaveCount(0);
    await expect(
      rpc(page).standardReports.run.mutate({ reportId: 10, filters: {} })
    ).rejects.toMatchObject({ data: { code: "PRECONDITION_FAILED" } });
    await useBrowserSession(page, "reporting");
    await page.goto("/admin/standard-reports");
    await expect(
      page.getByRole("heading", { name: "Standard reports", exact: true })
    ).toHaveCount(0);
    await expect(
      rpc(page).standardReports.catalog.query()
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  } finally {
    await fixture.cleanup();
  }
});
