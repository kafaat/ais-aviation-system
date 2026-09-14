/** On-call provider adapter (R2-09).
 *
 * Targets GoAlert's generic API, which accepts an incident by POST with a
 * `summary`, `details` and a caller-chosen `dedup` key, and closes the same
 * incident with `action=close` and the same key:
 *   https://github.com/target/goalert
 *
 * The dedup key is load-bearing, not decoration. It is what makes a retry
 * after a lost response safe: the provider collapses a repeat of the same key
 * into the incident it already has, so re-sending cannot page anyone twice.
 * A provider that did not do that would need operator reconciliation instead,
 * which is why `dedupes` is part of the interface and is asserted before any
 * retry — a future adapter cannot quietly inherit retry safety it lacks.
 *
 * Nothing here decides who is on call, what the rotation is, or whether a
 * person answered. Those live in the provider.
 */
import { createHash } from "node:crypto";
import type { OnCallDispatch } from "../../shared/on-call";

const REQUEST_TIMEOUT_MS = 10_000;

export interface OnCallProvider {
  mode: "sandbox" | "live";
  /** The service or integration the operator recorded as accepted. */
  reference: string;
  /** True only for a provider that collapses repeats of one dedup key into a
   * single incident. Retry-after-unknown depends on this. */
  dedupes: true;
  send(dispatch: OnCallDispatch): Promise<void>;
}

export interface OnCallConfig {
  mode: "sandbox" | "live";
  baseUrl: string;
  token: string;
  reference: string;
}

export function createGoAlertProvider(config: OnCallConfig): OnCallProvider {
  return {
    mode: config.mode,
    reference: config.reference,
    dedupes: true,
    async send(dispatch) {
      const url = new URL(
        "api/v2/generic/incoming",
        config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`
      );
      // The token is a credential, so it travels as a header rather than in a
      // query string that proxies and access logs would capture.
      const body = new URLSearchParams({
        summary: dispatch.summary,
        details: dispatch.details,
        dedup: dispatch.dedupKey,
        ...(dispatch.action === "close" ? { action: "close" } : {}),
      });
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Bearer ${config.token}`,
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok)
        // The body is not echoed: provider errors can quote the request,
        // including its credential.
        throw new Error(
          `On-call provider rejected the dispatch (${response.status} ${response.statusText})`
        );
    },
  };
}

/** Reads `ONCALL_MODE` (`disabled` by default, so an unconfigured deployment
 * pages nobody and says so rather than pretending to).
 *
 * `live` additionally requires `ONCALL_ACCEPTANCE_REFERENCE`: a rotation that
 * has never been exercised is not an on-call capability, so an operator has to
 * record the service they accepted before live pages are sent. */
export function configuredOnCallProvider(): OnCallProvider | null {
  const mode = process.env.ONCALL_MODE;
  if (!mode || mode === "disabled") return null;
  if (mode !== "sandbox" && mode !== "live")
    throw new Error("Invalid ONCALL_MODE");
  const baseUrl = process.env.ONCALL_BASE_URL?.trim();
  const token = process.env.ONCALL_TOKEN?.trim();
  if (!baseUrl || !token) throw new Error("On-call provider is not configured");
  if (mode === "live" && !process.env.ONCALL_ACCEPTANCE_REFERENCE?.trim())
    throw new Error("Live on-call delivery requires recorded acceptance");
  const reference =
    mode === "live"
      ? (process.env.ONCALL_ACCEPTANCE_REFERENCE as string).trim()
      : // Identifies the target without storing the credential itself.
        `sandbox:${createHash("sha256").update(`${baseUrl}:${token}`).digest("hex").slice(0, 32)}`;
  return createGoAlertProvider({
    mode,
    baseUrl,
    token,
    reference: reference.slice(0, 255),
  });
}
