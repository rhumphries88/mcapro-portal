import React from 'react';
import { Upload, FileText, Building2 } from 'lucide-react';
import { fmtCurrency, fmtCurrency2, isBusinessNameAndOwner, isFunderList, formatDateHuman, parseAmount } from './SubmissionIntermediate.helpers';

// Upload Dropzone
export type UploadDropzoneProps = {
  isDragOver: boolean;
  batchProcessing: boolean;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onChooseFiles: (files: FileList | null) => void;
};
export const UploadDropzone: React.FC<UploadDropzoneProps> = ({
  isDragOver,
  batchProcessing,
  onDragOver,
  onDragLeave,
  onDrop,
  onChooseFiles,
}) => (
  <div 
    className={`relative p-10 border-2 border-dashed rounded-3xl text-center transition-all duration-300 ${
      isDragOver 
        ? 'border-blue-400 bg-gradient-to-br from-blue-50 to-indigo-50 shadow-xl scale-[1.02]' 
        : 'border-gray-300 bg-gradient-to-br from-gray-50/50 via-white to-blue-50/30 hover:border-blue-400 hover:bg-gradient-to-br hover:from-blue-50/50 hover:to-indigo-50/50 hover:shadow-lg hover:scale-[1.01]'
    }`}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
  >
    <div className="relative">
      <div className="p-4 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-2xl w-fit mx-auto mb-6 shadow-sm">
        <Upload className="w-8 h-8 text-blue-600" />
      </div>
      <h3 className="text-xl font-bold text-gray-900 mb-3">
        Upload Bank Statements
      </h3>
      <p className="text-sm text-gray-600 mb-8 max-w-md mx-auto leading-relaxed">
        Drag & drop PDF files here or click to browse.
      </p>
      <label className={`cursor-pointer inline-flex items-center gap-3 px-8 py-4 rounded-2xl font-bold focus:outline-none focus:ring-4 focus:ring-blue-500/40 transition-all duration-200 shadow-lg ${batchProcessing ? 'pointer-events-none opacity-60 bg-gray-400 text-white' : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 hover:shadow-xl hover:scale-105'}`}>
        <Upload className="w-5 h-5" />
        Choose Files
        <input
          type="file"
          className="sr-only"
          accept=".pdf"
          multiple
          onChange={(e) => !batchProcessing && onChooseFiles(e.target.files)}
        />
      </label>
      <p className="text-xs text-gray-500 mt-4 font-medium">PDF files only, max 10MB each</p>
    </div>
  </div>
);

