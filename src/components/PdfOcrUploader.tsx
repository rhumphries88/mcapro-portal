import React, { useCallback, useRef, useState } from 'react';
import { UploadCloud, Loader2, FileText, ScanText, CheckCircle2, AlertTriangle, Eye, Upload } from 'lucide-react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// External OCR (client)
// IMPORTANT: install `tesseract.js` in your project (npm i tesseract.js). We import dynamically to avoid TS module issues.

// PDF parsing
// Already used elsewhere in the app; we load dynamically to keep bundle smaller
// npm i pdfjs-dist

const MAX_CLIENT_OCR_BYTES = 5 * 1024 * 1024; // 5MB
const NEW_DEAL_WEBHOOK = 'https://yourdomain.com/webhook/newDeal';
const MTD_WEBHOOK = 'https://yourdomain.com/webhook/mtd';
const N8N_OCR_WEBHOOK = 'https://yourdomain.com/webhook/ocr'; // expects to return a searchable PDF

type OCRState = 'idle' | 'detecting' | 'ocr' | 'ready' | 'uploading' | 'error' | 'success';

const formatKB = (bytes: number) => Math.round(bytes / 1024);
const formatMB = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2);

// Detect if a PDF is image-based (no selectable text) by sampling pages with pdfjs-dist
async function detectIfImageBased(file: File, samplePages = 2): Promise<{ imageBased: boolean; pagesChecked: number }>{
  const pdfjsLibRaw: unknown = await import('pdfjs-dist');
  const workerModRaw: unknown = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  const workerSrc = (workerModRaw as { default?: string })?.default;
  type PdfTextItem = { str?: string };
  const pdfjsLib = pdfjsLibRaw as unknown as {
    GlobalWorkerOptions: { workerSrc?: string };
    getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: PdfTextItem[] }> }> }> };
  };
  if (workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

  const ab = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: ab }).promise;
  const pagesToCheck = Math.min(samplePages, doc.numPages);
  let hasText = false;
  for (let i = 1; i <= pagesToCheck; i++) {
    const page = await doc.getPage(i);
    const text = await page.getTextContent();
    if ((text.items || []).some((it) => typeof it.str === 'string' && String(it.str).trim().length > 0)) {
      hasText = true;
      break;
    }
  }
  return { imageBased: !hasText, pagesChecked: pagesToCheck };
}

// Client-side OCR using Tesseract.js and rebuild PDF with hidden text layer
async function performOcrConversionClient(file: File, lang = 'eng', onProgress?: (p: number) => void): Promise<File> {
  const start = performance.now();
  // Render each page to image with pdfjs, OCR with tesseract, rebuild PDF with pdf-lib placing transparent text
  const pdfjsLibRaw: unknown = await import('pdfjs-dist');
  const workerModRaw: unknown = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  const workerSrc = (workerModRaw as { default?: string })?.default;
  type PdfViewport = { width: number; height: number };
  type PdfRenderTask = { promise: Promise<void> };
  type PdfPage = { getViewport(arg: { scale: number }): PdfViewport; render(arg: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): PdfRenderTask };
  const pdfjsLib = pdfjsLibRaw as unknown as {
    GlobalWorkerOptions: { workerSrc?: string };
    getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<{ numPages: number; getPage(n: number): Promise<PdfPage> }> };
  };
  if (workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

  const ab = await file.arrayBuffer();
  const srcDoc = await pdfjsLib.getDocument({ data: ab }).promise;

  const outPdf = await PDFDocument.create();
  const font = await outPdf.embedFont(StandardFonts.Helvetica);

  for (let p = 1; p <= srcDoc.numPages; p++) {
    const page = await srcDoc.getPage(p);
    const viewport = page.getViewport({ scale: 2 }); // 2x raster for better OCR
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    canvas.width = width;
    canvas.height = height;
    await page.render({ canvasContext: (ctx as CanvasRenderingContext2D), viewport }).promise;

    // OCR the page image
    const dataUrl = canvas.toDataURL('image/png');
    const { recognize } = await import('tesseract.js');
    const { data }: { data: { words?: Array<{ text?: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> } } = await recognize(
      dataUrl,
      lang,
      {
        logger: (m: { status?: string; progress?: number }) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') onProgress?.(Math.round((100 * (p - 1 + m.progress)) / srcDoc.numPages));
        },
      } as unknown as Record<string, unknown>
    );

    // Create page in output PDF with original raster image to preserve layout
    const pagePngBytes = await (await fetch(dataUrl)).arrayBuffer();
    const img = await outPdf.embedPng(pagePngBytes);
    const outPage = outPdf.addPage([width, height]);
    outPage.drawImage(img, { x: 0, y: 0, width, height });

    // Draw recognized text as an invisible text layer (0 opacity) positioned via word bbox
    outPage.setFont(font);
    outPage.setFontSize(10);
    const h = height;
    // Place words roughly at their bounding boxes
    (data.words || []).forEach((w) => {
      const b = w.bbox; // { x0, y0, x1, y1 }
      const txt = String(w.text || '').trim();
      if (!txt) return;
      const x = b.x0;
      const y = h - b.y1; // convert to PDF coordinate space
      const wWidth = Math.max(1, b.x1 - b.x0);
      outPage.drawText(txt, {
        x,
        y,
        color: rgb(0, 0, 0),
        opacity: 0.0, // invisible text layer for search/select
        maxWidth: wWidth,
      });
    });
  }

  const outBytes = await outPdf.save();
  // Convert to ArrayBuffer to satisfy BlobPart typing
  const outAb = new ArrayBuffer(outBytes.byteLength);
  const view = new Uint8Array(outAb);
  for (let i = 0; i < outBytes.byteLength; i++) view[i] = outBytes[i];
  const end = performance.now();
  console.log(`[OCR] Client OCR took ${(end - start).toFixed(0)} ms. Original=${formatKB(file.size)}KB, OCR=${formatKB(outBytes.byteLength)}KB`);
  return new File([outAb], file.name.replace(/\.pdf$/i, '') + '-ocr.pdf', { type: 'application/pdf' });
}

