import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "../../drizzle/schema";
import {
  createPaidBookingNativeFixture,
  type PaidBookingNativeFixture,
} from "./helpers/paid-booking-native-fixture";

const state = vi.hoisted(() => ({
  db: null as unknown,
  beforePdf: null as ((passengerId: number) => Promise<void>) | null,
  afterPdf: null as ((passengerId: number) => Promise<void>) | null,
  generated: [] as number[],
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
// The normal path renders real PDFKit documents from native ticket/coupon
// records. These explicit seams inject only PDF failure or a post-render pause.
vi.mock("../services/eticket.service", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../services/eticket.service")>();
  return {
    ...actual,
    generateETicketForPassenger: async (
      bookingId: number,
      passengerId: number
    ) => {
      await state.beforePdf?.(passengerId);
      const document = await actual.generateETicketForPassenger(
        bookingId,
        passengerId
      );
      state.generated.push(passengerId);
      await state.afterPdf?.(passengerId);
      return document;
    },
  };
});
import { configuredPublisher } from "../services/outbox.service";
import { settleVerifiedPayment } from "../services/payment-settlement.service";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;
type MailRequest = {
  to: string[];
  subject: string;
  attachments?: Array<{
    filename: string;
    content: string;
    content_type: string;
  }>;
};
const observe = <T>(promise: Promise<T>) =>
  promise.then(
    value => ({ status: "fulfilled" as const, value }),
    reason => ({ status: "rejected" as const, reason })
  );

nativeDescribe.sequential(
  "booking confirmation uses native records, real PDFs and durable delivery receipts",
  () => {
    let fixture: PaidBookingNativeFixture;
    let event: schema.OutboxEvent;
    let attempts: Array<{ key: string | null; request: MailRequest }> = [];
    let providerStatus = 200;
    let loseAcceptedResponse = false;
    let providerAcceptances = 0;
    let providerPayloads = new Map<string, string>();
    beforeAll(async () => {
      fixture = await createPaidBookingNativeFixture("ais_confirmation");
      state.db = fixture.db;
    }, 60000);
    beforeEach(async () => {
      await fixture.reset();
      await fixture.seed();
      state.beforePdf = null;
      state.afterPdf = null;
      state.generated = [];
      attempts = [];
      providerStatus = 200;
      loseAcceptedResponse = false;
      providerAcceptances = 0;
      providerPayloads = new Map();
      vi.stubEnv("RESEND_API_KEY", "synthetic_native_mail_key");
      vi.stubEnv("EMAIL_FROM", "native@example.test");
      vi.stubEnv("OUTBOX_PUBLISH_URL", "");
      // Only the provider HTTP boundary is controlled. The configured publisher,
      // delivery claim, recipient lookup, template and actual PDFs all execute.
      vi.stubGlobal(
        "fetch",
        async (input: string | URL | Request, init?: RequestInit) => {
          if (String(input) !== "https://api.resend.com/emails")
            throw new Error(
              "Unexpected network request in owned email acceptance"
            );
          const headers = new Headers(init?.headers);
          const key = headers.get("Idempotency-Key");
          const body = String(init?.body);
          attempts.push({
            key,
            request: JSON.parse(body) as MailRequest,
          });
          // Resend's documented contract binds a key to the same payload.
          // Explicit rejection does not claim acceptance; a lost response below
          // retains the accepted request and requires exact replay on retry.
          if (providerStatus === 200) {
            if (!key) throw new Error("Expected a provider idempotency key");
            const prior = providerPayloads.get(key);
            if (prior !== undefined && prior !== body)
              return Response.json(
                { name: "invalid_idempotent_request" },
                { status: 409 }
              );
            if (prior === undefined) {
              providerPayloads.set(key, body);
              providerAcceptances++;
            }
            if (loseAcceptedResponse) {
              loseAcceptedResponse = false;
              throw new TypeError(
                "Synthetic lost provider acceptance response"
              );
            }
          }
          return new Response(
            JSON.stringify(
              providerStatus === 200
                ? { id: "native-provider-acceptance" }
                : { error: "synthetic provider failure" }
            ),
            {
              status: providerStatus,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      );
      await fixture.db.transaction(tx =>
        settleVerifiedPayment(tx, {
          paymentIntentId: "pi_native_confirmation",
          eventId: "evt_native_confirmation",
          amount: 20000,
          currency: "SAR",
          metadata: { type: "booking", bookingId: "71", userId: "9" },
        })
      );
      [event] = await fixture.db
        .select()
        .from(schema.outbox)
        .where(eq(schema.outbox.eventType, "booking.confirmed"));
      expect(event).toBeDefined();
    }, 15000);
    afterEach(() => {
      state.beforePdf = null;
      state.afterPdf = null;
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });
    afterAll(async () => {
      state.db = null;
      await fixture?.close();
    });

    async function mailReceipt() {
      return (await fixture.db.select().from(schema.eventDeliveries)).find(
        row => row.consumer === "booking-email"
      );
    }
    async function ticketIdentities() {
      return fixture.db
        .select({
          id: schema.passengers.id,
          number: schema.passengers.ticketNumber,
        })
        .from(schema.passengers);
    }
    async function expectDocumentsIssuedOnce(couponCount = 2) {
      const identities = await ticketIdentities();
      expect(identities).toHaveLength(2);
      expect(
        identities.every(
          row => typeof row.number === "string" && row.number.length > 0
        )
      ).toBe(true);
      expect(new Set(identities.map(row => row.number)).size).toBe(2);
      expect(await fixture.db.select().from(schema.ticketCoupons)).toHaveLength(
        couponCount
      );
      expect(
        await fixture.db
          .select()
          .from(schema.outbox)
          .where(eq(schema.outbox.eventType, "ETicketIssued"))
      ).toHaveLength(2);
      return identities;
    }
    function expectMailWithTwoRealDocuments(email = "owner@example.test") {
      const last = attempts.at(-1)!;
      expect(last.key).toBe("booking-confirmed:71");
      expect(last.request.to).toEqual([email]);
      const attachments = last.request.attachments!;
      expect(attachments).toHaveLength(2);
      expect(new Set(attachments.map(item => item.content)).size).toBe(2);
      for (const attachment of attachments) {
        expect(attachment.content_type).toBe("application/pdf");
        expect(attachment.filename).toMatch(/^eticket-.+\.pdf$/);
        const bytes = Buffer.from(attachment.content, "base64");
        expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
        expect(bytes.length).toBeGreaterThan(1000);
        expect(bytes.subarray(-30).toString()).toContain("%%EOF");
      }
    }

    it("delivers one confirmation with both real passenger PDFs and retains all receipts on replay", async () => {
      const funded = await fixture.financialSnapshot();
      await configuredPublisher(event);
      expectMailWithTwoRealDocuments();
      expect([...state.generated].sort((a, b) => a - b)).toEqual([81, 82]);
      expect(
        attempts[0].request.attachments?.map(item => item.filename).sort()
      ).toEqual(["eticket-NM0071-Alpha.pdf", "eticket-NM0071-Beta.pdf"]);
      const issued = await expectDocumentsIssuedOnce();
      const generated = [...state.generated];
      await configuredPublisher(event);
      expect(attempts).toHaveLength(1);
      expect(state.generated).toEqual(generated);
      expect(await ticketIdentities()).toEqual(issued);
      expect(await fixture.financialSnapshot()).toEqual(funded);
      expect(await mailReceipt()).toMatchObject({
        status: "processed",
        attempts: 1,
        lastError: null,
      });
    });

    it("rejects a foreign tenant event without exposing documents or marking email successful", async () => {
      const before = await fixture.financialSnapshot();
      await expect(
        configuredPublisher({ ...event, tenantId: 4 })
      ).rejects.toThrow(/delivery incomplete/);
      expect(attempts).toHaveLength(0);
      expect(state.generated).toHaveLength(0);
      expect(await mailReceipt()).toMatchObject({
        status: "failed",
        processedAt: null,
      });
      expect(await fixture.financialSnapshot()).toEqual(before);
    });

    it("retries a missing recipient using the current owner without another charge or ticket issue", async () => {
      await fixture.db
        .update(schema.users)
        .set({ email: null })
        .where(eq(schema.users.id, 9));
      const before = await fixture.financialSnapshot();
      await expect(configuredPublisher(event)).rejects.toThrow(
        /delivery incomplete/
      );
      expect(attempts).toHaveLength(0);
      expect(state.generated).toHaveLength(0);
      expect(await mailReceipt()).toMatchObject({
        status: "failed",
        processedAt: null,
      });
      await fixture.db
        .update(schema.users)
        .set({ email: "restored@example.test" })
        .where(eq(schema.users.id, 9));
      await configuredPublisher(event);
      await configuredPublisher(event);
      expectMailWithTwoRealDocuments("restored@example.test");
      expect(attempts).toHaveLength(1);
      await expectDocumentsIssuedOnce();
      expect(await fixture.financialSnapshot()).toEqual(before);
    });

    it("ignores an already cancelled itinerary without a provider-acceptance or document claim", async () => {
      await fixture.db
        .update(schema.bookings)
        .set({ status: "cancelled" })
        .where(eq(schema.bookings.id, 71));
      const before = await fixture.financialSnapshot();
      await configuredPublisher(event);
      expect(attempts).toHaveLength(0);
      expect(state.generated).toHaveLength(0);
      // The obsolete event is consumed; there was no email acceptance.
      expect(await mailReceipt()).toMatchObject({ status: "processed" });
      expect(await fixture.financialSnapshot()).toEqual(before);
    });

    it("refuses an incomplete passenger roster instead of sending a confirmation without every attachment", async () => {
      await fixture.db
        .delete(schema.passengers)
        .where(eq(schema.passengers.id, 82));
      await expect(configuredPublisher(event)).rejects.toThrow(
        /delivery incomplete/
      );
      expect(attempts).toHaveLength(0);
      expect(await mailReceipt()).toMatchObject({
        status: "failed",
        processedAt: null,
      });
    });

    it("retains ticket identities and financial effects after provider rejection and a successful retry", async () => {
      const funded = await fixture.financialSnapshot();
      providerStatus = 503;
      await expect(configuredPublisher(event)).rejects.toThrow(
        /delivery incomplete/
      );
      const issued = await expectDocumentsIssuedOnce();
      expect(await mailReceipt()).toMatchObject({
        status: "failed",
        processedAt: null,
      });
      providerStatus = 200;
      await configuredPublisher(event);
      await configuredPublisher(event);
      expect(attempts).toHaveLength(2);
      expect(attempts.map(item => item.key)).toEqual([
        "booking-confirmed:71",
        "booking-confirmed:71",
      ]);
      expectMailWithTwoRealDocuments();
      expect(await expectDocumentsIssuedOnce()).toEqual(issued);
      expect(await fixture.financialSnapshot()).toEqual(funded);
      expect(await mailReceipt()).toMatchObject({
        status: "processed",
        attempts: 2,
        lastError: null,
      });
    });

    it("replays an identical provider request after acceptance is lost without a second email or ticket issue", async () => {
      const funded = await fixture.financialSnapshot();
      loseAcceptedResponse = true;
      await expect(configuredPublisher(event)).rejects.toThrow(
        /delivery incomplete/
      );
      expect(providerAcceptances).toBe(1);
      const issued = await expectDocumentsIssuedOnce();
      expect(await mailReceipt()).toMatchObject({
        status: "failed",
        processedAt: null,
      });

      await configuredPublisher(event);
      await configuredPublisher(event);
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toEqual(attempts[0]);
      expect(providerAcceptances).toBe(1);
      expectMailWithTwoRealDocuments();
      expect(await expectDocumentsIssuedOnce()).toEqual(issued);
      expect(await fixture.financialSnapshot()).toEqual(funded);
      expect(await mailReceipt()).toMatchObject({
        status: "processed",
        attempts: 2,
        lastError: null,
      });
    });

    it("does not send a partial PDF set and retries the failed renderer without reissuing the successful ticket", async () => {
      const funded = await fixture.financialSnapshot();
      state.beforePdf = async id => {
        if (id === 82) throw new Error("Synthetic PDF renderer failure");
      };
      await expect(configuredPublisher(event)).rejects.toThrow(
        /delivery incomplete/
      );
      expect(attempts).toHaveLength(0);
      const first = (await ticketIdentities()).find(
        row => row.id === 81
      )?.number;
      expect(first).toBeTruthy();
      state.beforePdf = null;
      await configuredPublisher(event);
      await configuredPublisher(event);
      expect(attempts).toHaveLength(1);
      expectMailWithTwoRealDocuments();
      expect(
        (await expectDocumentsIssuedOnce()).find(row => row.id === 81)?.number
      ).toBe(first);
      expect(await fixture.financialSnapshot()).toEqual(funded);
    });

    it.each([
      "cancelled",
      "recipient",
      "reference",
      "flight",
      "passenger",
      "segment",
    ] as const)(
      "rechecks %s changed after native document generation before handing data to the email provider",
      async change => {
        if (change === "segment") {
          // A second sector can change while bookings.flightId and every
          // first-sector field remain unchanged. These are native source rows,
          // not a mocked document or service response.
          await fixture.db
            .update(schema.flights)
            .set({ originId: 2, destinationId: 1 })
            .where(eq(schema.flights.id, 42));
          const [second] = await fixture.db
            .select()
            .from(schema.flights)
            .where(eq(schema.flights.id, 42));
          await fixture.db.insert(schema.flights).values({
            ...second,
            id: 43,
            flightNumber: "NM043",
            departureTime: new Date("2030-06-12T12:00:00Z"),
            arrivalTime: new Date("2030-06-12T14:00:00Z"),
          });
          await fixture.db.insert(schema.bookingSegments).values([
            {
              id: 91,
              bookingId: 71,
              segmentOrder: 1,
              flightId: 41,
              status: "confirmed",
              departureDate: new Date("2030-06-10T12:00:00Z"),
            },
            {
              id: 92,
              bookingId: 71,
              segmentOrder: 2,
              flightId: 42,
              status: "confirmed",
              departureDate: second.departureTime,
            },
          ]);
        }
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
          release = resolve;
        });
        state.afterPdf = async () => {
          await gate;
        };
        const publication = observe(configuredPublisher(event));
        let outcome: Awaited<typeof publication>;
        try {
          const deadline = Date.now() + 10000;
          while (state.generated.length < 2) {
            if (Date.now() >= deadline)
              throw new Error(
                "Actual passenger PDF generation did not reach the controlled boundary"
              );
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          if (change === "cancelled")
            await fixture.db
              .update(schema.bookings)
              .set({ status: "cancelled" })
              .where(eq(schema.bookings.id, 71));
          if (change === "recipient")
            await fixture.db
              .update(schema.users)
              .set({ email: "current@example.test" })
              .where(eq(schema.users.id, 9));
          if (change === "reference")
            await fixture.db
              .update(schema.bookings)
              .set({ bookingReference: "NMNEW1" })
              .where(eq(schema.bookings.id, 71));
          if (change === "flight")
            await fixture.db
              .update(schema.bookings)
              .set({ flightId: 42 })
              .where(eq(schema.bookings.id, 71));
          if (change === "passenger")
            await fixture.db
              .update(schema.passengers)
              .set({ firstName: "Current" })
              .where(eq(schema.passengers.id, 82));
          if (change === "segment")
            await fixture.db
              .update(schema.bookingSegments)
              .set({ flightId: 43 })
              .where(eq(schema.bookingSegments.id, 92));
        } finally {
          release();
          state.afterPdf = null;
          outcome = await publication;
        }
        expect(attempts).toHaveLength(0);
        if (change === "cancelled") {
          expect(outcome.status).toBe("fulfilled");
          expect(await mailReceipt()).toMatchObject({ status: "processed" });
        } else {
          expect(outcome.status).toBe("rejected");
          expect(await mailReceipt()).toMatchObject({
            status: "failed",
            processedAt: null,
          });
          // The flight mutation is a deliberate invalidation fault, not a servicing
          // operation: restore its original coupon itinerary before retrying.
          if (change === "flight")
            await fixture.db
              .update(schema.bookings)
              .set({ flightId: 41 })
              .where(eq(schema.bookings.id, 71));
          if (change === "segment")
            await fixture.db
              .update(schema.bookingSegments)
              .set({ flightId: 42 })
              .where(eq(schema.bookingSegments.id, 92));
          await configuredPublisher(event);
          expect(attempts).toHaveLength(1);
          expectMailWithTwoRealDocuments(
            change === "recipient"
              ? "current@example.test"
              : "owner@example.test"
          );
          expect(
            attempts[0].request.attachments?.map(item => item.filename).sort()
          ).toEqual(
            change === "reference"
              ? ["eticket-NMNEW1-Alpha.pdf", "eticket-NMNEW1-Beta.pdf"]
              : change === "passenger"
                ? ["eticket-NM0071-Alpha.pdf", "eticket-NM0071-Current.pdf"]
                : ["eticket-NM0071-Alpha.pdf", "eticket-NM0071-Beta.pdf"]
          );
        }
        await expectDocumentsIssuedOnce(change === "segment" ? 4 : 2);
        expect(
          await fixture.db.select().from(schema.financialLedger)
        ).toHaveLength(1);
        expect(
          await fixture.db.select().from(schema.paymentReceipts)
        ).toHaveLength(1);
      },
      20000
    );
  }
);
