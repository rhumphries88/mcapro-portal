import React from 'react';
import { FileText, RefreshCw, Trash2, CheckCircle } from 'lucide-react';
import { insertApplicationMTD, updateApplicationMTDStatus, getApplicationMTDByApplicationId, getApplicationMTDAnalysisById, updateApplicationMTDTotalMTD, updateApplicationMTDTotalAmount, updateApplicationMTDMtdSelected, supabase } from '../lib/supabase';
import { fmtCurrency2, formatDateHuman } from './SubmissionIntermediate.helpers';

export type MTDViewProps = {
  applicationId?: string;
  businessName?: string;
  ownerName?: string;
  onChooseFiles?: (files: FileList | null) => void; // optional callback to parent if needed later
};

// Define interfaces for MTD data types
interface TransactionRow {
  date?: string;
  description?: string;
  type?: string;
  amount?: number;
  balance?: number;
}

interface CategorySection {
  category: string;
  rows: TransactionRow[];
}

interface FunderRow extends TransactionRow {
  funder?: string;
  frequency?: string;
  notes?: string;
  originalAmount?: number;
  [key: string]: unknown;
}

interface MTDSummary {
  [category: string]: TransactionRow[] | { transactions?: TransactionRow[] };
}

interface ModalState {
  id: string;
  name: string;
  loading: boolean;
  mtd_summary?: MTDSummary;
  total_amount?: number | null;
  available_balance?: number | null;
  negative?: number | null;
  funder_mtd?: FunderRow[] | null;
  total_mtd?: number | null;
  mtd_selected?: FunderRow[] | null;
}

const _env = (import.meta as unknown as { env?: { VITE_MTD_WEBHOOK?: string } }).env;
const MTD_WEBHOOK_URL = _env?.VITE_MTD_WEBHOOK ?? 'https://primary-production-c8d0.up.railway.app/webhook/mtd';

