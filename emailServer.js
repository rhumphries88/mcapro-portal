const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();
const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
}
const envExamplePath = path.resolve(process.cwd(), '.env.example');
if (fs.existsSync(envExamplePath)) {
  dotenv.config({ path: envExamplePath });
}

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Configuration
const PORT = process.env.PORT || 4000;

// Supabase client
// Support fallback to VITE_ variables in dev if direct vars are not provided
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('Supabase configuration missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.');
}

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

/**
 * Helper: Download an attachment from a URL into a Buffer suitable for nodemailer.
 * @param {string} url - The URL to download.
 * @param {string} filename - The filename to use for the attachment.
 * @returns {Promise<{ filename: string, content: Buffer }>}
 */
async function downloadAttachment(url, filename) {
  if (!url) {
    throw new Error('Attachment URL is required.');
  }
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return {
    filename: filename || path.basename(new URL(url).pathname) || 'attachment',
    content: Buffer.from(response.data),
  };
}

/**
 * Validate basic request payload for /send-application-email.
 */
function validateRequestBody(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    errors.push('Invalid JSON body.');
    return errors;
  }

  const { applicationId, lenders, subject, body: htmlBody } = body;

  if (!applicationId || typeof applicationId !== 'string') {
    errors.push('applicationId is required and must be a string.');
  }
  if (!Array.isArray(lenders) || lenders.length === 0) {
    errors.push('lenders must be a non-empty array of email addresses.');
  }
  if (!subject || typeof subject !== 'string') {
    errors.push('subject is required and must be a string.');
  }
  if (!htmlBody || typeof htmlBody !== 'string') {
    errors.push('body is required and must be a string (HTML).');
  }

  return errors;
}

/**
 * Fetch SMTP settings for a given application from Supabase.
 * Expects a table named `smtp_settings` with at least:
 *   application_id, host, port, username, password, from_email (optional), from_name (optional)
 */
