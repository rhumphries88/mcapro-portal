// netlify/functions/mtd-webhook.js

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  try {
    const contentType = String(event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();

    // 1) If client posts multipart directly, RAW passthrough (no parsing)
    if (contentType.includes('multipart/form-data')) {
      // In Netlify Functions (and CLI), multipart bodies are base64-encoded.
      // Always decode as base64 to preserve binary correctness.
      const rawBody = Buffer.from(event.body || '', 'base64');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      const resp = await fetch('https://primary-production-c8d0.up.railway.app/webhook/mtd', {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'User-Agent': 'node',
          ...(event.headers.authorization && { Authorization: event.headers.authorization }),
        },
        body: rawBody,
        signal: controller.signal,
      }).catch((e) => {
        console.warn('[MTD Webhook] Passthrough error:', e?.message || e);
        return null;
      });
      clearTimeout(timeout);

      if (!resp) {
        return {
          statusCode: 202,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ accepted: true, upstream: { ok: false, note: 'forward failed' } }),
        };
      }

      console.log('[MTD Webhook] Passthrough upstream status:', { status: resp.status, statusText: resp.statusText });
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accepted: true, upstream: { status: resp.status, statusText: resp.statusText } }),
      };
    }

    // 2) JSON path: base64 -> Blob and forward as multipart
    const requestBody = JSON.parse(event.body || '{}');

    const MAX_SIZE = 5 * 1024 * 1024; // 5MB guard for CLI
    if (requestBody.fileSize && requestBody.fileSize > MAX_SIZE) {
      return {
        statusCode: 413,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ error: 'File too large', max: MAX_SIZE }),
      };
    }

    const formData = new FormData();
    const statementDate = `${new Date().toISOString().split('T')[0]}-${Date.now()}-mtd`;
    formData.append('statementDate', statementDate);
    formData.append('application_id', requestBody.applicationId || '');
    // Prefer client-provided documentId (Supabase row id). Fallback to generated id.
    const forwardedDocumentId = String(requestBody.documentId || '').trim() || `mtd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    formData.append('document_id', forwardedDocumentId);
    formData.append('business_name', requestBody.businessName || 'MTD Upload');
    formData.append('owner_name', requestBody.ownerName || 'MTD User');
    formData.append('uploadType', 'mtd');

    if (requestBody.fileData) {
      const bytes = Buffer.from(String(requestBody.fileData), 'base64');
      const blob = new Blob([bytes], { type: requestBody.fileType || 'application/pdf' });
      formData.append('file', blob, requestBody.fileName || 'mtd.pdf');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    const upstream = await fetch('https://primary-production-c8d0.up.railway.app/webhook/mtd', {
      method: 'POST',
      headers: {
        'User-Agent': 'node',
        ...(event.headers.authorization && { Authorization: event.headers.authorization }),
      },
      body: formData,
      signal: controller.signal,
    }).catch((e) => {
      console.warn('[MTD Webhook] Upstream error:', e?.message || e);
      return null;
    });
    clearTimeout(timeout);

    if (!upstream) {
      return {
        statusCode: 202,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accepted: true, upstream: { ok: false, note: 'forward failed or timed out' } }),
      };
    }

    console.log('[MTD Webhook] Upstream status:', { status: upstream.status, statusText: upstream.statusText });
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accepted: true, upstream: { status: upstream.status, statusText: upstream.statusText } }),
    };
  } catch (error) {
    console.error('[MTD Webhook] Error:', error);

    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString(),
      }),
    };
  }
};
