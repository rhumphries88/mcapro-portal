import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DollarSign, Building2, User, CheckCircle, FileCheck, Loader } from 'lucide-react';

import { createApplication, Application as DBApplication } from '../lib/supabase';
import { extractDataFromPDF } from '../lib/pdfExtractor';

interface Application {
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
}

interface ApplicationFormProps {
  onSubmit: (application: Application, extra?: { pdfFile?: File } | null) => void;
  // Optional props to reuse this component as a review step (no DB insert)
  initialStep?: 'upload' | 'form';
  reviewMode?: boolean;
  reviewInitial?: Partial<Application> | null;
  onReviewSubmit?: (application: Application) => void;
  onReadyForForm?: (prefill: Partial<Application>) => void;
  // Review-mode header helpers
  reviewDocName?: string | null;
  onReplaceDocument?: () => void;
}

// Interface for webhook response data
interface WebhookResponse {
  // The webhook might return data in an extractedData property or other nested structure
  extractedData?: Record<string, string | number | boolean | Record<string, unknown>>;
  data?: Record<string, string | number | boolean | Record<string, unknown>>;
  fields?: Record<string, string | number | boolean | Record<string, unknown>>;
  formData?: Record<string, string | number | boolean | Record<string, unknown>>;
  values?: Record<string, string | number | boolean | Record<string, unknown>>;
  
  // Or it might return data directly at the top level
  'Business Name'?: string;
  'business_name'?: string;
  'businessName'?: string;
  'company'?: string;
  'Company Name'?: string;
  'company_name'?: string;
  
  'Owner Name'?: string;
  'owner_name'?: string;
  'ownerName'?: string;
  'name'?: string;
  'Name'?: string;
  'full_name'?: string;
  'Full Name'?: string;
  
  'Email'?: string;
  'email'?: string;
  'email_address'?: string;
  'emailAddress'?: string;
  'contact_email'?: string;
  
  'Phone'?: string;
  'phone'?: string;
  'phone_number'?: string;
  'phoneNumber'?: string;
  'contact_phone'?: string;
  'telephone'?: string;
  
  'Business Address'?: string;
  'business_address'?: string;
  'businessAddress'?: string;
  'address'?: string;
  'Address'?: string;
  'location'?: string;
  
  'EIN'?: string;
  'ein'?: string;
  'tax_id'?: string;
  'taxId'?: string;
  'employer_identification_number'?: string;
  
  'Business Type'?: string;
  'business_type'?: string;
  'businessType'?: string;
  'company_type'?: string;
  'entity_type'?: string;
  
  'Industry'?: string;
  'industry'?: string;
  'business_industry'?: string;
  'sector'?: string;
  'business_sector'?: string;
  
  'Years in Business'?: string;
  'years_in_business'?: string;
  'yearsInBusiness'?: string;
  'business_age'?: string;
  'company_age'?: string;
  
  'Number of Employees'?: string;
  'number_of_employees'?: string;
  'numberOfEmployees'?: string;
  'employee_count'?: string;
  'staff_count'?: string;
  
  'Annual Revenue'?: string;
  'annual_revenue'?: string;
  'annualRevenue'?: string;
  'yearly_revenue'?: string;
  'revenue'?: string;
  
  'Average Monthly Revenue'?: string;
  'average_monthly_revenue'?: string;
  'averageMonthlyRevenue'?: string;
  'monthly_revenue'?: string;
  
  'Average Monthly Deposits'?: string;
  'average_monthly_deposits'?: string;
  'averageMonthlyDeposits'?: string;
  'monthly_deposits'?: string;
  
  'Existing Debt'?: string;
  'existing_debt'?: string;
  'existingDebt'?: string;
  'current_debt'?: string;
  'debt'?: string;
  
  'Credit Score'?: string;
  'credit_score'?: string;
  'creditScore'?: string;
  'fico_score'?: string;
  'credit_rating'?: string;
  
  'Requested Amount'?: string;
  'requested_amount'?: string;
  'requestedAmount'?: string;
  'loan_amount'?: string;
  'funding_amount'?: string;
  
  // Allow any other properties with a more specific type
  [key: string]: string | number | boolean | Record<string, unknown> | undefined;
}

