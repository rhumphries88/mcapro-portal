import React, { useState } from 'react';
import { Search, Eye, Edit, Download, DollarSign, Building2, Star, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { getApplicationsByUserId, getLenderSubmissions, Application as DBApplication, LenderSubmission as DBLenderSubmission } from '../lib/supabase';
import { useAuth } from '../App';

// Use database types
type Deal = DBApplication & {
  matchedLenders: number;
  lenderSubmissions: (DBLenderSubmission & { lender: { name: string } })[];
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
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  // Load applications from Supabase filtered by user_id
  React.useEffect(() => {
    const loadApplications = async () => {
      if (!user?.id) {
        console.log('No user ID available, skipping application load');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        console.log('Loading applications for user ID:', user.id);
        
        // Get applications filtered by the current user's ID
        const dbApplications = await getApplicationsByUserId(user.id);
        console.log('Found applications for user:', dbApplications.length);
        
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
  }, [user?.id]);

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

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">My Deals</h1>
        <p className="text-gray-600">View and manage your merchant cash advance submissions</p>
        {user && (
          <p className="text-sm text-gray-500 mt-1">Showing applications for: {user.name} ({user.email})</p>
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
              <p className="text-sm font-medium text-gray-600">My Deals</p>
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
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Deal Info
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Contact
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Financial
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Activity
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredDeals.map((deal) => (
                <tr key={deal.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{deal.business_name}</div>
                      <div className="text-sm text-gray-500">{deal.id}</div>
                      <div className="flex items-center mt-1">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(deal.status)}`}>
                          {deal.status}
                        </span>
                        <span className="ml-2 text-xs text-gray-500">website</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{deal.owner_name}</div>
                      <div className="text-sm text-gray-500">{deal.email}</div>
                      <div className="text-sm text-gray-500">{deal.phone || 'N/A'}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
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
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex flex-col space-y-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(deal.status)}`}>
                        {getStatusIcon(deal.status)}
                        <span className="ml-1">{deal.status.replace('-', ' ')}</span>
                      </span>
                      {deal.lenderSubmissions.length > 0 && (
                        <span className="text-xs text-gray-500">
                          {deal.lenderSubmissions.length} lender{deal.lenderSubmissions.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm text-gray-900">
                        Submitted: {new Date(deal.created_at).toLocaleDateString()}
                      </div>
                      <div className="text-sm text-gray-500">
                        Last: {new Date(deal.updated_at).toLocaleDateString()}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleViewDetails(deal)}
                        className="text-purple-600 hover:text-purple-900"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button className="text-blue-600 hover:text-blue-900" onClick={() => handleEditDeal(deal)}>
                        <Edit className="w-4 h-4" />
                      </button>
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