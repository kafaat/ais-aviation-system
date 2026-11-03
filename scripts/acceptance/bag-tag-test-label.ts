import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import bwipjs from "bwip-js/node";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { responseContracts } from "../../server/contracts/kiosk";

const envelope = z.object({
  result: z.object({ data: z.object({ json: responseContracts.printBagTag }) }),
});

/** Render one pilot label from a kiosk HTTP response. This does not submit a print job. */
export async function renderBagTagTestLabel(input: unknown): Promise<Buffer> {
  const result = z.union([envelope, z.tuple([envelope])]).safeParse(input);
  if (!result.success)
    throw new Error("Expected one successful kiosk.printBagTag response.");
  const response = Array.isArray(result.data) ? result.data[0] : result.data;
  const { bagTags, totalBags } = response.result.data.json;
  if (totalBags !== 1 || bagTags.length !== 1)
    throw new Error("Request exactly one registered test bag.");
  const { tagNumber, barcodeData } = bagTags[0];
  if (!/^\d{10}$/.test(tagNumber) || barcodeData !== tagNumber)
    throw new Error("The barcode must match the ten-digit registered tag.");

  const barcode = await bwipjs.toBuffer({
    bcid: "code128",
    text: tagNumber,
    scale: 4,
    height: 14,
  });
  // Four by two inches. Keep the barcode quiet zones clear of all text.
  const pdf = new PDFDocument({ size: [288, 144], margin: 0 });
  pdf
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("AIS STATION TEST - NOT FOR TRAVEL", 0, 13, { align: "center" });
  pdf.image(barcode, 48, 37, {
    fit: [192, 55],
    align: "center",
    valign: "center",
  });
  pdf
    .font("Courier-Bold")
    .fontSize(15)
    .text(tagNumber, 0, 101, { align: "center" });
  pdf.end();
  const chunks: Buffer[] = [];
  for await (const chunk of pdf) chunks.push(chunk);
  return Buffer.concat(chunks);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length)
    throw new Error(
      "Usage: node --import tsx scripts/acceptance/bag-tag-test-label.ts response.json new-label.pdf"
    );
  const label = await renderBagTagTestLabel(
    JSON.parse(await readFile(input, "utf8"))
  );
  await writeFile(output, label, { flag: "wx", mode: 0o600 });
  console.log("Test PDF created. Physical printing and scanning are pending.");
}
