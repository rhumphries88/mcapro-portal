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

    // Attempt to capture small fields from multipart body for later tagging
    const parseField = (name) => {
      try {
        if (!contentType || !/multipart\/form-data/i.test(contentType)) return null;
        const str = Buffer.isBuffer(body) ? body.toString("utf8") : String(body || "");
        const re = new RegExp(`name=\"${name}\"\\r?\\n\\r?\\n([\\s\\S]*?)\\r?\\n--`);
        const m = str.match(re);
        if (m) return m[1].trim();
      } catch {}
      return null;
    };
    const applicationId = parseField('applicationId') || parseField('id') || null;
    const statementDate = parseField('statementDate') || null;

    // Best-of-both: wait up to 15s for n8n to respond; otherwise return 202.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

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
      // Persist result for status polling if possible
      if (supabase) {
        try {
          await supabase.from('webhook_logs').insert({
            kind: 'newDeal_result',
            application_id: applicationId,
            statement_date: statementDate,
            payload,
            created_at: new Date().toISOString(),
          });
        } catch {}
      }
      // Pass-through response when we got it in time.
      return jsonResponse(resp.status, payload == null ? {} : payload);
    } catch (e) {
      // On timeout or network error, return 202 and let n8n continue. Log for diagnostics.
      console.warn("[new-deal] early return (background continue):", e?.name || e?.message || e);
      // Kick off a background forward and persist when done
      fetch(url, {
        method: "POST",
        headers: {
          ...(contentType ? { "Content-Type": contentType } : {}),
          ...(auth ? { Authorization: auth } : {}),
        },
        body,
      })
        .then(async (r) => {
          const t = await r.text();
          let p; try { p = t ? JSON.parse(t) : null; } catch { p = t; }
          if (supabase) {
            try {
              await supabase.from('webhook_logs').insert({
                kind: 'newDeal_result',
                application_id: applicationId,
                statement_date: statementDate,
                payload: p,
                created_at: new Date().toISOString(),
              });
            } catch {}
          }
        })
        .catch(() => {});
      return jsonResponse(202, { accepted: true });
    }
  } catch (err) {
    return jsonResponse(500, { error: err?.message || "Unexpected server error" });
  }
}
