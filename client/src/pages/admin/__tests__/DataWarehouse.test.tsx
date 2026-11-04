import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import DataWarehouse from "../DataWarehouse";

const state = vi.hoisted(() => ({
  failed: new Set<string>(),
  exports: [] as Record<string, unknown>[],
  retry: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  completeExport: undefined as
    | ((data: {
        status: string;
        recordCount: number;
        errorMessage: string | null;
      }) => void)
    | undefined,
}));
vi.mock("sonner", () => ({
  toast: { success: state.success, error: state.error },
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: "admin" }, loading: false }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    dataWarehouse: new Proxy(
      {},
      {
        get(_target, method) {
          const name = String(method);
          const data = {
            getExports: {
              exports: state.exports,
              total: state.exports.length,
              totalPages: 1,
              page: 1,
            },
            getSchedules: [],
            getETLStatus: {
              status: "healthy",
              totalExports: 0,
              completedExports: 0,
              failedExports: 0,
              activeSchedules: 0,
            },
          } as Record<string, unknown>;
          return {
            useQuery: () => ({
              data: data[name],
              isError: state.failed.has(name),
              isLoading: false,
              isFetching: false,
              refetch: () => state.retry(name),
            }),
            useMutation: (options: {
              onSuccess?: typeof state.completeExport;
            }) => {
              if (name === "createExport")
                state.completeExport = options.onSuccess;
              return { mutate: vi.fn(), isPending: false };
            },
          };
        },
      }
    ),
  },
}));
beforeEach(() => {
  state.failed.clear();
  state.exports = [];
  state.success.mockClear();
  state.error.mockClear();
});

it.each(["getExports", "getSchedules", "getETLStatus"])(
  "does not report healthy or empty warehouse when %s fails",
  method => {
    state.failed.add(method);
    render(<DataWarehouse />);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
    expect(screen.queryByText("No exports yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(state.retry).toHaveBeenCalledExactlyOnceWith(method);
  }
);

it("renders a verified empty export history distinctly from a failed source", () => {
  render(<DataWarehouse />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getAllByText("No exports yet").length).toBeGreaterThan(0);
  expect(screen.getByText("Healthy")).toBeVisible();
});

it("does not announce a failed export record as a completed report", () => {
  render(<DataWarehouse />);
  act(() =>
    state.completeExport!({
      status: "failed",
      recordCount: 0,
      errorMessage: "Date range is too large",
    })
  );
  expect(state.success).not.toHaveBeenCalled();
  expect(state.error).toHaveBeenCalledWith(
    "Export failed: Date range is too large"
  );
  expect(state.retry).toHaveBeenCalledWith("getExports");
});

it("announces completion only for a completed export record", () => {
  render(<DataWarehouse />);
  act(() =>
    state.completeExport!({
      status: "completed",
      recordCount: 12,
      errorMessage: null,
    })
  );
  expect(state.success).toHaveBeenCalledWith(
    "Export created: 12 records exported"
  );
  expect(state.error).not.toHaveBeenCalled();
});

it("connects only completed stored reports to the authenticated download route", () => {
  state.exports = [
    {
      id: 17,
      status: "completed",
      filePath: "/api/data-warehouse/download/17",
    },
    { id: 18, status: "failed", filePath: null },
    { id: 19, status: "completed", filePath: null },
  ].map(row => ({
    ...row,
    exportType: "flights",
    format: "csv",
    recordCount: 3,
    fileSize: 100,
    createdAt: new Date("2030-01-01T08:00:00Z"),
    dateRangeStart: new Date("2030-01-01T00:00:00Z"),
    dateRangeEnd: new Date("2030-01-01T23:59:59Z"),
  }));
  render(<DataWarehouse />);
  const links = screen.getAllByRole("link", { name: /Download export/ });
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute("href", "/api/data-warehouse/download/17");
  expect(links[0]).toHaveAttribute("download");
});
