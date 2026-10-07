export type LineItem = {
  description: string; tariffNo: string; quantity: number; unit: string;
  value: number; countryOrigin: string; countryExport?: string; grossWeight?: number;
};

export type EntryDraft = {
  invoiceNo: string; importerTaxId: string; consigneeName: string;
  entryDate: string; entryType: string; entryPort: string; processingPort: string; transportMode: string;
  arrivalDate: string; vessel: string; voyage: string; carrierCode: string;
  houseBill: string; masterBill: string; packages: number; packageUnit: string;
  grossWeight: number; customerReference: string; lines: LineItem[];
};

export const sampleDraft: EntryDraft = {
  invoiceNo: 'KBAS-NB-26-0912', importerTaxId: '',
  consigneeName: 'CASCADE FULFILLMENT PARTNERS LLC', entryDate: '2026-10-07',
  entryType: '01', entryPort: '3002', processingPort: '3002', transportMode: '11', arrivalDate: '2026-10-14',
  vessel: 'PACIFIC ARGOS', voyage: '041E', carrierCode: 'OPLU',
  houseBill: 'BMLVHCM26090418', masterBill: 'OPLUSNG260917735',
  packages: 138, packageUnit: 'CTNS', grossWeight: 1930,
  customerReference: 'NB-26-0918',
  lines: [
    { description: "MEN'S CREW NECK SHORT SLEEVE T-SHIRT, 100% COTTON, KNIT", tariffNo: '610910', quantity: 2400, unit: 'PCS', value: 6480, countryOrigin: 'VN', countryExport: 'VN', grossWeight: 480 },
    { description: "WOMEN'S PULLOVER HOODIE, 60% COTTON 40% POLYESTER, KNIT", tariffNo: '611020', quantity: 1200, unit: 'PCS', value: 8880, countryOrigin: 'VN', countryExport: 'VN', grossWeight: 774 },
    { description: "MEN'S SLIM FIT CHINO TROUSERS, 98% COTTON 2% ELASTANE, WOVEN", tariffNo: '620342', quantity: 900, unit: 'PCS', value: 6255, countryOrigin: 'VN', countryExport: 'VN', grossWeight: 522 },
    { description: "WOMEN'S LONG SLEEVE BLOUSE, 100% POLYESTER, WOVEN", tariffNo: '620640', quantity: 600, unit: 'PCS', value: 1260, countryOrigin: 'VN', countryExport: 'VN', grossWeight: 106 },
    { description: "WOMEN'S SHORT SLEEVE POLO SHIRT SAMPLES, 100% COTTON, KNIT", tariffNo: '610610', quantity: 24, unit: 'PCS', value: 24, countryOrigin: 'BD', countryExport: 'VN', grossWeight: 6 },
  ],
};

export const reviewItems = [
  { level: 'blocker', title: 'Importer tax ID and broker profile', detail: 'The documents name Northbound Outfitters, Inc. as buyer/account but provide no importer of record tax ID. NetCHB needs an existing importer profile.' },
  { level: 'blocker', title: 'U.S. HTS classification', detail: 'The invoice supplies six-digit HS headings only; those source headings are carried into the XML. Confirm the full U.S. HTSUS classification and current duty treatment before filing.' },
  { level: 'blocker', title: 'Entry date, processing port, bond and payment', detail: 'The draft date is today, not a confirmed entry date. Entry type 01, processing port, bond type and payment type are assumptions or missing; confirm these against the broker account and shipment entry instructions. Tacoma port 3002 is mapped from the B/L.' },
  { level: 'review', title: 'Invoice, packing list and B/L do not reconcile', detail: 'Invoice lists 1,200 hoodies and 24 samples in addition to 5,100 regular units; packing list has 1,176 hoodies and 24 samples, with 5,100 total units. B/L gross weight is 1,930 kg; packing list says 1,888 kg.' },
  { level: 'blocker', title: 'Invoice line values do not match the stated subtotal', detail: 'The five printed line values are $6,480 + $8,880 + $6,255 + $1,260 + $24 = $22,899. The page 2 subtotal says $23,235 for items 1–4 (a $360 difference) and excludes the samples. Draft line values follow the printed line amounts; request a corrected invoice or confirmation.' },
  { level: 'blocker', title: 'Buyer-supplied fabric (assist)', detail: 'Invoice discloses 1,450 m of buyer-supplied fabric valued at $4,180 for blouse style W-B220, excluded from the invoice total. Confirm dutiability and add this assist to the appropriate entered value; the current XML does not include it.' },
  { level: 'review', title: 'Sample valuation and origin', detail: '24 polo samples are “FOC” but assigned $1 each for customs, with Bangladesh origin. The invoice excludes them from its $23,235 FOB total; this draft adds $24 as a separate line.' },
  { level: 'review', title: 'Freight and insurance', detail: 'CIF invoice total $27,270 equals $23,235 FOB + $3,850 freight + $185 insurance and excludes the $24 samples. Confirm transaction value treatment and allocation; draft values omit separately itemized international freight and insurance.' },
  { level: 'review', title: 'Manufacturer ID (MID)', detail: 'Factory is identified as Saigon Phoenix Garment JSC in Binh Duong, Vietnam, but its validated CBP MID is not provided. Generate/verify MID from the manufacturer address before entry.' },
];
