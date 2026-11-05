import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import AccountPrivacy from "../AccountPrivacy";
import { MFASetup } from "../MFASetup";
import i18n from "@/i18n/config";
import { createTrpcFixture, deferred } from "@/test/trpc-fixture";

const encodeQr = vi.hoisted(() =>
  vi.fn<(text: string, options: { width: number }) => Promise<string>>()
);
vi.mock("qrcode", () => ({ default: { toDataURL: encodeQr } }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const enrollment = {
  secret: "JBSWY3DPEHPK3PXP",
  qrCodeUrl: "otpauth://totp/AIS:fixture?secret=JBSWY3DPEHPK3PXP&issuer=AIS",
  backupCodes: ["fixture01", "fixture02", "fixture03"],
};
const formattedSecret = "JBSW Y3DP EHPK 3PXP";
const qrImage = "data:image/png;base64,fixture";
type Handler = (input: unknown) => unknown | Promise<unknown>;

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  encodeQr.mockReset().mockResolvedValue(qrImage);
  vi.mocked(navigator.clipboard.writeText)
    .mockReset()
    .mockResolvedValue(undefined);
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeFixture(replies: Record<string, Handler> = {}) {
  return createTrpcFixture({
    "mfa.setup": () => enrollment,
    "mfa.verify": () => ({ success: true }),
    "mfa.getStatus": () => ({ enabled: false }),
    "gdpr.getExportHistory": () => [],
    "gdpr.getDeletionStatus": () => ({ hasPendingRequest: false }),
    ...replies,
  });
}

function openSetup(replies: Record<string, Handler> = {}) {
  const fixture = makeFixture(replies);
  const onComplete = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <fixture.Wrapper>
      <MFASetup onComplete={onComplete} onCancel={onCancel} />
    </fixture.Wrapper>
  );
  return { ...fixture, ...view, onComplete, onCancel };
}

function openAccount(replies: Record<string, Handler> = {}) {
  const fixture = makeFixture(replies);
  // Profile keys AccountPrivacy by user.id. Exercise the same remount boundary
  // with the real AccountPrivacy and its actual finish/cancel callbacks.
  const account = (userId: number) => (
    <fixture.Wrapper>
      <AccountPrivacy key={userId} />
    </fixture.Wrapper>
  );
  const view = render(account(1));
  return {
    ...fixture,
    ...view,
    switchAccount: () => view.rerender(account(2)),
  };
}

async function beginSetup() {
  fireEvent.click(
    screen.getByRole("button", { name: "Set Up Two-Factor Authentication" })
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled()
  );
}

async function openEnrollment() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open authenticator setup" })
  );
}

function submitCode(code = "123456") {
  fireEvent.change(screen.getByLabelText("Verification Code"), {
    target: { value: code },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify & Enable" }));
}

async function reachBackupCodes() {
  await beginSetup();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  submitCode();
  await screen.findByRole("heading", { name: "Save Backup Codes" });
}

it("sets up only on request, uses the local provisioning URI and waits for verification before exposing recovery codes", async () => {
  const setup = deferred<typeof enrollment>();
  const verify = deferred<{ success: boolean }>();
  const fixture = openSetup({
    "mfa.setup": () => setup.promise,
    "mfa.verify": () => verify.promise,
  });
  expect(fixture.requests).toHaveLength(0);
  expect(screen.queryByText(formattedSecret)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Set Up Two-Factor Authentication" })
  );
  await waitFor(() => expect(fixture.requests).toHaveLength(1));
  expect(fixture.requests[0]).toEqual({ path: "mfa.setup", input: undefined });
  expect(
    screen.getByRole("button", { name: "Set Up Two-Factor Authentication" })
  ).toBeDisabled();
  expect(screen.queryByRole("img", { name: "Scan QR Code" })).toBeNull();

  await act(async () => setup.resolve(enrollment));
  expect(
    await screen.findByRole("img", { name: "Scan QR Code" })
  ).toHaveAttribute("src", qrImage);
  expect(encodeQr).toHaveBeenCalledWith(enrollment.qrCodeUrl, {
    width: 224,
  });
  expect(screen.getByText(formattedSecret)).toBeVisible();
  for (const code of enrollment.backupCodes) {
    expect(screen.queryByText(code)).toBeNull();
  }
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  const input = screen.getByLabelText("Verification Code");
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "12a3" } });
  expect(input).toHaveValue("123");
  expect(
    screen.getByRole("button", { name: "Verify & Enable" })
  ).toBeDisabled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(fixture.requests).toHaveLength(1);

  fireEvent.change(input, { target: { value: "12a345678" } });
  expect(input).toHaveValue("123456");
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(fixture.requests).toHaveLength(2));
  expect(fixture.requests[1]).toEqual({
    path: "mfa.verify",
    input: { token: "123456" },
  });
  expect(screen.getByRole("button", { name: "Verifying..." })).toBeDisabled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(fixture.requests).toHaveLength(2);
  expect(
    screen.queryByRole("heading", { name: "Save Backup Codes" })
  ).toBeNull();

  await act(async () => verify.resolve({ success: true }));
  await screen.findByRole("heading", { name: "Save Backup Codes" });
  for (const code of enrollment.backupCodes) {
    expect(screen.getByText(code)).toBeVisible();
  }
  expect(toast.success).toHaveBeenCalledWith(
    "Two-factor authentication has been enabled!"
  );
  expect(fixture.onComplete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(fixture.onComplete).toHaveBeenCalledTimes(1);
});

