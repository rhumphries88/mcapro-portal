/*
 Netlify Function: send-application-email
 - Sends emails to a list of lenders using application-specific SMTP settings stored in Supabase
 - Updates lender_submissions with provider_message_id and status
 - Accepts attachments from URLs
*/
 
const nodemailer = require("nodemailer");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

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

async function downloadAttachment(url, filename) {
  if (!url) throw new Error("Attachment URL is required");
  const res = await axios.get(url, { responseType: "arraybuffer" });
  const name = filename || (new URL(url).pathname.split("/").pop() || "attachment");
  return { filename: name, content: Buffer.from(res.data) };
}

async function buildAttachments(attachments = []) {
  const out = [];
  for (const att of attachments) {
    if (!att || typeof att !== "object") continue;
    if (att.url) {
      try {
        const dl = await downloadAttachment(att.url, att.filename);
        out.push({ filename: dl.filename, content: dl.content });
      } catch (e) {
        console.warn(`Attachment download failed for ${att.url}: ${e.message}`);
      }
    }
  }
  return out;
}

async function fetchSmtpSettings(applicationId) {
  if (!supabase) throw new Error("Supabase client is not configured");
  const { data, error } = await supabase
    .from("smtp_settings")
    .select("*")
    .eq("application_id", applicationId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to query smtp_settings: ${error.message}`);
  if (!data) return null;
  return {
    ...data,
    smtp_host: data.smtp_host || data.host || null,
    smtp_port: Number(data.smtp_port ?? data.port ?? 0) || null,
  };
}

function validateRequestBody(body) {
  const errors = [];
  if (!body || typeof body !== "object") {
    errors.push("Invalid JSON body.");
    return errors;
  }
  const { applicationId, lenders, lendersDetailed, subject, body: htmlBody } = body;
  if (!applicationId || typeof applicationId !== "string") errors.push("applicationId is required and must be a string.");
  const hasEmails = (Array.isArray(lenders) && lenders.length > 0) ||
                   (Array.isArray(lendersDetailed) && lendersDetailed.some(x => x && typeof x.email === 'string' && x.email.trim().length));
  if (!hasEmails) errors.push("At least one recipient email is required in either 'lenders' or 'lendersDetailed'.");
  if (!subject || typeof subject !== "string") errors.push("subject is required and must be a string.");
  if (!htmlBody || typeof htmlBody !== "string") errors.push("body is required and must be a string (HTML).");
  return errors;
}

exports.handler = async function (event, context) {
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const validationErrors = validateRequestBody(payload);
  if (validationErrors.length) {
    return jsonResponse(400, { error: validationErrors.join(" ") });
  }

  const { applicationId, lenders, lenderIds = [], lendersDetailed = [], subject, body: htmlBody, attachments = [] } = payload;

  try {
    const smtp = await fetchSmtpSettings(applicationId);
    if (!smtp) {
      return jsonResponse(400, { error: "No smtp_settings row found for applicationId." });
    }

    const smtpHost = smtp.smtp_host;
    const smtpPort = Number(smtp.smtp_port);
    const smtpUser = smtp.username;
    const smtpPass = smtp.password;
    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
      return jsonResponse(400, {
        error: "Invalid SMTP settings for this application. Expected smtp_host/smtp_port/username/password to be present.",
      });
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    try { await transporter.verify(); } catch (e) { console.warn("SMTP verify warning:", e.message); }

    const mailAttachments = await buildAttachments(attachments);
    const fromEmail = smtp.from_email || smtpUser;
    const fromName = smtp.from_name || "MCA Portal";
    const from = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;

    // Build unified recipient list with optional lenderId pairing
    const baseEmails = Array.isArray(lenders) ? lenders : [];
    const detailed = Array.isArray(lendersDetailed) ? lendersDetailed : [];
    const targetsMap = new Map(); // email -> { email, lenderId? }
    baseEmails.forEach(e => {
      const k = (typeof e === 'string' ? e : '').trim();
      if (k) targetsMap.set(k.toLowerCase(), { email: k });
    });
    detailed.forEach(d => {
      if (!d || typeof d !== 'object') return;
      const email = (d.email || '').trim();
      if (!email) return;
      const key = email.toLowerCase();
      const existing = targetsMap.get(key) || { email };
      const lid = d.id || d.lender_id;
      targetsMap.set(key, { ...existing, lenderId: lid });
    });
    const targets = Array.from(targetsMap.values());
    const uniqueLenders = targets.map(t => t.email);

    // Build submission ID maps
    const emailToSubmissionId = new Map();
    const submissionIdByLenderId = new Map();
    try {
      if (supabase && applicationId) {
        const { data: subs, error: subsErr } = await supabase
          .from("lender_submissions")
          .select("id,lender_id,application_id,status")
          .eq("application_id", applicationId);
        if (subsErr) throw subsErr;
        const allLenderIds = Array.from(new Set((subs || []).map(r => r.lender_id).filter(Boolean)));
        (subs || []).forEach(s => { if (s.lender_id && s.id) submissionIdByLenderId.set(s.lender_id, s.id); });
        if (allLenderIds.length) {
          const { data: lendersRows, error: lendersErr } = await supabase
            .from("lenders")
            .select("id,contact_email")
            .in("id", allLenderIds);
          if (lendersErr) throw lendersErr;
          const contactById = new Map((lendersRows || []).map(r => [r.id, (r.contact_email || "").toLowerCase().trim()]));
          (subs || []).forEach(sub => {
            const ce = contactById.get(sub.lender_id);
            if (ce) emailToSubmissionId.set(ce, sub.id);
          });
        }
      }
    } catch (mapErr) {
      console.warn("Failed to map lender emails to submission IDs:", mapErr.message);
    }

    const results = [];

    for (const lenderEmail of uniqueLenders) {
      try {
        const info = await transporter.sendMail({
          from,
          to: lenderEmail,
          cc: (fromEmail && fromEmail.toLowerCase() !== (lenderEmail || '').toLowerCase()) ? fromEmail : undefined,
          subject,
          html: htmlBody,
          attachments: mailAttachments,
        });

        results.push({ lender: lenderEmail, status: "sent", messageId: info?.messageId });

        try {
          const key = (lenderEmail || '').toLowerCase().trim();
          // Prefer submissionId by lenderId if we have it from targets
          const target = targets.find(t => (t.email || '').toLowerCase() === key);
          const submissionId = (target && target.lenderId) ? submissionIdByLenderId.get(target.lenderId) : emailToSubmissionId.get(key);
          if (submissionId && info?.messageId && supabase) {
            const { error: updErr } = await supabase
              .from("lender_submissions")
              .update({ provider_message_id: String(info.messageId), status: "sent" })
              .eq("id", submissionId);
            if (updErr) console.warn("Failed to store provider_message_id:", updErr.message);
          }
        } catch (storeErr) {
          console.warn("Storing messageId failed:", storeErr.message);
        }
      } catch (sendErr) {
        results.push({ lender: lenderEmail, status: "failed", error: sendErr?.message || "Failed to send" });
        try {
          const key = (lenderEmail || '').toLowerCase().trim();
          const target = targets.find(t => (t.email || '').toLowerCase() === key);
          const submissionId = (target && target.lenderId) ? submissionIdByLenderId.get(target.lenderId) : emailToSubmissionId.get(key);
          if (submissionId && supabase) {
            await supabase
              .from("lender_submissions")
              .update({ status: "failed" })
              .eq("id", submissionId);
          }
        } catch {}
      }
    }

    return jsonResponse(200, { success: true, applicationId, results });
  } catch (err) {
    const message = err?.message || "Unexpected server error";
    console.error("[function] send-application-email 500:", message, err);
    return jsonResponse(500, { error: message });
  }
}
