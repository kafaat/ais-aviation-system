/**
 * RET transport boundary. The platform hands a generated file to a transport
 * adapter; the adapter is responsible for delivery to the BSP data processing
 * centre over the channel fixed in the link agreement (NDCLink, IFG or a
 * direct link). No adapter in this repository talks to an external system.
 *
 * Adapter contract: `transmit` receives the immutable file (name, content,
 * SHA-256) and returns a delivery reference the operator can quote to the
 * BSP. It must not alter the content; the service re-validates the hash
 * before calling it. Configuration:
 *   BSP_RET_TRANSPORT=file_drop   write the file into BSP_RET_DROP_DIR
 *                                 (a directory a certified gateway polls)
 *   unset                         transmission refused
 */
import { TRPCError } from "@trpc/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";

export interface RetTransportFile {
  fileName: string;
  content: string;
  sha256: string;
}

export interface RetTransportReceipt {
  reference: string;
  transmittedAt: Date;
}

export interface RetTransport {
  readonly kind: string;
  transmit(file: RetTransportFile): Promise<RetTransportReceipt>;
}

export function fileDropTransport(directory: string): RetTransport {
  return {
    kind: "file_drop",
    async transmit(file) {
      await mkdir(directory, { recursive: true });
      const path = join(directory, basename(file.fileName));
      // "wx" refuses to overwrite: a file name is reported once.
      await writeFile(path, file.content, { encoding: "utf8", flag: "wx" });
      return { reference: `file_drop:${path}`, transmittedAt: new Date() };
    },
  };
}

export function resolveRetTransport(
  env: NodeJS.ProcessEnv = process.env
): RetTransport {
  if (env.BSP_RET_TRANSPORT === "file_drop" && env.BSP_RET_DROP_DIR)
    return fileDropTransport(env.BSP_RET_DROP_DIR);
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "No RET transport is configured. Set BSP_RET_TRANSPORT=file_drop and BSP_RET_DROP_DIR, or install the adapter named in the BSP link agreement.",
  });
}
