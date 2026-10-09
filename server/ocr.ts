import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createWorker } from 'tesseract.js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const execFileAsync = promisify(execFile);
const MAX_OCR_PAGES = 8;
const PDF_RENDER_TIMEOUT_MS = 45_000;
// Comparing the supplied bill at 150, 200, and 300 DPI showed 200 DPI
// recovered its MBL cleanly; the lower and higher settings did not.
const PDF_OCR_DPI = 200;
let workerPromise: ReturnType<typeof createWorker> | undefined;
let ocrQueue: Promise<void> = Promise.resolve();

function runOcr<T>(work: () => Promise<T>): Promise<T> {
  const task = ocrQueue.then(work, work);
  ocrQueue = task.then(() => undefined, () => undefined);
  return task;
}

async function getWorker() {
  workerPromise ??= createWorker('eng');
  try { return await workerPromise; }
  catch (error) { workerPromise = undefined; throw error; }
}

async function renderPdfPage(buffer: Buffer, pageNo: number): Promise<Buffer> {
  // pdf.js's Node canvas renderer can terminate Node on some scanned/image-heavy
  // PDFs. Poppler renders those pages in a child process instead, keeping a bad
  // source document from taking down the API process.
  const directory = await mkdtemp(join(tmpdir(), 'sefer-pdf-'));
  const inputPath = join(directory, 'source.pdf');
  const outputPrefix = join(directory, 'page');
  try {
    await writeFile(inputPath, buffer);
    await execFileAsync(process.env.PDFTOPPM_PATH || 'pdftoppm', [
      '-f', String(pageNo), '-l', String(pageNo), '-singlefile', '-png', '-r', String(PDF_OCR_DPI), inputPath, outputPrefix,
    ], { timeout: PDF_RENDER_TIMEOUT_MS, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    return await readFile(`${outputPrefix}.png`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function recognizeImage(buffer: Buffer) {
  return runOcr(async () => {
    const worker = await getWorker();
    const result = await worker.recognize(buffer);
    return { text: result.data.text.trim(), confidence: Math.round(result.data.confidence) };
  });
}

export async function recognizePdfPages(buffer: Buffer) {
  return runOcr(async () => {
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
    const document = await loadingTask.promise;
    try {
      const totalPages = document.numPages;
      const worker = await getWorker();
      const pages: string[] = [];
      const confidences: number[] = [];
      const pageCount = Math.min(totalPages, MAX_OCR_PAGES);
      for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
        const image = await renderPdfPage(buffer, pageNo);
        const result = await worker.recognize(image);
        if (result.data.text.trim()) { pages.push(result.data.text.trim()); confidences.push(result.data.confidence); }
      }
      const confidence = confidences.length ? Math.round(confidences.reduce((sum, score) => sum + score, 0) / confidences.length) : 0;
      return { text: pages.join('\n\n'), confidence, pagesProcessed: pageCount, pageLimitReached: totalPages > MAX_OCR_PAGES };
    } finally {
      await loadingTask.destroy();
    }
  });
}
