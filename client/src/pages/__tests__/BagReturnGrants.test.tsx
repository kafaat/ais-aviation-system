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
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { TrpcContext } from "../../../../server/_core/context";
import { transactionMemory } from "../../../../server/__tests__/helpers/transaction-memory";
import { trpc, createBrowserTRPCClient } from "@/lib/trpc";

const state = vi.hoisted(() => ({
  db: null as any,
  clientUser: { id: 99, role: "airline_admin", tenantId: 1 } as {
    id: number;
    role: string;
    tenantId: number | null;
  } | null,
  serverUser: { id: 99, role: "airline_admin", tenantId: 1 } as {
    id: number;
    role: string;
    tenantId: number | null;
  } | null,
}));
vi.mock("../../../../server/db", () => ({ getDb: () => state.db }));
vi.mock("../../../../server/_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: state.clientUser,
    loading: false,
    isAuthenticated: !!state.clientUser,
  }),
}));
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));

import BagReturnGrants from "../BagReturnGrants";
import { router } from "../../../../server/_core/trpc";
import { dcsOperationsRouter } from "../../../../server/routers/dcs-operations";
import { operationsRouter } from "../../../../server/routers/operations";
const app = router({
  dcsOperations: dcsOperationsRouter,
  operations: operationsRouter,
});

// Real React, browser tRPC transport, authorization middleware and services.
// Only the relational storage boundary is replaced; row locks are not simulated.
let fixture: ReturnType<typeof transactionMemory>;
let cache: QueryClient;
let requests: Request[];
let mutationGate: Promise<void> | undefined;
let dropReply: boolean;
const paths = (request: Request) =>
  new URL(request.url).pathname.split("/").pop()!.split(",");
const requestsFor = (path: string) =>
  requests.filter(request => paths(request).includes(path));
const context = () =>
  ({
    user: state.serverUser,
    tenantId: state.serverUser?.tenantId ?? null,
    req: { headers: {} },
    res: {},
    authMethod: "cookie",
  }) as TrpcContext;
const grantRows = () => fixture.rows("dcs_bag_return_grants");
const events = () => fixture.rows("dcs_operation_events");

beforeEach(() => {
  state.clientUser = { id: 99, role: "airline_admin", tenantId: 1 };
  state.serverUser = { ...state.clientUser };
  fixture = transactionMemory({
    tenants: [
      { id: 1, status: "active" },
      { id: 2, status: "active" },
    ],
    users: [
      {
        id: 99,
        name: "Station Administrator",
        role: "airline_admin",
        tenantId: 1,
      },
      { id: 20, name: "Synthetic Operator", role: "ops", tenantId: 1 },
      { id: 21, name: "Synthetic Passenger", role: "user", tenantId: 1 },
      { id: 22, name: "Other Tenant Operator", role: "ops", tenantId: 2 },
    ],
    flights: [11, 12, 13].map(id => ({
      id,
      flightNumber: `SV${id}`,
      tenantId: id === 13 ? 2 : 1,
      airlineId: id === 13 ? 2 : 1,
      originId: id === 12 ? 2 : 1,
      destinationId: 3,
      status: "scheduled",
      departureTime: new Date("2030-11-21T12:00:00Z"),
      economyAvailable: 10,
      businessAvailable: 0,
    })),
    dcs_bag_return_grants: [],
    dcs_operation_events: [],
    idempotency_requests: [],
  });
  state.db = fixture.db;
  requests = [];
  mutationGate = undefined;
  dropReply = false;
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
    const mutation = paths(request).includes("dcsOperations.setBagReturnGrant");
    if (mutation) await mutationGate;
    const response = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: request,
      router: app,
      createContext: context,
    });
    if (mutation && dropReply) {
      dropReply = false;
      throw new Error("Grant reply was lost after commit");
    }
    return response;
  });
});
afterEach(async () => {
  cleanup();
  await cache.cancelQueries();
  cache.clear();
  vi.restoreAllMocks();
});
function visit() {
  const client = createBrowserTRPCClient();
  const location = memoryLocation({ path: "/airline/bag-return-grants" });
  const view = render(
    <Router hook={location.hook}>
      <trpc.Provider client={client} queryClient={cache}>
        <QueryClientProvider client={cache}>
          <BagReturnGrants />
        </QueryClientProvider>
      </trpc.Provider>
    </Router>
  );
  return { client, view, location };
}
async function selectFlight(id = 11) {
  const picker = await screen.findByRole("combobox", {
    name: "Reference flight",
  });
  await waitFor(() => expect(picker).toBeEnabled());
  fireEvent.change(picker, { target: { value: String(id) } });
  return screen.findByRole("form", { name: "Grant bag return access" });
}
function fillGrant(
  form: HTMLElement,
  staffId = 20,
  reason = "Station supervisor approved access"
) {
  fireEvent.change(within(form).getByLabelText("Staff ID"), {
    target: { value: String(staffId) },
  });
  fireEvent.change(within(form).getByLabelText("Grant change reason"), {
    target: { value: reason },
  });
}
async function enableGrant() {
  const form = await selectFlight();
  fillGrant(form);
  fireEvent.click(within(form).getByRole("button", { name: "Grant access" }));
  await screen.findByRole("button", { name: "Revoke access for staff 20" });
  return form;
}

