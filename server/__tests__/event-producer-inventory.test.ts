import { describe, expect, it } from "vitest";
import ts from "typescript";
import {
  assertProducerContracts,
  collectEventProducers,
} from "../../scripts/event-producer-inventory";

function inventory(body: string) {
  const root = "/ais-inventory-fixture";
  const files: Record<string, string> = {
    [`${root}/server/services/outbox.service.ts`]:
      "export function recordEvent(db: object, event: { eventType: string }) {}",
    [`${root}/server/producer.ts`]: body,
  };
  const host = ts.createCompilerHost({});
  host.fileExists = file => Object.hasOwn(files, file);
  host.readFile = file => files[file];
  host.directoryExists = () => true;
  host.getSourceFile = (file, languageVersion) =>
    files[file] === undefined
      ? undefined
      : ts.createSourceFile(file, files[file], languageVersion, true);
  const program = ts.createProgram(
    Object.keys(files),
    {
      noLib: true,
      strict: true,
      moduleResolution: ts.ModuleResolutionKind.Node10,
    },
    host
  );
  return collectEventProducers(program, root);
}

describe("producer inventory gate", () => {
  it("follows actual writer aliases and expands finite template names", () => {
    const producers = inventory(`
      import { recordEvent as persist } from './services/outbox.service';
      import * as box from './services/outbox.service';
      const alias = persist;
      declare const status: 'cancelled' | 'expired';
      persist({}, { eventType: 'booking.confirmed' });
      box.recordEvent({}, { eventType: \`waitlist.\${status}\` });
      const data = { eventType: 'gate.assigned' as const };
      alias({}, data);
    `);
    expect(producers.map(p => p.eventTypes)).toEqual([
      ["booking.confirmed"],
      ["waitlist.cancelled", "waitlist.expired"],
      ["gate.assigned"],
    ]);
    expect(() =>
      assertProducerContracts(producers, {
        "booking.confirmed": {},
        "waitlist.cancelled": {},
        "waitlist.expired": {},
        "gate.assigned": {},
      })
    ).not.toThrow();
    expect(() =>
      assertProducerContracts(producers, { "booking.confirmed": {} })
    ).toThrow("Missing payload contract for waitlist.cancelled");
  });
  it("rejects names widened to arbitrary strings rather than claiming coverage", () => {
    expect(() =>
      inventory(
        `import { recordEvent } from './services/outbox.service'; declare const name: string; recordEvent({}, { eventType: name });`
      )
    ).toThrow("Unbounded domain event producer");
  });
  it("requires contracts for newly introduced literal event names", () => {
    const producers = inventory(
      `import { recordEvent } from './services/outbox.service'; recordEvent({}, { eventType: 'new.unregistered' });`
    );
    expect(() => assertProducerContracts(producers, {})).toThrow(
      "new.unregistered"
    );
  });
  it("does not count similarly named unrelated functions or accept an empty scan", () => {
    const producers = inventory(
      `function recordEvent(_db: object, _event: unknown) {} recordEvent({}, {eventType: 'unrelated'});`
    );
    expect(producers).toEqual([]);
    expect(() => assertProducerContracts(producers, {})).toThrow(
      "No transactional domain event producers found"
    );
  });
  it("does not count inherited object properties as payload contracts", () => {
    expect(() =>
      assertProducerContracts(
        [{ file: "server/producer.ts", line: 1, eventTypes: ["constructor"] }],
        {}
      )
    ).toThrow("Missing payload contract");
  });
});
