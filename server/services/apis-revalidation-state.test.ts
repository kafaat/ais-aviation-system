import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { validateAPISData } from "./apis.service";

const dialect = new MySqlDialect();
let record: Record<string, unknown>;
const execute = vi.fn(async (statement: SQL) => {
  const query = dialect.sqlToQuery(statement);
  if (/SELECT apis_data/.test(query.sql)) return [[structuredClone(record)]];
  if (/UPDATE apis_data/.test(query.sql)) {
    if (query.sql.includes("status = 'validated'")) {
      record.status = "validated";
      record.validated_at = query.params[0];
    } else if (query.sql.includes("status = 'complete'")) {
      record.status = "complete";
      record.validated_at = null;
    } else throw new Error(`Unhandled APIS write: ${query.sql}`);
    return [{ affectedRows: 1 }];
  }
  throw new Error(`Unhandled APIS query: ${query.sql}`);
});
vi.mock("../db", () => ({
  getDb: () => ({
    transaction: (fn: (db: { execute: typeof execute }) => unknown) =>
      fn({ execute }),
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T12:00:00Z"));
  record = {
    passenger_id: 1,
    document_type: "passport",
    document_number: "ABC12345",
    issuing_country: "SA",
    nationality: "SA",
    date_of_birth: "1990-01-01",
    gender: "M",
    expiry_date: "2030-01-02",
    given_names: "Test",
    surname: "Passenger",
    status: "complete",
    validated_at: null,
  };
  execute.mockClear();
});
afterEach(() => vi.useRealTimers());

it("withdraws the persisted validation when the same document later expires", async () => {
  expect(await validateAPISData(1)).toMatchObject({
    valid: true,
    status: "validated",
  });
  expect(record.validated_at).toBeInstanceOf(Date);
  vi.setSystemTime(new Date("2030-01-02T12:00:00Z"));
  expect(await validateAPISData(1)).toMatchObject({
    valid: false,
    status: "complete",
    validatedAt: null,
  });
  expect(record).toMatchObject({ status: "complete", validated_at: null });
});

it("withdraws old validation after invalid required data is encountered", async () => {
  record.status = "validated";
  record.validated_at = new Date("2029-12-31T12:00:00Z");
  record.document_number = "!";
  expect(await validateAPISData(1)).toMatchObject({ valid: false });
  expect(record).toMatchObject({ status: "complete", validated_at: null });
});

it("keeps historical submission evidence when current validation fails", async () => {
  record.status = "submitted";
  record.validated_at = new Date("2029-12-31T12:00:00Z");
  const submittedAt = new Date("2029-12-31T13:00:00Z");
  record.submitted_at = submittedAt;
  record.expiry_date = "2029-12-31";
  await validateAPISData(1);
  expect(record).toMatchObject({
    status: "complete",
    validated_at: null,
    submitted_at: submittedAt,
  });
});
