// netlify/functions/extractor.js
// Handles PDF extractor webhook. Accepts JSON or multipart/form-data with an 'extractedData' field.

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

function parseMultipartExtractedData(event) {
  try {
    const isBase64 = !!event.isBase64Encoded;
    const body = isBase64 ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
    // Heuristic extraction of a JSON field named extractedData from multipart body
    const m = body.match(/name="extractedData"\r?\n\r?\n([\s\S]*?)\r?\n--/);
    if (m) {
      const txt = m[1].trim();
      try { return JSON.parse(txt); } catch {}
    }
  } catch {}
  return null;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return jsonResponse(200, { ok: true });
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method Not Allowed" });

  try {
    // Server-to-server forward to n8n (preserve body and headers)
    const base = "https://primary-production-c8d0.up.railway.app";

    const path = "/webhook/extractor";
    const url = base.replace(/\/$/, "") + path;
    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    const auth = process.env.N8N_AUTH;

    const body = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : (event.body || "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        ...(contentType ? { "Content-Type": contentType } : {}),
        ...(auth ? { Authorization: auth } : {}),
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    // Read upstream, but cap what we return to Netlify CLI to avoid "Stream body too big"
    const txt = await resp.text();
    const capped = (txt || "").slice(0, 5000);
    let parsed = null; try { parsed = capped ? JSON.parse(capped) : null; } catch {}

    if (!resp.ok) {
      return jsonResponse(202, {
        accepted: true,
        note: `upstream responded ${resp.status}`,
        body: capped,
      });
    }
    return jsonResponse(200, parsed ?? { body: capped });
  } catch (err) {
    return jsonResponse(500, { error: err?.message || "Unexpected server error" });
  }
}
