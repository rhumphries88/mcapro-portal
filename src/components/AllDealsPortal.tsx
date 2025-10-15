import React, { useState } from 'react';
import { Search, Eye, Edit, Download, DollarSign, Building2, Star, CheckCircle, XCircle, Clock, AlertTriangle, FileText } from 'lucide-react';
import { getApplicationsForMember, getAllApplications, getLenderSubmissions, getUserApplicationAccessMap, getApplicationDocuments, getApplicationMTDByApplicationId, Application as DBApplication, LenderSubmission as DBLenderSubmission } from '../lib/supabase';
import { useAuth } from '../App';

// Use database types
type Deal = DBApplication & {
  matchedLenders: number;
  lenderSubmissions: (DBLenderSubmission & { lender: { name: string } })[];
  user?: { full_name: string; email: string };
};

type AllDealsPortalProps = {
  onEditDeal?: (params: { applicationId: string; lockedLenderIds: string[] }) => void;
};

const AllDealsPortal: React.FC<AllDealsPortalProps> = ({ onEditDeal }) => {
  const { user } = useAuth(); // Get the current logged-in user
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [docsLoading, setDocsLoading] = useState(false);
  const [documents, setDocuments] = useState<Array<{ id: string; file_name: string; file_size?: number; file_type?: string; upload_date?: string; file_url?: string }>>([]);
  const [mtdDocuments, setMtdDocuments] = useState<Array<{ id: string; file_name: string; file_size?: number; file_type?: string; upload_date?: string; file_url?: string; statement_date?: string }>>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  // Load applications from Supabase - all applications for admin, user-specific for members
  React.useEffect(() => {
    const loadApplications = async () => {
      if (!user?.id) {
        console.log('No user ID available, skipping application load');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        
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
          // Member users see own + shared applications via access control
          dbApplications = await getApplicationsForMember(user.id);

          // Defensive client-side filter using access map (in case of legacy RLS or caching)
          try {
            const accessMap = await getUserApplicationAccessMap(user.id);
            dbApplications = dbApplications.filter((app: DBApplication) => {
              const isOwner = app.user_id === user.id;
              const flag = accessMap[app.id];
              // Keep own unless explicitly set to false; keep non-owned only if true
              return isOwner ? (flag === undefined ? true : flag === true) : flag === true;
            });
          } catch (e) {
            console.warn('Failed to fetch access map; proceeding without client-side filter', e);
          }
          console.log('Found applications for user:', dbApplications.length);
        }
        
        // Transform applications and load lender submissions
        const dealsWithSubmissions = await Promise.all(
          dbApplications.map(async (app) => {
            const submissions = await getLenderSubmissions(app.id);
            return {
              ...app,
              matchedLenders: submissions.length,
              lenderSubmissions: submissions
            };
          })
        );
        
        setDeals(dealsWithSubmissions);
      } catch (error) {
        console.error('Error loading applications:', error);
      } finally {
        setLoading(false);
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
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'funded':
        return 'bg-blue-100 text-blue-800';
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'submitted':
        return 'bg-yellow-100 text-yellow-800';
      case 'under-review':
        return 'bg-purple-100 text-purple-800';
      case 'declined':
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
      case 'submitted':
        return <Clock className="w-4 h-4" />;
      case 'under-review':
        return <AlertTriangle className="w-4 h-4" />;
      case 'declined':
        return <XCircle className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const filteredDeals = deals.filter(deal => {
    const matchesSearch = deal.business_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         deal.owner_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         deal.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || deal.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusCounts = {
    all: deals.length,
    submitted: deals.filter(d => d.status === 'submitted').length,
    approved: deals.filter(d => d.status === 'approved').length,
    declined: deals.filter(d => d.status === 'declined').length,
  };

  const handleEditDeal = (deal: Deal) => {
    const lockedIds = Array.from(new Set(
      (deal.lenderSubmissions || [])
        .map((ls: DBLenderSubmission & { lender: { name: string } }) => ls.lender_id)
        .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    ));
    onEditDeal?.({ applicationId: deal.id, lockedLenderIds: lockedIds });
  };

  const handleViewDetails = (deal: Deal) => {
    setSelectedDeal(deal);
    setShowDetails(true);
  };

  const handleViewDocuments = async (deal: Deal) => {
    setSelectedDeal(deal);
    setShowDocs(true);
    setDocsLoading(true);
    try {
      const [rows, mtdRows] = await Promise.all([
        getApplicationDocuments(deal.id),
        getApplicationMTDByApplicationId(deal.id)
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
    } catch (e) {
      console.error('Failed to load documents', e);
      setDocuments([]);
      setMtdDocuments([]);
    } finally {
      setDocsLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading applications...</p>
          </div>
        </div>
      )}

      {/* Documents Modal */}
      {showDocs && selectedDeal && (
        <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="h-12 w-12 rounded-xl bg-white bg-opacity-20 flex items-center justify-center">
                    <FileText className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-white">Application Documents</h3>
                    <p className="text-blue-100 text-sm">{selectedDeal.business_name}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowDocs(false)} 
                  className="h-10 w-10 rounded-full bg-white bg-opacity-20 hover:bg-opacity-30 flex items-center justify-center text-white transition-all duration-200"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-8">
              {docsLoading ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="relative">
                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-200 border-t-blue-600"></div>
                  </div>
                  <p className="text-gray-600 text-sm mt-4 font-medium">Loading documents...</p>
                </div>
              ) : documents.length === 0 ? (
                <div className="text-center py-16">
                  <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                    <FileText className="w-8 h-8 text-gray-400" />
                  </div>
                  <h4 className="text-lg font-medium text-gray-900 mb-2">No Documents Found</h4>
                  <p className="text-gray-500 text-sm">No documents have been uploaded for this application yet.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900">Uploaded Documents</h4>
                      <p className="text-sm text-gray-500">{documents.length} document{documents.length !== 1 ? 's' : ''} available</p>
                    </div>
                  </div>
                  
                  <div className="grid gap-4">
                    {documents.map((doc, index) => (
                      <div key={doc.id} className="group bg-gray-50 hover:bg-gray-100 border border-gray-200 hover:border-gray-300 rounded-xl p-6 transition-all duration-200 hover:shadow-md">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4 flex-1">
                            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                              <span className="text-white font-semibold text-sm">
                                {(index + 1).toString().padStart(2, '0')}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2 mb-1">
                                <h5 className="text-sm font-semibold text-gray-900 truncate">{doc.file_name}</h5>
                                <span className="inline-flex px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                                  {doc.file_type?.split('/')[1]?.toUpperCase() || 'FILE'}
                                </span>
                              </div>
                              <div className="flex items-center space-x-3 text-xs text-gray-500">
                                <span className="flex items-center">
                                  <Building2 className="w-3 h-3 mr-1" />
                                  {doc.file_size ? `${(doc.file_size / 1024).toFixed(1)} KB` : 'Size unknown'}
                                </span>
                                {doc.upload_date && (
                                  <span className="flex items-center">
                                    <Clock className="w-3 h-3 mr-1" />
                                    {new Date(doc.upload_date).toLocaleDateString('en-US', { 
                                      month: 'short', 
                                      day: 'numeric', 
                                      year: 'numeric' 
                                    })}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-3">
                            {doc.file_url ? (
                              <>
                                <button className="inline-flex items-center px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                                  <Download className="w-3 h-3 mr-1" />
                                  Download
                                </button>
                                <a 
                                  href={doc.file_url} 
                                  target="_blank" 
                                  rel="noreferrer" 
                                  className="inline-flex items-center px-4 py-2 text-xs font-medium text-white bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-sm hover:shadow-md"
                                >
                                  <Eye className="w-3 h-3 mr-1" />
                                  Open
                                </a>
                              </>
                            ) : (
                              <span className="inline-flex items-center px-3 py-2 text-xs text-gray-400 bg-gray-100 rounded-lg">
                                <XCircle className="w-3 h-3 mr-1" />
                                No URL
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* MTD Section */}
                  <div className="flex items-center justify-between mt-10 mb-6">
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900">Bank Statements (MTD)</h4>
                      <p className="text-sm text-gray-500">{mtdDocuments.length} file{mtdDocuments.length !== 1 ? 's' : ''} available</p>
                    </div>
                  </div>
                  <div className="grid gap-4">
                    {mtdDocuments.map((doc, index) => (
                      <div key={doc.id} className="group bg-gray-50 hover:bg-gray-100 border border-gray-200 hover:border-gray-300 rounded-xl p-6 transition-all duration-200 hover:shadow-md">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4 flex-1">
                            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                              <span className="text-white font-semibold text-sm">
                                {(index + 1).toString().padStart(2, '0')}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2 mb-1">
                                <h5 className="text-sm font-semibold text-gray-900 truncate">{doc.file_name}</h5>
                                <span className="inline-flex px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded-full">MTD</span>
                              </div>
                              <div className="flex items-center space-x-3 text-xs text-gray-500">
                                <span className="flex items-center">
                                  <Building2 className="w-3 h-3 mr-1" />
                                  {doc.file_size ? `${(doc.file_size / 1024).toFixed(1)} KB` : 'Size unknown'}
                                </span>
                                {doc.statement_date && (
                                  <span className="flex items-center">
                                    <Clock className="w-3 h-3 mr-1" />
                                    {new Date(doc.statement_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-3">
                            {doc.file_url ? (
                              <>
                                <button className="inline-flex items-center px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                                  <Download className="w-3 h-3 mr-1" />
                                  Download
                                </button>
                                <a 
                                  href={doc.file_url} 
                                  target="_blank" 
                                  rel="noreferrer" 
                                  className="inline-flex items-center px-4 py-2 text-xs font-medium text-white bg-gradient-to-r from-purple-600 to-purple-700 rounded-lg hover:from-purple-700 hover:to-purple-800 transition-all duration-200 shadow-sm hover:shadow-md"
                                >
                                  <Eye className="w-3 h-3 mr-1" />
                                  Open
                                </a>
                              </>
                            ) : (
                              <span className="inline-flex items-center px-3 py-2 text-xs text-gray-400 bg-gray-100 rounded-lg">
                                <XCircle className="w-3 h-3 mr-1" />
                                No URL
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="bg-gray-50 px-8 py-4 border-t border-gray-200">
              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-500">
                  Application ID: {selectedDeal.id}
                </div>
                <button 
                  onClick={() => setShowDocs(false)} 
                  className="px-6 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Close
                </button>
              </div>
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
              <p className="text-sm font-medium text-gray-600">Submitted</p>
              <p className="text-2xl font-bold text-gray-900">
                {statusCounts.submitted}
              </p>
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
                placeholder="Search deals..."
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
              <option value="submitted">Submitted ({statusCounts.submitted})</option>
              <option value="approved">Approved ({statusCounts.approved})</option>
              <option value="approved">Approved ({statusCounts.approved})</option>
              <option value="declined">Declined ({statusCounts.declined})</option>
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <button className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center">
              <Download className="w-4 h-4 mr-2" />
              Export
            </button>
          </div>
        </div>
      </div>

      {/* Deals Table */}
      <div className="bg-white rounded-xl shadow-lg overflow-hidden">
        <div className={`${user && (user.role === 'admin' || user.role === 'Admin') ? '' : 'overflow-x-auto'}`}>
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
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredDeals.map((deal) => (
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
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end space-x-2">
                      <div className="flex items-center bg-gray-50 rounded-lg p-1 border border-gray-200 shadow-sm">
                        <button
                          onClick={() => handleViewDetails(deal)}
                          className="group relative inline-flex items-center justify-center w-9 h-9 text-purple-600 hover:text-white hover:bg-gradient-to-r hover:from-purple-500 hover:to-purple-600 rounded-md transition-all duration-300 hover:shadow-md hover:scale-110"
                          title="View details"
                        >
                          <Eye className="w-4 h-4 transition-transform group-hover:scale-110" />
                          <div className="absolute inset-0 bg-purple-100 rounded-md opacity-0 group-hover:opacity-20 transition-opacity duration-300"></div>
                        </button>
                        <div className="w-px h-6 bg-gray-300 mx-1"></div>
                        <button
                          className="group relative inline-flex items-center justify-center w-9 h-9 text-gray-600 hover:text-white hover:bg-gradient-to-r hover:from-gray-500 hover:to-gray-600 rounded-md transition-all duration-300 hover:shadow-md hover:scale-110"
                          title="View documents"
                          onClick={() => handleViewDocuments(deal)}
                        >
                          <FileText className="w-4 h-4 transition-transform group-hover:scale-110" />
                          <div className="absolute inset-0 bg-gray-100 rounded-md opacity-0 group-hover:opacity-20 transition-opacity duration-300"></div>
                        </button>
                        <div className="w-px h-6 bg-gray-300 mx-1"></div>
                        <button 
                          className="group relative inline-flex items-center justify-center w-9 h-9 text-blue-600 hover:text-white hover:bg-gradient-to-r hover:from-blue-500 hover:to-blue-600 rounded-md transition-all duration-300 hover:shadow-md hover:scale-110"
                          onClick={() => handleEditDeal(deal)}
                          title="Edit deal"
                        >
                          <Edit className="w-4 h-4 transition-transform group-hover:scale-110" />
                          <div className="absolute inset-0 bg-blue-100 rounded-md opacity-0 group-hover:opacity-20 transition-opacity duration-300"></div>
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Deal Details Modal */}
      {showDetails && selectedDeal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">
                  Deal Details - {selectedDeal.business_name}
                </h3>
                <button
                  onClick={() => setShowDetails(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Business Information</h4>
                  <div className="space-y-2 text-sm">
                    <div><span className="text-gray-500">Business Name:</span> <span className="font-medium">{selectedDeal.business_name}</span></div>
                    <div><span className="text-gray-500">Industry:</span> <span className="font-medium">{selectedDeal.industry}</span></div>
                    <div><span className="text-gray-500">Time in Business:</span> <span className="font-medium">{selectedDeal.years_in_business} years</span></div>
                    <div><span className="text-gray-500">Monthly Revenue:</span> <span className="font-medium">${selectedDeal.monthly_revenue.toLocaleString()}</span></div>
                    <div><span className="text-gray-500">Credit Score:</span> <span className="font-medium">{selectedDeal.credit_score}</span></div>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Contact Information</h4>
                  <div className="space-y-2 text-sm">
                    <div><span className="text-gray-500">Owner:</span> <span className="font-medium">{selectedDeal.owner_name}</span></div>
                    <div><span className="text-gray-500">Email:</span> <span className="font-medium">{selectedDeal.email}</span></div>
                    <div><span className="text-gray-500">Phone:</span> <span className="font-medium">{selectedDeal.phone || 'N/A'}</span></div>
                    <div><span className="text-gray-500">Source:</span> <span className="font-medium">website</span></div>
                  </div>
                </div>
              </div>
              
              {/* Lender Submissions Section */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h4 className="text-lg font-medium text-gray-900 mb-4">
                  Lender Submissions ({selectedDeal.lenderSubmissions.length})
                </h4>
                <div className="space-y-4">
                  {selectedDeal.lenderSubmissions.map((submission, index) => (
                    <div key={index} className="bg-gray-50 rounded-lg p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h5 className="font-medium text-gray-900">{submission.lender.name}</h5>
                          <p className="text-sm text-gray-500">
                            Submitted: {new Date(submission.created_at).toLocaleDateString()}
                            {submission.response_date && (
                              <span> • Responded: {new Date(submission.response_date).toLocaleDateString()}</span>
                            )}
                          </p>
                        </div>
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${getLenderStatusColor(submission.status)}`}>
                          {submission.status}
                        </span>
                      </div>
                      
                      {submission.response && (
                        <div className="mb-3">
                          <p className="text-sm text-gray-700">
                            <span className="font-medium">Response:</span> {submission.response}
                          </p>
                        </div>
                      )}
                      
                      {(submission.offered_amount || submission.factor_rate || submission.terms) && (
                        <div className="grid grid-cols-3 gap-4 mb-3">
                          {submission.offered_amount && (
                            <div>
                              <span className="text-xs text-gray-500">Offered Amount</span>
                              <p className="font-medium text-sm">${submission.offered_amount.toLocaleString()}</p>
                            </div>
                          )}
                          {submission.factor_rate && (
                            <div>
                              <span className="text-xs text-gray-500">Factor Rate</span>
                              <p className="font-medium text-sm">{submission.factor_rate}</p>
                            </div>
                          )}
                          {submission.terms && (
                            <div>
                              <span className="text-xs text-gray-500">Terms</span>
                              <p className="font-medium text-sm">{submission.terms}</p>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {submission.notes && (
                        <div className="text-xs text-gray-600 bg-white p-2 rounded border">
                          <span className="font-medium">Notes:</span> {submission.notes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="mt-6 pt-6 border-t border-gray-200">
                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => setShowDetails(false)}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Close
                  </button>
                  <button
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                    onClick={() => handleEditDeal(selectedDeal)}
                  >
                    Edit Deal
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AllDealsPortal;