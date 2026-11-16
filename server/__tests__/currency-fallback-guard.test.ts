import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditLogs,
  exchangeRates,
  operationsAlerts,
} from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import * as relational from "./helpers/authority-relational-fixture";

/**
 * #319 Wave 1 fallback guard: the hard-coded FALLBACK_RATES may label an
 * estimate (a quote whose source says "fallback"); they never produce an
 * amount, and no module on a money path (found by the rule below, not by a
 * fixed list) can reach them.
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

/**
 * Money paths, by rule: every non-test module under server/ whose path has a
 * segment (split on "/", ".", "_" or "-") naming money: a refund, payment,
 * payout, settlement, ledger, pricing engine, price or fare, quote, offer,
 * checkout, invoice, order and its servicing or modification, booking,
 * rebooking, NDC, loyalty or miles, wallet, credit, voucher, revenue, BSP,
 * cancellation, compensation, EMD, ticket or coupon, financial, finance or
 * accounting, reconciliation, Stripe, split payment, fee, tax, ancillary,
 * hotel, commission or economics. A new module named for any of these is
 * covered without editing this test.
 */
const MONEY_PATH_SEGMENT = new RegExp(
  `(?:^|[/._-])(?:${[
    "refunds?",
    "payments?",
    "payout",
    "pay",
    "settlements?",
    "ledgers?",
    "pricing",
    "prices?",
    "fares?",
    "quotes?",
    "offers?",
    "checkout",
    "invoices?",
    "orders?",
    "servicing",
    "modifications?",
    "bookings?",
    "rebooking",
    "ndc",
    "loyalty",
    "miles",
    "wallet",
    "credits?",
    "vouchers?",
    "revenue",
    "bsp",
    "cancellation",
    "compensation",
    "emd",
    "tickets?",
    "eticket",
    "coupons?",
    "financial",
    "finance",
    "accounting",
    "reconciliation",
    "stripe",
    "split",
    "fees?",
    "tax(?:es)?",
    "ancillary",
    "hotel",
    "commissions?",
    "economics",
  ].join("|")})(?=$|[/._-])`,
  "i"
);

/**
 * Display-only importers: the only modules that may import the currency
 * module directly. A money-path module may reach it only if it is listed
 * here, with the reason it is display-only.
 */
const DISPLAY_ONLY_IMPORTERS: Record<string, string> = {
  "server/routers/ibe-public.ts": "the labelled display estimate",
  "server/routers/pricing.router.ts":
    "SAR prices shown in another currency with the display quote, and the labelled quote; base and final prices stay SAR",
  "server/services/standard-reports-commercial.service.ts":
    "the list of supported currency codes only",
  "server/services/currency/operator-rates.service.ts":
    "operator quote entry and the display-rate alarm",
};

/** The explicit list this guard used before the rule; the rule must keep
 * covering it, plus the two modules the list missed. */
const EARLIER_MONEY_PATHS = [
  "server/services/pricing/dynamic-pricing.service.ts",
  "server/services/dynamic-pricing.service.ts",
  "server/services/price-quote.service.ts",
  "server/services/price-lock.service.ts",
  "server/services/fare-components.service.ts",
  "server/services/retail-offer.service.ts",
  "server/routers/price-quote.ts",
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
  "server/services/order-servicing.service.ts",
  "server/services/booking-modification.service.ts",
  "server/routers/modifications.ts",
  "server/routers/ndc.ts",
  "server/services/payment-settlement.service.ts",
  "server/services/booking-settlement.service.ts",
  "server/services/stripe/stripe-reconciliation.service.ts",
  "server/services/corporate-settlement.service.ts",
  "server/services/bsp-settlement.service.ts",
  "server/services/financial-reporting.service.ts",
  "server/services/wallet.service.ts",
  "server/webhooks/stripe.ts",
  "server/services/refunds.service.ts",
  "server/services/internal-refund.service.ts",
  "server/services/ordinary-refund.service.ts",
  "server/services/order-refunds.service.ts",
  "server/services/split-refund.service.ts",
  "server/routers/refunds.ts",
  "server/routers/wallet.ts",
  "server/services/flight-cancellation.service.ts",
  "server/services/revenue-accounting.service.ts",
];

/** Non-test TypeScript modules under server/, relative to the repository. */
function serverModules(directory = "server"): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory())
      return entry.name === "__tests__" || entry.name === "node_modules"
        ? []
        : serverModules(path);
    return /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
      ? [path]
      : [];
  });
}

