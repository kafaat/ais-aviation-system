import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import EmbedSearch from "../EmbedSearch";

const state = vi.hoisted(() => ({ enabled: true, airports: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    ibePublic: {
      config: {
        useQuery: () => ({
          data: {
            brandName: "Operator Airline",
            logoPath: "/branding/logo.svg",
            embedSearchEnabled: state.enabled,
          },
        }),
      },
    },
    reference: {
      airports: {
        useQuery: (...args: unknown[]) => {
          state.airports(...args);
          return {
            data: [
              { id: 1, code: "ADE", city: "Aden" },
              { id: 2, code: "JED", city: "Jeddah" },
            ],
          };
        },
      },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.enabled = true;
});
function show(query = "") {
  const location = memoryLocation({
    path: `/embed/search${query ? `?${query}` : ""}`,
  });
  render(
    <Router hook={location.hook}>
      <EmbedSearch />
    </Router>
  );
}
function fill() {
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Departure date"), {
    target: { value: "2030-11-15" },
  });
}
function submit() {
  const form = screen.getByRole("form", {
    name: "Find a flight",
  }) as HTMLFormElement;
  const event = new Event("submit", { bubbles: true, cancelable: true });
  fireEvent(form, event);
  return { form, event };
}

it("submits a native GET to top-level same-origin search with validated public preferences only", () => {
  show(
    "currency=USD&country=US&adults=2&children=1&infants=0&tenantId=999&brandName=Impostor&returnTo=https://evil.example"
  );
  fill();
  const { form, event } = submit();
  expect(event.defaultPrevented).toBe(false);
  expect(form.target).toBe("_top");
  expect(form.method).toBe("get");
  expect(form.action).toBe(`${window.location.origin}/search`);
  const values = Object.fromEntries(new FormData(form).entries());
  expect(values).toEqual({
    origin: "1",
    destination: "2",
    date: "2030-11-15",
    adults: "2",
    children: "1",
    infants: "0",
    currency: "USD",
    country: "US",
  });
  expect(screen.getByTestId("brand-identity")).toHaveTextContent(
    "Operator Airline"
  );
  expect(screen.queryByText("Impostor")).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText(/passport|password|surname/i)
  ).not.toBeInTheDocument();
  expect(localStorage.setItem).not.toHaveBeenCalled();
});

it("blocks invalid route/party submissions instead of navigating the parent", () => {
  show();
  fill();
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "1" } });
  expect(submit().event.defaultPrevented).toBe(true);
  expect(screen.getByRole("alert")).toHaveTextContent("different airports");
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Adults"), {
    target: { value: "10" },
  });
  expect(submit().event.defaultPrevented).toBe(true);
});

it("normalizes unsupported source preferences and never forwards arbitrary query fields", () => {
  show(
    "currency=javascript:alert(1)&country=XX&adults=-1&children=999&tenant=another"
  );
  fill();
  const { form, event } = submit();
  expect(event.defaultPrevented).toBe(false);
  const values = Object.fromEntries(new FormData(form).entries());
  expect(values).toMatchObject({
    currency: "SAR",
    country: "SA",
    adults: "1",
    children: "0",
    infants: "0",
  });
  expect(values).not.toHaveProperty("tenant");
});

it("offers only top-level ordinary search when embedding is disabled", () => {
  state.enabled = false;
  show();
  expect(screen.queryByRole("form")).not.toBeInTheDocument();
  const link = screen.getByRole("link", { name: "Open flight search" });
  expect(link).toHaveAttribute("href", "/");
  expect(link).toHaveAttribute("target", "_top");
  expect(state.airports).toHaveBeenCalledWith(undefined, {
    enabled: false,
    retry: false,
  });
});

it("keeps the configured display name if the operator's logo cannot load", () => {
  show();
  fireEvent.error(screen.getByTestId("brand-identity").querySelector("img")!);
  expect(screen.getByTestId("brand-identity").querySelector("img")).toBeNull();
  expect(screen.getByTestId("brand-identity")).toHaveTextContent(
    "Operator Airline"
  );
});
