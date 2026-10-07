import { create } from 'xmlbuilder2';
import type { EntryDraft } from './sample.js';

export function buildXml(draft: EntryDraft) {
  const root = create({ version: '1.0', encoding: 'UTF-8' }).ele('entry', {
    xmlns: 'http://www.netchb.com/xml/entry',
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    'xsi:schemaLocation': 'http://www.netchb.com/xml/entry http://www.netchb.com/xml/entry/entry.xsd',
  });
  root.ele('entry-no').ele('system-generated').up().up();
  const h = root.ele('header');
  if (draft.importerTaxId.trim()) h.ele('importer-tax-id').txt(draft.importerTaxId.trim());
  if (draft.consigneeName.trim()) h.ele('ultimate-consignee').ele('consignee-name').txt(draft.consigneeName.trim());
  h.ele('processing-port').txt(draft.processingPort || '3001');
  h.ele('entry-port').txt(draft.entryPort || '3001');
  h.ele('entry-date').txt(draft.entryDate || new Date().toISOString().slice(0, 10));
  h.ele('entry-type').txt(draft.entryType || '01');
  h.ele('gross-weight').txt(String(Math.round(Number(draft.grossWeight) || 0)));
  h.ele('total-entry-value').txt(String(Math.max(1, Math.round(draft.lines.reduce((sum, line) => sum + Number(line.value || 0), 0)))));
  h.ele('description').txt('APPAREL - KNIT AND WOVEN GARMENTS');
  if (draft.vessel) h.ele('vessel-name').txt(draft.vessel.slice(0, 20));
  h.ele('mode-transportation').txt(draft.transportMode || '11');
  h.ele('unlading-port').txt(draft.entryPort || '3001');
  if (draft.arrivalDate) h.ele('arrival-date').txt(draft.arrivalDate);
  if (draft.carrierCode) h.ele('carrier-code').txt(draft.carrierCode);
  if (draft.customerReference) h.ele('customer-reference-no').txt(draft.customerReference);
  if (draft.voyage) h.ele('voyage-no').txt(draft.voyage.slice(0, 5));
  root.up();
  const manifest = root.ele('manifest');
  const bol = manifest.ele('bill-of-lading');
  if (draft.carrierCode) bol.ele('master-scac').txt(draft.carrierCode);
  if (draft.masterBill) bol.ele('master-bill').txt(draft.masterBill);
  if (draft.houseBill) bol.ele('house-bill').txt(draft.houseBill);
  bol.ele('quantity').txt(String(Math.max(0, Math.round(Number(draft.packages) || 0))));
  bol.ele('unit').txt(draft.packageUnit || 'CTNS');
  manifest.up();
  const invoice = root.ele('invoices').ele('invoice');
  invoice.ele('invoice-no').txt((draft.invoiceNo || 'UNKNOWN').replace(/[^a-zA-Z\d-]/g, '').slice(0, 17));
  invoice.ele('related-party').txt('N');
  const lines = invoice.ele('line-items');
  for (const line of draft.lines || []) {
    const item = lines.ele('line-item');
    item.ele('country-origin').txt(line.countryOrigin || 'VN');
    if (line.countryExport) item.ele('country-export').txt(line.countryExport);
    item.ele('related-party').txt('N');
    if (line.grossWeight) item.ele('gross-weight').txt(String(Math.round(line.grossWeight)));
    item.ele('invoice-quantity').txt(String(Number(line.quantity) || 0));
    item.ele('commercial-description').txt(line.description || 'APPAREL');
    const tariff = item.ele('tariffs').ele('tariff');
    tariff.ele('tariff-no').txt((line.tariffNo || '').replace(/\D/g, '').slice(0, 10));
    tariff.ele('value').txt((Number(line.value) || 0).toFixed(2));
    if (line.quantity > 0) {
      tariff.ele('quantity1').txt(String(line.quantity));
      tariff.ele('unit-of-measure1').txt(line.unit || 'PCS');
    }
  }
  return root.end({ prettyPrint: true });
}