describe("bag-return grant administration through the real transport", () => {
  it("grants and revokes the selected carrier/station scope, preserving other grants", async () => {
    grantRows().push({
      id: 1,
      tenantId: 1,
      airlineId: 1,
      airportId: 2,
      staffId: 20,
      enabled: true,
    });
    visit();
    const form = await enableGrant();
    expect(screen.getByText(/Access lasts until revoked/)).toBeInTheDocument();
    expect(grantRows()).toMatchObject([
      { airportId: 2, enabled: true },
      { tenantId: 1, airlineId: 1, airportId: 1, staffId: 20, enabled: true },
    ]);
    expect(events()).toHaveLength(1);
    expect(within(form).getByLabelText("Staff ID")).toHaveValue(null);
    fireEvent.click(
      screen.getByRole("button", { name: "Revoke access for staff 20" })
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Revoke bag return access",
    });
    expect(
      within(dialog).getByRole("button", { name: "Confirm revocation" })
    ).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Grant change reason"), {
      target: { value: "Shift assignment ended" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm revocation" })
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect(grantRows()).toMatchObject([
      { airportId: 2, enabled: true },
      { airportId: 1, enabled: false },
    ]);
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(events()).toHaveLength(2);
    expect(events()[1]).toMatchObject({
      actorId: 99,
      actorRole: "airline_admin",
      reason: "Shift assignment ended",
    });
    const request = requestsFor("dcsOperations.setBagReturnGrant")[0];
    expect(request.credentials).toBe("include");
    expect((await request.json())[0].json).toMatchObject({
      flightId: 11,
      airlineId: 1,
      airportId: 1,
      staffId: 20,
      enabled: true,
    });
  });

  it.each(["ops", "finance", "user"])(
    "does not mount the administration controls for %s",
    async role => {
      state.clientUser!.role = role;
      visit();
      await act(async () => {});
      expect(
        screen.queryByRole("heading", { name: "Bag return grants" })
      ).not.toBeInTheDocument();
      expect(requests).toHaveLength(0);
    }
  );

  it.each([21, 22])(
    "rejects ineligible staff %s on the server without granting access",
    async staffId => {
      visit();
      const form = await selectFlight();
      fillGrant(form, staffId);
      fireEvent.click(
        within(form).getByRole("button", { name: "Grant access" })
      );
      await screen.findByText(
        "The target must be operations staff in the same airline tenant"
      );
      expect(grantRows()).toHaveLength(0);
      expect(events()).toHaveLength(0);
    }
  );

  it.each(["role", "session", "tenant"])(
    "rejects a stale open form after %s authority changes",
    async change => {
      visit();
      const form = await selectFlight();
      fillGrant(form);
      if (change === "role") state.serverUser!.role = "ops";
      if (change === "session") state.serverUser = null;
      if (change === "tenant") state.serverUser!.tenantId = 2;
      fireEvent.click(
        within(form).getByRole("button", { name: "Grant access" })
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("form", { name: "Grant bag return access" })
        ).not.toBeInTheDocument()
      );
      expect(screen.getByRole("alert")).toHaveTextContent("Source unavailable");
      expect(grantRows()).toHaveLength(0);
      expect(events()).toHaveLength(0);
    }
  );

  it("does not submit invalid IDs or short reasons", async () => {
    visit();
    const form = await selectFlight();
    fillGrant(form, -1);
    fireEvent.submit(form);
    fillGrant(form, 20, "why");
    fireEvent.submit(form);
    expect(
      within(form).getByRole("button", { name: "Grant access" })
    ).toBeDisabled();
    expect(requestsFor("dcsOperations.setBagReturnGrant")).toHaveLength(0);
  });

  it("freezes the scope and prevents duplicate submissions while a command is pending", async () => {
    visit();
    const form = await selectFlight();
    fillGrant(form);
    let release!: () => void;
    mutationGate = new Promise(resolve => {
      release = resolve;
    });
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() =>
      expect(requestsFor("dcsOperations.setBagReturnGrant")).toHaveLength(1)
    );
    expect(
      screen.getByRole("combobox", { name: "Reference flight" })
    ).toBeDisabled();
    expect(within(form).getByLabelText("Staff ID")).toBeDisabled();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Reference flight" }),
      { target: { value: "12" } }
    );
    expect(
      screen.getByRole("combobox", { name: "Reference flight" })
    ).toHaveValue("11");
    await act(async () => {
      release();
    });
    await screen.findByRole("button", { name: "Revoke access for staff 20" });
    expect(events()).toHaveLength(1);
  });

  it("reuses a lost-reply command key and displays a subsequent revocation instead of the old receipt state", async () => {
    const { client } = visit();
    const form = await selectFlight();
    fillGrant(form);
    dropReply = true;
    fireEvent.click(within(form).getByRole("button", { name: "Grant access" }));
    await screen.findByText("Grant reply was lost after commit");
    expect(grantRows()[0].enabled).toBe(true);
    await client.dcsOperations.setBagReturnGrant.mutate({
      flightId: 11,
      airlineId: 1,
      airportId: 1,
      staffId: 20,
      enabled: false,
      reason: "Later administrator revoked access",
      idempotencyKey: "other-administrator-revocation",
    });
    fireEvent.click(within(form).getByRole("button", { name: "Grant access" }));
    await screen.findByText("Revoked");
    expect(grantRows()[0].enabled).toBe(false);
    expect(events()).toHaveLength(2);
    const sent = await Promise.all(
      requestsFor("dcsOperations.setBagReturnGrant").map(request =>
        request.json()
      )
    );
    expect(sent[2][0].json.idempotencyKey).toBe(sent[0][0].json.idempotencyKey);
    expect(
      screen.queryByRole("button", { name: "Revoke access for staff 20" })
    ).not.toBeInTheDocument();
  });

  it("shows a source failure instead of an empty list and recovers on retry", async () => {
    visit();
    await enableGrant();
    state.db = null;
    fireEvent.click(screen.getByRole("button", { name: "Refresh grants" }));
    await screen.findByRole("alert");
    expect(
      screen.queryByText("No grants on this page.")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Revoke access for staff 20" })
    ).not.toBeInTheDocument();
    state.db = fixture.db;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: "Revoke access for staff 20" });
  });

  it("paginates only the authorized station/carrier and hides staff details from other tenants", async () => {
    grantRows().push(
      {
        id: 1,
        tenantId: 1,
        airlineId: 1,
        airportId: 1,
        staffId: 20,
        enabled: true,
      },
      {
        id: 2,
        tenantId: 1,
        airlineId: 1,
        airportId: 1,
        staffId: 22,
        enabled: true,
      },
      {
        id: 3,
        tenantId: 1,
        airlineId: 1,
        airportId: 2,
        staffId: 20,
        enabled: true,
      },
      {
        id: 4,
        tenantId: 1,
        airlineId: 2,
        airportId: 1,
        staffId: 20,
        enabled: true,
      },
      {
        id: 5,
        tenantId: 2,
        airlineId: 1,
        airportId: 1,
        staffId: 22,
        enabled: true,
      }
    );
    const { client } = visit();
    const first = await client.dcsOperations.bagReturnGrants.query({
      flightId: 11,
      limit: 1,
    });
    expect(first.grants).toMatchObject([
      { staffId: 20, staffName: "Synthetic Operator", eligible: true },
    ]);
    expect(first.nextCursor).toBe(1);
    const second = await client.dcsOperations.bagReturnGrants.query({
      flightId: 11,
      after: first.nextCursor!,
      limit: 1,
    });
    expect(second.grants).toMatchObject([
      { staffId: 22, staffName: null, staffRole: null, eligible: false },
    ]);
    expect(second.nextCursor).toBeNull();
    await expect(
      client.dcsOperations.bagReturnGrants.query({ flightId: 13 })
    ).rejects.toThrow(/scope/i);
    const command = {
      flightId: 11,
      airlineId: 1,
      airportId: 1,
      staffId: 20,
      enabled: true,
      reason: "Requested through the client",
      idempotencyKey: "wrong-station",
    };
    await expect(
      client.dcsOperations.setBagReturnGrant.mutate({
        ...command,
        airportId: 2,
      })
    ).rejects.toThrow(/Station and carrier/);
    await expect(
      client.dcsOperations.setBagReturnGrant.mutate({
        ...command,
        airlineId: 2,
        idempotencyKey: "wrong-carrier",
      })
    ).rejects.toThrow(/Station and carrier/);
    expect(events()).toHaveLength(0);
  });
});
