# Shipment analysis and approach

## What the prototype does

The app extracts selectable PDF text and runs local OCR at 200 DPI for scanned PDFs and images. Each upload creates an editable first-pass draft using local candidate mapping, or an optional OpenAI structured-extraction request after explicit user opt-in. Source-linked candidates remain available for review. The XML follows the included NetCHB schema reference and does not include `<transmit/>`; it is a draft export, not a filing or a guarantee of acceptance. The upload flow is generalized, but extraction is best effort and needs review on every shipment.

## Verification note (9 October 2026)

The supplied three PDFs were processed through the local upload API with AI disabled: invoice text was selectable, while the packing list and B/L used OCR. The API returned the invoice number and PO, five line candidates, and 19 review candidates. The first full upload did not recover the master bill; a targeted OCR comparison of the B/L page read `OPLUSGN260917735` at 200 DPI, but not at 150 or 300 DPI. The OCR default now uses 200 DPI; the full upload has not been repeated after that change, so the master-bill field remains subject to review. The browser blocked the separate UI file-picker attempt, and no source document text was sent to OpenAI.

The optional OpenAI route was tested with synthetic text and returned `429 insufficient_quota`; the app fell back to local extraction. AI extraction needs API credits. The sample XML fails the local XSD check while required broker-specific header fields are blank. No live NetCHB endpoint was tested.

## Findings for the supplied shipment

The invoice identifies `KBAS/NB/26-0912` and buyer PO `NB-26-0918`. That PO is repeated across the commercial invoice, packing list, and bill of lading. `NB-26-0918F` is labeled as the buyer-supplied fabric PO, not the shipment PO; `NB-26-6918` occurs once in OCR and appears to be a one-character scan variant. The app now explains this distinction and prevents the fabric PO or likely OCR variant from being applied as the shipment reference without review.

The invoice lists 1,200 hoodies, while the packing list reports 1,176, a 24-piece discrepancy. The invoice prints 2,400 T-shirts at $2.85 each but extends that row to $6,480; the arithmetic product is $6,840. Correcting that extension would make the four non-sample printed rows total the stated $23,235 FOB subtotal. The draft uses the computed $6,840 because it reconciles the printed $23,235 FOB subtotal; the invoice should be corrected or broker approval obtained before filing. The invoice separately lists 24 FOC samples for $24 and excludes them from that subtotal. The packing list reports 1,888 kg gross; the B/L reports 1,930 kg. The draft treats the B/L figure as the manifest candidate while retaining the conflict for confirmation; it does not average the two weights.

The B/L identifies 138 cartons, vessel `PACIFIC ARGOS`, voyage `041E`, house bill `BMLVHCM26090418`, master bill `OPLUSGN260917735`, carrier `OPLU`, Tacoma discharge, and 14 October 2026 ETA. The draft uses Tacoma discharge port 3002 when supported by the document, but the processing and entry ports are filer-specific and left blank pending confirmation; the unlading port is held separately. Invoice lines show six-digit HS headings only. The invoice also discloses $4,180 of buyer-supplied fabric for one style, excluded from the invoice total; its treatment and allocation in customs value require broker review. The source invoice number contains slashes; the XML serializer maps disallowed punctuation to hyphens to satisfy the NetCHB invoice-number XSD pattern. Unknown required header values are omitted rather than replaced with a placeholder, so this sample XML is intentionally incomplete until the broker supplies them. It has not been tested against a live NetCHB endpoint.

## Still required before a broker can file

The shipment papers do not provide the importer's CBP number, broker processing port, bond type, or payment type. They also do not establish the full U.S. 10-digit HTSUS classifications or the validated manufacturer ID for each origin-conferring factory. The B/L names a Vietnam factory, but the importer or broker should validate its identity and MID; the Hong Kong seller is not a substitute. Any Bangladesh-origin samples need their own manufacturer evidence. The prototype provides editable fields and official reference links, but deliberately does not guess these values, calculate duty, determine assist dutiability, or transmit an entry.

## With more time

I would add page-and-region citations with calibrated extraction confidence, broader multi-page OCR controls, a labeled evaluation set across varied shipment documents, and a broker profile integration. I would evaluate local and LLM extraction on varied invoices and test the resulting XML with a licensed NetCHB test endpoint and broker-provided test cases. I would also add explicit reconciliation workflows for quantities and valuation, assist allocation, current HTSUS and trade-remedy validation, and schema validation in the export workflow. A production system should track source provenance and revisions for each field and require broker sign-off before transmission.
