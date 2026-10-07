# Sefer Entry Workbench

A small TypeScript full-stack prototype for turning shipment paperwork into an editable entry draft and NetCHB Entry Upload XML. It includes a sample based on the commercial invoice, packing list, and house bill of lading in the supplied Drive folder.

## Run locally

Requires Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite serves the React client and proxies `/api` calls to the Express API on port 8787. Use **New entry** to clear the example, upload text PDFs, and fill or correct fields. Uploads are parsed in memory and are not written to disk. `pdf-parse` extracts selectable PDF text; image-only and scanned PDFs need OCR and are surfaced as such.

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
- Express/TypeScript API for PDF text extraction and XML serialization. A few high-signal identifiers (invoice number, bill, PO, package count, weight, vessel, and consignee) are suggested with simple patterns. Users review the source text; the prototype does not claim general-purpose document understanding.
- `entry.xsd`, `data_type.xsd`, and `entry-sample.xml` are included as the NetCHB entry-service schema/reference. NetCHB's schema namespace and schema URL are present in its own sample request; its public web-services page lists `uploadEntry` and related methods. A current [Strix entry API reference](https://strixsmart.com/resources/api/entry) publishes the schema files and says they are pulled from the live source. The NetCHB [entry response documentation](https://www.netchb.com/xml/entry/entryUploadResponse.html) explains that an `<accepted>` upload response only confirms system upload, not CBP acceptance.
- The XML generator uses the documented root/sequence (`entry-no`, `header`, `manifest`, `invoices`) and omits `<transmit/>`, so it will not request automatic transmission. It does not connect to NetCHB or claim the entry is ready for filing.

## Important limits

The prototype is a review workflow, not a customs broker or an automated filing system. It does not provide a validated current HTSUS classification, duty or trade-remedy calculation, manufacturer ID, importer/bond profile lookup, robust OCR, assist/freight allocation, PGA determination, or production-grade field confidence. Six-digit invoice HS headings are carried through as source evidence; a broker must enter and verify the full U.S. tariff classification and all account-dependent fields. Review alerts intentionally preserve conflicts instead of silently reconciling them.

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
