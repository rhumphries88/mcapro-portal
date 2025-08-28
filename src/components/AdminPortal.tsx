import React, { useState } from 'react';
import { Users, Building2, Settings, Plus, Edit, Trash2, Eye, Star, CheckCircle, Mail, XCircle } from 'lucide-react';
import { getLenders, createLender, updateLender, deleteLender, getApplications, getLenderSubmissions, updateApplication, deleteApplication, updateLenderSubmission, createLenderSubmissions, Lender as DBLender, Application as DBApplication, LenderSubmission as DBLenderSubmission } from '../lib/supabase';

const AdminPortal: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'applications' | 'lenders' | 'settings'>('applications');
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

  const [lenderFormData, setLenderFormData] = useState({
    name: '',
    contactEmail: '',
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
        const [dbLenders, dbApplications] = await Promise.all([
          getLenders(),
          getApplications()
        ]);
        
        // Add matched lenders count to applications
        const applicationsWithMatches = await Promise.all(
          dbApplications.map(async (app) => {
            const submissions = await getLenderSubmissions(app.id);
            return {
              ...app,
              matchedLenders: submissions.length
            };
          })
        );
        
        setLenders(dbLenders);
        setApplications(applicationsWithMatches);
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Load lender submissions for a given application
  const loadApplicationSubmissions = async (applicationId: string) => {
    try {
      const subs = await getLenderSubmissions(applicationId);
      setApplicationSubmissions(subs as (DBLenderSubmission & { lender: DBLender })[]);
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
      case 'inactive': case 'declined':
        return 'bg-red-100 text-red-800';
      case 'pending': case 'under-review':
        return 'bg-yellow-100 text-yellow-800';
      case 'submitted':
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


  const handleAddNewLender = () => {
    setLenderFormData({
      name: '',
      contactEmail: '',
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
        const lenderData = {
          name: lenderFormData.name,
          contact_email: lenderFormData.contactEmail,
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

  const handleUpdateSubmission = async (submission: DBLenderSubmission, updates: Partial<DBLenderSubmission>) => {
    try {
      const updatedSubmission = await updateLenderSubmission(submission.id, updates);
      setApplicationSubmissions(prev => prev.map(sub => 
        sub.id === submission.id ? { ...sub, ...updatedSubmission } : sub
      ));
    } catch (error) {
      console.error('Error updating submission:', error);
      alert('Error updating submission');
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
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Applications</h2>
            <div className="flex flex-wrap gap-2">
              <select className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 text-sm">
                <option>All Statuses</option>
                <option>Submitted</option>
                <option>Under Review</option>
                <option>Matched</option>
                <option>Funded</option>
                <option>Declined</option>
              </select>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Application</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Revenue/Credit</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Matches</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {applications.map((app) => (
                    <tr key={app.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{app.business_name}</div>
                          <div className="text-sm text-gray-500">{app.owner_name}</div>
                          <div className="text-xs text-gray-400 break-all max-w-[220px] sm:max-w-none">{app.id}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">${app.requested_amount.toLocaleString()}</div>
                        <div className="text-sm text-gray-500">{app.industry}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">${app.monthly_revenue.toLocaleString()}/mo</div>
                        <div className="text-sm text-gray-500">Credit: {app.credit_score}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(app.status)}`}>{app.status}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{app.matchedLenders} lenders</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button onClick={() => handleViewApplication(app)} className="text-emerald-600 hover:text-emerald-900 mr-3">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleEditApplication(app)} className="text-blue-600 hover:text-blue-900 mr-3">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeleteApplication(app.id)} className="text-red-600 hover:text-red-900">
                          <Trash2 className="w-4 h-4" />
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
                      <p className="text-gray-600">{lender.contact_email}</p>
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
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">{selectedApplication.business_name}</h3>
                  <div className="flex items-center mt-1">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(selectedApplication.status)}`}>
                      {selectedApplication.status}
                    </span>
                    <span className="ml-4 text-sm text-gray-500">
                      Application ID: {selectedApplication.id}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setShowApplicationDetails(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl"
                >
                  ×
                </button>
              </div>
            </div>
            
            <div className="p-6">
              {/* Business Information */}
              <div className="mb-8">
                <h4 className="text-lg font-semibold text-gray-900 mb-4">Business Information</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Business Name</label>
                    <p className="mt-1 text-sm text-gray-900">{selectedApplication.business_name}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Industry</label>
                    <p className="mt-1 text-sm text-gray-900">{selectedApplication.industry}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Business Type</label>
                    <p className="mt-1 text-sm text-gray-900">{selectedApplication.business_type || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">EIN</label>
                    <p className="mt-1 text-sm text-gray-900">{selectedApplication.ein || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Years in Business</label>
                    <p className="mt-1 text-sm text-gray-900">{selectedApplication.years_in_business}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Number of Employees</label>
                    <p className="mt-1 text-sm text-gray-900">{selectedApplication.number_of_employees}</p>
                  </div>
                </div>
              </div>

              {/* Contact Information */}
              <div className="mb-8">
                <h4 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Owner Name</label>
                    <p className="mt-1 text-sm text-gray-900">{selectedApplication.owner_name}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Email</label>
                    <p className="mt-1 text-sm text-gray-900">{selectedApplication.email}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Phone</label>
                    <p className="mt-1 text-sm text-gray-900">{selectedApplication.phone || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Address</label>
                    <p className="mt-1 text-sm text-gray-900">{selectedApplication.address || 'N/A'}</p>
                  </div>
                </div>
              </div>

              {/* Financial Information */}
              <div className="mb-8">
                <h4 className="text-lg font-semibold text-gray-900 mb-4">Financial Information</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Requested Amount</label>
                    <p className="mt-1 text-sm text-gray-900 font-semibold">${selectedApplication.requested_amount.toLocaleString()}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Monthly Revenue</label>
                    <p className="mt-1 text-sm text-gray-900">${selectedApplication.monthly_revenue.toLocaleString()}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Annual Revenue</label>
                    <p className="mt-1 text-sm text-gray-900">${selectedApplication.annual_revenue.toLocaleString()}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Monthly Deposits</label>
                    <p className="mt-1 text-sm text-gray-900">${selectedApplication.monthly_deposits.toLocaleString()}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Existing Debt</label>
                    <p className="mt-1 text-sm text-gray-900">${selectedApplication.existing_debt.toLocaleString()}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Credit Score</label>
                    <p className="mt-1 text-sm text-gray-900">{selectedApplication.credit_score}</p>
                  </div>
                </div>
              </div>

              {/* Application Status */}
              <div className="mb-8">
                <h4 className="text-lg font-semibold text-gray-900 mb-4">Application Status</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Current Status</label>
                    <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(selectedApplication.status)}`}>
                      {selectedApplication.status}
                    </span>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Matched Lenders</label>
                    <p className="mt-1 text-sm text-gray-900">{selectedApplication.matchedLenders} lenders</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Created</label>
                    <p className="mt-1 text-sm text-gray-900">{new Date(selectedApplication.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>

              {/* Documents */}
              {selectedApplication.documents && selectedApplication.documents.length > 0 && (
                <div className="mb-8">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4">Documents</h4>
                  <div className="space-y-2">
                    {selectedApplication.documents.map((doc, index) => (
                      <div key={index} className="flex items-center bg-gray-50 p-3 rounded">
                        <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                        <span className="text-sm text-gray-700">{doc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200">
                <button
                  onClick={() => setShowApplicationDetails(false)}
                  className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={() => handleDeleteApplication(selectedApplication.id)}
                  className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Delete Application
                </button>
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
                            onChange={(e) => handleUpdateSubmission(submission, { status: e.target.value as DBLenderSubmission['status'] })}
                            className={`px-3 py-1 rounded-full text-xs font-medium border-0 ${
                              submission.status === 'approved' ? 'bg-green-100 text-green-800' :
                              submission.status === 'declined' ? 'bg-red-100 text-red-800' :
                              submission.status === 'funded' ? 'bg-blue-100 text-blue-800' :
                              submission.status === 'counter-offer' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-gray-100 text-gray-800'
                            }`}
                          >
                            <option value="pending">Pending</option>
                            <option value="approved">Approved</option>
                            <option value="declined">Declined</option>
                            <option value="counter-offer">Counter Offer</option>
                            <option value="funded">Funded</option>
                          </select>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Offered Amount</label>
                            <input
                              type="number"
                              value={submission.offered_amount || ''}
                              onChange={(e) => handleUpdateSubmission(submission, { offered_amount: e.target.value === '' ? undefined : Number(e.target.value) })}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                              placeholder="Amount"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Factor Rate</label>
                            <input
                              type="text"
                              value={submission.factor_rate || ''}
                              onChange={(e) => handleUpdateSubmission(submission, { factor_rate: e.target.value === '' ? undefined : e.target.value })}
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
                            onChange={(e) => handleUpdateSubmission(submission, { terms: e.target.value === '' ? undefined : e.target.value })}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                            placeholder="12 months"
                          />
                        </div>
                        
                        <div className="mb-3">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Response</label>
                          <textarea
                            value={submission.response || ''}
                            onChange={(e) => handleUpdateSubmission(submission, { response: e.target.value === '' ? undefined : e.target.value })}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                            rows={2}
                            placeholder="Lender response..."
                          />
                        </div>
                        
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
                          <textarea
                            value={submission.notes || ''}
                            onChange={(e) => handleUpdateSubmission(submission, { notes: e.target.value === '' ? undefined : e.target.value })}
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