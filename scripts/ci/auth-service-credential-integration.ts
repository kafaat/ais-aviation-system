/**
 * Node -> FastAPI integration through the real auth-service client.
 *
 * Run with AUTH_SERVICE_URL pointing at a live auth service. With the
 * credential the service was started with, register, login and verification
 * must succeed through `authServiceClient`. With `--expect-denied` (and a
 * different AUTH_SERVICE_TOKEN), every call must come back `success: false`
 * and the generic message, proving the client surfaces the service's refusal
 * without falling back. Exit status is non-zero on any deviation.
 */
import { randomBytes } from "node:crypto";

const expectDenied = process.argv.includes("--expect-denied");
if (!process.env.AUTH_SERVICE_TOKEN) {
  console.error("AUTH_SERVICE_TOKEN must be set");
  process.exit(2);
}

const { authServiceClient } =
  await import("../../server/services/auth-service.client");

// example.com is accepted by the service's e-mail validator; .test is not.
const email = `node-integration-${randomBytes(6).toString("hex")}@example.com`;
const password = "NodeIntegrationFixture123!";
const failures: string[] = [];

const results = {
  register: await authServiceClient.register(email, password, "Node probe"),
  login: await authServiceClient.login(email, password),
  verify: await authServiceClient.verifyPassword(email, password),
  wrongPassword: await authServiceClient.verifyPassword(
    email,
    `wrong-${password}`
  ),
};

if (expectDenied) {
  // The service answers 401 {"detail": ...}; the client maps any HTTP error
  // without a structured success=false body to the generic unavailable message.
  for (const [op, result] of Object.entries(results)) {
    if (result.success || result.message !== "Auth service unavailable")
      failures.push(
        `${op}: a refused credential must yield success=false with the generic message, got ${JSON.stringify(result)}`
      );
    if (JSON.stringify(result).includes(email))
      failures.push(`${op}: refusal leaked the probed e-mail`);
  }
} else {
  for (const op of ["register", "login", "verify"] as const) {
    const result = results[op];
    if (!result.success || result.user?.email !== email)
      failures.push(
        `${op}: expected success for ${email}, got ${JSON.stringify(result)}`
      );
  }
  if (results.wrongPassword.success)
    failures.push("verify with a wrong password must not succeed");
}

console.info(
  JSON.stringify({
    passed: failures.length === 0,
    mode: expectDenied ? "wrong-credential" : "correct-credential",
    operations: Object.keys(results),
    failures,
  })
);
process.exit(failures.length ? 1 : 0);
