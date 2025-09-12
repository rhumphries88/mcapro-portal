// netlify/functions/imap-listener.js
// One-shot IMAP processor for unseen messages from last 2 days.
// - Connects, processes unseen mail, updates Supabase, marks as seen, disconnects.
// - Safe for scheduled runs or on-demand POSTs.
// - No infinite loops, no process.exit.

import { ImapFlow } from 'imapflow';
import { createClient } from '@supabase/supabase-js';
import { simpleParser } from 'mailparser';

// ----- Environment -----
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

// ----- Supabase -----
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

// ----- Helpers: response -----
function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
    body: JSON.stringify(payload),
  };
}

function stripHtml(html) {
  try {
    return String(html)
      .replace(/<!--([\s\S]*?)-->/g, ' ')
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/[\t\r]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    return '';
  }
}

// ----- Regexes (reused from src/services/imapListener.js) -----
const APP_ID_REGEX = /Application ID:\s*([0-9a-fA-F-]{36})/i;
const LENDER_ID_REGEX = /Lender ID:\s*([0-9a-fA-F-]{36})/i;

const MONEY_REGEX =
  /(\$\s*)?([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})(?:\s*(usd|dollars))?/i; // $120,000 or 120000
const FACTOR_REGEXES = [
  /factor\s*rate\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i,
  /(\d+(?:[.,]\d+)?)[\sx]*factor\s*rate/i,
];
const TERMS_REGEXES = [
  /(\d{1,3})\s*-\s*(month|months)\s*term/i,
  /(\d{1,3})\s*(month|months)\b/i,
];

// ----- Parsing helpers (reused/adapted) -----
function extractTextFromSource(rawSource) {
  try {
    const src = rawSource.toString('utf8');
    // Split headers/body
    const splitIndex = src.indexOf('\r\n\r\n');
    const body = splitIndex >= 0 ? src.slice(splitIndex + 4) : src;
    // If HTML, strip basic tags
    if (/<[a-z][\s\S]*>/i.test(body)) {
      const withoutTags = body
        .replace(/<!--([\s\S]*?)-->/g, ' ')
        .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      return withoutTags;
    }
    return body;
  } catch {
    return '';
  }
}

function cleanEmailBody(text) {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const cleaned = [];
  let skip = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const l = line.trim();
    // Skip MIME headers and boundaries
    if (/^(content-type|content-transfer-encoding|mime-version|x-.*|boundary)\s*:/i.test(l)) continue;
    if (/^--[-A-Za-z0-9_]+/.test(l)) continue; // boundary lines
    // Skip forwarded/quoted headers
    if (/^(from|to|subject|date)\s*:/i.test(l)) continue;
    // Skip long base64-like lines
    if (l.length > 80 && /^[A-Za-z0-9+/=]+$/.test(l)) continue;
    // If reply marker, stop including below (heuristic)
    if (/^on .+wrote:$/i.test(l)) {
      skip = true;
      continue;
    }
    if (/^>/.test(l)) continue; // quoted text
    if (skip) continue;
    cleaned.push(line);
  }
  return cleaned
    .join('\n')
    .replace(/[\t\r]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseReplyFields(text) {
  let offered_amount = null;
  let factor_rate = null;
  let terms = null;

  // Amount: prefer patterns with $ then fallback to big number
  const mMoney = text.match(MONEY_REGEX);
  if (mMoney) {
    const raw = mMoney[2];
    const num = Number(String(raw).replace(/,/g, ''));
    if (!Number.isNaN(num) && num > 0) offered_amount = num;
  }

  // Factor rate
  for (const rx of FACTOR_REGEXES) {
    const m = text.match(rx);
    if (m) {
      const val = parseFloat(String(m[1]).replace(',', '.'));
      if (!Number.isNaN(val) && val > 0) {
        factor_rate = val;
        break;
      }
    }
  }

  // Terms (capture phrase or standardize to `12 months`)
  for (const rx of TERMS_REGEXES) {
    const m = text.match(rx);
    if (m) {
      const n = m[1];
      const unit = m[2] || 'months';
      terms = `${n} ${/month/i.test(unit) && !/s$/i.test(unit) ? unit + 's' : unit}`.toLowerCase();
      break;
    }
  }

  // IDs
  const appMatch = text.match(APP_ID_REGEX);
  const lenderMatch = text.match(LENDER_ID_REGEX);
  const applicationId = appMatch ? appMatch[1] : null;
  const lenderIdFromBody = lenderMatch ? lenderMatch[1] : null;

  return { offered_amount, factor_rate, terms, applicationId, lenderIdFromBody };
}

function getAddress(envelopeAddress) {
  if (!envelopeAddress) return '';
  const addr = (envelopeAddress.address || '').trim();
  return addr.toLowerCase();
}

// ----- DB helpers (reuse schema) -----
async function findLenderIdByEmail(fromEmail) {
  // Case-insensitive match; keep same approach as service
  const { data, error } = await supabase
    .from('lenders')
    .select('id, contact_email')
    .ilike('contact_email', fromEmail);
  if (error) throw new Error(`Failed to lookup lender by email: ${error.message}`);
  if (!data || !data.length) return null;
  return data[0].id;
}

async function updateSubmissionAsResponded(applicationId, lenderId, bodyText, parsed, providerMessageId) {
  const payload = {
    status: 'responded',
    response: bodyText || null,
    offered_amount: parsed.offered_amount ?? null,
    factor_rate: parsed.factor_rate ?? null,
    terms: parsed.terms ?? null,
    response_date: new Date().toISOString(),
    provider_message_id: providerMessageId ? String(providerMessageId) : null,
  };
  const { data, error } = await supabase
    .from('lender_submissions')
    .update(payload)
    .eq('application_id', applicationId)
    .eq('lender_id', lenderId)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`Failed to update lender_submissions: ${error.message}`);
  return data;
}

