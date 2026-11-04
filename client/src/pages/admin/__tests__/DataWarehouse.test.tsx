import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import DataWarehouse from "../DataWarehouse";

const state = vi.hoisted(() => ({
  failed: new Set<string>(),
  retry: vi.fn(),
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
            getExports: { exports: [], total: 0, totalPages: 0, page: 1 },
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
            useMutation: () => ({ mutate: vi.fn(), isPending: false }),
          };
        },
      }
    ),
  },
}));
beforeEach(() => {
  state.failed.clear();
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
