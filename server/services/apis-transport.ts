/**
 * Transport layer for government passenger-data messages (PNRGOV, PAXLST).
 *
 * The transmission service owns the state machine; a transport only moves one
 * envelope and reports what happened. Three implementations exist:
 *
 * - InMemoryTransport: tests and local acceptance rehearsal.
 * - FileDropTransport: writes each message to an outbound directory and reads
 *   acknowledgements from an inbound directory, for an operator-run SFTP/MQ
 *   bridge. No credentials live in this process.
 * - UnconfiguredAuthorityTransport: the documented adapter contract for the
 *   National Passenger Security Center (or another destination authority).
 *   It refuses every send until an adapter implementing `ApisTransport` is
 *   installed, so nothing is ever claimed to have been transmitted.
 *
 * Adapter contract for the NPSC / destination authority (to implement once
 * the technical specification and connection details are received):
 *   1. `send` receives a complete UN/EDIFACT interchange and the correlation
 *      id that is also carried as the interchange control reference; it must
 *      return only after the authority (or the bridge) has accepted custody.
 *   2. A synchronous functional response (CUSRES) may be returned in
 *      `immediateResponse`; asynchronous responses are collected through
 *      `pollAcknowledgements` and matched by any reference they echo.
 *   3. Failures throw `TransportError` with `retryable` set honestly: a
 *      connection or timeout fault is retryable, a configuration or
 *      authentication fault is not. The service applies backoff and the
 *      dead-letter state; adapters never retry on their own.
 *   4. Adapters must not log message bodies: they contain passenger data.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ApisMessageType = "PNRGOV" | "PAXLST";

export interface TransmissionEnvelope {
  transmissionId: number;
  messageType: ApisMessageType;
  authorityCode: string;
  correlationId: string;
  flightId: number;
  body: string;
  bodyHash: string;
}

export interface TransportReceipt {
  deliveredAt: Date;
  /** Reference the bridge or authority assigned, when any. */
  transportReference: string | null;
  /** A functional acknowledgement returned synchronously, when any. */
  immediateResponse: string | null;
}

export interface InboundAcknowledgement {
  body: string;
  /** Where it came from, for the transmission log. */
  source: string;
}

export interface ApisTransport {
  readonly name: string;
  send(envelope: TransmissionEnvelope): Promise<TransportReceipt>;
  pollAcknowledgements?(): Promise<InboundAcknowledgement[]>;
}

export class TransportError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

export function hashBody(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function newCorrelationId(): string {
  // UNB/UNZ interchange control references are limited to 14 characters.
  return randomUUID().replaceAll("-", "").slice(0, 14).toUpperCase();
}

export class InMemoryTransport implements ApisTransport {
  readonly name = "memory";
  readonly sent: TransmissionEnvelope[] = [];
  private failures: TransportError[] = [];
  private responses = new Map<string, string>();
  private inbound: InboundAcknowledgement[] = [];

  /** Queue a failure for the next send(s). */
  failNext(error: TransportError) {
    this.failures.push(error);
  }

  /** Return `body` synchronously when `correlationId` is sent. */
  respondTo(correlationId: string, body: string) {
    this.responses.set(correlationId, body);
  }

  /** Deliver an asynchronous acknowledgement on the next poll. */
  receive(body: string) {
    this.inbound.push({ body, source: "memory" });
  }

  // eslint-disable-next-line require-await
  async send(envelope: TransmissionEnvelope): Promise<TransportReceipt> {
    const failure = this.failures.shift();
    if (failure) throw failure;
    this.sent.push(envelope);
    return {
      deliveredAt: new Date(),
      transportReference: `mem-${this.sent.length}`,
      immediateResponse: this.responses.get(envelope.correlationId) ?? null,
    };
  }

  // eslint-disable-next-line require-await
  async pollAcknowledgements(): Promise<InboundAcknowledgement[]> {
    const batch = this.inbound;
    this.inbound = [];
    return batch;
  }
}

/** Directory layout: <root>/outbound/<correlationId>.edi plus a .json sidecar
 * with the envelope metadata (no body); <root>/inbound/*.edi are consumed and
 * moved to <root>/processed/. */
export class FileDropTransport implements ApisTransport {
  readonly name = "filedrop";
  constructor(private readonly root: string) {}

  async send(envelope: TransmissionEnvelope): Promise<TransportReceipt> {
    const outbound = join(this.root, "outbound");
    try {
      await mkdir(outbound, { recursive: true });
      const base = join(outbound, envelope.correlationId);
      await writeFile(`${base}.edi.tmp`, envelope.body, "utf8");
      await writeFile(
        `${base}.json`,
        JSON.stringify(
          {
            transmissionId: envelope.transmissionId,
            messageType: envelope.messageType,
            authorityCode: envelope.authorityCode,
            correlationId: envelope.correlationId,
            flightId: envelope.flightId,
            bodyHash: envelope.bodyHash,
            writtenAt: new Date().toISOString(),
          },
          null,
          2
        ),
        "utf8"
      );
      // Rename last so the bridge never picks up a partially written file.
      await rename(`${base}.edi.tmp`, `${base}.edi`);
    } catch (error) {
      throw new TransportError(
        `File drop failed: ${(error as Error).message}`,
        true
      );
    }
    return {
      deliveredAt: new Date(),
      transportReference: `${envelope.correlationId}.edi`,
      immediateResponse: null,
    };
  }

  async pollAcknowledgements(): Promise<InboundAcknowledgement[]> {
    const inbound = join(this.root, "inbound");
    const processed = join(this.root, "processed");
    let names: string[];
    try {
      await mkdir(inbound, { recursive: true });
      await mkdir(processed, { recursive: true });
      names = (await readdir(inbound)).filter(n => /\.edi$/i.test(n)).sort();
    } catch (error) {
      throw new TransportError(
        `Acknowledgement poll failed: ${(error as Error).message}`,
        true
      );
    }
    const out: InboundAcknowledgement[] = [];
    for (const name of names) {
      const body = await readFile(join(inbound, name), "utf8");
      await rename(join(inbound, name), join(processed, name));
      out.push({ body, source: `filedrop:${name}` });
    }
    return out;
  }
}

/** Placeholder for the authority adapter; see the contract in the header. */
export class UnconfiguredAuthorityTransport implements ApisTransport {
  readonly name = "authority-unconfigured";
  // eslint-disable-next-line require-await
  async send(): Promise<TransportReceipt> {
    throw new TransportError(
      "Destination authority adapter is not configured: the NPSC technical specification, connection details and credentials are required",
      false
    );
  }
}

/**
 * APIS_TRANSPORT=memory|filedrop|authority (unset: no transport; queued
 * transmissions wait). APIS_FILEDROP_DIR is required for filedrop.
 */
export function resolveApisTransport(
  env: NodeJS.ProcessEnv = process.env
): ApisTransport | null {
  switch (env.APIS_TRANSPORT) {
    case "memory":
      if (env.NODE_ENV === "production")
        throw new Error("APIS_TRANSPORT=memory is not allowed in production");
      return sharedMemoryTransport;
    case "filedrop": {
      const dir = env.APIS_FILEDROP_DIR;
      if (!dir) throw new Error("APIS_FILEDROP_DIR is required for filedrop");
      return new FileDropTransport(dir);
    }
    case "authority":
      return new UnconfiguredAuthorityTransport();
    case undefined:
    case "":
    case "none":
      return null;
    default:
      throw new Error(`Unknown APIS_TRANSPORT ${env.APIS_TRANSPORT}`);
  }
}

/** One process-wide instance so a development server keeps its send log. */
export const sharedMemoryTransport = new InMemoryTransport();