it("allows retry after setup and verification failures without showing recovery codes", async () => {
  const setup = vi
    .fn<Handler>()
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValue(enrollment);
  const verify = vi
    .fn<Handler>()
    .mockRejectedValueOnce(new Error("Invalid token"))
    .mockResolvedValue({ success: true });
  openSetup({ "mfa.setup": setup, "mfa.verify": verify });
  fireEvent.click(
    screen.getByRole("button", { name: "Set Up Two-Factor Authentication" })
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Failed to initiate MFA setup. Please try again."
    )
  );
  expect(screen.queryByText(formattedSecret)).toBeNull();
  expect(encodeQr).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Set Up Two-Factor Authentication" })
    ).toBeEnabled()
  );
  await beginSetup();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  submitCode();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Invalid code. Please check and try again."
    )
  );
  expect(screen.getByLabelText("Verification Code")).toHaveValue("");
  expect(
    screen.queryByRole("heading", { name: "Save Backup Codes" })
  ).toBeNull();
  expect(toast.success).not.toHaveBeenCalled();

  submitCode("654321");
  await screen.findByRole("heading", { name: "Save Backup Codes" });
  expect(setup).toHaveBeenCalledTimes(2);
  expect(verify.mock.calls.map(([input]) => input)).toEqual([
    { token: "123456" },
    { token: "654321" },
  ]);
});

it("keeps manual setup available if local QR encoding fails", async () => {
  encodeQr.mockRejectedValueOnce(new Error("Encoder failure"));
  openSetup();
  await beginSetup();
  expect(screen.getByText(formattedSecret)).toBeVisible();
  expect(screen.queryByRole("img", { name: "Scan QR Code" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  submitCode();
  await screen.findByRole("heading", { name: "Save Backup Codes" });
});

it("copies the unformatted secret and every recovery code only after clipboard success", async () => {
  const copy = deferred<void>();
  vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(copy.promise);
  openSetup();
  await beginSetup();
  fireEvent.click(
    screen.getByRole("button", { name: "Copy authenticator key" })
  );
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(enrollment.secret);
  expect(toast.success).not.toHaveBeenCalled();
  await act(async () => copy.resolve());
  expect(toast.success).toHaveBeenCalledWith("Secret key copied to clipboard");

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  submitCode();
  await screen.findByRole("heading", { name: "Save Backup Codes" });
  fireEvent.click(screen.getByRole("button", { name: "Copy All Codes" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "Backup codes copied to clipboard"
    )
  );
  expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
    enrollment.backupCodes.join("\n")
  );
});

it.each(["secret", "backup codes"])(
  "does not claim a successful copy of %s when the clipboard rejects it",
  async target => {
    openSetup();
    await beginSetup();
    if (target === "backup codes") {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      submitCode();
      await screen.findByRole("heading", { name: "Save Backup Codes" });
    }
    vi.mocked(toast.success).mockClear();
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error("Clipboard permission denied")
    );
    const copy = screen.getByRole("button", {
      name: target === "secret" ? "Copy authenticator key" : "Copy All Codes",
    });
    fireEvent.click(copy);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Failed to copy")
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(copy.querySelector(".lucide-check")).toBeNull();

    fireEvent.click(copy);
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(copy.querySelector(".lucide-check")).toBeInTheDocument();
  }
);

it("downloads a text file with all recovery codes and releases its temporary URL", async () => {
  openSetup();
  await reachBackupCodes();
  const create = vi.fn<(blob: Blob | MediaSource) => string>(
    () => "blob:fixture-mfa-backups"
  );
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    }
  );
  let clicked: HTMLAnchorElement | undefined;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    clicked = this;
    expect(this).toBeInTheDocument();
  });

  fireEvent.click(screen.getByRole("button", { name: "Download as Text" }));

  expect(create).toHaveBeenCalledTimes(1);
  const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
  expect(blob.type).toBe("text/plain");
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
  expect(text).toContain("AIS Aviation - MFA Backup Codes");
  expect(text).toMatch(/Generated: \d{4}-\d{2}-\d{2}T/);
  enrollment.backupCodes.forEach((code, index) => {
    expect(text).toContain(`${index + 1}. ${code}`);
  });
  expect(text).not.toContain(enrollment.secret);
  expect(text).not.toContain(enrollment.qrCodeUrl);
  expect(clicked).toHaveAttribute("download", "ais-aviation-backup-codes.txt");
  expect(clicked).toHaveAttribute("href", "blob:fixture-mfa-backups");
  expect(clicked).not.toBeInTheDocument();
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:fixture-mfa-backups");
});

