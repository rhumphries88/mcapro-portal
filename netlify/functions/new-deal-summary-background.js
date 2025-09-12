// netlify/functions/new-deal-summary-background.js
// Netlify Background Function: accepts a webhook, immediately returns 202 to the client,
// then processes a PDF in the background (extract text and simple summary), logs progress,
// handles errors, and returns a JSON result object. No database writes.

// Background Functions always respond 202 to the client and continue running asynchronously.
// We'll still construct a result object for logs or potential upstream consumers.

export async function handler(event, context) {
  const startedAt = new Date();
  const taskId = `${startedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    console.log(`[new-deal-summary-background] taskId=${taskId} start`, {
      method: event.httpMethod,
      contentType: event.headers?.['content-type'] || event.headers?.['Content-Type'] || 'unknown',
      isBase64: !!event.isBase64Encoded,
    });

    // Decode inputs
    const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';
    let pdfBuffer = null;

    // Helper: safe JSON parse
    const safeJson = (txt) => { try { return JSON.parse(txt); } catch { return null; } };

    // Path A: JSON body with fileUrl or pdfBase64
    if (contentType.includes('application/json')) {
      const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
      const json = safeJson(raw) || {};
      if (json.pdfBase64) {
        pdfBuffer = Buffer.from(json.pdfBase64, 'base64');
      } else if (json.fileUrl) {
        console.log(`[new-deal-summary-background] fetching fileUrl for taskId=${taskId}`);
        const resp = await fetch(json.fileUrl);
        if (!resp.ok) throw new Error(`Failed to fetch fileUrl: ${resp.status}`);
        const arr = await resp.arrayBuffer();
        pdfBuffer = Buffer.from(arr);
      }
    }

    // Path B: direct PDF
    if (!pdfBuffer && contentType.includes('application/pdf')) {
      pdfBuffer = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'binary');
    }

    // Path C: basic multipart/form-data extraction (expects field name "file")
    if (!pdfBuffer && contentType.includes('multipart/form-data')) {
      const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
      const boundary = boundaryMatch ? `--${boundaryMatch[1]}` : null;
      if (boundary) {
        const bodyBuf = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'binary');
        const parts = bodyBuf.toString('binary').split(boundary);
        // Heuristic: find first part that looks like a file (has Content-Type: application/pdf)
        for (const part of parts) {
          if (part.includes('Content-Type: application/pdf')) {
            const idx = part.indexOf('\r\n\r\n');
            if (idx !== -1) {
              const binary = part.slice(idx + 4);
              // Strip trailing CRLF--
              const cleaned = binary.replace(/\r\n--$/, '');
              pdfBuffer = Buffer.from(cleaned, 'binary');
              break;
            }
          }
        }
      }
    }

    if (!pdfBuffer) {
      console.warn(`[new-deal-summary-background] No PDF provided. taskId=${taskId}`);
      const result = {
        taskId,
        status: 'failed',
        result: { error: 'No PDF input found (expected application/pdf body, multipart file, or JSON with pdfBase64/fileUrl).' },
        processedAt: new Date().toISOString(),
      };
      console.log(`[new-deal-summary-background] result`, result);
      return; // background fn: response already 202 to client
    }

    console.log(`[new-deal-summary-background] taskId=${taskId} extracting text...`);
    const pdfParse = (await import('pdf-parse')).default; // lazy import commonjs default
    const parsed = await pdfParse(pdfBuffer);

    const text = (parsed?.text || '').trim();
    console.log(`[new-deal-summary-background] taskId=${taskId} extracted chars=${text.length}`);

    // Tiny heuristic summary: first 500 chars and simple counts
    const summary = {
      pages: parsed?.numpages ?? undefined,
      info: parsed?.info ?? undefined,
      contentPreview: text.slice(0, 500),
      length: text.length,
      lines: (text.match(/\n/g) || []).length,
    };

    const result = {
      taskId,
      status: 'completed',
      result: summary,
      processedAt: new Date().toISOString(),
    };

    console.log(`[new-deal-summary-background] done taskId=${taskId}`, result);
  } catch (err) {
    const result = {
      taskId,
      status: 'failed',
      result: { error: String(err?.message || err) },
      processedAt: new Date().toISOString(),
    };
    console.error(`[new-deal-summary-background] error taskId=${taskId}`, result);
  }
}
