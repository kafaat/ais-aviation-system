import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorityRelationalFixture } from "../../../../../server/__tests__/helpers/authority-relational-fixture";
import {
  vouchers,
  voucherUsage,
  userCredits,
  users,
} from "../../../../../drizzle/schema";
import type { TrpcContext } from "../../../../../server/_core/context";
import { trpc, createBrowserTRPCClient } from "@/lib/trpc";
import en from "@/i18n/locales/en.json";
import ar from "@/i18n/locales/ar.json";
const state = vi.hoisted(() => ({
  db: null as any,
  serverRole: "admin",
  language: "en",
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../../../../../server/db", () => ({ getDb: () => state.db }));
vi.mock("../../../../../server/_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 7, role: "admin" }, loading: false }),
}));
vi.mock("@/components/SEO", () => ({ SEO: () => null }));
vi.mock("sonner", () => ({
  toast: { success: state.success, error: state.error },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: state.language },
    t: (key: string, params?: Record<string, unknown>) => {
      const dictionary = state.language === "ar" ? ar : en;
      const value =
        key
          .split(".")
          .reduce((current: any, part) => current?.[part], dictionary) ?? key;
      return String(value).replace(/\{\{(\w+)\}\}/g, (_, name) =>
        String(params?.[name] ?? "")
      );
    },
  }),
}));
import VoucherManagement from "../VoucherManagement";
import { router } from "../../../../../server/_core/trpc";
import { vouchersRouter } from "../../../../../server/routers/vouchers";
const app = router({ vouchers: vouchersRouter });
let fixture: ReturnType<typeof authorityRelationalFixture>;
let cache: QueryClient;
let requests: Request[];
let updateGate: Promise<void> | undefined;
const context = () =>
  ({
    user: { id: 7, role: state.serverRole },
    tenantId: null,
    req: { headers: {} },
    res: {},
  }) as TrpcContext;
const caller = () => vouchersRouter.createCaller(context());
const seed = (patch: Record<string, unknown> = {}) =>
  caller().create({
    code: "SAVE10",
    type: "percentage",
    value: 10,
    minPurchase: 0,
    validFrom: new Date("2020-01-01T12:34:56Z"),
    validUntil: new Date("2035-01-01T12:34:56Z"),
    ...patch,
  } as any);
const requestPaths = (request: Request) =>
  new URL(request.url).pathname.split("/").pop()!.split(",");
const requestsFor = (path: string) =>
  requests.filter(request => requestPaths(request).includes(path));
beforeEach(() => {
  state.serverRole = "admin";
  state.language = "en";
  fixture = authorityRelationalFixture([
    vouchers,
    voucherUsage,
    userCredits,
    users,
  ]);
  state.db = fixture.db;
  requests = [];
  updateGate = undefined;
  cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(
      input instanceof Request
        ? input
        : new URL(String(input), "https://ais.test"),
      init
    );
    requests.push(request.clone());
    if (requestPaths(request).includes("vouchers.update")) await updateGate;
    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req: request,
      router: app,
      createContext: context,
    });
  });
});
afterEach(async () => {
  cleanup();
  await cache.cancelQueries();
  cache.clear();
  fixture.close();
  vi.restoreAllMocks();
});
function visit() {
  const client = createBrowserTRPCClient();
  render(
    <trpc.Provider client={client} queryClient={cache}>
      <QueryClientProvider client={cache}>
        <VoucherManagement />
      </QueryClientProvider>
    </trpc.Provider>
  );
  return client;
}
async function createForm(type: "fixed" | "percentage", cap?: number) {
  fireEvent.click(
    await screen.findByRole("button", { name: "Create Voucher" })
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Create New Voucher",
  });
  fireEvent.change(within(dialog).getByLabelText("Voucher Code"), {
    target: { value: "SAVE10" },
  });
  if (type === "percentage") {
    fireEvent.keyDown(
      within(dialog).getByRole("combobox", { name: "Discount Type" }),
      { key: "ArrowDown" }
    );
    fireEvent.click(await screen.findByRole("option", { name: "Percentage" }));
  }
  fireEvent.change(
    within(dialog).getByLabelText(
      type === "fixed" ? "Amount (SAR)" : "Percentage (%)"
    ),
    { target: { value: "10" } }
  );
  if (cap !== undefined)
    fireEvent.change(within(dialog).getByLabelText("Maximum Discount (SAR)"), {
      target: { value: String(cap) },
    });
  return dialog;
}
async function openEdit(code = "SAVE10") {
  fireEvent.click(
    await screen.findByRole("button", { name: `Edit voucher ${code}` })
  );
  return screen.findByRole("dialog", { name: "Edit Voucher" });
}

