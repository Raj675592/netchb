import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pdf from 'pdf-parse';
import { recognizeImage, recognizePdfPages } from './ocr.js';
import { extractLineItemCandidates } from './line-extraction.js';
import { sampleDraft, reviewItems } from './sample.js';
import { buildXml } from './xml.js';
import type { EntryDraft } from './sample.js';
import { getEntriesCollection, mongoErrorMessage, parseEntryId } from './database.js';
import { extractDraftWithOpenAI, localDraftFromCandidates } from './llm-extraction.js';

const app = express();
const allowedOrigins = new Set((process.env.APP_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map(origin => origin.trim()).filter(Boolean));
app.use(cors({
  origin(origin, callback) {
    // Requests made by local tools without an Origin header remain supported.
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('This browser origin is not allowed by the local Sefer API.'));
  },
}));
app.use(express.json({ limit: '2mb' }));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') cb(null, true);
    else cb(new Error(`Unsupported file type for ${file.originalname}. Upload a PDF, JPG, or PNG.`));
  },
});

app.get('/api/health', (_req, res) => res.json({ ok: true, databaseConfigured: Boolean(process.env.MONGODB_URI?.trim()), llmConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()) }));
app.get('/api/sample', (_req, res) => res.json({ draft: sampleDraft, reviewItems }));
app.get('/api/entries', async (_req, res) => {
  try {
    const collection = await getEntriesCollection();
    const rows = await collection.find({}, { projection: { draft: 1, createdAt: 1, updatedAt: 1 } }).sort({ updatedAt: -1 }).limit(100).toArray();
    res.json({ entries: rows.map(row => ({
      id: String(row._id), invoiceNo: row.draft?.invoiceNo || '', consigneeName: row.draft?.consigneeName || '',
      updatedAt: row.updatedAt, createdAt: row.createdAt, lineCount: row.draft?.lines?.length || 0,
    })) });
  } catch (error) { res.status(503).json({ error: mongoErrorMessage(error) }); }
});
app.post('/api/entries', async (req, res) => {
  const body = req.body as { draft?: EntryDraft; reviews?: unknown[]; candidates?: unknown[]; documents?: unknown[] };
  if (!body?.draft || !Array.isArray(body.draft.lines)) return res.status(400).json({ error: 'A shipment draft with line items is required.' });
  try {
    const now = new Date();
    const collection = await getEntriesCollection();
    const result = await collection.insertOne({ draft: body.draft, reviews: body.reviews || [], candidates: body.candidates || [], documents: body.documents || [], createdAt: now, updatedAt: now });
    res.status(201).json({ id: String(result.insertedId), updatedAt: now });
  } catch (error) { res.status(503).json({ error: mongoErrorMessage(error) }); }
});
app.get('/api/entries/:id', async (req, res) => {
  const id = parseEntryId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid saved entry ID.' });
  try {
    const collection = await getEntriesCollection();
    const row = await collection.findOne({ _id: id });
    if (!row) return res.status(404).json({ error: 'Saved entry not found.' });
    res.json({ id: String(row._id), draft: row.draft, reviews: row.reviews || [], candidates: row.candidates || [], documents: row.documents || [], createdAt: row.createdAt, updatedAt: row.updatedAt });
  } catch (error) { res.status(503).json({ error: mongoErrorMessage(error) }); }
});
app.put('/api/entries/:id', async (req, res) => {
  const id = parseEntryId(req.params.id);
  const body = req.body as { draft?: EntryDraft; reviews?: unknown[]; candidates?: unknown[]; documents?: unknown[] };
  if (!id) return res.status(400).json({ error: 'Invalid saved entry ID.' });
  if (!body?.draft || !Array.isArray(body.draft.lines)) return res.status(400).json({ error: 'A shipment draft with line items is required.' });
  try {
    const now = new Date();
    const collection = await getEntriesCollection();
    const result = await collection.updateOne({ _id: id }, { $set: { draft: body.draft, reviews: body.reviews || [], candidates: body.candidates || [], documents: body.documents || [], updatedAt: now } });
    if (!result.matchedCount) return res.status(404).json({ error: 'Saved entry not found.' });
    res.json({ id: String(id), updatedAt: now });
  } catch (error) { res.status(503).json({ error: mongoErrorMessage(error) }); }
});
app.delete('/api/entries/:id', async (req, res) => {
  const id = parseEntryId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid saved entry ID.' });
  try {
    const collection = await getEntriesCollection();
    const result = await collection.deleteOne({ _id: id });
    if (!result.deletedCount) return res.status(404).json({ error: 'Saved entry not found.' });
    res.json({ deleted: true });
  } catch (error) { res.status(503).json({ error: mongoErrorMessage(error) }); }
});
app.post('/api/xml', (req, res) => {
  try {
    const draft = req.body as EntryDraft;
    if (!draft || !Array.isArray(draft.lines)) return res.status(400).json({ error: 'A draft with line items is required.' });
    res.json({ xml: buildXml(draft) });
  } catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : 'Could not generate XML.' }); }
});

