import React, { useRef, useState, useCallback } from 'react';
import { Search, Eye, Download, DollarSign, Building2, Star, CheckCircle, XCircle, Clock, AlertTriangle, FileText, MoreVertical, Users } from 'lucide-react';
import { supabase, getAllApplications, getApplicationDocuments, getApplicationMTDByApplicationId, getUsersByRole, getApplicationAccessMapByApp, setApplicationAccess, deleteApplicationDocument, resolveAndDeleteApplicationMTD, insertApplicationMTD, updateApplication, getLenderSubmissions, getApplicationsForMember, getLenderNotes, addLenderNote, updateLenderNote, deleteLenderNote, getApplicationAdditionalByApplicationId, type ApplicationAdditionalRow, Application as DBApplication, LenderSubmission as DBLenderSubmission, LenderNote as DBLenderNote, User as DBUser } from '../lib/supabase';
import { useAuth } from '../App';

// Use database types
type Deal = DBApplication & {
  matchedLenders: number;
  lenderSubmissions: (DBLenderSubmission & { lender: { name: string } })[];
  user?: { full_name: string; email: string };
};

// Unified file entry types for Documents + MTD
type DocFile = {
  kind: 'doc';
  id: string;
  file_name: string;
  file_size?: number;
  file_type?: string;
  upload_date?: string;
  file_url?: string;
};
type MtdFile = {
  kind: 'mtd';
  id: string;
  file_name: string;
  file_size?: number;
  file_type?: string;
  upload_date?: string;
  file_url?: string;
  statement_date?: string;
};
type AdditionalFile = {
  kind: 'additional';
  id: string;
  file_name: string;
  file_size?: number;
  file_type?: string;
  upload_date?: string;
  file_url?: string;
};
type UnifiedFile = DocFile | MtdFile | AdditionalFile;

type AllDealsPortalProps = {
  onEditDeal?: (params: { applicationId: string; lockedLenderIds: string[] }) => void;
  onViewQualifiedLenders?: (params: { applicationId: string; lockedLenderIds: string[] }) => void;
};

