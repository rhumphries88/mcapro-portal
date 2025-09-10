// src/services/imapListener.js
// Listens for replies to sent emails and updates Supabase lender_submissions

// Load env like emailServer.js does
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

const { ImapFlow } = require('imapflow');
const { createClient } = require('@supabase/supabase-js');

// Supabase setup (reuse same env scheme as emailServer.js)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[imap] Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Regex to find `Application ID: <uuid>` in message body
const APP_ID_REGEX = /Application ID:\s*([0-9a-fA-F-]{36})/i;
const LENDER_ID_REGEX = /Lender ID:\s*([0-9a-fA-F-]{36})/i;

// Parsing regexes
const MONEY_REGEX = /(\$\s*)?([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})(?:\s*(usd|dollars))?/i; // $120,000 or 120000
const FACTOR_REGEXES = [
  /factor\s*rate\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i,
  /(\d+(?:[.,]\d+)?)[\sx]*factor\s*rate/i,
];
const TERMS_REGEXES = [
  /(\d{1,3})\s*-\s*(month|months)\s*term/i,
  /(\d{1,3})\s*(month|months)\b/i,
];

// Helper: crude text extraction from raw RFC822 source if we don't have an easy text part
function extractTextFromSource(rawSource) {
  try {
    const src = rawSource.toString('utf8');
    // Split headers/body
    const splitIndex = src.indexOf('\r\n\r\n');
    const body = splitIndex >= 0 ? src.slice(splitIndex + 4) : src;
    // If HTML, try to strip basic tags
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
  } catch (e) {
    return '';
  }
}

// Clean the raw text body to remove MIME headers/boundaries and quoted cruft
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
    // Skip typical forwarded/quoted headers inside body
    if (/^(from|to|subject|date)\s*:/i.test(l)) continue;
    // Skip long base64-like lines
    if (l.length > 80 && /^[A-Za-z0-9+/=]+$/.test(l)) continue;
    // If reply marker, stop including below (heuristic)
    if (/^on .+wrote:$/i.test(l)) { skip = true; continue; }
    if (/^>/.test(l)) continue; // quoted text
    if (skip) continue;
    cleaned.push(line);
  }
  // Collapse excessive whitespace
  return cleaned.join('\n')
    .replace(/[\t\r]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Parse values from the cleaned body
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
      if (!Number.isNaN(val) && val > 0) { factor_rate = val; break; }
    }
  }

  // Terms (capture phrase or standardize to `12 months`)
  for (const rx of TERMS_REGEXES) {
    const m = text.match(rx);
    if (m) {
      const n = m[1];
      const unit = (m[2] || 'months');
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

// Normalize email address from envelope
function getAddress(envelopeAddress) {
  if (!envelopeAddress) return '';
  const addr = (envelopeAddress.address || '').trim();
  return addr.toLowerCase();
}

// Fetch all active mailboxes from smtp_settings
async function loadActiveMailboxes() {
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
        username: r.username,
        password: r.password,
        // Track which applications use this mailbox (could be useful for future routing)
        applicationIds: new Set(),
      });
    }
    map.get(key).applicationIds.add(r.application_id);
  }

  return Array.from(map.values()).map(v => ({
    host: v.host,
    port: 993, // Always 993 with TLS
    secure: true,
    auth: { user: v.username, pass: v.password },
    applicationIds: Array.from(v.applicationIds),
  }));
}

async function findLenderIdByEmail(fromEmail) {
  // Case-insensitive match
  const { data, error } = await supabase
    .from('lenders')
    .select('id, contact_email')
    .ilike('contact_email', fromEmail);
  if (error) throw new Error(`Failed to lookup lender by email: ${error.message}`);
  if (!data || !data.length) return null;
  return data[0].id;
}