app.post('/api/documents', upload.array('documents', 10), async (req, res) => {
  const files = (req.files || []) as Express.Multer.File[];
  console.info(`[documents] received ${files.length} file(s)`);
  if (!files.length) return res.status(400).json({ error: 'Choose at least one PDF or image file to upload.' });
  const parsed = await Promise.all(files.map(async file => {
    let text = '';
    let parseError: string | undefined;
    let extractionMethod = '';
    let ocrConfidence: number | undefined;
    let ocrNote: string | undefined;
    if (file.mimetype === 'application/pdf') {
      try { text = (await pdf(file.buffer)).text.trim(); } catch { /* Try OCR below when text parsing fails. */ }
      if (text.length >= 40) {
        extractionMethod = 'Selectable PDF text';
      } else {
        try {
          const result = await recognizePdfPages(file.buffer);
          text = result.text;
          ocrConfidence = result.confidence;
          extractionMethod = 'OCR · scanned PDF';
          if (result.pageLimitReached) ocrNote = `OCR reviewed the first ${result.pagesProcessed} pages only.`;
        } catch (error) {
          parseError = `Could not read PDF text or run OCR: ${error instanceof Error ? error.message : 'OCR unavailable.'}`;
        }
      }
    } else {
      try {
        const result = await recognizeImage(file.buffer);
        text = result.text;
        ocrConfidence = result.confidence;
        extractionMethod = 'OCR · image';
      } catch (error) {
        parseError = `Image OCR could not run: ${error instanceof Error ? error.message : 'OCR unavailable.'}`;
      }
    }
    if (!text && !parseError) parseError = 'No selectable text found. Scanned PDFs need OCR before review.';
    return { filename: file.originalname, mimeType: file.mimetype, bytes: file.size, text: text.slice(0, 18000), parseError, extractionMethod, ocrConfidence, ocrNote };
  }));

  // Pattern matches are review candidates, not verified facts. Keep document provenance
  // attached so the operator can compare every suggestion against its source.
  type Candidate = { field: string; label: string; value: string | number | import('./line-extraction.js').LineItemCandidate; source: string; confidence: 'Review' };
  const candidates: Candidate[] = [];
  const rules: Array<{ field: string; label: string; pattern: RegExp; numeric?: boolean }> = [
    { field: 'invoiceNo', label: 'Invoice number', pattern: /\b(?:commercial\s+)?invoice\s*(?:no\.?|number|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{3,})/i },
    { field: 'houseBill', label: 'House bill', pattern: /\b(?:house\s*bill|HBL)\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{6,})/i },
    { field: 'masterBill', label: 'Master bill', pattern: /\b(?:master\s*(?:bill|b\/l)|MBL)\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{6,})/i },
    { field: 'customerReference', label: 'Purchase order', pattern: /\b(?:buyer'?s?\s*)?(?:P\.?\s*O\.?|purchase\s*order)(?![A-Z])\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{2,})/i },
    { field: 'packages', label: 'Packages', pattern: /\b(?:total\s*(?:packages|cartons|ctns)\s*[:#-]?\s*|(?:packages|cartons|ctns)\s*[:#-]\s*)([\d,]+)\b|\b([\d,]+)\s*(?:cartons|ctns|packages)\s+of\b/i, numeric: true },
    { field: 'grossWeight', label: 'Gross weight (kg)', pattern: /\b(?:gross\s*weight|total\s*G\.?W\.?)\s*[:#-]?\s*([\d,]+(?:\.\d+)?)\s*(?:KG|KGS)\b/i, numeric: true },
    { field: 'vessel', label: 'Vessel', pattern: /\b(?:vessel|ship)\s*(?:name)?\s*[:#-]\s*([^\n\r]{3,60})/i },
    { field: 'carrierCode', label: 'Carrier SCAC', pattern: /\b(?:SCAC|carrier\s*code)\s*[:#-]?\s*([A-Z]{4})\b/i },
  ];
  for (const rule of rules) {
    for (const file of parsed) {
      const matcher = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`);
      const seenValues = new Set<string>();
      for (const match of file.text.matchAll(matcher)) {
        let raw = (match[1] || match[2])?.trim();
        if (!raw) continue;
        if (rule.field === 'vessel') {
          const voyage = raw.match(/\b([A-Z]?\d{2,4}[A-Z]?)\s*(?:cntr|container|scac|$)/i)?.[1];
          if (voyage) candidates.push({ field: 'voyage', label: 'Voyage', value: voyage.toUpperCase(), source: file.filename, confidence: 'Review' });
          raw = raw.replace(/\s+(?:\/\s*)?\d{2,}[A-Z]?\b.*$/i, '').replace(/\s+(?:cntr|container|voyage|scac)\b.*$/i, '').trim();
        }
        const value = rule.numeric ? Number(raw.replace(/,/g, '')) : raw.replace(/[\s,;]+$/, '');
        if (typeof value === 'number' && !Number.isFinite(value)) continue;
        if (rule.field === 'packages' && Number(value) <= 0) continue;
        // Broken PDF text order can place a nearby column label after a field label.
        // Keep identifier suggestions only when the token contains a digit.
        if (['invoiceNo', 'houseBill', 'masterBill', 'customerReference'].includes(rule.field) && !/\d/.test(String(value))) continue;
        if (seenValues.has(String(value).toLowerCase())) continue;
        seenValues.add(String(value).toLowerCase());
        candidates.push({ field: rule.field, label: rule.label, value, source: file.filename, confidence: 'Review' });
      }
    }
  }
  for (const file of parsed) {
    // On carrier B/L scans the weight and volume columns often lose their
    // labels during OCR. Accept this paired weight/measurement layout only
    // when it follows a 20-foot container heading; keep it as a review item.
    if (/(?:house[_\s-]*bl|bill[_\s-]*of[_\s-]*lading|\bbol\b)/i.test(file.filename)) {
      const cargo = file.text.match(/(?:20\s*['’]?\s*(?:GP|HQ|HC)|container)[\s\S]{0,180}?([\d,]+)\.000\s+([\d,]{1,3}\.\d{3})\b/i);
      const weight = cargo ? Number(cargo[1].replace(/,/g, '')) : 0;
      if (weight > 0 && !candidates.some(candidate => candidate.field === 'grossWeight' && candidate.source === file.filename && Number(candidate.value) === weight)) {
        candidates.push({ field: 'grossWeight', label: 'Gross weight (kg)', value: weight, source: file.filename, confidence: 'Review' });
      }
    }
    const billNo = file.text.match(/\bBLNo\.?[\s\S]{0,100}?([A-Z]{2,}[A-Z0-9-]*\d[A-Z0-9-]{5,})/i)?.[1];
    if (billNo && /\d/.test(billNo) && !candidates.some(candidate => candidate.field === 'houseBill' && candidate.source === file.filename && String(candidate.value) === billNo)) candidates.push({ field: 'houseBill', label: 'House bill', value: billNo, source: file.filename, confidence: 'Review' });
    const consignee = file.text.match(/\b(?:ship\s*to(?:\s*\/\s*deliver\s*to)?|consignee|ultimate\s*consignee)\s*[:#-]?\s*([^\n\r]{3,100})/i)?.[1]?.trim();
    if (consignee && !/^\W*(?:references|shipper|consignee|buyer|warehouse|port|terminal)\b/i.test(consignee)) candidates.push({ field: 'consigneeName', label: 'Consignee', value: consignee, source: file.filename, confidence: 'Review' });
    for (const line of extractLineItemCandidates(file.text)) {
      candidates.push({ field: 'lineItem', label: 'Possible invoice line', value: line, source: file.filename, confidence: 'Review' });
    }
  }
  console.info(`[documents] processed ${parsed.length} file(s), ${candidates.length} review candidate(s)`);
  const extractionDocs = parsed.map(file => ({ filename: file.filename, text: file.text }));
  let draft = localDraftFromCandidates(candidates, extractionDocs);
  let extractionNote = 'Local text rules produced an initial editable draft. Compare every field with the source documents.';
  let reviews: Array<{level:'blocker'|'review';title:string;detail:string}> = [];
  if (req.body?.useAI === 'true' && process.env.OPENAI_API_KEY?.trim()) {
    try {
      const result = await extractDraftWithOpenAI(extractionDocs);
      draft = result.draft;
      extractionNote = `Structured extraction used ${process.env.OPENAI_MODEL?.trim() || 'gpt-5-mini'} after explicit opt-in; uploaded document text was sent to OpenAI. Verify all returned fields against their source.`;
      reviews = result.notes.map(detail => ({ level: 'review' as const, title: 'AI extraction note · verify against source', detail }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      const recovery = /insufficient_quota|credit_balance_exhausted/i.test(detail)
        ? 'The OpenAI account has no API credits remaining. Add API billing credits to enable AI extraction.'
        : /\(429\)/.test(detail)
          ? 'OpenAI rate-limited this request. Wait briefly and retry; the local draft is available now.'
          : 'Check the OpenAI API configuration and try again.';
      extractionNote = `AI extraction failed; a local candidate draft was generated instead. ${recovery}`;
    }
  } else if (req.body?.useAI === 'true') {
    extractionNote = 'AI extraction was selected, but OPENAI_API_KEY is not configured; local candidate extraction was used.';
  }
  for (const field of ['invoiceNo','houseBill','masterBill','customerReference','packages','grossWeight','consigneeName']) {
    const values = [...new Set(candidates.filter(candidate => candidate.field === field).map(candidate => String(candidate.value)))];
    if (values.length > 1) reviews.push({ level: 'review', title: `Conflicting ${field} candidates`, detail: `Source documents contain: ${values.join(', ')}. Compare the values before using the draft.` });
  }
  const missing = ['entryPort','processingPort','entryDate','entryType','invoiceNo'].filter(key => !String((draft as any)[key] || '').trim());
  if (missing.length) reviews.push({ level: 'blocker', title: 'Required NetCHB header data is missing', detail: `The XML deliberately omits unknown values instead of sending placeholders. Complete these required fields from broker instructions: ${missing.join(', ')}.` });
  if (!String((draft as any).importerTaxId || '').trim()) reviews.push({ level: 'blocker', title: 'Importer number is missing', detail: 'The source documents do not establish the importer of record number. Confirm the importer identity and use its verified CBP importer number.' });
  const includesBillOfLading = parsed.some(file => /(?:house[_\s-]*bl|bill[_\s-]*of[_\s-]*lading|\bbol\b)/i.test(file.filename));
  if (includesBillOfLading && !String(draft.masterBill || '').trim()) {
    reviews.push({ level: 'review', title: 'Master bill needs manual review', detail: 'The bill of lading did not yield a reliable master-bill number. Read it from the original document and enter it before exporting the XML.' });
  }
  const houseBill = String(draft.houseBill || '').trim();
  if (houseBill && !String(draft.houseScac || '').trim() && /^[A-Z]{4}[A-Z0-9-]{6,}$/i.test(houseBill)) {
    reviews.push({ level: 'review', title: 'Verify house bill prefix', detail: 'The house-bill number starts with four letters, which may be a separate house SCAC. Confirm NetCHB’s field split from the original bill of lading before export.' });
  }
  reviews.push({ level: 'review', title: 'Review generated draft before filing', detail: 'This is a document-derived starting point, not a validated customs entry. Confirm parties, quantities, values, classifications, ports, manufacturer IDs, and all broker-specific fields.' });
  res.json({ files: parsed, candidates, draft, reviews, extractionNote, note: 'Suggestions and the initial draft are unverified. No importer, port, entry date/type, bond/payment, HTSUS extension, manufacturer ID, or customs-value determination is invented.' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err instanceof multer.MulterError ? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : 400;
  res.status(status).json({ error: err.message || 'Document upload failed.' });
});

app.listen(8787, '127.0.0.1', () => console.log('Sefer API listening on http://127.0.0.1:8787'));