const ApplicationForm: React.FC<ApplicationFormProps> = ({ onSubmit, initialStep = 'upload', reviewMode = false, reviewInitial = null, onReviewSubmit, onReadyForForm, reviewDocName, onReplaceDocument }) => {
  const [currentStep, setCurrentStep] = useState<'upload' | 'form'>(initialStep);

  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [extractedData, setExtractedData] = useState<Awaited<ReturnType<typeof extractDataFromPDF>> | null>(null);
  const [webhookData, setWebhookData] = useState<WebhookResponse | null>(null);
  // Removed webhookError state as it's not used in the new UI design
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const [formData, setFormData] = useState({
    businessName: '',
    ownerName: '',
    email: '',
    phone: '',
    address: '',
    ein: '',
    businessType: '',
    industry: '',
    yearsInBusiness: '',
    numberOfEmployees: '',
    annualRevenue: '',
    averageMonthlyRevenue: '',
    averageMonthlyDeposits: '',
    existingDebt: '',
    creditScore: '',
    requestedAmount: '',
    documents: [] as string[]
  });

  // Prefill for review mode
  useEffect(() => {
    if (!reviewMode || !reviewInitial) return;
    setFormData(prev => ({
      ...prev,
      businessName: reviewInitial.businessName ?? prev.businessName,
      ownerName: reviewInitial.contactInfo?.ownerName ?? prev.ownerName,
      email: reviewInitial.contactInfo?.email ?? prev.email,
      phone: reviewInitial.contactInfo?.phone ?? prev.phone,
      address: reviewInitial.contactInfo?.address ?? prev.address,
      ein: reviewInitial.businessInfo?.ein ?? prev.ein,
      businessType: reviewInitial.businessInfo?.businessType ?? prev.businessType,
      industry: reviewInitial.industry ?? prev.industry,
      yearsInBusiness: reviewInitial.businessInfo?.yearsInBusiness !== undefined ? String(reviewInitial.businessInfo.yearsInBusiness) : prev.yearsInBusiness,
      numberOfEmployees: reviewInitial.businessInfo?.numberOfEmployees !== undefined ? String(reviewInitial.businessInfo.numberOfEmployees) : prev.numberOfEmployees,
      annualRevenue: reviewInitial.financialInfo?.annualRevenue !== undefined ? String(reviewInitial.financialInfo.annualRevenue) : prev.annualRevenue,
      averageMonthlyRevenue: reviewInitial.financialInfo?.averageMonthlyRevenue !== undefined ? String(reviewInitial.financialInfo.averageMonthlyRevenue) : prev.averageMonthlyRevenue,
      averageMonthlyDeposits: reviewInitial.financialInfo?.averageMonthlyDeposits !== undefined ? String(reviewInitial.financialInfo.averageMonthlyDeposits) : prev.averageMonthlyDeposits,
      existingDebt: reviewInitial.financialInfo?.existingDebt !== undefined ? String(reviewInitial.financialInfo.existingDebt) : prev.existingDebt,
      creditScore: reviewInitial.creditScore !== undefined ? String(reviewInitial.creditScore) : prev.creditScore,
      requestedAmount: reviewInitial.requestedAmount !== undefined ? String(reviewInitial.requestedAmount) : prev.requestedAmount,
      documents: reviewInitial.documents ?? prev.documents,
    }));
    // Mark which fields are provided by reviewInitial so the green highlights and banner show up in Bank step
    const provided: string[] = [];
    if (reviewInitial.businessName) provided.push('businessName');
    if (reviewInitial.contactInfo?.ownerName) provided.push('ownerName');
    if (reviewInitial.contactInfo?.email) provided.push('email');
    if (reviewInitial.contactInfo?.phone) provided.push('phone');
    if (reviewInitial.contactInfo?.address) provided.push('address');
    if (reviewInitial.businessInfo?.ein) provided.push('ein');
    if (reviewInitial.businessInfo?.businessType) provided.push('businessType');
    if (reviewInitial.industry) provided.push('industry');
    if (reviewInitial.businessInfo?.yearsInBusiness !== undefined) provided.push('yearsInBusiness');
    if (reviewInitial.businessInfo?.numberOfEmployees !== undefined) provided.push('numberOfEmployees');
    if (reviewInitial.financialInfo?.annualRevenue !== undefined) provided.push('annualRevenue');
    if (reviewInitial.financialInfo?.averageMonthlyRevenue !== undefined) provided.push('averageMonthlyRevenue');
    if (reviewInitial.financialInfo?.averageMonthlyDeposits !== undefined) provided.push('averageMonthlyDeposits');
    if (reviewInitial.financialInfo?.existingDebt !== undefined) provided.push('existingDebt');
    if (reviewInitial.creditScore !== undefined) provided.push('creditScore');
    if (reviewInitial.requestedAmount !== undefined) provided.push('requestedAmount');
    if ((reviewInitial.documents ?? []).length > 0) provided.push('documents');
    if (provided.length > 0) {
      setAutoFields(prev => {
        const next = { ...prev } as Record<string, true>;
        provided.forEach(k => { next[k] = true; });
        return next;
      });
    }
  }, [reviewMode, reviewInitial]);

  // Track the last values that were set by a webhook to detect user edits between webhook events
  const [lastWebhookValues, setLastWebhookValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [applicationDocument, setApplicationDocument] = useState<File | null>(null);

  // Manual mode: set to true when user clicks "Skip and fill form manually"
  const [manualMode] = useState(false);

  // Track which fields were auto-populated (used for green highlights and banner)
  const [autoFields, setAutoFields] = useState<Record<string, true>>({});

  // In review mode (Bank Statement step), treat all fields as auto-populated so they render green
  useEffect(() => {
    if (reviewMode) {
      setAutoFields({
        businessName: true,
        industry: true,
        businessType: true,
        yearsInBusiness: true,
        numberOfEmployees: true,
        ownerName: true,
        email: true,
        phone: true,
        address: true,
        ein: true,
        annualRevenue: true,
        averageMonthlyRevenue: true,
        averageMonthlyDeposits: true,
        existingDebt: true,
        creditScore: true,
        requestedAmount: true,
      });
    }
  }, [reviewMode]);

  // Only fields set automatically (webhook or extraction) should be highlighted
  const populatedFields = useMemo(() => {
    if (manualMode) return new Set<string>();
    return new Set<string>(Object.keys(autoFields));
  }, [manualMode, autoFields]);

  // Count only the visible inputs in the UI for the banner chip
  const visiblePopulatedCount = useMemo(() => {
    const visibleKeys = new Set<string>([
      'businessName',
      'industry',
      'businessType',
      'ein',
      'yearsInBusiness',
      'numberOfEmployees',
      'ownerName',
      'email',
      'phone',
      'address',
      'annualRevenue',
    ]);
    let count = 0;
    visibleKeys.forEach(k => { if (populatedFields.has(k)) count++; });
    return count;
  }, [populatedFields]);



  const webhookNotifiedRef = useRef(false);

  const industries = useMemo(() => [
    'Retail', 'Restaurant', 'Healthcare', 'Construction', 'Professional Services',
    'Transportation', 'Manufacturing', 'Technology', 'Real Estate', 'Other'
  ], []);

  const businessTypes = useMemo(() => [
    'Sole Proprietorship', 'Partnership', 'LLC', 'Corporation', 'S-Corporation'
  ], []);

  // Listen for webhook responses
  useEffect(() => {
    // In manual mode, do not attach webhook listeners
    if (manualMode) {
      return;
    }
    const handleWebhookResponse = async (event: MessageEvent) => {
      try {
        // Allow processing only for configured origins and the correct type
        const envOrigins = import.meta.env.VITE_WEBHOOK_ALLOWED_ORIGINS as string | undefined;
        const allowedOrigins = new Set<string>([window.location.origin]);
        if (envOrigins) {
          envOrigins.split(',').map(s => s.trim()).filter(Boolean).forEach(o => allowedOrigins.add(o));
        }
        const isAllowedOrigin = allowedOrigins.has(event.origin);
        if (!isAllowedOrigin) {
          console.warn('Ignoring extracted message from unallowed origin:', event.origin, 'Allowed:', Array.from(allowedOrigins));
        }
        if (isAllowedOrigin && event.data?.type === 'webhook-response') {
          
          const webhookData = event.data.payload as WebhookResponse;
          setWebhookData(webhookData);
          
          // Debug the webhook data structure
          console.log('Extracted data received:', JSON.stringify(webhookData, null, 2));
          console.log('Extracted data type:', typeof webhookData);
          console.log('Extracted data keys:', webhookData ? Object.keys(webhookData) : 'No data');
          
          // Check if we have data in the response
          if (webhookData) {
            
            // Clean and process the extracted data
            const cleanedData: Record<string, string> = {};
            
            // Process each field from extracted data
            const data = webhookData;
            console.log('Processing extracted data:', data);
            
            // Check if data is nested in an extractedData property or another property
            // Try different possible structures
            let dataToProcess = data as unknown as Record<string, string | number | boolean | Record<string, unknown>>;
            
            // Check for common wrapper properties
            const possibleWrappers = ['extractedData', 'data', 'fields', 'formData', 'values'];
            for (const wrapper of possibleWrappers) {
              if (data && typeof data === 'object' && wrapper in data && data[wrapper] && typeof data[wrapper] === 'object') {
                console.log(`Found data in ${wrapper} property`);
                dataToProcess = data[wrapper] as Record<string, string | number | boolean | Record<string, unknown>>;
                break;
              }
            }
            
            console.log('Final data to process:', dataToProcess);
            
            // If dataToProcess is still not an object with our expected fields, try to find them at any level
            const flattenedData: Record<string, string | number | boolean | Record<string, unknown>> = {};
            const flattenObject = (obj: Record<string, unknown>, prefix = '') => {
              if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                Object.entries(obj).forEach(([key, value]) => {
                  const newKey = prefix ? `${prefix}.${key}` : key;
                  if (value && typeof value === 'object' && !Array.isArray(value)) {
                    flattenObject(value as Record<string, unknown>, newKey);
                  } else {
                    flattenedData[newKey] = value as string | number | boolean;
                    // Also store with just the key for easier matching
                    flattenedData[key] = value as string | number | boolean;
                  }
                });
              }
            };
            
            flattenObject(data as unknown as Record<string, unknown>);
            console.log('Flattened data:', flattenedData);
            
            // Process all possible data sources
            [dataToProcess, flattenedData].forEach(sourceData => {
              Object.entries(sourceData).forEach(([key, value]) => {
                let str: string = '';
                if (typeof value === 'string') {
                  str = value;
                } else if (typeof value === 'number' || typeof value === 'boolean') {
                  str = String(value);
                } else {
                  return; // skip non-primitive values
                }
                if (str.trim() !== '') {
                  cleanedData[key] = str;
                  if (key === 'Credit Score' || key === 'Number of Employees') {
                    cleanedData[key] = str.replace(/[^0-9]/g, '');
                  } else if (['Requested Amount', 'Annual Revenue', 'Average Monthly Revenue', 'Average Monthly Deposits', 'Existing Debt', 'Years in Business'].includes(key)) {
                    cleanedData[key] = str.replace(/[^0-9.]/g, '');
                  }
                }
              });
            });
            console.log('Cleaned extracted keys available:', Object.keys(cleanedData));
            // Build a normalized index for robust key matching
            const normalizeKey = (k: string) => k.trim().replace(/:+$/, '').toLowerCase().replace(/[\s_]+/g, '');
            const normalizedCleaned = new Map<string, string>();
            Object.entries(cleanedData).forEach(([k, v]) => {
              const variants = new Set<string>([
                k,
                k.trim(),
                k.replace(/:+$/, ''),
              ]);
              variants.forEach(variant => normalizedCleaned.set(normalizeKey(variant), v));
            });
            
            // Track which fields were populated from extracted data
            const populatedFields = new Set<string>();
            
            // Update form data with cleaned extracted data using safe merge rules
            const assignedByWebhook: Record<string, string> = {};
            setFormData(prev => {
              const newFormData = { ...prev } as typeof prev;
              
              // Helper: map an incoming string to a valid option from a list
              const mapToOption = (value: string, options: string[]): string => {
                const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
                const v = norm(value);
                // exact normalized match
                for (const opt of options) {
                  if (norm(opt) === v) return opt;
                }
                // substring/word overlap
                const vWords = new Set(v.split(' '));
                let best: { opt: string; score: number } | null = null;
                for (const opt of options) {
                  const o = norm(opt);
                  const oWords = new Set(o.split(' '));
                  let score = 0;
                  vWords.forEach(w => { if (oWords.has(w)) score++; });
                  if (!best || score > best.score) best = { opt, score };
                }
                return best && best.score > 0 ? best.opt : options.includes('Other') ? 'Other' : options[0] || '';
              };

              // Helper to fetch value by multiple possible names
              const getFieldValue = (possibleNames: string[]): string | undefined => {
                for (const name of possibleNames) {
                  // direct exact key
                  const direct = cleanedData[name];
                  if (typeof direct === 'string' && direct.trim() !== '') return direct;
                  // try with trailing colon variant
                  const withColon = cleanedData[`${name}:`];
                  if (typeof withColon === 'string' && withColon.trim() !== '') return withColon;
                  // normalized lookup (case/colon/space/underscore insensitive)
                  const norm = normalizedCleaned.get(normalizeKey(name));
                  if (typeof norm === 'string' && norm.trim() !== '') return norm;
                }
                return undefined;
              };
              
              // Merge rule: fill if empty; update if last value was set by webhook and unchanged since then; otherwise preserve
              const mergeField = <K extends keyof typeof newFormData>(formKey: K, possibleNames: string[], transform?: (v: string) => string) => {
                let incoming = getFieldValue(possibleNames);
                if (!incoming) {
                  console.log(`Skipped empty: ${String(formKey)}`);
                  return;
                }
                if (transform) {
                  const t = transform(incoming);
                  if (!t || t.toString().trim() === '') {
                    console.log(`Transform produced empty for ${String(formKey)} from '${incoming}', skipping.`);
                    return;
                  }
                  incoming = t;
                }
                const current = String(newFormData[formKey] ?? '');
                const last = lastWebhookValues[String(formKey)];
                if (!current || current.trim() === '') {
                  newFormData[formKey] = incoming as typeof newFormData[K];
                  populatedFields.add(String(formKey));
                  assignedByWebhook[String(formKey)] = incoming;
                  console.log(`Filled empty: ${String(formKey)} ->`, incoming);
                } else if (last !== undefined && current === last) {
                  newFormData[formKey] = incoming as typeof newFormData[K];
                  populatedFields.add(String(formKey));
                  assignedByWebhook[String(formKey)] = incoming;
                  console.log(`Updated auto-filled: ${String(formKey)} ${current} -> ${incoming}`);
                } else {
                  console.log(`Preserved user edit: ${String(formKey)} (current: ${current})`);
                }
              };
              
              // Map fields from webhook JSON structure to form fields with multiple possible names
              mergeField('businessName', ['Business Name', 'business_name', 'businessName', 'company', 'Company Name', 'company_name']);
              mergeField('ownerName', ['Owner Name', 'owner_name', 'ownerName', 'name', 'Name', 'full_name', 'Full Name']);
              mergeField('email', ['Email', 'email', 'email_address', 'emailAddress', 'contact_email']);
              mergeField('phone', ['Phone', 'phone', 'phone_number', 'phoneNumber', 'contact_phone', 'telephone']);
              mergeField('address', ['Business Address', 'business_address', 'businessAddress', 'address', 'Address', 'location']);
              mergeField('ein', ['EIN', 'ein', 'tax_id', 'taxId', 'employer_identification_number']);
              mergeField('businessType', ['Business Type', 'business_type', 'businessType', 'company_type', 'entity_type'], v => mapToOption(v, businessTypes));
              mergeField('industry', ['Industry', 'industry', 'business_industry', 'sector', 'business_sector'], v => mapToOption(v, industries));
              mergeField('yearsInBusiness', ['Years in Business', 'years_in_business', 'yearsInBusiness', 'business_age', 'company_age']);
              mergeField('numberOfEmployees', ['Number of Employees', 'number_of_employees', 'numberOfEmployees', 'employee_count', 'staff_count']);
              mergeField('annualRevenue', ['Annual Revenue', 'annual_revenue', 'annualRevenue', 'yearly_revenue', 'revenue']);
              mergeField('averageMonthlyRevenue', ['Average Monthly Revenue', 'average_monthly_revenue', 'averageMonthlyRevenue', 'monthly_revenue']);
              mergeField('averageMonthlyDeposits', ['Average Monthly Deposits', 'average_monthly_deposits', 'averageMonthlyDeposits', 'monthly_deposits']);
              mergeField('existingDebt', ['Existing Debt', 'existing_debt', 'existingDebt', 'current_debt', 'debt']);
              mergeField('creditScore', ['Credit Score', 'credit_score', 'creditScore', 'fico_score', 'credit_rating']);
              mergeField('requestedAmount', ['Requested Amount', 'requested_amount', 'requestedAmount', 'loan_amount', 'funding_amount']);
              
              return newFormData;
            });
            // Record last extracted values for fields we just set
            if (Object.keys(assignedByWebhook).length > 0) {
              setLastWebhookValues(prev => ({ ...prev, ...assignedByWebhook }));
            }
            // Mark auto-populated fields only when not in manual mode
            if (!manualMode && populatedFields.size > 0) {
              setAutoFields(prev => {
                const updated = { ...prev } as Record<string, true>;
                populatedFields.forEach(k => { updated[k] = true; });
                return updated;
              });
            }
            
            // populatedFields is used directly for UI; no state needed
            
            // After extraction/webhook while still on upload, notify parent with a prefill built directly from cleanedData
            if (currentStep === 'upload' && !reviewMode) {
              if (onReadyForForm) {
                // Build prefill directly from cleanedData to avoid setState timing
                const getValue = (keys: string[]): string | undefined => {
                  for (const k of keys) {
                    const v = normalizedCleaned.get(normalizeKey(k));
                    if (v !== undefined && v !== null && `${v}`.trim() !== '') return `${v}`;
                  }
                  return undefined;
                };
                const mapToNormalizedOption = (value: string, options: string[]): string => {
                  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
                  const nv = norm(value);
                  const direct = options.find(o => norm(o) === nv);
                  if (direct) return direct;
                  const prefix = options.find(o => nv.startsWith(norm(o)) || norm(o).startsWith(nv));
                  return prefix || value;
                };
                const num = (v?: string) => {
                  if (!v) return undefined as unknown as number;
                  const cleaned = v.replace(/[^0-9.]/g, '');
                  const parts = cleaned.split('.');
                  const joined = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;
                  const n = Number(joined);
                  return Number.isNaN(n) ? (undefined as unknown as number) : n;
                };
                const docList: string[] = (() => {
                  const fromState = (formData.documents as unknown as string[]) || [];
                  const fromSelected = applicationDocument?.name ? [applicationDocument.name] : [];
                  const merged = [...fromSelected, ...fromState].filter(Boolean);
                  return merged.length > 0 ? merged : [];
                })();
                const prefill: Partial<Application> = {
                  businessName: getValue(['Business Name','business_name','businessName','company','Company Name','company_name']) || '',
                  creditScore: num(getValue(['Credit Score','credit_score','creditScore','fico_score','credit_rating'])),
                  industry: mapToNormalizedOption(getValue(['Industry','industry','business_industry','sector','business_sector']) || '', industries),
                  requestedAmount: num(getValue(['Requested Amount','requested_amount','requestedAmount','loan_amount','funding_amount'])),
                  contactInfo: {
                    ownerName: getValue(['Owner Name','owner_name','ownerName','name','Name','full_name','Full Name']) || '',
                    email: getValue(['Email','email','email_address','emailAddress','contact_email']) || '',
                    phone: getValue(['Phone','phone','phone_number','phoneNumber','contact_phone','telephone']) || '',
                    address: getValue(['Business Address','business_address','businessAddress','address','Address','location']) || '',
                  },
                  businessInfo: {
                    ein: getValue(['EIN','ein','tax_id','taxId','employer_identification_number']) || '',
                    businessType: mapToNormalizedOption(getValue(['Business Type','business_type','businessType','company_type','entity_type']) || '', businessTypes),
                    yearsInBusiness: num(getValue(['Years in Business','years_in_business','yearsInBusiness','business_age','company_age'])),
                    numberOfEmployees: num(getValue(['Number of Employees','number_of_employees','numberOfEmployees','employee_count','staff_count'])),
                  },
                  financialInfo: {
                    annualRevenue: num(getValue(['Annual Revenue','annual_revenue','annualRevenue','yearly_revenue','revenue'])),
                    averageMonthlyRevenue: num(getValue(['Average Monthly Revenue','average_monthly_revenue','averageMonthlyRevenue','monthly_revenue'])),
                    averageMonthlyDeposits: num(getValue(['Average Monthly Deposits','average_monthly_deposits','averageMonthlyDeposits','monthly_deposits'])),
                    existingDebt: num(getValue(['Existing Debt','existing_debt','existingDebt','current_debt','debt'])),
                  },
                  documents: docList,
                };
                // Notify parent with cleaned prefill and mark notified
                onReadyForForm(prefill);
                webhookNotifiedRef.current = true;
              } else {
                // No parent handler; fallback to local form rendering
                setCurrentStep('form');
              }
            }
          }
        }
      } catch (error) {
        console.error('Error processing extracted response:', error);
        console.warn('Failed to process extracted data. Please fill the form manually.');
      }
    };

    // Add event listener for webhook responses
    window.addEventListener('message', handleWebhookResponse);
    
    // Clean up
    return () => {
      window.removeEventListener('message', handleWebhookResponse);
    };
  }, [currentStep, lastWebhookValues, industries, businessTypes, manualMode, reviewMode, formData, onReadyForForm, applicationDocument?.name]);

  const extractDataFromDocument = async (file: File) => {
    setIsExtracting(true);
    setExtractionProgress(0);
    
    // Simulate progress during extraction
    const progressInterval = setInterval(() => {
      setExtractionProgress(prev => {
        if (prev >= 90) return prev; // Stop at 90% until completion
        return prev + Math.random() * 15;
      });
    }, 200);
    
    try {
      const extractedData = await extractDataFromPDF(file);
      setExtractedData(extractedData);
      // Merge extracted fields into existing form state, but EXCLUDE fields that must come from webhook
      // Business Name and Address should be set only from webhook/extracted-response to avoid noisy PDF text
      const filtered = Object.fromEntries(
        Object.entries(extractedData).filter(([k]) => k !== 'businessName' && k !== 'address')
      ) as typeof formData;
      setFormData(prev => ({
        ...prev,
        ...filtered,
      }));
      // Prepare a snapshot that reflects the merged values immediately
      const mergedSnapshot = { ...formData, ...filtered };
      // Mark auto-populated fields if not in manual mode
      if (!manualMode) {
        setAutoFields(prev => {
          const updated = { ...prev } as Record<string, true>;
          Object.keys(filtered).forEach(k => { updated[k] = true; });
          return updated;
        });
      }
      if (!reviewMode) {
        if (onReadyForForm) {
          const prefill: Partial<Application> = {
            businessName: mergedSnapshot.businessName,
            creditScore: Number(mergedSnapshot.creditScore) || undefined as unknown as number,
            industry: mergedSnapshot.industry,
            requestedAmount: Number(mergedSnapshot.requestedAmount) || undefined as unknown as number,
            contactInfo: {
              ownerName: mergedSnapshot.ownerName,
              email: mergedSnapshot.email,
              phone: mergedSnapshot.phone,
              address: mergedSnapshot.address,
            },
            businessInfo: {
              ein: mergedSnapshot.ein,
              businessType: mergedSnapshot.businessType,
              yearsInBusiness: mergedSnapshot.yearsInBusiness ? Number(mergedSnapshot.yearsInBusiness) : undefined as unknown as number,
              numberOfEmployees: mergedSnapshot.numberOfEmployees ? Number(mergedSnapshot.numberOfEmployees) : undefined as unknown as number,
            },
            financialInfo: {
              annualRevenue: mergedSnapshot.annualRevenue ? Number(mergedSnapshot.annualRevenue) : undefined as unknown as number,
              averageMonthlyRevenue: mergedSnapshot.averageMonthlyRevenue ? Number(mergedSnapshot.averageMonthlyRevenue) : undefined as unknown as number,
              averageMonthlyDeposits: mergedSnapshot.averageMonthlyDeposits ? Number(mergedSnapshot.averageMonthlyDeposits) : undefined as unknown as number,
              existingDebt: mergedSnapshot.existingDebt ? Number(mergedSnapshot.existingDebt) : undefined as unknown as number,
            },
            documents: mergedSnapshot.documents,
          };
          // Fallback: notify parent only if webhook hasn't already notified within a short delay
          setTimeout(() => {
            if (!webhookNotifiedRef.current) {
              const docList: string[] = (() => {
                const fromState = (formData.documents as unknown as string[]) || [];
                const fromSelected = applicationDocument?.name ? [applicationDocument.name] : [];
                const merged = [...fromSelected, ...fromState].filter(Boolean);
                return merged.length > 0 ? merged : [];
              })();
              const withDocs = { ...prefill, documents: docList } as Partial<Application>;
              onReadyForForm(withDocs);
            }
          }, 1200);
        } else {
          setCurrentStep('form');
        }
      }
    } catch (error) {
      console.error('Error extracting data from PDF:', error);
      alert('Error extracting data from PDF. Please fill the form manually.');
      if (!reviewMode) setCurrentStep('form');
    } finally {
      clearInterval(progressInterval);
      setExtractionProgress(100); // Complete the progress
      setTimeout(() => {
        setIsExtracting(false);
        setExtractionProgress(0);
      }, 500); // Brief delay to show completion
    }
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setApplicationDocument(file);
      await extractDataFromDocument(file);
    }
  };

  // Drag and drop handlers (reuse the same extraction flow)
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    const ok = name.endsWith('.pdf') || name.endsWith('.doc') || name.endsWith('.docx') || file.type === 'application/pdf';
    if (!ok) return;
    setApplicationDocument(file);
    await extractDataFromDocument(file);
  };

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};
    
    // Required fields validation
    if (!formData.businessName) newErrors.businessName = 'Business name is required';
    if (!formData.ownerName) newErrors.ownerName = 'Owner name is required';

    // Industry validation
    if (!formData.industry) {
      newErrors.industry = 'Please select an industry';
    }
    
    // Business type validation
    if (!formData.businessType) {
      newErrors.businessType = 'Please select a business type';
    }
    
    // Years in business validation
    if (!formData.yearsInBusiness) {
      newErrors.yearsInBusiness = 'Years in business is required';
    } else if (Number(formData.yearsInBusiness) < 0) {
      newErrors.yearsInBusiness = 'Years in business must be a positive number';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    const handleSubmitApplication = async () => {
      try {
        if (reviewMode) {
          // Build Application object from current form data and hand off to review submit handler
          const application: Application = {
            id: reviewInitial?.id || '',
            businessName: formData.businessName,
            monthlyRevenue: Number(formData.averageMonthlyRevenue),
            timeInBusiness: Number(formData.yearsInBusiness),
            creditScore: Number(formData.creditScore),
            industry: formData.industry,
            requestedAmount: Number(formData.requestedAmount),
            status: 'submitted',
            contactInfo: {
              ownerName: formData.ownerName,
              email: formData.email,
              phone: formData.phone,
              address: formData.address,
            },
            businessInfo: {
              ein: formData.ein,
              businessType: formData.businessType,
              yearsInBusiness: Number(formData.yearsInBusiness),
              numberOfEmployees: Number(formData.numberOfEmployees),
            },
            financialInfo: {
              annualRevenue: Number(formData.annualRevenue),
              averageMonthlyRevenue: Number(formData.averageMonthlyRevenue) || 0,
              averageMonthlyDeposits: Number(formData.averageMonthlyDeposits) || 0,
              existingDebt: Number(formData.existingDebt) || 0,
            },
            documents: formData.documents,
          };
          if (onReviewSubmit) {
            onReviewSubmit(application);
          }
          return;
        }
        const applicationData: Omit<DBApplication, 'id' | 'created_at' | 'updated_at'> = {
          business_name: formData.businessName,
          owner_name: formData.ownerName,
          email: formData.email,
          phone: formData.phone,
          address: formData.address,
          ein: formData.ein,
          business_type: formData.businessType,
          industry: formData.industry,
          years_in_business: Number(formData.yearsInBusiness),
          number_of_employees: Number(formData.numberOfEmployees),
          annual_revenue: Number(formData.annualRevenue),
          monthly_revenue: Number(formData.averageMonthlyRevenue) || 0,
          monthly_deposits: Number(formData.averageMonthlyDeposits) || 0,
          existing_debt: Number(formData.existingDebt) || 0,
          credit_score: Number(formData.creditScore) || 0,
          requested_amount: Number(formData.requestedAmount) || 0,
          status: 'submitted',
          documents: formData.documents,
        };

        const savedApplication = await createApplication(applicationData);
        
        // Convert to component format for compatibility
        const application: Application = {
          id: savedApplication.id,
          businessName: savedApplication.business_name,
          monthlyRevenue: savedApplication.monthly_revenue,
          timeInBusiness: savedApplication.years_in_business,
          creditScore: savedApplication.credit_score,
          industry: savedApplication.industry,
          requestedAmount: savedApplication.requested_amount,
          status: savedApplication.status as 'draft' | 'submitted' | 'under-review' | 'matched',
          contactInfo: {
            ownerName: savedApplication.owner_name,
            email: savedApplication.email,
            phone: savedApplication.phone || '',
            address: savedApplication.address || ''
          },
          businessInfo: {
            ein: savedApplication.ein || '',
            businessType: savedApplication.business_type || '',
            yearsInBusiness: savedApplication.years_in_business,
            numberOfEmployees: savedApplication.number_of_employees
          },
          financialInfo: {
            annualRevenue: savedApplication.annual_revenue,
            averageMonthlyRevenue: savedApplication.monthly_revenue ?? 0,
            averageMonthlyDeposits: savedApplication.monthly_deposits ?? 0,
            existingDebt: savedApplication.existing_debt ?? 0,
          },
          documents: savedApplication.documents
        };

        // Pass the PDF file up so parent can call webhook and show loading immediately
        const extra = applicationDocument && (
          applicationDocument.type === 'application/pdf' ||
          applicationDocument.name.toLowerCase().endsWith('.pdf')
        ) ? { pdfFile: applicationDocument } : null;

        onSubmit(application, extra);
      } catch (error) {
        console.error('Error saving application:', error);
        alert('Error saving application. Please try again.');
      }
    };

    handleSubmitApplication();
  };

  // Document Upload Step
  if (currentStep === 'upload') {
    return (
      <div className="bg-white rounded-xl shadow-lg">
        <div className="px-8 py-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">Upload Application Document</h2>
          <p className="text-gray-600 mt-1">Upload your completed MCA application form to auto-populate the submission</p>
        </div>

        <div className="p-8">
          {!isExtracting ? (
            <div
              className={`relative p-10 border-2 border-dashed rounded-3xl text-center transition-all duration-300 bg-gradient-to-br from-gray-50/50 via-white to-blue-50/30 hover:border-blue-400 hover:bg-gradient-to-br hover:from-blue-50/50 hover:to-indigo-50/50 hover:shadow-lg hover:scale-[1.01] ${
                isDragging ? 'border-blue-500 ring-4 ring-blue-400/30' : 'border-gray-300'
              }`}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              aria-label="Drop your application document here"
            >
              <div className="relative">
                <div className="p-4 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-2xl w-fit mx-auto mb-6 shadow-sm">
                  <FileCheck className="w-8 h-8 text-blue-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">
                  Upload Application Document
                </h3>
                <p className="text-sm text-gray-600 mb-8 max-w-md mx-auto leading-relaxed">
                  We'll automatically extract your business information from PDF, DOC, or DOCX files.
                </p>
                <label className="cursor-pointer inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-4 focus:ring-blue-500/40 transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105">
                  <FileCheck className="w-5 h-5" />
                  Choose Application File
                  <input 
                    id="document-upload" 
                    name="document-upload" 
                    type="file" 
                    className="sr-only" 
                    accept=".pdf,.doc,.docx"
                    onChange={handleDocumentUpload} 
                  />
                </label>
                <p className="text-xs text-gray-500 mt-4 font-medium">PDF, DOC, DOCX files only, max 10MB</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="p-4 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-2xl mb-6 shadow-sm">
                <Loader className="w-8 h-8 text-blue-600 animate-spin" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">Processing Your Document</h3>
              <p className="text-gray-600 mb-6 max-w-md leading-relaxed">
                We're extracting information from your application document...
              </p>
              <div className="max-w-md mx-auto w-full">
                <div className="bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-blue-600 to-indigo-600 h-3 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${Math.min(extractionProgress, 100)}%` }}
                  ></div>
                </div>
                <p className="text-sm text-gray-500 mt-3 font-medium">
                  {extractionProgress < 100 ? 'This usually takes 30-60 seconds' : 'Almost done...'}
                </p>
              </div>
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-gray-200">
            <button
              onClick={() => {
                // Go straight to manual form entry
                setCurrentStep('form');
                setExtractedData(null);
                setWebhookData(null);
                // Webhook error handling removed for cleaner UI
                setApplicationDocument(null);
                setAutoFields({});
              }}
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              Skip and fill form manually →
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-8 py-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">Merchant Cash Advance Application</h2>
          <p className="text-gray-600 mt-1">
            {(extractedData || webhookData) ? 'Review and confirm the extracted information' : 'Please fill out all required information to get matched with qualified lenders'}
          </p>
        </div>
        {(applicationDocument || reviewMode) && (
          <div className="mt-3 p-3 bg-blue-50 rounded-lg">
            <div className="flex items-center w-full">
              <FileCheck className="w-4 h-4 text-blue-600 mr-2" />
              {(() => {
                const name = reviewMode ? (reviewDocName ?? '') : (applicationDocument?.name ?? '');
                return (
                  <span className="text-sm text-blue-800 font-medium truncate" title={name || undefined}>
                    {name ? `Source Document: ${name}` : 'No source document detected'}
                  </span>
                );
              })()}
              <button
                onClick={() => {
                  if (reviewMode) {
                    if (onReplaceDocument) {
                      onReplaceDocument();
                    }
                  } else {
                    setCurrentStep('upload');
                    setApplicationDocument(null);
                    setExtractedData(null);
                    setFormData({
                      businessName: '', ownerName: '', email: '', phone: '', address: '', ein: '',
                      businessType: '', industry: '', yearsInBusiness: '', numberOfEmployees: '',
                      annualRevenue: '', averageMonthlyRevenue: '', averageMonthlyDeposits: '', existingDebt: '', creditScore: '', requestedAmount: '',
                      documents: []
                    });
                  }
                }}
                className="ml-auto text-blue-600 hover:text-blue-800 text-sm"
              >
                Upload Different Document
              </button>
            </div>
          </div>
        )}
      
      <form onSubmit={handleSubmit} className="p-8">
        
        {/* Data Extraction Banner */}
        {visiblePopulatedCount > 0 && (
          <div className="mb-8 relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-green-50 to-teal-50 p-6 shadow-lg">
            <div className="absolute inset-0 bg-gradient-to-r from-emerald-100/20 to-teal-100/20 opacity-50"></div>
            <div className="relative flex items-start gap-4">
              <div className="flex-shrink-0 p-3 bg-gradient-to-br from-emerald-100 to-green-100 rounded-2xl shadow-sm border border-emerald-200">
                <CheckCircle className="w-6 h-6 text-emerald-700" />
              </div>
              <div className="flex-1">
                <h4 className="text-lg font-bold text-emerald-900 mb-2">Data Extraction Complete</h4>
                <p className="text-emerald-800 font-medium mb-2">
                  {visiblePopulatedCount} fields automatically populated from your documents
                </p>
                <p className="text-sm text-emerald-700 leading-relaxed">
                  Review the highlighted fields below. All information can be edited if needed.
                </p>
              </div>
              <div className="flex-shrink-0">
                <span className="inline-flex items-center px-4 py-2 rounded-full text-sm font-bold bg-gradient-to-r from-emerald-100 to-green-100 text-emerald-800 border border-emerald-200 shadow-sm">
                  {visiblePopulatedCount} Fields
                </span>
              </div>
            </div>
          </div>
        )}
        {/* Business Information Section */}
        <div className="mb-8">
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-xl shadow-sm border border-blue-200">
                <Building2 className="w-5 h-5 text-blue-700" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">Business Information</h3>
            </div>
            <p className="text-sm text-gray-600 ml-12">Basic details about your business</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="relative">
                <label className="block text-sm font-bold text-gray-800 mb-2" htmlFor="businessName">Business Name</label>
                <input
                  type="text"
                  id="businessName"
                  value={formData.businessName}
                  onChange={(e) => setFormData({...formData, businessName: e.target.value})}
                  className={`w-full rounded-xl border-2 px-4 py-3 text-gray-900 font-medium transition-all duration-200 focus:outline-none ${
                    populatedFields.has('businessName') 
                      ? 'border-emerald-300 bg-gradient-to-r from-emerald-50 to-green-50 ring-2 ring-emerald-200/50 shadow-sm focus:border-emerald-400 focus:ring-emerald-300/50' 
                      : 'border-gray-200 bg-white hover:border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-sm hover:shadow-sm'
                  }`}
                />
                {populatedFields.has('businessName') && (
                  <div className="mt-2 flex items-center gap-2 text-emerald-700 text-xs font-medium">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span>Extracted from documents</span>
                  </div>
                )}
              </div>
              {errors.businessName && <p className="mt-1 text-sm text-red-600">{errors.businessName}</p>}
            </div>
            <div className="relative">
              <label className="block text-sm font-bold text-gray-800 mb-2" htmlFor="industry">Industry*</label>
              <select
                id="industry"
                value={formData.industry}
                onChange={(e) => setFormData({...formData, industry: e.target.value})}
                className={`w-full rounded-xl border-2 px-4 py-3 text-gray-900 font-medium transition-all duration-200 focus:outline-none ${
                  populatedFields.has('industry') 
                    ? 'border-emerald-300 bg-gradient-to-r from-emerald-50 to-green-50 ring-2 ring-emerald-200/50 shadow-sm focus:border-emerald-400 focus:ring-emerald-300/50' 
                    : errors.industry 
                    ? 'border-red-300 bg-white focus:border-red-500 focus:ring-2 focus:ring-red-500/20 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-sm hover:shadow-sm'
                }`}
              >
                <option value="">Select Industry</option>
                {industries.map((industry) => (
                  <option key={industry} value={industry}>{industry}</option>
                ))}
              </select>
              {populatedFields.has('industry') && (
                <div className="mt-2 flex items-center gap-2 text-emerald-700 text-xs font-medium">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                  <span>Extracted from documents</span>
                </div>
              )}
              {errors.industry && <p className="mt-1 text-sm text-red-600">{errors.industry}</p>}
            </div>
            <div className="relative">
              <label className="block text-sm font-bold text-gray-800 mb-2" htmlFor="businessType">Business Type*</label>
              <select
                id="businessType"
                value={formData.businessType}
                onChange={(e) => setFormData({...formData, businessType: e.target.value})}
                className={`w-full rounded-xl border-2 px-4 py-3 text-gray-900 font-medium transition-all duration-200 focus:outline-none ${
                  populatedFields.has('businessType') 
                    ? 'border-emerald-300 bg-gradient-to-r from-emerald-50 to-green-50 ring-2 ring-emerald-200/50 shadow-sm focus:border-emerald-400 focus:ring-emerald-300/50' 
                    : errors.businessType 
                    ? 'border-red-300 bg-white focus:border-red-500 focus:ring-2 focus:ring-red-500/20 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-sm hover:shadow-sm'
                }`}
              >
                <option value="">Select Business Type</option>
                {businessTypes.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              {populatedFields.has('businessType') && (
                <div className="mt-2 flex items-center gap-2 text-emerald-700 text-xs font-medium">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                  <span>Extracted from documents</span>
                </div>
              )}
              {errors.businessType && <p className="mt-1 text-sm text-red-600">{errors.businessType}</p>}
            </div>
            <div className="relative">
              <label className="block text-sm font-bold text-gray-800 mb-2" htmlFor="ein">EIN</label>
              <input
                type="text"
                id="ein"
                value={formData.ein}
                onChange={(e) => setFormData({...formData, ein: e.target.value})}
                className={`w-full rounded-xl border-2 px-4 py-3 text-gray-900 font-medium transition-all duration-200 focus:outline-none ${
                  populatedFields.has('ein') 
                    ? 'border-emerald-300 bg-gradient-to-r from-emerald-50 to-green-50 ring-2 ring-emerald-200/50 shadow-sm focus:border-emerald-400 focus:ring-emerald-300/50' 
                    : 'border-gray-200 bg-white hover:border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-sm hover:shadow-sm'
                }`}
              />
              {populatedFields.has('ein') && (
                <div className="mt-2 flex items-center gap-2 text-emerald-700 text-xs font-medium">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                  <span>Extracted from documents</span>
                </div>
              )}
            </div>
            <div className="relative">
              <label className="block text-sm font-bold text-gray-800 mb-2" htmlFor="yearsInBusiness">Years in Business*</label>
              <input
                type="number"
                id="yearsInBusiness"
                value={formData.yearsInBusiness}
                onChange={(e) => setFormData({...formData, yearsInBusiness: e.target.value})}
                className={`w-full rounded-xl border-2 px-4 py-3 text-gray-900 font-medium transition-all duration-200 focus:outline-none ${
                  populatedFields.has('yearsInBusiness') 
                    ? 'border-emerald-300 bg-gradient-to-r from-emerald-50 to-green-50 ring-2 ring-emerald-200/50 shadow-sm focus:border-emerald-400 focus:ring-emerald-300/50' 
                    : errors.yearsInBusiness 
                    ? 'border-red-300 bg-white focus:border-red-500 focus:ring-2 focus:ring-red-500/20 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-sm hover:shadow-sm'
                }`}
              />
              {populatedFields.has('yearsInBusiness') && (
                <div className="mt-2 flex items-center gap-2 text-emerald-700 text-xs font-medium">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                  <span>Extracted from documents</span>
                </div>
              )}
              {errors.yearsInBusiness && <p className="mt-1 text-sm text-red-600">{errors.yearsInBusiness}</p>}
            </div>
            <div className="relative">
              <label className="block text-sm font-bold text-gray-800 mb-2" htmlFor="numberOfEmployees">Number of Employees</label>
              <input
                type="number"
                id="numberOfEmployees"
                value={formData.numberOfEmployees}
                onChange={(e) => setFormData({...formData, numberOfEmployees: e.target.value})}
                className={`w-full rounded-xl border-2 px-4 py-3 text-gray-900 font-medium transition-all duration-200 focus:outline-none ${
                  populatedFields.has('numberOfEmployees') 
                    ? 'border-emerald-300 bg-gradient-to-r from-emerald-50 to-green-50 ring-2 ring-emerald-200/50 shadow-sm focus:border-emerald-400 focus:ring-emerald-300/50' 
                    : 'border-gray-200 bg-white hover:border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-sm hover:shadow-sm'
                }`}
              />
              {populatedFields.has('numberOfEmployees') && (
                <div className="mt-2 flex items-center gap-2 text-emerald-700 text-xs font-medium">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                  <span>Extracted from documents</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Contact Information Section */}
        <div className="mb-8">
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-gradient-to-br from-purple-100 to-violet-100 rounded-xl shadow-sm border border-purple-200">
                <User className="w-5 h-5 text-purple-700" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">Contact Information</h3>
            </div>
            <p className="text-sm text-gray-600 ml-12">Owner and business contact details</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="relative">
                <label className="block text-sm font-bold text-gray-800 mb-2" htmlFor="ownerName">Owner Name</label>
                <input
                  type="text"
                  id="ownerName"
                  value={formData.ownerName}
                  onChange={(e) => setFormData({...formData, ownerName: e.target.value})}
                  className={`w-full rounded-xl border-2 px-4 py-3 text-gray-900 font-medium transition-all duration-200 focus:outline-none ${
                    populatedFields.has('ownerName') 
                      ? 'border-emerald-300 bg-gradient-to-r from-emerald-50 to-green-50 ring-2 ring-emerald-200/50 shadow-sm focus:border-emerald-400 focus:ring-emerald-300/50' 
                      : 'border-gray-200 bg-white hover:border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-sm hover:shadow-sm'
                  }`}
                />
                {populatedFields.has('ownerName') && (
                  <div className="mt-2 flex items-center gap-2 text-emerald-700 text-xs font-medium">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span>Extracted from documents</span>
                  </div>
                )}
              </div>
              {errors.ownerName && <p className="mt-1 text-sm text-red-600">{errors.ownerName}</p>}
            </div>
            <div className="relative">
              <label className="block text-sm font-bold text-gray-800 mb-2" htmlFor="email">Email*</label>
              <input
                type="email"
                id="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                className={`w-full rounded-xl border-2 px-4 py-3 text-gray-900 font-medium transition-all duration-200 focus:outline-none ${
                  populatedFields.has('email') 
                    ? 'border-emerald-300 bg-gradient-to-r from-emerald-50 to-green-50 ring-2 ring-emerald-200/50 shadow-sm focus:border-emerald-400 focus:ring-emerald-300/50' 
                    : errors.email 
                    ? 'border-red-300 bg-white focus:border-red-500 focus:ring-2 focus:ring-red-500/20 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-sm hover:shadow-sm'
                }`}
              />
              {populatedFields.has('email') && (
                <div className="mt-2 flex items-center gap-2 text-emerald-700 text-xs font-medium">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                  <span>Extracted from documents</span>
                </div>
              )}
              {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email}</p>}
            </div>
            <div className="relative">
              <label className="block text-sm font-bold text-gray-800 mb-2" htmlFor="phone">Phone*</label>
              <input
                type="tel"
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
                className={`w-full rounded-xl border-2 px-4 py-3 text-gray-900 font-medium transition-all duration-200 focus:outline-none ${
                  populatedFields.has('phone') 
                    ? 'border-emerald-300 bg-gradient-to-r from-emerald-50 to-green-50 ring-2 ring-emerald-200/50 shadow-sm focus:border-emerald-400 focus:ring-emerald-300/50' 
                    : errors.phone 
                    ? 'border-red-300 bg-white focus:border-red-500 focus:ring-2 focus:ring-red-500/20 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-sm hover:shadow-sm'
                }`}
              />
              {populatedFields.has('phone') && (
                <div className="mt-2 flex items-center gap-2 text-emerald-700 text-xs font-medium">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                  <span>Extracted from documents</span>
                </div>
              )}
              {errors.phone && <p className="mt-1 text-sm text-red-600">{errors.phone}</p>}
            </div>
            <div className="relative">
              <label className="block text-sm font-bold text-gray-800 mb-2" htmlFor="address">Business Address</label>
              <input
                type="text"
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({...formData, address: e.target.value})}
                className={`w-full rounded-xl border-2 px-4 py-3 text-gray-900 font-medium transition-all duration-200 focus:outline-none ${
                  populatedFields.has('address') 
                    ? 'border-emerald-300 bg-gradient-to-r from-emerald-50 to-green-50 ring-2 ring-emerald-200/50 shadow-sm focus:border-emerald-400 focus:ring-emerald-300/50' 
                    : 'border-gray-200 bg-white hover:border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-sm hover:shadow-sm'
                }`}
              />
              {populatedFields.has('address') && (
                <div className="mt-2 flex items-center gap-2 text-emerald-700 text-xs font-medium">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                  <span>Extracted from documents</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Financial Information Section */}
        <div className="mb-8">
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-gradient-to-br from-green-100 to-emerald-100 rounded-xl shadow-sm border border-green-200">
                <DollarSign className="w-5 h-5 text-green-700" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">Financial Information</h3>
            </div>
            <p className="text-sm text-gray-600 ml-12">Annual revenue and financial metrics</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="relative">
                <label className="block text-sm font-bold text-gray-800 mb-2" htmlFor="annualRevenue">Annual Revenue</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <span className="text-gray-500 font-medium">$</span>
                  </div>
                  <input
                    type="number"
                    id="annualRevenue"
                    value={formData.annualRevenue}
                    onChange={(e) => setFormData({...formData, annualRevenue: e.target.value})}
                    className={`w-full pl-8 pr-4 py-3 rounded-xl border-2 text-gray-900 font-medium transition-all duration-200 focus:outline-none ${
                      populatedFields.has('annualRevenue') 
                        ? 'border-emerald-300 bg-gradient-to-r from-emerald-50 to-green-50 ring-2 ring-emerald-200/50 shadow-sm focus:border-emerald-400 focus:ring-emerald-300/50' 
                        : 'border-gray-200 bg-white hover:border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-sm hover:shadow-sm'
                    }`}
                  />
                </div>
                {populatedFields.has('annualRevenue') && (
                  <div className="mt-2 flex items-center gap-2 text-emerald-700 text-xs font-medium">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span>Extracted from documents</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        

        {/* Submit Button */}
        <div className="flex justify-end pt-8 mt-8 border-t border-gray-100">
          <button
            type="submit"
            className="inline-flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-lg shadow-lg transition-all duration-200 focus:outline-none focus:ring-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 hover:shadow-xl hover:scale-105 focus:ring-blue-500/40"
          >
            Submit Application
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>
      </form>
    </div>
    </div>
  );
};

export default ApplicationForm;