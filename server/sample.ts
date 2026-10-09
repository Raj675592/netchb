export type LineItem = {
  description: string; tariffNo: string; quantity: number; unit: string; manufacturerId?: string;
  value: number; countryOrigin: string; countryExport?: string; grossWeight?: number;
};

export type EntryDraft = {
  invoiceNo: string; importerTaxId: string; consigneeName: string;
  entryDate: string; entryType: string; entryPort: string; unladingPort: string; processingPort: string; transportMode: string;
  bondType?: string; paymentType?: string;
  arrivalDate: string; vessel: string; voyage: string; carrierCode: string;
  houseBill: string; houseScac: string; masterBill: string; ladingPort: string; stateDestination: string; containerNumbers: string[]; freight: number; insurance: number; packages: number; packageUnit: string;
  grossWeight: number; customerReference: string; lines: LineItem[];
};

export const sampleDraft: EntryDraft = {
  invoiceNo: 'KBAS/NB/26-0912', importerTaxId: '',
  consigneeName: 'NORTHBOUND OUTFITTERS, INC.', entryDate: '',
  entryType: '', entryPort: '', unladingPort: '3002', processingPort: '', transportMode: '11', arrivalDate: '2026-10-14',
  vessel: 'PACIFIC ARGOS', voyage: '041E', carrierCode: 'OPLU',
  houseBill: 'HCM26090418', houseScac: 'BMLV', masterBill: 'OPLUSGN260917735', ladingPort: '', stateDestination: 'WA', containerNumbers: [], freight: 3850, insurance: 185,
  packages: 138, packageUnit: 'CTN', grossWeight: 1930,
  customerReference: 'NB-26-0918',
  lines: [
    { description: "MEN'S CREW NECK SHORT SLEEVE T-SHIRT, 100% COTTON SINGLE JERSEY, 160 GSM, KNITTED", tariffNo: '610910', quantity: 2400, unit: 'PCS', value: 6840, countryOrigin: 'VN', countryExport: 'VN', grossWeight: 480 },
    { description: "WOMEN'S PULLOVER HOODIE WITH KANGAROO POCKET, 60% COTTON 40% POLYESTER BRUSHED FLEECE, 280 GSM, KNITTED", tariffNo: '611020', quantity: 1200, unit: 'PCS', value: 8880, countryOrigin: 'VN', countryExport: 'VN', grossWeight: 774 },
    { description: "MEN'S SLIM FIT CHINO TROUSERS, 98% COTTON 2% ELASTANE STRETCH TWILL, 245 GSM, WOVEN", tariffNo: '620342', quantity: 900, unit: 'PCS', value: 6255, countryOrigin: 'VN', countryExport: 'VN', grossWeight: 522 },
    { description: "WOMEN'S LONG SLEEVE V-NECK BLOUSE, 100% POLYESTER CREPE DE CHINE, WOVEN", tariffNo: '620640', quantity: 600, unit: 'PCS', value: 1260, countryOrigin: 'VN', countryExport: 'VN', grossWeight: 106 },
    { description: "WOMEN'S SHORT SLEEVE POLO SHIRT SAMPLES, 100% COTTON PIQUE, KNITTED", tariffNo: '610610', quantity: 24, unit: 'PCS', value: 24, countryOrigin: 'BD', countryExport: 'VN', grossWeight: 6 },
  ],
};

export const reviewItems = [
  { level: 'blocker', title: 'Importer tax ID and broker profile', detail: 'The documents name Northbound Outfitters, Inc. as buyer/account but provide no importer of record tax ID. NetCHB needs an existing importer profile.' },
  { level: 'blocker', title: 'U.S. HTS classification', detail: 'The invoice supplies six-digit HS headings only. Confirm the full 10-digit HTSUS code and statistical suffix for each style using garment construction, gender, fiber content, weight, and other tariff notes; the six-digit heading is retained as source evidence.' },
  { level: 'blocker', title: 'Entry date, entry/processing ports, bond and payment', detail: 'The documents do not establish the entry date, filer processing port, entry port, entry type, bond, or payment setup. These required NetCHB fields are intentionally omitted when unknown; complete them from the broker account and shipment instructions. Tacoma is recorded separately as the document-supported port of unlading (3002); confirm the exact filer mapping.' },
  { level: 'review', title: 'Shipment PO reconciled; verify one B/L OCR variant', detail: 'NB-26-0918 is the shipment P.O. shown on the invoice and packing list and again in the B/L cargo details. NB-26-0918F is explicitly the separate buyer-fabric P.O. The B/L OCR also reads NB-26-6918 once; visually confirm that line against the original scan.' },
  { level: 'review', title: 'Shipment quantities and weights differ', detail: 'Invoice lists 1,200 hoodies; the packing list shows 1,176, a 24-piece difference. Invoice regular-goods quantity is 5,100 plus 24 FOC samples; packing-list total is 5,100 including the samples. B/L gross weight is 1,930 kg and packing-list gross weight is 1,888 kg. Use the B/L gross weight for the manifest draft, but get shipper confirmation of the 42 kg discrepancy and 24-piece shortage.' },
  { level: 'blocker', title: 'T-shirt invoice extension is inconsistent', detail: 'The invoice prints 2,400 PCS × $2.85 but extends the row to $6,480. The computed extension is $6,840, which reconciles with the printed $23,235 FOB subtotal when combined with the other non-sample rows. The draft uses $6,840 as an arithmetic correction candidate; obtain a corrected invoice or broker approval before filing.' },
  { level: 'blocker', title: 'Buyer-supplied fabric (assist)', detail: 'Invoice discloses 1,450 m of buyer-supplied fabric valued at $4,180 for blouse style W-B220, excluded from the invoice total. Confirm dutiability and add this assist to the appropriate entered value; the current XML does not include it.' },
  { level: 'review', title: 'Sample valuation and origin', detail: '24 polo samples are “FOC” but assigned $1 each for customs, with Bangladesh origin. The invoice excludes them from its $23,235 FOB total; this draft adds $24 as a separate line.' },
  { level: 'review', title: 'Freight and insurance', detail: 'The invoice separately lists $3,850 freight and $185 insurance. They are retained as shipment data but are not allocated into line values. Confirm customs valuation and NetCHB charge treatment with the broker.' },
  { level: 'review', title: 'Foreign lading port and container', detail: 'Enter the source-supported container number and confirm the five-digit foreign lading-port code required by the XSD. Port names are not converted into codes automatically; the source port is not in the XML until its code is verified.' },
  { level: 'review', title: 'Ultimate consignee and house bill SCAC', detail: 'Northbound Outfitters is identified as the account/buyer and is used as the likely ultimate consignee; Cascade Fulfillment appears to be the delivery warehouse. Verify this party mapping. B/L house bill prefix BMLV is split into house SCAC and bill number; confirm filer-specific formatting.' },
  { level: 'blocker', title: 'Textile manufacturer ID (MID)', detail: 'The B/L identifies shipper Saigon Phoenix Garment JSC at Lot C7-C8, Road No. 9, Song Than 2 IP, Di An, Binh Duong, Vietnam. Confirm this is the actual origin-conferring factory (and obtain complete address details) and verify its MID in the broker/ACE reference. Hong Kong seller Kowloon Bay Apparel Sourcing is not a substitute for the factory MID. Bangladesh-origin samples need their own manufacturer evidence.' },
];
