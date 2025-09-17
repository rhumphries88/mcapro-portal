import React, { useEffect, useRef, useState } from 'react';
import { Building2, Upload, FileText, CheckCircle, RefreshCw, Trash2, RotateCcw, DollarSign, TrendingUp, Calendar } from 'lucide-react';
import { getApplicationDocuments, deleteApplicationDocument, deleteApplicationDocumentByAppAndDate, getApplicationFinancialsByApplicationId, getApplicationSummaryByApplicationId, type ApplicationDocument, supabase } from '../lib/supabase';


const NEW_DEAL_WEBHOOK_URL = '/.netlify/functions/new-deal';
const NEW_DEAL_SUMMARY_WEBHOOK_URL = '/.netlify/functions/new-deal-summary';
const UPDATING_APPLICATIONS_WEBHOOK_URL = '/.netlify/functions/updating-applications';
const DOCUMENT_FILE_WEBHOOK_URL = '/.netlify/functions/document-file';
// Feature flag: temporarily disable updating applications webhook
const DISABLE_UPDATING_APPLICATIONS = true;


type Props = {
  onContinue: (details: Record<string, string | boolean>) => void;
  onBack?: () => void;
  // Optional prefill hooks if we want to seed values from application
  initial?: Partial<Record<string, string | boolean>>;
  loading?: boolean;
};

// Structured type based on MCA webhook response sample
type MCASummaryItem = {
  FUNDER: string;
  AMOUNT: string;
  'DAILY/WEEKLY Debit': string;
  NOTES: string;
};

// Generic monthly table row: keys and values are strings
type MCAMonthlyRow = Record<string, string>;

