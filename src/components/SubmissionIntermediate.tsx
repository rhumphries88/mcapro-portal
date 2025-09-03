import React, { useEffect, useRef, useState } from 'react';
import { Building2, Upload, FileText, CheckCircle, RefreshCw, Trash2, RotateCcw } from 'lucide-react';
import { getApplicationDocuments, deleteApplicationDocument, type ApplicationDocument } from '../lib/supabase';

// Webhook to receive raw bank statement uploads (moved from extractor)
const NEW_DEAL_WEBHOOK_URL = '/webhook/newDeal';
// Webhook to update applications when user proceeds to lender matches
const UPDATING_APPLICATIONS_WEBHOOK_URL = '/webhook/updatingApplications';
// Absolute webhook to store document file and metadata
const DOCUMENT_FILE_WEBHOOK_URL = 'https://primary-production-c8d0.up.railway.app/webhook/documentFile';

// Lightweight details page shown after application submit and before lender matches
// Styled to match project cards/buttons and the reference layout (two-column inputs + blue primary button)

type Props = {
  onContinue: (details: Record<string, string | boolean>) => void;
  onBack?: () => void;
  // Optional prefill hooks if we want to seed values from application
  initial?: Partial<Record<string, string | boolean>>;
  loading?: boolean;
};

const SubmissionIntermediate: React.FC<Props> = ({ onContinue, onBack, initial, loading }) => {
  const [details, setDetails] = useState<Record<string, string | boolean>>({
    id: (initial?.id as string) || '',
    applicationId: (initial?.applicationId as string) || '',
    dealName: (initial?.dealName as string) || '',
    entityType: (initial?.entityType as string) || '',
    industry: (initial?.industry as string) || '',
    state: (initial?.state as string) || '',
    // Financial details should start empty after submit
    creditScore: '',
    timeInBiz: '',
    grossAnnualRevenue: '',
    avgMonthlyRevenue: '',
    averageMonthlyDeposits: '',
    existingDebt: '',
    requestedAmount: '',
    avgDailyBalance: '',
    avgMonthlyDepositCount: '',
    nsfCount: '',
    negativeDays: '',
    currentPositionCount: '',
    holdback: '',
    hasBankruptcies: Boolean(initial?.hasBankruptcies) || false,
    hasOpenJudgments: Boolean(initial?.hasOpenJudgments) || false,
  });

  // Keep form state in sync when `initial` updates (e.g., after webhook response arrives)
  useEffect(() => {
    if (!initial) return;
    console.log('[SubmissionIntermediate] received initial:', initial);
    setDetails(prev => ({
      ...prev,
      id: (initial.id as string) ?? (prev.id as string) ?? '',
      applicationId: (initial.applicationId as string) ?? (prev.applicationId as string) ?? '',
      dealName: (initial.dealName as string) ?? prev.dealName ?? '',
      entityType: (initial.entityType as string) ?? prev.entityType ?? '',
      industry: (initial.industry as string) ?? prev.industry ?? '',
      state: (initial.state as string) ?? prev.state ?? '',
      // Keep financial fields empty upon receiving initial unless user already typed
      creditScore: (prev.creditScore as string) || '',
      timeInBiz: (prev.timeInBiz as string) || '',
      grossAnnualRevenue: (prev.grossAnnualRevenue as string) || '',
      avgMonthlyRevenue: (prev.avgMonthlyRevenue as string) || '',
      averageMonthlyDeposits: (prev.averageMonthlyDeposits as string) || '',
      existingDebt: (prev.existingDebt as string) || '',
      requestedAmount: (prev.requestedAmount as string) || '',
      avgDailyBalance: (prev.avgDailyBalance as string) || '',
      avgMonthlyDepositCount: (prev.avgMonthlyDepositCount as string) || '',
      nsfCount: (prev.nsfCount as string) || '',
      negativeDays: (prev.negativeDays as string) || '',
      currentPositionCount: (prev.currentPositionCount as string) || '',
      holdback: (prev.holdback as string) || '',
      hasBankruptcies: typeof initial.hasBankruptcies === 'boolean' ? initial.hasBankruptcies : Boolean(prev.hasBankruptcies),
      hasOpenJudgments: typeof initial.hasOpenJudgments === 'boolean' ? initial.hasOpenJudgments : Boolean(prev.hasOpenJudgments),
    }));
    // Only mark basic business fields from `initial` as auto-populated.
    // Financial fields must ONLY highlight after a bank statement upload triggers the newDeal webhook.
    const highlightable = [
      'dealName','industry','entityType','state'
    ];
    const provided: string[] = [];
    highlightable.forEach(k => {
      const v = (initial as Record<string, unknown>)[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') provided.push(k);
    });
    if (provided.length) {
      setAutoPopulatedKeys(prev => {
        const next = new Set<string>([...prev, ...provided]);
        setAutoPopulatedCount(next.size);
        return next;
      });
    }
    setTimeout(() => {
      // Post-merge snapshot for verification
      console.log('[SubmissionIntermediate] details after merge snapshot:', {
        entityType: (initial.entityType as string) ?? '',
        state: (initial.state as string) ?? '',
        grossAnnualRevenue: (initial.grossAnnualRevenue as string) ?? '',
        avgDailyBalance: (initial.avgDailyBalance as string) ?? '',
        averageMonthlyDeposits: (initial.averageMonthlyDeposits as string) ?? '',
        existingDebt: (initial.existingDebt as string) ?? '',
        requestedAmount: (initial.requestedAmount as string) ?? '',
        avgMonthlyDepositCount: (initial.avgMonthlyDepositCount as string) ?? '',
        nsfCount: (initial.nsfCount as string) ?? '',
        negativeDays: (initial.negativeDays as string) ?? '',
        currentPositionCount: (initial.currentPositionCount as string) ?? '',
        holdback: (initial.holdback as string) ?? '',
      });
    }, 0);
  }, [initial]);

  // Fetch already-saved documents for this application (if any)
  const refetchDbDocs = async (appId: string) => {
    try {
      setDbDocsLoading(true);
      const docs = await getApplicationDocuments(appId);
      setDbDocs(docs || []);
    } finally {
      setDbDocsLoading(false);
    }
  };

  useEffect(() => {
    const appId = (details.id as string) || (details.applicationId as string) || (initial?.id as string) || (initial?.applicationId as string) || '';
    if (!appId) return;
    let cancelled = false;
    const run = async () => {
      try {
        setDbDocsLoading(true);
        const docs = await getApplicationDocuments(appId);
        if (!cancelled) setDbDocs(docs || []);
      } catch (e) {
        console.warn('Failed to load application documents:', e);
      } finally {
        if (!cancelled) setDbDocsLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [details.id, details.applicationId, initial?.id, initial?.applicationId]);

  const set = (key: string, value: string | boolean) => setDetails(prev => ({ ...prev, [key]: value }));

  const [submitting, setSubmitting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  
  // Daily statements tracking (changed from monthly to daily)
  const [dailyStatements, setDailyStatements] = useState<Map<string, { file: File; status: 'uploading' | 'completed' | 'error'; fileUrl?: string }>>(new Map());
  const [autoPopulatedKeys, setAutoPopulatedKeys] = useState<Set<string>>(new Set());
  const [autoPopulatedCount, setAutoPopulatedCount] = useState(0);
  // Persisted documents fetched from DB
  const [dbDocs, setDbDocs] = useState<ApplicationDocument[]>([]);
  const [dbDocsLoading, setDbDocsLoading] = useState(false);
  // Track which item is being replaced (db/local)
  const [replaceTarget, setReplaceTarget] = useState<null | { source: 'db' | 'local'; dateKey: string; docId?: string }>(null);

  // Create a ref for the replace file input
  const replaceFileInputRef = useRef<HTMLInputElement>(null);

  // Helper to flatten nested objects into dot.notation keys for easy lookup
  const flattenObject = (obj: unknown, prefix = ''): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (!obj || typeof obj !== 'object') return out;
    Object.entries(obj as Record<string, unknown>).forEach(([k, v]) => {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.assign(out, flattenObject(v, key));
      } else {
        out[key] = v as unknown;
      }
    });
    return out;
  };

  // Simple fetch wrapper with timeout to avoid indefinite hangs on slow webhooks
  const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit & { timeoutMs?: number } = {}) => {
    const { timeoutMs = 8000, ...rest } = init;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...rest, signal: controller.signal });
    } finally {
      clearTimeout(id);
    }
  };

  // (base64 conversion helper removed; no longer needed since we send only file_url)

  // Map extracted webhook fields into local `details` state.
  // Supports multiple aliases coming from backend.
  // opts.overwrite: replace current values even if not empty
  // opts.markProvidedEvenIfNoChange: still flag as auto-populated even when value is identical
  const populateDetailsFromWebhook = (payload: unknown, opts: { overwrite?: boolean; markProvidedEvenIfNoChange?: boolean } = {}) => {
    if (!payload || typeof payload !== 'object') return;
    const data = payload as Record<string, unknown>;
    console.log('[populateDetailsFromWebhook] raw payload keys:', Object.keys(data));
    // Flatten and create a case-insensitive index of keys
    const flat = flattenObject(data);
    console.log('[populateDetailsFromWebhook] flattened keys:', Object.keys(flat));
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const ciEntries = Object.entries(flat).map(([k, v]) => [k.toLowerCase(), v] as const);
    const normEntries = Object.entries(flat).map(([k, v]) => [normalize(k), v] as const);
    const aliases: Record<string, string[]> = {
      // Business info
      dealName: ['dealName', 'business_name', 'company_name', 'legal_business_name', 'merchant_name', 'dba', 'doing_business_as'],
      industry: ['industry', 'industry_type', 'business_industry', 'naics_industry', 'naics_description'],
      entityType: ['entityType', 'business_type', 'entity', 'business_entity', 'entity_type'],
      creditScore: ['creditScore', 'credit_score', 'credit', 'fico'],
      timeInBiz: ['timeInBiz', 'time_in_biz', 'tib_months', 'time_in_business_months'],
      avgMonthlyRevenue: ['avgMonthlyRevenue', 'average_monthly_revenue', 'monthly_revenue_avg'],
      averageMonthlyDeposits: ['averageMonthlyDeposits', 'avgMonthlyDeposits', 'average_monthly_deposits'],
      existingDebt: ['existingDebt', 'existing_business_debt', 'current_debt'],
      requestedAmount: ['requestedAmount', 'requested_amount', 'request_amount'],
      avgDailyBalance: ['avgDailyBalance', 'average_daily_balance'],
      avgMonthlyDepositCount: ['avgMonthlyDepositCount', 'average_monthly_deposit_count'],
      nsfCount: ['nsfCount', 'nsf_count'],
      negativeDays: ['negativeDays', 'negative_days'],
      currentPositionCount: ['currentPositionCount', 'current_position_count'],
      holdback: ['holdback', 'hold_back', 'holdback_percent'],
      grossAnnualRevenue: ['grossAnnualRevenue', 'gross_annual_revenue', 'annual_revenue'],
      state: ['state', 'State'],
    };

    const next: Record<string, string | boolean> = {};

    const getFirst = (keys: string[]) => {
      // try exact keys
      const direct = keys.map(k => data[k]).find(v => v !== undefined && v !== null && String(v).trim() !== '');
      if (direct !== undefined) return direct;
      // try case-insensitive across flattened keys, allowing occurrences like result.financial.credit_score, etc.
      for (const alias of keys) {
        const needle = alias.toLowerCase();
        const found = ciEntries.find(([k]) => k.endsWith(needle) || k === needle || k.includes(`.${needle}`));
        if (found && found[1] !== undefined && found[1] !== null && String(found[1]).trim() !== '') return found[1];
        // normalized comparison to match human-readable labels like "Avg Monthly Revenue"
        const nNeedle = normalize(alias);
        const nFound = normEntries.find(([k]) => k === nNeedle || k.endsWith(nNeedle) || k.includes(nNeedle));
        if (nFound && nFound[1] !== undefined && nFound[1] !== null && String(nFound[1]).trim() !== '') return nFound[1];
      }
      return undefined;
    };

    const numericTargets = new Set([
      'creditScore',
      'timeInBiz',
      'avgMonthlyRevenue',
      'averageMonthlyDeposits',
      'existingDebt',
      'requestedAmount',
      'avgDailyBalance',
      'avgMonthlyDepositCount',
      'nsfCount',
      'negativeDays',
      'currentPositionCount',
      'holdback',
      'grossAnnualRevenue',
    ]);

    const sanitizeNumeric = (val: unknown): string => {
      const s = String(val ?? '').trim();
      if (!s) return '';
      // remove commas and any non [0-9.-]
      const cleaned = s.replace(/,/g, '').replace(/[^0-9.-]/g, '');
      return cleaned;
    };

    (Object.keys(aliases) as Array<keyof typeof aliases>).forEach((target) => {
      const value = getFirst(aliases[target]);
      if (value !== undefined) {
        next[target] = numericTargets.has(target as string) ? sanitizeNumeric(value) : String(value);
        console.log(`[populateDetailsFromWebhook] mapped ${target} <-`, value);
      }
    });

    // Fill behavior: overwrite or only-empty based on opts
    // We will track keys provided by webhook to ensure highlighting regardless of whether value changed
    const providedKeys = new Set<string>();
    // If caller asks to mark provided even if unchanged, seed with all mapped keys
    if (opts.markProvidedEvenIfNoChange) {
      // Add any mapped keys
      Object.keys(next).forEach(k => providedKeys.add(k));
      // Also add all financial targets so UI highlights them even if webhook omitted/returned empty
      const financialTargets = [
        'creditScore',
        'timeInBiz',
        'avgMonthlyRevenue',
        'averageMonthlyDeposits',
        'existingDebt',
        'requestedAmount',
        'avgDailyBalance',
        'avgMonthlyDepositCount',
        'nsfCount',
        'negativeDays',
        'currentPositionCount',
        'holdback',
        'grossAnnualRevenue',
      ];
      financialTargets.forEach(k => providedKeys.add(k));
      console.log('[populateDetailsFromWebhook] prefilling providedKeys due to markProvidedEvenIfNoChange (financial targets included):', Array.from(providedKeys));
    }
    setDetails(prev => {
      const merged: typeof prev = { ...prev };
      Object.entries(next).forEach(([k, v]) => {
        const curr = (merged[k] as string) ?? '';
        if (opts.overwrite) {
          merged[k] = v as string;
          // mark as provided (for highlight)
          providedKeys.add(k);
        } else {
          if (!curr || String(curr).trim() === '') {
            merged[k] = v as string;
            providedKeys.add(k);
          }
        }
      });
      console.log('[populateDetailsFromWebhook] merged details snapshot:', merged);
      return merged;
    });
    if (providedKeys.size) {
      console.log('[populateDetailsFromWebhook] providedKeys for highlight:', Array.from(providedKeys));
      setAutoPopulatedKeys(prev => {
        const nextSet = new Set<string>([...prev, ...providedKeys]);
        setAutoPopulatedCount(nextSet.size);
        console.log('[populateDetailsFromWebhook] autoPopulatedKeys now:', Array.from(nextSet));
        return nextSet;
      });
    }
  };

  // removed legacy uploadFilesToWebhook (replaced by month-aware handlers)

  // --- Month-aware upload (keeps UI intact) ---------------------------------
  // removed detectMonthFromFilename (no longer needed for daily uploads)

  // removed unused helpers for monthly logic (detectMonthFromFilename no longer needed)

  // Find the next available month key (YYYY-MM-01) ensuring only one file per month
  const getNextAvailableMonthDateKey = () => {
    const existingKeys = Array.from(dailyStatements.keys());
    const monthTaken = (y: number, mZeroBased: number) => {
      const prefix = `${y}-${String(mZeroBased + 1).padStart(2, '0')}`;
      return existingKeys.some(k => k.startsWith(prefix));
    };
    const d = new Date();
    d.setDate(1);
    while (monthTaken(d.getFullYear(), d.getMonth())) {
      d.setMonth(d.getMonth() + 1);
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  };

  // Handle upload (auto-assigns to the next available month)
  const handleDailyUpload = async (file: File | undefined) => {
    if (!file) return;
    
    // Validate file
    if (file.type !== 'application/pdf') {
      alert('Please upload PDF files only');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be under 10MB');
      return;
    }

    // Assign to the next available month (one file per month rule)
    const targetMonthKey = getNextAvailableMonthDateKey();
    await performUpload(file, targetMonthKey);
  };

  // Actual upload logic separated for reuse
  const performUpload = async (file: File, dateKey: string) => {
    // Set uploading state
    setDailyStatements(prev => new Map(prev.set(dateKey, { file, status: 'uploading' })));

    try {
      // No need to prepare a file URL for the document webhook anymore
      // Upload with date tag to the internal newDeal webhook (non-blocking for overall flow)
      try {
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('statementDate', dateKey);

        const resp = await fetchWithTimeout(NEW_DEAL_WEBHOOK_URL, {
          method: 'POST',
          body: form,
          timeoutMs: 20000, // allow a bit more time for processing
        });

        if (resp.ok) {
          const contentType = resp.headers.get('content-type') || '';
          try {
            let parsed: unknown = undefined;
            if (contentType.includes('application/json')) {
              parsed = await resp.json();
            } else {
              const text = await resp.text();
              try { parsed = JSON.parse(text); } catch { parsed = undefined; }
            }
            if (parsed) {
              console.log('[newDeal webhook - daily] Parsed response:', dateKey, parsed);
              populateDetailsFromWebhook(parsed, { overwrite: true, markProvidedEvenIfNoChange: true });
            }
          } catch (e) {
            console.warn('Unable to read daily webhook response:', e);
          }
        } else {
          console.warn(`newDeal webhook responded ${resp.status} ${resp.statusText}; continuing upload flow`);
        }
      } catch (err) {
        console.warn('newDeal webhook timed out or failed; continuing upload flow:', err);
      }

      // Send the document to DOCUMENT_FILE_WEBHOOK_URL with required metadata (authoritative record)
      try {
        // Prefer the Applications table primary key (application record id)
        const appId = (details.id as string) || (initial?.id as string) || (details.applicationId as string) || (initial?.applicationId as string) || '';
        const payload = {
          application_id: appId,
          file_name: file.name,
          file_size: file.size,
          file_type: file.type || 'application/pdf',
          statement_date: dateKey,
        } as const;

        const resp2 = await fetchWithTimeout(DOCUMENT_FILE_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          timeoutMs: 30000,
        });

        let fileUrl: string | undefined = undefined;
        const ct2 = resp2.headers.get('content-type') || '';
        if (ct2.includes('application/json')) {
          const data2 = await resp2.json().catch(() => undefined as unknown);
          if (data2 && typeof data2 === 'object') {
            const u = (data2 as Record<string, unknown>)['file_url'];
            if (typeof u === 'string' && u) fileUrl = u;
          }
        } else {
          // Try parse text to JSON
          const t2 = await resp2.text();
          try {
            const data2 = JSON.parse(t2);
            const u = (data2 as Record<string, unknown>)['file_url'];
            if (typeof u === 'string' && u) fileUrl = u;
          } catch {
            // ignore
          }
        }

        // Use file URL only if the document webhook returns one for UI linking
        setDailyStatements(prev => new Map(prev.set(dateKey, { file, status: 'completed', fileUrl })));
      } catch (e) {
        console.warn('documentFile webhook call failed; marking completed without URL:', e);
        setDailyStatements(prev => new Map(prev.set(dateKey, { file, status: 'completed' })));
      }
    } catch (error) {
      console.error('Daily upload failed:', error);
      setDailyStatements(prev => new Map(prev.set(dateKey, { file, status: 'error' })));
    }
  };

  // Handle bulk upload (all files assigned to current date)
  const handleBulkUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    const fileArray = Array.from(files);
    for (const file of fileArray) {
      await handleDailyUpload(file);
    }
  };

  // Handle file selection from replace dialog
  const handleReplaceFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // If we have a replacement target, keep its dateKey and replace in-place
      const appId = (details.id as string) || (initial?.id as string) || (details.applicationId as string) || (initial?.applicationId as string) || '';
      const dateKey = replaceTarget?.dateKey || getNextAvailableMonthDateKey();
      await performUpload(file, dateKey);
      // If replacing a DB document, remove the old row then refresh DB list
      if (replaceTarget?.source === 'db' && replaceTarget.docId) {
        try {
          await deleteApplicationDocument(replaceTarget.docId);
        } catch (err) {
          console.warn('Failed to delete old DB document during replace:', err);
        }
        if (appId) await refetchDbDocs(appId);
      }
    }
    // Reset input
    e.target.value = '';
    setReplaceTarget(null);
  };

  // Handle retry for failed uploads
  const handleRetryUpload = async (dateKey: string) => {
    const statement = dailyStatements.get(dateKey);
    if (statement) {
      await handleDailyUpload(statement.file);
    }
  };

  // Drag and drop handlers for the main upload zone
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    handleBulkUpload(e.dataTransfer.files);
  };

  // Helpers to build a unified list (DB docs + in-session uploads) rendered with the same card UI
  const formatDisplayDate = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  type UICardItem = {
    key: string;
    dateKey: string; // used as stable key where possible
    dateDisplay: string;
    status: 'uploading' | 'completed' | 'error' | 'uploaded';
    file: { name: string; size: number };
    fileUrl?: string;
    sortDate: Date;
    source: 'db' | 'local';
    docId?: string; // present for DB items
  };

  const getUnifiedDocumentCards = (): UICardItem[] => {
    const today = new Date();
    const tYear = today.getFullYear();
    const tMonth = today.getMonth();
    const tDay = today.getDate();

    // Local (in-session) uploads
    const localItems: UICardItem[] = Array.from(dailyStatements.entries()).map(([dateKey, data]) => {
      const [year, month, day] = dateKey.split('-').map(Number);
      const baseDate = new Date(year, month - 1, day);
      const isCurrentMonth = (year === tYear) && ((month - 1) === tMonth);
      const displayDate = new Date(year, month - 1, isCurrentMonth ? tDay : day);
      return {
        key: `local:${dateKey}`,
        dateKey,
        dateDisplay: displayDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        status: data.status,
        file: { name: data.file.name, size: data.file.size },
        fileUrl: data.fileUrl,
        sortDate: baseDate,
        source: 'local',
      };
    });

    // DB documents (always treated as completed)
    const dbItems: UICardItem[] = (dbDocs || []).map((doc) => {
      const sortBase = doc.statement_date ? new Date(doc.statement_date) : new Date(doc.created_at);
      const dateDisplay = formatDisplayDate(doc.statement_date || doc.created_at) || '';
      const dk = (doc.statement_date || doc.created_at || '').slice(0, 10) || doc.id;
      return {
        key: `db:${doc.id}`,
        dateKey: dk,
        dateDisplay,
        status: 'completed',
        file: { name: doc.file_name, size: typeof doc.file_size === 'number' ? doc.file_size : 0 },
        fileUrl: doc.file_url,
        sortDate: sortBase,
        source: 'db',
        docId: doc.id,
      };
    });

    return [...dbItems, ...localItems].sort((a, b) => b.sortDate.getTime() - a.sortDate.getTime());
  };

  // Remove a statement
  const handleRemoveStatement = (dateKey: string) => {
    setDailyStatements(prev => {
      const next = new Map(prev);
      next.delete(dateKey);
      return next;
    });
  };

  const handleDeleteClick = async (item: UICardItem) => {
    if (item.source === 'db' && item.docId) {
      try {
        await deleteApplicationDocument(item.docId);
      } catch (e) {
        console.warn('Failed to delete DB document:', e);
      }
      const appId = (details.id as string) || (initial?.id as string) || (details.applicationId as string) || (initial?.applicationId as string) || '';
      if (appId) await refetchDbDocs(appId);
      return;
    }
    // local
    handleRemoveStatement(item.dateKey);
  };

  const handleReplaceClick = (item: UICardItem) => {
    if (item.source === 'db') {
      setReplaceTarget({ source: 'db', dateKey: item.dateKey, docId: item.docId });
    } else {
      setReplaceTarget({ source: 'local', dateKey: item.dateKey });
    }
    replaceFileInputRef.current?.click();
  };

  const handleContinue = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        // ensure IDs are always present at top-level
        id: (details.id as string) || ((initial?.id as string) || ''),
        applicationId: (details.applicationId as string) || ((initial?.applicationId as string) || (details.id as string) || (initial?.id as string) || ''),
        // include the rest of the details
        ...details,
      };
      await fetchWithTimeout(UPDATING_APPLICATIONS_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        timeoutMs: 8000,
      });
    } catch (e) {
      console.error('Failed to notify updatingApplications webhook:', e);
      // proceed regardless to not block user flow
    } finally {
      // Trigger parent flow first so parent can flip loading immediately
      onContinue(details);
      // Keep local loading true until after handing off control
      setSubmitting(false);
    }
  };

  const Input = ({
    label,
    name,
    type = 'text',
    inputMode,
  }: { label: string; name: string; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'] }) => {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const mouseInsideRef = useRef(false);
    const typingRef = useRef(false);
    const typingTimerRef = useRef<number | null>(null);

    const startTyping = () => {
      typingRef.current = true;
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = window.setTimeout(() => {
        typingRef.current = false; // finished typing
        // Rule #2: if mouse is out when typing finished, blur
        if (!mouseInsideRef.current) inputRef.current?.blur();
      }, 600); // debounce window to consider "finished typing"
    };

    const handleMouseEnter = () => {
      mouseInsideRef.current = true;
      // Rule #1: ensure focus when mouse is inside while typing
      if (inputRef.current) inputRef.current.focus();
    };

    const handleMouseLeave = () => {
      mouseInsideRef.current = false;
      // Rule #2: if not typing anymore, blur immediately
      if (!typingRef.current) inputRef.current?.blur();
    };

    return (
      <div className="relative">
        <label className="block text-sm font-bold text-gray-800 mb-2" htmlFor={name}>{label}</label>
        <div className="relative">
          <input
            ref={inputRef}
            id={name}
            name={name}
            type={type}
            inputMode={inputMode}
            autoComplete="off"
            value={(details[name] as string) || ''}
            onFocus={() => { /* keep focus while inside */ }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onKeyDown={startTyping}
            onInput={startTyping}
            onChange={(e) => {
              startTyping();
              const numericNames = new Set([
                'creditScore',
                'timeInBiz',
                'avgMonthlyRevenue',
                'averageMonthlyDeposits',
                'existingDebt',
                'requestedAmount',
                'avgDailyBalance',
                'avgMonthlyDepositCount',
                'nsfCount',
                'negativeDays',
                'currentPositionCount',
                'holdback',
                'grossAnnualRevenue',
              ]);
              let v = e.target.value;
              if (numericNames.has(name)) {
                // Allow digits, one optional leading '-', a single '.', and for holdback an optional '%'
                // 1) If holdback, temporarily strip % and remember it
                let hadPercent = false;
                if (name === 'holdback') {
                  if (v.includes('%')) hadPercent = true;
                  v = v.replace(/%/g, '');
                }
                // 2) Remove other invalid chars
                v = v.replace(/[^0-9.-]/g, '');
                // 2) Keep '-' only at the start
                v = (v[0] === '-' ? '-' : '') + v.replace(/-/g, '');
                // 3) Allow only one '.'
                const firstDot = v.indexOf('.');
                if (firstDot !== -1) {
                  const before = v.slice(0, firstDot + 1);
                  const after = v.slice(firstDot + 1).replace(/\./g, '');
                  v = before + after;
                }
                // Special handling for percentage: clamp 0-100
                if (name === 'holdback') {
                  const n = Number(v);
                  if (!Number.isNaN(n)) {
                    if (n < 0) v = '0';
                    else if (n > 100) v = '100';
                  }
                  // Re-append % for display if user typed it
                  if (hadPercent && v !== '') v = `${v}%`;
                }
              }
              // remove auto-populated highlight once the user edits
              if (autoPopulatedKeys.has(name)) {
                setAutoPopulatedKeys(prev => {
                  const next = new Set(prev);
                  next.delete(name);
                  setAutoPopulatedCount(next.size);
                  return next;
                });
              }
              set(name, v);
            }}
            className={`w-full rounded-xl border-2 px-4 py-3 text-gray-900 font-medium transition-all duration-200 ${
              autoPopulatedKeys.has(name) 
                ? 'border-emerald-300 bg-gradient-to-r from-emerald-50 to-green-50 ring-2 ring-emerald-200/50 shadow-sm focus:border-emerald-400 focus:ring-emerald-300/50' 
                : 'border-gray-200 bg-white hover:border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-sm hover:shadow-sm'
            } focus:outline-none`}
          />
          {/* Removed floating AUTO badge per request */}
        </div>
        {autoPopulatedKeys.has(name) && (
          <div className="mt-2 flex items-center gap-2 text-emerald-700 text-xs font-medium">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
            <span>Extracted from documents</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-8 py-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">Merchant Cash Advance Application</h2>
          <p className="text-gray-600 mt-1">Please fill out all required information to get matched with qualified lenders</p>
        </div>

        <div className="p-8">
          {loading || submitting ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <svg className="animate-spin h-8 w-8 text-blue-600 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
            </svg>
            <p className="text-gray-700 font-medium">Analyzing your application and preparing lender matches…</p>
            <p className="text-gray-500 text-sm mt-1">This usually takes just a few seconds.</p>
          </div>
          ) : (
            <>
            {autoPopulatedCount > 0 && (
              <div className="mb-8 relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-green-50 to-teal-50 p-6 shadow-lg">
                <div className="absolute inset-0 bg-gradient-to-r from-emerald-100/20 to-teal-100/20 opacity-50"></div>
                <div className="relative flex items-start gap-4">
                  <div className="flex-shrink-0 p-3 bg-gradient-to-br from-emerald-100 to-green-100 rounded-2xl shadow-sm border border-emerald-200">
                    <CheckCircle className="w-6 h-6 text-emerald-700" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-lg font-bold text-emerald-900 mb-2">Data Extraction Complete</h4>
                    <p className="text-emerald-800 font-medium mb-2">
                      {autoPopulatedCount} fields automatically populated from your documents
                    </p>
                    <p className="text-sm text-emerald-700 leading-relaxed">
                      Review the highlighted fields below. All information can be edited if needed.
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    <span className="inline-flex items-center px-4 py-2 rounded-full text-sm font-bold bg-gradient-to-r from-emerald-100 to-green-100 text-emerald-800 border border-emerald-200 shadow-sm">
                      {autoPopulatedCount} Fields
                    </span>
                  </div>
                </div>
              </div>
            )}
              {/* Business Information Section */}
              <div className="mb-8">
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-xl shadow-sm border border-blue-200">
                    <Building2 className="w-5 h-5 text-blue-700" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900">Business Information</h3>
                </div>
                <p className="text-sm text-gray-600 ml-12">Basic details about your business</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input label="Deal Name" name="dealName" />
                <Input label="Industry" name="industry" />
                <Input label="Entity Type" name="entityType" />
                <Input label="State" name="state" />
              </div>
            </div>

              {/* Financial Details Section */}
              <div className="mb-8">
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-gradient-to-br from-purple-100 to-violet-100 rounded-xl shadow-sm border border-purple-200">
                    <Building2 className="w-5 h-5 text-purple-700" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900">Financial Details</h3>
                </div>
                <p className="text-sm text-gray-600 ml-12">Financial metrics and performance data</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input label="Credit Score" name="creditScore" type="text" inputMode="decimal" />
                <Input label="Time in Biz (months)" name="timeInBiz" type="text" inputMode="decimal" />
                <Input label="Avg Monthly Revenue" name="avgMonthlyRevenue" type="text" inputMode="decimal" />
                <Input label="Avg Monthly Deposits" name="averageMonthlyDeposits" type="text" inputMode="decimal" />
                <Input label="Existing Business Debt" name="existingDebt" type="text" inputMode="decimal" />
                <Input label="Requested Amount" name="requestedAmount" type="text" inputMode="decimal" />
                <Input label="Gross Annual Revenue" name="grossAnnualRevenue" type="text" inputMode="decimal" />
                <Input label="Avg Daily Balance" name="avgDailyBalance" type="text" inputMode="decimal" />
                <Input label="Avg Monthly Deposit Count" name="avgMonthlyDepositCount" type="text" inputMode="decimal" />
                <Input label="NSF Count" name="nsfCount" type="text" inputMode="decimal" />
                <Input label="Negative Days" name="negativeDays" type="text" inputMode="decimal" />
                <Input label="Current Position Count" name="currentPositionCount" type="text" inputMode="decimal" />
                <Input label="Holdback" name="holdback" type="text" inputMode="decimal" />
              </div>

                {/* Bank Statement Upload - List View */}
                <div className="mt-8">
                  <div className="mb-8">
                    <h3 className="text-xl font-semibold text-gray-900 mb-2 flex items-center gap-3">
                      <div className="p-2 bg-blue-100 rounded-lg">
                        <Upload className="w-5 h-5 text-blue-600" />
                      </div>
                      Bank Statement Documents
                    </h3>
                    <p className="text-gray-600 text-sm">Upload and manage your monthly bank statements for processing</p>
                  </div>

                  {/* Uploaded Files List */}
                  {(getUnifiedDocumentCards().length > 0) && (
                    <div className="space-y-4 mb-8">
                      <div className="flex items-center justify-end mb-6">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-blue-50 to-blue-100 text-blue-700 border border-blue-200">
                            <FileText className="w-4 h-4 mr-2" />
                            {getUnifiedDocumentCards().length} {getUnifiedDocumentCards().length === 1 ? 'Document' : 'Documents'}
                          </span>
                          {dbDocsLoading && (
                            <span className="text-xs text-gray-500">Syncing…</span>
                          )}
                        </div>
                      </div>
                      {getUnifiedDocumentCards().map((item) => {
                        const isUploading = item.status === 'uploading';
                        const isCompleted = item.status === 'completed';
                        const hasError = item.status === 'error';

                        return (
                          <div
                            key={item.key}
                            className="group bg-gradient-to-r from-white to-gray-50/50 border border-gray-200 rounded-2xl p-6 shadow-sm hover:shadow-xl hover:border-blue-200 hover:from-blue-50/30 hover:to-white transition-all duration-300"
                          >
                            <div className="flex items-center justify-between">
                              {/* File Info */}
                              <div className="flex items-center gap-4 min-w-0 flex-1">
                                <div className={`flex items-center justify-center w-14 h-14 rounded-2xl shadow-sm ${
                                  isCompleted ? 'bg-gradient-to-br from-green-100 to-green-200 border border-green-200' : isUploading ? 'bg-gradient-to-br from-blue-100 to-blue-200 border border-blue-200' : hasError ? 'bg-gradient-to-br from-red-100 to-red-200 border border-red-200' : 'bg-gradient-to-br from-gray-100 to-gray-200 border border-gray-200'
                                }`}>
                                  <FileText className={`w-7 h-7 ${
                                    isCompleted ? 'text-green-700' : isUploading ? 'text-blue-700' : hasError ? 'text-red-700' : 'text-gray-600'
                                  }`} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-3 mb-3">
                                    <h5 className="text-lg font-bold text-gray-900">
                                      {item.dateDisplay}
                                    </h5>
                                    <div className={`inline-flex items-center px-4 py-2 rounded-full text-xs font-bold shadow-sm border ${
                                      isCompleted 
                                        ? 'bg-gradient-to-r from-green-50 to-green-100 text-green-800 border-green-200'
                                        : isUploading
                                        ? 'bg-gradient-to-r from-blue-50 to-blue-100 text-blue-800 border-blue-200'
                                        : hasError
                                        ? 'bg-gradient-to-r from-red-50 to-red-100 text-red-800 border-red-200'
                                        : 'bg-gradient-to-r from-gray-50 to-gray-100 text-gray-800 border-gray-200'
                                    }`}>
                                      {isCompleted && <CheckCircle className="w-3 h-3 mr-1.5" />}
                                      {isUploading && <div className="w-3 h-3 mr-1.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />}
                                      {hasError && <span className="w-3 h-3 mr-1.5">⚠</span>}
                                      {isCompleted ? 'Completed' : isUploading ? 'Processing' : hasError ? 'Error' : 'Uploaded'}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <span className="font-medium truncate" title={item.file.name}>
                                      {item.file.name}
                                    </span>
                                    <span className="text-gray-400">•</span>
                                    <span className="px-2 py-1 bg-gray-100 rounded-md text-xs font-semibold text-gray-700">
                                      {(item.file.size / 1024 / 1024).toFixed(1)} MB
                                    </span>
                                  </div>
                                  {item.fileUrl && (
                                    <div className="mt-1 text-sm">
                                      <a
                                        href={item.fileUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-blue-600 hover:text-blue-700 underline"
                                      >
                                        View uploaded file
                                      </a>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Icon Actions */}
                              <div className="flex items-center gap-2 ml-4">
                                {/* Replace Icon (both db and local) */}
                                <button
                                  type="button"
                                  className="p-3 rounded-xl text-gray-400 hover:text-blue-600 hover:bg-blue-50 border border-transparent hover:border-blue-200 transition-all duration-200 group-hover:text-gray-500 shadow-sm hover:shadow-md"
                                  onClick={() => handleReplaceClick(item)}
                                  title="Replace file"
                                >
                                  <RefreshCw className="w-4 h-4" />
                                </button>
                                
                                {/* Retry Icon (local + error only) */}
                                {item.source === 'local' && hasError && (
                                  <button
                                    type="button"
                                    className="p-3 rounded-xl text-gray-400 hover:text-orange-600 hover:bg-orange-50 border border-transparent hover:border-orange-200 transition-all duration-200 shadow-sm hover:shadow-md"
                                    onClick={() => handleRetryUpload(item.dateKey)}
                                    title="Retry upload"
                                  >
                                    <RotateCcw className="w-4 h-4" />
                                  </button>
                                )}
                                
                                {/* Delete Icon (db and local) */}
                                <button
                                  type="button"
                                  className="p-3 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 transition-all duration-200 group-hover:text-gray-500 shadow-sm hover:shadow-md"
                                  onClick={() => handleDeleteClick(item)}
                                  title="Remove file"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>

                            {/* Progress bar for uploading */}
                            {isUploading && (
                              <div className="mt-4">
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                  <div className="bg-blue-600 h-2 rounded-full transition-all duration-300" style={{ width: '60%' }}></div>
                                </div>
                                <p className="text-xs text-blue-600 mt-2 font-medium">Processing document...</p>
                              </div>
                            )}

                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Next month reminder */}
                  {(() => {
                    const completed = getUnifiedDocumentCards().filter((s: ReturnType<typeof getUnifiedDocumentCards>[number]) => s.status === 'completed');
                    if (completed.length === 0) return null;
                    const latest = completed[0]; // unified list is already sorted desc by date
                    const [year, month, day] = latest.dateKey.split('-').map(Number);
                    if (!year || !month || !day) return null;
                    const currentDate = new Date(year, month - 1, day);
                    const nextMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
                    const nextMonthDisplay = nextMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                    return (
                      <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-100 rounded-xl">
                            <Upload className="w-5 h-5 text-blue-600" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-blue-900 mb-1">
                              Next: Upload statement for {nextMonthDisplay}
                            </p>
                            <p className="text-xs text-blue-700">
                              Continue your document sequence
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Upload Dropzone (enhanced) */}
                  <div 
                    className={`relative p-10 border-2 border-dashed rounded-3xl text-center transition-all duration-300 ${
                      isDragOver 
                        ? 'border-blue-400 bg-gradient-to-br from-blue-50 to-indigo-50 shadow-xl scale-[1.02]' 
                        : 'border-gray-300 bg-gradient-to-br from-gray-50/50 via-white to-blue-50/30 hover:border-blue-400 hover:bg-gradient-to-br hover:from-blue-50/50 hover:to-indigo-50/50 hover:shadow-lg hover:scale-[1.01]'
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <div className="relative">
                      <div className="p-4 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-2xl w-fit mx-auto mb-6 shadow-sm">
                        <Upload className="w-8 h-8 text-blue-600" />
                      </div>
                      <h3 className="text-xl font-bold text-gray-900 mb-3">
                        Upload Bank Statements
                      </h3>
                      <p className="text-sm text-gray-600 mb-8 max-w-md mx-auto leading-relaxed">
                        We'll automatically organize them by month. Drag & drop files here or click to browse.
                      </p>
                      <label className="cursor-pointer inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-4 focus:ring-blue-500/40 transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105">
                        <Upload className="w-5 h-5" />
                        Choose Files
                        <input
                          type="file"
                          className="sr-only"
                          accept=".pdf"
                          multiple
                          onChange={(e) => handleBulkUpload(e.target.files)}
                        />
                      </label>
                      <p className="text-xs text-gray-500 mt-4 font-medium">PDF files only, max 10MB each</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Legal & Compliance Section */}
              <div className="mb-8">
                <div className="mb-6">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-gradient-to-br from-amber-100 to-orange-100 rounded-xl shadow-sm border border-amber-200">
                      <Building2 className="w-5 h-5 text-amber-700" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">Legal & Compliance</h3>
                  </div>
                  <p className="text-sm text-gray-600 ml-12">Legal status and financial history</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="group">
                    <label className="flex items-start gap-4 p-5 rounded-2xl border-2 border-gray-200 bg-white hover:border-gray-300 hover:shadow-md transition-all duration-200 cursor-pointer">
                      <div className="flex items-center justify-center w-6 h-6 mt-0.5">
                        <input
                          type="checkbox"
                          checked={Boolean(details.hasBankruptcies)}
                          onChange={(e) => set('hasBankruptcies', e.target.checked)}
                          className="w-5 h-5 rounded-lg border-2 border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-colors duration-200"
                        />
                      </div>
                      <div className="flex-1">
                        <span className="text-base font-semibold text-gray-900 block mb-1">Has Bankruptcies</span>
                        <span className="text-sm text-gray-600">Any bankruptcy filings in business history</span>
                      </div>
                    </label>
                  </div>
                  <div className="group">
                    <label className="flex items-start gap-4 p-5 rounded-2xl border-2 border-gray-200 bg-white hover:border-gray-300 hover:shadow-md transition-all duration-200 cursor-pointer">
                      <div className="flex items-center justify-center w-6 h-6 mt-0.5">
                        <input
                          type="checkbox"
                          checked={Boolean(details.hasOpenJudgments)}
                          onChange={(e) => set('hasOpenJudgments', e.target.checked)}
                          className="w-5 h-5 rounded-lg border-2 border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-colors duration-200"
                        />
                      </div>
                      <div className="flex-1">
                        <span className="text-base font-semibold text-gray-900 block mb-1">Has Open Judgments</span>
                        <span className="text-sm text-gray-600">Any outstanding legal judgments</span>
                      </div>
                    </label>
                  </div>
                </div>
              </div>

              {/* Footer Actions */}
              <div className="flex items-center justify-between pt-8 mt-8 border-t border-gray-100">
                <div className="flex items-center gap-4">
                  {onBack && (
                    <button
                      type="button"
                      onClick={onBack}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border-2 border-gray-200 text-gray-700 font-semibold hover:border-gray-300 hover:bg-gray-50 hover:shadow-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-gray-500/20"
                    >
                      Back
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleContinue}
                  disabled={submitting}
                  className={`inline-flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-lg shadow-lg transition-all duration-200 focus:outline-none focus:ring-4 ${
                    submitting 
                      ? 'bg-gradient-to-r from-gray-400 to-gray-500 text-white cursor-not-allowed' 
                      : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 hover:shadow-xl hover:scale-105 focus:ring-blue-500/40'
                  }`}
                >
                  {submitting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Processing…
                    </>
                  ) : (
                    <>
                      Continue to Lender Matches
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </>
                  )}
                </button>
              </div>

              {/* Confirmation Modal removed: uploads auto-assign to the next available month */}

              {/* Hidden file input for replace functionality */}
              <input
                ref={replaceFileInputRef}
                type="file"
                className="sr-only"
                accept=".pdf"
                onChange={handleReplaceFileSelected}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SubmissionIntermediate;
