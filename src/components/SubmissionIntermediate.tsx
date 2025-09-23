import React, { useEffect, useRef, useState } from 'react';
  import { Upload, FileText, CheckCircle, RefreshCw, Trash2, RotateCcw, TrendingUp, Calendar } from 'lucide-react';
import { getApplicationDocuments, deleteApplicationDocument, deleteApplicationDocumentByAppAndDate, getApplicationSummaryByApplicationId, type ApplicationDocument, supabase } from '../lib/supabase';

import { parseAmount, fmtCurrency2, slugify, formatDateHuman, getUniqueDateKey, fetchWithTimeout } from './SubmissionIntermediate.helpers';
import { UploadDropzone, FilesBucketList, LegalComplianceSection, AnalysisSummarySection, FundingDetailsSection, DocumentDetailsControls, TransactionSummarySection } from './SubmissionIntermediate.Views';


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
            console.log('[newDealSummary retry] success; parsed summary received');
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
  // Prevent duplicate document-file webhook calls for same file signature
  const inFlightDocSigsRef = useRef<Set<string>>(new Set());
  // Track which uploads have a background new-deal-summary still running (202/timeout)
  const pendingSummaryRef = useRef<Set<string>>(new Set());
  // Track per-document auto-complete timeouts so we can cancel if summary finishes
  const pendingTimersRef = useRef<Map<string, number>>(new Map());
  
  // Track which item is being replaced (db/local)
  const [replaceTarget, setReplaceTarget] = useState<null | { source: 'db' | 'local'; dateKey: string; docId?: string }>(null);
  // View Details modal state
  const [detailsModal, setDetailsModal] = useState<null | { item: UICardItem }>(null);
  const [documentDetails, setDocumentDetails] = useState<any>(null);
  const [documentDetailsLoading, setDocumentDetailsLoading] = useState(false);
  // Inline document expansion removed per request
  // Category filter for Document Details modal - now multi-select
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  // Search box for filtering transactions within categories
  const [categorySearch, setCategorySearch] = useState<string>('');
  // Dropdown open state for category filter
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState<boolean>(false);
  // Anchor to scroll the modal content to the data tables
  const tablesStartRef = useRef<HTMLDivElement | null>(null);
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (categoryDropdownOpen && !target.closest('.category-dropdown')) {
        setCategoryDropdownOpen(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [categoryDropdownOpen]);

  // When selecting specific categories, scroll to first selected in the modal
  useEffect(() => {
    if (!detailsModal) return;
    if (selectedCategories.size === 0) return;
    const firstCategory = Array.from(selectedCategories)[0];
    const id = `cat-${slugify(firstCategory)}`;
    // Delay to ensure DOM is rendered after filter change
    const t = setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
    return () => clearTimeout(t);
  }, [selectedCategories, detailsModal]);

  // Create a ref for the replace file input
  const replaceFileInputRef = useRef<HTMLInputElement>(null);

  // Removed: application_financials state and loading

  // Bank Statement Summary data state (used for new Financial Overview)
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
  // Detect if user has uploaded or has documents present (kept for other UI) - removed unused variable

  // Removed: fetchFinancialData (application_financials)

  // Fetch summary data when application ID is available (drives new Financial Overview)
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

  // Fetch summary data when application ID changes
  useEffect(() => {
    const appId = (details.applicationId as string) || (initial?.applicationId as string) || (details.id as string) || (initial?.id as string) || '';
    if (appId) {
      fetchSummaryData(appId);
    }
  }, [details.applicationId, details.id, initial?.applicationId, initial?.id]);

  // Realtime: listen for changes on application_documents to keep Financial Overview in sync
  useEffect(() => {
    const appId = (details.applicationId as string) || (initial?.applicationId as string) || (details.id as string) || (initial?.id as string) || '';
    if (!appId) return;
    try {
      const channel = supabase
        .channel(`application_documents-${appId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'application_documents',
          filter: `application_id=eq.${appId}`,
        }, () => {
          void refetchDbDocs(appId);
        })
        .subscribe();
      return () => { try { supabase.removeChannel(channel); } catch { /* ignore */ } };
    } catch {
      return;
    }
  }, [details.applicationId, details.id, initial?.applicationId, initial?.id]);

  // Derive Financial Overview rows from application_documents (columns first, then fallback)
  const financialOverviewFromDocs = React.useMemo(() => {
    type Row = { month: string; total_deposits: number; negative_days: number };
    const map = new Map<string, { total_deposits: number; negative_days: number }>();
    const get = (obj: any, path: string): any => {
      try { return path.split('.').reduce((a: any, k: string) => (a && a[k] !== undefined ? a[k] : undefined), obj); } catch { return undefined; }
    };
    const tryPaths = (root: any, paths: string[]): number | null => {
      for (const p of paths) {
        const v = get(root, p);
        if (v !== undefined && v !== null && v !== '') {
          const n = typeof v === 'number' ? v : parseAmount(String(v));
          if (!Number.isNaN(n) && Number.isFinite(n)) return n;
        }
      }
      return null;
    };
    (dbDocs || []).forEach((d) => {
      // 1) Prefer explicit month column if present
      let month: string = String((d as any)?.month || '').trim();
      // 2) Fallback to statement_date YYYY-MM
      if (!month) {
        const monthRaw = (d as any)?.statement_date ? String((d as any).statement_date).slice(0, 7) : '';
        if (/\d{4}-\d{2}/.test(monthRaw)) month = monthRaw;
      }
      // 3) Fallback to extracted_json paths
      if (!month) {
        const ej = (d as any)?.extracted_json as any | undefined;
        if (ej) {
          const m2 = tryPaths(ej, ['month', 'summary.month', 'mca_summary.month']);
          if (typeof m2 === 'string' && /\d{4}-\d{2}/.test(m2)) month = m2;
        }
      }
      if (!month) return; // cannot place without month

      // Total deposits: prefer explicit column first
      let totalVal = (d as any)?.total_deposits;
      let total: number | null = (typeof totalVal === 'number') ? totalVal : (
        totalVal != null ? parseAmount(String(totalVal)) : null
      );
      // Fallback to extracted_json if column missing
      if (total === null) {
        const ej = (d as any)?.extracted_json as any | undefined;
        if (ej) total = tryPaths(ej, ['total_deposits', 'summary.total_deposits', 'mca_summary.total_deposits', 'totals.total_deposits']);
      }
      if (total === null || !Number.isFinite(total)) total = 0;

      // Negative days: prefer explicit column, then fall back to extracted_json
      let negVal = (d as any)?.negative_days;
      let negativeDays: number | null = (typeof negVal === 'number') ? negVal : (
        negVal != null ? parseAmount(String(negVal)) : null
      );
      if (negativeDays === null) {
        const ej = (d as any)?.extracted_json as any | undefined;
        if (ej) negativeDays = tryPaths(ej, ['negative_days', 'summary.negative_days', 'mca_summary.negative_days', 'totals.negative_days']);
      }
      if (negativeDays === null || !Number.isFinite(negativeDays)) negativeDays = 0;

      const prev = map.get(month) || { total_deposits: 0, negative_days: 0 };
      map.set(month, { total_deposits: prev.total_deposits + (total || 0), negative_days: prev.negative_days + (negativeDays || 0) });
    });
    const rows: Row[] = Array.from(map.entries()).map(([month, agg]) => ({ month, total_deposits: agg.total_deposits, negative_days: agg.negative_days }));
    rows.sort((a, b) => Date.parse(a.month + '-01') - Date.parse(b.month + '-01'));
    return rows;
  }, [dbDocs]);

  // Removed: realtime subscription to application_financials

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

  // helpers moved to SubmissionIntermediate.helpers.ts

  // Removed: valueFromFinancial (no longer needed)

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

  

  

  // helpers moved to SubmissionIntermediate.helpers.ts

  // (base64 conversion helper removed; no longer needed since we send only file_url)
  // removed legacy uploadFilesToWebhook (replaced by month-aware handlers)

  // --- Month-aware upload (keeps UI intact) ---------------------------------
  // removed detectMonthFromFilename (no longer needed for daily uploads)

  // removed unused helpers for monthly logic (detectMonthFromFilename no longer needed)

  // helpers moved to SubmissionIntermediate.helpers.ts

  // helpers moved to SubmissionIntermediate.helpers.ts

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
      // 1) Upload to Supabase Storage first and create/ensure document row via DOCUMENT_FILE_WEBHOOK_URL
      //    Capture the returned document id to pass along to new-deal and summary
      let documentId: string | undefined = undefined;
      let persistedFileUrl: string | undefined = undefined;
      try {
        const appId = (details.applicationId as string) || (initial?.applicationId as string) || (details.id as string) || (initial?.id as string) || '';
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
        if (!inFlightDocSigsRef.current.has(idempotencyKey)) {
          inFlightDocSigsRef.current.add(idempotencyKey);
        } else {
          console.log('[document-file] Skipping duplicate call for', idempotencyKey);
        }
        const respDoc = await fetchWithTimeout(DOCUMENT_FILE_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(payload),
          timeoutMs: 30000,
        });
        const ctDoc = respDoc.headers.get('content-type') || '';
        let docResp: any = undefined;
        if (ctDoc.includes('application/json')) {
          docResp = await respDoc.json().catch(() => undefined);
        } else {
          const txt = await respDoc.text();
          try { docResp = JSON.parse(txt); } catch { docResp = undefined; }
        }
        if (docResp && typeof docResp === 'object') {
          const idVal = (docResp.id || docResp.document_id || docResp.documentId);
          if (typeof idVal === 'string' && idVal) documentId = idVal;
          const urlVal = docResp.file_url;
          if (typeof urlVal === 'string' && urlVal) persistedFileUrl = urlVal;
        }
      } catch (e) {
        console.warn('[document-file] failed to persist document before new-deal:', e);
      }

      // 2) Send to NEW_DEAL_WEBHOOK_URL (extract business/financial fields), including document_id if available
      try {
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('statementDate', dateKey);
        const appIdForNewDeal = (details.applicationId as string) || (initial?.applicationId as string) || (details.id as string) || (initial?.id as string) || '';
        if (appIdForNewDeal) form.append('application_id', appIdForNewDeal);
        if (documentId) form.append('document_id', documentId);

        console.log('[newDeal webhook] Starting request', { url: NEW_DEAL_WEBHOOK_URL, fileName: file.name, dateKey, documentId });
        const resp = await fetchWithTimeout(NEW_DEAL_WEBHOOK_URL, { method: 'POST', body: form, timeoutMs: 45000 });

        if (resp.status === 202) {
          console.log('[newDeal webhook] 202 Accepted: processing in background. Skipping response parsing.');
        } else if (resp.ok) {
          const contentType = resp.headers.get('content-type') || '';
          console.log('[newDeal webhook] Response received', { status: resp.status, contentType });
          try {
            let parsed: unknown = undefined;
            if (contentType.includes('application/json')) parsed = await resp.json();
            else {
              const text = await resp.text();
              try { parsed = JSON.parse(text); } catch { parsed = undefined; }
            }
            if (parsed) {
              const isArray = Array.isArray(parsed);
              console.log('[newDeal webhook - daily] Parsed response summary:', { dateKey, isArray, arrayLength: isArray ? (parsed as unknown[]).length : undefined, topLevelKeys: !isArray && typeof parsed === 'object' ? Object.keys(parsed as Record<string, unknown>) : undefined });
            }
          } catch (e) {
            console.warn('Unable to read daily webhook response:', e);
          }
        } else {
          console.warn(`newDeal webhook responded ${resp.status} ${resp.statusText}; continuing upload flow`);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          console.warn('[newDeal webhook] Request aborted due to timeout (45s). Continuing upload flow.', { fileName: file.name, dateKey });
        } else {
          console.warn('newDeal webhook failed; continuing upload flow:', err);
        }
      }

      // 3) Call NEW_DEAL_SUMMARY_WEBHOOK_URL to derive MCA summary, including document_id if available
      try {
        const form2 = new FormData();
        form2.append('file', file, file.name);
        form2.append('statementDate', dateKey);
        const appIdForSummary = (details.applicationId as string) || (initial?.applicationId as string) || (details.id as string) || (initial?.id as string) || '';
        if (appIdForSummary) form2.append('application_id', appIdForSummary);
        if (documentId) form2.append('document_id', documentId);
        console.log('[newDealSummary webhook] Starting request', { url: NEW_DEAL_SUMMARY_WEBHOOK_URL, fileName: file.name, dateKey, documentId });
        const respS = await fetchWithTimeout(NEW_DEAL_SUMMARY_WEBHOOK_URL, { method: 'POST', body: form2, timeoutMs: 45000 });
        if (respS.status === 202) {
          console.log('[newDealSummary webhook] 202 Accepted: processing in background.');
          pendingSummaryRef.current.add(dateKey);
          void retrySummaryUntilReady(file, dateKey);
        } else if (respS.ok) {
          const ct = respS.headers.get('content-type') || '';
          let parsed: unknown = undefined;
          if (ct.includes('application/json')) parsed = await respS.json();
          else { const text = await respS.text(); try { parsed = JSON.parse(text); } catch { parsed = undefined; } }
          if (parsed) {
            console.log('[newDealSummary webhook] Parsed response received', { dateKey, keys: (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? Object.keys(parsed as Record<string, unknown>) : undefined });
            pendingSummaryRef.current.delete(dateKey);
            const t = pendingTimersRef.current.get(dateKey);
            if (typeof t === 'number') { window.clearTimeout(t); pendingTimersRef.current.delete(dateKey); }
          }
        } else {
          console.warn(`newDealSummary webhook responded ${respS.status} ${respS.statusText}`);
        }
      } catch (e) {
        console.warn('[newDealSummary webhook] failed; continuing flow:', e);
        try {
          const name = (e as any)?.name || '';
          if (name === 'AbortError') {
            pendingSummaryRef.current.add(dateKey);
            void retrySummaryUntilReady(file, dateKey);
          }
        } catch {}
      }

      // 4) Complete UI state using any persistedFileUrl
      clearInterval(progressInterval);
      const isPending = pendingSummaryRef.current.has(dateKey);
      setUploadProgress(prev => {
        const next = new Map(prev);
        next.set(dateKey, isPending ? 95 : 100);
        return next;
      });
      if (isPending) {
        setDailyStatements(prev => new Map(prev.set(dateKey, { file, status: 'uploading', fileUrl: persistedFileUrl })));
        const timerId = window.setTimeout(() => {
          pendingSummaryRef.current.delete(dateKey);
          setDailyStatements(prev => new Map(prev.set(dateKey, { file, status: 'completed', fileUrl: persistedFileUrl })));
          setUploadProgress(prev => { const next = new Map(prev); next.delete(dateKey); return next; });
        }, 60000);
        pendingTimersRef.current.set(dateKey, timerId);
      } else {
        setTimeout(() => {
          setDailyStatements(prev => new Map(prev.set(dateKey, { file, status: 'completed', fileUrl: persistedFileUrl })));
          setUploadProgress(prev => { const next = new Map(prev); next.delete(dateKey); return next; });
        }, 500);
      }
    } catch (error) {
      console.error('Daily upload failed:', error);
      clearInterval(progressInterval);
      setDailyStatements(prev => new Map(prev.set(dateKey, { file, status: 'error' })));
      setUploadProgress(prev => { const next = new Map(prev); next.delete(dateKey); return next; });
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

  // View Details handlers
  const handleViewDetailsClick = async (item: UICardItem) => {
    setDetailsModal({ item });
    setDocumentDetails(null);
    setSelectedCategories(new Set());
    setCategorySearch('');
    
    // Fetch document details from database if it's a DB item
    if (item.source === 'db' && item.docId) {
      setDocumentDetailsLoading(true);
      try {
        const { data, error } = await supabase
          .from('application_documents')
          .select('*')
          .eq('id', item.docId)
          .maybeSingle();
        
        if (error) {
          console.error('Failed to fetch document details:', error);
        } else {
          setDocumentDetails(data);
        }
      } catch (err) {
        console.error('Error fetching document details:', err);
      } finally {
        setDocumentDetailsLoading(false);
      }
    }
  };
  
  const closeDetailsModal = () => {
    setDetailsModal(null);
    setDocumentDetails(null);
  };

  const handleContinue = async (_item?: UICardItem) => {
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
      // Build a flat application-shaped payload from current details only
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
      const payload: Record<string, unknown> = {
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
      onContinue(details);
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
                          <p className="text-xs text-slate-600">Financial data analysis</p>
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
                        Processing uploaded documents… Please wait while we finish extracting details. Your analysis will be available once processing completes.
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
                                        {/* View Details Button */}
                                        <button
                                          type="button"
                                          className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-all duration-200"
                                          onClick={(e) => { e.stopPropagation(); handleViewDetailsClick(item); }}
                                          title="View details"
                                        >
                                          <FileText className="w-4 h-4" />
                                        </button>
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

                      {/* Details Modal */}
                      {detailsModal && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeDetailsModal} />
                          <div className="relative z-10 w-full max-w-6xl mx-auto bg-white rounded-2xl border border-slate-300 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
                            {/* Header */}
                            <div className="px-8 py-6 bg-gradient-to-r from-slate-50 to-blue-50 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
                              <div className="flex items-center gap-4">
                                <div className="p-3 bg-blue-600 rounded-xl shadow-lg">
                                  <FileText className="w-6 h-6 text-white" />
                                </div>
                                <div>
                                  <h4 className="text-xl font-bold text-slate-900 tracking-tight">Bank Statement Analysis</h4>
                                  <p className="text-sm text-slate-600 mt-1">Transaction Categories & Details</p>
                                </div>
                              </div>
                              <button 
                                onClick={closeDetailsModal} 
                                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-white/80 transition-all duration-200"
                              >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                            
                            {/* Content */}
                            <div className="p-8 space-y-6 overflow-y-auto flex-1 bg-slate-50/30">
                              {(() => {
                                const item = detailsModal.item;
                                return (
                                  <div className="space-y-4">
                                    {/* Loading state */}
                                    {documentDetailsLoading && (
                                      <div className="flex items-center justify-center py-8">
                                        <div className="flex items-center gap-2 text-blue-700">
                                          <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                                          <span className="text-sm">Loading document details...</span>
                                        </div>
                                      </div>
                                    )}

                                    {/* If details haven't loaded yet (and not loading), show notice */}
                                    {(!documentDetails && !documentDetailsLoading) && (
                                      <div className="mt-3 p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm flex items-start gap-3">
                                        <FileText className="w-4 h-4 mt-0.5 text-amber-700" />
                                        <div>
                                          <div className="font-semibold">Preparing Bank Statement Analysis</div>
                                          <p className="mt-0.5">Your document is being processed. The <span className="font-semibold">Transaction Categories & Details</span> will appear here shortly. Please wait for the analysis to complete.</p>
                                        </div>
                                      </div>
                                    )}

                                    {/* Monthly Categories Data */}
                                    {documentDetails && (
                                      <div>
                                        {(() => {
                                          try {
                                            // Parse categories if available; otherwise leave undefined
                                            const categoriesData = documentDetails.categories
                                              ? (typeof documentDetails.categories === 'string' 
                                                  ? JSON.parse(documentDetails.categories) 
                                                  : documentDetails.categories)
                                              : undefined;
                                            
                                            // Group data by month
                                            const monthlyData: Record<string, Record<string, any[]>> = {};
                                            
                                            // Handle different data structures
                                            if (Array.isArray(categoriesData)) {
                                              categoriesData.forEach((item: any) => {
                                                if (item && typeof item === 'object') {
                                                  const month = item.month || item.date || 'Unknown';
                                                  if (!monthlyData[month]) monthlyData[month] = {};
                                                  
                                                  // Process categories
                                                  Object.entries(item).forEach(([key, value]: [string, any]) => {
                                                    if (key !== 'month' && key !== 'date') {
                                                      if (!monthlyData[month][key]) monthlyData[month][key] = [];
                                                      
                                                      if (Array.isArray(value)) {
                                                        monthlyData[month][key].push(...value);
                                                      } else {
                                                        monthlyData[month][key].push(value);
                                                      }
                                                    }
                                                  });
                                                }
                                              });
                                            } else if (categoriesData && typeof categoriesData === 'object') {
                                              Object.entries(categoriesData).forEach(([month, monthData]: [string, any]) => {
                                                if (monthData && typeof monthData === 'object') {
                                                  monthlyData[month] = monthData;
                                                }
                                              });
                                            }
                                            
                                            // Build filter list using ONLY MAIN CATEGORIES (top-level groups)
                                            const allCategories = Object.keys(monthlyData).sort();
                                            const monthlyEmpty = allCategories.length === 0;
                                            // Build a summary of which subcategories (per main category) actually have data rows
                                            const mainCategorySummaries: Record<string, { subWithData: string[] }> = {};
                                            const normalizeTx = (tx: any): any[] => {
                                              if (!tx) return [];
                                              if (Array.isArray(tx)) return tx.flat().filter(Boolean);
                                              if (typeof tx === 'object') {
                                                const vals = Object.values(tx);
                                                return vals.reduce<any[]>((acc, v) => {
                                                  if (Array.isArray(v)) acc.push(...v);
                                                  else if (v && typeof v === 'object' && Array.isArray((v as any).transactions)) acc.push(...(v as any).transactions);
                                                  return acc;
                                                }, []).filter(Boolean);
                                              }
                                              return [];
                                            };
                                            for (const [main, cats] of Object.entries(monthlyData)) {
                                              const list: string[] = [];
                                              if (Array.isArray(cats)) {
                                                if (cats.length > 0) list.push(main);
                                              } else if (cats && typeof cats === 'object') {
                                                Object.entries(cats as Record<string, any>).forEach(([sub, data]) => {
                                                  const rows = normalizeTx(data);
                                                  if (rows.length > 0) list.push(sub);
                                                });
                                              }
                                              mainCategorySummaries[main] = { subWithData: list };
                                            }

                                            // Apply filter to monthlyData
                                            const filteredMonthlyData: Record<string, any> = {};
                                            const qGlobal = categorySearch.trim().toLowerCase();
                                            Object.entries(monthlyData).forEach(([m, cats]) => {
                                              // Helper: check if a category's name matches the search
                                              const nameMatches = (name: string) => String(name || '').toLowerCase().includes(qGlobal);
                                              // Helper: check if a category's transactions have a match
                                              const txMatches = (txs: any): boolean => {
                                                try {
                                                  const arr = Array.isArray(txs)
                                                    ? txs.flat().filter(Boolean)
                                                    : Object.values(txs || {}).flatMap((v: any) => {
                                                        if (Array.isArray(v)) return v;
                                                        if (v && typeof v === 'object' && Array.isArray((v as any).transactions)) return (v as any).transactions;
                                                        return [];
                                                      }).filter(Boolean);
                                                  return arr.some((t: any) => {
                                                    const date = String(t?.date || t?.Date || t?.transaction_date || '');
                                                    const desc = String(t?.description || t?.Description || t?.desc || t?.memo || '');
                                                    const amt = String(t?.amount || t?.Amount || t?.value || t?.amt || '');
                                                    return (date + ' ' + desc + ' ' + amt).toLowerCase().includes(qGlobal);
                                                  });
                                                } catch { return false; }
                                              };

                                              if (selectedCategories.size === 0) {
                                                // No explicit selection: if there's a query, restrict to matching categories by NAME or TRANSACTIONS
                                                if (!qGlobal) {
                                                  filteredMonthlyData[m] = cats;
                                                } else if (Array.isArray(cats)) {
                                                  // For array shape, 'm' is the category name
                                                  if (nameMatches(m) || txMatches(cats)) filteredMonthlyData[m] = cats;
                                                } else if (cats && typeof cats === 'object') {
                                                  const filtered: Record<string, any> = {};
                                                  Object.entries(cats as Record<string, any>).forEach(([catName, catData]) => {
                                                    if (nameMatches(catName) || txMatches(catData)) {
                                                      filtered[catName] = catData;
                                                    }
                                                  });
                                                  if (Object.keys(filtered).length > 0) filteredMonthlyData[m] = filtered;
                                                }
                                              } else {
                                                // With explicit selection, show ONLY the selected MAIN categories (by their top-level key)
                                                if (selectedCategories.has(m)) {
                                                  filteredMonthlyData[m] = cats;
                                                }
                                              }
                                            });

                                            // Compute if any row OR CATEGORY NAME matches current search across all (now filtered) categories
                                            const hasAnyResults = (() => {
                                              if (!qGlobal) return true; // when no query, we always show tables
                                              let found = false;
                                              for (const [key, cats] of Object.entries(filteredMonthlyData)) {
                                                if (Array.isArray(cats)) {
                                                  // key is the category name in this shape
                                                  const catNameLC = String(key).toLowerCase();
                                                  if (catNameLC.includes(qGlobal)) { found = true; break; }
                                                  for (const t of cats as any[]) {
                                                    const date = String(t?.date || t?.Date || t?.transaction_date || '');
                                                    const desc = String(t?.description || t?.Description || t?.desc || t?.memo || '');
                                                    const amt = String(t?.amount || t?.Amount || t?.value || t?.amt || '');
                                                    if ((date + ' ' + desc + ' ' + amt).toLowerCase().includes(qGlobal)) { found = true; break; }
                                                  }
                                                  if (found) break;
                                                } else if (cats && typeof cats === 'object') {
                                                  for (const [catName, txs] of Object.entries(cats as Record<string, any>)) {
                                                    // If category name matches, we have results regardless of row text
                                                    if (String(catName).toLowerCase().includes(qGlobal)) { found = true; break; }
                                                    const arr = Array.isArray(txs) ? txs : (Object.values(txs || {}) as any[]).flat();
                                                    for (const t of arr) {
                                                      const date = String(t?.date || t?.Date || t?.transaction_date || '');
                                                      const desc = String(t?.description || t?.Description || t?.desc || t?.memo || '');
                                                      const amt = String(t?.amount || t?.Amount || t?.value || t?.amt || '');
                                                      if ((date + ' ' + desc + ' ' + amt).toLowerCase().includes(qGlobal)) { found = true; break; }
                                                    }
                                                    if (found) break;
                                                  }
                                                  if (found) break;
                                                }
                                              }
                                              return found;
                                            })();

                                            // If there are no categories parsed yet, show a preparing/processing notice
                                            if (monthlyEmpty) {
                                              return (
                                                <div className="mt-3 p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm flex items-start gap-3">
                                                  <FileText className="w-4 h-4 mt-0.5 text-amber-700" />
                                                  <div>
                                                    <div className="font-semibold">Preparing Bank Statement Analysis</div>
                                                    <p className="mt-0.5">Your document is being processed. The <span className="font-semibold">Transaction Categories & Details</span> will appear here shortly. Please wait for the analysis to complete.</p>
                                                  </div>
                                                </div>
                                              );
                                            }

                                            return (
                                              <>
                                                {/* Controls Bar */}
                                                <DocumentDetailsControls
                                                  categoryDropdownOpen={categoryDropdownOpen}
                                                  onToggleDropdown={() => setCategoryDropdownOpen(!categoryDropdownOpen)}
                                                  selectedCategories={selectedCategories}
                                                  allCategories={allCategories}
                                                  mainCategorySummaries={mainCategorySummaries}
                                                  onClearAll={() => { setSelectedCategories(new Set()); setCategoryDropdownOpen(false); }}
                                                  onSelectAll={() => { setSelectedCategories(new Set(allCategories)); setCategoryDropdownOpen(false); }}
                                                  onToggleCategory={(category, checked) => {
                                                    const newSelected = new Set(selectedCategories);
                                                    if (checked) newSelected.add(category); else newSelected.delete(category);
                                                    setSelectedCategories(newSelected);
                                                    if (checked) setTimeout(() => { tablesStartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
                                                  }}
                                                  categorySearch={categorySearch}
                                                  onCategorySearchChange={setCategorySearch}
                                                  onCategorySearchEnter={() => {
                                                    const q = categorySearch.trim().toLowerCase();
                                                    if (!q) return;
                                                    setTimeout(() => { tablesStartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
                                                  }}
                                                />

                                                {/* Monthly Total Deposits Summary - independent of category filter/search */}
                                                {documentDetails && (documentDetails.total_deposits !== undefined && documentDetails.total_deposits !== null) && (
                                                  <TransactionSummarySection documentDetails={documentDetails} monthlyData={monthlyData} />
                                                )}

                                                {/* No Results State */}
                                                {!hasAnyResults && (
                                                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
                                                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                                      <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                      </svg>
                                                    </div>
                                                    <h3 className="text-lg font-semibold text-slate-900 mb-2">No transactions found</h3>
                                                    <p className="text-slate-500">Try adjusting your search criteria or category filter.</p>
                                                  </div>
                                                )}

                                                {/* Anchor for smooth scroll on Filter interaction */}
                                                <div ref={tablesStartRef} />
                                                {/* Transaction Categories */}
                                                {hasAnyResults && Object.entries(filteredMonthlyData).map(([month, categories]) => (
                                                  <div key={month || 'CATEGORIES'} className="mb-8">
                                                    {/* Main Category Header (improved UI) */}
                                                    {!Array.isArray(categories) && (() => {
                                                      // Aggregate total for this main category group
                                                      const computeGroupTotal = (cats: any): number => {
                                                        try {
                                                          let sum = 0;
                                                          Object.entries(cats as Record<string, any>).forEach(([, catData]) => {
                                                            const normalize = (tx: any): any[] => {
                                                              if (!tx) return [];
                                                              if (Array.isArray(tx)) return tx.flat().filter(Boolean);
                                                              if (typeof tx === 'object') {
                                                                const vals = Object.values(tx);
                                                                return vals.reduce<any[]>((acc, v) => {
                                                                  if (Array.isArray(v)) acc.push(...v);
                                                                  else if (v && typeof v === 'object' && Array.isArray((v as any).transactions)) acc.push(...(v as any).transactions);
                                                                  return acc;
                                                                }, []).filter(Boolean);
                                                              }
                                                              return [];
                                                            };
                                                            const rows = normalize(catData);
                                                            rows.forEach((t) => { sum += parseAmount(t?.amount ?? t?.Amount ?? t?.value ?? t?.amt); });
                                                          });
                                                          return sum;
                                                        } catch { return 0; }
                                                      };
                                                      const groupTotal = computeGroupTotal(categories);
                                                      const subcategoryCount = Object.keys(categories || {}).length || 0;

                                                      return (
                                                        <div className="flex items-center justify-between px-6 py-4 mb-4 rounded-xl shadow-md border border-slate-200 bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 text-white">
                                                          <div className="flex items-center gap-3">
                                                            <div className="w-2 h-2 rounded-full bg-emerald-400 shadow" />
                                                            <h3 className="text-sm sm:text-base md:text-lg font-extrabold tracking-wider uppercase">{month || 'Transaction Categories'}</h3>
                                                            {subcategoryCount > 0 && (
                                                              <span className="ml-2 px-2 py-0.5 text-[10px] sm:text-xs font-semibold rounded-full bg-white/10 border border-white/20">
                                                                {subcategoryCount} subcategories
                                                              </span>
                                                            )}
                                                          </div>
                                                          <div className="flex items-center gap-2">
                                                            <span className="text-[10px] sm:text-xs text-white/80 font-semibold uppercase tracking-wider">Total</span>
                                                            <span className="text-sm sm:text-base md:text-lg font-black">
                                                              {fmtCurrency2(groupTotal)}
                                                            </span>
                                                          </div>
                                                        </div>
                                                      );
                                                    })()}

                                                    {/* Category Tables */}
                                                    <div className="space-y-6">
                                                      {Array.isArray(categories) ? (
                                                        // Handle shape: { "ONLINE TRANSFERS": [ {date, amount, description}, ... ] }
                                                        (() => {
                                                          const q = categorySearch.trim().toLowerCase();
                                                          const arr = (categories as any[]);
                                                          const catName = String(month || '').toLowerCase();
                                                          // If search matches the category name, show all rows for that category
                                                          const filtered = !q || catName.includes(q) ? arr : arr.filter((transaction: any) => {
                                                            const date = String(transaction?.date || transaction?.Date || transaction?.transaction_date || '');
                                                            const desc = String(transaction?.description || transaction?.Description || transaction?.desc || transaction?.memo || '');
                                                            const amt = String(transaction?.amount || transaction?.Amount || transaction?.value || transaction?.amt || '');
                                                            return (date + ' ' + desc + ' ' + amt).toLowerCase().includes(q);
                                                          });
                                                          // Hide only if there are no matches in both name and rows
                                                          if (q && filtered.length === 0 && !catName.includes(q)) return null;

                                                          return (
                                                            <div key={month} className="bg-white rounded-xl shadow-lg border border-slate-200/60 overflow-hidden mb-8">
                                                              <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-8 py-5 relative">
                                                                <div className="absolute inset-0 bg-black/5"></div>
                                                                <div className="relative flex items-center gap-3">
                                                                  <div className="w-2 h-2 bg-white rounded-full opacity-80"></div>
                                                                  <h4 className="text-base font-bold uppercase tracking-wider">{month}</h4>
                                                                </div>
                                                              </div>
                                                              <div className="bg-gradient-to-r from-slate-50 to-slate-100/50 px-8 py-4 border-b border-slate-200/60">
                                                                <div className="grid grid-cols-12 gap-6">
                                                                  <div className="col-span-3">
                                                                    <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Date</span>
                                                                  </div>
                                                                  <div className="col-span-6">
                                                                    <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Description</span>
                                                                  </div>
                                                                  <div className="col-span-3 text-right">
                                                                    <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Amount</span>
                                                                  </div>
                                                                </div>
                                                              </div>
                                                              <div className="bg-white">
                                                                {filtered.length ? filtered.map((transaction: any, index: number) => (
                                                                  <div key={index} className="px-8 py-5 border-b border-slate-100/70 hover:bg-gradient-to-r hover:from-blue-50/30 hover:to-transparent transition-all duration-300 group">
                                                                    <div className="grid grid-cols-12 gap-6 items-center">
                                                                      <div className="col-span-3">
                                                                        <div className="flex items-center gap-3">
                                                                          <div className="w-1 h-8 bg-blue-400 rounded-full opacity-60 group-hover:opacity-100 transition-opacity duration-300"></div>
                                                                          <span className="text-sm font-semibold text-slate-900">{formatDateHuman(transaction?.date || transaction?.Date || transaction?.transaction_date || '')}</span>
                                                                        </div>
                                                                      </div>
                                                                      <div className="col-span-6">
                                                                        <span className="text-sm text-slate-700 leading-relaxed font-medium">{transaction?.description || transaction?.Description || transaction?.desc || transaction?.memo || String(transaction)}</span>
                                                                      </div>
                                                                      <div className="col-span-3 text-right">
                                                                        <div className="inline-flex items-center px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-200/60">
                                                                          <span className="text-sm font-bold text-slate-900">${Number(transaction?.amount || transaction?.Amount || transaction?.value || transaction?.amt || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                                        </div>
                                                                      </div>
                                                                    </div>
                                                                  </div>
                                                                )) : (
                                                                  <div className="px-8 py-16 text-center">
                                                                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                                                      <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                                      </svg>
                                                                    </div>
                                                                    <p className="text-slate-500 font-medium">{q ? 'No matching transactions found' : 'No transaction data available'}</p>
                                                                  </div>
                                                                )}
                                                                {filtered.length > 0 && (
                                                                  <div className="bg-gradient-to-r from-slate-100 to-slate-50 px-8 py-6 border-t-2 border-slate-200">
                                                                    <div className="grid grid-cols-12 gap-6 items-center">
                                                                      <div className="col-span-9">
                                                                        <div className="flex items-center gap-3">
                                                                          <div className="w-2 h-2 bg-slate-600 rounded-full"></div>
                                                                          <span className="text-base font-bold text-slate-700 uppercase tracking-wider">Total</span>
                                                                        </div>
                                                                      </div>
                                                                      <div className="col-span-3 text-right">
                                                                        <div className="inline-flex items-center px-4 py-2 bg-white rounded-lg border-2 border-slate-300 shadow-sm">
                                                                          <span className="text-base font-extrabold text-slate-900">
                                                                            {fmtCurrency2(filtered.reduce((acc: number, tr: any) => acc + parseAmount(tr?.amount ?? tr?.Amount ?? tr?.value ?? tr?.amt), 0))}
                                                                          </span>
                                                                        </div>
                                                                      </div>
                                                                    </div>
                                                                  </div>
                                                                )}
                                                              </div>
                                                            </div>
                                                          );
                                                        })()
                                                      ) : (
                                                        Object.entries(categories as Record<string, any>).map(([categoryName, transactions]) => (
                                                          (() => {
                                                            // Normalize and filter first; if no match during search, do not render this category at all
                                                            const normalizeTransactions = (tx: any): any[] => {
                                                              if (!tx) return [];
                                                              if (Array.isArray(tx)) return tx.flat().filter(Boolean);
                                                              if (typeof tx === 'object') {
                                                                const vals = Object.values(tx);
                                                                const merged = vals.reduce<any[]>((acc, v) => {
                                                                  if (Array.isArray(v)) acc.push(...v);
                                                                  else if (v && typeof v === 'object') {
                                                                    const maybe = (v as any).transactions;
                                                                    if (Array.isArray(maybe)) acc.push(...maybe);
                                                                  }
                                                                  return acc;
                                                                }, []);
                                                                return merged.filter(Boolean);
                                                              }
                                                              return [];
                                                            };

                                                            const rows = normalizeTransactions(transactions);
                                                            const q = categorySearch.trim().toLowerCase();
                                                            const catName = String(categoryName || '').toLowerCase();
                                                            // If search matches the category name, show all rows for that category
                                                            const filtered = !q || catName.includes(q) ? rows : rows.filter((transaction: any) => {
                                                              const date = String(transaction?.date || transaction?.Date || transaction?.transaction_date || '');
                                                              const desc = String(transaction?.description || transaction?.Description || transaction?.desc || transaction?.memo || '');
                                                              const amt = String(transaction?.amount || transaction?.Amount || transaction?.value || transaction?.amt || '');
                                                              return (date + ' ' + desc + ' ' + amt).toLowerCase().includes(q);
                                                            });
                                                            // Hide only if there are no matches in both name and rows
                                                            if (q && !filtered.length && !catName.includes(q)) return null;

                                                            return (
                                                              <div key={categoryName} className="bg-white rounded-xl shadow-lg border border-slate-200/60 overflow-hidden mb-8">
                                                                <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-8 py-5 relative">
                                                                  <div className="absolute inset-0 bg-black/5"></div>
                                                                  <div className="relative flex items-center gap-3">
                                                                    <div className="w-2 h-2 bg-white rounded-full opacity-80"></div>
                                                                    <h4 className="text-base font-bold uppercase tracking-wider">{categoryName}</h4>
                                                                  </div>
                                                                </div>
                                                                <div className="bg-gradient-to-r from-slate-50 to-slate-100/50 px-8 py-4 border-b border-slate-200/60">
                                                                  <div className="grid grid-cols-12 gap-6">
                                                                    <div className="col-span-3">
                                                                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Date</span>
                                                                    </div>
                                                                    <div className="col-span-6">
                                                                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Description</span>
                                                                    </div>
                                                                    <div className="col-span-3 text-right">
                                                                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Amount</span>
                                                                    </div>
                                                                  </div>
                                                                </div>
                                                                <div className="bg-white">
                                                                  {filtered.length ? filtered.map((transaction: any, index: number) => (
                                                                    <div key={index} className="px-8 py-5 border-b border-slate-100/70 hover:bg-gradient-to-r hover:from-blue-50/30 hover:to-transparent transition-all duration-300 group">
                                                                      <div className="grid grid-cols-12 gap-6 items-center">
                                                                        <div className="col-span-3">
                                                                          <div className="flex items-center gap-3">
                                                                            <div className="w-1 h-8 bg-blue-400 rounded-full opacity-60 group-hover:opacity-100 transition-opacity duration-300"></div>
                                                                            <span className="text-sm font-semibold text-slate-900">
                                                                              {formatDateHuman(transaction?.date || transaction?.Date || transaction?.transaction_date || '')}
                                                                            </span>
                                                                          </div>
                                                                        </div>
                                                                        <div className="col-span-6">
                                                                          <span className="text-sm text-slate-700 leading-relaxed font-medium">
                                                                            {transaction?.description || transaction?.Description || transaction?.desc || transaction?.memo || String(transaction)}
                                                                          </span>
                                                                        </div>
                                                                        <div className="col-span-3 text-right">
                                                                          <div className="inline-flex items-center px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-200/60">
                                                                            <span className="text-sm font-bold text-slate-900">
                                                                              ${Number(transaction?.amount || transaction?.Amount || transaction?.value || transaction?.amt || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                            </span>
                                                                          </div>
                                                                        </div>
                                                                      </div>
                                                                    </div>
                                                                  )) : (
                                                                    <div className="px-8 py-16 text-center">
                                                                      <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                                                        <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                                        </svg>
                                                                      </div>
                                                                      <p className="text-slate-500 font-medium">{q ? 'No matching transactions found' : 'No transaction data available'}</p>
                                                                    </div>
                                                                  )}
                                                                  {filtered.length > 0 && (
                                                                    <div className="bg-gradient-to-r from-slate-100 to-slate-50 px-8 py-6 border-t-2 border-slate-200">
                                                                      <div className="grid grid-cols-12 gap-6 items-center">
                                                                        <div className="col-span-9">
                                                                          <div className="flex items-center gap-3">
                                                                            <div className="w-2 h-2 bg-slate-600 rounded-full"></div>
                                                                            <span className="text-base font-bold text-slate-700 uppercase tracking-wider">Total</span>
                                                                          </div>
                                                                        </div>
                                                                        <div className="col-span-3 text-right">
                                                                          <div className="inline-flex items-center px-4 py-2 bg-white rounded-lg border-2 border-slate-300 shadow-sm">
                                                                            <span className="text-base font-extrabold text-slate-900">
                                                                              {fmtCurrency2(filtered.reduce((acc: number, tr: any) => acc + parseAmount(tr?.amount ?? tr?.Amount ?? tr?.value ?? tr?.amt), 0))}
                                                                            </span>
                                                                          </div>
                                                                        </div>
                                                                      </div>
                                                                    </div>
                                                                  )}
                                                                </div>
                                                              </div>
                                                            );
                                                          })()
                                                        ))
                                                      )}
                                                    </div>
                                                  </div>
                                                ))}
                                              </>
                                            );
                                          } catch (error) {
                                            console.error('Error parsing categories data:', error);
                                            return (
                                              <div className="px-4 py-8 text-center text-slate-500 italic">
                                                Unable to parse categories data
                                              </div>
                                            );
                                          }
                                        })()}
                                      </div>
                                    )}

                                    {/* Basic info for local items or when DB fetch fails */}
                                    {(!documentDetails && !documentDetailsLoading) && (
                                      <div>
                                        <div className="text-slate-700 font-semibold mb-3">Document Information</div>
                                        <div className="grid grid-cols-2 gap-3 text-sm">
                                          <div>
                                            <div className="text-slate-500">File name</div>
                                            <div className="font-medium text-slate-900">{item.file.name}</div>
                                          </div>
                                          <div>
                                            <div className="text-slate-500">Size</div>
                                            <div className="font-medium text-slate-900">{(item.file.size / 1024 / 1024).toFixed(2)} MB</div>
                                          </div>
                                          <div>
                                            <div className="text-slate-500">Status</div>
                                            <div className="font-medium text-slate-900">{item.status}</div>
                                          </div>
                                          <div>
                                            <div className="text-slate-500">Date Key</div>
                                            <div className="font-medium text-slate-900">{item.dateKey}</div>
                                          </div>
                                          <div>
                                            <div className="text-slate-500">Source</div>
                                            <div className="font-medium text-slate-900">{item.source}</div>
                                          </div>
                                          {item.docId && (
                                            <div>
                                              <div className="text-slate-500">Document ID</div>
                                              <div className="font-mono text-xs text-slate-900">{item.docId}</div>
                                            </div>
                                          )}
                                        </div>

                                        {item.fileUrl && (
                                          <div className="mt-3">
                                            <a href={item.fileUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-700 text-sm">Open file</a>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                            {/* Footer */}
                            <div className="px-8 py-6 bg-slate-50 border-t border-slate-200 flex justify-between items-center flex-shrink-0">
                              <div className="text-sm text-slate-500">
                                Bank Statement Analysis • {detailsModal.item.file.name}
                              </div>
                              <button 
                                onClick={closeDetailsModal} 
                                className="px-6 py-2.5 bg-slate-600 hover:bg-slate-700 text-white text-sm font-semibold rounded-lg transition-colors duration-200 shadow-sm"
                              >
                                Close Analysis
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Financial Overview (from application_documents). Render only when we have docs or data */}
                  {(Array.isArray(dbDocs) && dbDocs.length > 0) || (Array.isArray(financialOverviewFromDocs) && financialOverviewFromDocs.length > 0) ? (
                  <div className="mb-8">
                    <div className="px-5 py-4 mb-3 flex items-center justify-between bg-white rounded-xl border border-slate-200">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-slate-100 border border-slate-200">
                          <TrendingUp className="w-4 h-4 text-slate-700" />
                        </div>
                        <div>
                          <h4 className="text-lg font-bold text-slate-800">Financial Overview</h4>
                          <p className="text-xs text-slate-600">Summary of monthly total deposits</p>
                        </div>
                      </div>
                      {(dbDocsLoading) && (
                        <div className="flex items-center gap-2 text-blue-700 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-lg">
                          <div className="w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                          <span className="text-xs font-semibold">Updating…</span>
                        </div>
                      )}
                    </div>
                    {Array.isArray(financialOverviewFromDocs) && financialOverviewFromDocs.length > 0 ? (
                      <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="bg-slate-50 text-slate-700">
                              <th className="px-4 py-2 text-left font-semibold border-b border-slate-200">Month</th>
                              <th className="px-4 py-2 text-right font-semibold border-b border-slate-200">Total Deposits</th>
                              <th className="px-4 py-2 text-right font-semibold border-b border-slate-200">Negative Days</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...financialOverviewFromDocs]
                              .sort((a: any, b: any) => {
                                const am = typeof a.month === 'string' && /\d{4}-\d{2}/.test(a.month) ? Date.parse(a.month + '-01') : Number.POSITIVE_INFINITY;
                                const bm = typeof b.month === 'string' && /\d{4}-\d{2}/.test(b.month) ? Date.parse(b.month + '-01') : Number.POSITIVE_INFINITY;
                                return am - bm;
                              })
                              .map((row: any, idx: number) => {
                                const label = typeof row.month === 'string' && /\d{4}-\d{2}/.test(row.month)
                                  ? new Date(row.month + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                                  : (row.month || `Period ${idx + 1}`);
                                return (
                                  <tr key={row.id || idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                                    <td className="px-4 py-2 text-slate-800">{label}</td>
                                    <td className="px-4 py-2 text-right font-bold text-slate-900">{fmtCurrency2(Number(row.total_deposits) || 0)}</td>
                                    <td className="px-4 py-2 text-right font-bold text-slate-900">{Number(row.negative_days) || 0}</td>
                                  </tr>
                                );
                              })}
                          </tbody>
                          <tfoot>
                            <tr className="bg-slate-50">
                              <td className="px-4 py-2 text-right font-semibold border-t border-slate-200">Total</td>
                              <td className="px-4 py-2 text-right font-extrabold text-slate-900 border-t border-slate-200">
                                {fmtCurrency2(financialOverviewFromDocs.reduce((sum: number, r: any) => sum + (Number(r.total_deposits) || 0), 0))}
                              </td>
                              <td className="px-4 py-2 text-right font-extrabold text-slate-900 border-t border-slate-200">
                                {financialOverviewFromDocs.reduce((sum: number, r: any) => sum + (Number(r.negative_days) || 0), 0)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    ) : (
                      <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm flex items-start gap-3">
                        <FileText className="w-4 h-4 mt-0.5 text-amber-700" />
                        <div>
                          <div className="font-semibold">Preparing Financial Overview</div>
                          <p className="mt-0.5">Your document is being processed. The <span className="font-semibold">Financial Overview</span> (Monthly Total Deposits) will appear here shortly. Please wait for the analysis to complete.</p>
                        </div>
                      </div>
                    )}
                  </div>
                  ) : null}
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
                                  <AnalysisSummarySection row={row} />
                                  <FundingDetailsSection row={row} />
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
                  <UploadDropzone
                    isDragOver={isDragOver}
                    batchProcessing={batchProcessing}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onChooseFiles={addFilesToBucket}
                  />
                  {/* Local Bucket Preview and Submit All */}
                  <FilesBucketList
                    files={fileBucket}
                    bucketSubmitting={bucketSubmitting}
                    batchProcessing={batchProcessing}
                    onSubmitAll={submitAllBucketFiles}
                    onRemoveAt={removeFromBucket}
                  />
              </div>

              {/* Global Financial Details section removed; details now expand inline under a clicked completed document */}

              {/* Legal & Compliance Section */}
              <LegalComplianceSection
                hasBankruptcies={Boolean(details.hasBankruptcies)}
                hasOpenJudgments={Boolean(details.hasOpenJudgments)}
                onToggleBankruptcies={(checked) => set('hasBankruptcies', checked)}
                onToggleOpenJudgments={(checked) => set('hasOpenJudgments', checked)}
              />

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