// Server-side OCR via n8n: send file and expect a searchable PDF returned
async function performOcrConversionServer(file: File, lang = 'eng', onProgress?: (p: number) => void): Promise<File> {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('lang', lang);
  onProgress?.(10);
  const resp = await fetch(N8N_OCR_WEBHOOK, { method: 'POST', body: form });
  if (!resp.ok) throw new Error(`OCR server failed: ${resp.status}`);
  onProgress?.(60);
  const blob = await resp.blob();
  onProgress?.(95);
  return new File([blob], file.name.replace(/\.pdf$/i, '') + '-ocr.pdf', { type: 'application/pdf' });
}

async function uploadToWebhooks(file: File, onProgress?: (p: number) => void): Promise<{ newDeal: Response; mtd: Response }>{
  const formData = new FormData();
  formData.append('file', file, file.name);
  onProgress?.(5);
  const newDealPromise = fetch(NEW_DEAL_WEBHOOK, { method: 'POST', body: formData });
  onProgress?.(50);
  const mtdPromise = fetch(MTD_WEBHOOK, { method: 'POST', body: formData });
  const [newDeal, mtd] = await Promise.allSettled([newDealPromise, mtdPromise]).then((results) => {
    const toResp = (r: PromiseSettledResult<Response>) => (r.status === 'fulfilled' ? r.value : new Response(String((r as PromiseRejectedResult).reason), { status: 599 }));
    return [toResp(results[0]), toResp(results[1])] as [Response, Response];
  });
  onProgress?.(100);
  return { newDeal, mtd };
}