// Document Details Controls (Category filter + search)
export type DocumentDetailsControlsProps = {
  categoryDropdownOpen: boolean;
  onToggleDropdown: () => void;
  selectedCategories: Set<string>;
  allCategories: string[];
  mainCategorySummaries: Record<string, { subWithData?: string[] }>;
  onClearAll: () => void;
  onSelectAll: () => void;
  onToggleCategory: (category: string, checked: boolean) => void;
  categorySearch: string;
  onCategorySearchChange: (v: string) => void;
  onCategorySearchEnter: () => void;
};
export const DocumentDetailsControls: React.FC<DocumentDetailsControlsProps> = ({
  categoryDropdownOpen,
  onToggleDropdown,
  selectedCategories,
  allCategories,
  mainCategorySummaries,
  onClearAll,
  onSelectAll,
  onToggleCategory,
  categorySearch,
  onCategorySearchChange,
  onCategorySearchEnter,
}) => (
  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
    <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <label className="text-sm font-semibold text-slate-700 min-w-fit">Filter by Category:</label>
          <div className="relative category-dropdown">
            <button
              type="button"
              onClick={onToggleDropdown}
              className="text-sm border border-slate-300 rounded-lg px-4 py-2.5 bg-white hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 min-w-[200px] flex items-center justify-between"
            >
              <span>
                {selectedCategories.size === 0 
                  ? 'All Categories' 
                  : selectedCategories.size === 1 
                  ? Array.from(selectedCategories)[0]
                  : `${selectedCategories.size} selected`
                }
              </span>
              <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {categoryDropdownOpen && (
              <div className="absolute z-10 mt-1 w-[360px] min-w-[320px] max-w-[420px] bg-white border border-slate-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                <div className="p-2">
                  <button
                    type="button"
                    onClick={onClearAll}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 rounded font-semibold text-slate-700"
                  >
                    Clear All
                  </button>
                  <button
                    type="button"
                    onClick={onSelectAll}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 rounded font-semibold text-slate-700"
                  >
                    Select All
                  </button>
                  <hr className="my-2" />
                  {allCategories.map((category) => {
                    const info = mainCategorySummaries[category];
                    const names = (info?.subWithData || []);
                    const count = names.length;
                    const preview = names.slice(0, 3).join(', ');
                    return (
                      <label key={category} className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-slate-100 rounded cursor-pointer w-full">
                        <input
                          type="checkbox"
                          checked={selectedCategories.has(category)}
                          onChange={(e) => onToggleCategory(category, e.target.checked)}
                          className="mr-3 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-slate-700 font-medium flex-1 truncate">{category}</span>
                        <div className="ml-2 flex items-center gap-2 whitespace-nowrap">
                          <span className="px-2 py-0.5 text-[10px] rounded-full bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">
                            {count} with data
                          </span>
                          {count > 0 && (
                            <span className="text-[10px] text-slate-500 truncate max-w-[220px]" title={names.join(', ')}>
                              {preview}{count > 3 ? `, +${count - 3} more` : ''}
                            </span>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-sm font-semibold text-slate-700 min-w-fit">Search Transactions:</label>
        <input
          type="text"
          value={categorySearch}
          onChange={(e) => onCategorySearchChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onCategorySearchEnter(); }}
          placeholder="Search by date, description, or amount..."
          className="w-full lg:w-80 text-sm border border-slate-300 rounded-lg px-4 py-2.5 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
        />
      </div>
    </div>
  </div>
);

// Transaction Summary Section (computes and renders breakdown)
type TxRow = { date?: string; description?: string; amount: number };

// Small popup modal for subcategory transaction details
const SubcategoryModal: React.FC<{
  open: boolean;
  title: string;
  amount: number;
  rows: TxRow[];
  onClose: () => void;
  selected: Set<number>;
  onToggleIndex: (i: number) => void;
  onToggleAll: () => void;
  selectedTotal: number;
}> = ({ open, title, rows, onClose, selected, onToggleIndex, onToggleAll, selectedTotal }) => {
  if (!open) return null;
  const allSelected = selected.size === rows.length && rows.length > 0;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-3xl shadow-2xl border border-slate-200/50 w-full max-w-2xl overflow-hidden animate-in fade-in-0 zoom-in-95 duration-200">
        {/* Enhanced Header */}
        <div className="px-8 py-6 bg-gradient-to-r from-slate-50 via-white to-blue-50/30 border-b border-slate-200/60">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Transaction Category</div>
                <div className="text-xl font-bold text-slate-900 leading-tight">{title}</div>
                <div className="text-sm text-slate-600 mt-1">{rows.length} transaction{rows.length !== 1 ? 's' : ''}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Selected Total</div>
              <div className="text-2xl font-black text-emerald-600 font-mono">{fmtCurrency2(selectedTotal)}</div>
              {/* Close handled by backdrop or Done button below */}
            </div>
          </div>
        </div>
        
        {/* Enhanced Controls */}
        <div className="px-8 py-4 bg-slate-50/50 border-b border-slate-200/60 flex items-center justify-between">
          <label className="inline-flex items-center gap-3 text-sm font-semibold text-slate-700 cursor-pointer hover:text-slate-900 transition-colors">
            <input 
              type="checkbox" 
              checked={allSelected} 
              onChange={onToggleAll} 
              className="w-5 h-5 rounded-lg border-2 border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all duration-200" 
            />
            <span>Select all transactions</span>
          </label>
          <div className="flex items-center gap-4">
            <div className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{selected.size}</span> of <span className="font-semibold text-slate-900">{rows.length}</span> selected
            </div>
          </div>
        </div>
        
        {/* Enhanced Transaction List */}
        <div className="max-h-[65vh] overflow-y-auto">
          {rows.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="text-slate-500 font-medium">No transactions found</div>
            </div>
          ) : rows.map((r, idx) => (
            <button 
              key={`modal-row-${idx}`} 
              type="button" 
              onClick={() => onToggleIndex(idx)} 
              className={`w-full text-left px-8 py-4 flex items-center justify-between transition-all duration-200 border-l-4 ${
                selected.has(idx) 
                  ? 'bg-blue-50/50 hover:bg-blue-100/50 border-l-blue-500 shadow-sm' 
                  : 'bg-white hover:bg-slate-50 border-l-transparent'
              } ${idx % 2 === 0 ? 'bg-opacity-50' : ''}`}
            >
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <input
                  type="checkbox"
                  checked={selected.has(idx)}
                  onChange={() => onToggleIndex(idx)}
                  className="w-5 h-5 rounded-lg border-2 border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all duration-200"
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div className="flex-shrink-0">
                    <div className="w-2 h-8 bg-gradient-to-b from-blue-400 to-indigo-500 rounded-full shadow-sm" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <div className="text-sm font-bold text-slate-900 whitespace-nowrap">
                        {formatDateHuman(r.date)}
                      </div>
                      <div className="w-1 h-1 bg-slate-300 rounded-full flex-shrink-0" />
                      <div className="text-xs text-slate-500 font-medium uppercase tracking-wide">
                        Transaction
                      </div>
                    </div>
                    <div className="text-sm text-slate-700 leading-relaxed truncate pr-4" title={r.description}>
                      {r.description || 'No description available'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex-shrink-0 text-right ml-4">
                <div className="text-lg font-black text-slate-900 font-mono">
                  {fmtCurrency2(r.amount)}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {selected.has(idx) ? 'Included' : 'Excluded'}
                </div>
              </div>
            </button>
          ))}
        </div>
        
        {/* Footer: only Done button (totals shown in header) */}
        <div className="px-8 py-6 bg-gradient-to-r from-slate-50 via-white to-blue-50/30 border-t border-slate-200/60">
          <div className="flex items-center justify-end">
            <button 
              type="button" 
              onClick={onClose} 
              className="px-6 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-lg hover:shadow-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const TransactionSummarySection: React.FC<{
  documentDetails: any;
  monthlyData: Record<string, any>;
  onSave?: (payload: {
    documentDetails: any;
    selectedMap: Record<string, number[]>; // indices per subcategory key
    selectedTotalFromCategories: number;
    effectiveMainTotals: Record<string, number>;
    difference: number;
  }) => void;
}> = ({ documentDetails, monthlyData, onSave }) => {
  const [modal, setModal] = React.useState<null | { key: string; title: string; amount: number; rows: TxRow[] }>(null);
  // Persist selection per subcategory key: `${mainName}::${subName}`
  const [selectedMap, setSelectedMap] = React.useState<Record<string, Set<number>>>({});
  // Optimistic override for saved Net Difference so UI updates instantly after Save
  const [savedOverride, setSavedOverride] = React.useState<number | null>(null);

  let totalFromCategories = 0;
  const subTotals: Record<string, number> = {};
  const mainTotals: Record<string, number> = {};
  const mainToSubs: Record<string, Array<{ name: string; amount: number }>> = {};
  const subToRows: Record<string, Array<TxRow>> = {};

  try {
    Object.entries(monthlyData).forEach(([mainName, categories]) => {
      if (Array.isArray(categories)) {
        if (!subTotals[mainName]) subTotals[mainName] = 0;
        if (!mainTotals[mainName]) mainTotals[mainName] = 0;
        if (!mainToSubs[mainName]) mainToSubs[mainName] = [];
        let subSum = 0;
        categories.forEach((transaction: any) => {
          const dateRaw = transaction?.date || transaction?.Date || transaction?.transaction_date || transaction?.posted_at || '';
          const description = transaction?.description || transaction?.Description || transaction?.memo || transaction?.details || '';
          // Robust amount parsing (supports many keys and regex fallback from description)
          const tryFields = [
            transaction?.amount,
            transaction?.Amount,
            transaction?.value,
            transaction?.amt,
            transaction?.debit_amount,
            transaction?.debitAmount,
            transaction?.daily_amount,
            (transaction && (transaction['Daily Amount'] || transaction['daily Amount'])),
            transaction?.original_amount,
            transaction?.OriginalAmount,
          ];
          let amount = 0;
          for (const v of tryFields) {
            const n = parseFloat(String(v ?? '').toString().replace(/[^0-9.-]/g, ''));
            if (Number.isFinite(n) && n !== 0) { amount = n; break; }
          }
          if (!Number.isFinite(amount) || amount === 0) {
            // Fallback: extract last currency-like number from description
            const m = String(description || '').match(/-?\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2})?)/g);
            if (m && m.length) {
              const last = m[m.length - 1];
              const n = parseFloat(last.replace(/[^0-9.-]/g, ''));
              if (Number.isFinite(n)) amount = n;
            }
          }
          // Final guard
          if (!Number.isFinite(amount)) amount = 0;
          subTotals[mainName] += amount;
          subSum += amount;
          if (!isBusinessNameAndOwner(mainName) && !isFunderList(mainName)) totalFromCategories += amount;
          const key = `${mainName}::${mainName}`;
          if (!subToRows[key]) subToRows[key] = [];
          subToRows[key].push({ date: String(dateRaw || ''), description: String(description || ''), amount });
        });
        mainTotals[mainName] += (isBusinessNameAndOwner(mainName) || isFunderList(mainName)) ? 0 : subSum;
        mainToSubs[mainName].push({ name: mainName, amount: subSum });
      } else if (categories && typeof categories === 'object') {
        let mainSum = 0;
        if (!mainToSubs[mainName]) mainToSubs[mainName] = [];
        Object.entries(categories as Record<string, any>).forEach(([subName, transactions]) => {
          if (!subTotals[subName]) subTotals[subName] = 0;

          const normalizeTransactions = (tx: any): any[] => {
            if (!tx) return [];
            if (Array.isArray(tx)) return tx.flat().filter(Boolean);
            if (typeof tx === 'object') {
              const vals = Object.values(tx);
              const merged = vals.reduce<any[]>((acc, v) => {
                if (Array.isArray(v)) acc.push(...v);
                else if (v && typeof v === 'object') {
                  const maybe = (v as any).transactions;
                  if (Array.isArray(maybe)) acc.push(...maybe);
                }
                return acc;
              }, []);
              return merged.filter(Boolean);
            }
            return [];
          };

          const rows = normalizeTransactions(transactions);
          let subSum = 0;
          rows.forEach((transaction: any) => {
            const dateRaw = transaction?.date || transaction?.Date || transaction?.transaction_date || transaction?.posted_at || '';
            const description = transaction?.description || transaction?.Description || transaction?.memo || transaction?.details || '';
            // Robust amount parsing (supports many keys and regex fallback from description)
            const tryFields = [
              transaction?.amount,
              transaction?.Amount,
              transaction?.value,
              transaction?.amt,
              transaction?.debit_amount,
              transaction?.debitAmount,
              transaction?.daily_amount,
              (transaction && (transaction['Daily Amount'] || transaction['daily Amount'])),
              transaction?.original_amount,
              transaction?.OriginalAmount,
            ];
            let amount = 0;
            for (const v of tryFields) {
              const n = parseFloat(String(v ?? '').toString().replace(/[^0-9.-]/g, ''));
              if (Number.isFinite(n) && n !== 0) { amount = n; break; }
            }
            if (!Number.isFinite(amount) || amount === 0) {
              const m = String(description || '').match(/-?\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2})?)/g);
              if (m && m.length) {
                const last = m[m.length - 1];
                const n = parseFloat(last.replace(/[^0-9.-]/g, ''));
                if (Number.isFinite(n)) amount = n;
              }
            }
            // Final guard
            if (!Number.isFinite(amount)) amount = 0;
            subTotals[subName] += amount;
            subSum += amount;
            if (!isBusinessNameAndOwner(subName) && !isFunderList(subName)) totalFromCategories += amount;
            const key = `${mainName}::${subName}`;
            if (!subToRows[key]) subToRows[key] = [];
            subToRows[key].push({ date: String(dateRaw || ''), description: String(description || ''), amount });
          });
          mainSum += (isBusinessNameAndOwner(subName) || isFunderList(subName)) ? 0 : subSum;
          mainToSubs[mainName].push({ name: subName, amount: subSum });
        });
        if (!mainTotals[mainName]) mainTotals[mainName] = 0;
        mainTotals[mainName] += mainSum;
      }
    });
  } catch (error) {
    console.error('Error calculating category totals:', error);
  }

  const totalDeposits = parseFloat(String(documentDetails?.total_deposits).replace(/[^0-9.-]/g, '')) || 0;
  // Compute effective totals based on current selections (default = all selected)
  const effectiveMainTotals: Record<string, number> = {};
  let selectedTotalFromCategories = 0;
  Object.entries(mainToSubs).forEach(([mainName, subs]) => {
    let mainSum = 0;
    subs.forEach((s) => {
      const key = `${mainName}::${s.name}`;
      const rows = subToRows[key] || [];
      // If we have a selection set for this sub, use that; else default to full rows (equivalent to s.amount)
      const sel = selectedMap[key];
      let subEffective = 0;
      if (sel) {
        rows.forEach((r, idx) => { if (sel.has(idx)) subEffective += (r.amount || 0); });
      } else {
        subEffective = s.amount || rows.reduce((sum, r) => sum + (r.amount || 0), 0);
      }
      if (!isBusinessNameAndOwner(s.name)) mainSum += subEffective;
    });
    effectiveMainTotals[mainName] = mainSum;
    selectedTotalFromCategories += mainSum;
  });
  const difference = totalDeposits - selectedTotalFromCategories;

  // Prefer saved monthly_revenue from DB if present (from application_documents.monthly_revenue),
  // fallback to computed difference. Accept numbers or numeric-like strings.
  const savedMonthlyRevenueRaw = (documentDetails && (documentDetails.monthly_revenue ??
    (documentDetails.extracted_json && (documentDetails.extracted_json.monthly_revenue ??
      (documentDetails.mca_summary && documentDetails.mca_summary.monthly_revenue))))) as any;
  const savedMonthlyRevenue = parseAmount(savedMonthlyRevenueRaw);
  const displayedDifference = (savedOverride !== null && Number.isFinite(savedOverride))
    ? savedOverride
    : (Number.isFinite(savedMonthlyRevenue) && savedMonthlyRevenue !== 0
      ? savedMonthlyRevenue
      : difference);

  // When the prop monthly_revenue arrives from DB, clear the optimistic override
  React.useEffect(() => {
    const n = parseAmount(documentDetails?.monthly_revenue);
    if (savedOverride !== null && Number.isFinite(n) && n !== 0) {
      setSavedOverride(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentDetails?.monthly_revenue]);

  return (
    <div className="space-y-4 mb-6">
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-xl shadow-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-slate-300 text-sm font-medium uppercase tracking-wider">Month</div>
            <div className="text-xl font-bold text-white">{String(documentDetails?.month || (documentDetails?.statement_date || '').slice(0,7) || '—')}</div>
          </div>
          <div className="text-right">
            <div className="text-slate-300 text-sm font-medium uppercase tracking-wider">Total Deposits</div>
            <div className="text-3xl font-black text-white">
              ${totalDeposits.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-8">
        <div className="text-center mb-6">
          <h3 className="text-2xl font-bold text-slate-900 mb-2">Transaction Summary</h3>
          <div className="w-16 h-1 bg-gradient-to-r from-blue-500 to-indigo-500 mx-auto rounded-full"></div>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-200 rounded-xl p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-emerald-700 text-sm font-semibold">Total Deposits</div>
                    <div className="text-2xl font-bold text-emerald-900">
                      ${totalDeposits.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-blue-700 text-sm font-semibold">Total from Categories</div>
                    <div className="text-2xl font-bold text-blue-900">
                      ${selectedTotalFromCategories.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {Object.keys(mainToSubs).length > 0 && (
            <div className="bg-gradient-to-br from-white via-slate-50/30 to-blue-50/20 rounded-2xl border border-slate-200/60 overflow-hidden">
              {/* Enhanced Header */}
              <div className="px-8 py-6 bg-gradient-to-r from-slate-800 via-slate-700 to-blue-900 border-b border-slate-600/20">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-2xl flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-white leading-tight">Categories Included in Calculation</h4>
                    <p className="text-slate-300 text-sm mt-1">Click subcategory chips to view and select transactions</p>
                  </div>
                </div>
              </div>
              
              {/* Enhanced Category Cards (no internal scroll) */}
              <div className="p-8 space-y-6">
                {Object.entries(mainTotals)
                  .filter(([, amt]) => amt > 0)
                  .sort(([, a], [, b]) => b - a)
                  .map(([mainName, mainAmt]) => {
                    // Compute subcategory counts and how many are currently included (based on selection)
                    const subs = mainToSubs[mainName] || [];
                    const totalSubs = subs.length;
                    let includedSubs = 0;
                    subs.forEach((s) => {
                      const key = `${mainName}::${s.name}`;
                      const rows = subToRows[key] || [];
                      const sel = selectedMap[key];
                      let subEffective = 0;
                      if (sel) {
                        rows.forEach((r, idx) => { if (sel.has(idx)) subEffective += (r.amount || 0); });
                      } else {
                        subEffective = s.amount || rows.reduce((sum, r) => sum + (r.amount || 0), 0);
                      }
                      if (subEffective > 0) includedSubs += 1;
                    });
                    return (
                    <div key={mainName} className="group bg-white rounded-2xl p-6 border border-slate-200/60 transition-all duration-300 hover:scale-[1.02] hover:border-blue-300/50">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          {/* Category Header */}
                          <div className="flex items-center gap-3 mb-4">
                            <div className="w-3 h-8 bg-gradient-to-b from-blue-500 to-indigo-600 rounded-full" />
                            <div>
                              <div className="text-lg font-bold text-slate-900 leading-tight">{mainName}</div>
                              <div className="mt-1 flex items-center gap-2">
                                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                  {totalSubs} subcategories
                                </span>
                                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  {includedSubs} included
                                </span>
                              </div>
                            </div>
                          </div>
                          
                          {/* Subcategory Chips */}
                          <div className="flex flex-wrap gap-2">
                            {mainToSubs[mainName]
                              .filter(s => s.amount > 0)
                              .sort((a,b)=> b.amount - a.amount)
                              .slice(0, 6)
                              .map(s => {
                                const key = `${mainName}::${s.name}`;
                                // Compute effective sub total based on selection
                                const rows = subToRows[key] || [];
                                const sel = selectedMap[key];
                                let effectiveSub = 0;
                                if (sel) {
                                  rows.forEach((r, idx) => { if (sel.has(idx)) effectiveSub += (r.amount || 0); });
                                } else {
                                  effectiveSub = s.amount || rows.reduce((sum, r) => sum + (r.amount || 0), 0);
                                }
                                const totalRows = rows.length;
                                const selectedCount = sel ? sel.size : totalRows;
                                return (
                                  <div key={`${mainName}-${s.name}`} className="flex flex-col items-start">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const rowsSorted = (subToRows[key] || []).slice().sort((a,b) => String(a.date||'').localeCompare(String(b.date||'')));
                                        setModal({ key, title: s.name, amount: s.amount, rows: rowsSorted });
                                      }}
                                      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all duration-200 hover:scale-105 ${isBusinessNameAndOwner(s.name) ? 'bg-gradient-to-r from-amber-50 to-orange-50 text-amber-800 border-amber-300 hover:from-amber-100 hover:to-orange-100 hover:border-amber-400' : 'bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-800 border-blue-300 hover:from-blue-100 hover:to-indigo-100 hover:border-blue-400'}`}
                                      title={`View transactions for ${s.name}`}
                                    >
                                      <span className="font-semibold truncate max-w-[180px]">{s.name}</span>
                                      <div className="w-px h-4 bg-current opacity-30" />
                                      <span className="font-black font-mono text-sm">{fmtCurrency2(effectiveSub)}</span>
                                    </button>
                                    <span className="mt-1 text-[11px] text-slate-500 font-medium">
                                      {selectedCount} of {totalRows} Selected transactions
                                    </span>
                                  </div>
                                );
                              })}
                            {mainToSubs[mainName].filter(s=>s.amount>0).length > 6 && (
                              <div className="inline-flex items-center px-3 py-2 rounded-xl bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-600">
                                +{mainToSubs[mainName].filter(s=>s.amount>0).length - 6} more
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* Enhanced Total Display */}
                        <div className="text-right flex-shrink-0">
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Main Total</div>
                          <div className="text-2xl font-black text-slate-900 font-mono leading-tight">
                            {fmtCurrency2(effectiveMainTotals[mainName] ?? mainAmt)}
                          </div>
                          <div className="text-xs text-slate-500 mt-1 font-medium">
                            {((effectiveMainTotals[mainName] ?? mainAmt) / selectedTotalFromCategories * 100).toFixed(1)}% of total
                          </div>
                        </div>
                      </div>
                    </div>
                    );
                  })}
              </div>
            </div>
          )}

          <div className={`rounded-xl border-2 p-6 ${
            displayedDifference >= 0 
              ? 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-200' 
              : 'bg-gradient-to-br from-red-50 to-rose-50 border-red-200'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  displayedDifference >= 0 ? 'bg-green-500' : 'bg-red-500'
                }`}>
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={
                      displayedDifference >= 0 
                        ? "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                        : "M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"
                    } />
                  </svg>
                </div>
                <div>
                  <div className={`text-sm font-semibold ${displayedDifference >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    Net Difference
                  </div>
                  <div className={`text-3xl font-black ${displayedDifference >= 0 ? 'text-green-900' : 'text-red-900'}`}>
                    {displayedDifference >= 0 ? '+' : ''}${Math.abs(displayedDifference).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
              <div className={`${displayedDifference >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                <div className="text-sm font-medium">
                  {displayedDifference >= 0 ? 'Surplus' : 'Deficit'}
                </div>
                <div className="text-xs opacity-75">
                  {totalDeposits ? ((Math.abs(displayedDifference) / totalDeposits) * 100).toFixed(1) : '0.0'}% of total
                </div>
              </div>
            </div>
          </div>

          {/* Save Button below Net Difference */}
          <div className="flex items-center justify-end mt-2">
            <button
              type="button"
              onClick={() => {
                if (!onSave) return;
                const compactSelected: Record<string, number[]> = {};
                Object.entries(selectedMap).forEach(([k, set]) => {
                  compactSelected[k] = Array.from(set.values()).sort((a,b)=>a-b);
                });
                // Optimistically update the displayed Net Difference to the value being saved
                setSavedOverride(difference);
                onSave({
                  documentDetails,
                  selectedMap: compactSelected,
                  selectedTotalFromCategories,
                  effectiveMainTotals,
                  difference,
                });
              }}
              className="px-5 py-2 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              Save Selection
            </button>
          </div>
        </div>
      </div>
      {modal && (() => {
        const key = modal.key;
        const rows = modal.rows;
        const sel = selectedMap[key] ?? new Set(rows.map((_, i) => i));
        const selectedTotal = rows.reduce((sum, r, i) => sum + (sel.has(i) ? (r.amount || 0) : 0), 0);
        const onToggleIndex = (i: number) => {
          setSelectedMap(prev => {
            const next = { ...prev } as Record<string, Set<number>>;
            const cur = new Set(next[key] ?? [] as any);
            if (cur.has(i)) cur.delete(i); else cur.add(i);
            next[key] = cur;
            return next;
          });
        };
        const onToggleAll = () => {
          setSelectedMap(prev => {
            const next = { ...prev } as Record<string, Set<number>>;
            const all = new Set(rows.map((_, i) => i));
            const cur = next[key];
            if (cur && cur.size === rows.length) {
              next[key] = new Set();
            } else {
              next[key] = all;
            }
            return next;
          });
        };
        return (
          <SubcategoryModal
            open={Boolean(modal)}
            title={modal.title}
            amount={modal.amount}
            rows={rows}
            onClose={() => setModal(null)}
            selected={sel}
            onToggleIndex={onToggleIndex}
            onToggleAll={onToggleAll}
            selectedTotal={selectedTotal}
          />
        );
      })()}
    </div>
  );
};

// Files Bucket List
export type FilesBucketListProps = {
  files: File[];
  bucketSubmitting: boolean;
  batchProcessing: boolean;
  onSubmitAll: () => void;
  onRemoveAt: (index: number) => void;
};
export const FilesBucketList: React.FC<FilesBucketListProps> = ({ files, bucketSubmitting, batchProcessing, onSubmitAll, onRemoveAt }) => (
  files.length > 0 ? (
    <div className="mt-6 bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden">
      <div className="px-6 py-4 bg-gradient-to-r from-slate-50 to-blue-50/30 border-b border-slate-200 flex items-center justify-between">
        <div className="text-slate-800 font-bold">Files Staged ({files.length})</div>
        <button
          type="button"
          onClick={onSubmitAll}
          disabled={bucketSubmitting || batchProcessing}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-white ${(bucketSubmitting || batchProcessing) ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'} transition-colors`}
        >
          {(bucketSubmitting || batchProcessing) ? 'Submitting…' : 'Submit All'}
        </button>
      </div>
      <div className="divide-y divide-slate-100">
        {files.map((f, idx) => (
          <div key={`${f.name}-${idx}`} className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                <FileText className="w-5 h-5 text-slate-600" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate" title={f.name}>{f.name}</div>
                <div className="text-xs text-slate-600">{(f.size/1024/1024).toFixed(1)} MB • {f.type || 'application/pdf'}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onRemoveAt(idx)}
              className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              title="Remove"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  ) : null
);

// Legal & Compliance Section
export type LegalComplianceSectionProps = {
  hasBankruptcies: boolean;
  hasOpenJudgments: boolean;
  onToggleBankruptcies: (checked: boolean) => void;
  onToggleOpenJudgments: (checked: boolean) => void;
};
export const LegalComplianceSection: React.FC<LegalComplianceSectionProps> = ({ hasBankruptcies, hasOpenJudgments, onToggleBankruptcies, onToggleOpenJudgments }) => (
  <div className="mb-8">
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 bg-gradient-to-br from-amber-100 to-orange-100 rounded-xl shadow-sm border border-amber-200">
          <Building2 className="w-5 h-5 text-amber-700" />
        </div>
        <h3 className="text-xl font-bold text-gray-900">Legal & Compliance</h3>
      </div>
      <p className="text-sm text-gray-600 ml-12">Legal status and financial history</p>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <div className="group">
        <label className="flex items-start gap-4 p-5 rounded-2xl border-2 border-gray-200 bg-white hover:border-gray-300 hover:shadow-md transition-all duration-200 cursor-pointer">
          <div className="flex items-center justify-center w-6 h-6 mt-0.5">
            <input
              type="checkbox"
              checked={Boolean(hasBankruptcies)}
              onChange={(e) => onToggleBankruptcies(e.target.checked)}
              className="w-5 h-5 rounded-lg border-2 border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-colors duration-200"
            />
          </div>
          <div className="flex-1">
            <span className="text-base font-semibold text-gray-900 block mb-1">Has Bankruptcies</span>
            <span className="text-sm text-gray-600">Any bankruptcy filings in business history</span>
          </div>
        </label>
      </div>
      <div className="group">
        <label className="flex items-start gap-4 p-5 rounded-2xl border-2 border-gray-200 bg-white hover:border-gray-300 hover:shadow-md transition-all duration-200 cursor-pointer">
          <div className="flex items-center justify-center w-6 h-6 mt-0.5">
            <input
              type="checkbox"
              checked={Boolean(hasOpenJudgments)}
              onChange={(e) => onToggleOpenJudgments(e.target.checked)}
              className="w-5 h-5 rounded-lg border-2 border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-colors duration-200"
            />
          </div>
          <div className="flex-1">
            <span className="text-base font-semibold text-gray-900 block mb-1">Has Open Judgments</span>
            <span className="text-sm text-gray-600">Any outstanding legal judgments</span>
          </div>
        </label>
      </div>
    </div>
  </div>
);

export default {};

// Analysis Summary Section (presentational)
export const AnalysisSummarySection: React.FC<{ row: any }> = ({ row: _row }) => {
  // UI request: remove Metric/Value table (Monthly Revenue, Avg Daily Balance, Ending Balance, Net Deposit Count, Negative Days)
  // Keep component exported but render nothing to preserve layout and callers.
  return null;
};

// Funding Details Section (presentational)
export const FundingDetailsSection: React.FC<{ row: any }> = ({ row }) => (
  (row?.funder || row?.amount || row?.debit_frequency || row?.notes) ? (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-1 h-6 bg-gradient-to-b from-emerald-500 to-teal-500 rounded-full"></div>
        <h6 className="text-lg font-bold text-slate-800">Funding Details</h6>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
          <div className="p-6 border-b md:border-b-0 md:border-r border-slate-200">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Funder</label>
                <p className="text-lg font-bold text-slate-900 mt-1">{row?.funder || 'Not Specified'}</p>
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Funding Amount</label>
                <p className="text-xl font-bold text-emerald-600 mt-1 font-mono">{row?.amount ? fmtCurrency(row.amount) : 'Not Specified'}</p>
              </div>
            </div>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Debit Frequency</label>
                <p className="text-lg font-bold text-slate-900 mt-1">{row?.debit_frequency || 'Not Specified'}</p>
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Notes</label>
                <p className="text-slate-700 mt-1 leading-relaxed">{row?.notes || 'No additional notes'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null
);
