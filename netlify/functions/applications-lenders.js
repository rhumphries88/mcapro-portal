// netlify/functions/applications-lenders.js
// Accepts application JSON and returns lender matches (placeholder demo response).

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
    const app = JSON.parse(event.body || "{}");

    // Example: fetch active lenders and return a simple match skeleton
    let lenders = [];
    if (supabase) {
      try {
        const { data, error } = await supabase.from("lenders").select("id, name, contact_email, min_amount, max_amount, min_credit_score, max_credit_score, min_time_in_business, min_monthly_revenue, industries, factor_rate, payback_term, approval_time");
        if (error) throw error;
        lenders = data || [];
      } catch (e) {
        return jsonResponse(400, { error: `Failed to load lenders: ${e.message}` });
      }
    }

    // Minimal placeholder logic: return all lenders with a neutral matchScore
    const matches = (lenders || []).map(l => ({ lender_id: l.id, match_score: 50 }));

    return jsonResponse(200, { matches });
  } catch (err) {
    return jsonResponse(500, { error: err?.message || "Unexpected server error" });
  }
}