// Full parsed MCA payload we care about per document
type MCAParsed = {
  monthly_table?: MCAMonthlyRow[];
  mca_summary?: MCASummaryItem[];
  fraud_flags?: string[];
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

  // Retry helper: attempt to fetch summary until it returns 200 or max attempts reached
  const retrySummaryUntilReady = async (file: File, dateKey: string) => {
    const maxAttempts = 6; // ~1 min total if 10s interval
    const intervalMs = 10000;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // If no longer pending (e.g., user navigated or server responded), stop
      if (!pendingSummaryRef.current.has(dateKey)) return;
      try {
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('statementDate', dateKey);
        // Ensure backend ties summary to the correct application
        const appId = (details.applicationId as string) || (initial?.applicationId as string) || (details.id as string) || (initial?.id as string) || '';
        if (appId) form.append('application_id', appId);
        console.log(`[newDealSummary retry] attempt ${attempt}/${maxAttempts} for`, { dateKey, file: file.name });
        const resp = await fetchWithTimeout(NEW_DEAL_SUMMARY_WEBHOOK_URL, { method: 'POST', body: form, timeoutMs: 25000 });
        if (resp.ok && resp.status !== 202) {
          const ct = resp.headers.get('content-type') || '';
          let parsed: unknown = undefined;
          if (ct.includes('application/json')) parsed = await resp.json();
          else {
            const text = await resp.text();
            try { parsed = JSON.parse(text); } catch { parsed = undefined; }
          }
          if (parsed) {
            console.log('[newDealSummary retry] success; applying parsed summary');
            populateDetailsFromWebhook(parsed, { overwrite: false, markProvidedEvenIfNoChange: true });
            populatePerDocDetails(dateKey, parsed, { overwrite: true });
          }
          // mark as no longer pending, cancel any grace timer and complete UI now
          pendingSummaryRef.current.delete(dateKey);
          const t = pendingTimersRef.current.get(dateKey);
          if (typeof t === 'number') { window.clearTimeout(t); pendingTimersRef.current.delete(dateKey); }
          setDailyStatements(prev => new Map(prev.set(dateKey, { file, status: 'completed', fileUrl: prev.get(dateKey)?.fileUrl })));
          setUploadProgress(prev => {
            const next = new Map(prev);
            next.delete(dateKey);
            return next;
          });
          return;
        }
      } catch (e) {
        console.warn('[newDealSummary retry] attempt failed:', e);
      }
      await new Promise(res => setTimeout(res, intervalMs));
    }
    console.warn('[newDealSummary retry] exhausted attempts; will rely on grace timeout to complete UI');
  };

  // Populate per-document details (by dateKey) from webhook payload
  const populatePerDocDetails = (dateKey: string, payload: unknown, opts: { overwrite?: boolean } = {}) => {
    if (!payload || typeof payload !== 'object') return;
    // If payload is an array, merge object elements so we can find fields regardless of position
    const objects: Record<string, unknown>[] = Array.isArray(payload)
      ? (payload as unknown[]).filter((el): el is Record<string, unknown> => !!el && typeof el === 'object' && !Array.isArray(el))
      : [payload as Record<string, unknown>];
    const baseData: Record<string, unknown> = objects.length ? Object.assign({}, ...objects) : {};
    const flat = flattenObject(baseData);
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const ciEntries = Object.entries(flat).map(([k, v]) => [k.toLowerCase(), v] as const);
    const normEntries = Object.entries(flat).map(([k, v]) => [normalize(k), v] as const);

    const aliases: Record<string, string[]> = {
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

    const numericTargets = new Set([
      'creditScore','timeInBiz','avgMonthlyRevenue','averageMonthlyDeposits','existingDebt','requestedAmount','avgDailyBalance','avgMonthlyDepositCount','nsfCount','negativeDays','currentPositionCount','holdback','grossAnnualRevenue',
    ]);

    const sanitizeNumeric = (val: unknown): string => {
      const s = String(val ?? '').trim();
      if (!s) return '';
      return s.replace(/,/g, '').replace(/[^0-9.-]/g, '');
    };

    const getFirst = (keys: string[]) => {
      const direct = keys.map(k => baseData[k]).find(v => v !== undefined && v !== null && String(v).trim() !== '');
      if (direct !== undefined) return direct;
      for (const alias of keys) {
        const needle = alias.toLowerCase();
        const found = ciEntries.find(([k]) => k.endsWith(needle) || k === needle || k.includes(`.${needle}`));
        if (found && found[1] !== undefined && found[1] !== null && String(found[1]).trim() !== '') return found[1];
        const nNeedle = normalize(alias);
        const nFound = normEntries.find(([k]) => k === nNeedle || k.endsWith(nNeedle) || k.includes(nNeedle));
        if (nFound && nFound[1] !== undefined && nFound[1] !== null && String(nFound[1]).trim() !== '') return nFound[1];
      }
      return undefined;
    };

    const mapped: Record<string, string | boolean> = {};
    (Object.keys(aliases) as Array<keyof typeof aliases>).forEach((target) => {
      const value = getFirst(aliases[target]);
      if (value !== undefined) {
        mapped[target] = numericTargets.has(target as string) ? sanitizeNumeric(value) : String(value);
      }
    });

    console.log('[populatePerDocDetails] mapped keys for', dateKey, Object.keys(mapped));
    setPerDocDetails(prev => {
      const curr = prev[dateKey] || {};
      const next = { ...curr } as Record<string, string | boolean>;
      Object.entries(mapped).forEach(([k, v]) => {
        if (opts.overwrite || !next[k] || String(next[k]).trim() === '') next[k] = v;
      });
      return { ...prev, [dateKey]: next };
    });

    // Also try to populate MCA-like data by deep-searching the original payload as well as merged baseData
    try {
      let monthly_table: MCAMonthlyRow[] | undefined = undefined;
      let mca_summary: MCASummaryItem[] | undefined = undefined;
      let fraud_flags: string[] | undefined = undefined;

      const monthlyCandidates = [
        ...deepFindAllByKey(baseData, 'monthly_table'),
        ...deepFindAllByKey(payload, 'monthly_table'),
      ];
      const summaryCandidates = [
        ...deepFindAllByKey(baseData, 'mca_summary'),
        ...deepFindAllByKey(payload, 'mca_summary'),
      ];
      const flagCandidates = [
        ...deepFindAllByKey(baseData, 'fraud_flags'),
        ...deepFindAllByKey(payload, 'fraud_flags'),
      ];

      const monthlyRaw = monthlyCandidates.find((x) => Array.isArray(x));
      if (Array.isArray(monthlyRaw)) {
        monthly_table = (monthlyRaw as unknown[]).map((r) => {
          const rec = (r && typeof r === 'object') ? (r as Record<string, unknown>) : {};
          const out: Record<string, string> = {};
          Object.keys(rec).forEach((k) => { out[k] = String(rec[k] ?? ''); });
          return out;
        });
      }

      const summaryRaw = summaryCandidates.find((x) => Array.isArray(x) || (x && typeof x === 'object'));
      if (Array.isArray(summaryRaw)) {
        mca_summary = (summaryRaw as unknown[]).map((row) => {
          const r = row as Record<string, unknown>;
          return {
            FUNDER: String(r.FUNDER ?? ''),
            AMOUNT: String(r.AMOUNT ?? ''),
            'DAILY/WEEKLY Debit': String((r as Record<string, unknown>)['DAILY/WEEKLY Debit'] ?? ''),
            NOTES: String(r.NOTES ?? ''),
          } as MCASummaryItem;
        });
      } else if (summaryRaw && typeof summaryRaw === 'object') {
        const r = summaryRaw as Record<string, unknown>;
        mca_summary = [{
          FUNDER: String(r.FUNDER ?? ''),
          AMOUNT: String(r.AMOUNT ?? ''),
          'DAILY/WEEKLY Debit': String((r as Record<string, unknown>)['DAILY/WEEKLY Debit'] ?? ''),
          NOTES: String(r.NOTES ?? ''),
        }];
      }

      const flagsRaw = flagCandidates.find((x) => Array.isArray(x));
      if (Array.isArray(flagsRaw)) {
        fraud_flags = (flagsRaw as unknown[]).map((x) => String(x));
      }

      if (monthly_table || mca_summary || fraud_flags) {
        const payload: MCAParsed = { monthly_table, mca_summary, fraud_flags };
        console.log('[populatePerDocDetails] Storing MCA-like data', {
          dateKey,
          monthlyRows: monthly_table?.length || 0,
          summaryRows: mca_summary?.length || 0,
          fraudFlags: fraud_flags?.length || 0,
        });
        setPerDocMcaData((prev: Record<string, MCAParsed>) => ({ ...prev, [dateKey]: payload }));
      } else {
        console.log('[populatePerDocDetails] No MCA-like fields present in merged payload for', dateKey);
      }
    } catch (e) {
      console.warn('[populatePerDocDetails] Failed to derive MCA-like fields:', e);
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

  // Financial summary loading/aggregation removed per request

  const set = (key: string, value: string | boolean) => setDetails(prev => ({ ...prev, [key]: value }));

  const [submitting, setSubmitting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [, setUploadProgress] = useState<Map<string, number>>(new Map());
  const [fileBucket, setFileBucket] = useState<File[]>([]);
  const [bucketSubmitting, setBucketSubmitting] = useState(false);
  const [batchProcessing, setBatchProcessing] = useState(false);

  const addFilesToBucket = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const newOnes: File[] = [];
    Array.from(files).forEach((f) => {
      if (f.type !== 'application/pdf') return; // enforce pdf only
      if (f.size > 10 * 1024 * 1024) return; // 10MB limit
      // Avoid duplicates by name+size
      const dup = fileBucket.find((x) => x.name === f.name && x.size === f.size);
      if (!dup) newOnes.push(f);
    });
    if (newOnes.length) setFileBucket((prev) => [...prev, ...newOnes]);
  };

  const removeFromBucket = (index: number) => {
    setFileBucket((prev) => prev.filter((_, i) => i !== index));
  };

  const fileToBase64 = async (file: File): Promise<string> => {
    const buf = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
    }
    return btoa(binary);
  };

  const submitAllBucketFiles = async () => {
    if (!fileBucket.length || bucketSubmitting) return;
    const appId = (details.applicationId as string) || (initial?.applicationId as string) || (details.id as string) || (initial?.id as string) || '';
    if (!appId) {
      alert('Missing application ID');
      return;
    }
    setBucketSubmitting(true);
    setBatchProcessing(true);
    try {
      const filesPayload = await Promise.all(
        fileBucket.map(async (f) => ({
          file_name: f.name,
          file_type: f.type || 'application/pdf',
          file_bytes_base64: await fileToBase64(f),
        }))
      );
      const resp = await fetchWithTimeout(NEW_DEAL_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_id: appId, files: filesPayload }),
        timeoutMs: 45000,
      });
      const data = await resp.json().catch(() => ({ uploaded: [], upstream: null }));
      const uploaded: Array<{ file_name: string; status: string; file_url?: string }> = (data && data.uploaded) || [];

      const successNames = new Set(uploaded.filter((u) => u.status === 'uploaded').map((u) => u.file_name));
      // Clear only successes after upstream completed
      setFileBucket((prev) => prev.filter((f) => !successNames.has(f.name)));
      // Financial summary polling/aggregation removed per request
      // Refresh DB docs after processing is complete so rows appear with populated fields
      try { if (appId) await refetchDbDocs(appId); } catch {}
    } catch (e) {
      console.warn('[bucket submit] failed:', e);
      alert('Failed to submit files. Please try again.');
    } finally {
      setBucketSubmitting(false);
      setBatchProcessing(false);
    }
  };
  // Financial rows fetched from DB for cross-document summary
  // Financial summary state removed per request
  // Animated progress for general loading/submitting screen
  const [loadingProgress, setLoadingProgress] = useState(0);
  useEffect(() => {
    if (!(loading || submitting)) {
      setLoadingProgress(0);
      return;
    }
    // Start indeterminate-like progress up to ~90%
    setLoadingProgress(10);
    const id = setInterval(() => {
      setLoadingProgress(prev => {
        if (prev >= 90) return prev;
        return Math.min(prev + Math.random() * 10 + 5, 90);
      });
    }, 300);
    return () => clearInterval(id);
  }, [loading, submitting]);
  
  // Daily statements tracking (changed from monthly to daily)
  const [dailyStatements, setDailyStatements] = useState<Map<string, { file: File; status: 'uploading' | 'completed' | 'error'; fileUrl?: string }>>(new Map());

  // Persisted documents fetched from DB
  const [dbDocs, setDbDocs] = useState<ApplicationDocument[]>([]);
  const [dbDocsLoading, setDbDocsLoading] = useState(false);
  // Per-document extracted details keyed by dateKey
  const [perDocDetails, setPerDocDetails] = useState<Record<string, Record<string, string | boolean>>>({});
  // Per-document MCA payload keyed by dateKey
  const [perDocMcaData, setPerDocMcaData] = useState<Record<string, MCAParsed>>({});
  // Prevent duplicate document-file webhook calls for same file signature
  const inFlightDocSigsRef = useRef<Set<string>>(new Set());
  // Track which uploads have a background new-deal-summary still running (202/timeout)
  const pendingSummaryRef = useRef<Set<string>>(new Set());
  // Track per-document auto-complete timeouts so we can cancel if summary finishes
  const pendingTimersRef = useRef<Map<string, number>>(new Map());
  // Diagnostics: observe when MCA data updates
  useEffect(() => {
    const keys = Object.keys(perDocMcaData || {});
    try {
      if (keys.length) {
        console.log('[MCA state] perDocMcaData updated. Keys:', keys);
        const lastKey = keys[keys.length - 1];
        console.log('[MCA state] latest entry sample', lastKey, perDocMcaData[lastKey]);
      }
    } catch (e) {
      console.warn('[MCA state] Failed to log perDocMcaData update', e, { keys });
    }
  }, [perDocMcaData]);
  // Track which item is being replaced (db/local)
  const [replaceTarget, setReplaceTarget] = useState<null | { source: 'db' | 'local'; dateKey: string; docId?: string }>(null);
  // Inline document expansion removed per request

  // Create a ref for the replace file input
  const replaceFileInputRef = useRef<HTMLInputElement>(null);

  // Financial data state
  const [financialData, setFinancialData] = useState<any>(null);
  const [financialDataLoading, setFinancialDataLoading] = useState(false);

  // Bank Statement Summary data state
  const [summaryData, setSummaryData] = useState<any[]>([]);
  const [summaryDataLoading, setSummaryDataLoading] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  // Analysis in-progress flag: covers loading, background processing, and active uploads
  const isAnalysisInProgress = (
    summaryDataLoading ||
    batchProcessing ||
    (Array.from(dailyStatements.values()).some(v => v.status === 'uploading')) ||
    ((pendingSummaryRef.current?.size || 0) > 0)
  );
  // Detect if user has uploaded or has documents present
  const hasAnyDocs = ((dbDocs?.length || 0) > 0) || (dailyStatements.size > 0);
  // Show notice when user has docs but the Financial Overview row hasn't loaded yet
  const showFinancialOverviewNotice = !financialData && hasAnyDocs;

  // Fetch financial data when application ID is available
  const fetchFinancialData = async (appId: string) => {
    if (!appId) return;
    
    try {
      setFinancialDataLoading(true);
      console.log('[Financials] fetching application_financials for application_id:', appId);
      const data = await getApplicationFinancialsByApplicationId(appId);
      console.log('[Financials] fetched row:', data);
      setFinancialData(data);
    } catch (error) {
      console.error('Failed to fetch financial data:', error);
    } finally {
      setFinancialDataLoading(false);
    }
  };

  // Fetch summary data when application ID is available
  const fetchSummaryData = async (appId: string) => {
    if (!appId) return;
    
    console.log('[Summary] Starting fetch for application_id:', appId);
    try {
      setSummaryDataLoading(true);
      console.log('[Summary] fetching application_summary for application_id:', appId);
      const data = await getApplicationSummaryByApplicationId(appId);
      console.log('[Summary] fetched row:', data);
      console.log('[Summary] Boolean(data):', Boolean(data));
      setSummaryData(data);
    } catch (error) {
      console.error('[Summary] Failed to fetch summary data:', error);
      console.error('[Summary] Error details:', error);
    } finally {
      setSummaryDataLoading(false);
      console.log('[Summary] Finished loading, summaryDataLoading set to false');
    }
  };

  // Fetch financial data when application ID changes
  useEffect(() => {
    const appId = (details.applicationId as string) || (initial?.applicationId as string) || (details.id as string) || (initial?.id as string) || '';
    if (appId) {
      fetchFinancialData(appId);
      fetchSummaryData(appId);
    }
  }, [details.applicationId, details.id, initial?.applicationId, initial?.id]);

  // Realtime: listen for inserts/updates on application_financials for this application
  useEffect(() => {
    const appId = (details.applicationId as string) || (initial?.applicationId as string) || (details.id as string) || (initial?.id as string) || '';
    if (!appId) return;
    try {
      const channel = supabase
        .channel(`application_financials-${appId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'application_financials',
          filter: `application_id=eq.${appId}`,
        }, () => {
          fetchFinancialData(appId);
        })
        .subscribe();
      return () => { try { supabase.removeChannel(channel); } catch { /* ignore */ } };
    } catch {
      // ignore realtime subscription errors
      return;
    }
  }, [details.applicationId, details.id, initial?.applicationId, initial?.id]);

  // Realtime: listen for inserts/updates on application_summary for this application
  useEffect(() => {
    const appId = (details.applicationId as string) || (initial?.applicationId as string) || (details.id as string) || (initial?.id as string) || '';
    if (!appId) return;
    try {
      const channel = supabase
        .channel(`application_summary-${appId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'application_summary',
          filter: `application_id=eq.${appId}`,
        }, (payload) => {
          console.log('[Summary] Real-time update received:', payload);
          fetchSummaryData(appId);
        })
        .subscribe();
      return () => { try { supabase.removeChannel(channel); } catch { /* ignore */ } };
    } catch {
      // ignore realtime subscription errors
      return;
    }
  }, [details.applicationId, details.id, initial?.applicationId, initial?.id]);

  // Simple format helpers for the financials
  const toNumber = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const fmtCurrency = (v: unknown): string => {
    const n = toNumber(v);
    return typeof n === 'number' ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : '—';
  };
  const fmtNumber = (v: unknown): string => {
    const n = toNumber(v);
    return typeof n === 'number' ? n.toLocaleString() : '—';
  };
  const fmtMonths = (v: unknown): string => {
    const n = toNumber(v);
    return typeof n === 'number' ? `${n} mo${n === 1 ? '' : 's'}` : '—';
  };
  const fmtPercent = (v: unknown): string => {
    const n = toNumber(v);
    if (typeof n !== 'number') return '—';
    return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  };

  // Safely access a value from the fetched financial row by trying multiple aliases
  const valueFromFinancial = (...keys: string[]): unknown => {
    const row = financialData as Record<string, unknown> | null;
    if (!row) return undefined;
    for (const k of keys) {
      if (k in row && row[k] !== null && row[k] !== undefined) return row[k];
    }
    return undefined;
  };

  // Toggle card expansion
  const toggleCardExpansion = (cardId: string) => {
    setExpandedCards(prev => {
      const newSet = new Set(prev);
      if (newSet.has(cardId)) {
        newSet.delete(cardId);
      } else {
        newSet.add(cardId);
      }
      return newSet;
    });
  };

  

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

  // Simple fetch wrapper without automatic timeout or AbortController
  // Keeps the same signature so callers passing `timeoutMs` won't break; it is ignored.
  type WithTimeout = RequestInit & { timeoutMs?: number };
  const fetchWithTimeout = async (input: RequestInfo | URL, init: WithTimeout = {}) => {
    const restInit: RequestInit = { ...init };
    if ('timeoutMs' in restInit) {
      delete (restInit as WithTimeout).timeoutMs;
    }
    return fetch(input, restInit);
  };

  // (base64 conversion helper removed; no longer needed since we send only file_url)

  // Map extracted webhook fields into local `details` state.
  // Supports multiple aliases coming from backend.
  // opts.overwrite: replace current values even if not empty
  // opts.markProvidedEvenIfNoChange: still flag as auto-populated even when value is identical
  const populateDetailsFromWebhook = (payload: unknown, opts: { overwrite?: boolean; markProvidedEvenIfNoChange?: boolean } = {}) => {
    if (!payload || typeof payload !== 'object') return;
    // Merge array elements so top-level keys like "Entity Type" are discoverable regardless of index
    let data: Record<string, unknown> = {};
    if (Array.isArray(payload)) {
      for (const el of payload as unknown[]) {
        if (el && typeof el === 'object' && !Array.isArray(el)) {
          data = { ...data, ...(el as Record<string, unknown>) };
        }
      }
    } else {
      data = payload as Record<string, unknown>;
    }
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
  };

  // removed legacy uploadFilesToWebhook (replaced by month-aware handlers)

  // --- Month-aware upload (keeps UI intact) ---------------------------------
  // removed detectMonthFromFilename (no longer needed for daily uploads)

  // removed unused helpers for monthly logic (detectMonthFromFilename no longer needed)

  // Generate a date key based on today's date (YYYY-MM-DD) without pre-filling future months
  const getCurrentDateKey = () => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  // Generate a unique key so multiple files uploaded on the same day do not overwrite each other
  const getUniqueDateKey = () => {
    const base = getCurrentDateKey();
    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 6);
    return `${base}-${ts}-${rnd}`;
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

    // Assign a unique key for this upload (so multiple files on the same day are all listed)
    const targetDateKey = getUniqueDateKey();
    await performUpload(file, targetDateKey);
  };

  // Actual upload logic separated for reuse
  const performUpload = async (file: File, dateKey: string) => {
    // Set uploading state
    setDailyStatements(prev => new Map(prev.set(dateKey, { file, status: 'uploading' })));
    setUploadProgress(prev => new Map(prev.set(dateKey, 0)));
    
    // Simulate progress during upload
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => {
        const current = prev.get(dateKey) || 0;
        if (current >= 90) return prev; // Stop at 90% until completion
        const next = new Map(prev);
        next.set(dateKey, current + Math.random() * 15);
        return next;
      });
    }, 200);

    try {
      // 1) Send to NEW_DEAL_WEBHOOK_URL (extract business/financial fields)
      try {
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('statementDate', dateKey);
        // Include application_id so backend can associate this upload to the application
        const appIdForNewDeal = (details.applicationId as string) || (initial?.applicationId as string) || (details.id as string) || (initial?.id as string) || '';
        if (appIdForNewDeal) form.append('application_id', appIdForNewDeal);

        console.log('[newDeal webhook] Starting request', {
          url: NEW_DEAL_WEBHOOK_URL,
          fileName: file.name,
          dateKey,
        });
        const resp = await fetchWithTimeout(NEW_DEAL_WEBHOOK_URL, {
          method: 'POST',
          body: form,
          timeoutMs: 45000, // increase to 45s to reduce AbortError frequency on slow network/backend
        });

        if (resp.status === 202) {
          console.log('[newDeal webhook] 202 Accepted: processing in background. Skipping response parsing.');
          // Leave fields as-is; downstream steps can proceed. UI remains non-error.
        } else if (resp.ok) {
          const contentType = resp.headers.get('content-type') || '';
          console.log('[newDeal webhook] Response received', { status: resp.status, contentType });
          try {
            let parsed: unknown = undefined;
            if (contentType.includes('application/json')) {
              parsed = await resp.json();
            } else {
              const text = await resp.text();
              try { parsed = JSON.parse(text); } catch { parsed = undefined; }
            }
            if (parsed) {
              const isArray = Array.isArray(parsed);
              console.log('[newDeal webhook - daily] Parsed response summary:', {
                dateKey,
                isArray,
                arrayLength: isArray ? (parsed as unknown[]).length : undefined,
                topLevelKeys: !isArray && typeof parsed === 'object' ? Object.keys(parsed as Record<string, unknown>) : undefined,
              });
              populateDetailsFromWebhook(parsed, { overwrite: true, markProvidedEvenIfNoChange: true });
              populatePerDocDetails(dateKey, parsed, { overwrite: true });

              // Additionally, if newDeal returns MCA-like data (monthly_table, mca_summary, fraud_flags),
              // deep-search anywhere in the payload and store it.
              const monthlyCandidates = deepFindAllByKey(parsed, 'monthly_table');
              const summaryCandidates = deepFindAllByKey(parsed, 'mca_summary');
              const flagCandidates = deepFindAllByKey(parsed, 'fraud_flags');
              console.log('[newDeal webhook] deep-search candidates', {
                dateKey,
                monthlyCandidates: monthlyCandidates.length,
                summaryCandidates: summaryCandidates.length,
                flagCandidates: flagCandidates.length,
              });

              let monthly_table: MCAMonthlyRow[] | undefined;
              let mca_summary: MCASummaryItem[] | undefined;
              let fraud_flags: string[] | undefined;

              const monthlyRaw = monthlyCandidates.find((x) => Array.isArray(x));
              if (Array.isArray(monthlyRaw)) {
                monthly_table = (monthlyRaw as unknown[]).map((r) => {
                  const rec = (r && typeof r === 'object') ? (r as Record<string, unknown>) : {};
                  const out: Record<string, string> = {};
                  Object.keys(rec).forEach((k) => { out[k] = String(rec[k] ?? ''); });
                  return out;
                });
                console.log('[newDeal webhook] monthly_table extracted rows:', monthly_table.length);
              }

              const summaryRaw = summaryCandidates.find((x) => Array.isArray(x) || (x && typeof x === 'object'));
              if (Array.isArray(summaryRaw)) {
                mca_summary = (summaryRaw as unknown[]).map((row) => {
                  const r = row as Record<string, unknown>;
                  return {
                    FUNDER: String(r.FUNDER ?? ''),
                    AMOUNT: String(r.AMOUNT ?? ''),
                    'DAILY/WEEKLY Debit': String((r as Record<string, unknown>)['DAILY/WEEKLY Debit'] ?? ''),
                    NOTES: String(r.NOTES ?? ''),
                  } as MCASummaryItem;
                });
                console.log('[newDeal webhook] mca_summary extracted rows:', mca_summary.length);
              } else if (summaryRaw && typeof summaryRaw === 'object') {
                const r = summaryRaw as Record<string, unknown>;
                mca_summary = [{
                  FUNDER: String(r.FUNDER ?? ''),
                  AMOUNT: String(r.AMOUNT ?? ''),
                  'DAILY/WEEKLY Debit': String((r as Record<string, unknown>)['DAILY/WEEKLY Debit'] ?? ''),
                  NOTES: String(r.NOTES ?? ''),
                }];
                console.log('[newDeal webhook] mca_summary extracted 1 object row');
              }

              const flagsRaw = flagCandidates.find((x) => Array.isArray(x));
              if (Array.isArray(flagsRaw)) {
                fraud_flags = (flagsRaw as unknown[]).map((x) => String(x));
                console.log('[newDeal webhook] fraud_flags extracted count:', fraud_flags.length);
              }

              const payload: MCAParsed = { monthly_table, mca_summary, fraud_flags };
              if (monthly_table || mca_summary || fraud_flags) {
                console.log('[newDeal webhook] Storing MCA-like payload from newDeal', {
                  dateKey,
                  monthlyRows: monthly_table?.length || 0,
                  summaryRows: mca_summary?.length || 0,
                  fraudFlags: fraud_flags?.length || 0,
                });
                setPerDocMcaData((prev: Record<string, MCAParsed>) => ({ ...prev, [dateKey]: payload }));
              } else {
                console.log('[newDeal webhook] No MCA-like fields found in response (monthly_table, mca_summary, fraud_flags) for', dateKey);
              }
            }
          } catch (e) {
            console.warn('Unable to read daily webhook response:', e);
          }
        } else {
          console.warn(`newDeal webhook responded ${resp.status} ${resp.statusText}; continuing upload flow`);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          console.warn('[newDeal webhook] Request aborted due to timeout (45s). Continuing upload flow.', {
            fileName: file.name,
            dateKey,
          });
        } else {
          console.warn('newDeal webhook failed; continuing upload flow:', err);
        }
      }

      // 2) Call NEW_DEAL_SUMMARY_WEBHOOK_URL to derive MCA summary if backend provides it
      try {
        const form2 = new FormData();
        form2.append('file', file, file.name);
        form2.append('statementDate', dateKey);
        // Include application_id for summary linkage
        const appIdForSummary = (details.applicationId as string) || (initial?.applicationId as string) || (details.id as string) || (initial?.id as string) || '';
        if (appIdForSummary) form2.append('application_id', appIdForSummary);
        console.log('[newDealSummary webhook] Starting request', {
          url: NEW_DEAL_SUMMARY_WEBHOOK_URL,
          fileName: file.name,
          dateKey,
        });
        const respS = await fetchWithTimeout(NEW_DEAL_SUMMARY_WEBHOOK_URL, {
          method: 'POST',
          body: form2,
          timeoutMs: 45000,
        });
        if (respS.status === 202) {
          console.log('[newDealSummary webhook] 202 Accepted: processing in background.');
          // Mark this document as still processing so UI shows existing loading state
          pendingSummaryRef.current.add(dateKey);
          // Kick off retry loop to fetch summary until it becomes available
          void retrySummaryUntilReady(file, dateKey);
        } else if (respS.ok) {
          const ct = respS.headers.get('content-type') || '';
          let parsed: unknown = undefined;
          if (ct.includes('application/json')) {
            parsed = await respS.json();
          } else {
            const text = await respS.text();
            try { parsed = JSON.parse(text); } catch { parsed = undefined; }
          }
          if (parsed) {
            console.log('[newDealSummary webhook] Parsed response; attempting to populate MCA/fields', {
              dateKey,
              keys: (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? Object.keys(parsed as Record<string, unknown>) : undefined,
            });
            // Overwrite: summary webhook is authoritative for MCA-like data
            populateDetailsFromWebhook(parsed, { overwrite: false, markProvidedEvenIfNoChange: true });
            populatePerDocDetails(dateKey, parsed, { overwrite: true });
            // Clear any pending background flag if we received a concrete response
            pendingSummaryRef.current.delete(dateKey);
            // If a grace timer exists, cancel it so we can complete immediately
            const t = pendingTimersRef.current.get(dateKey);
            if (typeof t === 'number') { window.clearTimeout(t); pendingTimersRef.current.delete(dateKey); }
          }
        } else {
          console.warn(`newDealSummary webhook responded ${respS.status} ${respS.statusText}`);
        }
      } catch (e) {
        console.warn('[newDealSummary webhook] failed; continuing flow:', e);
        // If this was an Abort/timeout, keep UI in processing state
        try {
          const name = (e as any)?.name || '';
          if (name === 'AbortError') {
            pendingSummaryRef.current.add(dateKey);
            // Start retry attempts since initial call aborted
            void retrySummaryUntilReady(file, dateKey);
          }
        } catch {}
      }

      // 3) Upload to Supabase Storage first, then send metadata (with file_url) to DOCUMENT_FILE_WEBHOOK_URL
      try {
        // Prioritize applicationId over id to ensure we use the Applications table ID
        const appId = (details.applicationId as string) || (initial?.applicationId as string) || (details.id as string) || (initial?.id as string) || '';
        // Upload to Storage bucket 'application_documents' at root so URL is /application_documents/<file_name>
        let fileUrlFromStorage: string | undefined = undefined;
        try {
          const path = `${file.name}`;
          const { error: upErr } = await supabase.storage.from('application_documents').upload(path, file, { upsert: true });
          if (upErr) {
            console.warn('[storage] upload failed; proceeding without file_url:', upErr.message);
          } else {
            const { data: pub } = supabase.storage.from('application_documents').getPublicUrl(path);
            fileUrlFromStorage = pub?.publicUrl;
          }
        } catch (e) {
          console.warn('[storage] unexpected error during upload; proceeding without file_url:', e);
        }

        const payload = {
          application_id: appId,
          file_name: file.name,
          file_size: file.size,
          file_type: file.type || 'application/pdf',
          statement_date: dateKey,
          ...(fileUrlFromStorage ? { file_url: fileUrlFromStorage } : {}),
        } as const;
        const idempotencyKey = `${payload.application_id}|${payload.file_name}|${payload.file_size}`;
        if (inFlightDocSigsRef.current.has(idempotencyKey)) {
          console.log('[document-file] Skipping duplicate call for', idempotencyKey);
        } else {
          inFlightDocSigsRef.current.add(idempotencyKey);
        }
        const resp2 = await fetchWithTimeout(DOCUMENT_FILE_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(payload),
          timeoutMs: 30000,
        });

        let fileUrl: string | undefined = fileUrlFromStorage;
        const ct2 = resp2.headers.get('content-type') || '';
        if (ct2.includes('application/json')) {
          const data2 = await resp2.json().catch(() => undefined as unknown);
          if (data2 && typeof data2 === 'object') {
            const u = (data2 as Record<string, unknown>)['file_url'];
            if (typeof u === 'string' && u) fileUrl = u;
          }
        } else {
          const t2 = await resp2.text();
          try {
            const data2 = JSON.parse(t2);
            const u = (data2 as Record<string, unknown>)['file_url'];
            if (typeof u === 'string' && u) fileUrl = u;
          } catch {
            // ignore
          }
        }

        clearInterval(progressInterval);
        const isPending = pendingSummaryRef.current.has(dateKey);
        setUploadProgress(prev => {
          const next = new Map(prev);
          next.set(dateKey, isPending ? 95 : 100);
          return next;
        });
        if (isPending) {
          // Keep card in Processing state; auto-complete after a grace period
          setDailyStatements(prev => new Map(prev.set(dateKey, { file, status: 'uploading', fileUrl })));
          const timerId = window.setTimeout(() => {
            pendingSummaryRef.current.delete(dateKey);
            setDailyStatements(prev => new Map(prev.set(dateKey, { file, status: 'completed', fileUrl })));
            setUploadProgress(prev => {
              const next = new Map(prev);
              next.delete(dateKey);
              return next;
            });
          }, 60000); // 60s grace period
          pendingTimersRef.current.set(dateKey, timerId);
        } else {
          setTimeout(() => {
            setDailyStatements(prev => new Map(prev.set(dateKey, { file, status: 'completed', fileUrl })));
            setUploadProgress(prev => {
              const next = new Map(prev);
              next.delete(dateKey);
              return next;
            });
          }, 500);
        }
      } catch (e) {
        console.warn('documentFile webhook call failed; marking completed without URL:', e);
        clearInterval(progressInterval);
        const isPending = pendingSummaryRef.current.has(dateKey);
        setUploadProgress(prev => {
          const next = new Map(prev);
          next.set(dateKey, isPending ? 95 : 100);
          return next;
        });
        if (isPending) {
          setDailyStatements(prev => new Map(prev.set(dateKey, { file, status: 'uploading' })));
          const timerId = window.setTimeout(() => {
            pendingSummaryRef.current.delete(dateKey);
            setDailyStatements(prev => new Map(prev.set(dateKey, { file, status: 'completed' })));
            setUploadProgress(prev => {
              const next = new Map(prev);
              next.delete(dateKey);
              return next;
            });
          }, 60000);
          pendingTimersRef.current.set(dateKey, timerId);
        } else {
          setTimeout(() => {
            setDailyStatements(prev => new Map(prev.set(dateKey, { file, status: 'completed' })));
            setUploadProgress(prev => {
              const next = new Map(prev);
              next.delete(dateKey);
              return next;
            });
          }, 500);
        }
      }
    } catch (error) {
      console.error('Daily upload failed:', error);
      clearInterval(progressInterval);
      setDailyStatements(prev => new Map(prev.set(dateKey, { file, status: 'error' })));
      setUploadProgress(prev => {
        const next = new Map(prev);
        next.delete(dateKey);
        return next;
      });
    }
  };

  // Handle file selection from replace dialog
  const handleReplaceFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // If we have a replacement target, keep its dateKey and replace in-place
      const appId = (details.id as string) || (initial?.id as string) || (details.applicationId as string) || (initial?.applicationId as string) || '';
      const dateKey = replaceTarget?.dateKey || getUniqueDateKey();
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
    addFilesToBucket(e.dataTransfer.files);
  };

  // Helpers to build a unified list (DB docs + in-session uploads) rendered with the same card UI
  const formatDisplayDate = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  // Deep-search helpers to locate keys anywhere in a nested structure
  const normalizeKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const deepFindAllByKey = (root: unknown, targetKey: string): unknown[] => {
    const normTarget = normalizeKey(targetKey);
    const out: unknown[] = [];
    const stack: unknown[] = [root];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur) continue;
      if (Array.isArray(cur)) {
        for (const el of cur) stack.push(el);
      } else if (typeof cur === 'object') {
        const obj = cur as Record<string, unknown>;
        for (const k of Object.keys(obj)) {
          if (normalizeKey(k) === normTarget) out.push(obj[k]);
          stack.push(obj[k]);
        }
      }
    }
    return out;
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
      // Support unique keys like YYYY-MM-DD-<ts>-<rnd>
      const basePart = dateKey.slice(0, 10);
      const [year, month, day] = basePart.split('-').map(Number);
      const baseDate = (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)) ? new Date(year, month - 1, day) : new Date();
      const isCurrentMonth = (!Number.isNaN(year) && (year === tYear) && ((month - 1) === tMonth));
      const displayDate = (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)) ? new Date(year, month - 1, isCurrentMonth ? tDay : day) : new Date();
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

  // removed global hasCompletedDoc; we now expand per-document when clicked

  // Remove a statement
  const handleRemoveStatement = (dateKey: string) => {
    setDailyStatements(prev => {
      const next = new Map(prev);
      next.delete(dateKey);
      return next;
    });
  };

  const handleDeleteClick = async (item: UICardItem) => {
    const appId = (details.id as string) || (initial?.id as string) || (details.applicationId as string) || (initial?.applicationId as string) || '';
    if (item.source === 'db' && item.docId) {
      try {
        await deleteApplicationDocument(item.docId);
        console.log('Successfully deleted document from database:', item.docId);
      } catch (e) {
        console.error('Failed to delete DB document:', e);
        alert('Failed to delete document. Please try again.');
        return;
      }
      if (appId) await refetchDbDocs(appId);
      return;
    }
    // local -> also try to delete any persisted row that matches this date/file
    try {
      if (appId && item.dateKey) {
        await deleteApplicationDocumentByAppAndDate(appId, item.dateKey, item.file?.name);
        if (appId) await refetchDbDocs(appId);
      }
    } catch (e) {
      console.warn('Failed to delete matching DB document for local item:', e);
      // continue removing from UI even if DB delete fails
    }
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

  const handleContinue = async (item?: UICardItem) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // If a specific document is provided, merge its per-document details and include doc metadata
      const baseIds = {
        id: (details.id as string) || ((initial?.id as string) || ''),
        applicationId:
          (details.applicationId as string) ||
          ((initial?.applicationId as string) || (details.id as string) || (initial?.id as string) || ''),
      } as const;
      const isValidUUID = (v: unknown) =>
        typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
      if (!baseIds.applicationId || !isValidUUID(baseIds.applicationId)) {
        console.warn('[updatingApplications] Skipping webhook: missing or invalid applicationId', {
          id: baseIds.id,
          applicationId: baseIds.applicationId,
        });
      }

      let payload: Record<string, unknown> = {};
      if (item) {
        const docVals = perDocDetails[item.dateKey] || {};
        // normalize numeric fields: remove commas and percent
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
        // Merge prioritizing docVals only when value is non-empty
        const merged: Record<string, unknown> = { ...details };
        for (const key of Object.keys(docVals)) {
          const val = (docVals as Record<string, unknown>)[key];
          const isEmpty = val === '' || val === undefined || val === null;
          if (!isEmpty) merged[key] = val as unknown;
        }
        // Sanitize numeric fields for webhook (keep as cleaned strings)
        const sanitized: Record<string, unknown> = { ...merged };
        for (const k of Object.keys(merged)) {
          if (numericNames.has(k)) {
            const raw = String(merged[k] ?? '');
            if (raw === '') continue; // don't override with empty
            const withoutCommas = raw.replace(/,/g, '');
            const cleanedStr = k === 'holdback' ? withoutCommas.replace(/%/g, '') : withoutCommas;
            sanitized[k] = cleanedStr;
          }
        }
        // Build a flat application-shaped payload (previously working schema)
        payload = {
          id: baseIds.id,
          applicationId: baseIds.applicationId,
          dealName: sanitized.dealName ?? '',
          entityType: sanitized.entityType ?? '',
          industry: sanitized.industry ?? '',
          state: sanitized.state ?? '',
          creditScore: sanitized.creditScore ?? '',
          timeInBiz: sanitized.timeInBiz ?? '',
          grossAnnualRevenue: sanitized.grossAnnualRevenue ?? '',
          avgMonthlyRevenue: sanitized.avgMonthlyRevenue ?? '',
          averageMonthlyDeposits: sanitized.averageMonthlyDeposits ?? '',
          existingDebt: sanitized.existingDebt ?? '',
          requestedAmount: sanitized.requestedAmount ?? '',
          avgDailyBalance: sanitized.avgDailyBalance ?? '',
          avgMonthlyDepositCount: sanitized.avgMonthlyDepositCount ?? '',
          nsfCount: sanitized.nsfCount ?? '',
          negativeDays: sanitized.negativeDays ?? '',
          currentPositionCount: sanitized.currentPositionCount ?? '',
          holdback: sanitized.holdback ?? '',
          hasBankruptcies: Boolean(sanitized.hasBankruptcies ?? details.hasBankruptcies ?? false),
          hasOpenJudgments: Boolean(sanitized.hasOpenJudgments ?? details.hasOpenJudgments ?? false),
        };
      } else {
        // No specific document clicked: send flat application-shaped payload from current details
        const flatNumericNames = new Set([
          'creditScore','timeInBiz','avgMonthlyRevenue','averageMonthlyDeposits','existingDebt','requestedAmount','avgDailyBalance','avgMonthlyDepositCount','nsfCount','negativeDays','currentPositionCount','holdback','grossAnnualRevenue'
        ]);
        const sanitized: Record<string, unknown> = { ...details };
        for (const k of Object.keys(details)) {
          if (flatNumericNames.has(k)) {
            const raw = String((details as Record<string, unknown>)[k] ?? '');
            if (!raw) continue;
            const withoutCommas = raw.replace(/,/g, '');
            const cleanedStr = k === 'holdback' ? withoutCommas.replace(/%/g, '') : withoutCommas;
            sanitized[k] = cleanedStr;
          }
        }
        payload = {
          id: baseIds.id,
          applicationId: baseIds.applicationId,
          dealName: sanitized.dealName ?? '',
          entityType: sanitized.entityType ?? '',
          industry: sanitized.industry ?? '',
          state: sanitized.state ?? '',
          creditScore: sanitized.creditScore ?? '',
          timeInBiz: sanitized.timeInBiz ?? '',
          grossAnnualRevenue: sanitized.grossAnnualRevenue ?? '',
          avgMonthlyRevenue: sanitized.avgMonthlyRevenue ?? '',
          averageMonthlyDeposits: sanitized.averageMonthlyDeposits ?? '',
          existingDebt: sanitized.existingDebt ?? '',
          requestedAmount: sanitized.requestedAmount ?? '',
          avgDailyBalance: sanitized.avgDailyBalance ?? '',
          avgMonthlyDepositCount: sanitized.avgMonthlyDepositCount ?? '',
          nsfCount: sanitized.nsfCount ?? '',
          negativeDays: sanitized.negativeDays ?? '',
          currentPositionCount: sanitized.currentPositionCount ?? '',
          holdback: sanitized.holdback ?? '',
          hasBankruptcies: Boolean(sanitized.hasBankruptcies ?? details.hasBankruptcies ?? false),
          hasOpenJudgments: Boolean(sanitized.hasOpenJudgments ?? details.hasOpenJudgments ?? false),
        };
      }
      // Only attempt the webhook if enabled and we have a valid applicationId
      if (!DISABLE_UPDATING_APPLICATIONS && baseIds.applicationId && isValidUUID(baseIds.applicationId)) {
        try { console.log('[updatingApplications] payload preview (flat)', payload); } catch {}
        const resp = await fetchWithTimeout(UPDATING_APPLICATIONS_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          timeoutMs: 8000,
        });
        if (!resp.ok) {
          // Attempt to read response body for better diagnostics
          let errorText = '';
          try {
            errorText = await resp.text();
          } catch {
            // ignore
          }
          console.error('[updatingApplications] Non-OK response (flat payload)', {
            status: resp.status,
            statusText: resp.statusText,
            body: (errorText || '').slice(0, 2048),
          });
        }
      }
    } catch (e) {
      console.error('[updatingApplications] Error sending webhook:', e);
    } finally {
      // Trigger parent flow so parent can flip loading immediately
      if (item) {
        const docVals = perDocDetails[item.dateKey] || {};
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
        // Merge prioritizing docVals only when non-empty
        const merged: Record<string, unknown> = { ...details };
        for (const key of Object.keys(docVals)) {
          const val = (docVals as Record<string, unknown>)[key];
          const isEmpty = val === '' || val === undefined || val === null;
          if (!isEmpty) merged[key] = val as unknown;
        }
        // Sanitize and coerce numeric fields to numbers for downstream components
        for (const k of Object.keys(merged)) {
          if (numericNames.has(k)) {
            const raw = String(merged[k] ?? '');
            if (raw === '') continue;
            const withoutCommas = raw.replace(/,/g, '');
            const cleanedStr = k === 'holdback' ? withoutCommas.replace(/%/g, '') : withoutCommas;
            const asNum = cleanedStr === '' ? undefined : Number(cleanedStr);
            merged[k] = Number.isFinite(asNum as number) ? (asNum as number) : cleanedStr;
          }
        }
        // Do NOT attach selectedDocument here. Pass only application-shaped data
        onContinue(merged as typeof details);
      } else {
        onContinue(details);
      }
      // Keep local loading true until after handing off control
      setSubmitting(false);
    }
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
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-b from-blue-50 to-blue-100/70 border border-blue-100 flex items-center justify-center shadow-sm mb-5">
              <svg className="w-7 h-7 text-blue-600 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="12" y1="3.5" x2="12" y2="6.5" opacity="1" />
                  <line x1="12" y1="17.5" x2="12" y2="20.5" opacity="0.25" />
                  <line x1="3.5" y1="12" x2="6.5" y2="12" opacity="0.6" />
                  <line x1="17.5" y1="12" x2="20.5" y2="12" opacity="0.25" />
                  <line x1="6.1" y1="6.1" x2="8.2" y2="8.2" opacity="0.85" />
                  <line x1="15.8" y1="15.8" x2="17.9" y2="17.9" opacity="0.2" />
                  <line x1="6.1" y1="17.9" x2="8.2" y2="15.8" opacity="0.45" />
                  <line x1="15.8" y1="8.2" x2="17.9" y2="6.1" opacity="0.25" />
                </g>
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900">Finding Your Lender Matches</h3>
            <p className="text-gray-600 mt-1">We’re reviewing your application and matching it with lenders best suited to your needs.</p>
            <div className="w-full max-w-md mt-6">
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${loadingProgress}%` }}
                ></div>
              </div>
            </div>
            <p className="text-gray-500 text-xs mt-3">This usually takes 30–60 seconds</p>
          </div>
          ) : (
            <>
              {/* Business Information Section moved below Bank Statements */}

              {/* Bank Statement Upload - Enhanced Professional Design */}
              <div className="mb-8">
                  <div className="mb-8 bg-gradient-to-r from-slate-50 to-blue-50/30 rounded-2xl p-6 border border-slate-200">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
                          <Upload className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <h3 className="text-2xl font-bold text-slate-800 mb-1">Bank Statement Documents</h3>
                          <p className="text-slate-600 font-medium">Secure document processing for financial analysis</p>
                        </div>
                      </div>
                      <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-white/60 backdrop-blur-sm rounded-lg border border-slate-200 shadow-sm">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                        <span className="text-sm font-medium text-slate-700">System Ready</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                      <div className="flex items-center gap-3 p-3 bg-white/50 rounded-lg border border-slate-200">
                        <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                          <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">Secure Upload</p>
                          <p className="text-xs text-slate-600">Bank-grade encryption</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-white/50 rounded-lg border border-slate-200">
                        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">Fast Processing</p>
                          <p className="text-xs text-slate-600">AI-powered analysis</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-white/50 rounded-lg border border-slate-200">
                        <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                          <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">Smart Extraction</p>
                          <p className="text-xs text-slate-600">Auto-fill financial data</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Uploaded Files Table */}
                  {(getUnifiedDocumentCards().length > 0) && (
                    <div className="mb-8">
                      <div className="flex items-center justify-between mb-6 p-4 bg-gradient-to-r from-white to-slate-50 rounded-xl border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg shadow-sm">
                            <FileText className="w-4 h-4 text-white" />
                          </div>
                          <div>
                            <h4 className="text-lg font-bold text-slate-800">
                              {getUnifiedDocumentCards().length} {getUnifiedDocumentCards().length === 1 ? 'Document' : 'Documents'} Uploaded
                            </h4>
                            <p className="text-sm text-slate-600">Ready for processing and analysis</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {dbDocsLoading && (
                            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-200">
                              <div className="w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                              <span className="text-sm font-medium text-blue-700">Syncing…</span>
                            </div>
                          )}

                  {batchProcessing && (
                    <div className="mb-6 p-4 rounded-xl border border-blue-200 bg-blue-50 text-blue-800 text-sm flex items-center gap-3">
                      <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <div>
                        Processing uploaded documents… Please wait while we finish extracting details. The form will populate once processing completes.
                      </div>
                    </div>
                  )}
                          <div className="px-3 py-2 bg-emerald-50 rounded-lg border border-emerald-200">
                            <span className="text-sm font-semibold text-emerald-700">All Systems Active</span>
                          </div>
                        </div>
                      </div>

                      {/* Table Layout */}
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-gradient-to-r from-slate-50 to-blue-50/30 border-b border-slate-200">
                              <tr>
                                <th className="px-6 py-4 text-left text-sm font-bold text-slate-700 uppercase tracking-wider">Document</th>
                                <th className="px-6 py-4 text-left text-sm font-bold text-slate-700 uppercase tracking-wider">Status</th>
                                <th className="px-6 py-4 text-left text-sm font-bold text-slate-700 uppercase tracking-wider">Size</th>
                                <th className="px-6 py-4 text-left text-sm font-bold text-slate-700 uppercase tracking-wider">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {getUnifiedDocumentCards().map((item) => {
                                const isUploading = item.status === 'uploading';
                                const isCompleted = item.status === 'completed';
                                const hasError = item.status === 'error';

                                return (
                                  <tr 
                                    key={item.key}
                                    className={`group hover:bg-slate-50/50 transition-all duration-200`}
                                  >
                                    {/* Document Column */}
                                    <td className="px-6 py-4">
                                      <div className="flex items-center gap-4">
                                        <div className={`flex items-center justify-center w-12 h-12 rounded-xl shadow-sm border ${
                                          isCompleted ? 'bg-gradient-to-br from-emerald-100 to-green-100 border-emerald-200' : 
                                          isUploading ? 'bg-gradient-to-br from-blue-100 to-indigo-100 border-blue-200' : 
                                          hasError ? 'bg-gradient-to-br from-red-100 to-rose-100 border-red-200' : 
                                          'bg-gradient-to-br from-slate-100 to-gray-100 border-slate-200'
                                        }`}>
                                          <FileText className={`w-6 h-6 ${
                                            isCompleted ? 'text-emerald-700' : isUploading ? 'text-blue-700' : hasError ? 'text-red-700' : 'text-slate-600'
                                          }`} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <h5 className="text-base font-semibold text-slate-900 truncate" title={item.file.name}>
                                            {item.file.name}
                                          </h5>
                                          <p className="text-sm text-slate-500">PDF Document</p>
                                          {isCompleted && item.fileUrl && (
                                            <a
                                              href={item.fileUrl}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium mt-1"
                                              onClick={(e) => e.stopPropagation()}
                                            >
                                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                              </svg>
                                              View Document
                                            </a>
                                          )}
                                        </div>
                                      </div>
                                    </td>

                                    {/* Status Column */}
                                    <td className="px-6 py-4">
                                      <div className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold border ${
                                        isCompleted 
                                          ? 'bg-gradient-to-r from-emerald-50 to-green-50 text-emerald-800 border-emerald-200'
                                          : isUploading
                                          ? 'bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-800 border-blue-200'
                                          : hasError
                                          ? 'bg-gradient-to-r from-red-50 to-rose-50 text-red-800 border-red-200'
                                          : 'bg-gradient-to-r from-slate-50 to-gray-50 text-slate-800 border-slate-200'
                                      }`}>
                                        {isCompleted && <CheckCircle className="w-3 h-3 mr-1" />}
                                        {isUploading && <div className="w-3 h-3 mr-1 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />}
                                        {hasError && <span className="w-3 h-3 mr-1">⚠</span>}
                                        {isCompleted ? 'Completed' : isUploading ? 'Processing' : hasError ? 'Error' : 'Uploaded'}
                                      </div>
                                    </td>

                                    {/* Size Column */}
                                    <td className="px-6 py-4">
                                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 rounded-md text-xs font-semibold text-slate-700">
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        {(item.file.size / 1024 / 1024).toFixed(1)} MB
                                      </span>
                                    </td>

                                    {/* Actions Column */}
                                    <td className="px-6 py-4">
                                      <div className="flex items-center gap-1">
                                        {/* Replace Button */}
                                        <button
                                          type="button"
                                          className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 border border-transparent hover:border-blue-200 transition-all duration-200"
                                          onClick={(e) => { e.stopPropagation(); handleReplaceClick(item); }}
                                          title="Replace file"
                                        >
                                          <RefreshCw className="w-4 h-4" />
                                        </button>
                                        
                                        {/* Retry Button (error only) */}
                                        {item.source === 'local' && hasError && (
                                          <button
                                            type="button"
                                            className="p-2 rounded-lg text-slate-400 hover:text-orange-600 hover:bg-orange-50 border border-transparent hover:border-orange-200 transition-all duration-200"
                                            onClick={(e) => { e.stopPropagation(); handleRetryUpload(item.dateKey); }}
                                            title="Retry upload"
                                          >
                                            <RotateCcw className="w-4 h-4" />
                                          </button>
                                        )}
                                        
                                        {/* Delete Button */}
                                        <button
                                          type="button"
                                          className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 transition-all duration-200"
                                          onClick={(e) => { e.stopPropagation(); handleDeleteClick(item); }}
                                          title="Remove file"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Expanded Details Section removed per request */}
                    </div>
                  )}

                  {/* Financial Overview (from application_financials by application_id) */}
                  {Boolean(financialData) && (
                    <div className="mb-8">
                      <div className="px-5 py-4 mb-3 flex items-center justify-between bg-white rounded-xl border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200">
                            <DollarSign className="w-4 h-4 text-emerald-700" />
                          </div>
                          <div>
                            <h4 className="text-lg font-bold text-slate-800">Financial Overview</h4>
                            <p className="text-xs text-slate-600">Data loaded from your application</p>
                          </div>
                        </div>
                        {financialDataLoading && (
                          <div className="flex items-center gap-2 text-blue-700 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-lg">
                            <div className="w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                            <span className="text-xs font-semibold">Refreshing…</span>
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                          <div className="text-sm text-slate-600">Deal Name</div>
                          <div className="mt-1 text-base font-semibold text-slate-900">{(valueFromFinancial('deal_name','dealName','business_name') as string) || '—'}</div>
                        </div>
                        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                          <div className="text-sm text-slate-600">Industry</div>
                          <div className="mt-1 text-base font-semibold text-slate-900">{(valueFromFinancial('industry','naics_description','industry_type') as string) || '—'}</div>
                        </div>
                        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                          <div className="text-sm text-slate-600">Entity Type</div>
                          <div className="mt-1 text-base font-semibold text-slate-900">{(valueFromFinancial('entity_type','entity','business_type') as string) || '—'}</div>
                        </div>
                        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                          <div className="text-sm text-slate-600">State</div>
                          <div className="mt-1 text-base font-semibold text-slate-900">{(valueFromFinancial('state','State') as string) || '—'}</div>
                        </div>

                        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-600">Time in Biz (months)</span>
                            <Calendar className="w-4 h-4 text-slate-400" />
                          </div>
                          <div className="mt-1 text-xl font-extrabold text-slate-900">{fmtMonths(valueFromFinancial('time_in_biz_months','tib_months','time_in_business_months'))}</div>
                        </div>

                        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-600">Avg Monthly Revenue</span>
                            <TrendingUp className="w-4 h-4 text-slate-400" />
                          </div>
                          <div className="mt-1 text-xl font-extrabold text-slate-900">{fmtCurrency(valueFromFinancial('avg_monthly_revenue','monthly_revenue','average_monthly_revenue'))}</div>
                        </div>
                        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-600">Avg Monthly Deposits</span>
                            <DollarSign className="w-4 h-4 text-slate-400" />
                          </div>
                          <div className="mt-1 text-xl font-extrabold text-slate-900">{fmtCurrency(valueFromFinancial('avg_monthly_deposits','monthly_deposits','average_monthly_deposits'))}</div>
                        </div>
                        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-600">Existing Business Debt</span>
                            <DollarSign className="w-4 h-4 text-slate-400" />
                          </div>
                          <div className="mt-1 text-xl font-extrabold text-slate-900">{fmtCurrency(valueFromFinancial('existing_business_debt','existing_debt','current_debt'))}</div>
                        </div>
                        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-600">Gross Annual Revenue</span>
                            <TrendingUp className="w-4 h-4 text-slate-400" />
                          </div>
                          <div className="mt-1 text-xl font-extrabold text-slate-900">{fmtCurrency(valueFromFinancial('gross_annual_revenue','annual_revenue','annualRevenue'))}</div>
                        </div>
                        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-600">Avg Daily Balance</span>
                            <DollarSign className="w-4 h-4 text-slate-400" />
                          </div>
                          <div className="mt-1 text-xl font-extrabold text-slate-900">{fmtCurrency(valueFromFinancial('avg_daily_balance'))}</div>
                        </div>
                        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                          <div className="text-sm text-slate-600">Avg Monthly Deposit Count</div>
                          <div className="mt-1 text-xl font-extrabold text-slate-900">{fmtNumber(valueFromFinancial('avg_monthly_deposit_count'))}</div>
                        </div>
                        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                          <div className="text-sm text-slate-600">NSF Count</div>
                          <div className="mt-1 text-xl font-extrabold text-slate-900">{fmtNumber(valueFromFinancial('nsf_count'))}</div>
                        </div>
                        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                          <div className="text-sm text-slate-600">Negative Days</div>
                          <div className="mt-1 text-xl font-extrabold text-slate-900">{fmtNumber(valueFromFinancial('negative_days'))}</div>
                        </div>
                        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                          <div className="text-sm text-slate-600">Current Position Count</div>
                          <div className="mt-1 text-xl font-extrabold text-slate-900">{fmtNumber(valueFromFinancial('current_position_count'))}</div>
                        </div>
                        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                          <div className="text-sm text-slate-600">Holdback</div>
                          <div className="mt-1 text-xl font-extrabold text-slate-900">{fmtPercent(valueFromFinancial('holdback','holdback_percent'))}</div>
                        </div>
                      </div>
                      {(!Array.isArray(summaryData) || summaryData.length === 0) && (
                        <div className="mt-3 p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm flex items-start gap-3">
                          <FileText className="w-4 h-4 mt-0.5 text-amber-700" />
                          <div>
                            <div className="font-semibold">Bank Statement Analysis is processing</div>
                            <p className="mt-0.5">Please wait here and do not proceed to <span className="font-semibold">Lender Matches</span> yet. The <span className="font-semibold">Financial Performance Review & Assessment</span> will automatically appear below once ready.</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {showFinancialOverviewNotice && (
                    <div className="mb-6 p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm flex items-start gap-3">
                      <FileText className="w-4 h-4 mt-0.5 text-amber-700" />
                      <div>
                        <div className="font-semibold">Preparing Financial Overview</div>
                        <p className="mt-0.5">Your documents have been uploaded and are being processed. The <span className="font-semibold">Financial Overview</span> will appear here shortly. Please wait before proceeding to <span className="font-semibold">Lender Matches</span>.</p>
                      </div>
                    </div>
                  )}
                  {/* Bank Statement Summary (from application_summary by application_id) - Show only when analysis in progress or has data */}
                  {(isAnalysisInProgress || (summaryData && summaryData.length > 0)) && (
                    <div className="mb-8">
                      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg shadow-lg mb-6">
                        <div className="px-8 py-6">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-5">
                              <div className="p-4 bg-blue-600 rounded-xl shadow-md">
                                <FileText className="w-6 h-6 text-white" />
                              </div>
                              <div>
                                <h4 className="text-2xl font-bold text-slate-800 mb-1">Bank Statement Analysis</h4>
                                <p className="text-blue-700 font-medium">Financial Performance Review & Assessment</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-6">
                        {isAnalysisInProgress ? (
                          <div className="p-8 bg-white rounded-xl border border-slate-200 text-center">
                            <div className="flex flex-col items-center gap-4">
                              <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                              <div>
                                <h6 className="text-lg font-semibold text-slate-800 mb-2">Processing Bank Statements</h6>
                                <p className="text-slate-600 text-sm">Analyzing your financial data to generate comprehensive reports...</p>
                                <p className="text-slate-700 text-sm mt-2">
                                  Please stay on this page — your <span className="font-semibold">Bank Statement Analysis</span> is still processing.
                                  Wait for the <span className="font-semibold">Financial Performance Review & Assessment</span> to appear here
                                  before proceeding to <span className="font-semibold">Lender Matches</span>.
                                </p>
                              </div>
                            </div>
                          </div>
                        ) : summaryData && summaryData.length > 0 ? (
                          summaryData.map((row: any, index: number) => {
                            const cardId = row.id || `card-${index}`;
                            const isExpanded = expandedCards.has(cardId);
                            return (
                            <div key={cardId} className="bg-white border border-slate-200 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300">
                              <div 
                                className="px-8 py-6 cursor-pointer hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 transition-all duration-300 rounded-t-xl border-b border-slate-100"
                                onClick={() => toggleCardExpansion(cardId)}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-5">
                                    <div className="w-4 h-4 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full shadow-sm"></div>
                                    <h5 className="text-xl font-bold text-slate-800">
                                      {row.month || `Period ${index + 1}`}
                                    </h5>
                                  </div>
                                  <div className="flex items-center gap-4">
                                    <div className="px-4 py-2 bg-gradient-to-r from-slate-100 to-slate-50 text-slate-700 text-sm font-semibold rounded-lg border border-slate-200 shadow-sm">
                                      Statement Period
                                    </div>
                                    <button className="w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white rounded-lg shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center">
                                      {isExpanded ? (
                                        <span className="font-bold text-lg leading-none">−</span>
                                      ) : (
                                        <span className="font-bold text-lg leading-none">+</span>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                              {isExpanded && (
                                <div className="px-8 pb-8 bg-gradient-to-b from-white to-slate-50">
                                  {/* Bank Statement Analysis Section */}
                                  <div className="mb-8">
                                    <div className="flex items-center gap-3 mb-6">
                                      <div className="w-1 h-6 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-full"></div>
                                      <h6 className="text-lg font-bold text-slate-800">Financial Analysis Summary</h6>
                                    </div>
                                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                      <div className="overflow-x-auto">
                                        <table className="w-full">
                                          <thead>
                                            <tr className="bg-gradient-to-r from-slate-50 to-blue-50 border-b border-slate-200">
                                              <th className="text-left py-4 px-6 font-semibold text-slate-700">Metric</th>
                                              <th className="text-right py-4 px-6 font-semibold text-slate-700">Value</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            <tr className="border-b border-slate-100 hover:bg-blue-50/30 transition-colors duration-200">
                                              <td className="py-4 px-6 font-medium text-slate-600">Monthly Revenue</td>
                                              <td className="py-4 px-6 text-right font-mono text-lg font-bold text-slate-900">{row.monthly_revenue ? fmtCurrency(row.monthly_revenue) : 'N/A'}</td>
                                            </tr>
                                            <tr className="border-b border-slate-100 hover:bg-blue-50/30 transition-colors duration-200">
                                              <td className="py-4 px-6 font-medium text-slate-600">Average Daily Balance</td>
                                              <td className="py-4 px-6 text-right font-mono text-lg font-bold text-slate-900">{row.average_daily_balances ? fmtCurrency(row.average_daily_balances) : 'N/A'}</td>
                                            </tr>
                                            <tr className="border-b border-slate-100 hover:bg-blue-50/30 transition-colors duration-200">
                                              <td className="py-4 px-6 font-medium text-slate-600">Ending Balance</td>
                                              <td className="py-4 px-6 text-right font-mono text-lg font-bold text-slate-900">{row.ending_balances ? fmtCurrency(row.ending_balances) : 'N/A'}</td>
                                            </tr>
                                            <tr className="border-b border-slate-100 hover:bg-blue-50/30 transition-colors duration-200">
                                              <td className="py-4 px-6 font-medium text-slate-600">Net Deposit Count</td>
                                              <td className="py-4 px-6 text-right font-mono text-lg font-bold text-slate-900">{row.net_deposit_count ? fmtNumber(row.net_deposit_count) : 'N/A'}</td>
                                            </tr>
                                            <tr className="hover:bg-blue-50/30 transition-colors duration-200">
                                              <td className="py-4 px-6 font-medium text-slate-600">Negative Days</td>
                                              <td className="py-4 px-6 text-right font-mono text-lg font-bold text-slate-900">{row.negative_days ? fmtNumber(row.negative_days) : 'N/A'}</td>
                                            </tr>
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Funding Information Section */}
                                  {(row.funder || row.amount || row.debit_frequency || row.notes) && (
                                    <div className="mb-6">
                                      <div className="flex items-center gap-3 mb-6">
                                        <div className="w-1 h-6 bg-gradient-to-b from-emerald-500 to-teal-500 rounded-full"></div>
                                        <h6 className="text-lg font-bold text-slate-800">Funding Details</h6>
                                      </div>
                                      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
                                          <div className="p-6 border-b md:border-b-0 md:border-r border-slate-200">
                                            <div className="space-y-4">
                                              <div>
                                                <label className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Funder</label>
                                                <p className="text-lg font-bold text-slate-900 mt-1">{row.funder || 'Not Specified'}</p>
                                              </div>
                                              <div>
                                                <label className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Funding Amount</label>
                                                <p className="text-xl font-bold text-emerald-600 mt-1 font-mono">{row.amount ? fmtCurrency(row.amount) : 'Not Specified'}</p>
                                              </div>
                                            </div>
                                          </div>
                                          <div className="p-6">
                                            <div className="space-y-4">
                                              <div>
                                                <label className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Debit Frequency</label>
                                                <p className="text-lg font-bold text-slate-900 mt-1">{row.debit_frequency || 'Not Specified'}</p>
                                              </div>
                                              <div>
                                                <label className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Notes</label>
                                                <p className="text-slate-700 mt-1 leading-relaxed">{row.notes || 'No additional notes'}</p>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {/* Statement Footer */}
                                  <div className="mt-8 pt-6 border-t border-slate-200">
                                    <div className="flex justify-between items-center text-sm text-slate-500">
                                      <div className="flex items-center gap-2">
                                        <Calendar className="w-4 h-4" />
                                        <span>Statement Period: {row.month || 'Not Specified'}</span>
                                      </div>
                                      <span>Generated: {new Date().toLocaleDateString()}</span>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                            );
                          })
                        ) : null}
                      </div>
                    </div>
                  )}
                  {/* Financial Summary removed per request */}

                  {/* Global Continue button (outside each document) */}
                  <div className="flex items-center justify-end mt-6 mb-10">
                    <button
                      type="button"
                      onClick={() => handleContinue()}
                      disabled={submitting || batchProcessing}
                      className={`inline-flex items-center gap-3 px-6 py-3 rounded-xl font-bold text-base shadow-md transition-all duration-200 focus:outline-none focus:ring-4 ${
                        submitting || batchProcessing
                          ? 'bg-gradient-to-r from-gray-400 to-gray-500 text-white cursor-not-allowed'
                          : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 hover:shadow-lg hover:scale-[1.02] focus:ring-blue-500/40'
                      }`}
                      aria-label="Continue to Lender Matches"
                      aria-busy={submitting || batchProcessing}
                    >
                      {submitting || batchProcessing ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
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

                  {/* Next month reminder removed per request */}

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
                        Drag & drop PDF files here or click to browse.
                      </p>
                      <label className={`cursor-pointer inline-flex items-center gap-3 px-8 py-4 rounded-2xl font-bold focus:outline-none focus:ring-4 focus:ring-blue-500/40 transition-all duration-200 shadow-lg ${batchProcessing ? 'pointer-events-none opacity-60 bg-gray-400 text-white' : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 hover:shadow-xl hover:scale-105'}`}>
                        <Upload className="w-5 h-5" />
                        Choose Files
                        <input
                          type="file"
                          className="sr-only"
                          accept=".pdf"
                          multiple
                          onChange={(e) => !batchProcessing && addFilesToBucket(e.target.files)}
                        />
                      </label>
                      <p className="text-xs text-gray-500 mt-4 font-medium">PDF files only, max 10MB each</p>
                    </div>
                  </div>
                  {/* Local Bucket Preview and Submit All */}
                  {fileBucket.length > 0 && (
                    <div className="mt-6 bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden">
                      <div className="px-6 py-4 bg-gradient-to-r from-slate-50 to-blue-50/30 border-b border-slate-200 flex items-center justify-between">
                        <div className="text-slate-800 font-bold">Files Staged ({fileBucket.length})</div>
                        <button
                          type="button"
                          onClick={submitAllBucketFiles}
                          disabled={bucketSubmitting || batchProcessing}
                          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-white ${(bucketSubmitting || batchProcessing) ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'} transition-colors`}
                        >
                          {(bucketSubmitting || batchProcessing) ? 'Submitting…' : 'Submit All'}
                        </button>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {fileBucket.map((f, idx) => (
                          <div key={`${f.name}-${idx}`} className="flex items-center justify-between px-6 py-4">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                                <FileText className="w-5 h-5 text-slate-600" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-900 truncate" title={f.name}>{f.name}</div>
                                <div className="text-xs text-slate-600">{(f.size/1024/1024).toFixed(1)} MB • {f.type || 'application/pdf'}</div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeFromBucket(idx)}
                              className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                              title="Remove"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>

              {/* Global Financial Details section removed; details now expand inline under a clicked completed document */}

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
                {/* Global continue button removed; use per-document buttons at the bottom of each expanded Financial Details */}
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
