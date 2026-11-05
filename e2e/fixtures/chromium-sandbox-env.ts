import { lstatSync } from "node:fs";

/** Reuse the runner's installed sandbox; never install a privileged binary. */
export function chromiumSandboxEnv(
  source: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) environment[key] = value;
  }
  if (
    platform !== "linux" ||
    source.GITHUB_ACTIONS !== "true" ||
    source.RUNNER_ENVIRONMENT !== "github-hosted"
  ) {
    return environment;
  }

  // Ubuntu restricts user namespaces for downloaded Playwright executables.
  // Chromium documents its installed SUID helper as the alternative that does
  // not disable AppArmor or Chromium's sandbox. Limit this to hosted Linux CI.
  // https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md
  const helper =
    source.CHROME_DEVEL_SANDBOX ?? "/opt/google/chrome/chrome-sandbox";
  if (!helper.startsWith("/")) {
    throw new Error("Chromium sandbox helper must be an absolute path");
  }
  const metadata = lstatSync(helper);
  if (
    !metadata.isFile() ||
    metadata.uid !== 0 ||
    (metadata.mode & 0o4000) === 0 ||
    (metadata.mode & 0o001) === 0 ||
    (metadata.mode & 0o022) !== 0
  ) {
    throw new Error("Chromium sandbox helper has unsafe ownership or mode");
  }
  environment.CHROME_DEVEL_SANDBOX = helper;
  return environment;
}
