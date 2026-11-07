/**
 * Constructed HOT fixtures for tests. Built from the AIS layout table to look
 * like a billing file from a BSP processing centre (header, one office with a
 * sale and a refund, office totals, country totals, trailer). They are not
 * real BSP files.
 */
import { formatRecord } from "../../services/bsp/dish-records";

export function transaction(
  trnn: number,
  trnc: "TKTT" | "RFND",
  tdnr: string,
  fare: number,
  tax: number,
  commission: number,
  agent = "71234567"
) {
  return [
    formatRecord("BCH02", {
      TRNN: trnn,
      TRNC: trnc,
      AGTN: agent,
      DAIS: "261103",
      TACN: "065",
      CUTP: "SAR2",
      TRCN: 5,
    }),
    formatRecord("BKT06", {
      TRNN: trnn,
      TDNR: tdnr,
      CPUI: "FFVV",
      CJCP: "",
      PXNM: "ALHARBI/AHMED MR",
      STAT: "DOM",
      DAIS: "261103",
      AGTN: agent,
      RTDN: trnc === "RFND" ? tdnr : "",
    }),
    formatRecord("BKS30", {
      TRNN: trnn,
      TDNR: tdnr,
      COBL: fare,
      TMFT1: tax ? "VAT" : "",
      TMFA1: tax,
      TMFT2: "",
      TMFA2: 0,
      TMFT3: "",
      TMFA3: 0,
      TDAM: fare + tax,
      CUTP: "SAR2",
    }),
    formatRecord("BKS39", {
      TRNN: trnn,
      TDNR: tdnr,
      COTP: "STD",
      CORT: 500,
      COAM: commission,
      SPAM: 0,
      TOCA: 0,
    }),
    formatRecord("BKP84", {
      TRNN: trnn,
      TDNR: tdnr,
      FPTP: "CA",
      FPAM: fare + tax,
      FPAC: "",
      CUTP: "SAR2",
    }),
  ];
}

/** Sale net 57000, refund net 22000 → remittance 35000. */
export function hotFixture(
  options: { extra?: string[]; trailerRecords?: number } = {}
) {
  const body = [
    ...transaction(1, "TKTT", "0651234567890", 50000, 9500, 2500),
    ...transaction(2, "RFND", "0651234567891", 20000, 3000, 1000),
  ];
  const records = [
    formatRecord("BFH01", {
      SPED: "261103",
      REVN: "231",
      TPST: "PROD",
      PRDA: "261105",
      PRTM: "0230",
      ISOC: "SA",
      RSID: "DPC1",
      FSEQ: 42,
      TACN: "065",
    }),
    formatRecord("BOH03", {
      AGTN: "71234567",
      RPED: "261103",
      TACN: "065",
      CUTP: "SAR2",
    }),
    ...body,
    ...(options.extra ?? []),
    formatRecord("BOT93", {
      AGTN: "71234567",
      CUTP: "SAR2",
      TCNT: 2,
      TFAR: 70000,
      TTAX: 12500,
      TCOM: 3500,
      TRSG: "+",
      TREM: 35000,
    }),
    formatRecord("BCT95", {
      CUTP: "SAR2",
      TCNT: 2,
      TFAR: 70000,
      TTAX: 12500,
      TCOM: 3500,
      TNSG: "+",
      TNET: 35000,
      TSAL: 59500,
      TRFD: 23000,
    }),
  ];
  records.push(
    formatRecord("BFT99", {
      RCNT: options.trailerRecords ?? records.length + 1,
      TCNT: 2,
      CCNT: 1,
    })
  );
  return records.join("\r\n") + "\r\n";
}
