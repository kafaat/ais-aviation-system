import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ErrorBoundary from "../ErrorBoundary";

const telemetry = vi.hoisted(() => ({
  captureError: vi.fn(),
  addBreadcrumb: vi.fn(),
  isSentryInitialized: vi.fn(),
  showReportDialog: vi.fn(),
}));
vi.mock("@/lib/sentry", () => telemetry);
vi.mock("i18next", () => ({ default: { t: (key: string) => key } }));

let fail: boolean;
function UnstableChild() {
  if (fail) throw new Error("Fixture render failure");
  return <p>Recovered page</p>;
}

beforeEach(() => {
  vi.resetAllMocks();
  fail = true;
  telemetry.captureError.mockReturnValue("event-fixture-1");
  telemetry.isSentryInitialized.mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("render error recovery", () => {
  it("catches a real child render exception, records context, and retries the child", () => {
    render(
      <ErrorBoundary>
        <UnstableChild />
      </ErrorBoundary>
    );
    expect(screen.getByText("errors.somethingWentWrong")).toBeInTheDocument();
    expect(telemetry.captureError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Fixture render failure" }),
      expect.objectContaining({
        errorBoundary: true,
        componentStack: expect.stringContaining("UnstableChild"),
      })
    );
    expect(telemetry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: "error-boundary", level: "error" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "errors.technicalDetails" })
    );
    expect(screen.getByText("Error ID: event-fixture-1")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "errors.technicalDetails" })
    );
    expect(
      screen.queryByText("Error ID: event-fixture-1")
    ).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "errors.tryAgain" }));
    expect(screen.getByText("Recovered page")).toBeInTheDocument();
    expect(
      screen.queryByText("errors.somethingWentWrong")
    ).not.toBeInTheDocument();
  });

  it("keeps the fallback available when the retried child still fails", () => {
    render(
      <ErrorBoundary>
        <UnstableChild />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole("button", { name: "errors.tryAgain" }));
    expect(screen.getByText("errors.somethingWentWrong")).toBeInTheDocument();
    expect(telemetry.captureError).toHaveBeenCalledTimes(2);
  });

  it("uses a supplied fallback and still captures the exception", () => {
    render(
      <ErrorBoundary fallback={<p>Custom recovery view</p>}>
        <UnstableChild />
      </ErrorBoundary>
    );
    expect(screen.getByText("Custom recovery view")).toBeInTheDocument();
    expect(
      screen.queryByText("errors.somethingWentWrong")
    ).not.toBeInTheDocument();
    expect(telemetry.captureError).toHaveBeenCalledTimes(1);
  });

  it("opens feedback for the captured event only when telemetry is initialized", () => {
    render(
      <ErrorBoundary>
        <UnstableChild />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole("button", { name: "errors.reportError" }));
    expect(telemetry.showReportDialog).toHaveBeenCalledWith("event-fixture-1");
  });

  it.each([false, true])(
    "uses the local report fallback with telemetry=%s and no event identity",
    initialized => {
      telemetry.isSentryInitialized.mockReturnValue(initialized);
      telemetry.captureError.mockReturnValue(null);
      const report = vi.spyOn(console, "info").mockImplementation(() => {});
      const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
      render(
        <ErrorBoundary>
          <UnstableChild />
        </ErrorBoundary>
      );
      fireEvent.click(
        screen.getByRole("button", { name: "errors.reportError" })
      );
      expect(telemetry.showReportDialog).not.toHaveBeenCalled();
      expect(report).toHaveBeenCalledWith(
        "Error Report:",
        expect.objectContaining({
          message: "Fixture render failure",
          componentStack: expect.stringContaining("UnstableChild"),
        })
      );
      expect(alert).toHaveBeenCalledWith("errors.reportConfirmation");
    }
  );
});
