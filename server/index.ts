import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pdf from 'pdf-parse';
import { sampleDraft, reviewItems } from './sample.js';
import { buildXml } from './xml.js';
import type { EntryDraft } from './sample.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 10 }, fileFilter: (_req, file, cb) => {
  cb(null, file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/'));
} });

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/sample', (_req, res) => res.json({ draft: sampleDraft, reviewItems }));
app.post('/api/xml', (req, res) => {
  try {
    const draft = req.body as EntryDraft;
    if (!draft || !Array.isArray(draft.lines)) return res.status(400).json({ error: 'A draft with line items is required.' });
    res.json({ xml: buildXml(draft) });
  } catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : 'Could not generate XML.' }); }
});
app.post('/api/documents', upload.array('documents', 10), async (req, res) => {
  const files = (req.files || []) as Express.Multer.File[];
  const parsed = await Promise.all(files.map(async file => {
    let text = '';
    let parseError: string | undefined;
    if (file.mimetype === 'application/pdf') {
      try { text = (await pdf(file.buffer)).text.trim(); } catch { parseError = 'PDF text extraction failed.'; }
    } else {
      parseError = 'Image OCR is not enabled in this demo. Attach a text PDF or paste recognized text into your workflow.';
    }
    if (!text && !parseError) parseError = 'No selectable text found. Scanned PDFs need OCR before review.';
    return { filename: file.originalname, mimeType: file.mimetype, bytes: file.size, text: text.slice(0, 18000), parseError };
  }));
  const combined = parsed.map(f => f.text).join('\n');
  const match = (pattern: RegExp) => combined.match(pattern)?.[1]?.trim() || null;
  const invoice = match(/(?:invoice\s*(?:no\.?|number|#)\s*:?\s*)([A-Z0-9/-]{4,})/i);
  const bills = match(/(?:B\/L\s*(?:No\.?|Number)?\s*:?\s*)([A-Z0-9-]{8,})/i);
  const po = match(/(?:buyer'?s?\s*)?(?:P\.?O\.?|purchase\s*order)\s*:?\s*([A-Z0-9-]{4,})/i);
  const amount = match(/(?:grand\s*total|invoice\s*total|total\s*(?:CIF|FOB|amount))[^\d$]{0,24}\$?\s*([\d,]+\.\d{2})/i);
  const vessel = match(/vessel\s*(?:\/|and)?\s*voyage\s*:?\s*([^\n\r]{3,60})/i);
  const packages = match(/(?:total\s*)?(?:packages|cartons)\s*:?\s*([\d,]+)/i);
  const grossWeight = match(/(?:gross\s*weight|total\s*G\.?W\.?)\s*:?\s*([\d,]+(?:\.\d+)?)\s*(?:KG|KGS)?/i);
  res.json({ files: parsed, suggestions: {
    invoiceNo: invoice, houseBill: bills, customerReference: po,
    consigneeName: match(/(?:SHIP\s*TO|CONSIGNEE)(?:\s*\/[^\n\r]*)?\s*:?\s*\n\s*([^\n\r]{3,100})/i),
    totalValue: amount ? Number(amount.replace(/,/g, '')) : null,
    packages: packages ? Number(packages.replace(/,/g, '')) : null,
    grossWeight: grossWeight ? Number(grossWeight.replace(/,/g, '')) : null,
    vessel: vessel?.split('/')[0]?.trim() || null,
  }, note: 'Extracted text is shown for review. This deterministic demo does not classify HTS codes, determine customs value, generate manufacturer IDs, or apply OCR to scanned files.' });
});

app.listen(8787, () => console.log('Sefer API listening on http://localhost:8787'));