const PdfOcrUploader: React.FC = () => {
  const [state, setState] = useState<OCRState>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [imageBased, setImageBased] = useState<boolean | null>(null);
  const [lang, setLang] = useState<string>('eng');
  const [autoOcr, setAutoOcr] = useState<boolean>(true);
  const [progress, setProgress] = useState<number>(0);
  const [message, setMessage] = useState<string>('');
  const [outputUrl, setOutputUrl] = useState<string>('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setState('idle');
    setFile(null);
    setImageBased(null);
    setProgress(0);
    setMessage('');
    setOutputUrl('');
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) await handleFile(f);
  };

  const runOcr = useCallback(async (theFile?: File) => {
    const src = theFile ?? file;
    if (!src) return;
    setState('ocr');
    setProgress(1);
    try {
      let searchable: File;
      if (src.size <= MAX_CLIENT_OCR_BYTES) {
        searchable = await performOcrConversionClient(src, lang, (p) => setProgress(Math.min(95, Math.max(1, p))));
      } else {
        searchable = await performOcrConversionServer(src, lang, (p) => setProgress(Math.min(95, Math.max(1, p))));
      }
      setProgress(98);
      setState('ready');
      const url = URL.createObjectURL(searchable);
      setOutputUrl(url);
      setFile(searchable);
      setMessage(`OCR complete. Size: ${formatMB(searchable.size)} MB`);
    } catch (e) {
      console.error('[OCR] failed:', e);
      setState('error');
      setMessage('OCR failed. Please try again or use server-side OCR.');
    }
  }, [file, lang]);

  const handleFile = useCallback(async (f: File) => {
    reset();
    if (f.type !== 'application/pdf') {
      setState('error');
      setMessage('Please upload a PDF file.');
      return;
    }
    setFile(f);
    setState('detecting');
    const det = await detectIfImageBased(f);
    setImageBased(det.imageBased);
    setState('ready');

    // Auto OCR for image-based PDFs
    if (autoOcr && det.imageBased) {
      await runOcr(f);
    }
  }, [autoOcr, runOcr]);

  const onUpload = useCallback(async () => {
    if (!file) return;
    setState('uploading');
    setProgress(1);
    try {
      const { newDeal, mtd } = await uploadToWebhooks(file, (p) => setProgress(Math.min(99, Math.max(1, p))));
      const ndText = await newDeal.text().catch(() => '');
      const mtdText = await mtd.text().catch(() => '');
      console.log('[OCR Uploader] newDeal:', newDeal.status, ndText);
      console.log('[OCR Uploader] mtd:', mtd.status, mtdText);
      if (!newDeal.ok || !mtd.ok) {
        setState('error');
        setMessage('Upload failed — one or more webhooks returned errors.');
        return;
      }
      setState('success');
      setProgress(100);
      setMessage('✅ OCR complete — searchable PDF uploaded successfully!');
    } catch (e) {
      console.error('[OCR Upload] failed:', e);
      setState('error');
      setMessage('Upload failed. Please retry.');
    }
  }, [file]);

  const disabled = state === 'detecting' || state === 'ocr' || state === 'uploading';

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
            <ScanText className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">PDF OCR Converter</h3>
            <p className="text-sm text-gray-600">Convert scanned PDFs to searchable PDFs with a text layer.</p>
          </div>
        </div>

        <div
          className={`border-2 border-dashed rounded-xl p-6 text-center transition ${disabled ? 'opacity-60' : ''} ${!file ? 'bg-gray-50 border-gray-300' : 'bg-white border-gray-200'}`}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          {!file ? (
            <>
              <div className="mx-auto w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center mb-3">
                <UploadCloud className="w-6 h-6 text-indigo-600" />
              </div>
              <p className="text-sm text-gray-600 mb-3">Drag & drop a PDF, or click to select</p>
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
                onClick={() => inputRef.current?.click()}
                disabled={disabled}
              >
                Choose PDF
              </button>
              <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => e.target.files && handleFile(e.target.files[0])} />
            </>
          ) : (
            <div className="text-left space-y-2">
              <div className="flex items-center text-gray-800"><FileText className="w-4 h-4 mr-2" /> <span className="font-medium">{file.name}</span></div>
              <div className="text-sm text-gray-600">Size: <span className="font-semibold">{formatMB(file.size)} MB</span></div>
              {imageBased != null && (
                <div className="text-sm">
                  {imageBased ? (
                    <span className="inline-flex items-center text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1"><AlertTriangle className="w-3 h-3 mr-1" /> Image-based — OCR recommended</span>
                  ) : (
                    <span className="inline-flex items-center text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1"><CheckCircle2 className="w-3 h-3 mr-1" /> Text-based — OCR not needed</span>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3 mt-3">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" className="rounded" checked={autoOcr} onChange={(e) => setAutoOcr(e.target.checked)} />
                  Auto OCR
                </label>
                <div className="text-sm text-gray-700 flex items-center gap-2">
                  Language:
                  <select className="border rounded px-2 py-1" value={lang} onChange={(e) => setLang(e.target.value)}>
                    <option value="eng">English (eng)</option>
                    <option value="spa">Spanish (spa)</option>
                    <option value="fra">French (fra)</option>
                    <option value="deu">German (deu)</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-3 mt-4">
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
                  onClick={() => runOcr()}
                  disabled={disabled || imageBased === false}
                >
                  {state === 'ocr' ? (<span className="inline-flex items-center"><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Running OCR...</span>) : 'Run OCR'}
                </button>
                {outputUrl && (
                  <a className="px-4 py-2 rounded-lg bg-gray-100 text-gray-800 font-medium hover:bg-gray-200 inline-flex items-center" href={outputUrl} target="_blank" rel="noreferrer">
                    <Eye className="w-4 h-4 mr-2" /> Preview
                  </a>
                )}
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center"
                  onClick={onUpload}
                  disabled={disabled || !file}
                >
                  {state === 'uploading' ? (<span className="inline-flex items-center"><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...</span>) : (<><Upload className="w-4 h-4 mr-2" /> Upload</>)}
                </button>
              </div>

              {(state === 'ocr' || state === 'uploading') && (
                <div className="mt-4">
                  <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                    <div className="h-2 bg-indigo-600 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-gray-500">{state === 'ocr' ? `OCR in progress... ${progress}%` : `Uploading... ${progress}%`}</p>
                </div>
              )}

              {message && (
                <div className={`mt-4 text-sm ${state === 'error' ? 'text-red-600' : 'text-gray-700'}`}>{message}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PdfOcrUploader;
