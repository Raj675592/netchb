# Sefer Entry Workbench

A small TypeScript full-stack prototype for turning shipment paperwork into an editable entry draft and NetCHB Entry Upload XML. It includes a sample based on the commercial invoice, packing list, and house bill of lading in the supplied Drive folder.

## Run locally

Requires Node.js 20.19+ (or 22+) and npm. MongoDB is optional for running the app; a local MongoDB server or MongoDB Atlas connection is needed only for saving and reopening entries. Poppler's `pdftoppm` must be on `PATH` for scanned-PDF OCR; set `PDFTOPPM_PATH` if the executable is elsewhere. Selectable-text PDFs and the sample view do not require MongoDB or Poppler.

For a local MongoDB server, start MongoDB as a service or run this from the project directory in a separate terminal. On Windows, create the data folder first with `New-Item -ItemType Directory -Force .local-mongodb`.

```bash
mongod --dbpath .local-mongodb --bind_ip 127.0.0.1
```

```bash
npm install
cp .env.example .env
npm run dev
```

Edit `.env` only for integrations you need. Set `MONGODB_URI` to enable saved entries; `MONGODB_DB` is optional and defaults to `sefer_entry_workbench`. Set `OPENAI_API_KEY` only if you want to enable the opt-in AI extraction checkbox. Keep `.env` private; it is excluded from Git. Open [http://localhost:5173](http://localhost:5173). For local-only handling of shipment records and documents, the Vite frontend and API bind to `127.0.0.1`; the API accepts browser origins from the two local development URLs. `APP_ORIGINS` can explicitly allow additional comma-separated frontend origins when needed. Vite proxies `/api` calls to the Express API on port 8787. The API uses the official [MongoDB Node.js driver](https://www.mongodb.com/docs/drivers/node/current/connect/).

## How to use the app

1. **Start a shipment.** Choose **New entry** for a blank shipment. Choose **Load demo** to see the supplied sample shipment and its review notes.
2. **Upload the paperwork.** From the shipment screen, select **Add shipment documents** or open **Documents** and select **Add documents**. Upload the commercial invoice, packing list, and bill of lading as PDF, JPG, or PNG files (up to 20 MB each). You can add more documents later.
3. **Review the generated draft.** Upload automatically creates an editable first-pass draft from the new documents. The Documents tab also shows source-linked candidates and extracted text; use **Apply** only for additional values you have checked. Uploading while the sample is displayed replaces sample values instead of mixing them into the new shipment. Inspect every field and add missed invoice lines manually.
4. **Choose the extraction mode.** Local rules and OCR are the default. The **Use optional AI extraction** checkbox is off by default. If enabled and `OPENAI_API_KEY` is configured, extracted text is sent to OpenAI for structured extraction; file binaries are not sent. Do not opt in unless your organization permits that processing. If the key is absent or the request fails, the app reports the fallback and uses a local candidate draft.
5. **Complete the shipment draft.** Verify parties, invoice number, routing, bills, package count, weight, origin, quantities, and values. Correct fields directly or use **Add line** for a missed line. Use the per-line USITC link to look up the current tariff schedule. Enter full HTSUS codes and validated manufacturer IDs only after broker review. Tacoma is recorded as the source-supported unlading port (3002), separately from entry and processing ports, which remain blank until confirmed.
6. **Set broker-specific details.** Open **Broker settings** to enter importer number, processing port, entry type, transport mode, bond type, and payment type if supplied by the importer or broker. Use **Apply to current entry** to copy those defaults into the current draft. The settings are held in the browser session; they do not verify the broker's NetCHB profile.
7. **Work through the review checklist.** Review the items under **Needs your review** and the full checklist on the **NetCHB XML** tab. Resolve document conflicts with the shipper and account-dependent or classification questions with the broker. The sample T-shirt line uses the computed $6,840 (2,400 × $2.85), rather than the invoice's printed $6,480, because it reconciles the printed $23,235 subtotal; obtain a corrected invoice or broker approval. The app flags the discrepancy.
8. **Preview and export the XML draft.** Open **NetCHB XML** to inspect the generated XML. Use **Copy** or **Download XML** to save a local `.xml` draft. The XML screen identifies missing required fields and any omitted invoice lines without a usable source tariff/value. Unknown values are omitted rather than defaulted. The XML is **NOT FILED**, excludes `<transmit/>`, and may fail XSD validation until required fields are completed. There has been no live NetCHB endpoint test; this app does not upload to NetCHB or CBP.

### Saving and reopening entries

After starting a new shipment and adding its documents, select **Save entry** in the top bar. This creates a MongoDB record. The app then saves later changes automatically and shows a **Saved to MongoDB** status. Select **Shipment entries** in the sidebar to view saved drafts, then choose **Open entry** to continue one. Use the trash icon on a saved row to delete that draft after confirming. The app stores the shipment draft, review notes, extracted candidates, and document names/metadata. It does not store uploaded file bytes or full extracted document text. If the app reports that MongoDB is not connected, verify `.env`, make sure the database is running or reachable, and restart `npm run dev`.

### Before filing

Treat every extracted value as a suggestion and compare it with the originals. The sample uses a computed $6,840 T-shirt extension (2,400 × $2.85) that reconciles the printed $23,235 subtotal, while the invoice prints $6,480; obtain a corrected invoice or broker approval. Hoodie quantity, gross weight, and buyer-supplied fabric treatment also need confirmation. The documents do not supply the importer's CBP number, broker processing port, bond/payment setup, full 10-digit HTSUS classifications, or validated manufacturer IDs. These must come from the importer, broker, supplier, or appropriate current tariff references. The app produces a reviewable draft, not a guaranteed filing-ready entry.

Selectable PDF text is extracted directly. Tesseract.js performs OCR locally for JPG/PNG files and the first eight pages of text-poor PDFs; Poppler renders scanned PDF pages at 200 DPI. That resolution recovered the sample bill-of-lading master number in a targeted OCR comparison; every OCR result still needs source review. Scanned PDF bytes and rendered pages are written to a temporary OS directory and removed after processing. The first OCR run downloads English language data and needs network access. OCR results and line candidates are suggestions for review.

Create the example XML from the saved sample data with:

```bash
npm run generate:sample
```

Build the production client and type-check both TypeScript projects with:

```bash
npm run build
```

## What it does

- React/TypeScript frontend with editable header fields and line items, document upload, extracted-text review, and XML copy/download.
- Express/TypeScript API for PDF text extraction, local OCR, automatic editable-draft creation, conservative candidates, optional explicit-consent OpenAI structured extraction, and XML serialization. Local rules remain best effort; conflicts stay reviewable and irregular or wrapped invoice tables may need manual entry.
- MongoDB-backed shipment records with saved-entry listing, reopening, and automatic updates after the first save. Configure the connection through the untracked `.env` file; uploaded files and raw extracted text are not persisted.
- `entry.xsd`, `data_type.xsd`, and `entry-sample.xml` are included as the NetCHB entry-service schema/reference. NetCHB's schema namespace and schema URL are present in its own sample request; its public web-services page lists `uploadEntry` and related methods. A current [Strix entry API reference](https://strixsmart.com/resources/api/entry) publishes the schema files and says they are pulled from the live source. The NetCHB [entry response documentation](https://www.netchb.com/xml/entry/entryUploadResponse.html) explains that an `<accepted>` upload response only confirms system upload, not CBP acceptance.
- The XML generator uses the referenced root/sequence (`entry-no`, `header`, `manifest`, `invoices`) and omits `<transmit/>`. Missing schema-required fields are omitted rather than silently defaulted, so draft XML may fail validation. It does not connect to NetCHB or claim the entry is ready for filing.

## Verification status

As of 9 October 2026, `npm run build` succeeds. The supplied commercial invoice, packing list, and bill of lading were processed once through the local upload API with AI disabled: selectable invoice text was extracted, the two scanned PDFs used local OCR, and the API produced five invoice-line candidates and 19 review candidates. That run recovered the invoice number and PO, but did not recover the master bill at the then-current OCR resolution. A targeted OCR comparison on the B/L page found that 200 DPI read `OPLUSGN260917735`; 150 and 300 DPI did not. The OCR default is now 200 DPI, but the complete three-document upload has not been repeated after that resolution change. The browser file chooser declined permission for a UI upload, so this specific source-document run was verified at the local API, not through the browser interface.

The optional OpenAI path was exercised using synthetic text only. The API returned `429 insufficient_quota`; the app retained a local draft and reported the fallback. Adding API credits is required before AI extraction can succeed. The `/api/health` `llmConfigured` flag only means a key is present; it does not verify quota or successful access. The sample XML currently omits broker-only required header values and fails the local XSD check until those are provided. There has been no live NetCHB endpoint test.

If the OpenAI key previously pasted into chat is still active, revoke it and replace it in the local, Git-ignored `.env` file before using AI extraction.

## Important limits

The prototype is a review workflow, not a customs broker or an automated filing system. There has been no live NetCHB endpoint integration or acceptance test. It does not provide a validated current HTSUS classification, duty or trade-remedy calculation, importer/bond profile lookup, assist/freight allocation, PGA determination, or production-grade field confidence. Manufacturer IDs are editable per line but are never generated automatically: CBP requires the actual origin-conferring manufacturer details, and textile MID errors can cause rejection. See [CBP textile MID guidance](https://www.help.cbp.gov/s/article/Article-1242?language=en_US) and [CBP importer number guidance](https://www.help.cbp.gov/s/article/Article-1066?language=en_US). The HTS links open the current [USITC tariff schedule](https://hts.usitc.gov/?showFullTree=true); six-digit invoice headings remain source evidence only.

OCR runs locally; the first OCR request downloads English language data for Tesseract.js. Uploaded files are held in memory except scanned-PDF conversion, which uses a temporary OS directory that is cleaned up. Scanned PDFs are limited to their first eight pages per OCR pass. The row parser deliberately skips uncertain layouts. Review alerts intentionally preserve conflicts instead of silently reconciling them. NetCHB upload XML is generated for review without a `<transmit/>` element; it is not transmitted to NetCHB or CBP.

The sample interpretation and open questions are summarized in [APPROACH.md](./APPROACH.md). The generated deliverable is [sample-entry.xml](./sample-entry.xml).

## NetCHB references

- [NetCHB public XML web-services directory](https://www.netchb.com/main/services/JamcoXmlUploadService) — lists the EntryUploadService operations, including `uploadEntry`, `amendEntry`, `queryEntryStatus`, and `updateBol`.
- [NetCHB entry upload response explanations](https://www.netchb.com/xml/entry/entryUploadResponse.html)
- [Entry XSD mirror and reference downloads](https://strixsmart.com/resources/api/entry) — current integration reference with downloadable XSD, WSDL, and sample request.
- [CBP Tacoma port record (port 3002)](https://www.cbp.gov/sites/default/files/2025-06/CF1401%20-%20Record%20of%20Vessel%20in%20Foreign%20Trade%20-%20Clearances.pdf)

## Project layout

```text
src/                 React/TypeScript interface
server/              Express API, sample data, XML serializer
entry.xsd             NetCHB entry upload schema reference
data_type.xsd         Shared XML schema types
entry-sample.xml      NetCHB example request reference
sample-entry.xml      Generated sample shipment XML draft
APPROACH.md           One-page sample interpretation and next steps
```
