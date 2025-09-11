// netlify/functions/extractor.js
// Handles PDF extractor webhook. Accepts JSON or multipart/form-data with an 'extractedData' field.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
    const ct = (event.headers["content-type"] || event.headers["Content-Type"] || "").toLowerCase();
    let payload = null;

    if (ct.includes("application/json")) {
      payload = JSON.parse(event.body || "{}");
    } else if (ct.includes("multipart/form-data")) {
      // Best-effort: extract the JSON metadata; we ignore file content here.
      payload = parseMultipartExtractedData(event) || {};
    } else {
      // Default to JSON parse
      payload = JSON.parse(event.body || "{}");
    }

    // Optionally store or log payload to Supabase for auditing (no-op if supabase not configured)
    if (supabase && payload) {
      // Example: insert into a generic logs table if exists; otherwise skip silently
      try {
        await supabase.from("webhook_logs").insert({ kind: "extractor", payload, created_at: new Date().toISOString() });
      } catch {}
    }

    return jsonResponse(200, { success: true, received: !!payload });
  } catch (err) {
    return jsonResponse(500, { error: err?.message || "Unexpected server error" });
  }
}