async function updateSubmissionAsResponded(applicationId, lenderId, bodyText, parsed) {
  const payload = {
    status: 'responded',
    response: bodyText || null,
    offered_amount: parsed.offered_amount ?? null,
    factor_rate: parsed.factor_rate ?? null,
    terms: parsed.terms ?? null,
    response_date: new Date().toISOString(),
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

async function processNewMessages(client) {
  // Search for recent unseen messages
  const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 3); // last 3 days as a safety net
  let uids = [];
  try {
    uids = await client.search({ seen: false, since });
  } catch (e) {
    console.warn('[imap] search failed:', e.message);
    return;
  }
  if (!uids || !uids.length) return;

  for (const uid of uids) {
    try {
      const msg = await client.fetchOne(uid, { envelope: true, source: true });
      if (!msg) continue;
      const fromAddr = getAddress(msg.envelope && msg.envelope.from && msg.envelope.from[0]);
      if (!fromAddr) continue;

      const raw = msg.source || Buffer.from('');
      const textRaw = extractTextFromSource(raw).trim();
      const text = cleanEmailBody(textRaw);

      const { offered_amount, factor_rate, terms, applicationId, lenderIdFromBody } = parseReplyFields(text);
      if (!applicationId) {
        console.log(`[imap] Skipped message from ${fromAddr} - no Application ID found`);
        // mark as seen to avoid reprocessing
        try { await client.messageFlagsAdd(uid, ['\\Seen']); } catch {}
        continue;
      }

      // Determine lender id
      let lenderId = lenderIdFromBody;
      if (!lenderId) {
        // Find lender by email fallback
        lenderId = await findLenderIdByEmail(fromAddr);
      }
      if (!lenderId) {
        console.log(`[imap] No lender matched for ${fromAddr} (app ${applicationId})`);
        try { await client.messageFlagsAdd(uid, ['\\Seen']); } catch {}
        continue;
      }

      // Update submission
      try {
        console.log(`[imap] Reply captured | app=${applicationId} lender=${lenderId}`);
        console.log(`[imap] Parsed reply → amount=${offered_amount ?? 'NULL'}, rate=${factor_rate ?? 'NULL'}, terms=${terms ?? 'NULL'}`);
        await updateSubmissionAsResponded(applicationId, lenderId, text.slice(0, 10000), { offered_amount, factor_rate, terms });
        console.log('[imap] Updated lender_submissions successfully');
      } catch (e) {
        console.warn(`[imap] Failed to update lender_submissions: ${e.message}`);
      }

      // Mark as seen
      try { await client.messageFlagsAdd(uid, ['\\Seen']); } catch {}
    } catch (e) {
      console.warn('[imap] fetch/process failed:', e.message);
    }
  }
}

async function startMailboxListener(config) {
  const { host, port, secure, auth } = config;

  let client;
  let stopped = false;
  let backoff = 2000; // ms
  const maxBackoff = 60 * 1000;

  async function connectAndIdle() {
    while (!stopped) {
      try {
        client = new ImapFlow({ host, port, secure, auth, logger: false, clientInfo: { name: 'mcapro-portal-imap-listener' } });

        client.on('close', () => {
          console.warn(`[imap] Connection closed for ${auth.user}@${host}`);
        });
        client.on('error', (err) => {
          console.warn(`[imap] Error for ${auth.user}@${host}:`, err && err.message ? err.message : err);
        });

        await client.connect();
        console.log(`[imap] Connected: ${auth.user}@${host}`);

        // Open INBOX
        await client.mailboxOpen('INBOX');
        console.log(`[imap] INBOX opened: ${auth.user}@${host}`);

        // Process any unseen messages at startup
        await processNewMessages(client);

        // Listen for new mail via EXISTS changes
        client.on('exists', async () => {
          try {
            await processNewMessages(client);
          } catch (e) {
            console.warn('[imap] exists handler failed:', e.message);
          }
        });

        // Keep the connection alive and idling
        while (!stopped && !client.closed) {
          try {
            // imapflow manages idling internally; small wait to yield loop
            await new Promise(res => setTimeout(res, 15000));
          } catch {}
        }
      } catch (err) {
        console.warn(`[imap] Connection error for ${auth.user}@${host}:`, err && err.message ? err.message : err);
      }

      if (stopped) break;

      // Reconnect with backoff
      console.log(`[imap] Reconnecting to ${auth.user}@${host} in ${Math.round(backoff/1000)}s...`);
      await new Promise(res => setTimeout(res, backoff));
      backoff = Math.min(maxBackoff, backoff * 2);
    }
  }

  connectAndIdle();

  return () => {
    stopped = true;
    if (client && !client.closed) {
      try { client.logout(); } catch {}
    }
  };
}

async function main() {
  try {
    const mailboxes = await loadActiveMailboxes();
    if (!mailboxes.length) {
      console.warn('[imap] No active mailboxes found in smtp_settings');
    } else {
      console.log(`[imap] Starting listeners for ${mailboxes.length} mailbox(es)`);
      for (const mb of mailboxes) {
        startMailboxListener(mb);
      }
    }
  } catch (e) {
    console.error('[imap] Fatal error:', e.message);
    process.exit(1);
  }
}

// Start when invoked via `npm run imap`
main();
