import { readFileSync } from "node:fs";
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  INTEGRATION_CONFIG_KEYS,
  integrationConfiguration,
  assertIntegrationConfiguration,
} from "../services/integration-config.service";
describe("provider configuration delivery", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("passes the same keys to every Compose API replica and worker and both Kubernetes deployments", () => {
    const compose = readFileSync("docker-compose.production.yml", "utf8");
    for (const key of INTEGRATION_CONFIG_KEYS)
      expect(compose.split(`- ${key}=`).length - 1, key).toBe(4);
    const workflow = readFileSync(".github/workflows/ci-cd.yml", "utf8");
    const secretTransport = readFileSync(
      "scripts/deploy/kubernetes_secrets.py",
      "utf8"
    );
    for (const key of INTEGRATION_CONFIG_KEYS) {
      expect(
        workflow.match(new RegExp(`^          ${key}:`, "gm"))?.length ?? 0,
        key
      ).toBe(2);
      expect(secretTransport, key).toContain(`"${key}"`);
    }
    expect(workflow).not.toContain("--from-literal");
    for (const file of ["k8s/base/deployment.yaml", "k8s/base/background.yaml"])
      expect(readFileSync(file, "utf8")).toContain("ais-secrets");
    // The alternative Compose deployment already shares its entire env_file.
    expect(
      readFileSync("docker-compose.prod.yml", "utf8").match(/- \.env.prod/g)
        ?.length
    ).toBeGreaterThanOrEqual(2);
  });
  it("defaults to disabled and refuses incomplete enabled configurations without exposing values", () => {
    for (const key of INTEGRATION_CONFIG_KEYS) vi.stubEnv(key, "");
    expect(
      integrationConfiguration().every(row => row.state === "disabled")
    ).toBe(true);
    vi.stubEnv("ONCALL_MODE", "live");
    vi.stubEnv("ONCALL_TOKEN", "synthetic-sensitive-value");
    expect(() => assertIntegrationConfiguration()).toThrow("oncall");
    expect(JSON.stringify(integrationConfiguration())).not.toContain(
      "synthetic-sensitive-value"
    );
  });
});
