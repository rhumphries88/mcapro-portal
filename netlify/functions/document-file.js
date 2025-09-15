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
    try {
      // Attempt to parse as JSON if content-type indicates JSON or parsing simply succeeds
      const mightBeJson = (contentType || "").toLowerCase().includes("application/json");
      const parsed = mightBeJson || raw.trim().startsWith("{") ? JSON.parse(raw || "{}") : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        // Add id if not provided
        if (!parsed.id) parsed.id = crypto.randomUUID();
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
    return jsonResponse(resp.status, payload == null ? {} : payload);
  } catch (err) {
    return jsonResponse(500, { error: err?.message || "Unexpected server error" });
  }
}

