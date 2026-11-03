import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { buffer } from "node:stream/consumers";
import bwipjs from "bwip-js/node";
import PDFDocument from "pdfkit";
import { responseContracts } from "../../server/contracts/kiosk";

async function main() {
  const [action, inputPath, outputPath, ...extra] = process.argv.slice(2);
  if (
    !inputPath ||
    extra.length ||
    !((action === "label" && outputPath) || (action === "scan" && !outputPath))
  ) {
    throw new Error(
      "Usage: kiosk-printer.ts label response.json test.pdf | scan response.json"
    );
  }
  // Use the decoded kiosk.printBagTag result or its unbatched tRPC HTTP response.
  const body = JSON.parse(
    (await readFile(inputPath, "utf8")).replace(/^\uFEFF/, "")
  );
  const result = responseContracts.printBagTag.safeParse(
    body?.result?.data?.json ?? body
  );
  if (
    !result.success ||
    result.data.totalBags !== 1 ||
    result.data.bagTags.length !== 1
  )
    throw new Error("A document_ready response for one test bag is required.");
  const { tagNumber, barcodeData } = result.data.bagTags[0];
  if (
    tagNumber.length !== 10 ||
    !/^\d{10}$/.test(tagNumber) ||
    barcodeData !== tagNumber
  )
    throw new Error(
      "The registered tag and barcode must be the same ten digits."
    );

  if (action === "scan") {
    console.error(
      "Scan the printed label with the independent reader and press Enter."
    );
    const reader = createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });
    try {
      for await (const line of reader) {
        if (line !== tagNumber)
          throw new Error("MISMATCH: scanner value differs from the AIS tag.");
        console.log("MATCH: scan equals the AIS tag.");
        return;
      }
      throw new Error("No scan received.");
    } finally {
      reader.close();
    }
  }

  const symbol = await bwipjs.toBuffer({
    bcid: "interleaved2of5",
    text: tagNumber,
    scale: 4,
    height: 15,
    paddingwidth: 12,
  });
  const pdf = new PDFDocument({ size: [288, 144], margin: 0 });
  const bytes = buffer(pdf);
  pdf.fontSize(12).text("AIS PRINTER TEST ONLY", 0, 8, { align: "center" });
  pdf.image(symbol, 24, 32, {
    fit: [240, 66],
    align: "center",
    valign: "center",
  });
  pdf.fontSize(16).text(tagNumber, 0, 104, { align: "center" });
  pdf.fontSize(8).text("TEST STOCK - KEEP OUT OF BAGGAGE HANDLING", 0, 128, {
    align: "center",
  });
  pdf.end();
  await writeFile(outputPath, await bytes, { flag: "wx", mode: 0o600 });
  console.log(
    "Test PDF created. Print it on the station printer at actual size."
  );
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
