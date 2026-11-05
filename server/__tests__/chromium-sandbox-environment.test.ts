import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ stat: vi.fn() }));
vi.mock("node:fs", () => ({ lstatSync: boundary.stat }));

import { chromiumSandboxEnv } from "../../e2e/fixtures/chromium-sandbox-env";

const hosted = {
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
};
const standard = "/opt/google/chrome/chrome-sandbox";

beforeEach(() => {
  boundary.stat.mockReset().mockReturnValue({
    isFile: () => true,
    uid: 0,
    mode: 0o104755,
  });
});

describe("hosted Chromium sandbox environment", () => {
  it("uses the installed helper without mutating the caller", () => {
    const source = { ...hosted, PATH: "/usr/bin", UNUSED: undefined };
    const result = chromiumSandboxEnv(source, "linux");
    expect(result).toEqual({
      ...hosted,
      PATH: "/usr/bin",
      CHROME_DEVEL_SANDBOX: standard,
    });
    expect(source).not.toHaveProperty("CHROME_DEVEL_SANDBOX");
    expect(boundary.stat).toHaveBeenCalledTimes(1);
    expect(boundary.stat).toHaveBeenCalledWith(standard);
  });

  it.each(["darwin", "win32"] as const)(
    "leaves %s browser environment unchanged",
    platform => {
      expect(chromiumSandboxEnv(hosted, platform)).toEqual(hosted);
      expect(boundary.stat).not.toHaveBeenCalled();
    }
  );

  it.each([
    {},
    { GITHUB_ACTIONS: "false", RUNNER_ENVIRONMENT: "github-hosted" },
    { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "self-hosted" },
    { GITHUB_ACTIONS: "true" },
  ])("does not reconfigure non-hosted execution: %j", environment => {
    expect(chromiumSandboxEnv(environment, "linux")).toEqual(environment);
    expect(boundary.stat).not.toHaveBeenCalled();
  });

  it("retains an explicitly selected helper after validating it", () => {
    const custom = "/usr/local/sbin/chrome-devel-sandbox";
    const source = { ...hosted, CHROME_DEVEL_SANDBOX: custom };
    expect(chromiumSandboxEnv(source, "linux")).toEqual(source);
    expect(boundary.stat).toHaveBeenCalledTimes(1);
    expect(boundary.stat).toHaveBeenCalledWith(custom);
  });

  it.each(["", "relative-helper"])("rejects helper path %j", helper => {
    expect(() =>
      chromiumSandboxEnv({ ...hosted, CHROME_DEVEL_SANDBOX: helper }, "linux")
    ).toThrow("absolute path");
    expect(boundary.stat).not.toHaveBeenCalled();
  });

  it.each([
    { uid: 1001, mode: 0o104755, regular: true },
    { uid: 0, mode: 0o100755, regular: true },
    { uid: 0, mode: 0o104754, regular: true },
    { uid: 0, mode: 0o104775, regular: true },
    { uid: 0, mode: 0o104757, regular: true },
    { uid: 0, mode: 0o104755, regular: false },
  ])("rejects unsafe helper metadata %j", ({ uid, mode, regular }) => {
    boundary.stat.mockReturnValue({ isFile: () => regular, uid, mode });
    expect(() => chromiumSandboxEnv(hosted, "linux")).toThrow(
      "unsafe ownership or mode"
    );
  });

  it("does not hide a missing or unreadable helper", () => {
    boundary.stat.mockImplementation(() => {
      throw new Error("fixture helper unavailable");
    });
    expect(() => chromiumSandboxEnv(hosted, "linux")).toThrow(
      "fixture helper unavailable"
    );
  });
});
