import React from 'react';
import { FileText, RefreshCw, Trash2, CheckCircle } from 'lucide-react';
import { insertApplicationMTD, updateApplicationMTDStatus, getApplicationMTDByApplicationId, supabase } from '../lib/supabase';

export type MTDViewProps = {
  applicationId?: string;
  businessName?: string;
  ownerName?: string;
  onChooseFiles?: (files: FileList | null) => void; // optional callback to parent if needed later
};

const MTD_WEBHOOK_URL = '/.netlify/functions/mtd-webhook';

const MTDView: React.FC<MTDViewProps> = ({ applicationId, businessName, ownerName, onChooseFiles }) => {
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
    } catch {}
    return [];
  });

  // Local cache key for instant hydration per application
  const cacheKey = React.useMemo(() => (applicationId ? `mtd_recent_${applicationId}` : undefined), [applicationId]);

  // Removed hydration effect; we initialize synchronously in useState

  // Persist to cache whenever list changes
  React.useEffect(() => {
    if (!cacheKey) return;
    try { localStorage.setItem(cacheKey, JSON.stringify(recentUploads)); } catch {}
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
          } catch {}
        })
        .subscribe();
      return () => { try { supabase.removeChannel(channel); } catch {} };
    } catch {
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
      const { deleteApplicationMTD, deleteApplicationMTDByAppAndName } = await import('../lib/supabase');
      if (id) {
        await deleteApplicationMTD(id);
      } else if (applicationId) {
        await deleteApplicationMTDByAppAndName(applicationId, docName, docSize);
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
        } catch {}
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
        } catch {}
      }
    } catch (err) {
      // Restore on failure
      if (removed) setRecentUploads(prev => [removed!, ...prev]);
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
        } catch {}

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
        } catch {}

        // 3) Optimistically mark as completed right away for instant display
        setRecentUploads(prev => prev.map(u => (
          u.name === file.name && u.size === file.size ? { ...u, status: 'completed', id: mtdRowId, url: publicUrl } : u
        )));
        if (mtdRowId) {
          try { await updateApplicationMTDStatus(mtdRowId, 'completed'); } catch {}
        }

        // Read file as base64
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = String(reader.result || '');
            resolve(result.split(',')[1] || '');
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const payload = {
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          fileData: base64,
          applicationId: applicationId || '',
          businessName: businessName || '',
          ownerName: ownerName || '',
          uploadType: 'mtd',
          // Pass through our Supabase row id so webhook can forward it as document_id
          documentId: mtdRowId || '',
          timestamp: new Date().toISOString(),
        };

        const response = await fetch(MTD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
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
          if (affectedId) { try { await updateApplicationMTDStatus(affectedId, 'failed'); } catch {} }
        }
      } catch {}
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
                    <button className="p-2 rounded-lg hover:bg-slate-100" title="View details" onClick={() => { if (u.url) window.open(u.url, '_blank'); }}>
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
      
    </div>
  );
};

export default MTDView;
