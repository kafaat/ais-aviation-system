/**
 * Transport boundary for the Type B gateway.
 *
 * The queue (typeb_messages) is drained through {@link TypeBTransport}. Two
 * implementations ship with the repository and neither reaches outside the
 * process or the file system:
 *
 *  - InMemoryTransport: tests and the admin preview.
 *  - FileDropTransport: writes each outbound message to `<dir>/outbound/` and
 *    reads inbound messages from `<dir>/inbound/`, which is how most
 *    SITA/ARINC on-premise gateways and SITATEX exchange files.
 *
 * A real provider (SITA Type B over IP / MATIP, ARINC, or an IP Type B
 * gateway) is a third implementation of the same interface; the contract is
 * documented in docs/architecture/typeb-gateway.md. No credentials are read
 * here and `TYPEB_TRANSPORT=live` is refused until such an adapter exists.
 */
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { TypeBMessageType } from "./model";

export interface OutboundTypeBMessage {
  id: number;
  messageType: TypeBMessageType;
  addresses: string[];
  /** Complete message including header and trailer, LF separated. */
  text: string;
}

export interface InboundTypeBMessage {
  /** Provider reference used for idempotent ingestion. */
  transportReference: string;
  raw: string;
}

export interface TypeBTransport {
  /** Stable identifier recorded with every sent message. */
  readonly id: string;
  readonly mode: "sandbox" | "live";
  /**
   * True when the provider returns delivery acknowledgements that the gateway
   * can map onto `acked`. File drop and memory never do; their messages stay
   * `sent` until a handler acknowledges out of band.
   */
  readonly acknowledges: boolean;
  send(message: OutboundTypeBMessage): Promise<{ transportReference: string }>;
  /** Optional inbound polling. Each message is returned once. */
  receive?(): Promise<InboundTypeBMessage[]>;
}

export class InMemoryTransport implements TypeBTransport {
  readonly id = "memory";
  readonly mode = "sandbox" as const;
  readonly acknowledges = false;
  readonly sent: OutboundTypeBMessage[] = [];
  private readonly inbox: InboundTypeBMessage[] = [];
  /** When set, `send` rejects with this error (for retry tests). */
  failWith: Error | null = null;

  send(message: OutboundTypeBMessage) {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push(message);
    return Promise.resolve({
      transportReference: `memory:${message.id}:${this.sent.length}`,
    });
  }

  /** Simulate a message arriving from the network. */
  deliver(raw: string, transportReference = `memory-in:${randomUUID()}`) {
    this.inbox.push({ transportReference, raw });
  }

  receive() {
    return Promise.resolve(this.inbox.splice(0));
  }
}

export class FileDropTransport implements TypeBTransport {
  readonly id = "filedrop";
  readonly mode = "sandbox" as const;
  readonly acknowledges = false;
  private readonly outbound: string;
  private readonly inbound: string;
  private readonly processed: string;

  constructor(directory: string) {
    const root = resolve(directory);
    this.outbound = join(root, "outbound");
    this.inbound = join(root, "inbound");
    this.processed = join(root, "inbound", "processed");
    for (const dir of [this.outbound, this.inbound, this.processed])
      mkdirSync(dir, { recursive: true });
  }

  send(message: OutboundTypeBMessage) {
    const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
    const name = `${stamp}-${message.messageType}-${message.id}.txt`;
    // Teletype line ending on the wire.
    writeFileSync(
      join(this.outbound, name),
      message.text.replace(/\n/g, "\r\n"),
      {
        encoding: "utf8",
        flag: "wx",
      }
    );
    return Promise.resolve({ transportReference: `filedrop:${name}` });
  }

  receive() {
    const files = readdirSync(this.inbound, { withFileTypes: true })
      .filter(entry => entry.isFile() && /\.(txt|tbm|typeb)$/i.test(entry.name))
      .map(entry => entry.name)
      .sort();
    const messages: InboundTypeBMessage[] = [];
    for (const name of files) {
      const path = join(this.inbound, name);
      const raw = readFileSync(path, "utf8");
      renameSync(path, join(this.processed, name));
      messages.push({ transportReference: `filedrop:${name}`, raw });
    }
    return Promise.resolve(messages);
  }
}

let memory: InMemoryTransport | null = null;
/** Process-wide in-memory transport so admin tools and the drain share it. */
export function sharedMemoryTransport(): InMemoryTransport {
  memory ??= new InMemoryTransport();
  return memory;
}

export const TYPEB_CONFIG_KEYS = [
  "TYPEB_TRANSPORT",
  "TYPEB_FILEDROP_DIR",
  "TYPEB_ORIGIN_ADDRESS",
  "TYPEB_PNL_LEAD_MINUTES",
  "TYPEB_INGEST_TOKEN",
] as const;

/**
 * Reads `TYPEB_TRANSPORT` (`disabled` by default). `memory` and `filedrop`
 * are sandbox transports. `live` names no adapter in this repository and is
 * refused so a deployment cannot claim connectivity it does not have.
 */
export function configuredTypeBTransport(
  env: NodeJS.ProcessEnv = process.env
): TypeBTransport | null {
  const mode = env.TYPEB_TRANSPORT?.trim() || "disabled";
  if (mode === "disabled") return null;
  if (mode === "memory") return sharedMemoryTransport();
  if (mode === "filedrop") {
    const dir = env.TYPEB_FILEDROP_DIR?.trim();
    if (!dir) throw new Error("TYPEB_FILEDROP_DIR is required for filedrop");
    return new FileDropTransport(dir);
  }
  if (mode === "live")
    throw new Error(
      "No live Type B provider adapter is installed; see docs/architecture/typeb-gateway.md"
    );
  throw new Error("Invalid TYPEB_TRANSPORT");
}
