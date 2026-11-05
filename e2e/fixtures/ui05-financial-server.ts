import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { disposableDatabaseUrl } from "../disposable-database";
import {
  startUi05StripeProvider,
  UI05_STRIPE_KEY,
  UI05_WEBHOOK_SECRET,
} from "./ui05-stripe-provider";

disposableDatabaseUrl();
const descriptor = process.env.AIS_UI05_PROVIDER_FILE;
assert(descriptor, "Dedicated UI-05 Playwright configuration is required");
const provider = await startUi05StripeProvider(
  process.env.E2E_BASE_URL || "http://localhost:3000"
);
// Set the normal production transport boundary before importing any app code.
// No tRPC route, provider method, transaction, receipt or ledger is substituted.
process.env.AIS_PROVIDER_BOUNDARY = "isolated";
process.env.STRIPE_SECRET_KEY = UI05_STRIPE_KEY;
process.env.STRIPE_WEBHOOK_SECRET = UI05_WEBHOOK_SECRET;
process.env.STRIPE_MOCK_HOST = provider.origin;
process.env.FRONTEND_URL = process.env.E2E_BASE_URL || "http://localhost:3000";
await writeFile(descriptor, JSON.stringify({ origin: provider.origin }), {
  mode: 0o600,
});
process.once("exit", () => rmSync(descriptor, { force: true }));
try {
  await import(pathToFileURL(resolve("dist/index.js")).href);
} catch (error) {
  await provider.close();
  throw error;
}
