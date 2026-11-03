import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createSecurityHeaders } from "../_core/middleware/security-headers";
import {
  publicIbeConfiguration,
  videcomBaseUrl,
} from "../services/ibe-public-config.service";
import { createVidecomRouter } from "./videcom";

const provider = "https://customer.example";
const env = {
  VIDECOM_IBE_BASE_URL: provider + "/airline",
  IBE_BRAND_NAME: "Air <demo>",
  IBE_BRAND_LOGO_PATH: "/logo.png",
  VIDECOM_BRAND_COLOR: "#012abc",
};

async function start(settings: NodeJS.ProcessEnv) {
  const app = express();
  app.use(
    createSecurityHeaders({ isDevelopment: false, embedAllowedOrigins: "" })
  );
  app.use(createVidecomRouter(settings));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  return { server, origin };
}
let active: Awaited<ReturnType<typeof start>>;
let inactive: typeof active;
beforeAll(async () => {
  active = await start(env);
  inactive = await start({});
});
afterAll(async () => {
  for (const { server } of [active, inactive]) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }
});

it.each([
  "http://customer.example",
  "https://*.example",
  "https://a.example,https://b.example",
  "https://a.example,b.example",
  "https://user:secret@customer.example",
  "https://customer.example/p?x=1",
  "https://customer.example/p#x",
  "https://customer.example/../other",
  "https://customer.example/p%2fother",
  "https://customer.example//other",
  "https://customer.example\\@bad.example",
  "https://customer.example\n",
  "https://customer.example/MMBLoginbs.aspx",
])("rejects an ambiguous or untrusted base %j", raw =>
  expect(() => videcomBaseUrl(raw)).toThrow()
);

it("accepts a dedicated HTTPS origin and preserves a shared-host airline prefix", () => {
  expect(videcomBaseUrl(provider)?.href).toBe(provider + "/");
  expect(videcomBaseUrl(provider + "/airline/")?.href).toBe(
    provider + "/airline/"
  );
  expect(publicIbeConfiguration(env).videcomEnabled).toBe(true);
  expect(() =>
    createVidecomRouter({ ...env, VIDECOM_BRAND_COLOR: "red;display:none" })
  ).toThrow();
});

it("shows the three assigned endpoints and permits only display preferences on search", async () => {
  const res = await fetch(
    active.origin +
      "/videcom?lang=en&country=US&currency=usd&returnTo=https://evil.invalid&surname=private"
  );
  const html = await res.text();
  const panels = provider + "/airline/VARS/Public/CustomerPanels/";
  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(res.headers.get("content-security-policy")).toContain(
    "frame-ancestors 'none'"
  );
  expect(res.headers.get("content-security-policy")).toContain(
    "frame-src " + provider
  );
  expect(html).toContain(
    panels + "requirementsBS.aspx?country=us&amp;currency=USD"
  );
  expect(html).toContain(panels + 'MMBLoginbs.aspx"');
  expect(html).toContain(panels + 'AgentLoginBS.aspx"');
  expect(html).toContain(
    "<title>Air &lt;demo&gt; · Airline reservations</title>"
  );
  expect(html).not.toMatch(/private|evil\.invalid|<script|<form/);
  const bad = await (
    await fetch(
      active.origin + "/videcom?country=US&country=DE&currency=invalid"
    )
  ).text();
  expect(bad).toContain(panels + 'requirementsBS.aspx"');
});
it.each(["header", "footer"])(
  "limits the %s fragment to the assigned provider and AIS",
  async fragment => {
    const path = "/videcom/brand/" + fragment;
    const res = await fetch(active.origin + path);
    expect(res.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'self' " + provider
    );
    expect(res.headers.get("x-frame-options")).toBeNull();
    const html = await res.text();
    expect(html).toContain("<" + fragment + ">");
    expect(html).toContain("#012abc");
    expect(html).not.toMatch(/<iframe|<script|<form/);
    for (const suffix of ["/", "-other"]) {
      const invalid = await fetch(active.origin + path + suffix);
      expect(invalid.status).toBe(404);
      expect(invalid.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    }
    expect((await fetch(active.origin + path, { method: "POST" })).status).toBe(
      405
    );
  }
);
it.each(["/videcom", "/videcom/brand/header", "/videcom/brand/footer"])(
  "fails closed without configuration on %s",
  async path => {
    const res = await fetch(inactive.origin + path);
    expect(res.status).toBe(404);
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("content-security-policy")).not.toContain(provider);
  }
);