describe("voucher form through real browser tRPC and service", () => {
  it.each([
    ["fixed", undefined],
    ["percentage", undefined],
    ["percentage", 20],
  ] as const)(
    "creates %s with cap %s without losing units or dates",
    async (type, cap) => {
      visit();
      const dialog = await createForm(type, cap);
      fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      );
      const stored = (await caller().getAll({ includeInactive: true }))[0];
      expect(stored).toMatchObject({
        type,
        value: type === "fixed" ? 1000 : 10,
        maxDiscount: cap === undefined ? null : 2000,
      });
      expect(stored.validFrom).toBeInstanceOf(Date);
      await expect(
        caller().validate({ code: stored.code, amount: 10000 })
      ).resolves.toMatchObject({ discountAmount: 1000, finalAmount: 9000 });
      await screen.findByRole("button", { name: "Edit voucher SAVE10" });
      expect(state.success).toHaveBeenCalledWith(
        "Voucher created successfully"
      );
      expect(requestsFor("vouchers.getAll").length).toBeGreaterThanOrEqual(2);
      const request = requestsFor("vouchers.create")[0];
      expect(request.credentials).toBe("include");
      const body = await request.json();
      expect(body[0].json.value).toBe(type === "fixed" ? 1000 : 10);
      expect(body[0].meta.values.validFrom).toEqual(["Date"]);
    }
  );
  it("edits an inactive voucher, shows pending state, and refreshes from persisted data", async () => {
    const stored = await seed({ isActive: false, maxDiscount: 2000 });
    visit();
    const dialog = await openEdit();
    expect(within(dialog).getByLabelText("Voucher Code")).toBeDisabled();
    const value = within(dialog).getByLabelText("Percentage (%)");
    await waitFor(() => expect(value).toBeEnabled());
    expect(value).toHaveValue(10);
    expect(within(dialog).getByLabelText("Maximum Discount (SAR)")).toHaveValue(
      20
    );
    fireEvent.change(value, { target: { value: "15" } });
    fireEvent.change(within(dialog).getByLabelText("Description"), {
      target: { value: "Changed by editor" },
    });
    let release!: () => void;
    updateGate = new Promise(resolve => {
      release = resolve;
    });
    const save = within(dialog).getByRole("button", { name: "Save" });
    fireEvent.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    expect(
      within(dialog).getByRole("button", { name: "Cancel" })
    ).toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(requestsFor("vouchers.update")).toHaveLength(1));
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    await screen.findByText("15%");
    const updated = await caller().getById({ id: stored.id });
    expect(updated).toMatchObject({
      value: 15,
      maxDiscount: 2000,
      description: "Changed by editor",
      isActive: false,
      validFrom: stored.validFrom,
      validUntil: stored.validUntil,
    });
    const body = await requestsFor("vouchers.update")[0].json();
    expect(body[0].json).toEqual({
      id: stored.id,
      value: 15,
      description: "Changed by editor",
    });
    expect(state.success).toHaveBeenCalledWith("Voucher updated successfully");
    const reopened = await openEdit();
    expect(within(reopened).getByLabelText("Percentage (%)")).toHaveValue(15);
  });
  it("loads fixed minor units as SAR and saves the edited amount once", async () => {
    const stored = await seed({ type: "fixed", value: 1000, isActive: false });
    visit();
    const dialog = await openEdit();
    const value = within(dialog).getByLabelText("Amount (SAR)");
    await waitFor(() => expect(value).toBeEnabled());
    expect(value).toHaveValue(10);
    fireEvent.change(value, { target: { value: "12.34" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect((await caller().getById({ id: stored.id }))?.value).toBe(1234);
  });
  it("locks active and historical discount terms while allowing metadata updates", async () => {
    const stored = await seed({ isActive: false });
    fixture.insert(voucherUsage, {
      voucherId: stored.id,
      bookingId: 9,
      userId: 11,
      discountApplied: 1000,
      releasedAt: "2026-01-01 00:00:00",
    });
    visit();
    const dialog = await openEdit();
    await within(dialog).findByText(en.admin.voucher.usedTermsLocked);
    expect(within(dialog).getByLabelText("Percentage (%)")).toBeDisabled();
    expect(
      within(dialog).getByRole("combobox", { name: "Discount Type" })
    ).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Description"), {
      target: { value: "History note" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect((await caller().getById({ id: stored.id }))?.description).toBe(
      "History note"
    );
  });
  it("shows API errors without losing edits, then retries successfully", async () => {
    const stored = await seed();
    visit();
    const dialog = await openEdit();
    expect(within(dialog).getByLabelText("Percentage (%)")).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Description"), {
      target: { value: "Retained note" },
    });
    state.serverRole = "user";
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await within(dialog).findByRole("alert");
    expect(within(dialog).getByLabelText("Description")).toHaveValue(
      "Retained note"
    );
    expect(state.error).toHaveBeenCalledOnce();
    expect(fixture.rows(vouchers)[0].description).toBeNull();
    state.serverRole = "admin";
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect((await caller().getById({ id: stored.id }))?.description).toBe(
      "Retained note"
    );
  });
  it("deactivates a legacy 1000 percent voucher without silently repairing it", async () => {
    const stored = await seed();
    fixture.sqlite
      .prepare("UPDATE vouchers SET value = 1000 WHERE id = ?")
      .run(stored.id);
    visit();
    const dialog = await openEdit();
    expect(within(dialog).getByLabelText("Percentage (%)")).toHaveValue(1000);
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect(await caller().getById({ id: stored.id })).toMatchObject({
      value: 1000,
      isActive: false,
    });
    expect(requestsFor("vouchers.deactivate")).toHaveLength(1);
  });
  it("clears a percentage cap explicitly when changing an unused voucher to fixed SAR", async () => {
    const stored = await seed({ isActive: false, maxDiscount: 2000 });
    visit();
    const dialog = await openEdit();
    const type = within(dialog).getByRole("combobox", {
      name: "Discount Type",
    });
    await waitFor(() => expect(type).toBeEnabled());
    fireEvent.keyDown(type, { key: "ArrowDown" });
    fireEvent.click(
      await screen.findByRole("option", { name: "Fixed Amount" })
    );
    expect(
      within(dialog).queryByLabelText("Maximum Discount (SAR)")
    ).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Amount (SAR)"), {
      target: { value: "10" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect(await caller().getById({ id: stored.id })).toMatchObject({
      type: "fixed",
      value: 1000,
      maxDiscount: null,
    });
    const body = await requestsFor("vouchers.update")[0].json();
    expect(body[0].json).toEqual({
      id: stored.id,
      type: "fixed",
      value: 1000,
      maxDiscount: null,
    });
  });
  it("blocks an out-of-range percentage and displays invalid date-range feedback before sending", async () => {
    visit();
    const dialog = await createForm("percentage");
    const value = within(dialog).getByLabelText(
      "Percentage (%)"
    ) as HTMLInputElement;
    fireEvent.change(value, { target: { value: "101" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(value.validity.rangeOverflow).toBe(true);
    expect(requestsFor("vouchers.create")).toHaveLength(0);
    fireEvent.change(value, { target: { value: "10" } });
    fireEvent.change(within(dialog).getByLabelText("Valid Until"), {
      target: { value: "2019-01-01" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      en.admin.voucher.invalidFields
    );
    expect(requestsFor("vouchers.create")).toHaveLength(0);
  });
  it("renders the edit dialog in Arabic with accessible labels", async () => {
    await seed();
    state.language = "ar";
    visit();
    fireEvent.click(
      await screen.findByRole("button", { name: "تعديل القسيمة SAVE10" })
    );
    const dialog = await screen.findByRole("dialog", {
      name: ar.admin.voucher.editTitle,
    });
    expect(dialog).toHaveAttribute("dir", "rtl");
    expect(
      within(dialog).getByLabelText(ar.admin.voucher.valuePercentage)
    ).toHaveValue(10);
    expect(
      within(dialog).getByRole("button", { name: ar.common.save })
    ).toBeEnabled();
  });
});
