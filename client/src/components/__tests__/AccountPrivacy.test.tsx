import { expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import AccountPrivacy from "../AccountPrivacy";
import { trpc } from "@/lib/trpc";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("qrcode", () => ({
  default: {
    toDataURL: async (url: string) => "data:image/png;base64," + btoa(url),
  },
}));

type Handler = (method: string, input: unknown) => unknown;
function openPanel(handler: Handler) {
  const calls = vi.fn(handler);
  const client = trpc.createClient({
    links: [
      httpBatchLink({
        url: "http://fixture.test/api/trpc",
        transformer: superjson,
        fetch: async (input, options) => {
          const url = new URL(String(input));
          const params = JSON.parse(
            String(options?.body ?? url.searchParams.get("input") ?? "{}")
          );
          const methods = url.pathname.split("/").pop()!.split(",");
          const results = methods.map((name, i) => {
            const value = calls(name, params[i]?.json);
            return { result: { data: superjson.serialize(value) } };
          });
          return new Response(JSON.stringify(results), {
            headers: { "content-type": "application/json" },
          });
        },
      }),
    ],
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <trpc.Provider queryClient={queryClient} client={client}>
      <QueryClientProvider client={queryClient}>
        <AccountPrivacy />
      </QueryClientProvider>
    </trpc.Provider>
  );
  return calls;
}
const token = "a".repeat(64);
const otpUri = "otpauth://totp/AIS:fixture?secret=TESTKEY";
it("begins enrollment only on request, encodes the actual provisioning URI and requires successful verification before showing backup codes", async () => {
  let enabled = false;
  const calls = openPanel((method, input) => {
    switch (method) {
      case "mfa.getStatus":
        return { enabled };
      case "mfa.setup":
        return {
          secret: "TESTKEY",
          qrCodeUrl: otpUri,
          backupCodes: ["SYNTHETIC-CODE"],
        };
      case "mfa.verify":
        expect(input).toEqual({ token: "123456" });
        enabled = true;
        return { success: true };
      case "gdpr.getExportHistory":
        return [];
      case "gdpr.getDeletionStatus":
        return { hasPendingRequest: false };
      default:
        throw new Error(method);
    }
  });
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Open authenticator setup",
    })
  );
  expect(
    calls.mock.calls.filter(([name]) => name === "mfa.setup")
  ).toHaveLength(0);
  fireEvent.click(
    screen.getByRole("button", { name: "Set Up Two-Factor Authentication" })
  );
  expect(
    await screen.findByRole("img", { name: "Scan QR Code" })
  ).toHaveAttribute("src", "data:image/png;base64," + btoa(otpUri));
  expect(screen.queryByText("SYNTHETIC-CODE")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.change(screen.getByLabelText("Verification Code"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify & Enable" }));
  await screen.findByText("SYNTHETIC-CODE");
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await screen.findByText("Two-factor authentication is enabled");
});
it("downloads only completed exports and keeps deletion as separate request, confirmation and cancellation actions", async () => {
  let active = false;
  let confirmed = false;
  const calls = openPanel((name, input) => {
    const date = new Date("2099-01-01");
    switch (name) {
      case "mfa.getStatus":
        return { enabled: true };
      case "gdpr.getExportHistory":
        return [
          { id: 3, format: "json", requestedAt: date, status: "expired" },
          { id: 4, format: "csv", requestedAt: date, status: "completed" },
        ];
      case "gdpr.exportData":
        expect(input).toEqual({ format: "csv" });
        return { requestId: 5 };
      case "gdpr.getDeletionStatus":
        return {
          hasPendingRequest: active,
          request: active
            ? {
                id: 8,
                status: "pending",
                confirmedAt: confirmed ? date : null,
                scheduledDeletionAt: date,
              }
            : undefined,
        };
      case "gdpr.deleteAccount":
        active = true;
        return {
          requestId: 8,
          confirmationToken: token,
          scheduledDeletionAt: date,
        };
      case "gdpr.confirmDeletion":
        expect(input).toEqual({ confirmationToken: token });
        confirmed = true;
        return { success: true };
      case "gdpr.cancelDeletion":
        active = false;
        return { success: true };
      default:
        throw new Error(name);
    }
  });
  expect(await screen.findByRole("link", { name: "Download" })).toHaveAttribute(
    "href",
    "/api/gdpr/download/4"
  );
  fireEvent.change(screen.getByLabelText("File format"), {
    target: { value: "csv" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Request export" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("gdpr.exportData", { format: "csv" })
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Start deletion request" })
  );
  const confirmButton = await screen.findByRole("button", {
    name: "Confirm deletion request",
  });
  expect(confirmed).toBe(false);
  fireEvent.click(confirmButton);
  await screen.findByText(/Request confirmed/);
  fireEvent.click(
    screen.getByRole("button", { name: "Cancel deletion request" })
  );
  await screen.findByRole("button", { name: "Start deletion request" });
});
