// Pure utility helpers extracted from SubmissionIntermediate.tsx
// No React or side-effect imports here to keep this file stateless and reusable.

// Utility: parse various amount representations into a number
export const parseAmount = (v: any): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '')
    .replace(/[\,\s]/g, '')
    .replace(/[^0-9.+-]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

// Utility: strict currency formatter with 2 decimals
export const fmtCurrency2 = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Utility: turn a category name into a safe DOM id
export const slugify = (s: string) => String(s || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '');

// Utility: detect the special category "BUSINESS NAME AND OWNER" (also handle common misspelling "OWDER")
export const isBusinessNameAndOwner = (name: string): boolean => {
  const norm = String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return (
    norm === 'business name and owner' ||
    norm === 'business name and owder' ||
    (norm.includes('business name') && norm.includes('owner'))
  );
};

// Utility: format YYYY-MM-DD into Month DD, YYYY
export const formatDateHuman = (value: any): string => {
  const raw = String(value || '').trim();
  // If already human text, return as-is
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw || '—';
  const [_, y, mo, d] = m as unknown as [string, string, string, string];
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  try {
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: '2-digit' });
  } catch {
    return raw;
  }
};

// Simple format helpers for the financials
export const toNumber = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
export const fmtCurrency = (v: unknown): string => {
  const n = toNumber(v);
  return typeof n === 'number' ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : '—';
};
export const fmtNumber = (v: unknown): string => {
  const n = toNumber(v);
  return typeof n === 'number' ? n.toLocaleString() : '—';
};
export const fmtMonths = (v: unknown): string => {
  const n = toNumber(v);
  return typeof n === 'number' ? `${n} mo${n === 1 ? '' : 's'}` : '—';
};
export const fmtPercent = (v: unknown): string => {
  const n = toNumber(v);
  if (typeof n !== 'number') return '—';
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
};

// Generate a date key based on today's date (YYYY-MM-DD) without pre-filling future months
export const getCurrentDateKey = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// Generate a unique key so multiple files uploaded on the same day do not overwrite each other
export const getUniqueDateKey = () => {
  const base = getCurrentDateKey();
  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2, 6);
  return `${base}-${ts}-${rnd}`;
};

// Simple fetch wrapper without automatic timeout or AbortController
// Keeps the same signature so callers passing `timeoutMs` won't break; it is ignored.
export type WithTimeout = RequestInit & { timeoutMs?: number };
export const fetchWithTimeout = async (input: RequestInfo | URL, init: WithTimeout = {}) => {
  const restInit: RequestInit = { ...init };
  if ('timeoutMs' in restInit) {
    delete (restInit as WithTimeout).timeoutMs;
  }
  return fetch(input, restInit);
};
