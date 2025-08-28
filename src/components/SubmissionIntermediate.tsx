import React, { useEffect, useState } from 'react';

// Lightweight details page shown after application submit and before lender matches
// Styled to match project cards/buttons and the reference layout (two-column inputs + blue primary button)

type Props = {
  onContinue: (details: Record<string, string | boolean>) => void;
  onBack?: () => void;
  // Optional prefill hooks if we want to seed values from application
  initial?: Partial<Record<string, string | boolean>>;
  loading?: boolean;
};

const SubmissionIntermediate: React.FC<Props> = ({ onContinue, onBack, initial, loading }) => {
  const [details, setDetails] = useState<Record<string, string | boolean>>({
    id: (initial?.id as string) || '',
    applicationId: (initial?.applicationId as string) || '',
    dealName: (initial?.dealName as string) || '',
    entityType: (initial?.entityType as string) || '',
    industry: (initial?.industry as string) || '',
    state: (initial?.state as string) || '',
    creditScore: (initial?.creditScore as string) || '',
    timeInBiz: (initial?.timeInBiz as string) || '',
    grossAnnualRevenue: (initial?.grossAnnualRevenue as string) || '',
    avgMonthlyRevenue: (initial?.avgMonthlyRevenue as string) || '',
    avgDailyBalance: (initial?.avgDailyBalance as string) || '',
    avgMonthlyDepositCount: (initial?.avgMonthlyDepositCount as string) || '',
    nsfCount: (initial?.nsfCount as string) || '',
    negativeDays: (initial?.negativeDays as string) || '',
    currentPositionCount: (initial?.currentPositionCount as string) || '',
    holdback: (initial?.holdback as string) || '',
    hasBankruptcies: Boolean(initial?.hasBankruptcies) || false,
    hasOpenJudgments: Boolean(initial?.hasOpenJudgments) || false,
  });

  // Keep form state in sync when `initial` updates (e.g., after webhook response arrives)
  useEffect(() => {
    if (!initial) return;
    setDetails(prev => ({
      ...prev,
      id: (initial.id as string) ?? (prev.id as string) ?? '',
      applicationId: (initial.applicationId as string) ?? (prev.applicationId as string) ?? '',
      dealName: (initial.dealName as string) ?? prev.dealName ?? '',
      entityType: (initial.entityType as string) ?? prev.entityType ?? '',
      industry: (initial.industry as string) ?? prev.industry ?? '',
      state: (initial.state as string) ?? prev.state ?? '',
      creditScore: (initial.creditScore as string) ?? (prev.creditScore as string) ?? '',
      timeInBiz: (initial.timeInBiz as string) ?? (prev.timeInBiz as string) ?? '',
      grossAnnualRevenue: (initial.grossAnnualRevenue as string) ?? (prev.grossAnnualRevenue as string) ?? '',
      avgMonthlyRevenue: (initial.avgMonthlyRevenue as string) ?? (prev.avgMonthlyRevenue as string) ?? '',
      avgDailyBalance: (initial.avgDailyBalance as string) ?? (prev.avgDailyBalance as string) ?? '',
      avgMonthlyDepositCount: (initial.avgMonthlyDepositCount as string) ?? (prev.avgMonthlyDepositCount as string) ?? '',
      nsfCount: (initial.nsfCount as string) ?? (prev.nsfCount as string) ?? '',
      negativeDays: (initial.negativeDays as string) ?? (prev.negativeDays as string) ?? '',
      currentPositionCount: (initial.currentPositionCount as string) ?? (prev.currentPositionCount as string) ?? '',
      holdback: (initial.holdback as string) ?? (prev.holdback as string) ?? '',
      hasBankruptcies: typeof initial.hasBankruptcies === 'boolean' ? initial.hasBankruptcies : Boolean(prev.hasBankruptcies),
      hasOpenJudgments: typeof initial.hasOpenJudgments === 'boolean' ? initial.hasOpenJudgments : Boolean(prev.hasOpenJudgments),
    }));
  }, [initial]);

  const set = (key: string, value: string | boolean) => setDetails(prev => ({ ...prev, [key]: value }));

  const [submitting, setSubmitting] = useState(false);
  const handleContinue = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await fetch('/webhook/updatingApplications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(details),
      });
    } catch (e) {
      console.error('Failed to notify updatingApplications webhook:', e);
      // proceed regardless to not block user flow
    } finally {
      setSubmitting(false);
      onContinue(details);
    }
  };

  const Input = ({
    label,
    placeholder,
    name,
    type = 'text',
  }: { label: string; placeholder: string; name: string; type?: string }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        value={(details[name] as string) || ''}
        onChange={(e) => set(name, e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );

  return (
    <div className="bg-white rounded-xl shadow-lg">
      <div className="px-8 py-6 border-b border-gray-200">
        <h2 className="text-2xl font-bold text-gray-900">New Deal</h2>
        <p className="text-gray-600 mt-1">Please confirm a few quick details before viewing lender matches.</p>
      </div>

      <div className="p-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <svg className="animate-spin h-8 w-8 text-blue-600 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
            </svg>
            <p className="text-gray-700 font-medium">Analyzing your application and preparing lender matches…</p>
            <p className="text-gray-500 text-sm mt-1">This usually takes just a few seconds.</p>
          </div>
        ) : (
        <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Deal Name" placeholder="Deal Name" name="dealName" />
          <Input label="Industry" placeholder="Industry" name="industry" />
          <Input label="Entity Type" placeholder="Entity Type (e.g., LLC)" name="entityType" />
          <Input label="State" placeholder="State (e.g., NY)" name="state" />
          <Input label="Credit Score" placeholder="Credit Score" name="creditScore" type="number" />
          <Input label="Time in Biz (months)" placeholder="Time in Biz (months)" name="timeInBiz" type="number" />
          <Input label="Avg Monthly Revenue" placeholder="Avg Monthly Revenue" name="avgMonthlyRevenue" type="number" />
          <Input label="Gross Annual Revenue" placeholder="Gross Annual Revenue" name="grossAnnualRevenue" type="text" />
          <Input label="Avg Daily Balance" placeholder="Avg Daily Balance" name="avgDailyBalance" type="text" />
          <Input label="Avg Monthly Deposit Count" placeholder="Avg Monthly Deposit Count (#)" name="avgMonthlyDepositCount" type="number" />
          <Input label="NSF Count" placeholder="NSF Count" name="nsfCount" type="number" />
          <Input label="Negative Days" placeholder="Negative Days (e.g., last 90d)" name="negativeDays" type="number" />
          <Input label="Current Position Count" placeholder="Current Position Count" name="currentPositionCount" type="number" />
          <Input label="Holdback" placeholder="Holdback" name="holdback" type="number" />
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-center space-x-2 text-gray-700">
            <input
              type="checkbox"
              checked={Boolean(details.hasBankruptcies)}
              onChange={(e) => set('hasBankruptcies', e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span>Has Bankruptcies</span>
          </label>
          <label className="flex items-center space-x-2 text-gray-700">
            <input
              type="checkbox"
              checked={Boolean(details.hasOpenJudgments)}
              onChange={(e) => set('hasOpenJudgments', e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span>Has Open Judgments</span>
          </label>
        </div>

        <div className="mt-6 flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={handleContinue}
            disabled={submitting}
            className={`inline-flex items-center rounded-md px-5 py-2.5 text-white font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${submitting ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {submitting ? 'Processing…' : 'Continue to Lender Matches'}
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
};

export default SubmissionIntermediate;
