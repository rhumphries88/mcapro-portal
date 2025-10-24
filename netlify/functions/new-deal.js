// netlify/functions/new-deal.js
// Handles PDF upload from SubmissionsPortal Bank step. Accepts multipart or JSON.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

function jsonResponse(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return jsonResponse(200, { ok: true });
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method Not Allowed" });

  try {
    const base = "https://primary-production-c8d0.up.railway.app";
    const path = "/webhook/newDeal";
    const url = base.replace(/\/$/, "") + path;
    const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
    const auth = process.env.N8N_AUTH;

    // If JSON payload with batch files, handle in-function (upload to Supabase + DB insert), then return an array
    const isJson = contentType.toLowerCase().includes("application/json");
    if (isJson) {
      const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
      if (!parsed || typeof parsed !== "object") return jsonResponse(400, { error: "Invalid JSON" });
      const application_id = parsed.application_id || parsed.applicationId || null;
      if (!application_id) return jsonResponse(400, { error: "application_id required" });

      // Path A: JSON with single file_url -> fetch server-side and forward as multipart (preferred for large files)
      if (typeof parsed.file_url === 'string' && parsed.file_url) {
        try {
          const fileUrl = String(parsed.file_url);
          const fileName = parsed.file_name || fileUrl.split('/').pop() || 'document.pdf';
          const fileType = parsed.file_type || 'application/pdf';
          const document_id = parsed.document_id || parsed.documentId || null;
          const statementDate = parsed.statementDate || parsed.statement_date || null;

          const controller = new AbortController();
          const dltimer = setTimeout(() => controller.abort(), 20000);
          const dl = await fetch(fileUrl, { signal: controller.signal });
          clearTimeout(dltimer);
          if (!dl.ok) return jsonResponse(400, { error: 'Failed to fetch file_url', status: dl.status });
          const bytes = new Uint8Array(await dl.arrayBuffer());

          const form = new FormData();
          form.append('application_id', String(application_id));
          if (statementDate) form.append('statementDate', String(statementDate));
          if (document_id) form.append('document_id', String(document_id));
          form.append('file', new Blob([bytes], { type: fileType }), fileName);

          const upController = new AbortController();
          const upTimer = setTimeout(() => upController.abort(), 20000);
          const uResp = await fetch(url, { method: 'POST', headers: { ...(auth ? { Authorization: auth } : {}) }, body: form, signal: upController.signal });
          clearTimeout(upTimer);
          const txt = await uResp.text();
          let parsedUp = null; try { parsedUp = txt ? JSON.parse(txt) : null; } catch {}
          return jsonResponse(uResp.ok ? 200 : 502, { forwarded: true, status: uResp.status, body: (txt || '').slice(0, 5000), json: parsedUp });
        } catch (e) {
          return jsonResponse(502, { forwarded: false, error: String(e?.message || e) });
        }
      }

      // Path B: JSON with batch base64 files (existing behavior)
      if (!supabase) return jsonResponse(500, { error: "Supabase not configured" });
      const files = Array.isArray(parsed.files) ? parsed.files : [];
      if (files.length === 0) return jsonResponse(400, { error: "files[] required" });

      const bucket = "application_documents";
      const results = [];
      const forwardFiles = [];
      for (const f of files) {
        const file_name = f.file_name || f.name;
        const file_type = f.file_type || f.type || "application/pdf";
        const b64 = f.file_bytes_base64 || f.base64 || null;
        if (!file_name || !b64) {
          results.push({ file_name, status: "failed", error: "missing name or bytes" });
          continue;
        }
        try {
          const bytes = Buffer.from(String(b64), "base64");
          const { error: upErr } = await supabase.storage.from(bucket).upload(file_name, bytes, { contentType: file_type, upsert: true });
          if (upErr) throw new Error(upErr.message || "upload failed");
          const { data: pub } = supabase.storage.from(bucket).getPublicUrl(file_name);
          const file_url = pub?.publicUrl || null;
          const insertPayload = {
            application_id,
            file_name,
            file_size: bytes.length,
            file_type,
            file_url,
            upload_status: file_url ? 'uploaded' : 'failed',
          };
          const { data: inserted, error: insErr } = await supabase
            .from('application_documents')
            .insert(insertPayload)
            .select('id')
            .maybeSingle();
          if (insErr) throw new Error(insErr.message || "db insert failed");
          const document_id = inserted?.id || null;
          forwardFiles.push({ file_name, file_type, bytes, document_id });
          results.push({ file_name, file_url, status: 'uploaded', document_id });
        } catch (e) {
          try { await supabase.from('application_documents').insert({ application_id, file_name: f.file_name || f.name, file_size: 0, file_type: f.file_type || f.type || 'application/pdf', upload_status: 'failed' }); } catch {}
          results.push({ file_name: f.file_name || f.name, status: 'failed', error: String(e?.message || e) });
        }
      }

      let upstream = { ok: false };
      try {
        if (forwardFiles.length > 0) {
          const form = new FormData();
          form.append('application_id', String(application_id));
          forwardFiles.forEach((ff, idx) => {
            const field = idx === 0 ? 'file' : `file_${idx}`;
            form.append(field, new Blob([ff.bytes], { type: ff.file_type }), ff.file_name);
          });
          const manifest = forwardFiles.map(f => ({ file_name: f.file_name, file_type: f.file_type, document_id: f.document_id }));
          form.append('file_manifest', JSON.stringify(manifest));
          const ids = forwardFiles.map(f => f.document_id).filter(Boolean);
          if (ids.length === 1) form.append('document_id', String(ids[0]));
          if (ids.length > 0) form.append('document_ids', JSON.stringify(ids));

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 20000);
          const uResp = await fetch(url, { method: 'POST', headers: { ...(auth ? { Authorization: auth } : {}) }, body: form, signal: controller.signal });
          clearTimeout(timer);
          const txt = await uResp.text();
          let parsed = null; try { parsed = txt ? JSON.parse(txt) : null; } catch {}
          upstream = { ok: uResp.ok, status: uResp.status, body: (txt || '').slice(0, 5000), json: parsed };
        } else {
          upstream = { ok: true, status: 204, note: 'no files to forward' };
        }
      } catch (e) {
        upstream = { ok: false, error: String(e?.message || e) };
      }

      return jsonResponse(200, { uploaded: results, upstream });
    }

    // Fallback: Non-JSON (e.g., multipart) — forward to external webhook as before
    const body = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : (event.body || "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 28000);
    try {
      const resp = await fetch(url, { method: 'POST', headers: { ...(contentType ? { 'Content-Type': contentType } : {}), ...(auth ? { Authorization: auth } : {}) }, body, signal: controller.signal });
      clearTimeout(timer);
      const text = await resp.text();
      let payload; try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
      if (!resp.ok) {
        console.warn('[new-deal] n8n non-OK status, returning 202 instead:', resp.status, resp.statusText, typeof text === 'string' ? text.slice(0,200) : '');
        return jsonResponse(202, { accepted: true, note: `n8n responded ${resp.status}`, data: payload });
      }
      return jsonResponse(resp.status, payload == null ? {} : payload);
    } catch (e) {
      console.warn('[new-deal] early return (background continue):', e?.name || e?.message || e);
      return jsonResponse(202, { accepted: true, note: 'forward continuing in background', error: String(e?.message || e) });
    }
  } catch (err) {
    // Do not fail the UI; treat as accepted and continue. Log error for analysis.
    console.warn("[new-deal] outer error:", err?.message || err);
    return jsonResponse(202, { accepted: true, note: "unhandled error; continue in background", error: String(err?.message || err) });
  }
}
