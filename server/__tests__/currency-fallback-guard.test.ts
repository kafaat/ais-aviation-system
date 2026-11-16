import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeRates } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import * as relational from "./helpers/authority-relational-fixture";

/**
 * #319 Wave 1 fallback guard: the hard-coded FALLBACK_RATES may label an
 * estimate (a quote whose source says "fallback"); they never produce an
 * amount, and no pricing-engine, quote, checkout, order-servicing,
 * settlement or refund module can reach them.
 */
const boundary = vi.hoisted(() => ({
  db: null as unknown,
  cache: new Map<string, string>(),
}));
const engine = vi.hoisted(() => ({
  calculateDynamicPrice: vi.fn(),
  getPriceRange: vi.fn(),
  getPriceForecast: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
vi.mock("../services/cache.service", () => ({
  cacheService: {
    isConnected: () => false,
    checkRateLimit: async () => ({ allowed: true, remaining: 1 }),
    async get(key: string) {
      const text = boundary.cache.get(key);
      return text ? JSON.parse(text) : null;
    },
    async set(key: string, value: unknown) {
      boundary.cache.set(key, JSON.stringify(value));
    },
    async del(key: string) {
      return Number(boundary.cache.delete(key));
    },
  },
}));
vi.mock("../services/pricing/dynamic-pricing.service", () => ({
  DynamicPricingService: engine,
}));

import * as currency from "../services/currency/currency.service";

const CURRENCY_SERVICE = "server/services/currency/currency.service.ts";
type PricingCaller = ReturnType<
  (typeof import("../routers/pricing.router"))["pricingRouter"]["createCaller"]
>;

/** Modules that price, quote, check out, service, settle or refund money. */
const MONEY_PATHS = [
  // pricing engine and binding quotes
  "server/services/pricing/dynamic-pricing.service.ts",
  "server/services/dynamic-pricing.service.ts",
  "server/services/price-quote.service.ts",
  "server/services/price-lock.service.ts",
  "server/services/fare-components.service.ts",
  "server/services/retail-offer.service.ts",
  "server/routers/price-quote.ts",
  // checkout and collection
  "server/services/booking-checkout.service.ts",
  "server/services/booking-invoice.service.ts",
  "server/services/payments.service.ts",
  "server/services/split-checkout.service.ts",
  "server/services/order-service-checkout.service.ts",
  "server/services/ndc-unpaid.service.ts",
  "server/services/payment-providers/index.ts",
  "server/routers/payments.ts",
  "server/routers/bookings.ts",
  "server/routers/split-payments.ts",
  // order servicing
  "server/services/order-servicing.service.ts",
  "server/services/booking-modification.service.ts",
  "server/routers/modifications.ts",
  "server/routers/ndc.ts",
  // settlement and ledger
  "server/services/payment-settlement.service.ts",
  "server/services/booking-settlement.service.ts",
  "server/services/stripe/stripe-reconciliation.service.ts",
  "server/services/corporate-settlement.service.ts",
  "server/services/bsp-settlement.service.ts",
  "server/services/financial-reporting.service.ts",
  "server/services/wallet.service.ts",
  "server/webhooks/stripe.ts",
  // refunds
  "server/services/refunds.service.ts",
  "server/services/internal-refund.service.ts",
  "server/services/ordinary-refund.service.ts",
  "server/services/order-refunds.service.ts",
  "server/services/split-refund.service.ts",
  "server/routers/refunds.ts",
  "server/routers/wallet.ts",
];

/** Static runtime import graph (type-only imports excluded), as the service
 * catalog builds it: static, re-export and dynamic imports inside the repo. */
function importGraph() {
  const root = process.cwd();
  const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const edges = new Map<string, string[]>();
  const dependencies = (file: string): string[] => {
    const known = edges.get(file);
    if (known) return known;
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
    const found: string[] = [];
    const visit = (node: ts.Node) => {
      let spec: string | undefined;
      if (
        ts.isImportDeclaration(node) &&
        !node.importClause?.isTypeOnly &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        spec = node.moduleSpecifier.text;
      if (
        ts.isExportDeclaration(node) &&
        !node.isTypeOnly &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        spec = node.moduleSpecifier.text;
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        spec = node.arguments[0].text;
      if (spec) {
        const target = ts.resolveModuleName(spec, file, parsed.options, ts.sys)
          .resolvedModule?.resolvedFileName;
        if (
          target &&
          !target.includes("node_modules") &&
          !target.endsWith(".d.ts")
        )
          found.push(resolve(target));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    edges.set(file, found);
    return found;
  };
  /** The import chain from entry to target, or null when unreachable. */
  return (entry: string, target: string): string[] | null => {
    const start = resolve(entry);
    const goal = resolve(target);
    const previous = new Map<string, string | null>([[start, null]]);
    const queue = [start];
    while (queue.length) {
      const file = queue.shift()!;
      if (file === goal) {
        const chain: string[] = [];
        for (let at: string | null = file; at; at = previous.get(at) ?? null)
          chain.unshift(relative(root, at));
        return chain;
      }
      for (const next of dependencies(file))
        if (!previous.has(next)) {
          previous.set(next, file);
          queue.push(next);
        }
    }
    return null;
  };
}

describe("currency fallback guard", () => {
  let fixture: ReturnType<typeof relational.authorityRelationalFixture>;

  beforeEach(() => {
    boundary.cache.clear();
    engine.calculateDynamicPrice.mockReset();
    engine.getPriceRange.mockReset();
    engine.getPriceForecast.mockReset();
    fixture = relational.authorityRelationalFixture([exchangeRates]);
    boundary.db = fixture.db;
  });

  afterEach(() => {
    boundary.db = null;
    fixture.close();
  });

  it("keeps every money path outside the currency module's import graph", () => {
    const chainTo = importGraph();
    const reaching = MONEY_PATHS.map(entry => {
      expect(existsSync(entry), entry).toBe(true);
      return chainTo(entry, CURRENCY_SERVICE);
    }).filter(chain => chain !== null);
    expect(reaching).toEqual([]);
    // The graph is live: the display and pricing routers do reach it.
    expect(chainTo("server/routers/ibe-public.ts", CURRENCY_SERVICE)).toEqual([
      "server/routers/ibe-public.ts",
      CURRENCY_SERVICE,
    ]);
  });

  it("fix: exposes no fallback constant and no stub that writes or caches them", () => {
    expect(Object.keys(currency)).not.toContain("FALLBACK_RATES");
    expect(Object.keys(currency)).not.toContain("updateExchangeRates");
    expect(Object.keys(currency.CurrencyService)).not.toContain(
      "updateExchangeRates"
    );
  });

  it.each([
    ["no observation", () => undefined],
    [
      "a failed rate query",
      () =>
        fixture.sqlite.exec(
          "ALTER TABLE exchange_rates RENAME TO unavailable_exchange_rates"
        ),
    ],
  ])(
    "fix: converts no amount from a fallback constant after %s",
    async (_case, arrange) => {
      arrange();
      for (const [from, to] of [
        ["SAR", "USD"],
        ["USD", "SAR"],
        ["USD", "AED"],
      ])
        await expect(currency.convertCurrency(100, from, to)).rejects.toThrow(
          currency.ExchangeRateUnavailableError
        );
      await expect(currency.convertPriceForDisplay(100, "USD")).rejects.toThrow(
        currency.ExchangeRateUnavailableError
      );
      // The constants still label an estimate, and only as such.
      expect(await currency.getExchangeRate("SAR", "USD")).toMatchObject({
        rate: 0.2666,
        source: "fallback",
      });
      expect(await currency.getExchangeRate("USD", "AED")).toMatchObject({
        source: "cross_rate_fallback",
      });
      expect(boundary.cache.size).toBe(0);
    }
  );

  it("fix: the pricing router quotes no converted price and converts no amount without an observed rate", async () => {
    engine.calculateDynamicPrice.mockResolvedValue({
      basePrice: 50000,
      finalPrice: 50000,
      breakdown: {},
      validUntil: new Date("2030-01-01T00:00:00Z"),
      priceId: "price-fx-guard",
    });
    const { pricingRouter } = await import("../routers/pricing.router");
    const caller = pricingRouter.createCaller({
      user: null,
      tenantId: null,
      authMethod: null,
      req: { headers: {} },
      res: undefined,
    } as unknown as TrpcContext);
    await expect(
      caller.calculate({
        flightId: 1,
        cabinClass: "economy",
        passengers: 1,
        currency: "USD",
      })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "No current exchange rate observation: SAR to USD. Request the price in SAR.",
    });
    expect(engine.calculateDynamicPrice).toHaveBeenCalledTimes(1);
    await expect(
      caller.convertCurrency({
        amount: 100,
        fromCurrency: "SAR",
        toCurrency: "USD",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // The labelled quote remains available for what it is.
    expect(
      await caller.getExchangeRate({ fromCurrency: "SAR", toCurrency: "USD" })
    ).toMatchObject({ data: { source: "fallback" } });

    // With an observed rate the same call converts, from that observation.
    fixture.insert(exchangeRates, {
      id: 1,
      fromCurrency: "SAR",
      toCurrency: "USD",
      rate: "0.25000000",
      source: "bank",
      validFrom: new Date(Date.now() - 60_000)
        .toISOString()
        .replace("T", " ")
        .slice(0, 19),
      validTo: null,
      updatedAt: new Date(Date.now() - 60_000)
        .toISOString()
        .replace("T", " ")
        .slice(0, 19),
    });
    expect(
      await caller.convertCurrency({
        amount: 100,
        fromCurrency: "SAR",
        toCurrency: "USD",
      })
    ).toMatchObject({ data: { convertedAmount: 25, exchangeRate: 0.25 } });
  });
  const breakdown = {
    basePrice: 50000,
    demandMultiplier: 1,
    timeMultiplier: 1,
    occupancyMultiplier: 1,
    seasonalMultiplier: 1,
    aiMultiplier: 1,
    promoDiscount: 0,
    taxes: 0,
    fees: 0,
    total: 50000,
  };
  const validUntil = new Date("2030-01-01T00:00:00Z");
  const forecastDate = new Date("2030-01-02T00:00:00Z");
  const routes = {
    calculate: {
      call: (caller: PricingCaller, currency: string) =>
        caller.calculate({
          flightId: 1,
          cabinClass: "economy",
          passengers: 1,
          currency,
        }),
      engine: engine.calculateDynamicPrice,
      sar: {
        success: true,
        data: {
          basePrice: 50000,
          finalPrice: 50000,
          convertedPrice: 50000,
          currency: "SAR",
          breakdown,
          validUntil,
          priceId: "price-fx-guard",
          formatted: "500.00 ر.س",
        },
      },
    },
    getPriceRange: {
      call: (caller: PricingCaller, currency: string) =>
        caller.getPriceRange({
          originId: 1,
          destinationId: 2,
          cabinClass: "economy",
          startDate: "2030-01-01T00:00:00.000Z",
          endDate: "2030-01-31T00:00:00.000Z",
          currency,
        }),
      engine: engine.getPriceRange,
      sar: {
        success: true,
        data: {
          min: 40000,
          max: 60000,
          average: 50000,
          currency: "SAR",
          formattedMin: "400.00 ر.س",
          formattedMax: "600.00 ر.س",
        },
      },
    },
    getForecast: {
      call: (caller: PricingCaller, currency: string) =>
        caller.getForecast({
          flightId: 1,
          cabinClass: "economy",
          days: 1,
          currency,
        }),
      engine: engine.getPriceForecast,
      sar: {
        success: true,
        data: {
          forecast: [
            {
              date: forecastDate,
              predictedPrice: 50000,
              formatted: "500.00 ر.س",
            },
          ],
          currency: "SAR",
        },
      },
    },
  } as const;

  it.each(Object.keys(routes) as Array<keyof typeof routes>)(
    "fix: pricing.%s answers a non-SAR request without a rate with PRECONDITION_FAILED and a SAR request unchanged",
    async name => {
      engine.calculateDynamicPrice.mockResolvedValue({
        basePrice: 50000,
        finalPrice: 50000,
        breakdown,
        validUntil,
        priceId: "price-fx-guard",
      });
      engine.getPriceRange.mockResolvedValue({
        min: 40000,
        max: 60000,
        average: 50000,
      });
      engine.getPriceForecast.mockResolvedValue([
        { date: forecastDate, predictedPrice: 50000 },
      ]);
      const { pricingRouter } = await import("../routers/pricing.router");
      const caller = pricingRouter.createCaller({
        user: null,
        tenantId: null,
        authMethod: null,
        req: { headers: {} },
        res: undefined,
      } as unknown as TrpcContext);
      const route = routes[name];
      for (const currency of ["USD", "EUR"])
        await expect(route.call(caller, currency)).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: `No current exchange rate observation: SAR to ${currency}. Request the price in SAR.`,
        });
      expect(await route.call(caller, "SAR")).toEqual(route.sar);
      // Only a missing rate is a precondition; an engine fault stays a
      // server error.
      route.engine.mockRejectedValueOnce(new Error("engine down"));
      await expect(route.call(caller, "USD")).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "engine down",
      });
    }
  );
});
