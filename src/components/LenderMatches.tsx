import React, { useState, useEffect } from 'react';
import { Star, CheckCircle, Building2, ArrowRight } from 'lucide-react';
import { getLenders, qualifyLenders, Lender as DBLender, Application as DBApplication } from '../lib/supabase';

// Application interface matching the camelCase structure from ApplicationForm
interface Application {
  businessName: string;
  ownerName: string;
  email: string;
  phone?: string;
  address?: string;
  ein?: string;
  businessType?: string;
  industry?: string;
  yearsInBusiness?: number;
  numberOfEmployees?: number;
  annualRevenue?: number;
  monthlyRevenue?: number;
  monthlyDeposits?: number;
  existingDebt?: number;
  creditScore?: number;
  requestedAmount?: number;
  status?: string;
  documents?: string[];
}

interface LenderMatchesProps {
  application: Application | null;
  onLenderSelect: (lenderIds: string[]) => void;
  onBack: () => void;
}

const LenderMatches: React.FC<LenderMatchesProps> = ({ application, onLenderSelect, onBack }) => {
  const [lenders, setLenders] = useState<DBLender[]>([]);
  const [selectedLenderIds, setSelectedLenderIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAndQualifyLenders = async () => {
      if (!application) return;
      
      try {
        setLoading(true);
        const allLenders = await getLenders();
        
        // Ensure allLenders is an array
        const lendersArray = allLenders || [];
        
        // Convert camelCase application to snake_case for database compatibility
        // Coerce status to allowed union
        const allowedStatus: DBApplication['status'][] = ['draft', 'submitted', 'under-review', 'approved', 'funded', 'declined'];
        const status: DBApplication['status'] = allowedStatus.includes((application.status as DBApplication['status']))
          ? (application.status as DBApplication['status'])
          : 'draft';

        const dbApplication: DBApplication = {
          id: '',
          business_name: application.businessName || '',
          owner_name: application.ownerName || '',
          email: application.email || '',
          phone: application.phone || '',
          address: application.address || '',
          ein: application.ein || '',
          business_type: application.businessType || '',
          industry: application.industry || '',
          years_in_business: application.yearsInBusiness || 0,
          number_of_employees: application.numberOfEmployees || 0,
          annual_revenue: application.annualRevenue || 0,
          monthly_revenue: application.monthlyRevenue || 0,
          monthly_deposits: application.monthlyDeposits || 0,
          existing_debt: application.existingDebt || 0,
          credit_score: application.creditScore || 0,
          requested_amount: application.requestedAmount || 0,
          status,
          documents: application.documents || [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          // user_id is optional; omit when not available
        };
        
        const qualifiedLenders = await qualifyLenders(lendersArray, dbApplication);
        setLenders(qualifiedLenders);
      } catch (error) {
        console.error('Error loading lenders:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAndQualifyLenders();
  }, [application]);

  const handleLenderToggle = (lenderId: string) => {
    setSelectedLenderIds(prev => 
      prev.includes(lenderId)
        ? prev.filter(id => id !== lenderId)
        : [...prev, lenderId]
    );
  };

  const handleContinue = () => {
    onLenderSelect(selectedLenderIds);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Finding qualified lenders...</p>
        </div>
      </div>
    );
  }

  if (!application) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No application data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-3xl font-bold text-gray-900 mb-4">Qualified Lenders</h2>
        <p className="text-gray-600 mb-6">
          We found {lenders.length} lenders that match your business profile
        </p>
        
        {/* Application Summary */}
        <div className="bg-blue-50 rounded-xl p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-900">${(application.requestedAmount || 0).toLocaleString()}</div>
              <div className="text-sm text-blue-600">Requested Amount</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-900">${(application.monthlyRevenue || 0).toLocaleString()}</div>
              <div className="text-sm text-blue-600">Monthly Revenue</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-900">{application.creditScore || 0}</div>
              <div className="text-sm text-blue-600">Credit Score</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-900">{application.industry || 'N/A'}</div>
              <div className="text-sm text-blue-600">Industry</div>
            </div>
          </div>
        </div>
      </div>

      {/* Lender Cards */}
      <div className="grid gap-6">
        {lenders.map((lender) => (
          <div
            key={lender.id}
            className={`bg-white rounded-xl shadow-lg p-6 border-2 transition-all cursor-pointer ${
              selectedLenderIds.includes(lender.id)
                ? 'border-emerald-500 bg-emerald-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
            onClick={() => handleLenderToggle(lender.id)}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center">
                <div className="w-16 h-16 bg-emerald-100 rounded-lg flex items-center justify-center mr-4">
                  <Building2 className="w-8 h-8 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{lender.name}</h3>
                  <div className="flex items-center mt-1">
                    <Star className="w-4 h-4 text-yellow-400 fill-current mr-1" />
                    <span className="text-sm font-medium">{lender.rating}</span>
                    <span className="text-sm text-gray-500 ml-2">
                      {lender.approval_rate}% approval rate
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <div className="text-right">
                  <div className="text-lg font-bold text-emerald-600">95% Match</div>
                  <div className="text-sm text-gray-500">Qualification Score</div>
                </div>
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                  selectedLenderIds.includes(lender.id)
                    ? 'bg-emerald-500 border-emerald-500'
                    : 'border-gray-300'
                }`}>
                  {selectedLenderIds.includes(lender.id) && (
                    <CheckCircle className="w-4 h-4 text-white" />
                  )}
                </div>
              </div>
            </div>

            {/* Lender Details */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div className="bg-blue-50 p-3 rounded-lg">
                <div className="text-sm text-blue-600 font-medium">Amount Range</div>
                <div className="text-sm font-bold text-blue-900">
                  ${lender.min_amount.toLocaleString()} - ${lender.max_amount.toLocaleString()}
                </div>
              </div>
              <div className="bg-green-50 p-3 rounded-lg">
                <div className="text-sm text-green-600 font-medium">Factor Rate</div>
                <div className="text-sm font-bold text-green-900">{lender.factor_rate}</div>
              </div>
              <div className="bg-purple-50 p-3 rounded-lg">
                <div className="text-sm text-purple-600 font-medium">Payback Term</div>
                <div className="text-sm font-bold text-purple-900">{lender.payback_term}</div>
              </div>
              <div className="bg-orange-50 p-3 rounded-lg">
                <div className="text-sm text-orange-600 font-medium">Approval Time</div>
                <div className="text-sm font-bold text-orange-900">{lender.approval_time}</div>
              </div>
            </div>

            {/* Features */}
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Key Features</h4>
              <div className="flex flex-wrap gap-2">
                {lender.features.slice(0, 4).map((feature, index) => (
                  <span key={index} className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-sm">
                    {feature}
                  </span>
                ))}
                {lender.features.length > 4 && (
                  <span className="text-sm text-gray-500">
                    +{lender.features.length - 4} more
                  </span>
                )}
              </div>
            </div>

            {/* Requirements Match */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="flex items-center">
                <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                <span className="text-gray-600">Amount: ✓</span>
              </div>
              <div className="flex items-center">
                <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                <span className="text-gray-600">Credit: ✓</span>
              </div>
              <div className="flex items-center">
                <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                <span className="text-gray-600">Revenue: ✓</span>
              </div>
              <div className="flex items-center">
                <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                <span className="text-gray-600">Industry: ✓</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-8 border-t border-gray-200">
        <button
          onClick={onBack}
          className="w-full sm:w-auto px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Back to Application
        </button>
        <button
          onClick={handleContinue}
          disabled={selectedLenderIds.length === 0}
          className={`w-full sm:w-auto justify-center flex items-center px-8 py-3 rounded-lg font-medium transition-colors ${
            selectedLenderIds.length > 0
              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          Continue with {selectedLenderIds.length} Lender{selectedLenderIds.length !== 1 ? 's' : ''}
          <ArrowRight className="w-5 h-5 ml-2" />
        </button>
      </div>
    </div>
  );
};

export default LenderMatches;