// ----- Load active mailboxes from Supabase smtp_settings -----
async function loadActiveMailboxesFromSupabase() {
  const { data, error } = await supabase
    .from('smtp_settings')
    .select('application_id, host, port, username, password');
  if (error) throw new Error(`Failed to read smtp_settings: ${error.message}`);

  // Filter rows that have the minimum fields to connect
  const rows = (data || []).filter(r => r && r.host && r.username && r.password);

  // Group by host+username to avoid duplicate connections if multiple applications share the same mailbox
  const map = new Map();
  for (const r of rows) {
    const key = `${(r.host || '').toLowerCase()}\u0000${(r.username || '').toLowerCase()}`;
    if (!map.has(key)) {
      map.set(key, {
        host: r.host,
        port: Number(r.port) || 993,
        secure: true,
        auth: { user: r.username, pass: r.password },
        applicationIds: new Set(),
      });
    }
    map.get(key).applicationIds.add(r.application_id);
  }

  return Array.from(map.values()).map(v => ({
    host: v.host,
    port: v.port,
    secure: v.secure,
    auth: v.auth,
    applicationIds: Array.from(v.applicationIds),
  }));
}

// ----- Main IMAP processing for a single client -----
async function processUnseenSince(client, sinceDate) {
  const processed = [];
  const skipped = [];
  const errors = [];

  // Search unseen since the provided date
  let uids = [];
  try {
    uids = await client.search({ seen: false, since: sinceDate });
  } catch (e) {
    throw new Error(`IMAP search failed: ${e.message || String(e)}`);
  }
  if (!uids || !uids.length) {
    return { processed, skipped, errors, found: 0 };
  }

  for (const uid of uids) {
    try {
      const msg = await client.fetchOne(uid, { envelope: true, source: true });
      if (!msg) {
        skipped.push({ uid, reason: 'no message' });
        continue;
      }
      const fromAddr = getAddress(msg.envelope && msg.envelope.from && msg.envelope.from[0]);
      if (!fromAddr) {
        skipped.push({ uid, reason: 'no from address' });
        // mark as seen to avoid re-processing a malformed message
        try {
          await client.messageFlagsAdd(uid, ['\\Seen']);
        } catch {}
        continue;
      }

      const raw = msg.source || Buffer.from('');
      // Try robust parsing first
      let parsedText = '';
      try {
        const parsed = await simpleParser(raw);
        if (parsed && parsed.text) parsedText = parsed.text.trim();
        if (!parsedText && parsed && parsed.html) parsedText = stripHtml(parsed.html);
      } catch {}

      // Fallback to the previous manual extraction
      if (!parsedText) {
        const textRaw = extractTextFromSource(raw).trim();
        parsedText = cleanEmailBody(textRaw);
      }
      const text = parsedText;

      const { offered_amount, factor_rate, terms, applicationId, lenderIdFromBody } = parseReplyFields(text);
      if (!applicationId) {
        skipped.push({ uid, from: fromAddr, reason: 'no applicationId' });
        try {
          await client.messageFlagsAdd(uid, ['\\Seen']);
        } catch {}
        continue;
      }

      // Determine lender id
      let lenderId = lenderIdFromBody;
      if (!lenderId) {
        try {
          lenderId = await findLenderIdByEmail(fromAddr);
        } catch (e) {
          // If we can't resolve lenderId, skip but mark seen
          errors.push({ uid, from: fromAddr, applicationId, error: `lender lookup failed: ${e.message}` });
          try {
            await client.messageFlagsAdd(uid, ['\\Seen']);
          } catch {}
          continue;
        }
      }
      if (!lenderId) {
        skipped.push({ uid, from: fromAddr, applicationId, reason: 'no lender matched' });
        try {
          await client.messageFlagsAdd(uid, ['\\Seen']);
        } catch {}
        continue;
      }

      // Update submission
      try {
        const providerMessageId = msg.envelope && msg.envelope.messageId ? msg.envelope.messageId : null;
        await updateSubmissionAsResponded(
          applicationId,
          lenderId,
          text.slice(0, 10000),
          {
            offered_amount,
            factor_rate,
            terms,
          },
          providerMessageId,
        );
      } catch (e) {
        errors.push({
          uid,
          from: fromAddr,
          applicationId,
          lenderId,
          error: `update lender_submissions failed: ${e.message}`,
        });
        // still mark seen to avoid repeats
        try {
          await client.messageFlagsAdd(uid, ['\\Seen']);
        } catch {}
        continue;
      }

      // Mark as seen
      try {
        await client.messageFlagsAdd(uid, ['\\Seen']);
      } catch {}

      processed.push({
        uid,
        from: fromAddr,
        applicationId,
        lenderId,
        offered_amount,
        factor_rate,
        terms,
      });
    } catch (e) {
      errors.push({ uid, error: e?.message || String(e) });
    }
  }

  return {
    processed,
    skipped,
    errors,
    found: uids.length,
  };
}

