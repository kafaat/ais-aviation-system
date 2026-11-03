import { afterAll, beforeAll, expect, it } from "vitest";
import express from "express";
import { request, type IncomingHttpHeaders, type Server } from "node:http";
import { createSecurityHeaders } from "./security-headers";

const servers: Server[] = [];
const ports: number[] = [];
beforeAll(async () => {
  for (const options of [
    { isDevelopment: false, embedAllowedOrigins: "" },
    {
      isDevelopment: false,
      embedAllowedOrigins:
        "https://www.airline.example,https://airline.example",
    },
    { isDevelopment: true, embedAllowedOrigins: "https://www.airline.example" },
  ]) {
    const app = express();
    app.use(createSecurityHeaders(options));
    app.all("*", (_req, res) =>
      res.type("html").send("<main>Header contract</main>")
    );
    const server = await new Promise<Server>((resolve, reject) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
      listening.once("error", reject);
    });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("HTTP listener unavailable");
    ports.push(address.port);
  }
});
afterAll(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }
});

function headers(index: number, path: string, method = "GET") {
  return new Promise<IncomingHttpHeaders>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: ports[index],
        path,
        method,
        headers: { Origin: "https://unlisted.example" },
      },
      res => {
        res.resume();
        res.once("end", () => resolve(res.headers));
      }
    );
    req.once("error", reject);
    req.end();
  });
}
const ancestors = (response: IncomingHttpHeaders) =>
  String(response["content-security-policy"])
    .split(";")
    .find(part => part.startsWith("frame-ancestors"));

it("keeps external framing disabled by default on the embed document", async () => {
  const response = await headers(0, "/embed/search");
  expect(response["x-frame-options"]).toBe("SAMEORIGIN");
  expect(ancestors(response)).toBe("frame-ancestors 'self'");
});

it.each(["GET", "HEAD"])(
  "permits only configured ancestors on the exact anonymous search document (%s)",
  async method => {
    const response = await headers(
      1,
      "/embed/search?parent=https://unlisted.example&tenant=9",
      method
    );
    expect(response["x-frame-options"]).toBeUndefined();
    expect(ancestors(response)).toBe(
      "frame-ancestors 'self' https://www.airline.example https://airline.example"
    );
    expect(response["content-security-policy"]).not.toContain("unlisted");
    expect(response["x-content-type-options"]).toBe("nosniff");
    expect(response["content-security-policy"]).toContain("form-action 'self'");
  }
);

it.each([
  "/",
  "/search",
  "/login",
  "/my-bookings",
  "/booking/42",
  "/checkout/700",
  "/manage-booking",
  "/embed/search/",
  "/embed//search",
  "//embed/search",
  "/%65mbed/search",
  "/embed%2fsearch",
  "/embed/search/../my-bookings",
  "/embed/search%2f..%2fmy-bookings",
])(
  "does not relax framing for account pages or alternate paths: %s",
  async path => {
    const response = await headers(1, path);
    expect(response["x-frame-options"]).toBe("SAMEORIGIN");
    expect(ancestors(response)).toBe("frame-ancestors 'self'");
  }
);

it("does not apply the public framing exception to writes", async () => {
  const response = await headers(1, "/embed/search", "POST");
  expect(response["x-frame-options"]).toBe("SAMEORIGIN");
  expect(ancestors(response)).toBe("frame-ancestors 'self'");
});

it("enforces the ancestor allowlist even when Vite development CSP is otherwise disabled", async () => {
  const response = await headers(2, "/embed/search");
  expect(response["x-frame-options"]).toBeUndefined();
  expect(ancestors(response)).toBe(
    "frame-ancestors 'self' https://www.airline.example"
  );
  expect((await headers(2, "/my-bookings"))["x-frame-options"]).toBe(
    "SAMEORIGIN"
  );
});

it("rejects malformed configuration before exposing a middleware", () => {
  expect(() =>
    createSecurityHeaders({
      embedAllowedOrigins: "https://valid.example,https://*.invalid.example",
    })
  ).toThrow("explicit HTTPS origins");
});
