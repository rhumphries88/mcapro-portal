// netlify/functions/new-deal.js
// Handles PDF upload from SubmissionsPortal Bank step. Accepts multipart or JSON.

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

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return jsonResponse(200, { ok: true });
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method Not Allowed" });

  try {
    // For now we acknowledge receipt; file parsing can be added with a multipart parser if needed.
    const ct = (event.headers["content-type"] || event.headers["Content-Type"] || "").toLowerCase();
    let meta = {};
    if (ct.includes("application/json")) {
      meta = JSON.parse(event.body || "{}");
    }

    if (supabase) {
      try { await supabase.from("webhook_logs").insert({ kind: "newDeal", payload: meta, created_at: new Date().toISOString() }); } catch {}
    }

    return jsonResponse(200, { success: true });
  } catch (err) {
    return jsonResponse(500, { error: err?.message || "Unexpected server error" });
  }
}
