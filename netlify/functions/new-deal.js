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
    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    const auth = process.env.N8N_AUTH;

    const body = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : (event.body || "");

    // Best-of-both: wait up to ~28s for n8n to respond; otherwise return 202.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 28000);

    try {
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

      const text = await resp.text();
      let payload;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
      // If n8n returned a non-OK status, do not surface 4xx/5xx to the browser.
      if (!resp.ok) {
        console.warn("[new-deal] n8n non-OK status, returning 202 instead:", resp.status, resp.statusText, typeof text === 'string' ? text.slice(0,200) : '');
        return jsonResponse(202, { accepted: true, note: `n8n responded ${resp.status}`, data: payload });
      }
      // Pass-through OK responses when we got them in time.
      return jsonResponse(resp.status, payload == null ? {} : payload);
    } catch (e) {
      // On timeout or network error, return 202 and let n8n continue. Log for diagnostics.
      console.warn("[new-deal] early return (background continue):", e?.name || e?.message || e);
      return jsonResponse(202, { accepted: true, note: "forward continuing in background", error: String(e?.message || e) });
    }
  } catch (err) {
    // Do not fail the UI; treat as accepted and continue. Log error for analysis.
    console.warn("[new-deal] outer error:", err?.message || err);
    return jsonResponse(202, { accepted: true, note: "unhandled error; continue in background", error: String(err?.message || err) });
  }
}
