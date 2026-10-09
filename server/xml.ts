import { create } from 'xmlbuilder2';
import type { EntryDraft } from './sample.js';

const text = (value: unknown) => String(value ?? '').trim();
const port = (value: unknown) => /^\d{4}$/.test(text(value));
const foreignPort = (value: unknown) => /^\d{5}$/.test(text(value));
const country = (value: unknown) => /^[A-Za-z]{2}$/.test(text(value));

export function buildXml(draft: EntryDraft) {
  const root = create({ version: '1.0', encoding: 'UTF-8' }).ele('entry', {
    xmlns: 'http://www.netchb.com/xml/entry',
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    'xsi:schemaLocation': 'http://www.netchb.com/xml/entry http://www.netchb.com/xml/entry/entry.xsd',
  });
  root.ele('entry-no').ele('system-generated').up().up();
  const header = root.ele('header');
  if (text(draft.importerTaxId)) header.ele('importer-tax-id').txt(text(draft.importerTaxId));
  if (text(draft.consigneeName)) header.ele('ultimate-consignee').ele('consignee-name').txt(text(draft.consigneeName));
  // These elements are XSD-required. Omit unknown values rather than emitting
  // fake defaults; the review UI must identify the resulting incomplete draft.
  if (port(draft.processingPort)) header.ele('processing-port').txt(text(draft.processingPort));
  if (port(draft.entryPort)) header.ele('entry-port').txt(text(draft.entryPort));
  if (/^\d{4}-\d{2}-\d{2}$/.test(text(draft.entryDate))) header.ele('entry-date').txt(text(draft.entryDate));
  if (/^\d{2}$/.test(text(draft.entryType))) header.ele('entry-type').txt(text(draft.entryType));
  if (draft.bondType) {
    if (!['00', '08', '09'].includes(draft.bondType)) throw new Error('Bond type must match a NetCHB XSD code: 00, 08, or 09. Confirm the code with the broker.');
    header.ele('bond-type').txt(draft.bondType);
  }
  if (draft.paymentType) {
    if (!['1', '2', '3', '5', '6', '7', '8'].includes(draft.paymentType)) throw new Error('Payment type must match a NetCHB XSD code: 1, 2, 3, 5, 6, 7, or 8. Confirm the code with the broker.');
    header.ele('payment-type').txt(draft.paymentType);
  }
  if (Number(draft.grossWeight) > 0) header.ele('gross-weight').txt(String(Math.round(Number(draft.grossWeight))));
  if (text(draft.stateDestination)) header.ele('state-destination').txt(text(draft.stateDestination).toUpperCase());
  if (text(draft.vessel)) header.ele('vessel-name').txt(text(draft.vessel).slice(0, 20));
  if (/^\d{2}$/.test(text(draft.transportMode))) header.ele('mode-transportation').txt(text(draft.transportMode));
  if (port(draft.unladingPort)) header.ele('unlading-port').txt(text(draft.unladingPort));
  if (/^\d{4}-\d{2}-\d{2}$/.test(text(draft.arrivalDate))) header.ele('arrival-date').txt(text(draft.arrivalDate));
  if (/^[A-Z0-9]{4}$/i.test(text(draft.carrierCode))) header.ele('carrier-code').txt(text(draft.carrierCode).toUpperCase());
  if (text(draft.customerReference)) header.ele('customer-reference-no').txt(text(draft.customerReference));
  if (text(draft.voyage)) header.ele('voyage-no').txt(text(draft.voyage).slice(0, 5));
  header.up();

  const manifest = root.ele('manifest');
  if (Number(draft.packages) >= 0 && Number(draft.packages) > 0 && text(draft.packageUnit)) {
    const bol = manifest.ele('bill-of-lading');
    if (text(draft.carrierCode)) bol.ele('master-scac').txt(text(draft.carrierCode).toUpperCase());
    if (text(draft.masterBill)) bol.ele('master-bill').txt(text(draft.masterBill));
    if (text(draft.houseScac)) bol.ele('house-scac').txt(text(draft.houseScac).toUpperCase());
    if (text(draft.houseBill)) bol.ele('house-bill').txt(text(draft.houseBill));
    bol.ele('quantity').txt(String(Math.max(0, Math.round(Number(draft.packages)))));
    bol.ele('unit').txt(text(draft.packageUnit).toUpperCase());
  }
  manifest.up();

  if (draft.containerNumbers?.some(value => text(value))) {
    const containers = root.ele('containers');
    for (const value of draft.containerNumbers) if (text(value)) containers.ele('container-number').txt(text(value));
  }

  const invoice = root.ele('invoices').ele('invoice');
  // NetCHB's invoice-no XSD permits only letters, digits, and hyphens.
  const invoiceNo = text(draft.invoiceNo).replace(/[^a-zA-Z\d-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 17);
  if (invoiceNo) invoice.ele('invoice-no').txt(invoiceNo);
  const lines = invoice.ele('line-items');
  for (const line of draft.lines || []) {
    const tariffNo = text(line.tariffNo).replace(/\D/g, '').slice(0, 10);
    // A NetCHB tariff record requires a code and value. Never synthesize a tariff
    // number or value to make an incomplete line look fileable.
    if (!/^\d{5,10}$/.test(tariffNo) || !Number.isFinite(Number(line.value)) || Number(line.value) < 0) continue;
    const item = lines.ele('line-item');
    if (country(line.countryOrigin)) item.ele('country-origin').txt(text(line.countryOrigin).toUpperCase());
    if (text(line.manufacturerId)) item.ele('manufacturer-id').txt(text(line.manufacturerId).toUpperCase());
    if (country(line.countryExport)) item.ele('country-export').txt(text(line.countryExport).toUpperCase());
    if (Number(line.grossWeight) > 0) item.ele('gross-weight').txt(String(Math.round(Number(line.grossWeight))));
    if (Number(line.quantity) > 0) item.ele('invoice-quantity').txt(String(Number(line.quantity)));
    if (text(line.description)) item.ele('commercial-description').txt(text(line.description));
    if (foreignPort(draft.ladingPort)) item.ele('lading-port').txt(text(draft.ladingPort));
    const tariff = item.ele('tariffs').ele('tariff');
    tariff.ele('tariff-no').txt(tariffNo);
    tariff.ele('value').txt(Number(line.value).toFixed(2));
    if (Number(line.quantity) > 0 && /^[A-Za-z]{1,3}$/.test(text(line.unit))) {
      tariff.ele('quantity1').txt(String(line.quantity));
      tariff.ele('unit-of-measure1').txt(text(line.unit).toUpperCase());
    }
  }
  return root.end({ prettyPrint: true });
}
