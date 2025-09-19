// netlify/functions/document-file.js
// Receives document metadata to persist an authoritative record for uploaded statements.

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

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

async function ensureUploadedToStorageAndUpdateRow(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (!supabase) return null;
  const bucket = "application_documents";
  const id = payload.id || payload.document_id || null;
  const application_id = payload.application_id;
  const file_name = payload.file_name;
  const file_type = payload.file_type || "application/octet-stream";
  const temp_url = payload.temp_url;
  const file_bytes_base64 = payload.file_bytes_base64;
  if (!application_id || !file_name) return null;

  // Store at the bucket root so URL looks like
  // https://<project>.supabase.co/storage/v1/object/public/application_documents/<file_name>
  const objectPath = `${file_name}`;

  try {
    // 1) If row exists and already has file_url, short-circuit
    let existingRow = null;
    if (id) {
      const { data } = await supabase
        .from("application_documents")
        .select("id,file_url,upload_status")
        .eq("id", id)
        .maybeSingle();
      existingRow = data || null;
    } else {
      const { data } = await supabase
        .from("application_documents")
        .select("id,file_url,upload_status")
        .eq("application_id", application_id)
        .eq("file_name", file_name)
        .limit(1)
        .maybeSingle();
      existingRow = data || null;
    }

    if (existingRow?.file_url) {
      // Verify object exists in storage (best-effort)
      const { data: listed } = await supabase.storage.from(bucket).list('', { search: file_name });
      if (listed && listed.length > 0) {
        if (existingRow.upload_status !== "uploaded") {
          await supabase.from("application_documents").update({ upload_status: "uploaded" }).eq("id", existingRow.id);
        }
        return { id: existingRow.id, file_name, file_url: existingRow.file_url, upload_status: "uploaded" };
      }
    }

    // 2) Acquire file bytes
    let bytes = null;
    if (file_bytes_base64) {
      const raw = Buffer.from(String(file_bytes_base64), "base64");
      bytes = raw;
    } else if (temp_url) {
      const res = await fetch(temp_url);
      if (!res.ok) throw new Error(`Failed to fetch temp_url: ${res.status}`);
      const arr = await res.arrayBuffer();
      bytes = Buffer.from(arr);
    } else if (payload.file_url && /^https?:\/\//.test(payload.file_url)) {
      // If caller already provided a URL, skip upload and just store it
      const file_url = payload.file_url;
      if (id) await supabase.from("application_documents").update({ file_url, upload_status: "uploaded" }).eq("id", id);
      return { id: id || null, file_name, file_url, upload_status: "uploaded" };
    } else {
      // No bytes provided; cannot upload.
      return null;
    }

    // 3) Try upload (idempotent: upsert false; if exists, treat as success)
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(objectPath, bytes, { contentType: file_type, upsert: false });
    if (upErr && !String(upErr.message || "").includes("The resource already exists")) {
      if (id) await supabase.from("application_documents").update({ upload_status: "failed" }).eq("id", id);
      return { id: id || null, file_name, file_url: null, upload_status: "failed", error: upErr.message };
    }

    // 4) Generate public URL
    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    const file_url = pub?.publicUrl || null;

    if (id) {
      await supabase.from("application_documents").update({ file_url, upload_status: "uploaded" }).eq("id", id);
    }

    return { id: id || null, file_name, file_url, upload_status: "uploaded" };
  } catch (e) {
    if (id) {
      try { await supabase.from("application_documents").update({ upload_status: "failed" }).eq("id", id); } catch {}
    }
    return { id: id || null, file_name, file_url: null, upload_status: "failed", error: e?.message || "upload failed" };
  }
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return jsonResponse(200, { ok: true });
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method Not Allowed" });

  try {
    const base = "https://primary-production-c8d0.up.railway.app";

    const path = "/webhook/documentFile";
    const url = base.replace(/\/$/, "") + path;
    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    const auth = process.env.N8N_AUTH;

    // Prepare body and inject a generated UUID when the payload is JSON
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : (event.body || "");

    let forwardBody = raw;
    let forwardContentType = contentType;
    let parsedBody = null;
    try {
      // Attempt to parse as JSON if content-type indicates JSON or parsing simply succeeds
      const mightBeJson = (contentType || "").toLowerCase().includes("application/json");
      const parsed = mightBeJson || raw.trim().startsWith("{") ? JSON.parse(raw || "{}") : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        // Add id if not provided
        if (!parsed.id) parsed.id = crypto.randomUUID();
        parsedBody = parsed;
        forwardBody = JSON.stringify(parsed);
        forwardContentType = "application/json";
      }
    } catch {
      // If not JSON, pass through unchanged
      forwardBody = raw;
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        ...(forwardContentType ? { "Content-Type": forwardContentType } : {}),
        ...(auth ? { Authorization: auth } : {}),
      },
      body: forwardBody,
    });

    const text = await resp.text();
    let payload;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }

    // After the external webhook completes, perform the upload + DB update.
    // Prefer fields from webhook response; fall back to original parsed body.
    let source = (payload && typeof payload === "object") ? payload : (parsedBody || null);
    let uploaded = null;
    if (source && typeof source === "object") {
      try {
        uploaded = await ensureUploadedToStorageAndUpdateRow(source);
        if (uploaded && uploaded.file_url) {
          if (payload && typeof payload === "object") {
            payload.file_url = uploaded.file_url;
            payload.upload_status = uploaded.upload_status;
          } else if (parsedBody) {
            parsedBody.file_url = uploaded.file_url;
            parsedBody.upload_status = uploaded.upload_status;
            payload = parsedBody;
          } else {
            payload = uploaded;
          }
        }
      } catch {}
    }

    if (!payload || typeof payload !== "object") {
      if (uploaded) return jsonResponse(resp.status, uploaded);
      return jsonResponse(resp.status, {});
    }

    // Ensure the response includes the document id for frontend consumption
    try {
      // Prefer id from uploaded result if available
      if (uploaded && uploaded.id && !payload.id) payload.id = uploaded.id;
      // If upstream omitted id, but our parsedBody had one, merge it back
      if (parsedBody && typeof parsedBody === 'object' && parsedBody.id && !payload.id) {
        payload.id = parsedBody.id;
      }
      // Mirror id as document_id for compatibility
      if (payload.id && !payload.document_id) payload.document_id = payload.id;
    } catch {}

    return jsonResponse(resp.status, payload);
  } catch (err) {
    return jsonResponse(500, { error: err?.message || "Unexpected server error" });
  }
}

