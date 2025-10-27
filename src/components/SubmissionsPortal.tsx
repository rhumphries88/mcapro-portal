import React, { useEffect, useState, type ComponentProps } from 'react';
import { CheckCircle } from 'lucide-react';
import ApplicationForm from './ApplicationForm';
import BankStatement from './BankStatement';
import LenderMatches from './LenderMatches';
import SubmissionRecap from './SubmissionRecap';
import SubmissionIntermediate from './SubmissionIntermediate';
import AdditionalDocuments from './AdditionalDocuments';
import { extractLenderMatches, type CleanedMatch } from '../lib/parseLenderMatches';
import { createApplication, updateApplication, getApplicationById, getApplicationDocuments, type Application as DBApplication } from '../lib/supabase';
import { useAuth } from '../App';

// Type aliases used across this file
type ReviewInitialType = ComponentProps<typeof ApplicationForm>['reviewInitial'];
type BankApplicationType = ComponentProps<typeof BankStatement>['application'];

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

// Map prefill (from ApplicationForm.onReadyForForm) to our AppData so step 1 can be marked complete
const appDataFromPrefill = (prefill: NonNullable<ReviewInitialType>): AppData => {
  return {
    id: prefill.id ?? '',
    businessName: prefill.businessName ?? '',
    monthlyRevenue: prefill.financialInfo?.averageMonthlyRevenue ?? 0,
    timeInBusiness: prefill.businessInfo?.yearsInBusiness ?? 0,
    creditScore: prefill.creditScore ?? 0,
    industry: prefill.industry ?? '',
    requestedAmount: prefill.requestedAmount ?? 0,
    status: 'draft',
    // top-level duplicates for LenderMatches
    ownerName: prefill.contactInfo?.ownerName ?? '',
    email: prefill.contactInfo?.email ?? '',
    phone: prefill.contactInfo?.phone ?? '',
    address: prefill.contactInfo?.address ?? '',
    ein: prefill.businessInfo?.ein ?? '',
    businessType: prefill.businessInfo?.businessType ?? '',
    yearsInBusiness: prefill.businessInfo?.yearsInBusiness ?? 0,
    numberOfEmployees: prefill.businessInfo?.numberOfEmployees ?? 0,
    annualRevenue: prefill.financialInfo?.annualRevenue ?? 0,
    monthlyDeposits: prefill.financialInfo?.averageMonthlyDeposits ?? 0,
    existingDebt: prefill.financialInfo?.existingDebt ?? 0,
    documents: prefill.documents ?? [],
    // nested mirrors
    contactInfo: {
      ownerName: prefill.contactInfo?.ownerName ?? '',
      email: prefill.contactInfo?.email ?? '',
      phone: prefill.contactInfo?.phone ?? '',
      address: prefill.contactInfo?.address ?? '',
    },
    businessInfo: {
      ein: prefill.businessInfo?.ein ?? '',
      businessType: prefill.businessInfo?.businessType ?? '',
      yearsInBusiness: prefill.businessInfo?.yearsInBusiness ?? 0,
      numberOfEmployees: prefill.businessInfo?.numberOfEmployees ?? 0,
    },
    financialInfo: {
      annualRevenue: prefill.financialInfo?.annualRevenue ?? 0,
      averageMonthlyRevenue: prefill.financialInfo?.averageMonthlyRevenue ?? 0,
      averageMonthlyDeposits: prefill.financialInfo?.averageMonthlyDeposits ?? 0,
      existingDebt: prefill.financialInfo?.existingDebt ?? 0,
    },
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
    dateOfBirth?: string;
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

type SubmissionsPortalProps = {
  initialStep?: 'application' | 'bank' | 'intermediate' | 'additional-documents' | 'matches' | 'recap';
  initialApplicationId?: string;
  lockedLenderIds?: string[];
  onBackToDeals?: () => void;
};

const SubmissionsPortal: React.FC<SubmissionsPortalProps> = ({ initialStep, initialApplicationId, lockedLenderIds = [], onBackToDeals }) => {
  const { user } = useAuth(); // Get the current logged-in user
  const [currentStep, setCurrentStep] = useState<'application' | 'bank' | 'intermediate' | 'additional-documents' | 'matches' | 'recap'>('application');
  const [prevStep, setPrevStep] = useState<'application' | 'bank' | 'intermediate' | 'additional-documents' | 'matches' | 'recap' | null>(null);
  const [application, setApplication] = useState<AppData | null>(null);
  const [bankPrefill, setBankPrefill] = useState<ReviewInitialType>(null);
  const [editPrefill, setEditPrefill] = useState<ReviewInitialType>(null);
  const [selectedLenders, setSelectedLenders] = useState<string[]>([]);
  const [intermediateLoading, setIntermediateLoading] = useState(false);
  const [intermediatePrefill, setIntermediatePrefill] = useState<Record<string, string | boolean> | null>(null);
  const [cleanedMatches, setCleanedMatches] = useState<CleanedMatch[] | null>(null);

  // If requested, preload an application by ID and open Matches directly
  useEffect(() => {
    (async () => {
      if (initialStep === 'matches' && initialApplicationId) {
        try {
          const db = await getApplicationById(initialApplicationId);
          if (db) {
            // Pull supporting documents: prefer applications.documents, otherwise fallback to application_documents rows
            let docNames: string[] = Array.isArray(db.documents) ? (db.documents as unknown as string[]) : [];
            if (!docNames || docNames.length === 0) {
              try {
                const docRows = await getApplicationDocuments(initialApplicationId);
                docNames = (docRows || []).map(r => r.file_name).filter(Boolean) as string[];
              } catch (e) {
                console.warn('Failed to load application_documents for edit prefill:', e);
                docNames = [];
              }
            }
            const mapped: AppData = {
              id: db.id,
              businessName: db.business_name,
              monthlyRevenue: db.monthly_revenue,
              timeInBusiness: db.years_in_business,
              creditScore: db.credit_score,
              industry: db.industry,
              requestedAmount: db.requested_amount,
              status: (db.status as AppData['status']),
              ownerName: db.owner_name,
              email: db.email,
              phone: db.phone,
              address: db.address,
              ein: db.ein,
              businessType: db.business_type,
              yearsInBusiness: db.years_in_business,
              numberOfEmployees: db.number_of_employees,
              annualRevenue: db.annual_revenue,
              monthlyDeposits: db.monthly_deposits,
              existingDebt: db.existing_debt,
              documents: db.documents ?? [],
              contactInfo: {
                ownerName: db.owner_name,
                email: db.email,
                phone: db.phone,
                address: db.address,
              },
              businessInfo: {
                ein: db.ein,
                businessType: db.business_type,
                yearsInBusiness: db.years_in_business,
                numberOfEmployees: db.number_of_employees,
              },
              financialInfo: {
                annualRevenue: db.annual_revenue,
                averageMonthlyRevenue: db.monthly_revenue,
                averageMonthlyDeposits: db.monthly_deposits,
                existingDebt: db.existing_debt,
              },
            };
            setApplication(mapped);
            setCurrentStep('matches');
          }
        } catch (e) {
          console.warn('Failed to preload application for matches:', e);
        }
      }
    })();
  }, [initialStep, initialApplicationId]);

  // If requested, preload an application by ID and open Application Form directly with fields prefilled
  useEffect(() => {
    (async () => {
      if (initialStep === 'application' && initialApplicationId) {
        try {
          const db = await getApplicationById(initialApplicationId);
          if (db) {
            // Collect document names from applications.documents or fallback to application_documents
            let docNames: string[] = Array.isArray(db.documents) ? (db.documents as unknown as string[]) : [];
            if (!docNames || docNames.length === 0) {
              try {
                const docRows = await getApplicationDocuments(initialApplicationId);
                docNames = (docRows || []).map(r => r.file_name).filter(Boolean) as string[];
              } catch (e) {
                console.warn('Failed to load application_documents for edit prefill:', e);
                docNames = [];
              }
            }
            const dobRaw = (db as DBApplication).date_of_birth ?? (db as DBApplication).dateBirth ?? '';
            const dobFormatted = (() => {
              if (!dobRaw) return '' as unknown as string;
              const d = new Date(dobRaw);
              return isNaN(d.getTime()) ? (dobRaw as unknown as string) : d.toLocaleDateString('en-US');
            })();

            const prefill: NonNullable<ReviewInitialType> = {
              id: db.id,
              businessName: db.business_name,
              industry: db.industry,
              requestedAmount: db.requested_amount,
              creditScore: db.credit_score,
              documents: docNames,
              contactInfo: {
                ownerName: db.owner_name,
                email: db.email,
                phone: db.phone ?? '',
                address: db.address ?? '',
                dateOfBirth: dobFormatted,
              },
              businessInfo: {
                ein: db.ein ?? '',
                businessType: db.business_type ?? '',
                yearsInBusiness: db.years_in_business ?? 0,
                numberOfEmployees: db.number_of_employees ?? 0,
              },
              financialInfo: {
                annualRevenue: db.annual_revenue ?? 0,
                averageMonthlyRevenue: db.monthly_revenue ?? 0,
                averageMonthlyDeposits: db.monthly_deposits ?? 0,
                existingDebt: db.existing_debt ?? 0,
              },
            };
            setEditPrefill(prefill);
            // Mark step 1 as completed in the progress and keep on Application step
            const mapped = appDataFromPrefill(prefill);
            setApplication(mapped);
            setCurrentStep('application');
          }
        } catch (e) {
          console.warn('Failed to preload application for editing:', e);
        }
      }
    })();
  }, [initialStep, initialApplicationId]);

  useEffect(() => {
    (async () => {
      if (initialStep === 'intermediate' && initialApplicationId) {
        try {
          const db = await getApplicationById(initialApplicationId);
          if (db) {
            let docNames: string[] = Array.isArray(db.documents) ? (db.documents as unknown as string[]) : [];
            if (!docNames || docNames.length === 0) {
              try {
                const docRows = await getApplicationDocuments(initialApplicationId);
                docNames = (docRows || []).map(r => r.file_name).filter(Boolean) as string[];
              } catch {
                docNames = [];
              }
            }
            const mapped: AppData = {
              id: db.id,
              businessName: db.business_name,
              monthlyRevenue: db.monthly_revenue,
              timeInBusiness: db.years_in_business,
              creditScore: db.credit_score,
              industry: db.industry,
              requestedAmount: db.requested_amount,
              status: (db.status as AppData['status']),
              ownerName: db.owner_name,
              email: db.email,
              phone: db.phone,
              address: db.address,
              ein: db.ein,
              businessType: db.business_type,
              yearsInBusiness: db.years_in_business,
              numberOfEmployees: db.number_of_employees,
              annualRevenue: db.annual_revenue,
              monthlyDeposits: db.monthly_deposits,
              existingDebt: db.existing_debt,
              documents: db.documents ?? [],
              contactInfo: {
                ownerName: db.owner_name,
                email: db.email,
                phone: db.phone,
                address: db.address,
              },
              businessInfo: {
                ein: db.ein,
                businessType: db.business_type,
                yearsInBusiness: db.years_in_business,
                numberOfEmployees: db.number_of_employees,
              },
              financialInfo: {
                annualRevenue: db.annual_revenue,
                averageMonthlyRevenue: db.monthly_revenue,
                averageMonthlyDeposits: db.monthly_deposits,
                existingDebt: db.existing_debt,
              },
            };
            setApplication(mapped);
            setCurrentStep('intermediate');
          }
        } catch (e) {
          void e;
        }
      }
    })();
  }, [initialStep, initialApplicationId]);

  // Always pass BankStatement an object compatible with its 'application' prop
  const toBankAppFromFlat = (flat: AppData | null): BankApplicationType => {
    if (!flat) return null;
    return {
      id: flat.id,
      businessName: flat.businessName,
      creditScore: flat.creditScore,
      industry: flat.industry,
      requestedAmount: flat.requestedAmount,
      documents: (flat as unknown as { documents?: string[] }).documents ?? [],
      contactInfo: {
        ownerName: flat.ownerName,
        email: flat.email,
        phone: flat.phone,
        address: flat.address,
      },
      businessInfo: {
        ein: flat.ein,
        businessType: flat.businessType,
        yearsInBusiness: flat.yearsInBusiness ?? flat.timeInBusiness,
        numberOfEmployees: flat.numberOfEmployees,
      },
      financialInfo: {
        annualRevenue: flat.annualRevenue,
        averageMonthlyRevenue: flat.monthlyRevenue,
      },
    };
  };

  const toBankAppFromReview = (prefill: NonNullable<ReviewInitialType>): BankApplicationType => {
    return {
      id: prefill.id,
      businessName: prefill.businessName,
      creditScore: prefill.creditScore,
      industry: prefill.industry,
      requestedAmount: prefill.requestedAmount,
      documents: prefill.documents,
      contactInfo: prefill.contactInfo,
      businessInfo: prefill.businessInfo,
      financialInfo: prefill.financialInfo,
    };
  };

  // simple navigation helpers so Back returns to the real previous page
  const goTo = (next: 'application' | 'bank' | 'intermediate' | 'additional-documents' | 'matches' | 'recap') => {
    setPrevStep(currentStep);
    setCurrentStep(next);
  };
  const goBack = () => {
    if (prevStep) {
      const target = prevStep;
      // update prev to the step we are leaving (simple 1-step memory)
      setPrevStep(currentStep);
      setCurrentStep(target);
    } else if (currentStep === 'matches' && onBackToDeals) {
      // If we were launched directly into Matches from All Deals, allow Back to return to All Deals
      onBackToDeals();
    }
  };

  const handleApplicationSubmit = async (appData: FormApplication, extra?: { pdfFile?: File } | null) => {
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

    // If we came from All Deals editing an existing app (editPrefill is present with a valid id),
    // update the existing row and jump straight to the Intermediate (documents) step.
    const isEditingExisting = Boolean(editPrefill && mapped.id);
    if (isEditingExisting) {
      try {
        // Persist updates to the applications table
        const payload: Partial<DBApplication> = {
          business_name: mapped.businessName,
          owner_name: mapped.ownerName,
          email: mapped.email,
          phone: mapped.phone || '',
          address: mapped.address || '',
          ein: mapped.ein || '',
          business_type: mapped.businessType || '',
          industry: mapped.industry,
          years_in_business: mapped.yearsInBusiness ?? mapped.timeInBusiness ?? 0,
          number_of_employees: mapped.numberOfEmployees ?? 0,
          annual_revenue: mapped.annualRevenue ?? 0,
          monthly_revenue: mapped.monthlyRevenue ?? 0,
          monthly_deposits: mapped.monthlyDeposits ?? 0,
          existing_debt: mapped.existingDebt ?? 0,
          credit_score: mapped.creditScore ?? 0,
          requested_amount: mapped.requestedAmount ?? 0,
          status: (mapped.status as DBApplication['status']) || 'submitted',
          documents: Array.isArray(mapped.documents) ? mapped.documents : [],
        };
        await updateApplication(mapped.id, payload as Partial<DBApplication>);
      } catch (e) {
        console.warn('[SubmissionsPortal] Failed to update application on edit submit:', e);
      }
      // Store and navigate to Documents/Intermediate step (as requested)
      setApplication(mapped);
      setIntermediatePrefill(null);
      setIntermediateLoading(false);
      goTo('intermediate');
      return;
    }

    // New flow (not editing): proceed to Bank step with webhook handling
    // At this point ApplicationForm has already saved to DB and provided a UUID in appData.id
    // Just store it and continue the flow.
    setApplication(mapped);
    setIntermediateLoading(true);
    setIntermediatePrefill(null);
    // Navigate to Bank step immediately
    goTo('bank');

    // Call webhook here using the passed PDF, showing loading while we await
    (async () => {
      try {
        if (extra?.pdfFile && !intermediatePrefill) {
          console.log('[newDeal] starting POST to /.netlify/functions/new-deal with file:', {
            name: extra.pdfFile.name,
            size: extra.pdfFile.size,
            type: extra.pdfFile.type,
          });
          // Call Netlify Function for new-deal
          const url = '/.netlify/functions/new-deal';

          const form = new FormData();
          form.append('file', extra.pdfFile, extra.pdfFile.name);
          // Include identifiers and names for downstream processing
          if (appData.id) form.append('application_id', appData.id);
          if (appData.businessName) form.append('business_name', appData.businessName);
          if (appData.contactInfo?.ownerName) form.append('owner_name', appData.contactInfo.ownerName);
          const resp = await fetch(url, { method: 'POST', body: form });
          console.log('[newDeal] response status:', resp.status, resp.statusText);
          console.log('[newDeal] response content-type:', resp.headers ? resp.headers.get('content-type') : '(no headers)');
          // Be tolerant to non-JSON and CORS middleware that strips content-type
          let src: Record<string, unknown> = {};
          let raw: unknown = {};
          try {
            const text = await resp.text();
            console.log('[newDeal] raw body:', text);
            if (text) {
              try {
                raw = JSON.parse(text);
              } catch {
                // Try to find first JSON object substring
                // Prefer array capture first; then fallback to object capture
                const arrMatch = text.match(/\[[\s\S]*?\]/);
                const objMatch = text.match(/\{[\s\S]*\}/);
                if (arrMatch) {
                  try { raw = JSON.parse(arrMatch[0]); } catch { raw = {}; }
                } else if (objMatch) {
                  try { raw = JSON.parse(objMatch[0]); } catch { raw = {}; }
                } else {
                  raw = {};
                }
              }
            }
          } catch {
            raw = {};
          }
          // If n8n responded with an array, use the first item
          if (Array.isArray(raw)) {
            console.log('[newDeal] parsed array length:', raw.length);
          }
          if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object' && raw[0] !== null) {
            src = raw[0] as Record<string, unknown>;
          } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            src = raw as Record<string, unknown>;
          } else {
            src = {};
          }
          console.log('[newDeal] parsed normalized root object:', src);

          // Log the exact expected keys if present
          const preview = {
            'Entity Type': (src['Entity Type'] as unknown) ?? null,
            'State': (src['State'] as unknown) ?? null,
            'Gross Annual Revenue': (src['Gross Annual Revenue'] as unknown) ?? null,
            'Avg Daily Balance': (src['Avg Daily Balance'] as unknown) ?? null,
            'Avg Monthly Deposit Count': (src['Avg Monthly Deposit Count'] as unknown) ?? null,
            'NSF Count': (src['NSF Count'] as unknown) ?? null,
            'Negative Days': (src['Negative Days'] as unknown) ?? null,
            'Current Position Count': (src['Current Position Count'] as unknown) ?? null,
            'Holdback': (src['Holdback'] as unknown) ?? null,
          };
          console.log('[newDeal] expected-key preview:', preview);

          // Build a flattened, normalized key map to be resilient to nesting and label variants
          const flat: Record<string, unknown> = {};
          const flatten = (obj: unknown, prefix = '') => {
            if (obj && typeof obj === 'object') {
              for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
                const key = prefix ? `${prefix}.${k}` : k;
                if (v && typeof v === 'object' && !Array.isArray(v)) {
                  flatten(v, key);
                } else {
                  flat[key] = v;
                }
              }
            }
          };
          flatten(src);
          const normalizeKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
          const normMap: Record<string, unknown> = {};
          for (const [k, v] of Object.entries({ ...src, ...flat })) {
            normMap[normalizeKey(k)] = v as unknown;
          }

          // helpers for normalized lookup and numeric normalization
          const readAnyNormalized = (keys: string[]): string => {
            for (const k of keys) {
              const nk = normalizeKey(k);
              const v = normMap[nk];
              if (v == null) continue;
              if (typeof v === 'string') {
                if (v.trim() !== '') return v;
              } else if (typeof v === 'number' || typeof v === 'boolean') {
                return String(v);
              }
            }
            return '';
          };
          const asNumberLike = (s: string): string => {
            if (!s) return '';
            const cleaned = s.replace(/[^0-9.-]/g, '');
            return cleaned;
          };

          const normalized: Record<string, string | boolean> = {};
          // 1) Prefer exact keys from n8n sample output for deterministic display
          const direct = (k: string) => (typeof src[k] === 'string' || typeof src[k] === 'number' || typeof src[k] === 'boolean') ? String(src[k] as string | number | boolean) : '';
          normalized.entityType = direct('Entity Type');
          normalized.state = direct('State');
          normalized.grossAnnualRevenue = asNumberLike(direct('Gross Annual Revenue'));
          normalized.avgDailyBalance = asNumberLike(direct('Avg Daily Balance'));
          normalized.avgMonthlyDepositCount = asNumberLike(direct('Avg Monthly Deposit Count'));
          normalized.nsfCount = asNumberLike(direct('NSF Count'));
          normalized.negativeDays = asNumberLike(direct('Negative Days'));
          normalized.currentPositionCount = asNumberLike(direct('Current Position Count'));
          normalized.holdback = asNumberLike(direct('Holdback'));

          // 2) Fill any remaining gaps via normalized alias lookups
          normalized.entityType = normalized.entityType || readAnyNormalized(['Entity Type','Business Type','Entity','Business Entity']);
          normalized.state = normalized.state || readAnyNormalized(['State','Business State','Company State']);
          normalized.grossAnnualRevenue = normalized.grossAnnualRevenue || asNumberLike(readAnyNormalized(['Gross Annual Revenue','Annual Revenue','Yearly Revenue','Gross Annual Sales']));
          normalized.avgDailyBalance = normalized.avgDailyBalance || asNumberLike(readAnyNormalized(['Avg Daily Balance','Average Daily Balance']));
          normalized.avgMonthlyDepositCount = normalized.avgMonthlyDepositCount || asNumberLike(readAnyNormalized(['Avg Monthly Deposit Count','Average Monthly Deposit Count']));
          normalized.nsfCount = normalized.nsfCount || asNumberLike(readAnyNormalized(['NSF Count','NSF','NSFCount']));
          normalized.negativeDays = normalized.negativeDays || asNumberLike(readAnyNormalized(['Negative Days','Days Negative']));
          normalized.currentPositionCount = normalized.currentPositionCount || asNumberLike(readAnyNormalized(['Current Position Count','Positions','Current Positions']));
          normalized.holdback = normalized.holdback || asNumberLike(readAnyNormalized(['Holdback','Hold Back','Hold-back']));

          // Additional common keys
          normalized.creditScore = asNumberLike(readAnyNormalized(['Credit Score','FICO','FICO Score']));
          // Map time in business; prefer months; if years provided, convert to months if numeric
          const tibRaw = readAnyNormalized(['Time in Biz','Time In Business','Months In Business','Years In Business']);
          if (tibRaw) {
            const num = Number(asNumberLike(tibRaw));
            if (!isNaN(num)) {
              // Heuristic: if <= 10, treat as years and convert to months; else assume already months
              normalized.timeInBiz = String(num <= 10 ? Math.round(num * 12) : Math.round(num));
            } else {
              normalized.timeInBiz = tibRaw;
            }
          }
          normalized.avgMonthlyRevenue = asNumberLike(readAnyNormalized(['Avg Monthly Revenue','Average Monthly Revenue','Monthly Revenue']));

          // Fallbacks from the previous page/application if webhook didn't provide values
          const ensure = (current: string | undefined, fallback: string | number | undefined) => {
            if (current && String(current).trim() !== '') return current;
            if (fallback === undefined || fallback === null) return '';
            return typeof fallback === 'number' ? String(fallback) : String(fallback);
          };
          // entity type
          normalized.entityType = ensure(normalized.entityType as string, mapped.businessType);
          // state: try to parse from address if missing
          if (!normalized.state || String(normalized.state).trim() === '') {
            const addr = mapped.address || '';
            const m = addr.match(/\b([A-Z]{2})\b(?:\s+\d{5}(?:-\d{4})?)?$/);
            if (m) normalized.state = m[1];
          }
          // numeric fallbacks
          normalized.grossAnnualRevenue = ensure(normalized.grossAnnualRevenue as string, mapped.annualRevenue);
          normalized.avgMonthlyDepositCount = ensure(normalized.avgMonthlyDepositCount as string, mapped.monthlyDeposits);
          normalized.creditScore = ensure(normalized.creditScore as string, mapped.creditScore);
          normalized.timeInBiz = ensure(normalized.timeInBiz as string, mapped.timeInBusiness);
          normalized.avgMonthlyRevenue = ensure(normalized.avgMonthlyRevenue as string, mapped.monthlyRevenue);

          console.log('[newDeal] final normalized prefill:', normalized);
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
    
    // Debug the values being passed
    console.log('[SubmissionsPortal] Details from SubmissionIntermediate:', details);
    console.log('[SubmissionsPortal] Current application values:', {
      monthlyRevenue: application.monthlyRevenue,
      creditScore: application.creditScore,
      requestedAmount: application.requestedAmount
    });
    
    // Update application with values from SubmissionIntermediate
    const updated: AppData = {
      ...application,
      // Update monthlyRevenue, creditScore, and requestedAmount from details
      monthlyRevenue: details.monthlyRevenue ? Number(details.monthlyRevenue) : application.monthlyRevenue,
      creditScore: details.creditScore ? Number(details.creditScore) : application.creditScore,
      requestedAmount: details.requestedAmount ? Number(details.requestedAmount) : application.requestedAmount,
    };
    
    // Debug the updated values
    console.log('[SubmissionsPortal] Updated application values:', {
      monthlyRevenue: updated.monthlyRevenue,
      creditScore: updated.creditScore,
      requestedAmount: updated.requestedAmount
    });

    setApplication(updated);

    // Fire-and-forget webhook with the full updated applications row
    (async () => {
      try {
        // Show loading screen on the intermediate page while matching webhook runs
        setIntermediateLoading(true);
        // Ensure we have a valid UUID for application.id before notifying webhook
        const isValidUUID = (v: unknown) =>
          typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
        // Never create a new application here. Reuse existing id only.
        let toSend: AppData = updated;
        if (!isValidUUID(toSend.id)) {
          // Try to use the applicationId coming from the Intermediate form initial
          const possibleId = (details.applicationId as string) || application.id;
          if (isValidUUID(possibleId)) {
            toSend = { ...toSend, id: possibleId };
            setApplication(prev => prev ? { ...prev, id: possibleId } : toSend);
          } else {
            console.warn('No valid application id available; skipping lenders webhook to avoid creating a new row.');
            setIntermediateLoading(false);
            return;
          }
        }
        // Fetch the freshest row from DB after updatingApplications finished in the Intermediate step
        let dbRow: DBApplication | null = null;
        try {
          dbRow = await getApplicationById(toSend.id);
        } catch (e) {
          console.warn('Failed to fetch latest application row; falling back to in-memory state:', e);
        }

        const payloadForLenders = dbRow ?? {
          // minimal fallback mapping if DB fetch failed
          id: toSend.id,
          business_name: toSend.businessName,
          owner_name: toSend.ownerName,
          email: toSend.email,
          phone: toSend.phone || '',
          address: toSend.address || '',
          ein: toSend.ein || '',
          business_type: toSend.businessType || '',
          industry: toSend.industry,
          years_in_business: toSend.yearsInBusiness ?? toSend.timeInBusiness ?? 0,
          number_of_employees: toSend.numberOfEmployees ?? 0,
          annual_revenue: toSend.annualRevenue ?? 0,
          monthly_revenue: toSend.monthlyRevenue ?? 0,
          monthly_deposits: toSend.monthlyDeposits ?? 0,
          existing_debt: toSend.existingDebt ?? 0,
          credit_score: toSend.creditScore ?? 0,
          requested_amount: toSend.requestedAmount ?? 0,
          status: (toSend.status as DBApplication['status']) || 'submitted',
          documents: Array.isArray(toSend.documents) ? toSend.documents : [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as unknown as DBApplication;

        const resp = await fetch('/.netlify/functions/applications-lenders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadForLenders),
        });

        // Attempt to parse and extract cleaned matches safely
        try {
          if (!resp.ok) {
            console.warn('applications/lenders webhook non-OK status:', resp.status, resp.statusText);
            setCleanedMatches(null);
          } else {
            const text = await resp.text();
            if (!text || text.trim().length === 0) {
              // Empty body (e.g., 204 No Content or server returned nothing)
              setCleanedMatches(null);
            } else {
              try {
                const json = JSON.parse(text);
                const cleaned = extractLenderMatches(json);
                setCleanedMatches(cleaned);
              } catch (e) {
                console.warn('Failed to parse cleaned matches from webhook response:', e);
                setCleanedMatches(null);
              }
            }
          }
        } catch (e) {
          console.warn('Failed handling applications/lenders webhook response:', e);
          setCleanedMatches(null);
        }
      } catch (e) {
        console.warn('applications/lenders webhook failed:', e);
        setCleanedMatches(null);
      } finally {
        // Hide loading once webhook completes
        setIntermediateLoading(false);
        goTo('additional-documents');
      }
    })();
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
          
          <div className={`flex items-center ${currentStep === 'bank' ? 'text-blue-600' : currentStep !== 'application' ? 'text-green-600' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              currentStep === 'bank' ? 'bg-blue-100 text-blue-600' : currentStep !== 'application' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
            }`}>
              {currentStep !== 'application' ? <CheckCircle className="w-5 h-5" /> : '2'}
            </div>
            <span className="ml-2 text-sm font-medium">Bank Statement</span>
          </div>
          
          {/* Separator to the right of Bank should be green only once we've moved past Bank */}
          <div className={`flex-1 h-1 mx-4 ${currentStep !== 'application' && currentStep !== 'bank' ? 'bg-green-200' : 'bg-gray-200'}`}></div>
          
          <div className={`flex items-center ${currentStep === 'additional-documents' ? 'text-blue-600' : (currentStep === 'matches' || currentStep === 'recap') ? 'text-green-600' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              (currentStep === 'matches' || currentStep === 'recap') ? 'bg-green-100 text-green-600' : currentStep === 'additional-documents' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
            }`}>
              {(currentStep === 'matches' || currentStep === 'recap') ? <CheckCircle className="w-5 h-5" /> : '3'}
            </div>
            <span className="ml-2 text-sm font-medium">Additional Documents</span>
          </div>
          
          <div className={`flex-1 h-1 mx-4 ${(currentStep === 'matches' || currentStep === 'recap') ? 'bg-green-200' : 'bg-gray-200'}`}></div>
          
          <div className={`flex items-center ${currentStep === 'matches' ? 'text-blue-600' : selectedLenders.length > 0 ? 'text-green-600' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              selectedLenders.length > 0 ? 'bg-green-100 text-green-600' : currentStep === 'matches' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
            }`}>
              {selectedLenders.length > 0 ? <CheckCircle className="w-5 h-5" /> : '4'}
            </div>
            <span className="ml-2 text-sm font-medium">Lender Matches</span>
          </div>
          
          <div className={`flex-1 h-1 mx-4 ${selectedLenders.length > 0 ? 'bg-green-200' : 'bg-gray-200'}`}></div>
          
          <div className={`flex items-center ${currentStep === 'recap' ? 'text-blue-600' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              currentStep === 'recap' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
            }`}>
              5
            </div>
            <span className="ml-2 text-sm font-medium">Submission Recap</span>
          </div>
        </div>
      </div>

      {/* Content */}
      {currentStep === 'application' ? (
        (initialStep === 'application' && initialApplicationId && !editPrefill) ? (
          <div className="bg-white rounded-xl shadow-sm p-10 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-200 border-t-blue-600 mx-auto mb-3"></div>
              <p className="text-gray-600 text-sm">Loading application...</p>
            </div>
          </div>
        ) : (
        <ApplicationForm 
          key={editPrefill ? `edit-${initialApplicationId}` : 'new'}
          initialStep={editPrefill ? 'form' : 'upload'}
          reviewMode={!!editPrefill}
          reviewInitial={editPrefill}
          reviewDocName={editPrefill?.documents && editPrefill.documents.length > 0 ? editPrefill.documents[0] : null}
          onSubmit={handleApplicationSubmit}
          onReviewSubmit={(application) => {
            // Convert ApplicationForm.Application to this module's FormApplication
            const fa: FormApplication = {
              id: application.id,
              businessName: application.businessName,
              monthlyRevenue: application.financialInfo?.averageMonthlyRevenue ?? application.monthlyRevenue ?? 0,
              timeInBusiness: application.businessInfo?.yearsInBusiness ?? application.timeInBusiness ?? 0,
              creditScore: application.creditScore ?? 0,
              industry: application.industry ?? '',
              requestedAmount: application.requestedAmount ?? 0,
              status: application.status || 'submitted',
              contactInfo: {
                ownerName: application.contactInfo?.ownerName ?? '',
                email: application.contactInfo?.email ?? '',
                phone: application.contactInfo?.phone ?? '',
                dateOfBirth: application.contactInfo?.dateOfBirth ?? '',
                address: application.contactInfo?.address ?? '',
              },
              businessInfo: {
                ein: application.businessInfo?.ein ?? '',
                businessType: application.businessInfo?.businessType ?? '',
                yearsInBusiness: application.businessInfo?.yearsInBusiness ?? 0,
                numberOfEmployees: application.businessInfo?.numberOfEmployees ?? 0,
              },
              financialInfo: {
                annualRevenue: application.financialInfo?.annualRevenue ?? 0,
                averageMonthlyRevenue: application.financialInfo?.averageMonthlyRevenue ?? application.monthlyRevenue ?? 0,
                averageMonthlyDeposits: application.financialInfo?.averageMonthlyDeposits ?? 0,
                existingDebt: application.financialInfo?.existingDebt ?? 0,
              },
              documents: Array.isArray(application.documents) ? application.documents : [],
            };
            void handleApplicationSubmit(fa, null);
          }}
          onReadyForForm={(prefill) => {
            // Accept prefill from upload/extraction and move to Bank step
            console.log('[SubmissionsPortal] onReadyForForm prefill:', prefill);
            setBankPrefill(prefill as ReviewInitialType);
            // Mark step 1 as completed by creating an application draft from the prefill
            try {
              if (prefill) {
                const mapped = appDataFromPrefill(prefill as NonNullable<ReviewInitialType>);
                setApplication(mapped);
                // If a PDF file is needed for webhook, it will be handled during onSubmit or Bank step.
              }
            } catch (e) {
              console.warn('Failed to map prefill to AppData:', e);
            }
            // If we are editing (coming from All Deals), stay on the form and do not auto-advance
            if (!editPrefill) {
              // Defer navigation to ensure bankPrefill is committed before first Bank render
              setTimeout(() => {
                goTo('bank');
              }, 0);
            }
          }}
        />)
      ) : currentStep === 'bank' ? (
        <BankStatement 
          onContinue={async (updated) => {
            // If the Bank step returns updated values (review form), merge them into application
            if (updated) {
              // prevent user interaction on next screen until ID is ready
              setIntermediateLoading(true);
              const merged: AppData = {
                ...(application || appDataFromPrefill(updated as NonNullable<ReviewInitialType>)),
                id: updated.id || application?.id || '',
                businessName: updated.businessName || application?.businessName || '',
                creditScore: Number(updated.creditScore ?? application?.creditScore ?? 0),
                industry: updated.industry || application?.industry || '',
                requestedAmount: Number(updated.requestedAmount ?? application?.requestedAmount ?? 0),
                ownerName: updated.contactInfo?.ownerName || application?.ownerName || '',
                email: updated.contactInfo?.email || application?.email || '',
                phone: updated.contactInfo?.phone || application?.phone,
                address: updated.contactInfo?.address || application?.address,
                ein: updated.businessInfo?.ein || application?.ein,
                businessType: updated.businessInfo?.businessType || application?.businessType,
                yearsInBusiness: Number(updated.businessInfo?.yearsInBusiness ?? application?.yearsInBusiness ?? application?.timeInBusiness ?? 0),
                numberOfEmployees: Number(updated.businessInfo?.numberOfEmployees ?? application?.numberOfEmployees ?? 0),
                annualRevenue: Number(updated.financialInfo?.annualRevenue ?? application?.annualRevenue ?? 0),
                monthlyRevenue: Number(updated.financialInfo?.averageMonthlyRevenue ?? application?.monthlyRevenue ?? 0),
                monthlyDeposits: Number(updated.financialInfo?.averageMonthlyDeposits ?? application?.monthlyDeposits ?? 0),
                existingDebt: Number(updated.financialInfo?.existingDebt ?? application?.existingDebt ?? 0),
                documents: Array.isArray(updated.documents) ? updated.documents : (application?.documents ?? []),
                status: (updated.status as AppData['status']) || application?.status,
                contactInfo: {
                  ownerName: updated.contactInfo?.ownerName || application?.contactInfo.ownerName || '',
                  email: updated.contactInfo?.email || application?.contactInfo.email || '',
                  phone: updated.contactInfo?.phone || application?.contactInfo.phone || '',
                  address: updated.contactInfo?.address || application?.contactInfo.address || '',
                },
                businessInfo: {
                  ein: updated.businessInfo?.ein || application?.businessInfo.ein || '',
                  businessType: updated.businessInfo?.businessType || application?.businessInfo.businessType || '',
                  yearsInBusiness: Number(updated.businessInfo?.yearsInBusiness ?? application?.businessInfo.yearsInBusiness ?? 0),
                  numberOfEmployees: Number(updated.businessInfo?.numberOfEmployees ?? application?.businessInfo.numberOfEmployees ?? 0),
                },
                financialInfo: {
                  annualRevenue: Number(updated.financialInfo?.annualRevenue ?? application?.financialInfo.annualRevenue ?? 0),
                  averageMonthlyRevenue: Number(updated.financialInfo?.averageMonthlyRevenue ?? application?.financialInfo.averageMonthlyRevenue ?? 0),
                  averageMonthlyDeposits: Number(updated.financialInfo?.averageMonthlyDeposits ?? application?.financialInfo.averageMonthlyDeposits ?? 0),
                  existingDebt: Number(updated.financialInfo?.existingDebt ?? application?.financialInfo.existingDebt ?? 0),
                },
              };
              // If no ID yet (e.g., user navigated via upload prefill without submitting form), create a draft in DB to get an ID
              if (!merged.id || String(merged.id).trim() === '') {
                try {
                  const payload: Omit<DBApplication, 'id' | 'created_at' | 'updated_at'> = {
                    business_name: merged.businessName,
                    owner_name: merged.ownerName,
                    email: merged.email,
                    phone: merged.phone || '',
                    address: merged.address || '',
                    ein: merged.ein || '',
                    business_type: merged.businessType || '',
                    industry: merged.industry,
                    years_in_business: merged.yearsInBusiness ?? merged.timeInBusiness ?? 0,
                    number_of_employees: merged.numberOfEmployees ?? 0,
                    annual_revenue: merged.annualRevenue ?? 0,
                    monthly_revenue: merged.monthlyRevenue ?? 0,
                    monthly_deposits: merged.monthlyDeposits ?? 0,
                    existing_debt: merged.existingDebt ?? 0,
                    credit_score: merged.creditScore ?? 0,
                    requested_amount: merged.requestedAmount ?? 0,
                    status: (merged.status as DBApplication['status']) || 'submitted',
                    documents: Array.isArray(merged.documents) ? merged.documents : [],
                    user_id: user?.id, // Add the logged-in user's ID
                  };
                  console.log('[SubmissionsPortal] No application ID; creating draft in Supabase with:', payload);
                  console.log('[SubmissionsPortal] User ID being added:', user?.id);
                  const saved = await createApplication(payload);
                  console.log('[SubmissionsPortal] Draft created. New ID:', saved.id);
                  const withId: AppData = { ...merged, id: saved.id };
                  setApplication(withId);
                  // now that we have an ID, proceed to intermediate
                  goTo('intermediate');
                } catch (err) {
                  console.warn('Failed to create draft application before intermediate step:', err);
                  setApplication(merged);
                  goTo('intermediate');
                }
              } else {
                setApplication(merged);
                goTo('intermediate');
              }
              // Also keep bankPrefill aligned for future edits
              setBankPrefill(updated as ReviewInitialType);
              // stop loading after navigating
              setIntermediateLoading(false);
            } else {
              goTo('intermediate');
            }
          }}
          onReplaceDocument={() => goTo('application')}
          application={bankPrefill ? toBankAppFromReview(bankPrefill as NonNullable<ReviewInitialType>) : toBankAppFromFlat(application)}
        />
      ) : currentStep === 'intermediate' ? (
        <SubmissionIntermediate
          initial={{
            id: application?.id ?? '',
            applicationId: application?.id ?? '',
            business_name: application?.businessName ?? '',
            owner_name: application?.ownerName ?? '',
            dealName: (intermediatePrefill?.dealName as string) ?? application?.businessName ?? '',
            industry: (intermediatePrefill?.industry as string) ?? application?.industry ?? '',
            entityType: (intermediatePrefill?.entityType as string) ?? application?.businessType ?? '',
            state: (intermediatePrefill?.state as string) ?? '',
            // Always prefer DB value saved on submit; only fall back to webhook if DB missing
            creditScore: String(
              application?.creditScore !== undefined && application?.creditScore !== null
                ? application.creditScore
                : (intermediatePrefill?.creditScore as string) ?? ''
            ),
            timeInBiz: (intermediatePrefill?.timeInBiz as string) ?? String(application?.timeInBusiness ?? ''),
            avgMonthlyRevenue: (intermediatePrefill?.avgMonthlyRevenue as string) ?? String(application?.monthlyRevenue ?? ''),
            requestedAmount: (intermediatePrefill?.requestedAmount as string) ?? String(application?.requestedAmount ?? ''),
            grossAnnualRevenue: (intermediatePrefill?.grossAnnualRevenue as string) ?? String(application?.annualRevenue ?? ''),
            avgDailyBalance: (intermediatePrefill?.avgDailyBalance as string) ?? '',
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
      ) : currentStep === 'additional-documents' ? (
        <AdditionalDocuments
          applicationId={application?.id}
          onBack={goBack}
          onContinue={() => goTo('matches')}
        />
      ) : currentStep === 'matches' ? (
        <LenderMatches 
          application={application}
          matches={cleanedMatches ?? undefined}
          onBack={() => { if (prevStep) { goBack(); } else { onBackToDeals?.(); } }}
          onLenderSelect={(ids) => {
            setSelectedLenders(ids);
            setCurrentStep('recap');
          }}
          lockedLenderIds={lockedLenderIds}
        />
      ) : currentStep === 'recap' ? (
        <SubmissionRecap 
          application={application ? {
            ...application,
            status: (['draft','submitted','under-review','matched'].includes(String(application.status))
              ? (application.status as 'draft' | 'submitted' | 'under-review' | 'matched')
              : 'submitted')
          } : null}
          selectedLenderIds={selectedLenders}
          matches={cleanedMatches ?? undefined}
          onBack={handleBackToMatches}
          onSubmit={handleFinalSubmit}
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