import type { EntryDraft, LineItem } from './sample.js';

export type ExtractionDocument = { filename: string; text: string };

const EMPTY_DRAFT: EntryDraft = {
  invoiceNo: '', importerTaxId: '', consigneeName: '', entryDate: '', entryType: '', bondType: '', paymentType: '',
  entryPort: '', unladingPort: '', processingPort: '', transportMode: '', arrivalDate: '', vessel: '', voyage: '',
  carrierCode: '', houseBill: '', houseScac: '', masterBill: '', ladingPort: '', stateDestination: '', containerNumbers: [],
  freight: 0, insurance: 0, packages: 0, packageUnit: '', grossWeight: 0, customerReference: '', lines: [],
};

function firstText(response: any): string {
  if (typeof response?.output_text === 'string') return response.output_text;
  for (const item of response?.output || []) for (const content of item?.content || []) if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
  throw new Error('The extraction model returned no structured output.');
}

export function localDraftFromCandidates(candidates: Array<{field:string;value:unknown;source?:string}>, documents: ExtractionDocument[]): Partial<EntryDraft> {
  const draft: Partial<EntryDraft> = { lines: [] };
  const single: Record<string, keyof EntryDraft> = {
    invoiceNo: 'invoiceNo', houseBill: 'houseBill', masterBill: 'masterBill', customerReference: 'customerReference',
    packages: 'packages', grossWeight: 'grossWeight', vessel: 'vessel', voyage: 'voyage', carrierCode: 'carrierCode', consigneeName: 'consigneeName',
  };
  for (const [field, key] of Object.entries(single)) {
    const match = candidates.find(candidate => candidate.field === field && candidate.value !== '' && candidate.value !== undefined);
    if (match) (draft as any)[key] = match.value;
  }
  const invoice = documents.find(doc => /invoice/i.test(doc.filename));
  (draft as any).lines = candidates.filter(candidate => candidate.field === 'lineItem' && typeof candidate.value === 'object' && (!invoice || candidate.source === invoice.filename)).map(candidate => candidate.value as LineItem);
  const joined = documents.map(doc => doc.text).join('\n');
  const state = joined.match(/\b(?:Kent|Seattle|Tacoma)[,\s]+(?:WA|Washington)\b/i);
  if (state) draft.stateDestination = 'WA';
  return draft;
}

export async function extractDraftWithOpenAI(documents: ExtractionDocument[]): Promise<{ draft: Partial<EntryDraft>; notes: string[] }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-5-mini';
  const text = documents.map(doc => `### SOURCE FILE: ${doc.filename}\n${doc.text}`).join('\n\n').slice(0, 100_000);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model,
      store: false,
      input: [
        { role: 'system', content: 'Extract an editable customs entry draft from shipment documents. Only use facts stated in the documents. Return empty strings, zeroes, or empty arrays for missing facts; never invent an importer tax ID, entry date, entry/processing/unlading port code, transport code, HTSUS extension, manufacturer ID, or bond/payment setup. Keep conflicting source values as review notes; choose a representative draft value only when necessary and explicitly note the conflict. Preserve stated invoice line extensions unless an explicit unit-price arithmetic reconciliation to an invoice subtotal strongly supports a correction; identify the printed and calculated values in a review note. Do not classify goods. Separate master SCAC and house SCAC from bill numbers only when clearly evidenced. Return JSON matching the requested shape.' },
        { role: 'user', content: `Create a normalized draft object. Include all these fields in draft: invoiceNo, importerTaxId, consigneeName, entryDate (YYYY-MM-DD), entryType, bondType, paymentType, entryPort, unladingPort, processingPort, transportMode, arrivalDate (YYYY-MM-DD), vessel, voyage, carrierCode, houseBill, houseScac, masterBill, ladingPort, stateDestination, containerNumbers (array), freight (number), insurance (number), packages (number), packageUnit, grossWeight (number), customerReference, lines (array with description, tariffNo as documentary/source tariff only, manufacturerId, quantity, unit, value, countryOrigin, countryExport, grossWeight). Also return notes, an array of concise source conflicts, arithmetic issues, and unresolved broker questions. Use empty values for facts absent from documents.\n\n${text}` },
      ],
      text: { format: { type: 'json_object' } },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI extraction request failed (${response.status}): ${body.slice(0, 400)}`);
  }
  const output = JSON.parse(firstText(await response.json())) as { draft?: Partial<EntryDraft>; notes?: unknown };
  const input = output.draft || {};
  const draft: Partial<EntryDraft> = { ...EMPTY_DRAFT };
  for (const key of Object.keys(EMPTY_DRAFT) as (keyof EntryDraft)[]) {
    const value = input[key];
    if (key === 'lines') {
      draft.lines = Array.isArray(value) ? value.filter(isLineItem).map(normalizeLine) : [];
    } else if (key === 'containerNumbers') {
      draft.containerNumbers = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean) : [];
    } else if (typeof value === 'string' || typeof value === 'number') {
      (draft as any)[key] = typeof value === 'string' ? value.trim() : Number.isFinite(value) ? value : 0;
    }
  }
  const notes = Array.isArray(output.notes) ? output.notes.filter((item): item is string => typeof item === 'string').slice(0, 30) : [];
  return { draft, notes };
}

function isLineItem(value: unknown): value is LineItem {
  return Boolean(value && typeof value === 'object' && typeof (value as LineItem).description === 'string');
}
function normalizeLine(line: LineItem): LineItem {
  return {
    description: String(line.description || '').trim(), tariffNo: String(line.tariffNo || '').replace(/\D/g, '').slice(0, 10),
    manufacturerId: '', quantity: Number.isFinite(Number(line.quantity)) ? Number(line.quantity) : 0,
    unit: String(line.unit || ''), value: Number.isFinite(Number(line.value)) ? Number(line.value) : 0,
    countryOrigin: /^[A-Za-z]{2}$/.test(String(line.countryOrigin || '')) ? line.countryOrigin.toUpperCase() : '',
    countryExport: /^[A-Za-z]{2}$/.test(String(line.countryExport || '')) ? String(line.countryExport).toUpperCase() : '',
    grossWeight: Number.isFinite(Number(line.grossWeight)) ? Number(line.grossWeight) : 0,
  };
}
