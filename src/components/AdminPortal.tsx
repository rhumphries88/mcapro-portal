import React, { useState } from 'react';
import { Users, Building2, Settings, Plus, Edit, Trash2, Eye, Star, CheckCircle, Mail, XCircle, Search } from 'lucide-react';
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
  // Deal Users (members)
  const [dealUsers, setDealUsers] = useState<DBUser[]>([]);
  const [dealUsersLoading, setDealUsersLoading] = useState(false);
  const [selectedDealUser, setSelectedDealUser] = useState<DBUser | null>(null);
  const [showUserApplications, setShowUserApplications] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [lenderFormData, setLenderFormData] = useState({
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
    features: [] as string[]
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
        status: editingApplication.status,
        documents: editingApplication.documents,
        user_id: editingApplication.user_id,
      };
      const updated = await updateApplication(editingApplication.id, dbUpdateData);

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
      case 'inactive': case 'declined': case 'rejected':
        return 'bg-red-100 text-red-800';
      case 'pending': case 'under-review': case 'sent':
        return 'bg-yellow-100 text-yellow-800';
      case 'submitted': case 'responded':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleDeleteLender = (lenderId: string) => {
    const deleteLenderAsync = async () => {
      try {
        await deleteLender(lenderId);
        setLenders(prev => prev.filter(l => l.id !== lenderId));
      } catch (error) {
        console.error('Error deleting lender:', error);
        alert('Error deleting lender. Please try again.');
      }
    };
    deleteLenderAsync();
  };

  const handleEditLender = (lender: DBLender) => {
    setLenderFormData({
      name: lender.name,
      contactEmail: lender.contact_email,
      ccEmails: (lender.cc_emails as unknown as string[]) || [],
      phone: lender.phone || '',
      status: lender.status,
      rating: lender.rating,
      minAmount: lender.min_amount,
      maxAmount: lender.max_amount,
      minCreditScore: lender.min_credit_score,
      maxCreditScore: lender.max_credit_score,
      minTimeInBusiness: lender.min_time_in_business,
      minMonthlyRevenue: lender.min_monthly_revenue,
      industries: lender.industries,
      factorRate: lender.factor_rate,
      paybackTerm: lender.payback_term,
      approvalTime: lender.approval_time,
      features: lender.features
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
      features: []
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
        const lenderData = {
          name: lenderFormData.name,
          contact_email: lenderFormData.contactEmail,
          ...ccPart,
          phone: lenderFormData.phone,
          status: lenderFormData.status,
          rating: lenderFormData.rating,
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
      const dbPatch: Partial<DBLenderSubmission> = { ...updates };
      if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
        const dbStatus = mapUiStatusToDb(updates.status as string | null | undefined);
        if (dbStatus) dbPatch.status = dbStatus as DBLenderSubmission['status'];
      }
      const updatedSubmission = await updateLenderSubmission(submissionId, dbPatch);
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
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                <span>{applications.length} Total Applications</span>
              </div>
              <select className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 text-sm bg-white">
                <option>All Statuses</option>
                <option>Submitted</option>
                <option>Under Review</option>
                <option>Matched</option>
                <option>Funded</option>
                <option>Declined</option>
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
                  {!loading && applications.length === 0 && (
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
                  {!loading && applications.map((app) => (
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
                        <div className="text-xl font-bold text-gray-900">${app.requested_amount.toLocaleString()}</div>
                        <div className="text-sm text-gray-500">{app.industry}</div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="text-sm font-medium text-gray-900">${app.monthly_revenue.toLocaleString()}/mo</div>
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
                            <div className="text-xl font-bold text-gray-900">${app.requested_amount.toLocaleString()}</div>
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
                      ${lender.min_amount.toLocaleString()} - ${lender.max_amount.toLocaleString()}
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
                      <span className="ml-1 font-medium">${lender.min_monthly_revenue.toLocaleString()}</span>
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
                    onClick={() => handleDeleteLender(lender.id)}
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
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                        <p className="text-2xl font-bold text-emerald-900">${selectedApplication.requested_amount.toLocaleString()}</p>
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
                        <p className="text-2xl font-bold text-blue-900">${selectedApplication.monthly_revenue.toLocaleString()}</p>
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
                      <p className="text-2xl font-bold text-gray-900">${selectedApplication.annual_revenue.toLocaleString()}</p>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-purple-100">
                      <label className="block text-sm font-semibold text-purple-600 mb-2">Monthly Deposits</label>
                      <p className="text-2xl font-bold text-gray-900">${selectedApplication.monthly_deposits.toLocaleString()}</p>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-purple-100">
                      <label className="block text-sm font-semibold text-purple-600 mb-2">Existing Debt</label>
                      <p className="text-2xl font-bold text-gray-900">${selectedApplication.existing_debt.toLocaleString()}</p>
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
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-6xl w-full mx-4 max-h-[95vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-medium text-gray-900">
                  Edit Application - {editingApplication.business_name}
                </h3>
                <button
                  onClick={() => {
                    setShowEditApplication(false);
                    setEditingApplication(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              </div>
            </div>
            
            <div className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Application Details Form */}
                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-4">Application Details</h4>
                  <form onSubmit={handleUpdateApplication} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Business Name</label>
                        <input
                          type="text"
                          value={editingApplication.business_name}
                          onChange={(e) => setEditingApplication(prev => prev ? { ...prev, business_name: e.target.value } : null)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Owner Name</label>
                        <input
                          type="text"
                          value={editingApplication.owner_name}
                          onChange={(e) => setEditingApplication(prev => prev ? { ...prev, owner_name: e.target.value } : null)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                        <input
                          type="email"
                          value={editingApplication.email}
                          onChange={(e) => setEditingApplication(prev => prev ? { ...prev, email: e.target.value } : null)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                        <input
                          type="tel"
                          value={editingApplication.phone || ''}
                          onChange={(e) => setEditingApplication(prev => prev ? { ...prev, phone: e.target.value } : null)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
                        <select
                          value={editingApplication.industry || ''}
                          onChange={(e) => setEditingApplication(prev => prev ? { ...prev, industry: e.target.value } : null)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select Industry</option>
                          <option value="Retail">Retail</option>
                          <option value="Restaurant">Restaurant</option>
                          <option value="Healthcare">Healthcare</option>
                          <option value="Construction">Construction</option>
                          <option value="Professional Services">Professional Services</option>
                          <option value="Transportation">Transportation</option>
                          <option value="Manufacturing">Manufacturing</option>
                          <option value="Technology">Technology</option>
                          <option value="Real Estate">Real Estate</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                        <select
                          value={editingApplication.status}
                          onChange={(e) => setEditingApplication(prev => (prev ? { ...prev, status: e.target.value as DBApplication['status'] } : prev))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="draft">Draft</option>
                          <option value="submitted">Submitted</option>
                          <option value="under-review">Under Review</option>
                          <option value="approved">Approved</option>
                          <option value="funded">Funded</option>
                          <option value="declined">Declined</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Requested Amount</label>
                        <input
                          type="number"
                          value={editingApplication.requested_amount}
                          onChange={(e) => setEditingApplication(prev => (prev ? { ...prev, requested_amount: Number(e.target.value) } : prev))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Revenue</label>
                        <input
                          type="number"
                          value={editingApplication.monthly_revenue}
                          onChange={(e) => setEditingApplication(prev => (prev ? { ...prev, monthly_revenue: Number(e.target.value) } : prev))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Credit Score</label>
                        <input
                          type="number"
                          value={editingApplication.credit_score}
                          onChange={(e) => setEditingApplication(prev => (prev ? { ...prev, credit_score: Number(e.target.value) } : prev))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          min="300"
                          max="850"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Years in Business</label>
                        <input
                          type="number"
                          value={editingApplication.years_in_business}
                          onChange={(e) => setEditingApplication(prev => (prev ? { ...prev, years_in_business: Number(e.target.value) } : prev))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          min="0"
                        />
                      </div>
                    </div>
                    
                    <div className="flex justify-end pt-4">
                      <button
                        type="submit"
                        className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 flex items-center"
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Save Changes
                      </button>
                    </div>
                  </form>
                </div>

                {/* Lender Submissions Management */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-lg font-medium text-gray-900">Lender Submissions</h4>
                    <button
                      onClick={() => setShowAddSubmission(true)}
                      className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center text-sm"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add Lender
                    </button>
                  </div>
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
                            onChange={(e) => updateSubmissionLocal(submission.id, { status: e.target.value as DBLenderSubmission['status'] })}
                            onBlur={(e) => persistSubmissionChange(submission.id, { status: e.target.value as DBLenderSubmission['status'] })}
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
                              onChange={(e) => updateSubmissionLocal(submission.id, { offered_amount: e.target.value === '' ? undefined : Number(e.target.value) })}
                              onBlur={(e) => persistSubmissionChange(submission.id, { offered_amount: e.target.value === '' ? undefined : Number(e.target.value) })}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                              placeholder="Amount"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Factor Rate</label>
                            <input
                              type="text"
                              value={submission.factor_rate || ''}
                              onChange={(e) => updateSubmissionLocal(submission.id, { factor_rate: e.target.value === '' ? undefined : e.target.value })}
                              onBlur={(e) => persistSubmissionChange(submission.id, { factor_rate: e.target.value === '' ? undefined : e.target.value })}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                              placeholder="1.2"
                            />
                          </div>
                        </div>
                        
                        <div className="mb-3">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Terms</label>
                          <input
                            type="text"
                            value={submission.terms || ''}
                            onChange={(e) => updateSubmissionLocal(submission.id, { terms: e.target.value === '' ? undefined : e.target.value })}
                            onBlur={(e) => persistSubmissionChange(submission.id, { terms: e.target.value === '' ? undefined : e.target.value })}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                            placeholder="12 months"
                          />
                        </div>
                        
                        <div className="mb-3">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Response</label>
                          <textarea
                            value={submission.response || ''}
                            onChange={(e) => updateSubmissionLocal(submission.id, { response: e.target.value === '' ? undefined : e.target.value })}
                            onBlur={(e) => persistSubmissionChange(submission.id, { response: e.target.value === '' ? undefined : e.target.value })}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                            rows={2}
                            placeholder="Lender response..."
                          />
                        </div>
                        
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
                          <textarea
                            value={submission.notes || ''}
                            onChange={(e) => updateSubmissionLocal(submission.id, { notes: e.target.value === '' ? undefined : e.target.value })}
                            onBlur={(e) => persistSubmissionChange(submission.id, { notes: e.target.value === '' ? undefined : e.target.value })}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
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
                          ${lender.min_amount.toLocaleString()} - ${lender.max_amount.toLocaleString()}
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
      
    </div>
  );
};

export default AdminPortal;