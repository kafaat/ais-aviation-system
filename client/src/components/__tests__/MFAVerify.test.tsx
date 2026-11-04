import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeAll, expect, it, vi } from "vitest";
import { MFAVerify } from "../MFAVerify";
import i18n from "@/i18n/config";
import { createTrpcFixture, deferred } from "@/test/trpc-fixture";

const challengeToken = "synthetic-password-step-challenge";
beforeAll(async () => {
  await i18n.changeLanguage("en");
});

function openVerify(reply: (input: unknown) => unknown | Promise<unknown>) {
  const fixture = createTrpcFixture({ "auth.completeMfa": reply });
  const verified = vi.fn();
  const back = vi.fn();
  render(
    <fixture.Wrapper>
      <MFAVerify
        challengeToken={challengeToken}
        onVerified={verified}
        onBack={back}
      />
    </fixture.Wrapper>
  );
  return { ...fixture, verified, back };
}

it("normalizes and submits the backup code for this challenge and waits for server success", async () => {
  const response = deferred<{ success: boolean }>();
  const { requests, verified } = openVerify(() => response.promise);
  fireEvent.click(screen.getByRole("button", { name: "Use a backup code" }));
  const input = screen.getByLabelText("Backup Code");
  const submit = screen.getByRole("button", { name: "Verify Backup Code" });
  fireEvent.change(input, { target: { value: "A!B12" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(submit).toBeDisabled();
  expect(requests).toHaveLength(0);
  fireEvent.change(input, { target: { value: "AB12-cd34" } });
  expect(input).toHaveValue("ab12cd34");
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toEqual({
    path: "auth.completeMfa",
    input: { challengeToken, code: "ab12cd34" },
  });
  expect(input).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Use authenticator app" })
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  expect(verified).not.toHaveBeenCalled();
  await act(async () => response.resolve({ success: true }));
  await waitFor(() => expect(verified).toHaveBeenCalledTimes(1));
});

it("clears a rejected TOTP, restores focus and accepts a corrected code only after a new response", async () => {
  let valid = false;
  const rejected = deferred<never>();
  const { requests, verified } = openVerify(() => {
    if (!valid) return rejected.promise;
    return { success: true };
  });
  const input = screen.getByLabelText("Verification Code");
  await waitFor(() => expect(input).toHaveFocus());
  fireEvent.change(input, { target: { value: "12a3456" } });
  await waitFor(() => expect(input).toBeDisabled());
  input.blur();
  await act(async () => {
    rejected.reject(
      Object.assign(new Error("Code rejected by server"), {
        code: "UNAUTHORIZED",
      })
    );
  });
  await screen.findByText("Code rejected by server");
  expect(input).toHaveValue("");
  expect(input).toHaveFocus();
  expect(verified).not.toHaveBeenCalled();
  valid = true;
  fireEvent.change(input, { target: { value: "654321" } });
  await waitFor(() => expect(verified).toHaveBeenCalledTimes(1));
  expect(requests.map(request => request.input)).toEqual([
    { challengeToken, code: "123456" },
    { challengeToken, code: "654321" },
  ]);
  expect(screen.queryByText("Code rejected by server")).not.toBeInTheDocument();
});

it("clears a consumed backup code, keeps the challenge and removes stale errors when switching methods", async () => {
  const rejected = deferred<never>();
  const { verified, back, requests } = openVerify(() => rejected.promise);
  fireEvent.click(screen.getByRole("button", { name: "Use a backup code" }));
  const backup = screen.getByLabelText("Backup Code");
  await waitFor(() => expect(backup).toHaveFocus());
  fireEvent.change(backup, { target: { value: "abcdefgh" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify Backup Code" }));
  await waitFor(() => expect(backup).toBeDisabled());
  backup.blur();
  await act(async () => {
    rejected.reject(
      Object.assign(new Error("Backup code already used"), {
        code: "UNAUTHORIZED",
      })
    );
  });
  await screen.findByText("Backup code already used");
  expect(backup).toHaveValue("");
  expect(backup).toHaveFocus();
  expect(verified).not.toHaveBeenCalled();
  expect(requests).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Use authenticator app" })
  );
  expect(screen.getByLabelText("Verification Code")).toHaveValue("");
  expect(
    screen.queryByText("Backup code already used")
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(back).toHaveBeenCalledTimes(1);
  expect(verified).not.toHaveBeenCalled();
});

it("preserves the pending TOTP request across disabled navigation and sends it once", async () => {
  const response = deferred<{ success: boolean }>();
  const { verified, back, requests } = openVerify(() => response.promise);
  fireEvent.change(screen.getByLabelText("Verification Code"), {
    target: { value: "234567" },
  });
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(screen.getByLabelText("Verification Code")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Use a backup code" }));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.queryByLabelText("Backup Code")).not.toBeInTheDocument();
  expect(back).not.toHaveBeenCalled();
  expect(verified).not.toHaveBeenCalled();
  await act(async () => response.resolve({ success: true }));
  await waitFor(() => expect(verified).toHaveBeenCalledTimes(1));
  expect(requests).toHaveLength(1);
});
