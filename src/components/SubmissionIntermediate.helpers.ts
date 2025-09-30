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

// Utility: detect if a category is "Funder List" which should also be excluded from calculations
export const isFunderList = (name: string): boolean => {
  const norm = String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return norm === 'funder list';
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

// Format any date string into a full readable format like "August 11, 2025"
export const formatFullDate = (value: any): string => {
  if (!value) return '—';
  const raw = String(value).trim();
  
  // Try different date formats
  try {
    // YYYY-MM or YYYY-MM-DD format
    if (/^\d{4}-\d{2}(-\d{2})?$/.test(raw)) {
      const parts = raw.split('-');
      const year = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1; // JS months are 0-indexed
      const day = parts.length > 2 ? parseInt(parts[2]) : 15; // Default to middle of month if no day
      
      const date = new Date(year, month, day);
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    }
    
    // Month name format (e.g., "July" or "July 2025")
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const lowercaseRaw = raw.toLowerCase();
    
    for (let i = 0; i < monthNames.length; i++) {
      if (lowercaseRaw.includes(monthNames[i])) {
        // Extract year if present, otherwise use current year
        const yearMatch = raw.match(/\d{4}/);
        const year = yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear();
        
        // Extract day if present, otherwise use 15th (middle of month)
        const dayMatch = raw.match(/\b(\d{1,2})\b/);
        const day = dayMatch ? parseInt(dayMatch[1]) : 15;
        
        const date = new Date(year, i, day);
        return date.toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
      }
    }
    
    // If all else fails, try to parse as a date directly
    const date = new Date(raw);
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    }
  } catch {}
  
  // Return original if we couldn't parse it
  return raw;
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