// ----- Netlify Function Entrypoint -----
export async function handler(event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { ok: true });
  }

  // Allow GET/POST to trigger manually or by scheduled function
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' });
  }

  if (!supabase) {
    return jsonResponse(500, { error: 'Supabase client is not configured' });
  }
  const sinceMs = 1000 * 60 * 60 * 24 * 2; // last 2 days requirement
  const sinceDate = new Date(Date.now() - sinceMs);

  try {
    // Load all distinct mailboxes from Supabase
    const mailboxes = await loadActiveMailboxesFromSupabase();
    if (!mailboxes.length) {
      return jsonResponse(200, { success: true, processed: 0, message: 'No active mailboxes found' });
    }

    let totalProcessed = 0;
    const mailboxSummaries = [];

    // Process each mailbox sequentially to stay within serverless limits
    for (const mb of mailboxes) {
      let client;
      let processedCount = 0;
      try {
        client = new ImapFlow({
          host: mb.host,
          port: mb.port || 993,
          secure: true,
          auth: mb.auth,
          logger: false,
          clientInfo: { name: 'mcapro-portal-imap-listener' },
        });

        await client.connect();
        await client.mailboxOpen('INBOX');

        const result = await processUnseenSince(client, sinceDate);
        processedCount = result.processed.length;
        totalProcessed += processedCount;
        mailboxSummaries.push({
          mailbox: `${mb.auth.user}@${mb.host}`,
          processed: processedCount,
          found: result.found,
          skipped: result.skipped ? result.skipped.length : 0,
          errors: result.errors ? result.errors.length : 0,
        });
      } catch (e) {
        mailboxSummaries.push({ mailbox: `${mb.auth.user}@${mb.host}`, error: e?.message || String(e) });
      } finally {
        try {
          if (client && !client.closed) await client.logout();
        } catch {}
      }
    }

    return jsonResponse(200, { success: true, processed: totalProcessed, mailboxes: mailboxSummaries });
  } catch (err) {
    return jsonResponse(500, { error: err?.message || 'Unexpected IMAP processing error' });
  }
}