async function fetchSmtpSettings(applicationId) {
  if (!supabase) {
    throw new Error('Supabase client is not configured on this server.');
  }

  const { data, error } = await supabase
    .from('smtp_settings')
    .select('*')
    .eq('application_id', applicationId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to query smtp_settings: ${error.message}`);
  }
  if (!data) return null;
  // Normalize field names so callers can rely on smtp_host/smtp_port
  return {
    ...data,
    smtp_host: data.smtp_host || data.host || null,
    smtp_port: Number(data.smtp_port ?? data.port ?? 0) || null,
  };
}

/**
 * Build nodemailer attachments from the request `attachments` array.
 * Supports:
 *   - { filename, url } -> downloaded as buffer
 *   - { filename, path } -> used directly from disk path
 */
async function buildAttachments(attachments = []) {
  const results = [];

  for (const att of attachments) {
    if (!att || typeof att !== 'object') continue;

    if (att.url) {
      // Download and attach as buffer
      try {
        const downloaded = await downloadAttachment(att.url, att.filename);
        results.push({
          filename: downloaded.filename,
          content: downloaded.content,
        });
      } catch (err) {
        // Skip failed attachment but do not fail the entire request
        console.warn(`Attachment download failed for URL: ${att.url} - ${err.message}`);
      }
    } else if (att.path) {
      // Attach from file path (ensure the file exists)
      try {
        const exists = fs.existsSync(att.path);
        if (!exists) {
          console.warn(`Attachment path does not exist: ${att.path}`);
          continue;
        }
        results.push({
          filename: att.filename || path.basename(att.path),
          path: att.path,
        });
      } catch (err) {
        console.warn(`Failed to attach from path: ${att.path} - ${err.message}`);
      }
    } else {
      console.warn('Attachment skipped: provide either "url" or "path".');
    }
  }

  return results;
}

/**
 * POST /send-application-email
 * Sends application emails to the provided list of lender emails using application-specific SMTP settings.
 */
async function sendApplicationEmailHandler(req, res) {
  const validationErrors = validateRequestBody(req.body);
  if (validationErrors.length > 0) {
    return res.status(400).json({ error: validationErrors.join(' ') });
  }

  const { applicationId, lenders, subject, body: htmlBody, attachments = [] } = req.body;

  try {
    // Fetch SMTP settings tied to this application
    const smtp = await fetchSmtpSettings(applicationId);
    if (!smtp) {
      return res.status(400).json({ error: 'No smtp_settings row found for applicationId.' });
    }
    // Normalize and validate required fields
    const smtpHost = smtp.smtp_host;
    const smtpPort = Number(smtp.smtp_port);
    const smtpUser = smtp.username;
    const smtpPass = smtp.password;
    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
      return res.status(400).json({
        error: 'Invalid SMTP settings for this application. Expected smtp_host/smtp_port/username/password to be present.',
        details: {
          has_host: Boolean(smtpHost),
          has_port: Boolean(smtpPort),
          has_username: Boolean(smtpUser),
          has_password: Boolean(smtpPass),
        }
      });
    }

    // Create nodemailer transporter
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465, // true for 465, false for other ports
      auth: {
        user: smtpUser,
        pass: smtpPass, // Never log this
      },
    });

    // Optionally verify connection configuration (non-fatal if it fails)
    try {
      await transporter.verify();
    } catch (verifyErr) {
      console.warn(`SMTP transporter verification warning: ${verifyErr.message}`);
    }

    // Build attachments
    const mailAttachments = await buildAttachments(attachments);

    // From details
    const fromEmail = smtp.from_email || smtpUser;
    const fromName = smtp.from_name || 'MCA Portal';
    const from = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;

    // Deduplicate and sanitize lender emails (basic)
    const uniqueLenders = Array.from(
      new Set(
        lenders
          .map((e) => (typeof e === 'string' ? e.trim() : ''))
          .filter((e) => e.length > 0)
      )
    );

    // Build a map from lender contact_email -> lender_submissions.id for this application
    // We assume rows for this application were pre-created by the frontend (createLenderSubmissions)
    const emailToSubmissionId = new Map();
    try {
      if (supabase && applicationId) {
        const { data: subs, error: subsErr } = await supabase
          .from('lender_submissions')
          .select('id,lender_id,application_id,status')
          .eq('application_id', applicationId);
        if (subsErr) throw subsErr;

        // Fetch lender contact emails for those lender_ids
        const lenderIds = Array.from(new Set((subs || []).map(r => r.lender_id).filter(Boolean)));
        if (lenderIds.length) {
          const { data: lendersRows, error: lendersErr } = await supabase
            .from('lenders')
            .select('id,contact_email')
            .in('id', lenderIds);
          if (lendersErr) throw lendersErr;
          const contactById = new Map((lendersRows || []).map(r => [r.id, (r.contact_email || '').toLowerCase().trim()]));
          (subs || []).forEach(sub => {
            const ce = contactById.get(sub.lender_id);
            if (ce) emailToSubmissionId.set(ce, sub.id);
          });
        }
      }
    } catch (mapErr) {
      console.warn('Failed to map lender emails to submission IDs:', mapErr.message);
    }

    const results = [];

    // Send emails individually
    for (const lenderEmail of uniqueLenders) {
      try {
        const info = await transporter.sendMail({
          from,
          to: lenderEmail,
          cc: (fromEmail && fromEmail.toLowerCase() !== (lenderEmail || '').toLowerCase()) ? fromEmail : undefined,
          subject,
          html: htmlBody, // Use HTML exactly as provided
          attachments: mailAttachments,
        });

        results.push({
          lender: lenderEmail,
          status: 'sent',
          messageId: info && info.messageId ? info.messageId : undefined,
        });

        // Best-effort: persist provider messageId to lender_submissions for reply-thread matching
        try {
          const key = (lenderEmail || '').toLowerCase().trim();
          const submissionId = emailToSubmissionId.get(key);
          if (submissionId && info && info.messageId && supabase) {
            const { error: updErr } = await supabase
              .from('lender_submissions')
              .update({ provider_message_id: String(info.messageId), status: 'sent' })
              .eq('id', submissionId);
            if (updErr) {
              // If column does not exist, log a hint but continue
              if (/column .*provider_message_id/i.test(updErr.message)) {
                console.warn("Hint: add column 'provider_message_id text' to lender_submissions for reply matching.");
              } else {
                console.warn('Failed to store provider_message_id:', updErr.message);
              }
            }
          }
        } catch (storeErr) {
          console.warn('Storing messageId failed:', storeErr.message);
        }
      } catch (sendErr) {
        // Do not include sensitive data in error responses
        results.push({
          lender: lenderEmail,
          status: 'failed',
          error: sendErr && sendErr.message ? sendErr.message : 'Failed to send',
        });
      }
    }

    return res.json({
      success: true,
      applicationId,
      results,
    });
  } catch (err) {
    const message = err && err.message ? err.message : 'Unexpected server error';
    console.error('[server] /send-application-email 500:', message, err);
    return res.status(500).json({ error: message });
  }
}

/**
 * POST /save-smtp-settings
 * Securely store SMTP settings for a given application in the `smtp_settings` table.
 * Body (client-side field names): { applicationId: string, smtp: { host, port, username, password, fromEmail? } }
 * DB columns (server-side): smtp_host, smtp_port, username, password, from_email
 */
async function saveSmtpSettingsHandler(req, res) {
  try {
    const { applicationId, smtp } = req.body || {};
    if (!applicationId || !smtp) {
      return res.status(400).json({ error: 'applicationId and smtp are required.' });
    }
    const { host, port, username, password, fromEmail } = smtp;
    if (!host || !port || !username || !password) {
      return res.status(400).json({ error: 'smtp.host, smtp.port, smtp.username, and smtp.password are required.' });
    }

    if (!supabase) {
      return res.status(500).json({ error: 'Supabase client is not configured on this server.' });
    }

    // Manual upsert to avoid requiring a UNIQUE index
    let dataOut = null;
    const selectResp = await supabase
      .from('smtp_settings')
      .select('*')
      .eq('application_id', applicationId)
      .limit(1)
      .maybeSingle();

    if (selectResp.error) {
      console.error('[server] save-smtp-settings select failed:', selectResp.error.message);
      return res.status(400).json({ error: `Failed to read smtp_settings: ${selectResp.error.message}` });
    }

    const baseFields = {
      host,
      port: Number(port),
      username,
      password,
      from_email: fromEmail || null,
    };

    if (selectResp.data) {
      // Update existing
      const updResp = await supabase
        .from('smtp_settings')
        .update({ ...baseFields, updated_at: new Date().toISOString() })
        .eq('application_id', applicationId)
        .select('*')
        .maybeSingle();
      if (updResp.error) {
        console.error('[server] save-smtp-settings update failed:', updResp.error.message);
        return res.status(400).json({ error: `Failed to update smtp_settings: ${updResp.error.message}` });
      }
      dataOut = updResp.data;
    } else {
      // Insert new
      const insResp = await supabase
        .from('smtp_settings')
        .insert({ application_id: applicationId, ...baseFields })
        .select('*')
        .maybeSingle();
      if (insResp.error) {
        console.error('[server] save-smtp-settings insert failed:', insResp.error.message);
        return res.status(400).json({ error: `Failed to insert smtp_settings: ${insResp.error.message}` });
      }
      dataOut = insResp.data;
    }

    // Never return password back to the client
    if (dataOut) delete dataOut.password;
    return res.json({ success: true, applicationId, data: dataOut });
  } catch (err) {
    const message = err && err.message ? err.message : 'Unexpected server error';
    console.error('[server] /save-smtp-settings 500:', message, err);
    return res.status(500).json({ error: message });
  }
}

// Register routes for both bare and '/api' prefixed paths to be resilient to proxy config
app.post('/send-application-email', sendApplicationEmailHandler);
app.post('/api/send-application-email', sendApplicationEmailHandler);
app.post('/save-smtp-settings', saveSmtpSettingsHandler);
app.post('/api/save-smtp-settings', saveSmtpSettingsHandler);

// Masked debug endpoint to view what the server reads for a given applicationId
// WARNING: Do not expose in production without auth; intended for local debugging
app.get('/_debug/smtp/:applicationId', async (req, res) => {
  try {
    const applicationId = req.params.applicationId;
    const data = await fetchSmtpSettings(applicationId);
    if (!data) return res.status(404).json({ error: 'Not found' });
    const masked = { ...data };
    if (masked.password) masked.password = '***';
    return res.json(masked);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'failed' });
  }
});

// Debug endpoint to verify env without exposing secrets
app.get('/_debug/env', (_req, res) => {
  res.json({
    hasSupabaseUrl: Boolean(SUPABASE_URL),
    hasServiceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    port: PORT,
  });
});

// Basic health check
app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'emailServer', time: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Email server running on port ${PORT}`);
});
