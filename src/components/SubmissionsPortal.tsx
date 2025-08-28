import React, { useState } from 'react';
import { CheckCircle } from 'lucide-react';
import ApplicationForm from './ApplicationForm';
import LenderMatches from './LenderMatches';
import SubmissionRecap from './SubmissionRecap';
import SubmissionIntermediate from './SubmissionIntermediate';

// Broad application data type to interop with both LenderMatches and SubmissionRecap
type AppData = {
  id: string;
  businessName: string;
  monthlyRevenue: number;
  timeInBusiness: number;
  creditScore: number;
  industry: string;
  requestedAmount: number;
  status?: 'draft' | 'submitted' | 'under-review' | 'approved' | 'matched';
  // Top-level fields expected by LenderMatches
  ownerName: string;
  email: string;
  phone?: string;
  address?: string;
  ein?: string;
  businessType?: string;
  yearsInBusiness?: number;
  numberOfEmployees?: number;
  annualRevenue?: number;
  monthlyDeposits?: number;
  existingDebt?: number;
  documents: string[];
  // Nested fields expected by SubmissionRecap
  contactInfo: {
    ownerName: string;
    email: string;
    phone: string;
    address: string;
  };
  businessInfo: {
    ein: string;
    businessType: string;
    yearsInBusiness: number;
    numberOfEmployees: number;
  };
  financialInfo: {
    annualRevenue: number;
    averageMonthlyRevenue: number;
    averageMonthlyDeposits: number;
    existingDebt: number;
  };
};

// Local type mirroring ApplicationForm's Application output
type FormApplication = {
  id: string;
  businessName: string;
  monthlyRevenue: number;
  timeInBusiness: number;
  creditScore: number;
  industry: string;
  requestedAmount: number;
  status: 'draft' | 'submitted' | 'under-review' | 'approved' | 'matched';
  contactInfo: {
    ownerName: string;
    email: string;
    phone: string;
    address: string;
  };
  businessInfo: {
    ein: string;
    businessType: string;
    yearsInBusiness: number;
    numberOfEmployees: number;
  };
  financialInfo: {
    annualRevenue: number;
    averageMonthlyRevenue: number;
    averageMonthlyDeposits: number;
    existingDebt: number;
  };
  documents: string[];
};

