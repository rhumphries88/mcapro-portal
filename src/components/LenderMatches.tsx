import React, { useState, useEffect, useMemo } from 'react';
import { Star, CheckCircle, Building2, ArrowRight, Lock, TrendingUp, Clock, DollarSign, Award } from 'lucide-react';
import { getLenders, qualifyLenders, Lender as DBLender, Application as DBApplication } from '../lib/supabase';
import type { CleanedMatch } from '../lib/parseLenderMatches';

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
  matches?: CleanedMatch[];
  onLenderSelect: (lenderIds: string[]) => void;
  onBack: () => void;
  lockedLenderIds?: string[];
}

const LenderMatches: React.FC<LenderMatchesProps> = ({ application, matches, onLenderSelect, onBack, lockedLenderIds = [] }) => {
  const [lenders, setLenders] = useState<(DBLender & { match_score?: number; matchScore?: number })[]>([]);
  const [selectedLenderIds, setSelectedLenderIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const lockedSet = useMemo(() => new Set(lockedLenderIds), [lockedLenderIds]);

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

        // If cleaned matches provided, order lenders by response and attach match_score
        if (Array.isArray(matches) && matches.length > 0) {
          const byId = new Map(qualifiedLenders.map(l => [l.id, l] as const));
          const ordered: (DBLender & { match_score?: number; matchScore?: number })[] = [];
          for (const m of matches) {
            const found = byId.get(m.lender_id);
            if (found) {
              ordered.push({ ...found, match_score: m.match_score });
            }
          }
          setLenders(ordered);
        } else {
          setLenders(qualifiedLenders);
        }
        // Preselect locked lenders
        if (lockedLenderIds && lockedLenderIds.length > 0) {
          setSelectedLenderIds(prev => Array.from(new Set([
            ...lockedLenderIds,
            ...prev
          ])));
        }
      } catch (error) {
        console.error('Error loading lenders:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAndQualifyLenders();
  }, [application, matches, lockedLenderIds]);

  const handleLenderToggle = (lenderId: string) => {
    if (lockedSet.has(lenderId)) return; // prevent toggling locked lenders
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
//james 
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header Section */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-full text-emerald-700 text-sm font-medium mb-4">
          <CheckCircle className="w-4 h-4 mr-2" />
          {lenders.length} Qualified Lenders Found
        </div>
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Qualified Lenders</h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto">
          We've analyzed your business profile and found the best lending partners for your needs
        </p>
      </div>

      {/* Application Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
        <div className="bg-white rounded-2xl p-6 shadow-lg ring-1 ring-gray-100 hover:shadow-xl transition-shadow h-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shadow-inner">
              <DollarSign className="w-5 h-5 text-blue-600" />
            </div>
            <div className="text-sm font-medium text-gray-600">Requested Amount</div>
          </div>
          <div className="mt-3 text-3xl font-bold text-slate-800">${(application.requestedAmount || 0).toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-lg ring-1 ring-gray-100 hover:shadow-xl transition-shadow h-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center shadow-inner">
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <div className="text-sm font-medium text-gray-600">Monthly Revenue</div>
          </div>
          <div className="mt-3 text-3xl font-bold text-slate-800">${(application.monthlyRevenue || 0).toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-lg ring-1 ring-gray-100 hover:shadow-xl transition-shadow h-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center shadow-inner">
              <Award className="w-5 h-5 text-purple-600" />
            </div>
            <div className="text-sm font-medium text-gray-600">Credit Score</div>
          </div>
          <div className="mt-3 text-3xl font-bold text-slate-800">{application.creditScore || 'N/A'}</div>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-lg ring-1 ring-gray-100 hover:shadow-xl transition-shadow h-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center shadow-inner">
              <Building2 className="w-5 h-5 text-orange-600" />
            </div>
            <div className="text-sm font-medium text-gray-600">Industry</div>
          </div>
          <div className="mt-3 text-3xl font-bold text-slate-800">{application.industry || 'N/A'}</div>
        </div>
      </div>

      {/* Lender Cards */}
      <div className="space-y-6">
        {lenders.map((lender) => {
          const isLocked = lockedSet.has(lender.id);
          const isSelected = selectedLenderIds.includes(lender.id);
          return (
            <div
              key={lender.id}
              className={`group relative bg-white rounded-2xl border-2 transition-all duration-200 ${
                isLocked
                  ? 'border-gray-200 opacity-60 filter cursor-not-allowed'
                  : isSelected
                    ? 'border-emerald-400 bg-gradient-to-r from-emerald-50 to-green-50 shadow-lg shadow-emerald-100/50 cursor-pointer'
                    : 'border-gray-200 hover:border-blue-300 hover:shadow-xl hover:shadow-blue-100/50 cursor-pointer'
              }`}
              onClick={isLocked ? undefined : () => handleLenderToggle(lender.id)}
            >
              <div className="p-8">
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-start">
                    <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mr-6 shadow-sm ${
                      isSelected ? 'bg-gradient-to-br from-emerald-100 to-emerald-200 border-2 border-emerald-300' : 'bg-gradient-to-br from-blue-100 to-blue-200 border-2 border-blue-200'
                    }`}>
                      <Building2 className={`w-10 h-10 ${
                        isSelected ? 'text-emerald-700' : 'text-blue-700'
                      }`} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className={`text-2xl font-bold ${isLocked ? 'text-gray-700' : 'text-gray-900'}`}>{lender.name}</h3>
                        {isLocked && (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-700 border border-orange-200">
                            <Lock className="w-3 h-3 mr-1" />
                            Already Submitted
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mb-3">
                        <div className="flex items-center">
                          <Star className="w-5 h-5 text-yellow-400 fill-current mr-1" />
                          <span className="text-lg font-semibold text-gray-900">{lender.rating}</span>
                          <span className="text-sm text-gray-500 ml-1">/5.0</span>
                        </div>
                        <div className="h-4 w-px bg-gray-300"></div>
                        <div className="flex items-center">
                          <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                          <span className="text-sm font-medium text-gray-700">
                            {lender.approval_rate}% approval rate
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className={`text-2xl font-bold ${
                        isLocked ? 'text-gray-500' : (isSelected ? 'text-emerald-600' : 'text-blue-600')
                      }`}>
                        {(() => {
                          const score = lender.match_score;
                          if (typeof score === 'number') {
                            const pct = score <= 1 ? Math.round(score * 100) : Math.round(score);
                            return `${pct}%`;
                          }
                          const q = lender.matchScore;
                          return typeof q === 'number' ? `${Math.round(q)}%` : '95%';
                        })()
                      }</div>
                      <div className="text-sm font-medium text-gray-500">Match Score</div>
                    </div>
                    {!isLocked && (
                      <div className={`w-8 h-8 rounded-full border-3 flex items-center justify-center transition-all ${
                        isSelected 
                          ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg' 
                          : 'border-gray-300 text-gray-400 group-hover:border-blue-400 group-hover:text-blue-400'
                      }`}>
                        {isSelected && <CheckCircle className="w-5 h-5" />}
                      </div>
                    )}
                  </div>
                </div>

                {/* Lender Details Grid */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 border border-blue-200 p-4 rounded-xl">
                    <div className="flex items-center mb-2">
                      <DollarSign className="w-4 h-4 text-blue-600 mr-2" />
                      <div className="text-sm font-semibold text-blue-700">Amount Range</div>
                    </div>
                    <div className="text-lg font-bold text-blue-900">
                      ${lender.min_amount.toLocaleString()} - ${lender.max_amount.toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-green-50 to-green-100/50 border border-green-200 p-4 rounded-xl">
                    <div className="flex items-center mb-2">
                      <TrendingUp className="w-4 h-4 text-green-600 mr-2" />
                      <div className="text-sm font-semibold text-green-700">Factor Rate</div>
                    </div>
                    <div className="text-lg font-bold text-green-900">{lender.factor_rate}</div>
                  </div>
                  <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 border border-purple-200 p-4 rounded-xl">
                    <div className="flex items-center mb-2">
                      <Clock className="w-4 h-4 text-purple-600 mr-2" />
                      <div className="text-sm font-semibold text-purple-700">Payback Term</div>
                    </div>
                    <div className="text-lg font-bold text-purple-900">{lender.payback_term}</div>
                  </div>
                  <div className="bg-gradient-to-br from-orange-50 to-orange-100/50 border border-orange-200 p-4 rounded-xl">
                    <div className="flex items-center mb-2">
                      <Award className="w-4 h-4 text-orange-600 mr-2" />
                      <div className="text-sm font-semibold text-orange-700">Approval Time</div>
                    </div>
                    <div className="text-lg font-bold text-orange-900">{lender.approval_time}</div>
                  </div>
                </div>

                {/* Features */}
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 mb-3">Key Features</h4>
                  <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                    {lender.features && lender.features.length > 0 ? (
                      <div className="flex flex-wrap gap-2.5">
                        {lender.features.slice(0, 8).map((feature, index) => (
                          <span
                            key={index}
                            className={
                              'inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border bg-emerald-50 border-emerald-200 text-emerald-800'
                            }
                          >
                            <CheckCircle className="w-4 h-4 text-emerald-600" />
                            {feature}
                          </span>
                        ))}
                        {lender.features.length > 8 && (
                          <span className="inline-flex items-center px-3.5 py-2 rounded-lg text-sm font-medium bg-gray-50 text-gray-600 border border-gray-200">
                            +{lender.features.length - 8} more
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500">No feature information provided</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Action Buttons */}
      <div className="bg-white border-t border-gray-200 pt-8 mt-12">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <button
            onClick={onBack}
            className="w-full sm:w-auto px-6 py-3 border-2 border-gray-300 rounded-xl font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all duration-200"
          >
            Back to Application
          </button>
          <div className="flex items-center gap-4">
            {selectedLenderIds.length > 0 && (
              <div className="text-sm text-gray-600">
                <span className="font-semibold text-emerald-600">{selectedLenderIds.length}</span> lender{selectedLenderIds.length !== 1 ? 's' : ''} selected
              </div>
            )}
            <button
              onClick={handleContinue}
              disabled={selectedLenderIds.length === 0}
              className={`w-full sm:w-auto justify-center flex items-center px-8 py-4 rounded-xl font-semibold text-lg transition-all duration-200 ${
                selectedLenderIds.length > 0
                  ? 'bg-gradient-to-r from-emerald-600 to-emerald-700 text-white hover:from-emerald-700 hover:to-emerald-800 shadow-lg shadow-emerald-200/50 hover:shadow-xl hover:shadow-emerald-300/50'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              Continue with Selected Lenders
              <ArrowRight className="w-5 h-5 ml-2" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LenderMatches;