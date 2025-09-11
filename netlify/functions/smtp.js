// netlify/functions/smtp.js
// Receives SMTP metadata; store/log as needed.

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

    const path = "/webhook/smtp";
    const url = base.replace(/\/$/, "") + path;
    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    const auth = process.env.N8N_AUTH;

    const body = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : (event.body || "");
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        ...(contentType ? { "Content-Type": contentType } : {}),
        ...(auth ? { Authorization: auth } : {}),
      },
      body,
    });

    const text = await resp.text();
    let payload;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    return jsonResponse(resp.status, payload == null ? {} : payload);
  } catch (err) {
    return jsonResponse(500, { error: err?.message || "Unexpected server error" });
  }
}