const SubmissionsPortal: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<'application' | 'intermediate' | 'matches' | 'recap'>('application');
  const [prevStep, setPrevStep] = useState<'application' | 'intermediate' | 'matches' | 'recap' | null>(null);
  const [application, setApplication] = useState<AppData | null>(null);
  const [selectedLenders, setSelectedLenders] = useState<string[]>([]);
  const [intermediateLoading, setIntermediateLoading] = useState(false);
  const [intermediatePrefill, setIntermediatePrefill] = useState<Record<string, string | boolean> | null>(null);

  // simple navigation helpers so Back returns to the real previous page
  const goTo = (next: 'application' | 'intermediate' | 'matches' | 'recap') => {
    setPrevStep(currentStep);
    setCurrentStep(next);
  };
  const goBack = () => {
    if (prevStep) {
      const target = prevStep;
      // update prev to the step we are leaving (simple 1-step memory)
      setPrevStep(currentStep);
      setCurrentStep(target);
    }
  };

  const handleApplicationSubmit = (appData: FormApplication, extra?: { pdfFile?: File } | null) => {
    // Map to unified AppData with both nested and top-level fields
    const mapped: AppData = {
      id: appData.id,
      businessName: appData.businessName,
      monthlyRevenue: appData.monthlyRevenue,
      timeInBusiness: appData.timeInBusiness,
      creditScore: appData.creditScore,
      industry: appData.industry,
      requestedAmount: appData.requestedAmount,
      status: appData.status,
      // top-level duplicates for LenderMatches
      ownerName: appData.contactInfo.ownerName,
      email: appData.contactInfo.email,
      phone: appData.contactInfo.phone,
      address: appData.contactInfo.address,
      ein: appData.businessInfo.ein,
      businessType: appData.businessInfo.businessType,
      yearsInBusiness: appData.businessInfo.yearsInBusiness,
      numberOfEmployees: appData.businessInfo.numberOfEmployees,
      annualRevenue: appData.financialInfo.annualRevenue,
      monthlyDeposits: appData.financialInfo.averageMonthlyDeposits,
      existingDebt: appData.financialInfo.existingDebt,
      documents: appData.documents,
      // nested for SubmissionRecap
      contactInfo: appData.contactInfo,
      businessInfo: appData.businessInfo,
      financialInfo: appData.financialInfo,
    };
    setApplication(mapped);
    setIntermediateLoading(true);
    setIntermediatePrefill(null);
    goTo('intermediate');

    // Call webhook here using the passed PDF, showing loading while we await
    (async () => {
      try {
        if (extra?.pdfFile) {
          const url = '/webhook/newDeal';
          const form = new FormData();
          form.append('file', extra.pdfFile, extra.pdfFile.name);
          const resp = await fetch(url, { method: 'POST', body: form });
          let data: Record<string, unknown> | null = null;
          try { data = await resp.json(); } catch { data = null; }

          const read = (src: Record<string, unknown>, key: string): string => {
            const v = src[key];
            if (typeof v === 'string') return v;
            if (typeof v === 'number' || typeof v === 'boolean') return String(v);
            return '';
          };
          const src = data || {};
          const normalized: Record<string, string | boolean> = {};
          // Only specified fields
          normalized.entityType = read(src, 'Entity Type');
          normalized.state = read(src, 'State');
          normalized.grossAnnualRevenue = read(src, 'Gross Annual Revenue');
          normalized.avgDailyBalance = read(src, 'Avg Daily Balance');
          normalized.avgMonthlyDepositCount = read(src, 'Avg Monthly Deposit Count');
          normalized.nsfCount = read(src, 'NSF Count');
          normalized.negativeDays = read(src, 'Negative Days');
          normalized.currentPositionCount = read(src, 'Current Position Count');
          normalized.holdback = read(src, 'Holdback');

          setIntermediatePrefill(normalized);
        }
      } catch (err) {
        console.warn('PDF webhook failed:', err);
        setIntermediatePrefill(null);
      } finally {
        setIntermediateLoading(false);
      }
    })();
  };

  // Merge intermediate edits into the application and notify lenders webhook with the full updated row
  const handleIntermediateContinue = (details: Record<string, string | boolean>) => {
    if (!application) {
      goTo('matches');
      return;
    }
    // Helper to parse numeric from possibly formatted strings
    const num = (v: unknown) => {
      if (typeof v === 'number') return v;
      if (typeof v !== 'string') return NaN;
      const cleaned = v.replace(/[^0-9.]/g, '');
      const parts = cleaned.split('.');
      const joined = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;
      const n = Number(joined);
      return isNaN(n) ? NaN : n;
    };

    const updated: AppData = {
      ...application,
      // mapped updates from details
      businessName: (details.dealName as string) || application.businessName,
      industry: (details.industry as string) || application.industry,
      // entityType from details maps to businessType if present on AppData
      businessType: (details.entityType as string) || application.businessType,
      creditScore: isNaN(num(details.creditScore)) ? application.creditScore : num(details.creditScore),
      timeInBusiness: isNaN(num(details.timeInBiz)) ? application.timeInBusiness : num(details.timeInBiz),
      monthlyRevenue: isNaN(num(details.avgMonthlyRevenue)) ? application.monthlyRevenue : num(details.avgMonthlyRevenue),
      annualRevenue: isNaN(num(details.grossAnnualRevenue)) ? application.annualRevenue : num(details.grossAnnualRevenue),
      monthlyDeposits: isNaN(num(details.avgMonthlyDepositCount)) ? (application.monthlyDeposits ?? 0) : num(details.avgMonthlyDepositCount),
      // keep others as-is
    };

    setApplication(updated);

    // Fire-and-forget webhook with the full updated applications row
    (async () => {
      try {
        await fetch('/webhook/applications/lenders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated),
        });
      } catch (e) {
        console.warn('applications/lenders webhook failed:', e);
      } finally {
        goTo('matches');
      }
    })();
  };

  const handleLendersSelected = (lenderIds: string[]) => {
    setSelectedLenders(lenderIds);
    goTo('recap');
  };

  const handleBackToMatches = () => {
    goTo('matches');
  };

  const handleFinalSubmit = () => {
    // This will be handled by the recap component
    console.log('Final submission completed');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Submissions Portal</h1>
        <p className="text-gray-600">Submit your merchant cash advance application and get matched with qualified lenders</p>
      </div>

      {/* Progress Steps */}
      <div className="mb-8">
        <div className="flex items-center">
          <div className={`flex items-center ${currentStep === 'application' ? 'text-blue-600' : application ? 'text-green-600' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              application ? 'bg-green-100 text-green-600' : currentStep === 'application' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
            }`}>
              {application ? <CheckCircle className="w-5 h-5" /> : '1'}
            </div>
            <span className="ml-2 text-sm font-medium">Document Upload & Application</span>
          </div>
          
          <div className={`flex-1 h-1 mx-4 ${application ? 'bg-green-200' : 'bg-gray-200'}`}></div>
          
          <div className={`flex items-center ${currentStep === 'matches' ? 'text-blue-600' : selectedLenders.length > 0 ? 'text-green-600' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              selectedLenders.length > 0 ? 'bg-green-100 text-green-600' : currentStep === 'matches' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
            }`}>
              {selectedLenders.length > 0 ? <CheckCircle className="w-5 h-5" /> : '2'}
            </div>
            <span className="ml-2 text-sm font-medium">Lender Matches</span>
          </div>
          
          <div className={`flex-1 h-1 mx-4 ${selectedLenders.length > 0 ? 'bg-green-200' : 'bg-gray-200'}`}></div>
          
          <div className={`flex items-center ${currentStep === 'recap' ? 'text-blue-600' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              currentStep === 'recap' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
            }`}>
              3
            </div>
            <span className="ml-2 text-sm font-medium">Submission Recap</span>
          </div>
        </div>
      </div>

      {/* Content */}
      {currentStep === 'application' ? (
        <ApplicationForm onSubmit={handleApplicationSubmit} />
      ) : currentStep === 'intermediate' ? (
        <SubmissionIntermediate
          initial={{
            id: application?.id ?? '',
            applicationId: application?.id ?? '',
            dealName: (intermediatePrefill?.dealName as string) ?? application?.businessName ?? '',
            industry: (intermediatePrefill?.industry as string) ?? application?.industry ?? '',
            entityType: (intermediatePrefill?.entityType as string) ?? application?.businessType ?? '',
            state: (intermediatePrefill?.state as string) ?? '',
            creditScore: (intermediatePrefill?.creditScore as string) ?? String(application?.creditScore ?? ''),
            timeInBiz: (intermediatePrefill?.timeInBiz as string) ?? String(application?.timeInBusiness ?? ''),
            avgMonthlyRevenue: (intermediatePrefill?.avgMonthlyRevenue as string) ?? String(application?.monthlyRevenue ?? ''),
            grossAnnualRevenue: (intermediatePrefill?.grossAnnualRevenue as string) ?? String(application?.annualRevenue ?? ''),
            avgDailyBalance: (intermediatePrefill?.avgDailyBalance as string) ?? '',
            avgMonthlyDepositCount: (intermediatePrefill?.avgMonthlyDepositCount as string) ?? String(application?.monthlyDeposits ?? ''),
            nsfCount: (intermediatePrefill?.nsfCount as string) ?? '',
            negativeDays: (intermediatePrefill?.negativeDays as string) ?? '',
            currentPositionCount: (intermediatePrefill?.currentPositionCount as string) ?? '',
            holdback: (intermediatePrefill?.holdback as string) ?? '',
            hasBankruptcies: Boolean(intermediatePrefill?.hasBankruptcies) || false,
            hasOpenJudgments: Boolean(intermediatePrefill?.hasOpenJudgments) || false,
          }}
          loading={intermediateLoading}
          onBack={goBack}
          onContinue={handleIntermediateContinue}
        />
      ) : currentStep === 'matches' ? (
        <LenderMatches 
          application={application}
          onBack={goBack} 
          onLenderSelect={handleLendersSelected}
        />
      ) : (
        <SubmissionRecap 
          application={application ? {
            ...application,
            status: (['draft','submitted','under-review','matched'].includes(String(application.status))
              ? (application.status as 'draft' | 'submitted' | 'under-review' | 'matched')
              : 'submitted')
          } : null}
          selectedLenderIds={selectedLenders}
          onBack={handleBackToMatches}
          onSubmit={handleFinalSubmit}
        />
      )}
    </div>
  );
};

export default SubmissionsPortal;