it.each(["success", "failure"])(
  "discards a canceled setup %s without encoding a secret or announcing an error",
  async result => {
    const setup = deferred<typeof enrollment>();
    const fixture = openAccount({ "mfa.setup": () => setup.promise });
    await openEnrollment();
    fireEvent.click(
      screen.getByRole("button", { name: "Set Up Two-Factor Authentication" })
    );
    await waitFor(() =>
      expect(fixture.requests.filter(r => r.path === "mfa.setup")).toHaveLength(
        1
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByRole("button", { name: "Open authenticator setup" });
    await act(async () => {
      if (result === "success") setup.resolve(enrollment);
      else setup.reject(new Error("Canceled setup failed"));
    });
    await waitFor(() =>
      expect(fixture.cache.getMutationCache().getAll()).toHaveLength(0)
    );
    expect(encodeQr).not.toHaveBeenCalled();
    expect(screen.queryByText(formattedSecret)).toBeNull();
    await openEnrollment();
    expect(screen.queryByRole("img", { name: "Scan QR Code" })).toBeNull();
    expect(screen.queryByText(formattedSecret)).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  }
);

it("does not revive a canceled enrollment when QR encoding completes later", async () => {
  const qr = deferred<string>();
  encodeQr.mockReturnValueOnce(qr.promise);
  const fixture = openAccount();
  await openEnrollment();
  fireEvent.click(
    screen.getByRole("button", { name: "Set Up Two-Factor Authentication" })
  );
  await waitFor(() => expect(encodeQr).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await openEnrollment();
  await act(async () => qr.resolve(qrImage));
  await waitFor(() =>
    expect(fixture.cache.getMutationCache().getAll()).toHaveLength(0)
  );
  expect(screen.queryByText(formattedSecret)).toBeNull();
  expect(screen.queryByRole("img", { name: "Scan QR Code" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Set Up Two-Factor Authentication" })
  ).toBeEnabled();
});

it.each(["success", "failure"])(
  "does not announce a previous user's late verification %s after an account switch",
  async result => {
    const verify = deferred<{ success: boolean }>();
    const fixture = openAccount({ "mfa.verify": () => verify.promise });
    await openEnrollment();
    await beginSetup();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    submitCode();
    await waitFor(() =>
      expect(
        fixture.requests.filter(r => r.path === "mfa.verify")
      ).toHaveLength(1)
    );
    fixture.switchAccount();
    await screen.findByRole("button", { name: "Open authenticator setup" });
    await act(async () => {
      if (result === "success") verify.resolve({ success: true });
      else verify.reject(new Error("Invalid previous account token"));
    });
    await waitFor(() =>
      expect(fixture.cache.getMutationCache().getAll()).toHaveLength(0)
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    await openEnrollment();
    for (const code of enrollment.backupCodes) {
      expect(screen.queryByText(code)).toBeNull();
    }
    expect(screen.queryByText(formattedSecret)).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Save Backup Codes" })
    ).toBeNull();
  }
);

it.each(["success", "failure"])(
  "does not announce a late clipboard %s after cancellation",
  async result => {
    const copy = deferred<void>();
    vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(copy.promise);
    openAccount();
    await openEnrollment();
    await beginSetup();
    fireEvent.click(
      screen.getByRole("button", { name: "Copy authenticator key" })
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByRole("button", { name: "Open authenticator setup" });
    await act(async () => {
      if (result === "success") copy.resolve();
      else copy.reject(new Error("Clipboard permission denied"));
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByText(formattedSecret)).toBeNull();
  }
);

it.each(["Done", "account switch"])(
  "clears visible backup codes and enrollment mutations after %s",
  async action => {
    let enabled = false;
    const fixture = openAccount({
      "mfa.getStatus": () => ({ enabled }),
      "mfa.verify": () => {
        enabled = true;
        return { success: true };
      },
    });
    await openEnrollment();
    await reachBackupCodes();
    if (action === "Done") {
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      await screen.findByText("Two-factor authentication is enabled");
    } else {
      enabled = false;
      fixture.switchAccount();
      await openEnrollment();
    }
    for (const code of enrollment.backupCodes) {
      expect(screen.queryByText(code)).toBeNull();
    }
    expect(screen.queryByText(formattedSecret)).toBeNull();
    await waitFor(() =>
      expect(fixture.cache.getMutationCache().getAll()).toHaveLength(0)
    );
  }
);

it.each(["success", "failure"])(
  "ignores late backup clipboard %s after the account panel closes enrollment",
  async result => {
    const copy = deferred<void>();
    openAccount();
    await openEnrollment();
    await reachBackupCodes();
    vi.mocked(toast.success).mockClear();
    vi.mocked(navigator.clipboard.writeText).mockReturnValueOnce(copy.promise);
    fireEvent.click(screen.getByRole("button", { name: "Copy All Codes" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      enrollment.backupCodes.join("\n")
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await screen.findByRole("button", { name: "Open authenticator setup" });
    await act(async () => {
      if (result === "success") copy.resolve();
      else copy.reject(new Error("Clipboard permission denied"));
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    for (const code of enrollment.backupCodes) {
      expect(screen.queryByText(code)).toBeNull();
    }
  }
);
