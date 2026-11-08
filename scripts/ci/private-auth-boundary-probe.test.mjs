import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  privateOrigin,
  usableToken,
  runProbe,
} from "../acceptance/private-auth-boundary-probe.mjs";

const token = "private-auth-acceptance-fixture-unique-2026";
const sha = "a".repeat(40);
const records = [];
let broken = false;
let redirect = false;
const server = createServer(async (request, response) => {
  let content = "";
  for await (const chunk of request) content += chunk.toString();
  const presented = request.headers["x-auth-service-token"];
  if (request.method !== "GET") records.push([request.url, presented]);
  if (redirect && request.url === "/auth/login") {
    response.writeHead(302, { Location: "https://example.org/auth-redirect" });
    response.end();
    return;
  }
  let status, data;
  if (request.url === "/auth/health") {
    status = 200;
    data = { status: "healthy" };
  } else if (presented !== token && !broken) {
    status = 401;
    data = { detail: "Service credential required." };
  } else if (request.url === "/auth/login") {
    status = 401;
    data = { detail: "Invalid email or password." };
  } else if (request.url === "/auth/verify-password") {
    status = 200;
    data = { success: false };
  } else {
    status = 200;
    data = { success: true };
  }
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(data));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const env = {
  AIS_AUTH_PRIVATE_PROBE: "1",
  AUTH_SERVICE_URL: `http://127.0.0.1:${server.address().port}`,
  AUTH_SERVICE_TOKEN: token,
  AIS_EXPECTED_SOURCE_SHA: sha,
  RAILWAY_GIT_COMMIT_SHA: sha,
};

test("refuses public, credential-bearing or path-extended URL", () => {
  for (const url of [
    "https://example.org",
    "http://10.0.0.4:8000",
    "https://ais-auth.up.railway.app",
    "http://stripe-mock.railway.internal:8000",
    "http://local:pass@ais-auth:8000",
    "http://127.0.0.1:8000/admin",
  ])
    assert.throws(() => privateOrigin(url));
  assert.equal(
    privateOrigin("http://ais-auth.railway.internal:8000"),
    "http://ais-auth.railway.internal:8000"
  );
});

test("rejects absent, trivial and non-ASCII tokens", () => {
  for (const candidate of ["", "CHANGE_ME", "x".repeat(32), "é".repeat(40)])
    assert.equal(usableToken(candidate), false);
  assert.equal(usableToken(token), true);
});

test("blocks before HTTP when opt-in or deployed SHA is missing", async () => {
  await assert.rejects(runProbe({ ...env, AIS_AUTH_PRIVATE_PROBE: "0" }));
  await assert.rejects(
    runProbe({ ...env, RAILWAY_GIT_COMMIT_SHA: "b".repeat(40) })
  );
  assert.equal(records.length, 0);
});

test("real loopback HTTP checks all six denials and two credentialed paths", async () => {
  records.length = 0;
  broken = false;
  const receipt = await runProbe(env);
  assert.equal(receipt.status, "PASS");
  assert.equal(receipt.passed, 9);
  assert.equal(records.length, 8);
  assert.equal(records.filter(r => r[1] === token).length, 2);
  assert.equal(records.filter(r => r[1] === undefined).length, 3);
  assert.equal(JSON.stringify(receipt).includes(token), false);
  assert.equal(JSON.stringify(receipt).includes(env.AUTH_SERVICE_URL), false);
});

test("fails when wrong credentials are accepted", async () => {
  broken = true;
  const receipt = await runProbe(env);
  broken = false;
  assert.equal(receipt.status, "FAIL");
  assert.ok(receipt.passed < 9);
  assert.equal(JSON.stringify(receipt).includes(token), false);
});

test("never follows auth-service redirects to another origin", async () => {
  redirect = true;
  const receipt = await runProbe(env);
  redirect = false;
  assert.equal(receipt.status, "FAIL");
  assert.ok(
    receipt.checks.some(c => c.name === "private_transport_or_protocol")
  );
  assert.equal(JSON.stringify(receipt).includes(token), false);
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
});
