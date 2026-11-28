export type ChatSendStatus =
  | "sendBusy"
  | "sendTimedOut"
  | "sendLimited"
  | "replyUnavailable"
  | "sendUnknown"
  | "waitStopped";

/** Only the server's typed admission codes prove that this input was not saved.
 * HTTP timeouts, local aborts and error text cannot establish that boundary. */
export function chatSendFailure(error: unknown): {
  status: ChatSendStatus;
  unaccepted: boolean;
  reconcile: boolean;
} {
  const data =
    typeof error === "object" && error !== null && "data" in error
      ? error.data
      : undefined;
  const code =
    typeof data === "object" && data !== null && "code" in data
      ? data.code
      : undefined;

  switch (code) {
    case "CONFLICT":
      return { status: "sendBusy", unaccepted: true, reconcile: false };
    case "TIMEOUT":
      return { status: "sendTimedOut", unaccepted: true, reconcile: false };
    case "TOO_MANY_REQUESTS":
      return { status: "sendLimited", unaccepted: true, reconcile: false };
    case "PRECONDITION_FAILED":
      return { status: "replyUnavailable", unaccepted: false, reconcile: true };
    default:
      return { status: "sendUnknown", unaccepted: false, reconcile: false };
  }
}