const AllDealsPortal: React.FC<AllDealsPortalProps> = ({ onEditDeal, onViewQualifiedLenders }) => {
  const { user } = useAuth(); // Get the current logged-in user
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [docsLoading, setDocsLoading] = useState(false);
  const [documents, setDocuments] = useState<Array<{ id: string; file_name: string; file_size?: number; file_type?: string; upload_date?: string; file_url?: string }>>([]);
  const [mtdDocuments, setMtdDocuments] = useState<Array<{ id: string; file_name: string; file_size?: number; file_type?: string; upload_date?: string; file_url?: string; statement_date?: string }>>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docDragOver, setDocDragOver] = useState(false);
  const docInputRef = useRef<HTMLInputElement | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: 'doc'; data: { id: string; file_url?: string; file_name: string } }
    | { kind: 'mtd'; data: { id: string; file_url?: string; file_name: string; file_size?: number } }
    | null
  >(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [additionalDocuments, setAdditionalDocuments] = useState<Array<{ id: string; file_name: string; file_size?: number; file_type?: string; upload_date?: string; file_url?: string }>>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [openActionId, setOpenActionId] = useState<string | null>(null);
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessUsers, setAccessUsers] = useState<DBUser[]>([]);
  const [accessByUser, setAccessByUser] = useState<{[userId: string]: boolean}>({});
  const [accessApp, setAccessApp] = useState<Deal | null>(null);
  const [accessSearch, setAccessSearch] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [editingDetails, setEditingDetails] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [businessForm, setBusinessForm] = useState({
    business_name: '',
    industry: '',
    years_in_business: 0,
    monthly_revenue: 0,
    credit_score: 0,
  });

  // Lightweight toast notifications
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const pushToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 2500);
  };
  const [contactForm, setContactForm] = useState({
    owner_name: '',
    email: '',
    phone: '',
    address: '',
  });

  const [notesLoading, setNotesLoading] = useState(false);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [lenderNotes, setLenderNotes] = useState<DBLenderNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  React.useEffect(() => {
    if (selectedDeal) {
      setBusinessForm({
        business_name: selectedDeal.business_name || '',
        industry: selectedDeal.industry || '',
        years_in_business: Number(selectedDeal.years_in_business) || 0,
        monthly_revenue: Number(selectedDeal.monthly_revenue) || 0,
        credit_score: Number(selectedDeal.credit_score) || 0,
      });
      setContactForm({
        owner_name: selectedDeal.owner_name || '',
        email: selectedDeal.email || '',
        phone: selectedDeal.phone || '',
        address: selectedDeal.address || '',
      });
    }
  }, [selectedDeal]);

  // Removed per-section save handlers; unified handler below covers both sections

  const handleStartEditDetails = () => {
    setEditingDetails(true);
  };

  const handleCancelDetails = () => {
    // reset forms to selectedDeal values
    if (selectedDeal) {
      setBusinessForm({
        business_name: selectedDeal.business_name || '',
        industry: selectedDeal.industry || '',
        years_in_business: Number(selectedDeal.years_in_business) || 0,
        monthly_revenue: Number(selectedDeal.monthly_revenue) || 0,
        credit_score: Number(selectedDeal.credit_score) || 0,
      });
      setContactForm({
        owner_name: selectedDeal.owner_name || '',
        email: selectedDeal.email || '',
        phone: selectedDeal.phone || '',
        address: selectedDeal.address || '',
      });
    }
    setEditingDetails(false);
  };

  const handleSaveDetails = async () => {
    if (!selectedDeal) return;
    setSavingDetails(true);
    try {
      const payload: Partial<DBApplication> = {
        // business
        business_name: businessForm.business_name,
        industry: businessForm.industry,
        years_in_business: Number(businessForm.years_in_business) || 0,
        monthly_revenue: Number(businessForm.monthly_revenue) || 0,
        credit_score: Number(businessForm.credit_score) || 0,
        // contact
        owner_name: contactForm.owner_name,
        email: contactForm.email,
        phone: contactForm.phone,
        address: contactForm.address,
      };
      // Debug log for payload and id
      console.log('Saving application details', { id: selectedDeal.id, payload });

      // Detect no-op updates to avoid unnecessary calls
      const noChange =
        (payload.business_name ?? '') === (selectedDeal.business_name ?? '') &&
        (payload.industry ?? '') === (selectedDeal.industry ?? '') &&
        Number(payload.years_in_business ?? 0) === Number(selectedDeal.years_in_business ?? 0) &&
        Number(payload.monthly_revenue ?? 0) === Number(selectedDeal.monthly_revenue ?? 0) &&
        Number(payload.credit_score ?? 0) === Number(selectedDeal.credit_score ?? 0) &&
        (payload.owner_name ?? '') === (selectedDeal.owner_name ?? '') &&
        (payload.email ?? '') === (selectedDeal.email ?? '') &&
        (payload.phone ?? '') === (selectedDeal.phone ?? '') &&
        (payload.address ?? '') === (selectedDeal.address ?? '');
      if (noChange) {
        pushToast('No changes to save', 'info');
        setEditingDetails(false);
        return;
      }

      const updated = await updateApplication(selectedDeal.id, payload as Partial<DBApplication>);
      setSelectedDeal(prev => prev ? { ...prev, ...updated } as Deal : prev);
      setDeals(ds => ds.map(d => d.id === selectedDeal.id ? ({ ...d, ...updated } as Deal) : d));
      setEditingDetails(false);
      pushToast('Saved changes successfully', 'success');
    } catch (e) {
      console.error('Failed to save details', e);
      pushToast('Failed to save details', 'error');
    } finally {
      setSavingDetails(false);
    }
  };

  // Close the menu when clicking anywhere outside of the dropdown container
  React.useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!openActionId) return;
      const target = e.target as Element | null;
      if (target && !target.closest('[data-dropdown="actions"]')) {
        setOpenActionId(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [openActionId]);

  // Utility to refresh docs for selected deal
  const reloadDocs = useCallback(async () => {
    if (!selectedDeal) return;
    setDocsLoading(true);
    try {
      const [rows, mtdRows, addRows] = await Promise.all([
        getApplicationDocuments(selectedDeal.id),
        getApplicationMTDByApplicationId(selectedDeal.id),
        getApplicationAdditionalByApplicationId(selectedDeal.id)
      ]);
      setDocuments(rows.map(r => ({ id: r.id, file_name: r.file_name, file_size: r.file_size, file_type: r.file_type, upload_date: r.upload_date, file_url: r.file_url })));
      setMtdDocuments((mtdRows || []).map(r => ({ id: r.id, file_name: r.file_name, file_size: r.file_size, file_type: r.file_type, upload_date: r.upload_date, file_url: r.file_url, statement_date: r.statement_date })));
      setAdditionalDocuments(((addRows || []) as ApplicationAdditionalRow[]).map(r => ({ id: String(r.id || crypto.randomUUID()), file_name: r.file_name, file_size: r.file_size || undefined, file_type: r.file_type || undefined, upload_date: r.created_at || undefined, file_url: r.file_url || undefined })));
    } catch (e) {
      console.error('Failed to reload documents', e);
    } finally {
      setDocsLoading(false);
    }
  }, [selectedDeal]);

  // Upload helpers
  const processDocFiles = async (files: FileList | File[]) => {
    if (!files || !selectedDeal) return;
    setUploadingDoc(true);
    try {
      for (const file of Array.from(files)) {
        const isMtd = /mtd/i.test(file.name);
        const storagePath = isMtd ? `mtd/${selectedDeal.id}/${Date.now()}-${file.name}` : `docs/${selectedDeal.id}/${Date.now()}-${file.name}`;
        const up = await supabase.storage.from('application_documents').upload(storagePath, file, { upsert: true });
        if (up.error) throw up.error;
        const { data: pub } = supabase.storage.from('application_documents').getPublicUrl(storagePath);
        const publicUrl = pub?.publicUrl;
        if (isMtd) {
          await insertApplicationMTD({
            application_id: selectedDeal.id,
            file_name: file.name,
            file_size: file.size,
            file_type: file.type,
            file_url: publicUrl,
            upload_status: 'completed',
          });
        } else {
          const ins = await supabase
            .from('application_documents')
            .insert([
              {
                application_id: selectedDeal.id,
                file_name: file.name,
                file_size: file.size,
                file_type: file.type,
                upload_date: new Date().toISOString(),
                file_url: publicUrl ?? null,
              },
            ])
            .select();
          if (ins.error) throw ins.error;
        }
      }
      await reloadDocs();
    } catch (err) {
      console.error('Document upload failed', err);
      alert('Failed to upload document(s).');
    } finally {
      setUploadingDoc(false);
      if (docInputRef.current) docInputRef.current.value = '';
    }
  };

  const handleDocFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await processDocFiles(e.target.files as FileList);
  };

  const confirmDeleteNow = async () => {
    if (!deleteTarget) return;
    const t = deleteTarget;
    setShowDeleteConfirm(false);
    setDeleteTarget(null);
    if (t.kind === 'doc') {
      await handleDeleteDoc(t.data);
    } else {
      await handleDeleteMtd(t.data);
    }
  };

  // Delete handlers
  const handleDeleteDoc = async (doc: { id: string; file_url?: string; file_name: string }) => {
    if (!selectedDeal) return;
    // optimistic
    const prev = documents;
    setDocuments(d => d.filter(x => x.id !== doc.id));
    try {
      // try storage removal
      if (doc.file_url) {
        try {
          const marker = '/object/public/';
          const idx = doc.file_url.indexOf(marker);
          if (idx !== -1) {
            const rel = doc.file_url.substring(idx + marker.length); // bucket/path
            const firstSlash = rel.indexOf('/');
            const bucket = rel.substring(0, firstSlash);
            const objectPath = rel.substring(firstSlash + 1);
            await supabase.storage.from(bucket).remove([objectPath]);
          }
        } catch (err) { void err; }
      }
      await deleteApplicationDocument(doc.id);
    } catch (e) {
      console.error('Delete document failed', e);
      setDocuments(prev);
      alert('Failed to delete document.');
    }
  };

  const handleDeleteMtd = async (doc: { id: string; file_url?: string; file_name: string; file_size?: number }) => {
    if (!selectedDeal) return;
    const prev = mtdDocuments;
    setMtdDocuments(d => d.filter(x => x.id !== doc.id));
    try {
      if (doc.file_url) {
        try {
          const marker = '/object/public/';
          const idx = doc.file_url.indexOf(marker);
          if (idx !== -1) {
            const rel = doc.file_url.substring(idx + marker.length);
            const firstSlash = rel.indexOf('/');
            const bucket = rel.substring(0, firstSlash);
            const objectPath = rel.substring(firstSlash + 1);
            await supabase.storage.from(bucket).remove([objectPath]);
          }
        } catch (err) { void err; }
      }
      await resolveAndDeleteApplicationMTD(selectedDeal.id, doc.file_name, doc.file_size);
    } catch (e) {
      console.error('Delete MTD failed', e);
      setMtdDocuments(prev);
      alert('Failed to delete MTD file.');
    }
  };

  // Realtime: sync documents and MTD while modal open
  React.useEffect(() => {
    if (!showDocs || !selectedDeal?.id) return;
    const channel = supabase.channel(`docs-mtd-${selectedDeal.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'application_documents', filter: `application_id=eq.${selectedDeal.id}` }, () => { reloadDocs(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'application_mtd', filter: `application_id=eq.${selectedDeal.id}` }, () => { reloadDocs(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'application_additional', filter: `application_id=eq.${selectedDeal.id}` }, () => { reloadDocs(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [showDocs, selectedDeal?.id, reloadDocs]);

  // Tab state for View Details modal
  const [activeTab, setActiveTab] = useState<'information' | 'notes'>('information');
  const [showAddNoteForm, setShowAddNoteForm] = useState(false);

  // Selection helpers for bulk add
  const toggleSelectUser = (id: string) => {
    setSelectedUserIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Handle application status update for members
  const handleUpdateApplicationStatus = async (applicationId: string, newStatus: string) => {
    try {
      await updateApplication(applicationId, { status: newStatus });
      pushToast('Status updated successfully', 'success');
    } catch (error) {
      console.error('Error updating status:', error);
      pushToast('Failed to update status', 'error');
      // Revert the UI change on error - reload the deals to get original status
      setReloadToken(prev => prev + 1);
    }
  };

  const handleBulkAddUsers = async () => {
    if (!accessApp || selectedUserIds.size === 0) return;
    const ids = Array.from(selectedUserIds).filter(id => !accessByUser[id]);
    if (ids.length === 0) return;

    // Optimistic UI: grant immediately and clear UI BEFORE network
    const prevAccess = { ...accessByUser };
    setAccessByUser(prev => {
      const copy = { ...prev };
      ids.forEach(id => { copy[id] = true; });
      return copy;
    });
    setSelectedUserIds(new Set());
    setAccessSearch('');

    // Fire-and-forget network call; rollback on failure
    Promise.all(ids.map(id => setApplicationAccess(id, accessApp.id, true)))
      .then(() => {
        try {
          localStorage.setItem('mca-permissions-updated', String(Date.now()));
          window.dispatchEvent(new Event('mca-permissions-updated'));
        } catch (err) { void err; }
      })
      .catch(e => {
        console.error('Bulk add failed', e);
        setAccessByUser(prev => {
          const copy = { ...prev };
          ids.forEach(id => { copy[id] = prevAccess[id] || false; });
          return copy;
        });
        alert('Failed to add selected users');
      });
  };

  const handleRevoke = async (id: string) => {
    if (!accessApp) return;
    const prev = !!accessByUser[id];
    setAccessByUser(p => ({ ...p, [id]: false }));
    try {
      await setApplicationAccess(id, accessApp.id, false);
      try {
        localStorage.setItem('mca-permissions-updated', String(Date.now()));
        window.dispatchEvent(new Event('mca-permissions-updated'));
      } catch (err) { void err; }
    } catch (e) {
      console.error('Revoke failed', e);
      setAccessByUser(p => ({ ...p, [id]: prev }));
      alert('Failed to revoke access');
    }
  };

  // Open Manage Access modal and load users + current access map
  const handleManageAccess = async (deal: Deal) => {
    if (!user) return;
    setAccessApp(deal);
    setShowAccessModal(true);
    setAccessLoading(true);
    try {
      const [admins, members, map] = await Promise.all([
        getUsersByRole('admin'),
        getUsersByRole('member'),
        getApplicationAccessMapByApp(deal.id)
      ]);
      const merged = [...admins, ...members].filter(u => u.id !== user.id);
      setAccessUsers(merged);
      setAccessByUser(map || {});
      setSelectedUserIds(new Set());
      setAccessSearch('');
    } catch (e) {
      console.error('Failed to load access data', e);
      setAccessUsers([]);
      setAccessByUser({});
    } finally {
      setAccessLoading(false);
    }
  };

  // (toggleUserAccess removed; using search + bulk add + revoke UI now)


  // Load applications from Supabase - all applications for admin, user-specific for members
  React.useEffect(() => {
    const loadApplications = async () => {
      if (!user?.id) {
        console.log('No user ID available, skipping application load');
        return;
      }

      setDealsLoading(true);
      try {
        // Do not block UI; load immediately and enrich in background
        
        // Check if user is admin
        const isAdmin = user.role === 'admin' || user.role === 'Admin';
        
        let dbApplications;
        if (isAdmin) {
          console.log('Loading all applications for admin user:', user.id);
          // Admin users see all applications
          dbApplications = await getAllApplications();
          console.log('Found all applications:', dbApplications.length);
        } else {
          console.log('Loading applications for member user ID:', user.id);
          // Members: load own applications plus those granted via application_access
          dbApplications = await getApplicationsForMember(user.id);
          console.log('Found applications visible to member (own + access):', dbApplications.length);
        }
        // Show applications immediately with placeholder submission info
        setDeals(
          dbApplications.map((app: DBApplication) => ({
            ...(app as Deal),
            matchedLenders: 0,
            lenderSubmissions: []
          }))
        );

        // Enrich with lender_submissions in background (non-blocking)
        try {
          const subs = await Promise.allSettled(
            dbApplications.map(async (app: DBApplication) => {
              const rows = await getLenderSubmissions(app.id);
              return { appId: app.id, rows: (rows || []) as (DBLenderSubmission & { lender: { name: string } })[] };
            })
          );
          const byId: Record<string, (DBLenderSubmission & { lender: { name: string } })[]> = {};
          for (const r of subs) {
            if (r.status === 'fulfilled') {
              byId[r.value.appId] = r.value.rows;
            }
          }
          setDeals(prev => prev.map(d => ({
            ...d,
            lenderSubmissions: byId[d.id] || [],
            matchedLenders: (byId[d.id] || []).length,
          })) as Deal[]);
        } catch (e) {
          console.warn('Failed to enrich lender submissions:', e);
        }
      } catch (error) {
        console.error('Error loading applications:', error);
      } finally {
        setDealsLoading(false);
      }
    };
    loadApplications();
  }, [user?.id, user?.role, reloadToken]);

  // Listen for permissions updates from AdminPortal and reload automatically
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'mca-permissions-updated') {
        setReloadToken((x) => x + 1);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const getLenderStatusColor = (status: string) => {
    switch (status) {
      case 'funded':
        return 'bg-green-100 text-green-800';
      case 'approved':
        return 'bg-blue-100 text-blue-800';
      case 'counter-offer':
        return 'bg-yellow-100 text-yellow-800';
      case 'pending':
        return 'bg-gray-100 text-gray-800';
      case 'declined':
      case 'rejected':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getLenderStatusText = (status: string) => {
    switch (status) {
      case 'rejected':
        return 'declined';
      default:
        return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'funded':
        return 'bg-blue-100 text-blue-800';
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'ready-to-submit':
        return 'bg-yellow-100 text-yellow-800';
      case 'sent-to-lenders':
        return 'bg-indigo-100 text-indigo-800';
      case 'under-negotiation':
        return 'bg-blue-100 text-blue-800';
      case 'contract-out':
        return 'bg-purple-100 text-purple-800';
      case 'contract-in':
        return 'bg-emerald-100 text-emerald-800';
      case 'declined':
        return 'bg-red-100 text-red-800';
      case 'deal-lost-with-offers':
        return 'bg-red-100 text-red-800';
      case 'deal-lost-no-offers':
        return 'bg-red-100 text-red-800';
      case 'draft':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'funded':
        return <Star className="w-4 h-4" />;
      case 'approved':
        return <CheckCircle className="w-4 h-4" />;
      case 'ready-to-submit':
        return <Clock className="w-4 h-4" />;
      case 'sent-to-lenders':
        return <Clock className="w-4 h-4" />;
      case 'under-negotiation':
        return <AlertTriangle className="w-4 h-4" />;
      case 'contract-out':
        return <FileText className="w-4 h-4" />;
      case 'contract-in':
        return <CheckCircle className="w-4 h-4" />;
      case 'declined':
        return <XCircle className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const filteredDeals = deals.filter(deal => {
    const q = (searchTerm || '').trim().toLowerCase();
    const matchesStatus = statusFilter === 'all' || deal.status === statusFilter;
    if (!q) return matchesStatus;

    const haystack = [
      deal.business_name || '',
      deal.industry || '',
      deal.owner_name || '',
      deal.email || '',
      deal.phone || '',
      deal.address || '',
      deal.id || '',
      deal.user?.full_name || '',
      deal.user?.email || '',
    ]
      .join(' ')
      .toLowerCase();

    // Support multi-word queries: all tokens must be present
    const tokens = q.split(/\s+/).filter(Boolean);
    const matchesSearch = tokens.every(t => haystack.includes(t));
    return matchesSearch && matchesStatus;
  });

  const statusCounts = {
    all: deals.length,
    draft: deals.filter(d => d.status === 'draft').length,
    readyToSubmit: deals.filter(d => d.status === 'ready-to-submit').length,
    sentToLenders: deals.filter(d => d.status === 'sent-to-lenders').length,
    underNegotiation: deals.filter(d => d.status === 'under-negotiation').length,
    contractOut: deals.filter(d => d.status === 'contract-out').length,
    contractIn: deals.filter(d => d.status === 'contract-in').length,
    approved: deals.filter(d => d.status === 'approved').length,
    funded: deals.filter(d => d.status === 'funded').length,
    declined: deals.filter(d => d.status === 'declined').length,
    dealLostWithOffers: deals.filter(d => d.status === 'deal-lost-with-offers').length,
    dealLostNoOffers: deals.filter(d => d.status === 'deal-lost-no-offers').length,
  };

  // Unified files list for Documents + MTD (for single upload/list UI)
  const unifiedFiles: UnifiedFile[] = React.useMemo(() => {
    const docs: DocFile[] = documents.map(d => ({ kind: 'doc', ...d }));
    const mtds: MtdFile[] = mtdDocuments.map(d => ({ kind: 'mtd', ...d }));
    const adds: AdditionalFile[] = additionalDocuments.map(d => ({ kind: 'additional', ...d }));
    return [...docs, ...mtds, ...adds];
  }, [documents, mtdDocuments, additionalDocuments]);

  const handleEditDeal = (deal: Deal) => {
    const lockedIds = Array.from(new Set(
      (deal.lenderSubmissions || [])
        .map((ls: DBLenderSubmission & { lender: { name: string } }) => ls.lender_id)
        .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    ));
    onEditDeal?.({ applicationId: deal.id, lockedLenderIds: lockedIds });
  };

  const handleViewQualified = (deal: Deal) => {
    const lockedIds = Array.from(new Set(
      (deal.lenderSubmissions || [])
        .map((ls: DBLenderSubmission & { lender: { name: string } }) => ls.lender_id)
        .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    ));
    onViewQualifiedLenders?.({ applicationId: deal.id, lockedLenderIds: lockedIds });
  };

  const handleViewDetails = (deal: Deal) => {
    setSelectedDeal(deal);
    setShowDetails(true);
    // Preload notes in background so Notes tab is instant
    (async () => {
      try {
        setNotesLoading(true);
        const notes = await getLenderNotes(deal.id);
        setLenderNotes(notes || []);
      } catch (e) {
        console.warn('Failed to load lender notes:', e);
        setLenderNotes([]);
      } finally {
        setNotesLoading(false);
      }
    })();
  };

  const handleViewDocuments = async (deal: Deal) => {
    setSelectedDeal(deal);
    setShowDocs(true);
    setDocsLoading(true);
    try {
      const [rows, mtdRows, addRows] = await Promise.all([
        getApplicationDocuments(deal.id),
        getApplicationMTDByApplicationId(deal.id),
        getApplicationAdditionalByApplicationId(deal.id)
      ]);
      setDocuments(rows.map(r => ({
        id: r.id,
        file_name: r.file_name,
        file_size: r.file_size,
        file_type: r.file_type,
        upload_date: r.upload_date,
        file_url: r.file_url,
      })));
      setMtdDocuments((mtdRows || []).map(r => ({
        id: r.id,
        file_name: r.file_name,
        file_size: r.file_size,
        file_type: r.file_type,
        upload_date: r.upload_date,
        file_url: r.file_url,
        statement_date: r.statement_date,
      })));
      setAdditionalDocuments((addRows || []).map(r => ({ id: r.id as unknown as string, file_name: r.file_name as string, file_size: r.file_size as number | undefined, file_type: r.file_type as string | undefined, upload_date: r.created_at as string | undefined, file_url: r.file_url as string | undefined })));
    } catch (e) {
      console.error('Failed to load documents', e);
      setDocuments([]);
      setMtdDocuments([]);
      setAdditionalDocuments([]);
    } finally {
      setDocsLoading(false);
    }
  };

  // Loading screen before applications render
  if (dealsLoading) {
    const isAdmin = !!user && (user.role === 'admin' || user.role === 'Admin');
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{isAdmin ? 'Loading admin data...' : 'Loading your deals...'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Content */}

      {/* Enhanced Documents Modal */}
      {showDocs && selectedDeal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowDocs(false)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl max-w-6xl w-full max-h-[95vh] overflow-hidden border border-gray-100"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Enhanced Header */}
            <div className="px-8 py-6 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700 text-white relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent"></div>
              <div className="relative z-10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg">
                      <FileText className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold tracking-tight">Application Documents</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-blue-100 text-sm font-medium">{selectedDeal.business_name}</span>
                        <span className="text-blue-200 text-sm">•</span>
                        <span className="text-blue-200 text-sm">Document Management</span>
                      </div>
                    </div>
                  </div>
                  {/* Top-right close button removed by request; backdrop click closes modal */}
                </div>
              </div>
            </div>

            {/* Enhanced Modal Body */}
            <div className="p-8 overflow-y-auto max-h-[calc(95vh-200px)]">
              <div className="text-gray-600 mb-6 text-center">
                <div className="text-sm font-medium">Manage application documents and bank statements</div>
                <div className="text-xs text-gray-500 mt-1">Upload, view, and delete documents for this application</div>
              </div>

              {/* Hidden file input for uploads */}
              <input ref={docInputRef} type="file" multiple onChange={handleDocFileChange} className="hidden" />

              {docsLoading ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="relative">
                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-200 border-t-blue-600"></div>
                  </div>
                  <p className="text-gray-600 text-sm mt-4 font-medium">Loading documents...</p>
                </div>
              ) : (
                <>
                  {/* Unified Files Section (Documents + MTD) */}
                  <div className={`rounded-2xl p-6 mb-8 transition-all duration-150 bg-gradient-to-br from-gray-50 to-gray-100/50 border border-gray-200/50`}>
                    <div className="flex items-center mb-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                          <FileText className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <h4 className="text-lg font-bold text-gray-900">Files (Documents + MTD)</h4>
                          <p className="text-sm text-gray-600">{unifiedFiles.length} file{unifiedFiles.length !== 1 ? 's' : ''} available</p>
                        </div>
                      </div>
                    </div>

                    {/* Dedicated Dropzone */}
                    <div
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDocDragOver(true); }}
                      onDragLeave={() => setDocDragOver(false)}
                      onDrop={async (e) => { e.preventDefault(); e.stopPropagation(); setDocDragOver(false); const files = e.dataTransfer.files; if (files && files.length) { await processDocFiles(files as FileList); } }}
                      className={`mb-6 rounded-xl border-2 border-dashed ${docDragOver ? 'border-blue-400 bg-blue-50/40' : 'border-blue-200 bg-white/60'} p-5 flex items-center justify-between`}
                    >
                      <div className="flex items-center gap-3 text-left">
                        <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
                          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-gray-800">Drag & drop files here</div>
                          <div className="text-xs text-gray-500">or click Browse to select files</div>
                        </div>
                      </div>
                      <button
                        onClick={() => docInputRef.current?.click()}
                        disabled={uploadingDoc}
                        className={`px-3 py-2 rounded-lg text-sm font-semibold ${uploadingDoc ? 'bg-blue-300 text-white cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                      >
                        {uploadingDoc ? 'Uploading…' : 'Browse'}
                      </button>
                    </div>

                    {unifiedFiles.length === 0 ? (
                      <div className="text-center py-6 text-sm text-gray-500">No files uploaded yet</div>
                    ) : (
                      <div className={`space-y-3 rounded-lg ${docDragOver ? 'ring-2 ring-blue-300 ring-offset-0' : ''}`}>
                        {unifiedFiles.map((doc) => (
                          <div key={`${doc.kind}-${doc.id}`} className="bg-white/80 backdrop-blur-sm rounded-xl p-5 border border-white/60 shadow-sm hover:shadow-md transition-all duration-200 group">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-4 flex-1">
                                {(() => {
                                  const isPdf = /\.pdf$/i.test(doc.file_name) || (doc.file_type || '').toLowerCase().includes('pdf');
                                  const ext = (doc.file_type?.split('/')[1] || doc.file_name.split('.').pop() || 'FILE').toUpperCase();
                                  return (
                                    <div className="w-20 h-20 rounded-xl overflow-hidden border border-gray-200 bg-white flex items-center justify-center shadow-sm">
                                      {isPdf && doc.file_url ? (
                                        <iframe
                                          src={`${doc.file_url}#view=FitH`}
                                          title={`Preview ${doc.file_name}`}
                                          className="w-full h-full"
                                          allow="fullscreen"
                                          allowFullScreen
                                          loading="lazy"
                                        />
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 text-gray-600 text-xs font-semibold">
                                          {ext}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <h5 className="text-sm font-semibold text-gray-900 truncate">{doc.file_name}</h5>
                                    {doc.kind === 'mtd' ? (
                                      <span className="inline-flex px-2.5 py-1 text-xs font-semibold bg-purple-100 text-purple-800 rounded-full">MTD</span>
                                    ) : (
                                      <span className="inline-flex px-2.5 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded-full">
                                        {(doc.file_type?.split('/')[1] || doc.file_name.split('.').pop() || 'FILE')?.toUpperCase()}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-3 text-xs text-gray-500">
                                    <span className="flex items-center gap-1">
                                      <Building2 className="w-3 h-3" />
                                      {doc.file_size ? `${(doc.file_size / 1024).toFixed(1)} KB` : 'Size unknown'}
                                    </span>
                                    {doc.upload_date && (
                                      <span className="flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {new Date(doc.upload_date).toLocaleDateString('en-US', { 
                                          month: 'short', 
                                          day: 'numeric', 
                                          year: 'numeric' 
                                        })}
                                      </span>
                                    )}
                                    {doc.kind === 'mtd' && doc.statement_date && (
                                      <span className="flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {new Date(doc.statement_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {doc.file_url ? (
                                  <>
                                    <button className="px-3 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all duration-200">
                                      <Download className="w-3 h-3 mr-1 inline" />
                                      Download
                                    </button>
                                    <a 
                                      href={doc.file_url} 
                                      target="_blank" 
                                      rel="noreferrer" 
                                      className="px-3 py-2 text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-sm hover:shadow-md"
                                    >
                                      <Eye className="w-3 h-3 mr-1 inline" />
                                      Open
                                    </a>
                                    <button onClick={() => { if (doc.kind === 'mtd') { setDeleteTarget({ kind: 'mtd', data: { id: doc.id, file_url: doc.file_url, file_name: doc.file_name, file_size: doc.file_size } }); } else { setDeleteTarget({ kind: 'doc', data: { id: doc.id, file_url: doc.file_url, file_name: doc.file_name } }); } setShowDeleteConfirm(true); }} className="px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 hover:border-red-300 transition-all duration-200">
                                      <svg className="w-3 h-3 mr-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                      Delete
                                    </button>
                                </>
                              ) : (
                                <span className="px-3 py-2 text-xs text-gray-400 bg-gray-100 rounded-lg">
                                  <XCircle className="w-3 h-3 mr-1 inline" />
                                  No URL
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            </div>

            {/* Delete Confirm Dialog */}
            {showDeleteConfirm && deleteTarget && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/50" onClick={() => { setShowDeleteConfirm(false); setDeleteTarget(null); }}></div>
                <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md border border-gray-100 p-6">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-red-600">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                    </div>
                    <div className="flex-1">
                      <div className="text-lg font-semibold text-gray-900 mb-1">Confirm Delete</div>
                      <div className="text-sm text-gray-600">
                        {deleteTarget.kind === 'doc' ? 'Delete document' : 'Delete MTD file'}
                        {': '}
                        <span className="font-medium">{deleteTarget.data.file_name}</span>?
                      </div>
                    </div>
                  </div>
                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      onClick={() => { setShowDeleteConfirm(false); setDeleteTarget(null); }}
                      className="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 bg-white hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={confirmDeleteNow}
                      className="px-4 py-2 rounded-xl text-white bg-red-600 hover:bg-red-700 shadow-sm"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Enhanced Footer */}
            <div className="px-8 py-6 bg-gray-50/80 border-t border-gray-100 flex justify-between items-center">
              <div className="text-xs text-gray-500">
                Application ID: {selectedDeal.id}
              </div>
              <button 
                onClick={() => setShowDocs(false)} 
                className="px-6 py-3 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 font-semibold transition-all duration-200 shadow-sm hover:shadow-md"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        {user && (user.role === 'admin' || user.role === 'Admin') ? (
          <>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">All Deals</h1>
            <p className="text-gray-600">View and manage all merchant cash advance submissions</p>
            <p className="text-sm text-gray-500 mt-1">Admin view - showing all applications from all users</p>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">My Deals</h1>
            <p className="text-gray-600">View and manage your merchant cash advance submissions</p>
            {user && (
              <p className="text-sm text-gray-500 mt-1">Showing applications for: {user.name} ({user.email})</p>
            )}
          </>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex items-center">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Building2 className="w-6 h-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">
                {user && (user.role === 'admin' || user.role === 'Admin') ? 'All Deals' : 'My Deals'}
              </p>
              <p className="text-2xl font-bold text-gray-900">{deals.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex items-center">
            <div className="p-3 bg-green-100 rounded-lg">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Approved</p>
              <p className="text-2xl font-bold text-gray-900">{statusCounts.approved}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex items-center">
            <div className="p-3 bg-yellow-100 rounded-lg">
              <Clock className="w-6 h-6 text-yellow-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Ready to Submit</p>
              <p className="text-2xl font-bold text-gray-900">{statusCounts.readyToSubmit}</p>
            </div>
          </div>
        </div>

        

        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex items-center">
            <div className="p-3 bg-purple-100 rounded-lg">
              <DollarSign className="w-6 h-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Volume</p>
              <p className="text-2xl font-bold text-gray-900">
                ${deals.reduce((sum, deal) => sum + deal.requested_amount, 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
          <div className="flex items-center space-x-4">
            <div className="relative">
              <Search className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by business, contact, phone, email, ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
            
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="all">All Status ({statusCounts.all})</option>
              <option value="draft">Draft ({statusCounts.draft})</option>
              <option value="ready-to-submit">Ready to Submit ({statusCounts.readyToSubmit})</option>
              <option value="sent-to-lenders">Sent to Lenders ({statusCounts.sentToLenders})</option>
              <option value="under-negotiation">Under Negotiation ({statusCounts.underNegotiation})</option>
              <option value="contract-out">Contract Out ({statusCounts.contractOut})</option>
              <option value="contract-in">Contract In ({statusCounts.contractIn})</option>
              <option value="approved">Approved ({statusCounts.approved})</option>
              <option value="funded">Funded ({statusCounts.funded})</option>
              <option value="declined">Declined ({statusCounts.declined})</option>
              <option value="deal-lost-with-offers">Deal Lost with Offers ({statusCounts.dealLostWithOffers})</option>
              <option value="deal-lost-no-offers">Deal Lost w/ No Offers ({statusCounts.dealLostNoOffers})</option>
            </select>
          </div>

        </div>
      </div>

      {/* Deals Table */}
      <div className="bg-white rounded-xl shadow-lg overflow-visible">
        <div className="w-full overflow-x-auto md:overflow-visible">
          <table className="min-w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Business
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Contact
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Financial
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Activity
                </th>
                {user && (user.role === 'admin' || user.role === 'Admin') && (
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Submitted By
                  </th>
                )}
                <th className="px-4 py-4"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredDeals.length === 0 ? (
                <tr>
                  <td
                    className="px-6 py-10 text-center text-gray-500 text-sm"
                    colSpan={(user && (user.role === 'admin' || user.role === 'Admin')) ? 7 : 6}
                  >
                    No application found
                  </td>
                </tr>
              ) : (
              filteredDeals.map((deal) => (
                <tr key={deal.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10">
                        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                          <span className="text-sm font-medium text-white">
                            {deal.business_name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">{deal.business_name}</div>
                        <div className="text-xs text-gray-400">{deal.industry}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{deal.owner_name}</div>
                      <div className="text-sm text-gray-500">{deal.email}</div>
                      <div className="text-sm text-gray-500">{deal.phone || 'N/A'}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        ${deal.requested_amount.toLocaleString()}
                      </div>
                      <div className="text-sm text-gray-500">
                        ${deal.monthly_revenue.toLocaleString()}/mo
                      </div>
                      <div className="text-sm text-gray-500">
                        Credit: {deal.credit_score} | {deal.years_in_business}y
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col space-y-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(deal.status)} max-w-fit`}>
                        {getStatusIcon(deal.status)}
                        <span className="ml-1 capitalize">{deal.status.replace('-', ' ')}</span>
                      </span>
                      {deal.lenderSubmissions.length > 0 && (
                        <span className="text-xs text-gray-500">
                          {deal.lenderSubmissions.length} lender{deal.lenderSubmissions.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div>
                      <div className="text-sm text-gray-900">
                        Submitted: {new Date(deal.created_at).toLocaleDateString()}
                      </div>
                      <div className="text-sm text-gray-500">
                        Last: {new Date(deal.updated_at).toLocaleDateString()}
                      </div>
                    </div>
                  </td>
                  {user && (user.role === 'admin' || user.role === 'Admin') && (
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-8 w-8">
                          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center">
                            <span className="text-xs font-medium text-white">
                              {(deal.user?.full_name || deal.owner_name || 'U').charAt(0).toUpperCase()}
                            </span>
                          </div>
                        </div>
                        <div className="ml-3">
                          <div className="text-sm font-medium text-gray-900">
                            {deal.user?.full_name || deal.owner_name || 'Unknown User'}
                          </div>
                          <div className="text-sm text-gray-500">
                            {deal.user?.email || deal.email || 'No email'}
                          </div>
                        </div>
                      </div>
                    </td>
                  )}
                  <td className="px-4 py-4 relative text-right">
                    <div data-dropdown="actions">
                      <button
                        onClick={() => setOpenActionId(openActionId === deal.id ? null : deal.id)}
                        className={`inline-flex items-center justify-center h-8 w-8 rounded-lg transition-all duration-200 ${
                          openActionId === deal.id 
                            ? 'bg-gray-100 text-gray-700 shadow-sm' 
                            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                        }`}
                        title="More actions"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {openActionId === deal.id && (
                        <div className="absolute right-10 top-1/2 -translate-y-1/2 bg-white border border-gray-200/60 rounded-xl shadow-2xl z-20 min-w-[240px] overflow-hidden backdrop-blur-sm">
                          {/* Header */}
                          <div className="px-6 py-3 bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-200/80">
                            <div className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center">
                              <div className="w-2 h-2 rounded-full bg-blue-500 mr-2"></div>
                              Deal Actions
                            </div>
                          </div>
                          
                          {/* Menu Items */}
                          <div className="py-2">
                            <button
                              onClick={() => { handleViewDetails(deal); setOpenActionId(null); }}
                              className="flex items-center w-full text-left px-6 py-3 text-sm font-medium text-slate-700 hover:bg-blue-50/80 hover:text-blue-700 transition-all duration-200 group"
                            >
                              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-100/50 group-hover:bg-blue-200/80 mr-3 transition-colors">
                                <Eye className="w-4 h-4 text-blue-600 group-hover:text-blue-700" />
                              </div>
                              <div>
                                <div className="font-medium">View Details</div>
                                <div className="text-xs text-slate-500 group-hover:text-blue-600">Review application info</div>
                              </div>
                            </button>
                            
                            <button
                              onClick={() => { handleViewDocuments(deal); setOpenActionId(null); }}
                              className="flex items-center w-full text-left px-6 py-3 text-sm font-medium text-slate-700 hover:bg-emerald-50/80 hover:text-emerald-700 transition-all duration-200 group"
                            >
                              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-100/50 group-hover:bg-emerald-200/80 mr-3 transition-colors">
                                <FileText className="w-4 h-4 text-emerald-600 group-hover:text-emerald-700" />
                              </div>
                              <div>
                                <div className="font-medium">View Documents</div>
                                <div className="text-xs text-slate-500 group-hover:text-emerald-600">Bank statements & files</div>
                              </div>
                            </button>
                            
                            <button
                              onClick={() => { handleViewQualified(deal); setOpenActionId(null); }}
                              className="flex items-center w-full text-left px-6 py-3 text-sm font-medium text-slate-700 hover:bg-indigo-50/80 hover:text-indigo-700 transition-all duration-200 group"
                            >
                              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-100/50 group-hover:bg-indigo-200/80 mr-3 transition-colors">
                                <Star className="w-4 h-4 text-indigo-600 group-hover:text-indigo-700" />
                              </div>
                              <div>
                                <div className="font-medium">Qualified Lenders</div>
                                <div className="text-xs text-slate-500 group-hover:text-indigo-600">View lender matches</div>
                              </div>
                            </button>

                            <button
                              onClick={() => { handleEditDeal(deal); setOpenActionId(null); }}
                              className="flex items-center w-full text-left px-6 py-3 text-sm font-medium text-slate-700 hover:bg-amber-50/80 hover:text-amber-700 transition-all duration-200 group"
                            >
                              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-100/50 group-hover:bg-amber-200/80 mr-3 transition-colors">
                                <svg className="w-4 h-4 text-amber-600 group-hover:text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </div>
                              <div>
                                <div className="font-medium">Bank Statements</div>
                                <div className="text-xs text-slate-500 group-hover:text-amber-600">Modify Bank Documents</div>
                              </div>
                            </button>
                            
                            {user && (user.role === 'admin' || user.role === 'Admin') && (
                                <button
                                  onClick={() => { handleManageAccess(deal); setOpenActionId(null); }}
                                  className="flex items-center w-full text-left px-6 py-3 text-sm font-medium text-slate-700 hover:bg-violet-50/80 hover:text-violet-700 transition-all duration-200 group"
                                  title="Manage which users can access this deal"
                                >
                                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-violet-100/50 group-hover:bg-violet-200/80 mr-3 transition-colors">
                                    <Users className="w-4 h-4 text-violet-600 group-hover:text-violet-700" />
                                  </div>
                                  <div>
                                    <div className="font-medium">Manage Access</div>
                                    <div className="text-xs text-slate-500 group-hover:text-violet-600">Control user permissions</div>
                                  </div>
                                </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAccessModal && accessApp && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowAccessModal(false)}></div>
          <div className="relative z-50 w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
            {/* Enhanced Header */}
            <div className="px-8 py-6 bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-700 text-white relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent"></div>
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                    <Users className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="text-xl font-bold tracking-tight">Manage Access</div>
                    <div className="text-emerald-100 text-sm font-medium">{accessApp.business_name}</div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Enhanced Body */}
            <div className="p-8">
              <div className="text-gray-600 mb-6 text-center">
                <div className="text-sm font-medium">Grant specific users access to this deal</div>
                <div className="text-xs text-gray-500 mt-1">Search and select users to manage permissions</div>
              </div>
              
              {accessLoading ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="relative">
                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-emerald-200 border-t-emerald-600"></div>
                  </div>
                  <p className="text-gray-600 text-sm mt-4 font-medium">Loading users...</p>
                </div>
              ) : (
                <>
                  {/* Enhanced Search and Add */}
                  <div className="flex items-center gap-4 mb-8">
                    <input
                      type="text"
                      value={accessSearch}
                      onChange={(e) => setAccessSearch(e.target.value)}
                      placeholder="Search users by name or email..."
                      className="flex-1 px-5 py-3.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 text-sm font-medium placeholder-gray-400 shadow-sm"
                    />
                    <button
                      onClick={handleBulkAddUsers}
                      disabled={selectedUserIds.size === 0}
                      className={`px-6 py-3.5 rounded-xl text-white font-semibold transition-all duration-200 shadow-lg ${
                        selectedUserIds.size === 0 
                          ? 'bg-gray-300 cursor-not-allowed text-gray-500' 
                          : 'bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 hover:shadow-xl transform hover:scale-105'
                      }`}
                    >
                      Add Users {selectedUserIds.size > 0 && `(${selectedUserIds.size})`}
                    </button>
                  </div>

                  {/* Enhanced Search Results */}
                  <div className="mb-8">
                    {accessSearch.trim().length === 0 ? (
                      <div className="text-center py-12 bg-gray-50/50 rounded-2xl border-2 border-dashed border-gray-200">
                        <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                        <div className="text-sm font-medium text-gray-600">Start typing to search for users</div>
                        <div className="text-xs text-gray-400 mt-1">Find users by name or email address</div>
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-64 overflow-auto pr-2">
                        {accessUsers
                          .filter(u => !accessByUser[u.id])
                          .filter(u => {
                            const q = accessSearch.trim().toLowerCase();
                            const name = (u.full_name || '').toLowerCase();
                            const email = (u.email || '').toLowerCase();
                            return name.includes(q) || email.includes(q);
                          })
                          .map(u => (
                            <label key={u.id} className="flex items-center justify-between rounded-xl border border-gray-200 px-5 py-4 hover:bg-emerald-50/50 hover:border-emerald-200 cursor-pointer transition-all duration-200 group">
                              <div className="flex items-center gap-4">
                                <input
                                  type="checkbox"
                                  checked={selectedUserIds.has(u.id)}
                                  onChange={() => toggleSelectUser(u.id)}
                                  className="h-5 w-5 text-emerald-600 focus:ring-emerald-500 rounded-md border-2 border-gray-300 group-hover:border-emerald-400 transition-colors"
                                />
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-200 flex items-center justify-center">
                                  <span className="text-emerald-700 font-semibold text-sm">
                                    {(u.full_name || u.email).charAt(0).toUpperCase()}
                                  </span>
                                </div>
                                <div>
                                  <div className="text-sm font-semibold text-gray-900">{u.full_name || u.email}</div>
                                  <div className="text-xs text-gray-500 flex items-center gap-1">
                                    <span className={`inline-block w-2 h-2 rounded-full ${(u.roles || '').toLowerCase() === 'admin' ? 'bg-purple-400' : 'bg-blue-400'}`}></span>
                                    {(u.roles || '').toLowerCase() === 'admin' ? 'Admin' : 'Member'}
                                  </div>
                                </div>
                              </div>
                            </label>
                          ))}
                        {accessUsers.filter(u => !accessByUser[u.id]).filter(u => {
                          const q = accessSearch.trim().toLowerCase();
                          const name = (u.full_name || '').toLowerCase();
                          const email = (u.email || '').toLowerCase();
                          return q && (name.includes(q) || email.includes(q));
                        }).length === 0 && (
                          <div className="text-center py-12 bg-gray-50/50 rounded-2xl">
                            <div className="text-sm font-medium text-gray-600">No users match your search</div>
                            <div className="text-xs text-gray-400 mt-1">Try a different search term</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Enhanced Granted Users */}
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="text-sm font-bold text-gray-700">Granted Users</div>
                      <div className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold">
                        {accessUsers.filter(u => accessByUser[u.id]).length}
                      </div>
                    </div>
                    <div className="space-y-3 max-h-64 overflow-auto pr-2">
                      {accessUsers.filter(u => accessByUser[u.id]).map(u => (
                        <div key={u.id} className="flex items-center justify-between rounded-xl border border-emerald-200 px-5 py-4 bg-gradient-to-r from-emerald-50/80 to-emerald-50/40">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-sm">
                              <span className="text-white font-semibold text-sm">
                                {(u.full_name || u.email).charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-gray-900">{u.full_name || u.email}</div>
                              <div className="text-xs text-gray-500 flex items-center gap-1">
                                <span className={`inline-block w-2 h-2 rounded-full ${(u.roles || '').toLowerCase() === 'admin' ? 'bg-purple-400' : 'bg-blue-400'}`}></span>
                                {(u.roles || '').toLowerCase() === 'admin' ? 'Admin' : 'Member'}
                                <span className="mx-1">•</span>
                                <span className="text-emerald-600 font-medium">Access Granted</span>
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => handleRevoke(u.id)}
                            className="px-4 py-2 text-xs font-semibold rounded-lg border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 hover:border-red-300 transition-all duration-200 hover:shadow-sm"
                          >
                            Revoke
                          </button>
                        </div>
                      ))}
                      {accessUsers.filter(u => accessByUser[u.id]).length === 0 && (
                        <div className="text-center py-12 bg-gray-50/50 rounded-2xl border-2 border-dashed border-gray-200">
                          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                          <div className="text-sm font-medium text-gray-600">No users have access yet</div>
                          <div className="text-xs text-gray-400 mt-1">Search and add users to grant access</div>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            
            {/* Enhanced Footer */}
            <div className="px-8 py-6 bg-gray-50/80 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setShowAccessModal(false)}
                className="px-6 py-3 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 font-semibold transition-all duration-200 shadow-sm hover:shadow-md"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Enhanced Deal Details Modal */}
      {showDetails && selectedDeal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowDetails(false)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl max-w-5xl w-full max-h-[95vh] overflow-hidden border border-gray-100"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Enhanced Header */}
            <div className="px-8 py-6 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 border-b border-gray-200/80 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-white/40 to-transparent"></div>
              <div className="relative z-10 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                    <span className="text-white font-bold text-lg">
                      {selectedDeal.business_name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900 tracking-tight">
                      {selectedDeal.business_name}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
                        {selectedDeal.industry}
                      </span>
                      <span className="text-gray-500 text-sm">•</span>
                      <span className="text-gray-600 text-sm font-medium">Deal Details</span>
                    </div>
                  </div>
                </div>
              </div>
              {/* Top-right close button removed by request */}
            </div>

            {/* Tab Switcher */}
            <div className="px-8 py-4 border-b border-gray-200/80">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setActiveTab('information')}
                  className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                    activeTab === 'information'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  Information
                </button>
                <button
                  onClick={() => setActiveTab('notes')}
                  className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                    activeTab === 'notes'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  Notes
                </button>
              </div>
            </div>

            {/* Enhanced Body */}
            <div className="p-8 overflow-y-auto max-h-[calc(95vh-200px)]">

              {activeTab === 'information' && (
                <>
                  {/* Unified header row with centered toast */}
                  <div className="relative mb-4">
                {/* Centered toast within the same row */}
                {toast && (
                  <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2">
                    <div className={`px-4 py-2 rounded-xl border text-sm font-semibold shadow-sm
                      ${toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : ''}
                      ${toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : ''}
                      ${toast.type === 'info' ? 'bg-blue-50 border-blue-200 text-blue-800' : ''}
                    `}>
                      {toast.message}
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-end gap-2">
                  {!editingDetails ? (
                    <button onClick={handleStartEditDetails} className="px-4 py-2 text-sm font-semibold text-indigo-700 bg-indigo-100 rounded-lg hover:bg-indigo-200">Edit Details</button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button disabled={savingDetails} onClick={handleSaveDetails} className={`px-4 py-2 text-sm font-semibold text-white rounded-lg ${savingDetails ? 'bg-indigo-300' : 'bg-indigo-600 hover:bg-indigo-700'}`}>{savingDetails ? 'Saving...' : 'Save Changes'}</button>
                      <button onClick={handleCancelDetails} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Application Status for All Users */}
              {user && (
                <div className="mb-6 bg-gradient-to-br from-blue-50 to-indigo-50/50 rounded-2xl p-6 border border-blue-200/50">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h4 className="text-lg font-bold text-gray-900">Application Status</h4>
                  </div>
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-gray-700">Current Status</label>
                    <select
                      value={selectedDeal.status}
                      onChange={(e) => {
                        // Update local state immediately for UI responsiveness
                        if (selectedDeal) {
                          setSelectedDeal({ ...selectedDeal, status: e.target.value });
                        }
                        // Update in deals list
                        setDeals(prev => prev.map(deal => 
                          deal.id === selectedDeal.id ? { ...deal, status: e.target.value } : deal
                        ));
                        // Save to database
                        handleUpdateApplicationStatus(selectedDeal.id, e.target.value);
                      }}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                    >
                      <option value="draft">Draft</option>
                      <option value="ready-to-submit">Ready to Submit</option>
                      <option value="sent-to-lenders">Sent to Lenders</option>
                      <option value="under-negotiation">Under Negotiation</option>
                      <option value="contract-out">Contract Out</option>
                      <option value="contract-in">Contract In</option>
                      <option value="approved">Approved</option>
                      <option value="funded">Funded</option>
                      <option value="declined">Declined</option>
                      <option value="deal-lost-with-offers">Deal Lost with Offers</option>
                      <option value="deal-lost-no-offers">Deal Lost w/ No Offers</option>
                    </select>
                  </div>
                </div>
              )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                {/* Business Information Card */}
                <div className="bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-2xl p-6 border border-gray-200/50">
                  <div className="flex items-center gap-3 mb-5">
                      <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                        <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      </div>
                      <h4 className="text-lg font-bold text-gray-900">Business Information</h4>
                  </div>
                  <div className="space-y-4">
                    {!editingDetails ? (
                      <>
                        <div className="flex items-center justify-between py-2 border-b border-gray-200/60">
                          <span className="text-gray-600 font-medium">Business Name</span>
                          <span className="font-semibold text-gray-900">{selectedDeal.business_name}</span>
                        </div>
                        <div className="flex items-center justify-between py-2 border-b border-gray-200/60">
                          <span className="text-gray-600 font-medium">Industry</span>
                          <span className="font-semibold text-gray-900">{selectedDeal.industry}</span>
                        </div>
                        <div className="flex items-center justify-between py-2 border-b border-gray-200/60">
                          <span className="text-gray-600 font-medium">Time in Business</span>
                          <span className="font-semibold text-gray-900">{selectedDeal.years_in_business} years</span>
                        </div>
                        <div className="flex items-center justify-between py-2 border-b border-gray-200/60">
                          <span className="text-gray-600 font-medium">Monthly Revenue</span>
                          <span className="font-bold text-emerald-600">${selectedDeal.monthly_revenue.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between py-2">
                          <span className="text-gray-600 font-medium">Credit Score</span>
                          <span className={`${selectedDeal.credit_score >= 700 ? 'text-green-600' : selectedDeal.credit_score >= 600 ? 'text-yellow-600' : 'text-red-600'} font-bold`}>
                            {selectedDeal.credit_score}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 gap-4">
                          <label className="flex items-center justify-between py-1">
                            <span className="text-gray-600 font-medium">Business Name</span>
                            <input value={businessForm.business_name} onChange={e => setBusinessForm(s => ({ ...s, business_name: e.target.value }))} className="ml-4 w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                          </label>
                          <label className="flex items-center justify-between py-1">
                            <span className="text-gray-600 font-medium">Industry</span>
                            <input value={businessForm.industry} onChange={e => setBusinessForm(s => ({ ...s, industry: e.target.value }))} className="ml-4 w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                          </label>
                          <label className="flex items-center justify-between py-1">
                            <span className="text-gray-600 font-medium">Time in Business (years)</span>
                            <input type="number" value={businessForm.years_in_business} onChange={e => setBusinessForm(s => ({ ...s, years_in_business: Number(e.target.value) }))} className="no-spinner ml-4 w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                          </label>
                          <label className="flex items-center justify-between py-1">
                            <span className="text-gray-600 font-medium">Monthly Revenue</span>
                            <input type="number" value={businessForm.monthly_revenue} onChange={e => setBusinessForm(s => ({ ...s, monthly_revenue: Number(e.target.value) }))} className="no-spinner ml-4 w-40 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                          </label>
                          <label className="flex items-center justify-between py-1">
                            <span className="text-gray-600 font-medium">Credit Score</span>
                            <input type="number" value={businessForm.credit_score} onChange={e => setBusinessForm(s => ({ ...s, credit_score: Number(e.target.value) }))} className="no-spinner ml-4 w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                          </label>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Contact Information Card */}
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50/50 rounded-2xl p-6 border border-blue-200/50">
                  <div className="flex items-center gap-3 mb-5">
                      <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                        <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                      <h4 className="text-lg font-bold text-gray-900">Contact Information</h4>
                  </div>
                  <div className="space-y-4">
                    {!editingDetails ? (
                      <>
                        <div className="flex items-center justify-between py-2 border-b border-blue-200/60">
                          <span className="text-gray-600 font-medium">Owner</span>
                          <span className="font-semibold text-gray-900">{selectedDeal.owner_name}</span>
                        </div>
                        <div className="flex items-center justify-between py-2 border-b border-blue-200/60">
                          <span className="text-gray-600 font-medium">Email</span>
                          <span className="font-semibold text-blue-600">{selectedDeal.email}</span>
                        </div>
                        <div className="flex items-center justify-between py-2 border-b border-blue-200/60">
                          <span className="text-gray-600 font-medium">Phone</span>
                          <span className="font-semibold text-gray-900">{selectedDeal.phone || 'N/A'}</span>
                        </div>
                        <div className="flex items-center justify-between py-2 border-b border-blue-200/60">
                          <span className="text-gray-600 font-medium">Address</span>
                          <span className="font-semibold text-gray-900 truncate max-w-[60%] text-right">{selectedDeal.address || 'N/A'}</span>
                        </div>
                        <div className="flex items-center justify-between py-2">
                          <span className="text-gray-600 font-medium">Status</span>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(selectedDeal.status)}`}>
                            {selectedDeal.status.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 gap-4">
                          <label className="flex items-center justify-between py-1">
                            <span className="text-gray-600 font-medium">Owner</span>
                            <input value={contactForm.owner_name} onChange={e => setContactForm(s => ({ ...s, owner_name: e.target.value }))} className="ml-4 w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                          </label>
                          <label className="flex items-center justify-between py-1">
                            <span className="text-gray-600 font-medium">Email</span>
                            <input type="email" value={contactForm.email} onChange={e => setContactForm(s => ({ ...s, email: e.target.value }))} className="ml-4 w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                          </label>
                          <label className="flex items-center justify-between py-1">
                            <span className="text-gray-600 font-medium">Phone</span>
                            <input value={contactForm.phone} onChange={e => setContactForm(s => ({ ...s, phone: e.target.value }))} className="ml-4 w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                          </label>
                          <label className="flex items-center justify-between py-1">
                            <span className="text-gray-600 font-medium">Address</span>
                            <input value={contactForm.address} onChange={e => setContactForm(s => ({ ...s, address: e.target.value }))} className="ml-4 w-72 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                          </label>
                          <div className="flex items-center justify-between py-1">
                            <span className="text-gray-600 font-medium">Status</span>
                            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(selectedDeal.status)}`}>
                              {selectedDeal.status.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              

                </>  
              )}
              
              {activeTab === 'notes' && (
                <div className="bg-gradient-to-b from-gray-50 to-white rounded-2xl border border-gray-200/80 shadow-sm p-6 max-h-[calc(100vh-500px)] overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between mb-4 flex-shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                        <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </div>
                      <h4 className="text-lg font-bold text-gray-900">Notes</h4>
                    </div>
                  </div>
                <div className="space-y-6 overflow-y-auto flex-1 pr-2">
                  {/* Add Notes Button */}
                  {!showAddNoteForm && (
                    <div className="flex justify-end mb-4">
                      <button
                        onClick={() => setShowAddNoteForm(true)}
                        className="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-semibold hover:from-blue-700 hover:to-blue-800 shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-2"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add Notes
                      </button>
                    </div>
                  )}

                  {/* Add Note Form */}
                  {showAddNoteForm && (
                    <div className="bg-gradient-to-br from-white to-gray-50/50 rounded-2xl border border-gray-200/80 shadow-lg p-6 flex-shrink-0">
                      <h5 className="text-sm font-semibold text-gray-800 mb-4">Add a new note</h5>
                      <textarea
                        className="w-full min-h-[120px] px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none transition-all duration-200 bg-white/80 backdrop-blur-sm"
                        placeholder="Write a note for lenders... (e.g., follow-up required, special conditions, contact preferences)"
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                          />
                          <div className="mt-4 flex items-center justify-between">
                            <div className="text-xs text-gray-500">
                              {newNote.length}/500 characters
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  setShowAddNoteForm(false);
                                  setNewNote('');
                                }}
                                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-all duration-200"
                              >
                                Cancel
                              </button>
                              <button
                            onClick={async () => {
                              if (!selectedDeal || !newNote.trim() || savingNote) return;
                              setSavingNote(true);
                              try {
                                const userName = user?.name || user?.email || 'Unknown User';
                                // Temporary workaround: make user_name unique by adding timestamp
                                const uniqueUserName = `${userName}_${Date.now()}`;
                                const saved = await addLenderNote(selectedDeal.id, newNote.trim(), uniqueUserName);
                                setLenderNotes(prev => [saved, ...prev]);
                                setNewNote('');
                                setShowAddNoteForm(false);
                                pushToast('Note added', 'success');
                              } catch (e) {
                                console.warn('Failed to add note:', e);
                                pushToast('Failed to add note', 'error');
                              } finally {
                                setSavingNote(false);
                              }
                            }}
                            disabled={!newNote.trim() || savingNote}
                            className={`px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${!newNote.trim() || savingNote ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-700 hover:to-blue-800 shadow-lg hover:shadow-xl transform hover:scale-105'}`}
                              >
                                {savingNote ? 'Saving…' : 'Add Note'}
                              </button>
                            </div>
                          </div>
                    </div>
                  )}

                  {/* Notes List */}
                  {notesLoading ? (
                    <div className="text-center py-12 bg-gradient-to-br from-white to-gray-50/50 rounded-2xl border border-gray-200/80 shadow-sm">
                      <div className="animate-spin rounded-full h-8 w-8 border-3 border-gray-200 border-t-blue-600 mx-auto mb-4" />
                      <div className="text-sm font-medium text-gray-600">Loading notes…</div>
                    </div>
                  ) : lenderNotes.length === 0 ? (
                    <div className="text-center py-16 bg-gradient-to-br from-white to-gray-50/50 rounded-2xl border-2 border-dashed border-gray-300">
                      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">No notes yet</h3>
                      <p className="text-sm text-gray-500 max-w-sm mx-auto">
                        Start documenting important information about this application by adding your first note above.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-lg font-bold text-gray-900">Notes History</h4>
                        <div className="px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                          {lenderNotes.length} note{lenderNotes.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                      {lenderNotes.map((n) => (
                        <div key={n.id} className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200 p-4">
                          {(() => {
                            const d = new Date(n.created_at);
                            const formatted = d.toLocaleString('en-US', {
                              day: '2-digit',
                              month: 'long',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: true,
                            });
                            const daysAgo = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
                            const suffix = `${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`;
                            return (
                              <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{formatted}</span>
                                  {n.user_name && (
                                    <>
                                      <span className="text-gray-400">•</span>
                                      <span className="text-blue-600 font-semibold">
                                        {n.user_name.includes('_') ? n.user_name.split('_')[0] : n.user_name}
                                      </span>
                                    </>
                                  )}
                                </div>
                                <span className="text-gray-600">{suffix}</span>
                              </div>
                            );
                          })()}
                          {editingNoteId === n.id ? (
                            <div>
                              <textarea
                                className="w-full min-h-[90px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={editNoteText}
                                onChange={(e) => setEditNoteText(e.target.value)}
                              />
                              <div className="mt-2 flex items-center gap-2 justify-end">
                                <button
                                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200"
                                  onClick={() => { setEditingNoteId(null); setEditNoteText(''); }}
                                >
                                  Cancel
                                </button>
                                <button
                                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                                  onClick={async () => {
                                    if (!editNoteText.trim()) return;
                                    try {
                                      await updateLenderNote(n.id, { notes: editNoteText.trim() });
                                      setLenderNotes(prev => prev.map(x => x.id === n.id ? { ...x, notes: editNoteText.trim() } : x));
                                      setEditingNoteId(null);
                                      setEditNoteText('');
                                      pushToast('Note updated', 'success');
                                    } catch (e) {
                                      console.warn('Failed to update note:', e);
                                      pushToast('Failed to update note', 'error');
                                    }
                                  }}
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start justify-between gap-3">
                              <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{n.notes}</div>
                              <div className="flex items-center gap-2 ml-3">
                                <button
                                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200"
                                  onClick={() => { setEditingNoteId(n.id); setEditNoteText(n.notes || ''); }}
                                >
                                  Edit
                                </button>
                                <button
                                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${deletingNoteId === n.id ? 'bg-red-300 text-white' : 'bg-red-600 text-white hover:bg-red-700'}`}
                                  onClick={async () => {
                                    if (deletingNoteId) return;
                                    try {
                                      setDeletingNoteId(n.id);
                                      await deleteLenderNote(n.id);
                                      setLenderNotes(prev => prev.filter(x => x.id !== n.id));
                                      pushToast('Note deleted', 'success');
                                    } catch (e) {
                                      console.warn('Failed to delete note:', e);
                                      pushToast('Failed to delete note', 'error');
                                    } finally {
                                      setDeletingNoteId(null);
                                    }
                                  }}
                                >
                                  {deletingNoteId === n.id ? 'Deleting…' : 'Delete'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    )}
                  </div>
                </div>
              )}

              {/* Lender Submissions - Always Visible at Bottom */}
              <div className="bg-gradient-to-br from-purple-50 to-pink-50/50 rounded-2xl p-6 border border-purple-200/50 mt-8">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                      <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h4 className="text-lg font-bold text-gray-900">Lenders</h4>
                      <p className="text-sm text-gray-600">Track all lender responses and offers</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-semibold">
                      {selectedDeal.lenderSubmissions.length} Submissions
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  {selectedDeal.lenderSubmissions.length === 0 ? (
                    <div className="text-center py-12 bg-white/60 rounded-xl border-2 border-dashed border-purple-200">
                      <p className="text-purple-700 font-medium">No submissions yet</p>
                      <p className="text-purple-500 text-sm mt-1">Submissions from lenders will appear here</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {selectedDeal.lenderSubmissions.map((submission) => (
                        <div key={submission.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                          <div className="flex items-center justify-between mb-4">
                            <div>
                              <div className="font-semibold text-gray-900">{submission.lender.name}</div>
                              <div className="text-sm text-gray-500">Updated {new Date(submission.updated_at || submission.created_at).toLocaleDateString()}</div>
                            </div>
                            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getLenderStatusColor(submission.status)}`}>{getLenderStatusText(submission.status)}</span>
                          </div>
                          
                          {/* Submission Details */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                            {submission.offered_amount && (
                              <div className="bg-green-50 rounded-lg p-3">
                                <div className="text-xs font-medium text-green-700 uppercase tracking-wide">Offered Amount</div>
                                <div className="text-lg font-bold text-green-900">${Number(submission.offered_amount).toLocaleString()}</div>
                              </div>
                            )}
                            
                            {submission.factor_rate && (
                              <div className="bg-blue-50 rounded-lg p-3">
                                <div className="text-xs font-medium text-blue-700 uppercase tracking-wide">Factor Rate</div>
                                <div className="text-lg font-bold text-blue-900">{submission.factor_rate}</div>
                              </div>
                            )}
                            
                            {submission.terms && (
                              <div className="bg-purple-50 rounded-lg p-3">
                                <div className="text-xs font-medium text-purple-700 uppercase tracking-wide">Terms</div>
                                <div className="text-sm font-semibold text-purple-900">{submission.terms}</div>
                              </div>
                            )}
                          </div>
                          
                          {submission.response && (
                            <div className="mt-4 bg-gray-50 rounded-lg p-3">
                              <div className="text-xs font-medium text-gray-700 uppercase tracking-wide mb-2">Response</div>
                              <div className="text-sm text-gray-900">{submission.response}</div>
                            </div>
                          )}
                          
                          {submission.notes && (
                            <div className="mt-4 bg-yellow-50 rounded-lg p-3">
                              <div className="text-xs font-medium text-yellow-700 uppercase tracking-wide mb-2">Notes</div>
                              <div className="text-sm text-yellow-900">{submission.notes}</div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Enhanced Footer */}
              <div className="mt-8 pt-6 border-t border-gray-200/80 flex justify-end gap-4">
                <button
                  onClick={() => setShowDetails(false)}
                  className="px-6 py-3 border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 font-semibold text-gray-700 transition-all duration-200 shadow-sm hover:shadow-md"
                >
                  Close
                </button>
                {/* 'Edit Deal' button removed by request */}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AllDealsPortal;