const isMoneyPath = (module: string) =>
  MONEY_PATH_SEGMENT.test(module.replace(/^server\//, ""));

/** Static runtime import graph (type-only imports excluded), as the service
 * catalog builds it: static, re-export and dynamic imports inside the repo.
 * `extraEdges` adds imports to the real graph, to prove the guard fails. */
function importGraph(extraEdges: Record<string, string[]> = {}) {
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
    for (const extra of extraEdges[relative(root, file)] ?? [])
      found.push(resolve(extra));
    edges.set(file, found);
    return found;
  };
  /** The import chain from entry to target, or null when unreachable. */
  const chainTo = (entry: string, target: string): string[] | null => {
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
  const directImporters = (target: string) =>
    serverModules()
      .filter(module => dependencies(resolve(module)).includes(resolve(target)))
      .sort();
  return { chainTo, directImporters };
}

/** Money-path modules outside the allow-list that reach the currency module. */
function moneyPathViolations(graph: ReturnType<typeof importGraph>) {
  return serverModules()
    .sort()
    .filter(
      module => isMoneyPath(module) && !(module in DISPLAY_ONLY_IMPORTERS)
    )
    .map(module => graph.chainTo(module, CURRENCY_SERVICE))
    .filter(chain => chain !== null);
}

function sqlTime(offsetMs: number) {
  return new Date(Date.now() + offsetMs)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
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

  it("control: keeps every money path, found by rule, outside the currency module's import graph", () => {
    const graph = importGraph();
    const modules = serverModules();
    const money = modules.filter(isMoneyPath);
    // The rule is not vacuous: it finds well over the earlier explicit list,
    // covers every module of that list and the two the list missed.
    expect(money.length).toBeGreaterThan(150);
    for (const module of EARLIER_MONEY_PATHS) {
      expect(existsSync(module), module).toBe(true);
      expect(isMoneyPath(module), module).toBe(true);
    }
    expect(moneyPathViolations(graph)).toEqual([]);
    // The graph is live: the display and pricing routers do reach it.
    expect(
      graph.chainTo("server/routers/ibe-public.ts", CURRENCY_SERVICE)
    ).toEqual(["server/routers/ibe-public.ts", CURRENCY_SERVICE]);
  });

  it("control: only the allow-listed display-only modules import the currency module", () => {
    const graph = importGraph();
    expect(graph.directImporters(CURRENCY_SERVICE)).toEqual(
      Object.keys(DISPLAY_ONLY_IMPORTERS).sort()
    );
    // The only allow-listed money path is the pricing router.
    expect(Object.keys(DISPLAY_ONLY_IMPORTERS).filter(isMoneyPath)).toEqual([
      "server/routers/pricing.router.ts",
    ]);
  });

  it("control: the rule flags a money path that gains a route to the currency module", () => {
    const added = {
      "server/services/flight-cancellation.service.ts": [CURRENCY_SERVICE],
      // A route through an intermediate module counts as well.
      "server/services/revenue-accounting.service.ts": [
        "server/services/currency/operator-rates.service.ts",
      ],
    };
    const flagged = moneyPathViolations(importGraph(added)).map(
      chain => chain[0]
    );
    expect(flagged).toEqual(
      expect.arrayContaining([
        "server/services/flight-cancellation.service.ts",
        "server/services/revenue-accounting.service.ts",
        // ...and every money path that imports them.
        "server/routers/revenue-accounting.ts",
      ])
    );
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

  // Fix round 1, item 3: a price is converted only with the quote the
  // display estimate would show (approved source, observed < 24 h ago).
  const HOUR = 3_600_000;
  function mockEngine() {
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
  }
  async function pricingCaller(): Promise<PricingCaller> {
    const { pricingRouter } = await import("../routers/pricing.router");
    return pricingRouter.createCaller({
      user: null,
      tenantId: null,
      authMethod: null,
      req: { headers: {} },
      res: undefined,
    } as unknown as TrpcContext);
  }
  function seedUsdQuote(quote: { observedAgoMs: number; source?: string }) {
    fixture.insert(exchangeRates, {
      id: 1,
      fromCurrency: "SAR",
      toCurrency: "USD",
      rate: "0.25000000",
      source: quote.source ?? "bank",
      validFrom: sqlTime(-quote.observedAgoMs),
      validTo: sqlTime(20 * HOUR),
      updatedAt: sqlTime(-quote.observedAgoMs),
    });
  }
  const convertedAtQuarter = {
    calculate: {
      success: true,
      data: {
        basePrice: 50000,
        finalPrice: 50000,
        convertedPrice: 12500,
        currency: "USD",
        breakdown,
        validUntil,
        priceId: "price-fx-guard",
        formatted: "$125.00",
      },
    },
    getPriceRange: {
      success: true,
      data: {
        min: 10000,
        max: 15000,
        average: 12500,
        currency: "USD",
        formattedMin: "$100.00",
        formattedMax: "$150.00",
      },
    },
    getForecast: {
      success: true,
      data: {
        forecast: [
          { date: forecastDate, predictedPrice: 12500, formatted: "$125.00" },
        ],
        currency: "USD",
      },
    },
  } as const;

  it.each(Object.keys(routes) as Array<keyof typeof routes>)(
    "fix: pricing.%s converts no price with a quote the display would not show",
    async name => {
      mockEngine();
      const caller = await pricingCaller();
      for (const [quote, why] of [
        [{ observedAgoMs: 30 * HOUR }, "observed 30 hours ago"],
        [{ observedAgoMs: HOUR, source: "ecb" }, "from an unapproved source"],
      ] as const) {
        fixture.sqlite.exec("DELETE FROM exchange_rates");
        boundary.cache.clear();
        seedUsdQuote(quote);
        expect(await currency.getDisplayExchangeRate("USD"), why).toBeNull();
        await expect(
          routes[name].call(caller, "USD"),
          why
        ).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message:
            "No current exchange rate observation: SAR to USD. Request the price in SAR.",
        });
      }
    }
  );

  it.each(Object.keys(routes) as Array<keyof typeof routes>)(
    "control: pricing.%s converts a price with the quote the display shows",
    async name => {
      mockEngine();
      seedUsdQuote({ observedAgoMs: HOUR });
      expect(await currency.getDisplayExchangeRate("USD")).toMatchObject({
        rate: 0.25,
        source: "bank",
      });
      expect(await routes[name].call(await pricingCaller(), "USD")).toEqual(
        convertedAtQuarter[name]
      );
    }
  );

  // Fix round 1, item 5: each layer below holds on its own.
  it("control: a correction reaches the next conversion at once, not a cached snapshot", async () => {
    fixture.close();
    fixture = relational.authorityRelationalFixture([
      exchangeRates,
      auditLogs,
      operationsAlerts,
    ]);
    boundary.db = fixture.db;
    const { recordOperatorExchangeRate } =
      await import("../services/currency/operator-rates.service");
    const actor = { userId: 20, role: "admin" };
    const start = Date.now();
    const usdQuote = (rate: string, supersedesId?: number) => ({
      baseCurrency: "SAR" as const,
      quoteCurrency: "USD" as const,
      rate,
      source: "bank" as const,
      sourceReference: "Bank reference rate sheet 2026-11-16",
      validFrom: new Date(start - HOUR),
      validTo: new Date(start + 20 * HOUR),
      ...(supersedesId === undefined ? {} : { supersedesId }),
    });
    const first = await recordOperatorExchangeRate(
      usdQuote("0.25000000"),
      actor
    );
    expect(
      (await currency.convertCurrency(100, "SAR", "USD")).convertedAmount
    ).toBe(25);
    expect(boundary.cache.has("exchange_rate:v3:SAR_USD")).toBe(true);
    await recordOperatorExchangeRate(usdQuote("0.30000000", first.id), actor);
    expect(
      (await currency.convertCurrency(100, "SAR", "USD")).convertedAmount
    ).toBe(30);
  });

  it("control: an amount conversion refuses a stored row whose source names a fallback", async () => {
    fixture.insert(exchangeRates, {
      id: 1,
      fromCurrency: "SAR",
      toCurrency: "KWD",
      rate: "0.08200000",
      source: "fallback",
      validFrom: sqlTime(-60_000),
      validTo: null,
      updatedAt: sqlTime(-60_000),
    });
    await expect(currency.convertCurrency(100, "SAR", "KWD")).rejects.toThrow(
      currency.ExchangeRateUnavailableError
    );
    // It stays a labelled quote, also once the quote path has cached it.
    expect(await currency.getExchangeRate("SAR", "KWD")).toMatchObject({
      rate: 0.082,
      source: "fallback",
    });
    expect(boundary.cache.has("exchange_rate:v3:SAR_KWD")).toBe(true);
    await expect(currency.convertCurrency(100, "SAR", "KWD")).rejects.toThrow(
      currency.ExchangeRateUnavailableError
    );
  });

  it("control: an amount conversion refuses at the missing observation, before any estimate", async () => {
    fixture.insert(exchangeRates, {
      id: 1,
      fromCurrency: "SAR",
      toCurrency: "AED",
      rate: "0.97930000",
      source: "bank",
      validFrom: sqlTime(-60_000),
      validTo: null,
      updatedAt: sqlTime(-60_000),
    });
    const refusal = await currency
      .convertCurrency(100, "USD", "AED")
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(currency.ExchangeRateUnavailableError);
    // It names the leg without an observation: no estimate was built for
    // that leg and then refused as a cross rate.
    expect(refusal).toMatchObject({ fromCurrency: "USD", toCurrency: "SAR" });
    expect(boundary.cache.has("exchange_rate:v3:USD_AED")).toBe(false);
    // The quote path still labels the same cross rate as an estimate.
    expect(await currency.getExchangeRate("USD", "AED")).toMatchObject({
      source: "cross_rate_fallback",
    });
  });
});
