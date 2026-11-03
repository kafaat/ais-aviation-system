import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { SQL } from "drizzle-orm";
import {
  closeoutBaggageFlightCondition,
  manifestBaggageFlightCondition,
} from "../services/baggage-sector-scope";

// Execute the actual portable SQL predicates against relational fixtures. This
// checks row selection, not just query strings; MySQL locking remains a DB gate.
let database: DatabaseSync;
beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE bookings(id INTEGER, flightId INTEGER);
    CREATE TABLE booking_segments(id INTEGER, bookingId INTEGER, flightId INTEGER, status TEXT, segmentOrder INTEGER);
    CREATE TABLE baggage_items(id INTEGER, bookingId INTEGER, flightId INTEGER, segmentId INTEGER, weight REAL, returnEvidenceId INTEGER);
    CREATE TABLE baggage_custody_events(id INTEGER, baggageId INTEGER, flightId INTEGER);
    INSERT INTO bookings VALUES(1,10),(2,20),(3,30);
    INSERT INTO booking_segments VALUES
      (201,2,20,'confirmed',1),(202,2,21,'confirmed',2),
      (301,3,30,'confirmed',1),(302,3,31,'cancelled',2);
    INSERT INTO baggage_items(id,bookingId,flightId,segmentId,weight) VALUES
      (1,1,NULL,NULL,10),(2,2,NULL,NULL,11),
      (3,2,20,201,12),(4,2,21,202,13),
      (5,2,20,202,14),(6,2,21,NULL,15),
      (7,3,31,302,16),(8,3,NULL,NULL,17);
    ALTER TABLE baggage_items ADD COLUMN returnEventId INTEGER;
    INSERT INTO baggage_custody_events VALUES(1,2,21);
  `);
});
afterEach(() => database.close());
function selected(condition: SQL | undefined, flightId: number) {
  if (!condition) throw new Error("Missing scope predicate");
  const query = new MySqlDialect().sqlToQuery(condition);
  return database
    .prepare(
      `SELECT DISTINCT baggage_items.id
    FROM baggage_items INNER JOIN bookings ON bookings.id=baggage_items.bookingId
    LEFT JOIN booking_segments ON booking_segments.bookingId=bookings.id AND booking_segments.flightId=?
    WHERE ${query.sql} ORDER BY baggage_items.id`
    )
    .all(flightId, ...(query.params as Array<string | number | null>))
    .map(row => row.id);
}

describe("canonical baggage sector selection", () => {
  it("includes each scoped bag only on its exact registered sector in the manifest", () => {
    expect(selected(manifestBaggageFlightCondition(20), 20)).toEqual([3]);
    expect(selected(manifestBaggageFlightCondition(21), 21)).toEqual([2, 4]);
  });
  it("excludes a signed return from both manifest and loading expectations", () => {
    database.exec("UPDATE baggage_items SET returnEvidenceId=99 WHERE id=3");
    expect(selected(manifestBaggageFlightCondition(20), 20)).toEqual([]);
    expect(selected(closeoutBaggageFlightCondition(20), 20)).toEqual([2]);
  });
  it("preserves sole-flight fallback and requires custody for ambiguous legacy multi-flight manifest attribution", () => {
    expect(selected(manifestBaggageFlightCondition(10), 10)).toEqual([1]);
    database.exec("DELETE FROM baggage_custody_events");
    expect(selected(manifestBaggageFlightCondition(21), 21)).toEqual([4]);
    expect(selected(manifestBaggageFlightCondition(30), 30)).toEqual([]);
  });
  it("excludes the returned plate from the departure manifest and closeout", () => {
    database.exec("UPDATE baggage_items SET returnEventId=99 WHERE id=3");
    expect(selected(manifestBaggageFlightCondition(20), 20)).toEqual([]);
    expect(selected(closeoutBaggageFlightCondition(20), 20)).toEqual([2]);
  });
  it("does not expect the first-sector registration on every onward closeout", () => {
    expect(selected(closeoutBaggageFlightCondition(20), 20)).toEqual([2, 3]);
    expect(selected(closeoutBaggageFlightCondition(21), 21)).toEqual([2, 4]);
  });
  it("keeps legacy closeout conservative without inventing scope on new invalid records", () => {
    expect(selected(closeoutBaggageFlightCondition(10), 10)).toEqual([1]);
    expect(selected(closeoutBaggageFlightCondition(30), 30)).toEqual([8]);
    expect(selected(closeoutBaggageFlightCondition(31), 31)).toEqual([]);
    expect(selected(manifestBaggageFlightCondition(31), 31)).toEqual([]);
  });
});
