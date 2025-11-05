import React, { useState } from 'react';
import { Building2, Users, Settings, FileText, Plus, Edit, Trash2, Eye, CheckCircle, XCircle, AlertCircle, Search, Phone, Mail, DollarSign, Building, Briefcase, Star } from 'lucide-react';
import { supabase, getLenders, createLender, updateLender, deleteLender, getApplications, getLenderSubmissions, updateApplication, deleteApplication, updateLenderSubmission, createLenderSubmissions, getUsersByRole, Lender as DBLender, Application as DBApplication, LenderSubmission as DBLenderSubmission, User as DBUser } from '../lib/supabase';

const AdminPortal: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'applications' | 'lenders' | 'deal-users' | 'settings'>('applications');
  const [showLenderForm, setShowLenderForm] = useState(false);
  const [editingLender, setEditingLender] = useState<DBLender | null>(null);
  const [showApplicationDetails, setShowApplicationDetails] = useState(false);
  const [showEmailTemplateSettings, setShowEmailTemplateSettings] = useState(false);
  const [emailTemplate, setEmailTemplate] = useState(() => {
    const saved = localStorage.getItem('mcaPortalEmailTemplate');
    return saved || `Subject: Merchant Cash Advance Application - {{businessName}}

Dear {{lenderName}} Team,

I hope this email finds you well. I am writing to submit a merchant cash advance application for your review and consideration.

BUSINESS INFORMATION:
• Business Name: {{businessName}}
• Owner: {{ownerName}}
• Industry: {{industry}}
• Years in Business: {{yearsInBusiness}}
• Business Type: {{businessType}}
• EIN: {{ein}}

FINANCIAL DETAILS:
• Requested Amount: \${{requestedAmount}}
• Monthly Revenue: \${{monthlyRevenue}}
• Annual Revenue: \${{annualRevenue}}
• Credit Score: {{creditScore}}
• Existing Debt: \${{existingDebt}}

CONTACT INFORMATION:
• Email: {{email}}
• Phone: {{phone}}
• Address: {{address}}

I have attached the following documents for your review:
• Business bank statements (last 6 months)
• Tax returns
• Completed application form
• Voided business check

Based on your underwriting guidelines, I believe this application aligns well with your lending criteria:
• Amount Range: \${{lenderMinAmount}} - \${{lenderMaxAmount}}
• Factor Rate: {{lenderFactorRate}}
• Payback Term: {{lenderPaybackTerm}}
• Approval Time: {{lenderApprovalTime}}

I would appreciate the opportunity to discuss this application further and answer any questions you may have. Please let me know if you need any additional information or documentation.

Thank you for your time and consideration. I look forward to hearing from you soon.

Best regards,
{{ownerName}}
{{businessName}}
{{email}}
{{phone}}

---
This application was submitted through MCAPortal Pro
Application ID: {{applicationId}}`;
  });
  const [selectedApplication, setSelectedApplication] = useState<DBApplication & { matchedLenders: number } | null>(null);
  const [lenders, setLenders] = useState<DBLender[]>([]);
  const [applications, setApplications] = useState<(DBApplication & { matchedLenders: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingApplication, setEditingApplication] = useState<(DBApplication & Partial<{ matchedLenders: number }>) | null>(null);
  const [showEditApplication, setShowEditApplication] = useState(false);
  const [applicationSubmissions, setApplicationSubmissions] = useState<(DBLenderSubmission & { lender: DBLender })[]>([]);
  const [showAddSubmission, setShowAddSubmission] = useState(false);
  // Per-submission validation flags
  const [submissionValidation, setSubmissionValidation] = useState<Record<string, { responseRequired?: boolean; offeredRequired?: boolean; factorRequired?: boolean; termsRequired?: boolean }>>({});
  // Toast notification state
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVariant, setToastVariant] = useState<'error' | 'success' | 'warning'>('error');
  // Deal Users (members)
  const [dealUsers, setDealUsers] = useState<DBUser[]>([]);
  const [dealUsersLoading, setDealUsersLoading] = useState(false);
  const [selectedDealUser, setSelectedDealUser] = useState<DBUser | null>(null);
  const [showUserApplications, setShowUserApplications] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [confirmDeleteLenderId, setConfirmDeleteLenderId] = useState<string | null>(null);

  const [lenderFormData, setLenderFormData] = useState<{
    name: string;
    contactEmail: string;
    ccEmails: string[];
    phone: string;
    status: 'active' | 'inactive' | 'pending';
    rating: number;
    minAmount: number;
    maxAmount: number;
    minCreditScore: number;
    maxCreditScore: number;
    minTimeInBusiness: number;
    minMonthlyRevenue: number;
    industries: string[];
    factorRate: string;
    paybackTerm: string;
    approvalTime: string;
    features: string[];
    category: 'Daily' | 'Weekly' | 'Monthly' | 'Bi-Weekly';
    negativeDays: number | null;
    minPositions: number | null;
    maxPositions: number | null;
    restrictedState: string;
  }>({
    name: '',
    contactEmail: '',
    ccEmails: [] as string[],
    phone: '',
    status: 'active' as 'active' | 'inactive' | 'pending',
    rating: 4.0,
    minAmount: 10000,
    maxAmount: 500000,
    minCreditScore: 550,
    maxCreditScore: 850,
    minTimeInBusiness: 1,
    minMonthlyRevenue: 15000,
    industries: [] as string[],
    factorRate: '1.1 - 1.4',
    paybackTerm: '3-18 months',
    approvalTime: '24 hours',
    features: [] as string[],
    category: 'Monthly',
    negativeDays: null,
    minPositions: null,
    maxPositions: null,
    restrictedState: ''
  });
  const [ccEmailInput, setCcEmailInput] = useState('');

  const availableIndustries = [
    'All Industries', 'Retail', 'Restaurant', 'Healthcare', 'Professional Services',
    'Technology', 'Construction', 'Transportation', 'Manufacturing', 'Real Estate',
    'Automotive', 'Education', 'Entertainment', 'Agriculture', 'Finance'
  ];

  const availableFeatures = [
    'No collateral required', 'Same day funding', 'Flexible payments',
    'Competitive rates', 'Larger amounts', 'Industry expertise',
    'Instant approval', 'Bad credit OK', 'Fast funding',
    'Best rates', 'Large amounts', 'Premium service',
    'Merchant-focused', 'Flexible terms'
  ];

  // Load data from Supabase
  React.useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        // Load lenders and applications in parallel
        const [dbLenders, dbApplications] = await Promise.all([
          getLenders(),
          getApplications()
        ]);

        // Show apps immediately without per-app network calls
        setLenders(dbLenders);
        setApplications(
          dbApplications.map(app => ({ ...app, matchedLenders: 0 }))
        );
        setLoading(false);

        // Background: batch fetch submission counts for visible apps
        try {
          const appIds = dbApplications.map(a => a.id);
          if (appIds.length > 0) {
            const { data: subs, error } = await supabase
              .from('lender_submissions')
              .select('application_id')
              .in('application_id', appIds);
            if (!error && subs) {
              const counts: Record<string, number> = {};
              (subs as { application_id: string }[]).forEach(s => {
                counts[s.application_id] = (counts[s.application_id] || 0) + 1;
              });
              setApplications(prev => prev.map(a => ({ ...a, matchedLenders: counts[a.id] || 0 })));
            }
          }
        } catch (bgErr) {
          console.warn('Background submissions count fetch failed', bgErr);
        }
      } catch (error) {
        console.error('Error loading data:', error);
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Filter + Search (match AllDealsPortal behavior)
  const filteredApplications: (DBApplication & { matchedLenders: number })[] = applications.filter((app) => {
    const q = (searchQuery || '').trim().toLowerCase();
    const matchesStatus = statusFilter === 'all' || (app.status as string) === statusFilter;
    if (!q) return matchesStatus;

    const haystack = [
      app.business_name || '',
      app.industry || '',
      app.owner_name || '',
      app.email || '',
      app.phone || '',
      app.address || '',
      app.id || '',
    ]
      .join(' ')
      .toLowerCase();

    const tokens = q.split(/\s+/).filter(Boolean);
    const matchesSearch = tokens.every((t) => haystack.includes(t));
    return matchesSearch && matchesStatus;
  });

  const statusCounts = {
    all: applications.length,
    draft: applications.filter((d) => d.status === 'draft').length,
    readyToSubmit: applications.filter((d) => d.status === 'ready-to-submit').length,
    sentToLenders: applications.filter((d) => d.status === 'sent-to-lenders').length,
    underNegotiation: applications.filter((d) => d.status === 'under-negotiation').length,
    contractOut: applications.filter((d) => d.status === 'contract-out').length,
    contractIn: applications.filter((d) => d.status === 'contract-in').length,
    approved: applications.filter((d) => d.status === 'approved').length,
    funded: applications.filter((d) => d.status === 'funded').length,
    declined: applications.filter((d) => d.status === 'declined').length,
    dealLostWithOffers: applications.filter((d) => d.status === 'deal-lost-with-offers').length,
    dealLostNoOffers: applications.filter((d) => d.status === 'deal-lost-no-offers').length,
  };

  // Load Deal Users (members) when Deal Users tab is activated
  React.useEffect(() => {
    const loadMembers = async () => {
      if (activeTab !== 'deal-users') return;
      try {
        setDealUsersLoading(true);
        const [members, adminsLower, adminsTitle] = await Promise.all([
          getUsersByRole('member'),
          getUsersByRole('admin').catch(() => [] as DBUser[]),
          getUsersByRole('Admin').catch(() => [] as DBUser[]),
        ]);
        // Merge and de-duplicate by id
        const merged: Record<string, DBUser> = {};
        [...members, ...adminsLower, ...adminsTitle].forEach(u => { merged[u.id] = u; });
        setDealUsers(Object.values(merged));
      } catch (error) {
        console.error('Error loading deal users:', error);
      } finally {
        setDealUsersLoading(false);
      }
    };
    loadMembers();
  }, [activeTab]);

  // Load lender submissions for a given application
  const loadApplicationSubmissions = async (applicationId: string) => {
    try {
      const subs = await getLenderSubmissions(applicationId);
      // Normalize any legacy/alias values to the live DB statuses
      const normalized = (subs as (DBLenderSubmission & { lender: DBLender })[]).map(s => ({
        ...s,
        status: (canonicalizeSubmissionStatus(s.status)) ?? s.status,
      }));
      setApplicationSubmissions(normalized);
    } catch (error) {
      console.error('Error loading submissions:', error);
    }
  };

  // View application details
  const handleViewApplication = (app: DBApplication & { matchedLenders: number }) => {
    setSelectedApplication(app);
    setShowApplicationDetails(true);
    loadApplicationSubmissions(app.id);
  };

  // Open edit modal for application
  const handleEditApplication = (app: DBApplication & { matchedLenders: number }) => {
    setEditingApplication(app);
    setShowEditApplication(true);
    loadApplicationSubmissions(app.id);
  };

  // Save application updates
  const handleUpdateApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingApplication) return;

    try {
      // Validate lender submissions before saving application
      const validation: Record<string, { responseRequired?: boolean; offeredRequired?: boolean; factorRequired?: boolean; termsRequired?: boolean }> = {};
      let hasErrors = false;
      applicationSubmissions.forEach((s) => {
        const mapped = mapUiStatusToDb((s.status || '').toString());
        const isDeclined = mapped === 'rejected';
        const isApproved = mapped === 'approved';
        const isCounter = mapped === 'responded';
        const isPending = mapped === 'pending';
        const respEmpty = !s.response || (typeof s.response === 'string' && s.response.trim() === '');
        const amountEmpty = s.offered_amount == null || (typeof s.offered_amount === 'number' && Number.isNaN(s.offered_amount));
        const factorEmpty = !s.factor_rate || (typeof s.factor_rate === 'string' && s.factor_rate.trim() === '');
        const termsEmpty = !s.terms || (typeof s.terms === 'string' && s.terms.trim() === '');
        if ((isDeclined || isPending) && respEmpty) {
          validation[s.id] = { ...(validation[s.id] || {}), responseRequired: true };
          hasErrors = true;
        }
        if ((isApproved || isCounter) && (amountEmpty || factorEmpty || termsEmpty)) {
          validation[s.id] = { ...(validation[s.id] || {}), ...(amountEmpty ? { offeredRequired: true } : {}), ...(factorEmpty ? { factorRequired: true } : {}), ...(termsEmpty ? { termsRequired: true } : {}) };
          hasErrors = true;
        }
      });
      setSubmissionValidation(validation);
      if (hasErrors) {
        // Prevent save and show toast notification
        const hasResponseIssue = Object.values(validation).some(v => v.responseRequired);
        const hasApproveIssue = Object.values(validation).some(v => v.offeredRequired || v.factorRequired || v.termsRequired);
        if (hasResponseIssue) {
          // Determine if any pending; otherwise treat as declined
          const anyPending = applicationSubmissions.some(s => mapUiStatusToDb((s.status || '').toString()) === 'pending' && (!s.response || (typeof s.response === 'string' && s.response.trim() === '')));
          if (anyPending) {
            setToastMessage('Please provide a Response for submissions marked Pending.');
            setToastVariant('warning');
          } else {
            setToastMessage('Please provide a Response explaining why a submission is Declined.');
            setToastVariant('error');
          }
        } else if (hasApproveIssue) {
          setToastMessage('Please fill in Offered Amount, Factor Rate, and Terms for Approved or Counter Offer submissions.');
          setToastVariant('success');
        }
        setShowToast(true);
        setTimeout(() => setShowToast(false), 4000);
        return;
      }

      // Map UI status labels to DB-allowed enum values (hotfix for applications_status_check)
      const mapUiAppStatusToDb = (status?: string | null): DBApplication['status'] | undefined => {
        if (!status) return undefined as unknown as DBApplication['status'];
        const s = status.trim().toLowerCase().replace(/\s+/g, '-');
        if (s === 'ready-to-submit') return 'submitted' as DBApplication['status'];
        if (s === 'sent-to-lenders') return 'submitted' as DBApplication['status'];
        if (s === 'under-negotiation') return 'under-review' as DBApplication['status'];
        if (s === 'contract-out') return 'under-review' as DBApplication['status'];
        if (s === 'contract-in') return 'approved' as DBApplication['status'];
        if (s === 'deal-lost-with-offers' || s === 'deal-lost-no-offers') return 'declined' as DBApplication['status'];
        return s as DBApplication['status'];
      };

      const dbUpdateData: Partial<DBApplication> = {
        business_name: editingApplication.business_name,
        owner_name: editingApplication.owner_name,
        email: editingApplication.email,
        phone: editingApplication.phone,
        address: editingApplication.address,
        ein: editingApplication.ein,
        business_type: editingApplication.business_type,
        industry: editingApplication.industry,
        years_in_business: editingApplication.years_in_business,
        number_of_employees: editingApplication.number_of_employees,
        annual_revenue: editingApplication.annual_revenue,
        monthly_revenue: editingApplication.monthly_revenue,
        monthly_deposits: editingApplication.monthly_deposits,
        existing_debt: editingApplication.existing_debt,
        credit_score: editingApplication.credit_score,
        requested_amount: editingApplication.requested_amount,
        status: mapUiAppStatusToDb(editingApplication.status as string),
        documents: editingApplication.documents,
        user_id: editingApplication.user_id,
      };
      let updated: DBApplication;
      try {
        // First attempt: save exact UI status (for DBs that already accept new values)
        const exactPayload = { ...dbUpdateData, status: editingApplication.status as DBApplication['status'] } as Partial<DBApplication>;
        updated = await updateApplication(editingApplication.id, exactPayload);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === '23514') {
          // Constraint prevents new values; fallback to mapped legacy value
          updated = await updateApplication(editingApplication.id, dbUpdateData);
        } else {
          throw err;
        }
      }

      setApplications(prev => prev.map(app => 
        app.id === editingApplication.id 
          ? { ...updated, matchedLenders: editingApplication.matchedLenders || app.matchedLenders }
          : app
      ));
      setShowEditApplication(false);
      setEditingApplication(null);
    } catch (error) {
      console.error('Error updating application:', error);
      alert('Error updating application');
    }
  };

  

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading admin data...</p>
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': case 'matched': case 'funded':
        return 'bg-green-100 text-green-800';
      case 'inactive': case 'declined': case 'rejected': case 'deal-lost-with-offers': case 'deal-lost-no-offers':
        return 'bg-red-100 text-red-800';
      case 'pending': case 'under-review': case 'sent': case 'ready-to-submit': case 'sent-to-lenders':
        return 'bg-yellow-100 text-yellow-800';
      case 'submitted': case 'responded': case 'under-negotiation':
        return 'bg-blue-100 text-blue-800';
      case 'contract-out':
        return 'bg-purple-100 text-purple-800';
      case 'contract-in':
        return 'bg-indigo-100 text-indigo-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleDeleteLender = async (lenderId: string) => {
    try {
      await deleteLender(lenderId);
      setLenders(prev => prev.filter(l => l.id !== lenderId));
    } catch (error) {
      console.error('Error deleting lender:', error);
      alert('Error deleting lender. Please try again.');
    }
  };

  const handleEditLender = (lender: DBLender) => {
    setLenderFormData({
      name: lender.name,
      contactEmail: lender.contact_email || '',
      ccEmails: (lender.cc_emails as unknown as string[]) || [],
      phone: lender.phone || '',
      status: (lender.status as 'active' | 'inactive' | 'pending') || 'active',
      rating: (lender.rating ?? 0),
      minAmount: (lender.min_amount ?? 0),
      maxAmount: (lender.max_amount ?? 0),
      minCreditScore: (lender.min_credit_score ?? 0),
      maxCreditScore: (lender.max_credit_score ?? 0),
      minTimeInBusiness: (lender.min_time_in_business ?? 0),
      minMonthlyRevenue: (lender.min_monthly_revenue ?? 0),
      industries: lender.industries || [],
      factorRate: lender.factor_rate || '',
      paybackTerm: lender.payback_term || '',
      approvalTime: lender.approval_time || '',
      features: lender.features,
      category: ((val: unknown) => {
        const allowed = ['Daily','Weekly','Monthly','Bi-Weekly'] as const;
        return (allowed as readonly string[]).includes((val as string)) ? (val as 'Daily'|'Weekly'|'Monthly'|'Bi-Weekly') : 'Monthly';
      })((lender as unknown as { frequency?: string })?.frequency),
      negativeDays: (() => {
        const v = (lender as unknown as { negative_days?: number | null })?.negative_days ?? null;
        return v != null && v < 0 ? null : v;
      })(),
      minPositions: (() => {
        const v = (lender as unknown as { min_positions?: number | null })?.min_positions ?? null;
        return v != null && v < 0 ? null : v;
      })(),
      maxPositions: (() => {
        const v = (lender as unknown as { max_positions?: number | null })?.max_positions ?? null;
        return v != null && v < 0 ? null : v;
      })(),
      restrictedState: (lender as unknown as { restricted_state?: string | null })?.restricted_state ?? '',
    });
    setEditingLender(lender);
    setShowLenderForm(true);
  };

  const handleViewUserApplications = (user: DBUser) => {
    setSelectedDealUser(user);
    setSearchQuery(''); // Reset search when opening modal
    setShowUserApplications(true);
  };


  const handleAddNewLender = () => {
    setLenderFormData({
      name: '',
      contactEmail: '',
      ccEmails: [],
      phone: '',
      status: 'active',
      rating: 4.0,
      minAmount: 10000,
      maxAmount: 500000,
      minCreditScore: 550,
      maxCreditScore: 850,
      minTimeInBusiness: 1,
      minMonthlyRevenue: 15000,
      industries: [],
      factorRate: '1.1 - 1.4',
      paybackTerm: '3-18 months',
      approvalTime: '24 hours',
      features: [],
      category: 'Monthly',
      negativeDays: null,
      minPositions: null,
      maxPositions: null,
      restrictedState: ''
    });
    setEditingLender(null);
    setShowLenderForm(true);
  };

  const addCcEmail = () => {
    const email = ccEmailInput.trim();
    const isValid = /.+@.+\..+/.test(email);
    if (!email || !isValid) return;
    setLenderFormData(prev => ({ ...prev, ccEmails: Array.from(new Set([...(prev.ccEmails || []), email])) }));
    setCcEmailInput('');
  };

  const removeCcEmail = (email: string) => {
    setLenderFormData(prev => ({ ...prev, ccEmails: (prev.ccEmails || []).filter(e => e !== email) }));
  };

  const handleIndustryToggle = (industry: string) => {
    setLenderFormData(prev => ({
      ...prev,
      industries: prev.industries.includes(industry)
        ? prev.industries.filter(i => i !== industry)
        : [...prev.industries, industry]
    }));
  };

  const handleFeatureToggle = (feature: string) => {
    setLenderFormData(prev => ({
      ...prev,
      features: prev.features.includes(feature)
        ? prev.features.filter(f => f !== feature)
        : [...prev.features, feature]
    }));
  };

  const handleSaveLender = () => {
    const saveLenderAsync = async () => {
      try {
        const ccPart = (lenderFormData.ccEmails || []).length ? { cc_emails: lenderFormData.ccEmails } : {};
        const clampInt = (v: number | null) => (v == null || Number.isNaN(v) ? null : Math.max(0, Math.floor(v)));
        const clampRating = (v: number) => {
          const n = Number(v);
          if (!Number.isFinite(n)) return 1;
          return Math.min(5, Math.max(1, n));
        };
        const lenderData = {
          name: lenderFormData.name,
          contact_email: lenderFormData.contactEmail,
          ...ccPart,
          phone: lenderFormData.phone,
          status: lenderFormData.status,
          rating: clampRating(lenderFormData.rating),
          total_applications: 0,
          approval_rate: 0,
          min_amount: lenderFormData.minAmount,
          max_amount: lenderFormData.maxAmount,
          min_credit_score: lenderFormData.minCreditScore,
          max_credit_score: lenderFormData.maxCreditScore,
          min_time_in_business: lenderFormData.minTimeInBusiness,
          min_monthly_revenue: lenderFormData.minMonthlyRevenue,
          industries: lenderFormData.industries,
          factor_rate: lenderFormData.factorRate,
          payback_term: lenderFormData.paybackTerm,
          approval_time: lenderFormData.approvalTime,
          frequency: lenderFormData.category,
          negative_days: clampInt(lenderFormData.negativeDays),
          min_positions: clampInt(lenderFormData.minPositions),
          max_positions: clampInt(lenderFormData.maxPositions),
          restricted_state: lenderFormData.restrictedState.trim() === '' ? null : lenderFormData.restrictedState.trim(),
          features: lenderFormData.features
        };

        if (editingLender) {
          // Update existing lender
          const updatedLender = await updateLender(editingLender.id, lenderData);
          setLenders(prev => prev.map(lender => 
            lender.id === editingLender.id ? updatedLender : lender
          ));
        } else {
          // Add new lender
          const newLender = await createLender(lenderData);
          setLenders(prev => [...prev, newLender]);
        }
        
        // Reset form and close modal
        setShowLenderForm(false);
        setEditingLender(null);
      } catch (error) {
        console.error('Error saving lender:', error);
        alert('Error saving lender. Please try again.');
      }
    };
    
    saveLenderAsync();
  };

  const handleDeleteApplication = (applicationId: string) => {
    if (confirm('Are you sure you want to delete this application? This action cannot be undone.')) {
      const deleteApplicationAsync = async () => {
        try {
          await deleteApplication(applicationId);
          setApplications(prev => prev.filter(app => app.id !== applicationId));
        } catch (error) {
          console.error('Error deleting application:', error);
          alert('Error deleting application. Please try again.');
        }
      };
      deleteApplicationAsync();
    }
  };

  // Optimistic local update to avoid async race conditions while typing
  const updateSubmissionLocal = (submissionId: string, updates: Partial<DBLenderSubmission>) => {
    setApplicationSubmissions(prev =>
      prev.map(sub => (sub.id === submissionId ? { ...sub, ...updates } : sub))
    );
  };

  // Canonicalize status variations to live DB statuses
  const canonicalizeSubmissionStatus = (status?: string | null): DBLenderSubmission['status'] | undefined => {
    if (!status) return undefined;
    const s = status.trim().toLowerCase().replace(/_/g, '-');
    // Map legacy aliases to DB statuses
    if (s === 'decline' || s === 'declined' || s === 'rejected') return 'rejected' as DBLenderSubmission['status'];
    if (s === 'fund' || s === 'funded' || s === 'approved') return 'approved' as DBLenderSubmission['status'];
    if (s === 'counter-offer' || s === 'counter offer' || s === 'counteroffer' || s === 'responded') return 'responded' as DBLenderSubmission['status'];
    if (s === 'sent') return 'sent' as DBLenderSubmission['status'];
    if (s === 'pending') return 'pending' as DBLenderSubmission['status'];
    return status as DBLenderSubmission['status'];
  };

  // Translate UI status values to DB-allowed values before persisting
  // Live DB allows: pending, sent, responded, approved, rejected
  const mapUiStatusToDb = (status?: string | null): string | undefined => {
    if (!status) return undefined;
    const s = status.trim().toLowerCase().replace(/_/g, '-');
    if (s === 'pending') return 'pending';
    if (s === 'approved') return 'approved';
    if (s === 'declined' || s === 'decline' || s === 'rejected') return 'rejected';
    if (s === 'counter-offer' || s === 'counter offer' || s === 'counteroffer' || s === 'responded') return 'responded';
    if (s === 'fund' || s === 'funded') return 'approved';
    if (s === 'sent') return 'sent';
    return status || undefined;
  };

  // Persist changes to backend when user finishes editing (e.g., onBlur)
  const persistSubmissionChange = async (submissionId: string, updates: Partial<DBLenderSubmission>) => {
    try {
      // Map UI status to DB-allowed values prior to persisting
      const dbPatch: Partial<Record<keyof DBLenderSubmission, unknown>> = { ...(updates as Partial<Record<keyof DBLenderSubmission, unknown>>) };
      // If a field is explicitly cleared in the UI, persist it as null
      const nullableFields: (keyof DBLenderSubmission)[] = [
        'offered_amount',
        'factor_rate',
        'terms',
        'response',
        'notes',
      ];
      nullableFields.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(updates, key)) {
          const v = (updates as Partial<Record<keyof DBLenderSubmission, unknown>>)[key];
          if (v === undefined || v === '') {
            (dbPatch as Partial<Record<keyof DBLenderSubmission, unknown>>)[key] = null;
          }
        }
      });
      if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
        const dbStatus = mapUiStatusToDb(updates.status as string | null | undefined);
        if (dbStatus) (dbPatch as Partial<Record<keyof DBLenderSubmission, unknown>>).status = dbStatus as DBLenderSubmission['status'];
      }
      const updatedSubmission = await updateLenderSubmission(submissionId, dbPatch as unknown as Partial<DBLenderSubmission>);
      // Normalize status back to the canonical values used by the UI options
      const normalizedStatus = canonicalizeSubmissionStatus(updatedSubmission.status as DBLenderSubmission['status']);
      setApplicationSubmissions(prev =>
        prev.map(sub => (sub.id === submissionId ? { ...sub, ...updatedSubmission, ...(normalizedStatus ? { status: normalizedStatus } : {}) } : sub))
      );
    } catch (error) {
      console.error('Error persisting submission change:', error);
      const message = (error as Error)?.message || (error as {error_description?: string})?.error_description || JSON.stringify(error);
      alert(`Error updating submission: ${message}`);
    }
  };

  const handleAddLenderSubmission = async (lenderId: string) => {
    if (!editingApplication) return;

    try {
      await createLenderSubmissions(editingApplication.id, [lenderId]);
      loadApplicationSubmissions(editingApplication.id);
      setShowAddSubmission(false);
    } catch (error) {
      console.error('Error adding lender submission:', error);
      alert('Error adding lender submission');
    }
  };

  // Legacy user permission editing removed; handled in AllDealsPortal now

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Admin Portal</h1>
        <p className="text-gray-600">Manage applications, lenders, and underwriting guidelines</p>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200 mb-8">
        <nav className="flex flex-wrap gap-4 overflow-x-auto no-scrollbar -mx-1 px-1">
          <button
            onClick={() => setActiveTab('applications')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'applications'
                ? 'border-emerald-500 text-emerald-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Users className="w-5 h-5 inline mr-2" />
            Applications
          </button>
          <button
            onClick={() => setActiveTab('lenders')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'lenders'
                ? 'border-emerald-500 text-emerald-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Building2 className="w-5 h-5 inline mr-2" />
            Lenders
          </button>
          <button
            onClick={() => setActiveTab('deal-users')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'deal-users'
                ? 'border-emerald-500 text-emerald-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Users className="w-5 h-5 inline mr-2" />
            Deal Users
          </button>
          <button
            onClick={() => setShowEmailTemplateSettings(true)}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center text-sm"
          >
            <Mail className="w-4 h-4 mr-2" />
            Email Template
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'settings'
                ? 'border-emerald-500 text-emerald-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Settings className="w-5 h-5 inline mr-2" />
            Settings
          </button>
        </nav>
      </div>

      {/* Applications Tab */}
      {activeTab === 'applications' && (
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Applications Management</h2>
              <p className="text-gray-600 mt-1">Monitor and manage all merchant cash advance applications</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <svg className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input
                  type="text"
                  placeholder="Search by business, contact, phone, email, ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 text-sm bg-white"
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

          <div className="bg-white rounded-2xl shadow-lg border border-gray-200/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-gradient-to-r from-emerald-50 via-green-50 to-teal-50 border-b border-gray-200/60">
                    <th className="px-8 py-5 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                      <div className="flex items-center space-x-2">
                        <Building2 className="w-4 h-4 text-emerald-600" />
                        <span>Business</span>
                      </div>
                    </th>
                    <th className="px-8 py-5 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                      <div className="flex items-center space-x-2">
                        <span className="text-green-600">$</span>
                        <span>Amount</span>
                      </div>
                    </th>
                    <th className="px-8 py-5 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                      <div className="flex items-center space-x-2">
                        <Star className="w-4 h-4 text-yellow-600" />
                        <span>Financial</span>
                      </div>
                    </th>
                    <th className="px-8 py-5 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                      <div className="flex items-center space-x-2">
                        <CheckCircle className="w-4 h-4 text-blue-600" />
                        <span>Status</span>
                      </div>
                    </th>
                    <th className="px-8 py-5 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                      <div className="flex items-center space-x-2">
                        <Users className="w-4 h-4 text-purple-600" />
                        <span>Lenders</span>
                      </div>
                    </th>
                    <th className="px-8 py-5 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                      <div className="flex items-center justify-center space-x-2">
                        <Settings className="w-4 h-4 text-orange-600" />
                        <span>Actions</span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100/80">
                  {loading && (
                    <tr>
                      <td colSpan={6} className="px-8 py-16 text-center">
                        <div className="flex flex-col items-center">
                          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600 mb-4"></div>
                          <p className="text-gray-500 text-sm font-medium">Loading applications...</p>
                        </div>
                      </td>
                    </tr>
                  )}
                  {!loading && filteredApplications.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-8 py-16 text-center">
                        <div className="flex flex-col items-center">
                          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                            <Building2 className="h-8 w-8 text-gray-400" />
                          </div>
                          <h3 className="text-lg font-medium text-gray-900 mb-2">No Applications Found</h3>
                          <p className="text-gray-500 max-w-sm">Applications will appear here once submitted</p>
                        </div>
                      </td>
                    </tr>
                  )}
                  {!loading && filteredApplications.map((app: DBApplication & { matchedLenders: number }) => (
                    <tr key={app.id} className="hover:bg-gradient-to-r hover:from-emerald-50/40 hover:to-green-50/40 transition-all duration-200">
                      <td className="px-8 py-6">
                        <div className="flex items-center space-x-4">
                          <div className="relative">
                            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500 via-emerald-600 to-green-700 flex items-center justify-center shadow-lg">
                              <span className="text-base font-bold text-white">
                                {app.business_name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                          </div>
                          <div>
                            <div className="text-base font-semibold text-gray-900">
                              {app.business_name}
                            </div>
                            <div className="text-sm text-gray-500 mt-0.5 font-mono">
                              {app.owner_name} • ID: {app.id.slice(0, 8)}...
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="text-xl font-bold text-gray-900">${(app.requested_amount ?? 0).toLocaleString()}</div>
                        <div className="text-sm text-gray-500">{app.industry}</div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="text-sm font-medium text-gray-900">${(app.monthly_revenue ?? 0).toLocaleString()}/mo</div>
                        <div className="text-xs text-gray-500 mt-1">Credit: {app.credit_score} • {app.years_in_business}y</div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center">
                          <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold shadow-sm ${getStatusColor(app.status)}`}>
                            <div className={`w-2 h-2 rounded-full mr-2 ${
                              app.status === 'funded' ? 'bg-green-400' :
                              app.status === 'approved' ? 'bg-blue-400' :
                              app.status === 'submitted' ? 'bg-yellow-400' :
                              app.status === 'declined' ? 'bg-red-400' : 'bg-gray-400'
                            }`}></div>
                            {app.status.charAt(0).toUpperCase() + app.status.slice(1)}
                          </span>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="text-sm font-medium text-gray-900">{app.matchedLenders} lenders</div>
                        <div className="text-xs text-gray-500 mt-1">Matched</div>
                      </td>
                      <td className="px-8 py-6 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button 
                            onClick={() => handleViewApplication(app)} 
                            className="inline-flex items-center px-3 py-2 bg-gradient-to-r from-emerald-600 to-green-600 text-white text-xs font-semibold rounded-xl hover:from-emerald-700 hover:to-green-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5" 
                            title="View details"
                          >
                            <Eye className="w-3 h-3" />
                          </button>
                          <button 
                            onClick={() => handleEditApplication(app)} 
                            className="inline-flex items-center px-3 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-semibold rounded-xl hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5" 
                            title="Edit application"
                          >
                            <Edit className="w-3 h-3" />
                          </button>
                          <button 
                            onClick={() => handleDeleteApplication(app.id)} 
                            className="inline-flex items-center px-3 py-2 bg-gradient-to-r from-red-600 to-red-700 text-white text-xs font-semibold rounded-xl hover:from-red-700 hover:to-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5" 
                            title="Delete application"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* User Applications Modal */}
      {showUserApplications && selectedDealUser && (
        <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[85vh] overflow-hidden">
            {/* Enhanced Header */}
            <div className="relative bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-800 p-8">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600/90 to-indigo-800/90"></div>
              <div className="relative">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                      <Users className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-white mb-1">
                        Applications by {selectedDealUser.full_name || 'User'}
                      </h3>
                      <div className="flex items-center space-x-3 text-blue-100">
                        <span className="text-sm">{selectedDealUser.email}</span>
                        <span className="w-1 h-1 bg-blue-200 rounded-full"></span>
                        <span className="text-xs font-mono">ID: {selectedDealUser.id.slice(0, 8)}...</span>
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => setShowUserApplications(false)} 
                    className="w-10 h-10 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center text-white hover:text-blue-100 transition-all duration-200"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Enhanced Body */}
            <div className="p-8">
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-lg font-semibold text-gray-800">Application Portfolio</h4>
                  <div className="flex items-center space-x-2 text-sm text-gray-500">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    <span>{applications.filter(a => a.user_id === selectedDealUser.id && 
                      (searchQuery === '' || 
                       a.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                       a.status.toLowerCase().includes(searchQuery.toLowerCase()) ||
                       a.requested_amount.toString().includes(searchQuery)
                      )).length} Applications</span>
                  </div>
                </div>
                
                {/* Search Box */}
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Search className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    placeholder="Search applications by business name, status, or amount..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 text-sm placeholder-gray-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-gradient-to-br from-gray-50 to-white rounded-xl border border-gray-200/80 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100">
                        <th className="px-8 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-gray-200">
                          <div className="flex items-center space-x-2">
                            <Building2 className="w-4 h-4 text-gray-500" />
                            <span>Business</span>
                          </div>
                        </th>
                        <th className="px-8 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-gray-200">
                          <div className="flex items-center space-x-2">
                            <span className="text-green-600">$</span>
                            <span>Amount</span>
                          </div>
                        </th>
                        <th className="px-8 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-gray-200">
                          <div className="flex items-center space-x-2">
                            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                            <span>Status</span>
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {applications.filter(a => a.user_id === selectedDealUser.id && 
                        (searchQuery === '' || 
                         a.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         a.status.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         a.requested_amount.toString().includes(searchQuery)
                        )).map((app) => (
                        <tr key={app.id} className="hover:bg-gradient-to-r hover:from-blue-50/50 hover:to-indigo-50/30 transition-all duration-200">
                          <td className="px-8 py-6">
                            <div className="flex items-center space-x-3">
                              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-sm">
                                {app.business_name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-semibold text-gray-900 text-base">{app.business_name}</div>
                                <div className="text-sm text-gray-500">{app.industry}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            <div className="text-xl font-bold text-gray-900">${(app.requested_amount ?? 0).toLocaleString()}</div>
                            <div className="text-sm text-gray-500">Requested</div>
                          </td>
                          <td className="px-8 py-6">
                            <span className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold shadow-sm ${getStatusColor(app.status)}`}>
                              <div className={`w-2 h-2 rounded-full mr-2 ${
                                app.status === 'funded' ? 'bg-green-400' :
                                app.status === 'approved' ? 'bg-blue-400' :
                                app.status === 'submitted' ? 'bg-yellow-400' :
                                app.status === 'declined' ? 'bg-red-400' : 'bg-gray-400'
                              }`}></div>
                              {app.status.charAt(0).toUpperCase() + app.status.slice(1)}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {applications.filter(a => a.user_id === selectedDealUser.id && 
                        (searchQuery === '' || 
                         a.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         a.status.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         a.requested_amount.toString().includes(searchQuery)
                        )).length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-8 py-16 text-center">
                            <div className="flex flex-col items-center">
                              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                                <Building2 className="w-8 h-8 text-gray-400" />
                              </div>
                              <h3 className="text-lg font-medium text-gray-900 mb-2">
                                {searchQuery ? 'No Matching Applications' : 'No Applications Found'}
                              </h3>
                              <p className="text-gray-500 max-w-sm">
                                {searchQuery 
                                  ? `No applications match "${searchQuery}". Try a different search term.`
                                  : "This user hasn't submitted any applications yet."
                                }
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Enhanced Footer */}
              <div className="mt-8 flex items-center justify-between pt-6 border-t border-gray-200">
                <div className="text-sm text-gray-500">
                  Showing {applications.filter(a => a.user_id === selectedDealUser.id && 
                    (searchQuery === '' || 
                     a.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                     a.status.toLowerCase().includes(searchQuery.toLowerCase()) ||
                     a.requested_amount.toString().includes(searchQuery)
                    )).length} of {applications.filter(a => a.user_id === selectedDealUser.id).length} applications
                </div>
                <button 
                  onClick={() => setShowUserApplications(false)} 
                  className="px-6 py-3 bg-gradient-to-r from-gray-600 to-gray-700 text-white rounded-xl hover:from-gray-700 hover:to-gray-800 transition-all duration-200 font-medium shadow-lg hover:shadow-xl"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Deal Users Tab */}
      {activeTab === 'deal-users' && (
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Deal Users Management</h2>
              <p className="text-gray-600 mt-1">Manage member accounts and their access permissions</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <span>{dealUsers.length} Active Users</span>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 border-b border-gray-200/60">
                    <th className="px-8 py-5 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                      <div className="flex items-center space-x-2">
                        <Users className="w-4 h-4 text-blue-600" />
                        <span>Member</span>
                      </div>
                    </th>
                    <th className="px-8 py-5 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                      <div className="flex items-center space-x-2">
                        <Mail className="w-4 h-4 text-green-600" />
                        <span>Contact</span>
                      </div>
                    </th>
                    <th className="px-8 py-5 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                      <div className="flex items-center space-x-2">
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                        <span>Status</span>
                      </div>
                    </th>
                    <th className="px-8 py-5 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                      <div className="flex items-center space-x-2">
                        <Star className="w-4 h-4 text-yellow-600" />
                        <span>Joined</span>
                      </div>
                    </th>
                    <th className="px-8 py-5 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                      <div className="flex items-center justify-center space-x-2">
                        <Settings className="w-4 h-4 text-purple-600" />
                        <span>Actions</span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100/80">
                  {dealUsersLoading && (
                    <tr>
                      <td colSpan={5} className="px-8 py-16 text-center">
                        <div className="flex flex-col items-center">
                          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4"></div>
                          <p className="text-gray-500 text-sm font-medium">Loading user accounts...</p>
                        </div>
                      </td>
                    </tr>
                  )}
                  {!dealUsersLoading && dealUsers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-8 py-16 text-center">
                        <div className="flex flex-col items-center">
                          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                            <Users className="h-8 w-8 text-gray-400" />
                          </div>
                          <h3 className="text-lg font-medium text-gray-900 mb-2">No User Accounts Found</h3>
                          <p className="text-gray-500 max-w-sm">User accounts will appear here once created</p>
                        </div>
                      </td>
                    </tr>
                  )}
                  {!dealUsersLoading && dealUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-gradient-to-r hover:from-blue-50/40 hover:to-indigo-50/40 transition-all duration-200">
                      <td className="px-8 py-6">
                        <div className="flex items-center space-x-4">
                          <div className="relative">
                            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700 flex items-center justify-center shadow-lg">
                              <span className="text-base font-bold text-white">
                                {(u.full_name || u.email).charAt(0).toUpperCase()}
                              </span>
                            </div>
                          </div>
                          <div>
                            <div className="text-base font-semibold text-gray-900">
                              {u.full_name || 'Unnamed User'}
                            </div>
                            <div className="text-sm text-gray-500 mt-0.5 font-mono">
                              ID: {u.id.slice(0, 8)}...
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="text-sm font-medium text-gray-900">{u.email}</div>
                        <div className="text-xs text-gray-500 mt-1 flex items-center">
                          <div className="w-1.5 h-1.5 bg-green-400 rounded-full mr-2"></div>
                          Primary contact
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center">
                          <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold shadow-sm ${
                            (u.roles === 'admin' || u.roles === 'Admin') 
                              ? 'bg-purple-100 text-purple-800 border border-purple-200' 
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}>
                            <div className={`w-2 h-2 rounded-full mr-2 ${
                              (u.roles === 'admin' || u.roles === 'Admin') ? 'bg-purple-400' : 'bg-emerald-400'
                            }`}></div>
                            {u.roles || 'Member'}
                          </span>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="text-sm font-medium text-gray-900">
                          {new Date(u.created_at).toLocaleDateString('en-US', { 
                            month: 'short', 
                            day: 'numeric', 
                            year: 'numeric' 
                          })}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {Math.floor((Date.now() - new Date(u.created_at).getTime()) / (1000 * 60 * 60 * 24))} days ago
                        </div>
                      </td>
                      <td className="px-8 py-6 text-center">
                        <button
                          onClick={() => handleViewUserApplications(u)}
                          className="inline-flex items-center px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-semibold rounded-xl hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                          title="View applications submitted by this user"
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          View Applications
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Lenders Tab */}
      {activeTab === 'lenders' && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Lender Management</h2>
            <button
              onClick={() => {
                handleAddNewLender();
              }}
              className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors flex items-center"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Lender
            </button>
          </div>

          <div className="grid gap-6">
            {lenders.map((lender) => (
              <div key={lender.id} className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center">
                    <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center mr-4">
                      <Building2 className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">{lender.name}</h3>
                      <p className="text-gray-600">
                        {lender.contact_email}
                        {Array.isArray(lender.cc_emails) && lender.cc_emails.length > 0 && (
                          <span className="text-gray-500 text-sm ml-2">
                            • CC: {lender.cc_emails.join(', ')}
                          </span>
                        )}
                      </p>
                      <p className="text-gray-500 text-sm">{lender.phone}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(lender.status)}`}>
                      {lender.status}
                    </span>
                    <div className="flex items-center">
                      <Star className="w-4 h-4 text-yellow-400 fill-current mr-1" />
                      <span className="text-sm font-medium">{lender.rating}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                  <div className="bg-blue-50 p-3 rounded-lg">
                    <div className="text-sm text-blue-600 font-medium">Total Applications</div>
                    <div className="text-lg font-bold text-blue-900">{lender.total_applications}</div>
                  </div>
                  <div className="bg-green-50 p-3 rounded-lg">
                    <div className="text-sm text-green-600 font-medium">Approval Rate</div>
                    <div className="text-lg font-bold text-green-900">{lender.approval_rate}%</div>
                  </div>
                  <div className="bg-purple-50 p-3 rounded-lg">
                    <div className="text-sm text-purple-600 font-medium">Amount Range</div>
                    <div className="text-sm font-bold text-purple-900">
                      ${(lender.min_amount ?? 0).toLocaleString()} - ${(lender.max_amount ?? 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-orange-50 p-3 rounded-lg">
                    <div className="text-sm text-orange-600 font-medium">Factor Rate</div>
                    <div className="text-sm font-bold text-orange-900">{lender.factor_rate}</div>
                  </div>
                </div>

                <div className="mb-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Underwriting Guidelines</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Min Credit Score:</span>
                      <span className="ml-1 font-medium">{lender.min_credit_score}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Min Time in Business:</span>
                      <span className="ml-1 font-medium">{lender.min_time_in_business} years</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Min Monthly Revenue:</span>
                      <span className="ml-1 font-medium">${(lender.min_monthly_revenue ?? 0).toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Approval Time:</span>
                      <span className="ml-1 font-medium">{lender.approval_time}</span>
                    </div>
                  </div>
                </div>

                <div className="mb-4">
                  <span className="text-sm text-gray-500">Industries: </span>
                  <span className="text-sm font-medium">
                    {lender.industries.join(', ')}
                  </span>
                </div>

                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => handleEditLender(lender)}
                    className="px-4 py-2 text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50 transition-colors flex items-center"
                  >
                    <Edit className="w-4 h-4 mr-1" />
                    Edit
                  </button>
                  <button
                    onClick={() => setConfirmDeleteLenderId(lender.id)}
                    className="px-4 py-2 text-red-600 border border-red-300 rounded-lg hover:bg-red-50 transition-colors flex items-center"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-6">System Settings</h2>
          <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">General Settings</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Minimum Application Amount
                    </label>
                    <input
                      type="number"
                      defaultValue="10000"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Maximum Application Amount
                    </label>
                    <input
                      type="number"
                      defaultValue="2000000"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
              </div>
              
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Notification Settings</h3>
                <div className="space-y-3">
                  <div className="flex items-center">
                    <input type="checkbox" defaultChecked className="mr-3" />
                    <label className="text-sm text-gray-700">Email notifications for new applications</label>
                  </div>
                  <div className="flex items-center">
                    <input type="checkbox" defaultChecked className="mr-3" />
                    <label className="text-sm text-gray-700">Email notifications for lender matches</label>
                  </div>
                  <div className="flex items-center">
                    <input type="checkbox" className="mr-3" />
                    <label className="text-sm text-gray-700">SMS notifications for urgent matters</label>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="mt-8 pt-6 border-t border-gray-200">
              <button className="bg-emerald-600 text-white px-6 py-2 rounded-lg hover:bg-emerald-700 transition-colors">
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lender Form Modal (simplified for demo) */}
      {showLenderForm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                {editingLender ? 'Edit Lender' : 'Add New Lender'}
              </h3>
            </div>
            <div className="p-6">
              <div className="space-y-6">
                {/* Basic Information */}
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Lender Name *</label>
                      <input
                        type="text"
                        value={lenderFormData.name}
                        onChange={(e) => setLenderFormData(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                        placeholder="Enter lender name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Contact Email *</label>
                      <input
                        type="email"
                        value={lenderFormData.contactEmail}
                        onChange={(e) => setLenderFormData(prev => ({ ...prev, contactEmail: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                        placeholder="contact@lender.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">CC Emails</label>
                      <div className="w-full">
                        <div className="flex items-center gap-2 mb-2">
                          <input
                            type="email"
                            value={ccEmailInput}
                            onChange={(e) => setCcEmailInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ',') {
                                e.preventDefault();
                                addCcEmail();
                              }
                            }}
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                            placeholder="cc@example.com"
                          />
                          <button
                            type="button"
                            onClick={addCcEmail}
                            className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm"
                          >
                            Add
                          </button>
                        </div>
                        {(lenderFormData.ccEmails || []).length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {lenderFormData.ccEmails!.map(email => (
                              <span key={email} className="inline-flex items-center gap-2 px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-xs">
                                {email}
                                <button type="button" onClick={() => removeCcEmail(email)} className="text-gray-500 hover:text-gray-800">
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                      <input
                        type="tel"
                        value={lenderFormData.phone}
                        onChange={(e) => setLenderFormData(prev => ({ ...prev, phone: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                        placeholder="(555) 123-4567"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                      <select
                        value={lenderFormData.status}
                        onChange={(e) => setLenderFormData(prev => ({ ...prev, status: e.target.value as 'active' | 'inactive' | 'pending' }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="pending">Pending</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Rating</label>
                      <input
                        type="number"
                        min="1"
                        max="5"
                        step="0.1"
                        value={lenderFormData.rating}
                        onChange={(e) => setLenderFormData(prev => ({ ...prev, rating: parseFloat(e.target.value) }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Restricted State</label>
                      <input
                        type="text"
                        value={lenderFormData.restrictedState}
                        onChange={(e) => setLenderFormData(prev => ({ ...prev, restrictedState: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                        placeholder="e.g., CA, NY (comma-separated)"
                      />
                    </div>
                  </div>
                </div>

                {/* Underwriting Guidelines */}
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 mb-4">Underwriting Guidelines</h4>
                  
                  {/* Amount Range */}
                  <div className="mb-6">
                    <h5 className="font-medium text-gray-700 mb-3">Funding Range</h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Minimum Amount ($)</label>
                        <input
                          type="number"
                          value={lenderFormData.minAmount}
                          onChange={(e) => setLenderFormData(prev => ({ ...prev, minAmount: parseInt(e.target.value) }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Maximum Amount ($)</label>
                        <input
                          type="number"
                          value={lenderFormData.maxAmount}
                          onChange={(e) => setLenderFormData(prev => ({ ...prev, maxAmount: parseInt(e.target.value) }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Neg Days & Positions (moved here under Funding Range) */}
                  <div className="mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Number of Neg days</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={lenderFormData.negativeDays ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLenderFormData(prev => ({ ...prev, negativeDays: val === '' ? null : parseInt(val) }));
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                          placeholder="e.g., 3"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Minimum position count</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={lenderFormData.minPositions ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLenderFormData(prev => ({ ...prev, minPositions: val === '' ? null : parseInt(val) }));
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                          placeholder="e.g., 1"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Maximum position count</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={lenderFormData.maxPositions ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLenderFormData(prev => ({ ...prev, maxPositions: val === '' ? null : parseInt(val) }));
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                          placeholder="e.g., 5"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Credit Score Range */}
                  <div className="mb-6">
                    <h5 className="font-medium text-gray-700 mb-3">Credit Score Requirements</h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Minimum Credit Score</label>
                        <input
                          type="number"
                          min="300"
                          max="850"
                          value={lenderFormData.minCreditScore}
                          onChange={(e) => setLenderFormData(prev => ({ ...prev, minCreditScore: parseInt(e.target.value) }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Maximum Credit Score</label>
                        <input
                          type="number"
                          min="300"
                          max="850"
                          value={lenderFormData.maxCreditScore}
                          onChange={(e) => setLenderFormData(prev => ({ ...prev, maxCreditScore: parseInt(e.target.value) }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Business Requirements */}
                  <div className="mb-6">
                    <h5 className="font-medium text-gray-700 mb-3">Business Requirements</h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Minimum Time in Business (years)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={lenderFormData.minTimeInBusiness}
                          onChange={(e) => setLenderFormData(prev => ({ ...prev, minTimeInBusiness: parseFloat(e.target.value) }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Minimum Monthly Revenue ($)</label>
                        <input
                          type="number"
                          value={lenderFormData.minMonthlyRevenue}
                          onChange={(e) => setLenderFormData(prev => ({ ...prev, minMonthlyRevenue: parseInt(e.target.value) }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Terms */}
                  <div className="mb-6">
                    <h5 className="font-medium text-gray-700 mb-3">Terms & Processing</h5>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Factor Rate</label>
                        <input
                          type="text"
                          value={lenderFormData.factorRate}
                          onChange={(e) => setLenderFormData(prev => ({ ...prev, factorRate: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                          placeholder="1.1 - 1.4"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Payback Term</label>
                        <input
                          type="text"
                          value={lenderFormData.paybackTerm}
                          onChange={(e) => setLenderFormData(prev => ({ ...prev, paybackTerm: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                          placeholder="3-18 months"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Approval Time</label>
                        <input
                          type="text"
                          value={lenderFormData.approvalTime}
                          onChange={(e) => setLenderFormData(prev => ({ ...prev, approvalTime: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                          placeholder="24 hours"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Frequency</label>
                        <select
                          value={lenderFormData.category}
                          onChange={(e) => setLenderFormData(prev => ({ ...prev, category: e.target.value as 'Daily' | 'Weekly' | 'Monthly' | 'Bi-Weekly' }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white"
                        >
                          <option value="Daily">Daily</option>
                          <option value="Weekly">Weekly</option>
                          <option value="Monthly">Monthly</option>
                          <option value="Bi-Weekly">Bi-Weekly</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Industries */}
                  <div className="mb-6">
                    <h5 className="font-medium text-gray-700 mb-3">Accepted Industries</h5>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {availableIndustries.map(industry => (
                        <label key={industry} className="flex items-center">
                          <input
                            type="checkbox"
                            checked={lenderFormData.industries.includes(industry)}
                            onChange={() => handleIndustryToggle(industry)}
                            className="mr-2 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="text-sm text-gray-700">{industry}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Features */}
                  <div className="mb-6">
                    <h5 className="font-medium text-gray-700 mb-3">Key Features</h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {availableFeatures.map(feature => (
                        <label key={feature} className="flex items-center">
                          <input
                            type="checkbox"
                            checked={lenderFormData.features.includes(feature)}
                            onChange={() => handleFeatureToggle(feature)}
                            className="mr-2 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="text-sm text-gray-700">{feature}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowLenderForm(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveLender}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                >
                  {editingLender ? 'Update Lender' : 'Add Lender'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lender Details Modal removed as it was unused */}

      {/* Application Details Modal */}
      {showApplicationDetails && selectedApplication && (
        <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden">
            {/* Enhanced Header */}
            <div className="relative bg-gradient-to-r from-emerald-600 via-green-700 to-teal-800 p-8">
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-600/90 to-teal-800/90"></div>
              <div className="relative">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center">
                      <Building2 className="w-8 h-8 text-white" />
                    </div>
                    <div>
                      <h3 className="text-3xl font-bold text-white mb-2">
                        {selectedApplication.business_name}
                      </h3>
                      <div className="flex items-center space-x-4 text-emerald-100">
                        <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold bg-white/20 backdrop-blur-sm border border-white/30`}>
                          <div className={`w-2 h-2 rounded-full mr-2 ${
                            selectedApplication.status === 'funded' ? 'bg-green-300' :
                            selectedApplication.status === 'approved' ? 'bg-blue-300' :
                            selectedApplication.status === 'submitted' ? 'bg-yellow-300' :
                            selectedApplication.status === 'declined' ? 'bg-red-300' : 'bg-gray-300'
                          }`}></div>
                          {selectedApplication.status.charAt(0).toUpperCase() + selectedApplication.status.slice(1)}
                        </span>
                        <span className="text-sm font-mono">ID: {selectedApplication.id.slice(0, 8)}...</span>
                        <span className="text-sm">{selectedApplication.industry}</span>
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => setShowApplicationDetails(false)} 
                    className="w-12 h-12 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center text-white hover:text-emerald-100 transition-all duration-200"
                  >
                    <XCircle className="w-6 h-6" />
                  </button>
                </div>
              </div>
            </div>

            {/* Enhanced Body */}
            <div className="overflow-y-auto max-h-[calc(90vh-200px)]">
              <div className="p-8">
                {/* Financial Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                  <div className="bg-gradient-to-br from-emerald-50 to-green-100 rounded-xl p-6 border border-emerald-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-emerald-700">Requested Amount</p>
                        <p className="text-2xl font-bold text-emerald-900">${(selectedApplication.requested_amount ?? 0).toLocaleString()}</p>
                      </div>
                      <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center">
                        <span className="text-white font-bold">$</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-xl p-6 border border-blue-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-blue-700">Monthly Revenue</p>
                        <p className="text-2xl font-bold text-blue-900">${(selectedApplication.monthly_revenue ?? 0).toLocaleString()}</p>
                      </div>
                      <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center">
                        <Star className="w-6 h-6 text-white" />
                      </div>
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-purple-50 to-violet-100 rounded-xl p-6 border border-purple-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-purple-700">Credit Score</p>
                        <p className="text-2xl font-bold text-purple-900">{selectedApplication.credit_score}</p>
                      </div>
                      <div className="w-12 h-12 bg-purple-500 rounded-xl flex items-center justify-center">
                        <CheckCircle className="w-6 h-6 text-white" />
                      </div>
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-orange-50 to-amber-100 rounded-xl p-6 border border-orange-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-orange-700">Years in Business</p>
                        <p className="text-2xl font-bold text-orange-900">{selectedApplication.years_in_business}</p>
                      </div>
                      <div className="w-12 h-12 bg-orange-500 rounded-xl flex items-center justify-center">
                        <Building2 className="w-6 h-6 text-white" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Business Information */}
                  <div className="bg-gradient-to-br from-gray-50 to-white rounded-xl border border-gray-200 p-6">
                    <div className="flex items-center space-x-3 mb-6">
                      <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-white" />
                      </div>
                      <h4 className="text-xl font-bold text-gray-900">Business Information</h4>
                    </div>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-1">Business Name</label>
                          <p className="text-base text-gray-900 font-medium">{selectedApplication.business_name}</p>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-1">Industry</label>
                          <p className="text-base text-gray-900">{selectedApplication.industry}</p>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-1">Business Type</label>
                          <p className="text-base text-gray-900">{selectedApplication.business_type || 'N/A'}</p>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-1">EIN</label>
                          <p className="text-base text-gray-900 font-mono">{selectedApplication.ein || 'N/A'}</p>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-1">Employees</label>
                          <p className="text-base text-gray-900">{selectedApplication.number_of_employees}</p>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-600 mb-1">Created</label>
                          <p className="text-base text-gray-900">{new Date(selectedApplication.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Contact Information */}
                  <div className="bg-gradient-to-br from-blue-50 to-white rounded-xl border border-blue-200 p-6">
                    <div className="flex items-center space-x-3 mb-6">
                      <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
                        <Users className="w-5 h-5 text-white" />
                      </div>
                      <h4 className="text-xl font-bold text-gray-900">Contact Information</h4>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-600 mb-1">Owner Name</label>
                        <p className="text-base text-gray-900 font-medium">{selectedApplication.owner_name}</p>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-600 mb-1">Email</label>
                        <p className="text-base text-gray-900">{selectedApplication.email}</p>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-600 mb-1">Phone</label>
                        <p className="text-base text-gray-900">{selectedApplication.phone || 'N/A'}</p>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-600 mb-1">Address</label>
                        <p className="text-base text-gray-900">{selectedApplication.address || 'N/A'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Financial Analysis Section */}
                <div className="mt-8 bg-gradient-to-br from-purple-50 to-white rounded-xl border border-purple-200 p-6">
                  <div className="flex items-center space-x-3 mb-6">
                    <div className="w-10 h-10 bg-purple-500 rounded-xl flex items-center justify-center">
                      <Star className="w-5 h-5 text-white" />
                    </div>
                    <h4 className="text-xl font-bold text-gray-900">Financial Analysis</h4>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white rounded-lg p-4 border border-purple-100">
                      <label className="block text-sm font-semibold text-purple-600 mb-2">Annual Revenue</label>
                      <p className="text-2xl font-bold text-gray-900">${(selectedApplication.annual_revenue ?? 0).toLocaleString()}</p>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-purple-100">
                      <label className="block text-sm font-semibold text-purple-600 mb-2">Monthly Deposits</label>
                      <p className="text-2xl font-bold text-gray-900">${(selectedApplication.monthly_deposits ?? 0).toLocaleString()}</p>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-purple-100">
                      <label className="block text-sm font-semibold text-purple-600 mb-2">Existing Debt</label>
                      <p className="text-2xl font-bold text-gray-900">${(selectedApplication.existing_debt ?? 0).toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                {/* Application Status */}
                <div className="mt-8 bg-gradient-to-br from-orange-50 to-white rounded-xl border border-orange-200 p-6">
                  <div className="flex items-center space-x-3 mb-6">
                    <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-white" />
                    </div>
                    <h4 className="text-xl font-bold text-gray-900">Application Status</h4>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white rounded-lg p-4 border border-orange-100">
                      <label className="block text-sm font-semibold text-orange-600 mb-2">Current Status</label>
                      <span className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold shadow-sm ${getStatusColor(selectedApplication.status)}`}>
                        <div className={`w-2 h-2 rounded-full mr-2 ${
                          selectedApplication.status === 'funded' ? 'bg-green-400' :
                          selectedApplication.status === 'approved' ? 'bg-blue-400' :
                          selectedApplication.status === 'submitted' ? 'bg-yellow-400' :
                          selectedApplication.status === 'declined' ? 'bg-red-400' : 'bg-gray-400'
                        }`}></div>
                        {selectedApplication.status.charAt(0).toUpperCase() + selectedApplication.status.slice(1)}
                      </span>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-orange-100">
                      <label className="block text-sm font-semibold text-orange-600 mb-2">Matched Lenders</label>
                      <p className="text-2xl font-bold text-gray-900">{selectedApplication.matchedLenders} lenders</p>
                    </div>
                  </div>
                </div>

                {/* Documents */}
                {selectedApplication.documents && selectedApplication.documents.length > 0 && (
                  <div className="mt-8 bg-gradient-to-br from-green-50 to-white rounded-xl border border-green-200 p-6">
                    <div className="flex items-center space-x-3 mb-6">
                      <div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center">
                        <CheckCircle className="w-5 h-5 text-white" />
                      </div>
                      <h4 className="text-xl font-bold text-gray-900">Bank Statements & Documents</h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {selectedApplication.documents.map((doc, index) => (
                        <div key={index} className="flex items-center bg-white rounded-lg p-4 border border-green-100 hover:border-green-300 transition-colors">
                          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mr-4">
                            <CheckCircle className="w-5 h-5 text-green-600" />
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{doc}</p>
                            <p className="text-sm text-gray-500">Bank Statement Document</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Enhanced Footer */}
              <div className="bg-gray-50 border-t border-gray-200 px-8 py-6">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-500">
                    Application reviewed for financial analysis and bank statement verification
                  </div>
                  <div className="flex space-x-3">
                    <button
                      onClick={() => setShowApplicationDetails(false)}
                      className="px-6 py-3 bg-gradient-to-r from-gray-600 to-gray-700 text-white rounded-xl hover:from-gray-700 hover:to-gray-800 transition-all duration-200 font-medium shadow-lg hover:shadow-xl"
                    >
                      Close
                    </button>
                    <button
                      onClick={() => handleDeleteApplication(selectedApplication.id)}
                      className="px-6 py-3 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-xl hover:from-red-700 hover:to-red-800 transition-all duration-200 font-medium shadow-lg hover:shadow-xl"
                    >
                      Delete Application
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Application Modal */}
      {showEditApplication && editingApplication && (
        <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-7xl w-full max-h-[95vh] overflow-hidden border border-gray-200">
            {/* Professional Header */}
            <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 px-8 py-6 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600/90 to-indigo-700/90"></div>
              <div className="relative flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="bg-white/20 p-3 rounded-xl backdrop-blur-sm">
                    <Building2 className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-white mb-1">
                      Edit Application
                    </h3>
                    <p className="text-blue-100 text-sm font-medium">
                      {editingApplication.business_name} • Bank Statement Processing
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowEditApplication(false);
                    setEditingApplication(null);
                  }}
                  className="bg-white/10 hover:bg-white/20 p-2 rounded-xl transition-all duration-200 backdrop-blur-sm"
                >
                  <XCircle className="w-6 h-6 text-white" />
                </button>
              </div>
            </div>
            
            <div className="overflow-y-auto max-h-[calc(95vh-120px)]">
              <div className="p-8">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                  {/* Application Details Form */}
                  <div className="bg-gradient-to-br from-gray-50 to-white rounded-2xl border border-gray-200 shadow-sm">
                    <div className="bg-gradient-to-r from-gray-600 to-gray-700 px-6 py-4 rounded-t-2xl">
                      <div className="flex items-center space-x-3">
                        <FileText className="w-5 h-5 text-white" />
                        <h4 className="text-lg font-semibold text-white">Application Details</h4>
                      </div>
                    </div>
                    <div className="p-6">
                      <form onSubmit={handleUpdateApplication} className="space-y-6">
                        {/* Business Information Section */}
                        <div className="bg-blue-50/50 rounded-xl p-4 border border-blue-100">
                          <h5 className="text-sm font-semibold text-blue-800 mb-3 flex items-center">
                            <Building className="w-4 h-4 mr-2" />
                            Business Information
                          </h5>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-2">Business Name *</label>
                              <input
                                type="text"
                                value={editingApplication.business_name}
                                onChange={(e) => setEditingApplication(prev => prev ? { ...prev, business_name: e.target.value } : null)}
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm transition-all duration-200"
                                placeholder="Enter business name"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-2">Owner Name *</label>
                              <input
                                type="text"
                                value={editingApplication.owner_name}
                                onChange={(e) => setEditingApplication(prev => prev ? { ...prev, owner_name: e.target.value } : null)}
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm transition-all duration-200"
                                placeholder="Enter owner name"
                              />
                            </div>
                          </div>
                        </div>
                        
                        {/* Contact Information Section */}
                        <div className="bg-green-50/50 rounded-xl p-4 border border-green-100">
                          <h5 className="text-sm font-semibold text-green-800 mb-3 flex items-center">
                            <Phone className="w-4 h-4 mr-2" />
                            Contact Information
                          </h5>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-2">Email Address *</label>
                              <input
                                type="email"
                                value={editingApplication.email}
                                onChange={(e) => setEditingApplication(prev => prev ? { ...prev, email: e.target.value } : null)}
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white shadow-sm transition-all duration-200"
                                placeholder="business@example.com"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-2">Phone Number</label>
                              <input
                                type="tel"
                                value={editingApplication.phone || ''}
                                onChange={(e) => setEditingApplication(prev => prev ? { ...prev, phone: e.target.value } : null)}
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white shadow-sm transition-all duration-200"
                                placeholder="(555) 123-4567"
                              />
                            </div>
                          </div>
                        </div>
                        
                        {/* Business Classification Section */}
                        <div className="bg-purple-50/50 rounded-xl p-4 border border-purple-100">
                          <h5 className="text-sm font-semibold text-purple-800 mb-3 flex items-center">
                            <Briefcase className="w-4 h-4 mr-2" />
                            Business Classification
                          </h5>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-2">Industry *</label>
                              <input
                                type="text"
                                value={editingApplication.industry || ''}
                                onChange={(e) => setEditingApplication(prev => prev ? { ...prev, industry: e.target.value } : null)}
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white shadow-sm transition-all duration-200"
                                style={{ caretColor: 'black' }}
                                placeholder="Enter industry (e.g., Retail, Healthcare, Construction)"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-2">Application Status</label>
                              <select
                                value={editingApplication.status}
                                onChange={(e) => setEditingApplication(prev => (prev ? { ...prev, status: e.target.value as DBApplication['status'] } : prev))}
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white shadow-sm transition-all duration-200"
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
                        </div>
                        
                        {/* Financial Information Section */}
                        <div className="bg-orange-50/50 rounded-xl p-4 border border-orange-100">
                          <h5 className="text-sm font-semibold text-orange-800 mb-3 flex items-center">
                            <DollarSign className="w-4 h-4 mr-2" />
                            Financial Information
                          </h5>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-2">Requested Amount *</label>
                              <div className="relative">
                                <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-500 font-medium">$</span>
                                <input
                                  type="number"
                                  value={editingApplication.requested_amount}
                                  onChange={(e) => setEditingApplication(prev => (prev ? { ...prev, requested_amount: Number(e.target.value) } : prev))}
                                  className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white shadow-sm transition-all duration-200"
                                  placeholder="100,000"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-2">Monthly Revenue</label>
                              <div className="relative">
                                <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-500 font-medium">$</span>
                                <input
                                  type="number"
                                  value={editingApplication.monthly_revenue}
                                  onChange={(e) => setEditingApplication(prev => (prev ? { ...prev, monthly_revenue: Number(e.target.value) } : prev))}
                                  className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white shadow-sm transition-all duration-200"
                                  placeholder="25,000"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-2">Credit Score</label>
                              <input
                                type="number"
                                value={editingApplication.credit_score ?? ''}
                                onChange={(e) => setEditingApplication(prev => (prev ? { ...prev, credit_score: e.target.value === '' ? (null as unknown as number) : Number(e.target.value) } : prev))}
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white shadow-sm transition-all duration-200"
                                placeholder="650 (optional)"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-2">Years in Business</label>
                              <input
                                type="number"
                                value={editingApplication.years_in_business}
                                onChange={(e) => setEditingApplication(prev => (prev ? { ...prev, years_in_business: Number(e.target.value) } : prev))}
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white shadow-sm transition-all duration-200"
                                min="0"
                                placeholder="5"
                              />
                            </div>
                          </div>
                        </div>
                        
                        {/* Action Buttons */}
                        <div className="flex justify-end pt-6 border-t border-gray-200">
                          <button
                            type="submit"
                            className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-8 py-3 rounded-xl font-semibold flex items-center shadow-lg hover:shadow-xl transition-all duration-200"
                          >
                            <CheckCircle className="w-5 h-5 mr-2" />
                            Save Changes
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>

                {/* Lender Submissions Management */}
                <div className="bg-gradient-to-br from-indigo-50 to-white rounded-2xl border border-indigo-200 shadow-sm">
                  <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 px-6 py-4 rounded-t-2xl">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <Building2 className="w-5 h-5 text-white" />
                        <h4 className="text-lg font-semibold text-white">Lender Submissions</h4>
                      </div>
                      <button
                        onClick={() => setShowAddSubmission(true)}
                        className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-xl font-medium flex items-center text-sm transition-all duration-200 backdrop-blur-sm"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Lender
                      </button>
                    </div>
                  </div>
                  <div className="p-6">
                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {applicationSubmissions.map((submission) => (
                      <div key={submission.id} className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h5 className="font-medium text-gray-900">{submission.lender.name}</h5>
                            <p className="text-sm text-gray-500">
                              Created: {new Date(submission.created_at).toLocaleDateString()}
                            </p>
                          </div>
                          <select
                            value={submission.status}
                            onChange={(e) => {
                              const raw = e.target.value;
                              const isDeclined = raw === 'rejected' || raw === 'declined' || raw === 'decline';
                              const isApproved = raw === 'approved' || raw === 'funded' || raw === 'approve';
                              const isCounter = raw === 'responded' || raw === 'counter-offer' || raw === 'respond';
                              const isPending = raw === 'pending';
                              if (isDeclined) {
                                updateSubmissionLocal(submission.id, {
                                  status: raw as DBLenderSubmission['status'],
                                  offered_amount: undefined,
                                  factor_rate: undefined,
                                  terms: undefined,
                                });
                                const respEmpty = !submission.response || (typeof submission.response === 'string' && submission.response.trim() === '');
                                if (respEmpty) {
                                  setSubmissionValidation(prev => ({ ...prev, [submission.id]: { responseRequired: true } }));
                                }
                              } else if (isApproved || isCounter) {
                                updateSubmissionLocal(submission.id, { status: raw as DBLenderSubmission['status'] });
                                const amountEmpty = submission.offered_amount == null || (typeof submission.offered_amount === 'number' && Number.isNaN(submission.offered_amount));
                                const factorEmpty = !submission.factor_rate || (typeof submission.factor_rate === 'string' && submission.factor_rate.trim() === '');
                                const termsEmpty = !submission.terms || (typeof submission.terms === 'string' && submission.terms.trim() === '');
                                if (amountEmpty || factorEmpty || termsEmpty) {
                                  setSubmissionValidation(prev => ({
                                    ...prev,
                                    [submission.id]: { ...(prev[submission.id] || {}), ...(amountEmpty ? { offeredRequired: true } : {}), ...(factorEmpty ? { factorRequired: true } : {}), ...(termsEmpty ? { termsRequired: true } : {}) }
                                  }));
                                } else {
                                  setSubmissionValidation(prev => ({ ...prev, [submission.id]: { ...(prev[submission.id] || {}), offeredRequired: false, factorRequired: false, termsRequired: false } }));
                                }
                              } else if (isPending) {
                                updateSubmissionLocal(submission.id, { status: raw as DBLenderSubmission['status'] });
                                const respEmpty2 = !submission.response || (typeof submission.response === 'string' && submission.response.trim() === '');
                                setSubmissionValidation(prev => ({ ...prev, [submission.id]: { ...(prev[submission.id] || {}), responseRequired: respEmpty2 } }));
                              } else {
                                updateSubmissionLocal(submission.id, { status: raw as DBLenderSubmission['status'] });
                                setSubmissionValidation(prev => { const next = { ...prev }; delete next[submission.id]; return next; });
                              }
                            }}
                            onBlur={(e) => {
                              const raw = e.target.value;
                              const isDeclined = raw === 'rejected' || raw === 'declined' || raw === 'decline';
                              if (isDeclined) {
                                persistSubmissionChange(submission.id, { status: raw as DBLenderSubmission['status'], offered_amount: undefined, factor_rate: undefined, terms: undefined });
                              } else {
                                persistSubmissionChange(submission.id, { status: raw as DBLenderSubmission['status'] });
                              }
                            }}
                            className="px-3 py-1 rounded-full text-xs font-medium border border-gray-300 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            <option value="pending">Pending</option>
                            <option value="sent">Sent</option>
                            <option value="responded">Counter Offer</option>
                            <option value="approved">Approved</option>
                            <option value="rejected">Declined</option>
                          </select>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Offered Amount</label>
                            <input
                              type="number"
                              value={submission.offered_amount || ''}
                              onChange={(e) => {
                                updateSubmissionLocal(submission.id, { offered_amount: e.target.value === '' ? undefined : Number(e.target.value) });
                                if (e.target.value.trim() !== '' && submissionValidation[submission.id]?.offeredRequired) {
                                  setSubmissionValidation(prev => ({ ...prev, [submission.id]: { ...(prev[submission.id] || {}), offeredRequired: false } }));
                                }
                              }}
                              onBlur={(e) => persistSubmissionChange(submission.id, { offered_amount: e.target.value === '' ? undefined : Number(e.target.value) })}
                              className={`w-full px-3 py-2 text-sm border rounded-lg transition-all duration-200 ${
                                mapUiStatusToDb(submission.status as string) === 'rejected'
                                  ? 'border-red-400 bg-red-50 placeholder-red-400 focus:ring-2 focus:ring-red-200 focus:border-red-500'
                                  : mapUiStatusToDb(submission.status as string) === 'approved'
                                  ? 'border-green-400 bg-green-50 placeholder-green-400 focus:ring-2 focus:ring-green-200 focus:border-green-500'
                                  : 'border-gray-300 focus:ring-2 focus:ring-blue-200 focus:border-blue-500'
                              }`}
                              placeholder="Amount"
                            />
                            {submissionValidation[submission.id]?.offeredRequired && (
                              <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                                <div className="flex items-center">
                                  <div className="flex-shrink-0">
                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                  </div>
                                  <div className="ml-2">
                                    <p className="text-sm font-medium text-green-800">Offered Amount Required</p>
                                    <p className="text-xs text-green-700 mt-1">Provide an offered amount for Approved or Counter Offer.</p>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Factor Rate</label>
                            <input
                              type="text"
                              value={submission.factor_rate || ''}
                              onChange={(e) => {
                                updateSubmissionLocal(submission.id, { factor_rate: e.target.value === '' ? undefined : e.target.value });
                                if (e.target.value.trim() !== '' && submissionValidation[submission.id]?.factorRequired) {
                                  setSubmissionValidation(prev => ({ ...prev, [submission.id]: { ...(prev[submission.id] || {}), factorRequired: false } }));
                                }
                              }}
                              onBlur={(e) => persistSubmissionChange(submission.id, { factor_rate: e.target.value === '' ? undefined : e.target.value })}
                              className={`w-full px-3 py-2 text-sm border rounded-lg transition-all duration-200 ${
                                mapUiStatusToDb(submission.status as string) === 'rejected'
                                  ? 'border-red-400 bg-red-50 placeholder-red-400 focus:ring-2 focus:ring-red-200 focus:border-red-500'
                                  : mapUiStatusToDb(submission.status as string) === 'approved'
                                  ? 'border-green-400 bg-green-50 placeholder-green-400 focus:ring-2 focus:ring-green-200 focus:border-green-500'
                                  : 'border-gray-300 focus:ring-2 focus:ring-blue-200 focus:border-blue-500'
                              }`}
                              placeholder="1.2"
                            />
                            {submissionValidation[submission.id]?.factorRequired && (
                              <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                                <div className="flex items-center">
                                  <div className="flex-shrink-0">
                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                  </div>
                                  <div className="ml-2">
                                    <p className="text-sm font-medium text-green-800">Factor Rate Required</p>
                                    <p className="text-xs text-green-700 mt-1">Provide a factor rate for Approved or Counter Offer.</p>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        <div className="mb-3">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Terms</label>
                          <input
                            type="text"
                            value={submission.terms || ''}
                            onChange={(e) => {
                              updateSubmissionLocal(submission.id, { terms: e.target.value === '' ? undefined : e.target.value });
                              if (e.target.value.trim() !== '' && submissionValidation[submission.id]?.termsRequired) {
                                setSubmissionValidation(prev => ({ ...prev, [submission.id]: { ...(prev[submission.id] || {}), termsRequired: false } }));
                              }
                            }}
                            onBlur={(e) => persistSubmissionChange(submission.id, { terms: e.target.value === '' ? undefined : e.target.value })}
                            className={`w-full px-3 py-2 text-sm border rounded-lg transition-all duration-200 ${
                              mapUiStatusToDb(submission.status as string) === 'rejected'
                                ? 'border-red-400 bg-red-50 placeholder-red-400 focus:ring-2 focus:ring-red-200 focus:border-red-500'
                                : mapUiStatusToDb(submission.status as string) === 'approved'
                                ? 'border-green-400 bg-green-50 placeholder-green-400 focus:ring-2 focus:ring-green-200 focus:border-green-500'
                                : 'border-gray-300 focus:ring-2 focus:ring-blue-200 focus:border-blue-500'
                            }`}
                            placeholder="12 months"
                          />
                          {submissionValidation[submission.id]?.termsRequired && (
                            <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                              <div className="flex items-center">
                                <div className="flex-shrink-0">
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                </div>
                                <div className="ml-2">
                                  <p className="text-sm font-medium text-green-800">Terms Required</p>
                                  <p className="text-xs text-green-700 mt-1">Provide terms for Approved or Counter Offer.</p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                        
                        <div className="mb-3">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Response</label>
                          <textarea
                            value={submission.response || ''}
                            onChange={(e) => {
                              updateSubmissionLocal(submission.id, { response: e.target.value === '' ? undefined : e.target.value });
                              // Clear validation when user starts typing response
                              if (e.target.value.trim() !== '' && submissionValidation[submission.id]?.responseRequired) {
                                setSubmissionValidation(prev => {
                                  const newValidation = { ...prev };
                                  delete newValidation[submission.id];
                                  return newValidation;
                                });
                              }
                            }}
                            onBlur={(e) => persistSubmissionChange(submission.id, { response: e.target.value === '' ? undefined : e.target.value })}
                            className={`w-full px-3 py-2 text-sm border rounded-lg transition-all duration-200 resize-none ${submissionValidation[submission.id]?.responseRequired ? (mapUiStatusToDb(submission.status as string) === 'rejected' ? 'border-red-400 bg-red-50 placeholder-red-400 focus:ring-2 focus:ring-red-200 focus:border-red-500' : 'border-amber-400 bg-amber-50 placeholder-amber-400 focus:ring-2 focus:ring-amber-200 focus:border-amber-500') : 'border-gray-300 focus:ring-2 focus:ring-blue-200 focus:border-blue-500'}`}
                            rows={3}
                            placeholder="Explain the lender's response..."
                          />
                          {submissionValidation[submission.id]?.responseRequired && (
                            <div className={`mt-2 p-3 rounded-lg border ${mapUiStatusToDb(submission.status as string) === 'rejected' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                              <div className="flex items-center">
                                <div className="flex-shrink-0">
                                  {mapUiStatusToDb(submission.status as string) === 'rejected' ? (
                                    <XCircle className="h-4 w-4 text-red-400" />
                                  ) : (
                                    <AlertCircle className="h-4 w-4 text-amber-500" />
                                  )}
                                </div>
                                <div className="ml-2">
                                  <p className={`text-sm font-medium ${mapUiStatusToDb(submission.status as string) === 'rejected' ? 'text-red-800' : 'text-amber-800'}`}>Response Required</p>
                                  <p className={`text-xs mt-1 ${mapUiStatusToDb(submission.status as string) === 'rejected' ? 'text-red-600' : 'text-amber-700'}`}>
                                    {mapUiStatusToDb(submission.status as string) === 'rejected' ? 'Please explain why this submission is declined.' : 'Please provide a response while status is Pending.'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                        
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
                          <textarea
                            value={submission.notes || ''}
                            onChange={(e) => updateSubmissionLocal(submission.id, { notes: e.target.value === '' ? undefined : e.target.value })}
                            onBlur={(e) => persistSubmissionChange(submission.id, { notes: e.target.value === '' ? undefined : e.target.value })}
                            className={`w-full px-3 py-2 text-sm border rounded-lg transition-all duration-200 resize-none border-gray-300 focus:ring-2 focus:ring-blue-200 focus:border-blue-500`}
                            rows={2}
                            placeholder="Internal notes..."
                          />
                        </div>
                      </div>
                    ))}
                    
                    {applicationSubmissions.length === 0 && (
                      <div className="text-center py-8 text-gray-500">
                        <Building2 className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                        <p>No lender submissions yet</p>
                        <p className="text-sm">Click "Add Lender" to create submissions</p>
                      </div>
                    )}
                  </div>
                  </div>
                </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Lender Submission Modal */}
      {showAddSubmission && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">Add Lender Submission</h3>
                <button
                  onClick={() => setShowAddSubmission(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-6">
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {lenders
                  .filter(lender => !applicationSubmissions.some(sub => sub.lender_id === lender.id))
                  .map((lender) => (
                    <div
                      key={lender.id}
                      className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
                      onClick={() => handleAddLenderSubmission(lender.id)}
                    >
                      <div>
                        <h4 className="font-medium text-gray-900">{lender.name}</h4>
                        <p className="text-sm text-gray-500">
                          ${(lender.min_amount ?? 0).toLocaleString()} - ${(lender.max_amount ?? 0).toLocaleString()}
                        </p>
                      </div>
                      <Plus className="w-5 h-5 text-green-600" />
                    </div>
                  ))}
              </div>
              
              {lenders.filter(lender => !applicationSubmissions.some(sub => sub.lender_id === lender.id)).length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <p>All available lenders have been added</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Email Template Settings Modal */}
      {showEmailTemplateSettings && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">Email Template Settings</h3>
                  <p className="text-sm text-gray-600 mt-1">Customize the email template sent to lenders</p>
                </div>
                <button
                  onClick={() => setShowEmailTemplateSettings(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>
            </div>
            
            <div className="p-6">
              <div className="mb-6">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Available Variables</h4>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                    <div className="space-y-1">
                      <p className="font-medium text-gray-700">Business Info:</p>
                      <p className="text-gray-600">{"{{businessName}}"}</p>
                      <p className="text-gray-600">{"{{ownerName}}"}</p>
                      <p className="text-gray-600">{"{{industry}}"}</p>
                      <p className="text-gray-600">{"{{businessType}}"}</p>
                      <p className="text-gray-600">{"{{ein}}"}</p>
                      <p className="text-gray-600">{"{{yearsInBusiness}}"}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium text-gray-700">Financial Info:</p>
                      <p className="text-gray-600">{"{{requestedAmount}}"}</p>
                      <p className="text-gray-600">{"{{monthlyRevenue}}"}</p>
                      <p className="text-gray-600">{"{{annualRevenue}}"}</p>
                      <p className="text-gray-600">{"{{creditScore}}"}</p>
                      <p className="text-gray-600">{"{{existingDebt}}"}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium text-gray-700">Contact & Lender:</p>
                      <p className="text-gray-600">{"{{email}}"}</p>
                      <p className="text-gray-600">{"{{phone}}"}</p>
                      <p className="text-gray-600">{"{{address}}"}</p>
                      <p className="text-gray-600">{"{{lenderName}}"}</p>
                      <p className="text-gray-600">{"{{lenderMinAmount}}"}</p>
                      <p className="text-gray-600">{"{{lenderMaxAmount}}"}</p>
                      <p className="text-gray-600">{"{{lenderFactorRate}}"}</p>
                      <p className="text-gray-600">{"{{lenderPaybackTerm}}"}</p>
                      <p className="text-gray-600">{"{{lenderApprovalTime}}"}</p>
                      <p className="text-gray-600">{"{{applicationId}}"}</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email Template
                </label>
                <textarea
                  value={emailTemplate}
                  onChange={(e) => setEmailTemplate(e.target.value)}
                  className="w-full h-96 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
                  placeholder="Enter your email template..."
                />
                <p className="text-xs text-gray-500 mt-2">
                  Use the variables above to dynamically insert application and lender data
                </p>
              </div>
              
              <div className="bg-blue-50 rounded-lg p-4 mb-6">
                <h4 className="text-sm font-medium text-blue-800 mb-2">Preview</h4>
                <div className="bg-white border rounded p-3 max-h-40 overflow-y-auto">
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap">
                    {emailTemplate
                      .replace(/\{\{businessName\}\}/g, 'Sample Business LLC')
                      .replace(/\{\{ownerName\}\}/g, 'John Smith')
                      .replace(/\{\{industry\}\}/g, 'Technology')
                      .replace(/\{\{businessType\}\}/g, 'LLC')
                      .replace(/\{\{ein\}\}/g, '12-3456789')
                      .replace(/\{\{yearsInBusiness\}\}/g, '3')
                      .replace(/\{\{requestedAmount\}\}/g, '150,000')
                      .replace(/\{\{monthlyRevenue\}\}/g, '50,000')
                      .replace(/\{\{annualRevenue\}\}/g, '600,000')
                      .replace(/\{\{creditScore\}\}/g, '720')
                      .replace(/\{\{existingDebt\}\}/g, '25,000')
                      .replace(/\{\{email\}\}/g, 'john@samplebusiness.com')
                      .replace(/\{\{phone\}\}/g, '(555) 123-4567')
                      .replace(/\{\{address\}\}/g, '123 Business St, City, ST 12345')
                      .replace(/\{\{lenderName\}\}/g, 'Sample Lender')
                      .replace(/\{\{lenderMinAmount\}\}/g, '50,000')
                      .replace(/\{\{lenderMaxAmount\}\}/g, '500,000')
                      .replace(/\{\{lenderFactorRate\}\}/g, '1.2 - 1.4')
                      .replace(/\{\{lenderPaybackTerm\}\}/g, '6-18 months')
                      .replace(/\{\{lenderApprovalTime\}\}/g, '24 hours')
                      .replace(/\{\{applicationId\}\}/g, 'APP-12345')
                    }
                  </pre>
                </div>
              </div>
            </div>
            
            <div className="p-6 border-t border-gray-200 flex justify-between">
              <button
                onClick={() => {
                  const defaultTemplate = `Subject: Merchant Cash Advance Application - {{businessName}}

Dear {{lenderName}} Team,

I hope this email finds you well. I am writing to submit a merchant cash advance application for your review and consideration.

BUSINESS INFORMATION:
• Business Name: {{businessName}}
• Owner: {{ownerName}}
• Industry: {{industry}}
• Years in Business: {{yearsInBusiness}}
• Business Type: {{businessType}}
• EIN: {{ein}}

FINANCIAL DETAILS:
• Requested Amount: \${{requestedAmount}}
• Monthly Revenue: \${{monthlyRevenue}}
• Annual Revenue: \${{annualRevenue}}
• Credit Score: {{creditScore}}
• Existing Debt: \${{existingDebt}}

CONTACT INFORMATION:
• Email: {{email}}
• Phone: {{phone}}
• Address: {{address}}

I have attached the following documents for your review:
• Business bank statements (last 6 months)
• Tax returns
• Completed application form
• Voided business check

Based on your underwriting guidelines, I believe this application aligns well with your lending criteria:
• Amount Range: \${{lenderMinAmount}} - \${{lenderMaxAmount}}
• Factor Rate: {{lenderFactorRate}}
• Payback Term: {{lenderPaybackTerm}}
• Approval Time: {{lenderApprovalTime}}

I would appreciate the opportunity to discuss this application further and answer any questions you may have. Please let me know if you need any additional information or documentation.

Thank you for your time and consideration. I look forward to hearing from you soon.

Best regards,
{{ownerName}}
{{businessName}}
{{email}}
{{phone}}

---
This application was submitted through MCAPortal Pro
Application ID: {{applicationId}}`;
                  setEmailTemplate(defaultTemplate);
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Reset to Default
              </button>
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowEmailTemplateSettings(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    localStorage.setItem('mcaPortalEmailTemplate', emailTemplate);
                    setShowEmailTemplateSettings(false);
                    alert('Email template saved successfully!');
                  }}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                >
                  Save Template
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {confirmDeleteLenderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDeleteLenderId(null)}></div>
          <div role="dialog" aria-modal="true" className="relative bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-md overflow-hidden">
            <div className="p-6">
              <div className="flex items-start">
                <div className="flex-shrink-0 mr-3">
                  <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                    <XCircle className="w-5 h-5 text-red-500" />
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">Confirm Delete</h3>
                  <p className="mt-1 text-sm text-gray-600">Delete lender: <span className="font-medium text-gray-900">{(lenders.find(l => l.id === confirmDeleteLenderId)?.name) || 'this lender'}</span>?</p>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteLenderId(null)}
                  className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => { await handleDeleteLender(confirmDeleteLenderId as string); setConfirmDeleteLenderId(null); }}
                  className="px-4 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700 text-sm font-semibold shadow"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showToast && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className={`${toastVariant === 'error' ? 'bg-red-600 border-red-700' : 'bg-green-600 border-green-700'} text-white px-6 py-4 rounded-xl shadow-2xl border max-w-md w-full`}> 
            <div className="flex items-center">
              <div className="flex-shrink-0">
                {toastVariant === 'error' ? (
                  <XCircle className="h-5 w-5 text-red-200" />
                ) : (
                  <CheckCircle className="h-5 w-5 text-green-200" />
                )}
              </div>
              <div className="ml-3 flex-1">
                <p className="text-sm font-medium">{toastVariant === 'error' ? 'Validation Error' : 'Action Required'}</p>
                <p className={`text-xs mt-1 ${toastVariant === 'error' ? 'text-red-100' : 'text-green-100'}`}>{toastMessage}</p>
              </div>
              <div className="ml-4 flex-shrink-0">
                <button
                  onClick={() => setShowToast(false)}
                  className={`${toastVariant === 'error' ? 'text-red-200 hover:text-white' : 'text-green-200 hover:text-white'} inline-flex focus:outline-none transition-colors duration-200`}
                >
                  {toastVariant === 'error' ? (
                    <XCircle className="h-4 w-4" />
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
    </div>
  );
};

export default AdminPortal;