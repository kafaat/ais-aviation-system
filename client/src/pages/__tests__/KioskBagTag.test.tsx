import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import KioskBagTag from "../KioskBagTag";
import i18n from "@/i18n/config";
import { createTrpcFixture, deferred } from "@/test/trpc-fixture";

const tagNumber = "0065000001";
const privateName = "Synthetic Private Traveler";
const documentVersion = "a".repeat(64);
const receipt = {
  bookingRef: "ABC123",
  lastName: "Traveler",
  tagNumber,
};
const tagDocument = () => ({
  printStatus: "document_ready",
  totalBags: 1,
  passengerName: privateName,
  documentVersion,
  bagTags: [
    {
      tagNumber,
      barcodeData: tagNumber,
      flightNumber: "XX102",
      origin: "JED",
      destination: "RUH",
      bookingReference: "ABC123",
      printedAt: null,
    },
  ],
});
let print: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  vi.useFakeTimers();
  print = vi.spyOn(window, "print").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  print.mockRestore();
  vi.useRealTimers();
});

async function elapse(ms = 20) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function visit(handler: (input: unknown) => unknown = tagDocument) {
  const fixture = createTrpcFixture({ "kiosk.reprintRegisteredTag": handler });
  const view = render(<KioskBagTag />, { wrapper: fixture.Wrapper });
  return { ...fixture, ...view };
}

async function lookup() {
  fireEvent.change(screen.getByLabelText(i18n.t("manageBooking.reference")), {
    target: { value: " ABC123 " },
  });
  fireEvent.change(screen.getByLabelText(i18n.t("manageBooking.surname")), {
    target: { value: " Traveler " },
  });
  fireEvent.change(screen.getByLabelText("10-digit bag tag number"), {
    target: { value: tagNumber },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Find registered tag" }).closest("form")!
  );
  await elapse();
}

function cachedPrivateData(fixture: ReturnType<typeof visit>) {
  return JSON.stringify(
    fixture.cache
      .getMutationCache()
      .getAll()
      .map(mutation => mutation.state)
  );
}

it("renders the real ten-digit barcode and revalidates the same document version before opening print", async () => {
  const fixture = visit();
  await lookup();
  expect(document.body).toHaveTextContent(privateName);
  const barcode = screen.getAllByRole("img", {
    name: "Bag tag barcode",
    hidden: true,
  })[0];
  expect(decodeURIComponent(barcode.getAttribute("src") ?? "")).toContain(
    "<svg"
  );
  expect(fixture.requests).toEqual([
    { path: "kiosk.reprintRegisteredTag", input: receipt },
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Reprint this tag" }));
  await elapse();
  expect(fixture.requests[1]).toEqual({
    path: "kiosk.reprintRegisteredTag",
    input: { ...receipt, expectedVersion: documentVersion },
  });
  expect(print).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Physical printing is unconfirmed"
  );
  fireEvent.click(screen.getByRole("button", { name: "No tag came out" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "You reported no printed copy"
  );
});

it("keeps a failed print dialog retryable without claiming physical output", async () => {
  visit();
  await lookup();
  print.mockImplementationOnce(() => {
    throw new Error("Printer unavailable");
  });
  fireEvent.click(screen.getByRole("button", { name: "Reprint this tag" }));
  await elapse();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Could not open the print dialog"
  );
  expect(document.body).toHaveTextContent(tagNumber);
  fireEvent.click(screen.getByRole("button", { name: "Reprint this tag" }));
  await elapse();
  expect(print).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Physical printing is unconfirmed"
  );
});

it("hides a stale document when the server refuses version revalidation and never opens print", async () => {
  let calls = 0;
  visit(() => {
    if (++calls > 1) throw new Error("Bag document changed");
    return tagDocument();
  });
  await lookup();
  fireEvent.click(screen.getByRole("button", { name: "Reprint this tag" }));
  await elapse();
  expect(document.body).not.toHaveTextContent(privateName);
  expect(document.getElementById("kiosk-print-copy")).toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent(
    i18n.t("kioskBagTag.unavailable")
  );
  expect(print).not.toHaveBeenCalled();
});

it("clears both the unattended document and its private mutation data after two minutes", async () => {
  const fixture = visit();
  await lookup();
  expect(cachedPrivateData(fixture)).toContain(privateName);
  await elapse(120001);
  expect(document.body).not.toHaveTextContent(privateName);
  expect(document.getElementById("kiosk-print-copy")).toBeNull();
  expect(cachedPrivateData(fixture)).not.toContain(privateName);
  expect(cachedPrivateData(fixture)).not.toContain(tagNumber);
  expect(screen.getByLabelText(i18n.t("manageBooking.surname"))).toHaveValue(
    ""
  );
});

it("finishes with empty form fields and no cached receipt data", async () => {
  const fixture = visit();
  await lookup();
  fireEvent.click(screen.getByRole("button", { name: "Finish and clear" }));
  await elapse();
  expect(document.body).not.toHaveTextContent(privateName);
  expect(cachedPrivateData(fixture)).not.toContain(tagNumber);
  expect(screen.getByLabelText(i18n.t("manageBooking.reference"))).toHaveValue(
    ""
  );
  expect(screen.getByLabelText(i18n.t("manageBooking.surname"))).toHaveValue(
    ""
  );
  expect(screen.getByLabelText("10-digit bag tag number")).toHaveValue("");
});

it("does not print a late revalidation response after the kiosk times out", async () => {
  const pending = deferred<ReturnType<typeof tagDocument>>();
  let calls = 0;
  const fixture = visit(() =>
    ++calls === 1 ? tagDocument() : pending.promise
  );
  await lookup();
  fireEvent.click(screen.getByRole("button", { name: "Reprint this tag" }));
  await elapse();
  await elapse(120001);
  expect(document.body).not.toHaveTextContent(privateName);
  await act(() => pending.resolve(tagDocument()));
  await elapse();
  expect(print).not.toHaveBeenCalled();
  expect(document.getElementById("kiosk-print-copy")).toBeNull();
  expect(cachedPrivateData(fixture)).not.toContain(privateName);
});

it("allows the passenger to clear during a slow revalidation and ignores its late result", async () => {
  const pending = deferred<ReturnType<typeof tagDocument>>();
  let calls = 0;
  const fixture = visit(() =>
    ++calls === 1 ? tagDocument() : pending.promise
  );
  await lookup();
  fireEvent.click(screen.getByRole("button", { name: "Reprint this tag" }));
  await elapse();
  const finish = screen.getByRole("button", { name: "Finish and clear" });
  expect(finish).toBeEnabled();
  fireEvent.click(finish);
  expect(document.body).not.toHaveTextContent(privateName);
  await act(() => pending.resolve(tagDocument()));
  await elapse();
  expect(print).not.toHaveBeenCalled();
  expect(document.body).not.toHaveTextContent(privateName);
  expect(cachedPrivateData(fixture)).not.toContain(tagNumber);
});

it("does not print after the page unmounts during revalidation", async () => {
  const pending = deferred<ReturnType<typeof tagDocument>>();
  let calls = 0;
  const fixture = visit(() =>
    ++calls === 1 ? tagDocument() : pending.promise
  );
  await lookup();
  fireEvent.click(screen.getByRole("button", { name: "Reprint this tag" }));
  await elapse();
  fixture.unmount();
  await act(() => pending.resolve(tagDocument()));
  await elapse();
  expect(print).not.toHaveBeenCalled();
  expect(document.getElementById("kiosk-print-copy")).toBeNull();
});
