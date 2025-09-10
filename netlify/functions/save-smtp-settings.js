/*
 Netlify Function: save-smtp-settings
 - Saves/upserts SMTP credentials for an application in Supabase
 - Expects: { applicationId: string, smtp: { host, port, username, password, fromEmail?, fromName? } }
 - Returns JSON, never echoes back password
*/
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

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

function validate(body) {
  const errors = [];
  if (!body || typeof body !== "object") return ["Invalid JSON body."];
  const { applicationId, smtp } = body;
  if (!applicationId || typeof applicationId !== "string") errors.push("applicationId is required and must be a string.");
  if (!smtp || typeof smtp !== "object") errors.push("smtp object is required.");
  const host = smtp?.host;
  const port = smtp?.port;
  const username = smtp?.username;
  const password = smtp?.password;
  if (!host || !port || !username || !password) errors.push("smtp.host, smtp.port, smtp.username, and smtp.password are required.");
  return errors;
}

export async function handler(event, context) {
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  if (!supabase) {
    return jsonResponse(500, { error: "Supabase client is not configured" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const errors = validate(payload);
  if (errors.length) return jsonResponse(400, { error: errors.join(" ") });

  const { applicationId, smtp } = payload;
  const { host, port, username, password, fromEmail, fromName } = smtp;

  try {
    const selectResp = await supabase
      .from("smtp_settings")
      .select("*")
      .eq("application_id", applicationId)
      .limit(1)
      .maybeSingle();

    if (selectResp.error) {
      return jsonResponse(400, { error: `Failed to read smtp_settings: ${selectResp.error.message}` });
    }

    const baseFields = {
      host,
      port: Number(port),
      username,
      password,
      from_email: fromEmail || null,
      from_name: fromName || null,
    };

    let dataOut = null;

    if (selectResp.data) {
      const updResp = await supabase
        .from("smtp_settings")
        .update({ ...baseFields, updated_at: new Date().toISOString() })
        .eq("application_id", applicationId)
        .select("*")
        .maybeSingle();
      if (updResp.error) {
        return jsonResponse(400, { error: `Failed to update smtp_settings: ${updResp.error.message}` });
      }
      dataOut = updResp.data;
    } else {
      const insResp = await supabase
        .from("smtp_settings")
        .insert({ application_id: applicationId, ...baseFields })
        .select("*")
        .maybeSingle();
      if (insResp.error) {
        return jsonResponse(400, { error: `Failed to insert smtp_settings: ${insResp.error.message}` });
      }
      dataOut = insResp.data;
    }

    if (dataOut) delete dataOut.password;
    return jsonResponse(200, { success: true, applicationId, data: dataOut });
  } catch (err) {
    const message = err?.message || "Unexpected server error";
    console.error("[function] save-smtp-settings 500:", message, err);
    return jsonResponse(500, { error: message });
  }
}
