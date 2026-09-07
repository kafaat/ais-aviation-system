import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const authConfig = readFileSync(
  resolve(repoRoot, "auth-service/config.py"),
  "utf8"
);
const compose = readFileSync(
  resolve(repoRoot, "docker-compose.yml"),
  "utf8"
);

const insecurePlaceholder =
  "your-super-secret-jwt-key-change-this-in-production";

describe("auth-service JWT signing secret contract", () => {
  it("has no usable JWT secret default in the auth service", () => {
    expect(authConfig).toContain("JWT_SECRET: str\n");
    expect(authConfig).not.toContain(
      `JWT_SECRET: str = "${insecurePlaceholder}"`
    );
  });

  it("rejects short and known placeholder secrets", () => {
    expect(authConfig).toContain("len(secret) < 32");
    expect(authConfig).toContain("secret in INSECURE_JWT_SECRETS");
    expect(authConfig).toContain(insecurePlaceholder);
  });

  it("makes development compose require an explicit JWT secret", () => {
    expect(compose).toContain(
      "JWT_SECRET: ${JWT_SECRET:?JWT_SECRET must be set to a strong unique value of at least 32 characters}"
    );
    expect(compose).not.toContain(`JWT_SECRET: ${insecurePlaceholder}`);
  });
});