const MTDView: React.FC<MTDViewProps> = ({ applicationId, businessName, ownerName, onChooseFiles }) => {
  // Local helper to render dates in a long, human-friendly form (e.g., 24 September 2025)
  const formatDateLong = React.useCallback((dateStr: string | undefined | null) => {
    try {
      const d = new Date(String(dateStr || '').replace(/\//g, '-'));
      if (isNaN(d.getTime())) return String(dateStr || '');
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    } catch {
      return String(dateStr || '');
    }
  }, []);
  // Keep wired to parent without rendering it
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [recentUploads, setRecentUploads] = React.useState<Array<{
    id?: string;
    name: string;
    size: number;
    status: 'processing' | 'completed' | 'error';
    url?: string;
  }>>(() => {
    // Synchronous initial state from cache to avoid any flash
    const key = applicationId ? `mtd_recent_${applicationId}` : undefined;
    if (!key) return [];
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Silently handle errors in localStorage operations
    }
    return [];
  });

  // Modal state for viewing analysis (pulled only from application_mtd.mtd_summary & total_amount)
  const [detailsModal, setDetailsModal] = React.useState<null | ModalState>(null);

  // Track which transaction rows are selected (unchecked by default)
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(() => new Set());
  React.useEffect(() => {
    // Reset selections when opening/closing or switching document
    setSelectedKeys(new Set());
  }, [detailsModal?.id]);

  // Saving state for Funder MTD total
  const [savingFunderTotal, setSavingFunderTotal] = React.useState(false);
  // Saving state for Transactions total
  const [savingTxnTotal, setSavingTxnTotal] = React.useState(false);

  // Mini success popup state
  const [saveSuccess, setSaveSuccess] = React.useState<{ open: boolean; message: string }>({ open: false, message: '' });
  const showSuccess = React.useCallback((message: string) => {
    setSaveSuccess({ open: true, message });
    window.setTimeout(() => setSaveSuccess({ open: false, message: '' }), 2000);
  }, []);

  // Tab state inside the Analysis modal
  const [activeTab, setActiveTab] = React.useState<'transactions' | 'funder'>('transactions');


  const openDetails = async (row: { id?: string; name: string }) => {
    if (!row?.id) return;
    setDetailsModal({ id: row.id, name: row.name, loading: true });
    setActiveTab('transactions');
    try {
      const data = await getApplicationMTDAnalysisById(row.id);
      setDetailsModal({
        id: row.id,
        name: row.name,
        loading: false,
        mtd_summary: data?.mtd_summary as MTDSummary | undefined,
        total_amount: data?.total_amount ?? null,
        available_balance: data?.available_balance ?? null,
        negative: data?.negative ?? null,
        funder_mtd: data?.funder_mtd as FunderRow[] | null | undefined,
        total_mtd: data?.total_mtd ?? null,
        // transient field kept in modal state for hydration of selections
        // Supabase returns parsed JSON already for jsonb columns
        mtd_selected: data?.mtd_selected as FunderRow[] | null | undefined,
      });
    } catch (e) {
      console.warn('Failed to load MTD analysis:', e);
      setDetailsModal({ id: row.id, name: row.name, loading: false });
    }
  };

  const closeDetails = () => setDetailsModal(null);

  // Save selected rows total into application_mtd.total_mtd
  const handleSaveFunderSelected = async () => {
    if (!detailsModal?.id) return;
    try {
      setSavingFunderTotal(true);
      // Recalculate selected total for Funder MTD
      const total = normalizedFunder.reduce((s, r) => {
        const key = `FUNDER_MTD|${String(r.date || '')}|${String(r.description || '')}|${String(r.funder || '')}|${String(r.type || '')}|${Number(r.amount || 0)}|${String(r.frequency || '')}|${String(r.notes || '')}`;
        // Always use the divided amount (which is already calculated for weekly payments)
        // For non-weekly payments, amount is the same as originalAmount
        return s + (selectedKeys.has(key) ? (Number(r?.amount) || 0) : 0);
      }, 0);
      await updateApplicationMTDTotalMTD(detailsModal.id, total);
      setDetailsModal((prev) => prev ? { ...prev, total_mtd: total } : prev);
      showSuccess('Funder MTD selection saved');
    } finally {
      setSavingFunderTotal(false);
    }
  };

  // Normalize MTD summary to: Array<{ category: string; rows: { date?: string; description?: string; amount?: number }[] }>
  const normalizedSummary = React.useMemo(() => {
    const src = detailsModal?.mtd_summary as MTDSummary | undefined;
    if (!src) return [] as CategorySection[];

    const toNum = (v: number | string | null | undefined): number => {
      const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };

    // Safely pick the first defined value for any of the provided keys from a loosely-typed object
    const pick = (obj: unknown, keys: string[]): unknown => {
      if (obj && typeof obj === 'object') {
        for (const k of keys) {
          const v = (obj as Record<string, unknown>)[k];
          if (v !== undefined && v !== null) return v;
        }
      }
      return undefined;
    };

    const pushRow = (map: Map<string, TransactionRow[]>, cat: string, r: unknown) => {
      const date = pick(r, ['date','Date','transaction_date','posted_at','txn_date']);
      const description = pick(r, ['description','Description','memo','details','desc']);
      const amount = toNum(pick(r, ['amount','Amount','value','amt','debit_amount','credit_amount','daily_amount']) as string | number | null | undefined);
      const rawType = pick(r, ['type','Type','txn_type','transaction_type','debit_credit','status']);
      // Derive type if missing
      const type = String((rawType ?? (amount < 0 ? 'DEBIT' : 'CREDIT'))).toUpperCase();
      const balance = toNum(pick(r, ['balance','Balance','running_balance','current_balance','ending_balance','available_balance']) as string | number | null | undefined);
      const arr = map.get(cat) || [];
      arr.push({ date: String(date || ''), description: String(description || ''), type, amount, balance: Number.isFinite(balance) ? balance : undefined });
      map.set(cat, arr);
    };

    const groups = new Map<string, TransactionRow[]>();

    // Case 1: Object with category keys -> array of tx
    if (src && typeof src === 'object' && !Array.isArray(src)) {
      Object.entries(src).forEach(([k, v]) => {
        if (Array.isArray(v)) {
          v.forEach((it) => pushRow(groups, k, it));
        } else if (v && typeof v === 'object') {
          // nested object possibly has transactions array
          const arr = (v as { transactions?: TransactionRow[] }).transactions;
          if (Array.isArray(arr)) arr.forEach((it) => pushRow(groups, k, it));
        }
      });
    }

    // Case 2: Array of items with category/name and transactions
    if (Array.isArray(src)) {
      src.forEach((item) => {
        const cat = item?.category || item?.name || item?.main || 'Transactions';
        const tx = Array.isArray(item?.transactions) ? item.transactions : (Array.isArray(item) ? item : []);
        if (Array.isArray(tx) && tx.length) {
          const parentDate = item?.date || item?.Date || '';
          tx.forEach((it) => pushRow(groups, cat, { ...it, date: (it?.date ?? parentDate) }));
        } else if (item?.date || item?.amount || item?.description) {
          pushRow(groups, cat, item);
        }
      });
    }

    const normalized = Array.from(groups.entries()).map(([category, rows]) => ({
      category,
      rows: (rows || []),
    }));
    // Return all categories as-is so we show everything present in mtd_summary
    return normalized;
  }, [detailsModal?.mtd_summary]);

  // Build a canonical list of selection keys for Transactions and Funder tables
  const allTxnKeys = React.useMemo(() => {
    const keys: string[] = [];
    normalizedSummary.forEach((section) => {
      section.rows.forEach((r) => {
        const key = `${section.category}|${String(r.date || '')}|${String(r.description || '')}|${String(r.type || '')}|${Number(r.amount || 0)}`;
        keys.push(key);
      });
    });
    return keys;
  }, [normalizedSummary]);

  // Select-all state and handlers for Transactions
  const allTxnSelected = allTxnKeys.length > 0 && allTxnKeys.every(k => selectedKeys.has(k));
  const someTxnSelected = allTxnKeys.some(k => selectedKeys.has(k)) && !allTxnSelected;
  const txnSelectAllRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (txnSelectAllRef.current) txnSelectAllRef.current.indeterminate = someTxnSelected;
  }, [someTxnSelected, allTxnSelected]);
  const toggleAllTxn = React.useCallback(() => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allTxnSelected) {
        allTxnKeys.forEach(k => next.delete(k));
      } else {
        allTxnKeys.forEach(k => next.add(k));
      }
      return next;
    });
  }, [allTxnSelected, allTxnKeys]);


  // Compute selected total across ALL transactions (all categories)
  const computeTransactionsSelectedTotal = React.useCallback(() => {
    let total = 0;
    normalizedSummary.forEach((section) => {
      section.rows.forEach((r) => {
        const key = `${section.category}|${String(r.date || '')}|${String(r.description || '')}|${String(r.type || '')}|${Number(r.amount || 0)}`;
        if (selectedKeys.has(key)) total += (Number(r?.amount) || 0);
      });
    });
    return total;
  }, [normalizedSummary, selectedKeys]);

  // Save selected transactions total into application_mtd.total_amount
  const handleSaveTransactionsSelected = async () => {
    if (!detailsModal?.id) return;
    try {
      setSavingTxnTotal(true);
      const total = computeTransactionsSelectedTotal();
      await updateApplicationMTDTotalAmount(detailsModal.id, total);
      setDetailsModal((prev) => prev ? { ...prev, total_amount: total } : prev);
      showSuccess('Transactions selection saved');
    } finally {
      setSavingTxnTotal(false);
    }
  };

  // Normalize Funder MTD JSON array to same row shape so we can render a table
  const normalizedFunder = React.useMemo(() => {
    const src = detailsModal?.funder_mtd as FunderRow[] | null | undefined;
    const toNum = (v: unknown): number => {
      const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };
    const rows: FunderRow[] = [];
    if (Array.isArray(src)) {
      src.forEach((r: Record<string, unknown>) => {
        const date = r?.date || r?.Date || '';
        const description = r?.description || r?.Description || '';
        // Get the original amount
        let amount = toNum(r?.amount ?? r?.Amount);
        const type = String(r?.status || r?.Type || (amount < 0 ? 'DEBIT' : 'CREDIT')).toUpperCase();
        const balance = toNum(r?.available_balance ?? r?.balance ?? r?.Balance);
        const funder = String(r?.FUNDER || r?.funder || r?.Funder || '').trim();
        // Handle both uppercase and lowercase field names for frequency and notes
        const frequency = String(r?.FREQUENCY || r?.frequency || r?.Frequency || '').trim();
        const notes = String(r?.NOTES || r?.notes || r?.Notes || '').trim();
        
        // Divide amount by 5 if frequency is Weekly
        const originalAmount = amount;
        if (frequency.toLowerCase() === 'weekly') {
          amount = amount / 5;
        }
        
        rows.push({ 
          date: String(date || ''), 
          description: String(description || ''), 
          type, 
          amount, 
          originalAmount, // Keep the original amount for reference
          balance: Number.isFinite(balance) ? balance : undefined, 
          funder,
          frequency,
          notes
        });
      });
    }
    return rows;
  }, [detailsModal?.funder_mtd]);

  // Build payload rows for persistence given a Set of keys
  const buildFunderSelectedPayload = React.useCallback((keys: Set<string>) => {
    const rows = normalizedFunder.filter((r) => {
      const k = `FUNDER_MTD|${String(r.date || '')}|${String(r.description || '')}|${String(r.funder || '')}|${String(r.type || '')}|${Number(r.amount || 0)}|${String(r.frequency || '')}|${String(r.notes || '')}`;
      return keys.has(k);
    }).map((r) => ({
      date: String(r.date || ''),
      type: String(r.type || '').toLowerCase(),
      FUNDER: String(r.funder || ''),
      // Use the divided amount for weekly payments in mtd_selected
      amount: (Number(r.amount || 0)).toFixed(2),
      balance: (typeof r.balance === 'number' && isFinite(Number(r.balance))) ? (Number(r.balance)).toFixed(2) : 'NaN',
      description: String(r.description || ''),
      FREQUENCY: String(r.frequency || ''),
      NOTES: String(r.notes || ''),
    }));
    return rows;
  }, [normalizedFunder]);

  // Hydrate checkboxes from previously saved mtd_selected
  React.useEffect(() => {
    const sel = detailsModal?.mtd_selected;
    if (!sel || !Array.isArray(sel) || !normalizedFunder.length) return;
    const next = new Set<string>();
    normalizedFunder.forEach((r) => {
      // Find matching row from saved mtd_selected
      // For weekly payments, the amount in mtd_selected will be the divided amount
      const match = sel.find((s: Record<string, unknown>) => {
        const savedAmount = Number(s?.amount || 0);
        const currentAmount = Number(r.amount || 0);
        
        return String(s?.date || '') === String(r.date || '') &&
          String(s?.description || '') === String(r.description || '') &&
          String((s?.FUNDER || s?.funder) || '') === String(r.funder || '') &&
          String(s?.type || '').toLowerCase() === String(r.type || '').toLowerCase() &&
          Math.abs(savedAmount - currentAmount) < 0.01 && // Use approximate comparison for floating point
          String((s?.FREQUENCY || s?.frequency) || '') === String(r.frequency || '') &&
          String((s?.NOTES || s?.notes) || '') === String(r.notes || '');
      });
      if (match) {
        const k = `FUNDER_MTD|${String(r.date || '')}|${String(r.description || '')}|${String(r.funder || '')}|${String(r.type || '')}|${Number(r.amount || 0)}|${String(r.frequency || '')}|${String(r.notes || '')}`;
        next.add(k);
      }
    });
    if (next.size) setSelectedKeys(next);
  }, [normalizedFunder, (detailsModal)?.mtd_selected, detailsModal?.id]);

  // Funder MTD Select-All logic (placed after normalizedFunder to avoid TS ordering error)
  const allFunderKeys = React.useMemo(() => {
    return normalizedFunder.map((r) => `FUNDER_MTD|${String(r.date || '')}|${String(r.description || '')}|${String(r.funder || '')}|${String(r.type || '')}|${Number(r.amount || 0)}|${String(r.frequency || '')}|${String(r.notes || '')}`);
  }, [normalizedFunder]);

  const allFunderSelected = allFunderKeys.length > 0 && allFunderKeys.every(k => selectedKeys.has(k));
  const someFunderSelected = allFunderKeys.some(k => selectedKeys.has(k)) && !allFunderSelected;
  const funderSelectAllRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (funderSelectAllRef.current) funderSelectAllRef.current.indeterminate = someFunderSelected;
  }, [someFunderSelected, allFunderSelected]);
  const toggleAllFunder = React.useCallback(() => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allFunderSelected) {
        allFunderKeys.forEach(k => next.delete(k));
      } else {
        allFunderKeys.forEach(k => next.add(k));
      }
      // Persist selection to DB (mtd_selected)
      if (detailsModal?.id) {
        const payload = buildFunderSelectedPayload(next);
        void updateApplicationMTDMtdSelected(detailsModal.id, payload).catch(() => {});
      }
      return next;
    });
  }, [allFunderSelected, allFunderKeys, detailsModal?.id, buildFunderSelectedPayload]);

  // removed unused funderTotal (card now uses persisted total_mtd)


  // Local cache key for instant hydration per application
  const cacheKey = React.useMemo(() => (applicationId ? `mtd_recent_${applicationId}` : undefined), [applicationId]);
  
  // Analysis readiness: show content only when all key fields are present
  const analysisReady = React.useMemo(() => {
    const ms = detailsModal?.mtd_summary as MTDSummary | undefined;
    const hasSummary = !!ms && (Array.isArray(ms) ? ms.length > 0 : Object.keys(ms).length > 0);
    const hasAvail = typeof detailsModal?.available_balance === 'number';
    const hasNeg = typeof detailsModal?.negative === 'number';
    const hasFunder = Array.isArray(detailsModal?.funder_mtd);
    return hasSummary && hasAvail && hasNeg && hasFunder;
  }, [detailsModal]);

  // Removed hydration effect; we initialize synchronously in useState

  // Persist to cache whenever list changes
  React.useEffect(() => {
    if (!cacheKey) return;
    try { 
      localStorage.setItem(cacheKey, JSON.stringify(recentUploads)); 
    } catch {
      // Silently handle localStorage errors (e.g., quota exceeded)
    }
  }, [cacheKey, recentUploads]);

  // Load persisted uploads from Supabase so they survive refresh/tab switch
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (!applicationId) return;
        const rows = await getApplicationMTDByApplicationId(applicationId);
        if (cancelled) return;
        setRecentUploads(rows.map(r => ({
          id: r.id,
          name: r.file_name,
          size: Number(r.file_size || 0),
          status: (r.upload_status === 'failed' ? 'error' : (r.upload_status === 'completed' ? 'completed' : 'processing')),
          url: r.file_url || undefined,
        })));
      } catch {
        // ignore
      }
    };
    load();
    return () => { cancelled = true; };
  }, [applicationId]);

  // Realtime subscription to keep the list in sync
  React.useEffect(() => {
    if (!applicationId) return;
    try {
      const channel = supabase
        .channel(`application_mtd-${applicationId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'application_mtd',
          filter: `application_id=eq.${applicationId}`,
        }, async () => {
          try {
            const rows = await getApplicationMTDByApplicationId(applicationId);
            setRecentUploads(rows.map(r => ({
              id: r.id,
              name: r.file_name,
              size: Number(r.file_size || 0),
              status: (r.upload_status === 'failed' ? 'error' : (r.upload_status === 'completed' ? 'completed' : 'processing')),
              url: r.file_url || undefined,
            })));
          } catch {
            // Silently handle errors when fetching application MTD data
          }
        })
        .subscribe();
      return () => { try { supabase.removeChannel(channel); } catch { /* Ignore channel removal errors */ } };
    } catch {
      // Silently handle errors in channel setup
      return;
    }
  }, [applicationId]);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isDragOver) setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer?.files || null;
    handleFileUpload(files);
  };
  const handleDelete = async (docName: string, docSize: number) => {
    // Optimistic UI remove
    let removed: typeof recentUploads[number] | undefined;
    setRecentUploads(prev => {
      const idx = prev.findIndex(u => u.name === docName && u.size === docSize);
      if (idx >= 0) removed = prev[idx];
      const next = prev.filter((_, i) => i !== idx);
      return next;
    });
    try {
      // Delete DB row
      const id = removed?.id;
      const { deleteApplicationMTD, resolveAndDeleteApplicationMTD } = await import('../lib/supabase');
      if (id) {
        await deleteApplicationMTD(id);
      } else if (applicationId) {
        // If size is 0 (often from null in DB), avoid filtering by size to ensure match
        const sizeArg = (typeof docSize === 'number' && docSize > 0) ? docSize : undefined;
        await resolveAndDeleteApplicationMTD(applicationId, docName, sizeArg);
      }
      // Force refetch to ensure sync with DB
      if (applicationId) {
        try {
          const rows = await getApplicationMTDByApplicationId(applicationId);
          setRecentUploads(rows.map(r => ({
            id: r.id,
            name: r.file_name,
            size: Number(r.file_size || 0),
            status: (r.upload_status === 'failed' ? 'error' : (r.upload_status === 'completed' ? 'completed' : 'processing')),
            url: r.file_url || undefined,
          })));
        } catch {
          // Silently handle errors when fetching application MTD data after deletion
        }
      }
      // Delete storage object if we can infer the path from public URL
      if (removed?.url) {
        try {
          const url = new URL(removed.url);
          // public URL format typically ends with /storage/v1/object/public/<bucket>/<path>
          const marker = '/object/public/';
          const i = url.pathname.indexOf(marker);
          if (i !== -1) {
            const rel = url.pathname.substring(i + marker.length); // <bucket>/<path>
            const firstSlash = rel.indexOf('/');
            const bucket = rel.substring(0, firstSlash);
            const objectPath = rel.substring(firstSlash + 1);
            await supabase.storage.from(bucket).remove([objectPath]);
          }
        } catch {
          // Silently handle storage deletion errors
        }
      }
    } catch (err) {
      // Restore on failure and surface the error for visibility
      if (removed) setRecentUploads(prev => [removed!, ...prev]);
      console.error('Failed to delete MTD document:', err);
      try {
        const message = err instanceof Error ? err.message : String(err);
        alert(`Failed to delete MTD document. ${message}`);
      } catch { void 0 }
    }
  };
  const openFilePicker = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };
  const handleChoose = (files: FileList | null) => {
    handleFileUpload(files);
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    setUploading(true);
    setErrorMsg(null);
    try {
      for (const file of Array.from(files)) {
        if (file.type !== 'application/pdf') continue;
        if (file.size > 10 * 1024 * 1024) continue; // keep under 10MB

        // Track locally first (optimistic)
        setRecentUploads(prev => ([...prev, { name: file.name, size: file.size, status: 'processing' }]));

        // 1) Upload to Supabase Storage to get a public URL (best-effort)
        let publicUrl: string | undefined = undefined;
        try {
          const storagePath = `mtd/${Date.now()}-${file.name}`;
          const { error: upErr } = await supabase.storage.from('application_documents').upload(storagePath, file, { upsert: true });
          if (!upErr) {
            const { data: pub } = supabase.storage.from('application_documents').getPublicUrl(storagePath);
            publicUrl = pub?.publicUrl;
          }
        } catch {
          // Silently handle storage URL retrieval errors
        }

        // 2) Insert row into application_mtd (if we have applicationId)
        let mtdRowId: string | undefined;
        try {
          if (applicationId) {
            const row = await insertApplicationMTD({
              application_id: applicationId,
              file_name: file.name,
              file_size: file.size,
              file_type: file.type,
              statement_date: new Date().toISOString().slice(0, 10),
              file_url: publicUrl,
              upload_status: 'processing',
            });
            mtdRowId = row.id;
          }
        } catch {
          // Silently handle errors when inserting application MTD record
        }

        // 3) Optimistically mark as completed right away for instant display
        setRecentUploads(prev => prev.map(u => (
          u.name === file.name && u.size === file.size ? { ...u, status: 'completed', id: mtdRowId, url: publicUrl } : u
        )));
        if (mtdRowId) {
          try { 
            await updateApplicationMTDStatus(mtdRowId, 'completed'); 
          } catch {
            // Silently handle errors when updating MTD status
          }
        }

        // Build multipart/form-data with raw binary file and metadata
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('statementDate', new Date().toISOString().slice(0, 10));
        if (applicationId) form.append('application_id', applicationId);
        if (mtdRowId) form.append('document_id', mtdRowId);
        if (businessName) form.append('business_name', businessName);
        if (ownerName) form.append('owner_name', ownerName);
        form.append('uploadType', 'mtd');
        if (publicUrl) form.append('file_url', publicUrl);
        form.append('timestamp', new Date().toISOString());

        const response = await fetch(MTD_WEBHOOK_URL, {
          method: 'POST',
          body: form,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(`Upload failed (${response.status}): ${response.statusText} ${text?.slice(0,200)}`);
        }

        // Fire webhook in background (do not block UI)
        void response.json().then(res => {
          console.log('MTD webhook success:', res);
        }).catch(() => {});
      }

      // Also call parent callback if provided
      if (onChooseFiles) onChooseFiles(files);
      
    } catch (error) {
      console.error('MTD upload error:', error);
      setErrorMsg('Upload failed or server unavailable. Please try again.');
      // Mark last item as error if present and reflect in DB
      try {
        const last = Array.from(files || []).pop();
        if (last) {
          let affectedId: string | undefined = undefined;
          setRecentUploads(prev => prev.map(u => {
            const match = (u.name === last.name && u.size === last.size);
            if (match) affectedId = u.id;
            return match ? { ...u, status: 'error' } : u;
          }));
          if (affectedId) { 
            try { 
              await updateApplicationMTDStatus(affectedId, 'failed'); 
            } catch {
              // Silently handle errors when updating MTD status to failed
            } 
          }
        }
      } catch {
        // Silently handle errors in error handling logic
      }
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="mb-8">
      <div className="mb-8 bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl shadow-lg">
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3v10l-3.5-2M21 21H3m9-4a8 8 0 100-16 8 8 0 000 16z" />
              </svg>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-slate-800">Month-To-Date (MTD)</h3>
              <p className="text-slate-600">Real-time MTD insights and actions</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            System Ready
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50">
            <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-slate-800">Live Metrics</p>
              <p className="text-xs text-slate-600">Deposits, expenses, net MTD</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50">
            <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-slate-800">Fast Processing</p>
              <p className="text-xs text-slate-600">AI-powered analysis</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50">
            <div className="p-2 rounded-lg bg-fuchsia-100 text-fuchsia-700">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 12h2m-1-9a9 9 0 100 18 9 9 0 000-18zm0 13a4 4 0 110-8 4 4 0 010 8z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-slate-800">Smart Insights</p>
              <p className="text-xs text-slate-600">Trends and quick stats</p>
            </div>
          </div>
        </div>
      </div>

      {/* Uploaded Files Table (MTD) */}
      {recentUploads.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6 p-4 bg-gradient-to-r from-white to-slate-50 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg shadow-sm">
                <FileText className="w-4 h-4 text-white" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-slate-800">
                  {recentUploads.length} {recentUploads.length === 1 ? 'Document' : 'Documents'} Uploaded
                </h4>
                <p className="text-sm text-slate-600">Ready for processing and analysis</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-lg border border-emerald-200">
              <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
              <span className="text-sm font-medium text-emerald-700">All Systems Active</span>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 uppercase tracking-wide">
              <div className="col-span-6">Document</div>
              <div className="col-span-3">Status</div>
              <div className="col-span-2">Size</div>
              <div className="col-span-1 text-right">Actions</div>
            </div>
            <div>
              {recentUploads.map((u) => (
                <div key={`${u.name}-${u.size}`} className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-slate-100 last:border-b-0 items-center">
                  <div className="col-span-6">
                    <div className="flex items-center gap-3">
                      <div className={`flex items-center justify-center w-12 h-12 rounded-xl shadow-sm border bg-gradient-to-br from-emerald-100 to-green-100 border-emerald-200`}>
                        <FileText className="w-6 h-6 text-emerald-700" />
                      </div>
                      
                      <div>
                        <div className="text-sm font-semibold text-slate-900 truncate max-w-[460px]" title={u.name}>{u.name}</div>
                        <div className="text-xs text-slate-500">PDF Document</div>
                        <div className="mt-1 flex items-center gap-3">
                          <a href={u.url || '#'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-xs font-medium text-blue-700 hover:text-blue-800">
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
                            View Document
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="col-span-3">
                    {u.status === 'processing' && (
                      <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-50 text-blue-800 border border-blue-200">
                        <span className="w-3 h-3 mr-1 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                        Processing
                      </span>
                    )}
                    {u.status === 'completed' && (
                      <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Completed
                      </span>
                    )}
                    {u.status === 'error' && (
                      <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-50 text-rose-800 border border-rose-200">
                        <span className="w-3 h-3 mr-1">⚠</span>
                        Error
                      </span>
                    )}
                  </div>
                  <div className="col-span-2">
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-700">
                      <svg className="w-3 h-3 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {(u.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>
                  <div className="col-span-1 flex justify-end gap-3 text-slate-500">
                    <button className="p-2 rounded-lg hover:bg-slate-100" title="View details" onClick={() => openDetails({ id: u.id!, name: u.name })}>
                      <FileText className="w-4 h-4" />
                    </button>
                    <button className="p-2 rounded-lg hover:bg-slate-100" title="Refresh">
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button className="p-2 rounded-lg hover:bg-slate-100" title="Delete" onClick={() => handleDelete(u.name, u.size)}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MTD Upload Dropzone (separate from Monthly UI) */}
      <div
        className={`relative p-10 border-2 border-dashed rounded-3xl text-center transition-all duration-300 ${
          isDragOver
            ? 'border-blue-400 bg-gradient-to-br from-blue-50 to-indigo-50 shadow-xl scale-[1.01]'
            : 'border-blue-300/60 bg-gradient-to-br from-white via-slate-50 to-blue-50/30 hover:border-blue-400 hover:bg-blue-50/40'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="relative">
          <div className="p-4 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-2xl w-fit mx-auto mb-6 shadow-sm">
            <svg className="w-8 h-8 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h10a4 4 0 004-4m-7-4l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">Upload Bank Statements</h3>
          <p className="text-sm text-gray-600 mb-8 max-w-md mx-auto leading-relaxed">
            Drag & drop PDF files here or click to browse.
          </p>
          <button
            type="button"
            onClick={openFilePicker}
            disabled={uploading}
            className={`inline-flex items-center gap-3 px-8 py-4 rounded-2xl font-bold transition-all duration-200 shadow-md focus:outline-none focus:ring-4 focus:ring-blue-500/40 ${
              uploading
                ? 'bg-gray-400 text-white cursor-not-allowed'
                : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 hover:shadow-lg hover:scale-[1.02]'
            }`}
          >
            {uploading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h10a4 4 0 004-4m-7-4l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Choose Files
              </>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            accept=".pdf"
            multiple
            onChange={(e) => handleChoose(e.target.files)}
          />
          <p className="text-xs text-gray-500 mt-4 font-medium">PDF files only, max 10MB each</p>
          {errorMsg && (
            <p className="text-xs mt-3 font-semibold text-rose-600">{errorMsg}</p>
          )}
        </div>
      </div>
      
      {/* Analysis Modal (Bank Statement Analysis style) */}
      {detailsModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={closeDetails} aria-hidden />
          <div role="dialog" aria-modal="true" className="relative bg-white rounded-3xl shadow-2xl border border-slate-200/60 w-full max-w-5xl overflow-hidden">
            {/* Header */}
            <div className="px-8 py-6 bg-gradient-to-r from-slate-50 via-white to-blue-50/30 border-b border-slate-200/60">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-slate-900 tracking-tight">Bank Statement Analysis</h4>
                    <p className="text-sm text-slate-600">Transaction Categories & Details</p>
                    <div className="text-xs text-slate-500 mt-1 truncate max-w-[48ch]">{detailsModal.name}</div>
                  </div>
                </div>
                <button onClick={closeDetails} className="px-3 py-1.5 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-100 border border-slate-200">Close</button>
              </div>
            </div>

            {/* Body */}
            <div className="p-8 space-y-6 max-h-[75vh] overflow-y-auto">
              {detailsModal.loading ? (
                <div className="p-6 border border-amber-200 bg-amber-50 rounded-xl text-amber-800 flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
                  <div>
                    <div className="font-semibold">Preparing Bank Statement Analysis</div>
                    <p className="text-sm">Please wait while we load the Month-To-Date analysis.</p>
                  </div>
                </div>
              ) : (!analysisReady ? (
                <div className="p-6 border border-amber-200 bg-amber-50 rounded-xl text-amber-800 flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
                  <div>
                    <div className="font-semibold">Preparing MTD Metrics</div>
                    <p className="text-sm">Waiting for summary, available balance, negative count, and funder MTD to be available…</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Summary Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-200 rounded-xl p-6">
                      <div className="text-emerald-700 text-sm font-semibold">Total Amount</div>
                      <div className="text-2xl font-bold text-emerald-900 mt-1">
                        {typeof detailsModal?.total_amount === 'number'
                          ? `$${detailsModal.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : '—'}
                      </div>
                    </div>
                    <div className="bg-gradient-to-br from-cyan-50 to-teal-50 border-2 border-cyan-200 rounded-xl p-6">
                      <div className="text-cyan-700 text-sm font-semibold">Available Balance</div>
                      <div className="text-2xl font-bold text-cyan-900 mt-1">
                        {typeof detailsModal?.available_balance === 'number' ? detailsModal.available_balance.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </div>
                    </div>
                    <div className="bg-gradient-to-br from-rose-50 to-red-50 border-2 border-rose-200 rounded-xl p-6">
                      <div className="text-rose-700 text-sm font-semibold">Negative Count</div>
                      <div className="text-2xl font-bold text-rose-900 mt-1">
                        {typeof detailsModal?.negative === 'number'
                          ? detailsModal.negative.toLocaleString('en-US')
                          : '—'}
                      </div>
                    </div>
                    <div className="bg-gradient-to-br from-violet-50 to-fuchsia-50 border-2 border-violet-200 rounded-xl p-6">
                      <div className="text-violet-700 text-sm font-semibold">Funder MTD</div>
                      <div className="text-2xl font-bold text-violet-900 mt-1">
                        {typeof detailsModal?.total_mtd === 'number'
                          ? detailsModal.total_mtd.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : '—'}
                      </div>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('transactions')}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold border transition ${activeTab === 'transactions' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
                    >
                      Transactions
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('funder')}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold border transition ${activeTab === 'funder' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
                    >
                      Funder MTD
                    </button>
                  </div>

                  {/* MTD Summary - formatted like categories/transactions */}
                  {activeTab === 'transactions' && (
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    {normalizedSummary.length === 0 ? (
                      <div className="p-10 text-center text-slate-500 text-sm">No transaction data available</div>
                    ) : (
                      <div className="p-0">
                        {normalizedSummary.map((section, idx) => {
                          return (
                            <div key={`${section.category}-${idx}`} className="mb-6 last:mb-0">
                              {/* Category header */}
                              <div className="px-6 py-3 bg-blue-600 text-white font-bold uppercase tracking-wide flex items-center gap-3">
                                <span className="w-2 h-2 rounded-full bg-white/90" />
                                {String(section.category || 'Category').toUpperCase()}
                              </div>
                              {/* Column headers with Select before Date (1+1+5+1+2+2 = 12) */}
                              <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 grid grid-cols-12 gap-x-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                                <div className="col-span-1">
                                  <div className="flex items-center gap-1">
                                    <input
                                      ref={txnSelectAllRef}
                                      type="checkbox"
                                      checked={allTxnSelected}
                                      onChange={toggleAllTxn}
                                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                      title="Select all transactions"
                                    />
                                    <span>Select</span>
                                  </div>
                                </div>
                                <div className="col-span-1">Date</div>
                                <div className="col-span-5">Description</div>
                                <div className="col-span-1">Type</div>
                                <div className="col-span-2 text-center">Amount</div>
                                <div className="col-span-2 text-right">Balance</div>
                              </div>
                              {/* Rows grouped by date (date printed once, multiple entries separated with dotted rule) */}
                              <div className="">
                                {section.rows.length === 0 ? (
                                  <div className="px-6 py-6 text-sm text-slate-500">No transactions</div>
                                ) : (
                                  (() => {
                                    const groups = new Map<string, TransactionRow[]>();
                                    section.rows.forEach((row) => {
                                      const key = formatDateLong(row.date);
                                      const arr = groups.get(key) || [];
                                      arr.push(row);
                                      groups.set(key, arr);
                                    });
                                    return Array.from(groups.entries()).map(([d, rows], gi) => (
                                      <div key={`${d}-${gi}`} className="px-4">
                                        {rows.map((r, ri) => {
                                          const key = `${section.category}|${String(r.date || '')}|${String(r.description || '')}|${String(r.type || '')}|${Number(r.amount || 0)}`;
                                          const checked = selectedKeys.has(key);
                                          const commonRowClasses = `${ri > 0 ? 'border-t border-dotted border-slate-300 pt-3' : ''}`;
                                          return (
                                            <div key={ri} className="py-3 grid grid-cols-12 items-start gap-x-3">
                                              {/* Select */}
                                              <div className={`col-span-1 ${commonRowClasses}`}>
                                                <input
                                                  type="checkbox"
                                                  checked={checked}
                                                  onChange={() => {
                                                    setSelectedKeys((prev) => {
                                                      const next = new Set(prev);
                                                      if (next.has(key)) next.delete(key); else next.add(key);
                                                      return next;
                                                    });
                                                  }}
                                                  className="w-4 h-4 cursor-pointer accent-blue-600"
                                                />
                                              </div>
                                              {/* Date */}
                                              {ri === 0 ? (
                                                <div className="col-span-1 text-slate-700 text-xs font-semibold">{d}</div>
                                              ) : (
                                                <div className="col-span-1" />
                                              )}
                                              {/* Description */}
                                              <div className={`col-span-5 text-slate-700 text-xs leading-relaxed pr-2 whitespace-pre-wrap break-words ${commonRowClasses}`}>{r.description || '—'}</div>
                                              {/* Type */}
                                              <div className={`col-span-1 text-slate-700 text-xs font-semibold tracking-wide whitespace-pre-wrap break-words ${commonRowClasses}`}>{String(r.type || '').toUpperCase() || '—'}</div>
                                              {/* Amount */}
                                              <div className={`col-span-2 text-center font-bold text-slate-900 tabular-nums font-mono text-[12px] whitespace-nowrap ${commonRowClasses}`}>{fmtCurrency2(Number(r.amount || 0))}</div>
                                              {/* Balance */}
                                              <div className={`col-span-2 text-right font-semibold text-slate-900 tabular-nums font-mono text-[12px] whitespace-nowrap ${commonRowClasses}`}>{typeof r.balance === 'number' ? fmtCurrency2(Number(r.balance)) : (r.balance ? String(r.balance) : '—')}</div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ));
                                  })()
                                )}
                              </div>
                              {/* Total footer aligned to Amount column, summing only checked rows */}
                              {(() => {
                                const selectedTotal = section.rows.reduce((s, r) => {
                                  const key = `${section.category}|${String(r.date || '')}|${String(r.description || '')}|${String(r.type || '')}|${Number(r.amount || 0)}`;
                                  return s + (selectedKeys.has(key) ? (Number(r?.amount) || 0) : 0);
                                }, 0);
                                return (
                                  <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 grid grid-cols-12 gap-x-6 items-center">
                                    {/* Left side spanning Select+Date+Description+Type (1+1+5+1=8) */}
                                    <div className="col-span-8 text-slate-600 font-semibold uppercase text-xs">Total</div>
                                    {/* Amount column (col-span-2) */}
                                    <div className="col-span-2 text-center text-slate-900 font-black">{fmtCurrency2(selectedTotal)}</div>
                                    {/* Save Selection button (saves global selected total across all categories) */}
                                    <div className="col-span-2 flex justify-end">
                                      <button
                                        type="button"
                                        onClick={handleSaveTransactionsSelected}
                                        disabled={savingTxnTotal}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${savingTxnTotal ? 'bg-slate-200 text-slate-500 border-slate-300 cursor-not-allowed' : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'}`}
                                      >
                                        {savingTxnTotal ? 'Saving…' : 'Save Selection'}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  )}

                  {/* Funder MTD - same layout as transactions */}
                  {activeTab === 'funder' && (
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="px-6 py-3 bg-blue-600 text-white font-bold uppercase tracking-wide flex items-center gap-3">
                      <span className="w-2 h-2 rounded-full bg-white/90" />
                      FUNDER MTD
                    </div>
                    <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 grid grid-cols-12 gap-x-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                      <div className="col-span-1">
                        <div className="flex items-center gap-1">
                          <input
                            ref={funderSelectAllRef}
                            type="checkbox"
                            checked={allFunderSelected}
                            onChange={toggleAllFunder}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                            title="Select all funder rows"
                          />
                          <span>Select</span>
                        </div>
                      </div>
                      <div className="col-span-1">Date</div>
                      <div className="col-span-2">Description</div>
                      <div className="col-span-2">Funder</div>
                      <div className="col-span-1">Type</div>
                      <div className="col-span-1">Frequency</div>
                      <div className="col-span-2">Notes</div>
                      <div className="col-span-1 text-center">Amount</div>
                      <div className="col-span-1 text-right">Balance</div>
                    </div>
                    {normalizedFunder.length === 0 ? (
                      <div className="p-10 text-center text-slate-500 text-sm">No Funder MTD entries</div>
                    ) : (
                      (() => {
                        const groups = new Map<string, FunderRow[]>();
                        normalizedFunder.forEach((row) => {
                          const key = formatDateHuman(row.date || '');
                          const arr = groups.get(key) || [];
                          arr.push(row);
                          groups.set(key, arr);
                        });
                        return (
                          <div className="">
                            {Array.from(groups.entries()).map(([d, rows], gi) => (
                              <div key={`${d}-${gi}`} className="px-4">
                                {rows.map((r, ri) => {
                                  const key = `FUNDER_MTD|${String(r.date || '')}|${String(r.description || '')}|${String(r.funder || '')}|${String(r.type || '')}|${Number(r.amount || 0)}|${String(r.frequency || '')}|${String(r.notes || '')}`;
                                  const checked = selectedKeys.has(key);
                                  const commonRowClasses = `${ri > 0 ? 'border-t border-dotted border-slate-300 pt-3' : ''}`;
                                  return (
                                    <div key={ri} className="py-3 grid grid-cols-12 items-start gap-x-3">
                                      <div className={`col-span-1 ${commonRowClasses}`}>
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() => {
                                            setSelectedKeys((prev) => {
                                              const next = new Set(prev);
                                              if (next.has(key)) next.delete(key); else next.add(key);
                                              // Persist immediately on toggle
                                              if (detailsModal?.id) {
                                                const payload = buildFunderSelectedPayload(next);
                                                void updateApplicationMTDMtdSelected(detailsModal.id, payload).catch(() => {});
                                              }
                                              return next;
                                            });
                                          }}
                                          className="w-4 h-4 cursor-pointer accent-blue-600"
                                        />
                                      </div>
                                      {ri === 0 ? (
                                        <div className="col-span-1 text-slate-700 text-xs font-semibold">{d}</div>
                                      ) : (
                                        <div className="col-span-1" />
                                      )}
                                      <div className={`col-span-2 text-slate-700 text-xs leading-relaxed pr-2 whitespace-pre-wrap break-words ${commonRowClasses}`}>{r.description || '—'}</div>
                                      <div className={`col-span-2 text-slate-700 text-xs font-semibold tracking-wide whitespace-pre-wrap break-words ${commonRowClasses}`}>{r.funder || '—'}</div>
                                      <div className={`col-span-1 text-slate-700 text-xs font-semibold tracking-wide whitespace-pre-wrap break-words ${commonRowClasses}`}>{String(r.type || '').toUpperCase() || '—'}</div>
                                      <div className={`col-span-1 text-slate-700 text-xs font-semibold tracking-wide whitespace-pre-wrap break-words ${commonRowClasses}`}>{r.frequency || '—'}</div>
                                      <div className={`col-span-2 text-slate-700 text-xs leading-relaxed pr-2 whitespace-pre-wrap break-words ${commonRowClasses}`}>{r.notes || '—'}</div>
                                      <div className={`col-span-1 text-center font-bold text-slate-900 tabular-nums font-mono text-[12px] whitespace-nowrap ${commonRowClasses}`}>
                                        {r.frequency?.toLowerCase() === 'weekly' ? (
                                          <div className="flex flex-col">
                                            <span className="text-[10px] text-slate-500">{fmtCurrency2(Number(r.originalAmount || 0))}</span>
                                            <span className="text-[10px]">=</span>
                                            <span>{fmtCurrency2(Number(r.amount || 0))}</span>
                                          </div>
                                        ) : (
                                          fmtCurrency2(Number(r.amount || 0))
                                        )}
                                      </div>
                                      <div className={`col-span-1 text-right font-semibold text-slate-900 tabular-nums font-mono text-[12px] whitespace-nowrap ${commonRowClasses}`}>{typeof r.balance === 'number' ? fmtCurrency2(Number(r.balance)) : (r.balance ? String(r.balance) : '—')}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        );
                      })()
                    )}
                    {(() => {
                      const selectedTotal = normalizedFunder.reduce((s, r) => {
                        const key = `FUNDER_MTD|${String(r.date || '')}|${String(r.description || '')}|${String(r.funder || '')}|${String(r.type || '')}|${Number(r.amount || 0)}|${String(r.frequency || '')}|${String(r.notes || '')}`;
                        // Always use the divided amount (which is already calculated for weekly payments)
                        // For non-weekly payments, amount is the same as originalAmount
                        return s + (selectedKeys.has(key) ? (Number(r?.amount) || 0) : 0);
                      }, 0);
                      return (
                        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 grid grid-cols-12 gap-x-6 items-center">
                          <div className="col-span-8 text-slate-600 font-semibold uppercase text-xs">Total</div>
                          <div className="col-span-2 text-center text-slate-900 font-black">{fmtCurrency2(selectedTotal)}</div>
                          <div className="col-span-2 flex justify-end">
                            <button
                              type="button"
                              onClick={handleSaveFunderSelected}
                              disabled={savingFunderTotal}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${savingFunderTotal ? 'bg-slate-200 text-slate-500 border-slate-300 cursor-not-allowed' : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'}`}
                            >
                              {savingFunderTotal ? 'Saving…' : 'Save Selection'}
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  )}

                </>
              ))}
            </div>

            {/* Mini success popup */}
            {saveSuccess.open && (
              <div className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center">
                <div className="pointer-events-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl shadow-lg border border-emerald-200 bg-white text-emerald-700 text-sm font-semibold">
                  <CheckCircle className="w-4 h-4" />
                  <span>{saveSuccess.message}</span>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="px-8 py-6 bg-slate-50 border-t border-slate-200 flex justify-between items-center">
              <div className="text-xs font-semibold text-slate-600 uppercase tracking-widest">BANK STATEMENT ANALYSIS • CONFIDENTIAL</div>
              <button onClick={closeDetails} className="px-6 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-lg">Close Analysis</button>
            </div>
          </div>
        </div>
      )}
      
    </div>
  );
};

export default MTDView;
