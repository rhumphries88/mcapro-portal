import React, { useState, useEffect, useMemo } from 'react';
import { Upload, FileText, DollarSign, Building2, User, CheckCircle, FileCheck, Loader, AlertTriangle } from 'lucide-react';
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

const ApplicationForm: React.FC<ApplicationFormProps> = ({ onSubmit }) => {
  const [currentStep, setCurrentStep] = useState<'upload' | 'form'>('upload');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState<Awaited<ReturnType<typeof extractDataFromPDF>> | null>(null);
  const [webhookData, setWebhookData] = useState<WebhookResponse | null>(null);
  const [webhookError, setWebhookError] = useState<string | null>(null);
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
  
  // Track the last values that were set by a webhook to detect user edits between webhook events
  const [lastWebhookValues, setLastWebhookValues] = useState<Record<string, string>>({});

  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [applicationDocument, setApplicationDocument] = useState<File | null>(null);

  // Manual mode: set to true when user clicks "Skip and fill form manually"
  const [manualMode, setManualMode] = useState(false);

  // Track which fields were auto-populated (used for green highlights and banner)
  const [autoFields, setAutoFields] = useState<Record<string, true>>({});

  // Only fields set automatically (webhook or extraction) should be highlighted
  const populatedFields = useMemo(() => {
    if (manualMode) return new Set<string>();
    return new Set<string>(Object.keys(autoFields));
  }, [manualMode, autoFields]);

  // Helpers for currency-like inputs: keep raw numeric in state, show formatted with commas
  const sanitizeNumeric = (input: string) => {
    // keep digits and a single dot
    const cleaned = input.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    const intPart = parts[0];
    const decPart = parts.slice(1).join(''); // collapse extra dots
    return decPart.length > 0 ? `${intPart}.${decPart}` : intPart;
  };
  const formatWithCommas = (raw: string) => {
    if (!raw) return '';
    const [i, d] = raw.split('.');
    const withCommas = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return d !== undefined ? `${withCommas}.${d}` : withCommas;
  };

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
            
            // Move to form step if we're still on upload
            if (currentStep === 'upload') {
              setCurrentStep('form');
            }
          }
        }
      } catch (error) {
        console.error('Error processing extracted response:', error);
        setWebhookError('Failed to process extracted data. Please fill the form manually.');
      }
    };

    // Add event listener for webhook responses
    window.addEventListener('message', handleWebhookResponse);
    
    // Clean up
    return () => {
      window.removeEventListener('message', handleWebhookResponse);
    };
  }, [currentStep, lastWebhookValues, industries, businessTypes, manualMode]);

  const extractDataFromDocument = async (file: File) => {
    setIsExtracting(true);
    
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
      // Mark auto-populated fields if not in manual mode
      if (!manualMode) {
        setAutoFields(prev => {
          const updated = { ...prev } as Record<string, true>;
          Object.keys(filtered).forEach(k => { updated[k] = true; });
          return updated;
        });
      }
      setCurrentStep('form');
    } catch (error) {
      console.error('Error extracting data from PDF:', error);
      alert('Error extracting data from PDF. Please fill the form manually.');
      setCurrentStep('form');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setApplicationDocument(file);
      await extractDataFromDocument(file);
    }
  };

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};
    
    // Required fields validation
    if (!formData.businessName) newErrors.businessName = 'Business name is required';
    if (!formData.ownerName) newErrors.ownerName = 'Owner name is required';
    
    // Email validation
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/^\S+@\S+\.\S+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    
    // Phone validation
    if (!formData.phone) {
      newErrors.phone = 'Phone is required';
    } else if (!/^[0-9\-()+ .]+$/.test(formData.phone)) {
      newErrors.phone = 'Please enter a valid phone number';
    }
    
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
    
    // Financial validations
    if (!formData.requestedAmount || Number(formData.requestedAmount) < 10000) {
      newErrors.requestedAmount = 'Requested amount must be at least $10,000';
    }
    
    if (!formData.averageMonthlyRevenue || Number(formData.averageMonthlyRevenue) < 10000) {
      newErrors.averageMonthlyRevenue = 'Monthly revenue must be at least $10,000';
    }
    
    if (!formData.creditScore) {
      newErrors.creditScore = 'Credit score is required';
    } else if (Number(formData.creditScore) < 300 || Number(formData.creditScore) > 850) {
      newErrors.creditScore = 'Credit score must be between 300-850';
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
          monthly_revenue: Number(formData.averageMonthlyRevenue),
          monthly_deposits: Number(formData.averageMonthlyDeposits),
          existing_debt: Number(formData.existingDebt),
          credit_score: Number(formData.creditScore),
          requested_amount: Number(formData.requestedAmount),
          status: 'submitted',
          documents: uploadedFiles
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
            averageMonthlyRevenue: savedApplication.monthly_revenue,
            averageMonthlyDeposits: savedApplication.monthly_deposits,
            existingDebt: savedApplication.existing_debt
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const fileNames = Array.from(files).map(file => file.name);
      setUploadedFiles(prev => [...prev, ...fileNames]);
    }
  };

  const removeFile = (fileName: string) => {
    setUploadedFiles(prev => prev.filter(file => file !== fileName));
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
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-12">
              <div className="text-center">
                <FileText className="w-16 h-16 text-gray-400 mx-auto mb-6" />
                <div className="text-lg font-medium text-gray-900 mb-2">
                  Upload Your Application Document
                </div>
                <p className="text-gray-600 mb-6">
                  Supported formats: PDF, DOC, DOCX. We'll automatically extract your business information.
                </p>
                <div className="text-sm text-gray-600">
                  <label htmlFor="document-upload" className="relative cursor-pointer bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500 transition-colors">
                    <span>Choose Application File</span>
                    <input 
                      id="document-upload" 
                      name="document-upload" 
                      type="file" 
                      className="sr-only" 
                      accept=".pdf,.doc,.docx"
                      onChange={handleDocumentUpload} 
                    />
                  </label>
                  <p className="mt-4 text-xs text-gray-500">
                    Maximum file size: 10MB
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <Loader className="w-12 h-12 text-blue-600 mx-auto mb-4 animate-spin" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Processing Your Document</h3>
              <p className="text-gray-600 mb-4">
                We're extracting information from your application document...
              </p>
              <div className="max-w-md mx-auto">
                <div className="bg-gray-200 rounded-full h-2">
                  <div className="bg-blue-600 h-2 rounded-full animate-pulse" style={{ width: '60%' }}></div>
                </div>
                <p className="text-sm text-gray-500 mt-2">This usually takes 30-60 seconds</p>
              </div>
              
              {/* Secondary waiting panel removed to keep a single loading UI */}
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-gray-200">
            <button
              onClick={() => {
                // Enter manual mode and bypass any extraction/webhook logic
                setManualMode(true);
                setCurrentStep('form');
                setExtractedData(null);
                setWebhookData(null);
                setWebhookError(null);
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
    <div className="bg-white rounded-xl shadow-lg">
      <div className="px-8 py-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Merchant Cash Advance Application</h2>
            <p className="text-gray-600 mt-1">
              {(extractedData || webhookData) ? 'Review and confirm the extracted information' : 'Please fill out all required information to get matched with qualified lenders'}
            </p>
          </div>
          {extractedData && (
            <div className="flex items-center text-green-600">
              <FileCheck className="w-5 h-5 mr-2" />
              <span className="text-sm font-medium">Data extracted from document</span>
            </div>
          )}
          {webhookError && (
            <div className="flex items-center text-red-600">
              <AlertTriangle className="w-5 h-5 mr-2" />
              <span className="text-sm font-medium">{webhookError}</span>
            </div>
          )}
        </div>
        {applicationDocument && (
          <div className="mt-3 p-3 bg-blue-50 rounded-lg">
            <div className="flex items-center">
              <FileText className="w-4 h-4 text-blue-600 mr-2" />
              <span className="text-sm text-blue-800 font-medium">Source Document: {applicationDocument.name}</span>
              <button
                onClick={() => {
                  setCurrentStep('upload');
                  setApplicationDocument(null);
                  setExtractedData(null);
                  setFormData({
                    businessName: '', ownerName: '', email: '', phone: '', address: '', ein: '',
                    businessType: '', industry: '', yearsInBusiness: '', numberOfEmployees: '',
                    annualRevenue: '', averageMonthlyRevenue: '', averageMonthlyDeposits: '',
                    existingDebt: '', creditScore: '', requestedAmount: '', documents: []
                  });
                }}
                className="ml-auto text-blue-600 hover:text-blue-800 text-sm"
              >
                Upload Different Document
              </button>
            </div>
          </div>
        )}
      </div>
      
      <form onSubmit={handleSubmit} className="p-8">
        
        {/* Webhook Data Summary - show when fields were populated */}
        {populatedFields.size > 0 && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center mb-2">
              <CheckCircle className="w-5 h-5 mr-2 text-green-600" />
              <h4 className="font-medium text-green-800">Data automatically populated</h4>
            </div>
            <p className="text-green-700 text-sm">
              {populatedFields.size} fields were automatically populated from extracted data.
              You can review and edit any information as needed.
            </p>
          </div>
        )}
        {/* Business Information Section */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Building2 className="w-5 h-5 mr-2 text-blue-600" />
            Business Information
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="businessName" className="block text-sm font-medium text-gray-700 mb-1">Business Name*</label>
              <input
                type="text"
                id="businessName"
                value={formData.businessName}
                onChange={(e) => setFormData({...formData, businessName: e.target.value})}
                className={`w-full px-4 py-2 border ${errors.businessName ? 'border-red-500' : 'border-gray-300'} rounded-lg focus:ring-blue-500 focus:border-blue-500 ${populatedFields.has('businessName') ? 'bg-green-50 border-green-300' : ''}`}
              />
              {populatedFields.has('businessName') && (
                <div className="flex items-center mt-1 text-xs text-green-600">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  <span>Auto-populated from extracted data</span>
                </div>
              )}
              {errors.businessName && <p className="mt-1 text-sm text-red-600">{errors.businessName}</p>}
            </div>
            <div>
              <label htmlFor="industry" className="block text-sm font-medium text-gray-700 mb-1">Industry*</label>
              <select
                id="industry"
                value={formData.industry}
                onChange={(e) => setFormData({...formData, industry: e.target.value})}
                className={`w-full px-4 py-2 border ${errors.industry ? 'border-red-500' : 'border-gray-300'} rounded-lg focus:ring-blue-500 focus:border-blue-500 ${populatedFields.has('industry') ? 'bg-green-50 border-green-300' : ''}`}
              >
                <option value="">Select Industry</option>
                {industries.map((industry) => (
                  <option key={industry} value={industry}>{industry}</option>
                ))}
              </select>
              {errors.industry && <p className="mt-1 text-sm text-red-600">{errors.industry}</p>}
            </div>
            <div>
              <label htmlFor="businessType" className="block text-sm font-medium text-gray-700 mb-1">Business Type*</label>
              <select
                id="businessType"
                value={formData.businessType}
                onChange={(e) => setFormData({...formData, businessType: e.target.value})}
                className={`w-full px-4 py-2 border ${errors.businessType ? 'border-red-500' : 'border-gray-300'} rounded-lg focus:ring-blue-500 focus:border-blue-500 ${populatedFields.has('businessType') ? 'bg-green-50 border-green-300' : ''}`}
              >
                <option value="">Select Business Type</option>
                {businessTypes.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              {errors.businessType && <p className="mt-1 text-sm text-red-600">{errors.businessType}</p>}
            </div>
            <div>
              <label htmlFor="ein" className="block text-sm font-medium text-gray-700 mb-1">EIN</label>
              <input
                type="text"
                id="ein"
                value={formData.ein}
                onChange={(e) => setFormData({...formData, ein: e.target.value})}
                className={`w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 ${populatedFields.has('ein') ? 'bg-green-50 border-green-300' : ''}`}
              />
              {populatedFields.has('ein') && (
                <div className="flex items-center mt-1 text-xs text-green-600">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  <span>Auto-populated from extracted data</span>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="yearsInBusiness" className="block text-sm font-medium text-gray-700 mb-1">Years in Business*</label>
              <input
                type="number"
                id="yearsInBusiness"
                value={formData.yearsInBusiness}
                onChange={(e) => setFormData({...formData, yearsInBusiness: e.target.value})}
                className={`w-full px-4 py-2 border ${errors.yearsInBusiness ? 'border-red-500' : 'border-gray-300'} rounded-lg focus:ring-blue-500 focus:border-blue-500 ${populatedFields.has('yearsInBusiness') ? 'bg-green-50 border-green-300' : ''}`}
              />
              {populatedFields.has('yearsInBusiness') && (
                <div className="flex items-center mt-1 text-xs text-green-600">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  <span>Auto-populated from extracted data</span>
                </div>
              )}
              {errors.yearsInBusiness && <p className="mt-1 text-sm text-red-600">{errors.yearsInBusiness}</p>}
            </div>
            <div>
              <label htmlFor="numberOfEmployees" className="block text-sm font-medium text-gray-700 mb-1">Number of Employees</label>
              <input
                type="number"
                id="numberOfEmployees"
                value={formData.numberOfEmployees}
                onChange={(e) => setFormData({...formData, numberOfEmployees: e.target.value})}
                className={`w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 ${populatedFields.has('numberOfEmployees') ? 'bg-green-50 border-green-300' : ''}`}
              />
              {populatedFields.has('numberOfEmployees') && (
                <div className="flex items-center mt-1 text-xs text-green-600">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  <span>Auto-populated from extracted data</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Contact Information Section */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <User className="w-5 h-5 mr-2 text-blue-600" />
            Contact Information
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="ownerName" className="block text-sm font-medium text-gray-700 mb-1">Owner Name*</label>
              <input
                type="text"
                id="ownerName"
                value={formData.ownerName}
                onChange={(e) => setFormData({...formData, ownerName: e.target.value})}
                className={`w-full px-4 py-2 border ${errors.ownerName ? 'border-red-500' : 'border-gray-300'} rounded-lg focus:ring-blue-500 focus:border-blue-500 ${populatedFields.has('ownerName') ? 'bg-green-50 border-green-300' : ''}`}
              />
              {populatedFields.has('ownerName') && (
                <div className="flex items-center mt-1 text-xs text-green-600">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  <span>Auto-populated from extracted data</span>
                </div>
              )}
              {errors.ownerName && <p className="mt-1 text-sm text-red-600">{errors.ownerName}</p>}
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email*</label>
              <input
                type="email"
                id="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                className={`w-full px-4 py-2 border ${errors.email ? 'border-red-500' : 'border-gray-300'} rounded-lg focus:ring-blue-500 focus:border-blue-500 ${populatedFields.has('email') ? 'bg-green-50 border-green-300' : ''}`}
              />
              {populatedFields.has('email') && (
                <div className="flex items-center mt-1 text-xs text-green-600">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  <span>Auto-populated from extracted data</span>
                </div>
              )}
              {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email}</p>}
            </div>
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">Phone*</label>
              <input
                type="tel"
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
                className={`w-full px-4 py-2 border ${errors.phone ? 'border-red-500' : 'border-gray-300'} rounded-lg focus:ring-blue-500 focus:border-blue-500 ${populatedFields.has('phone') ? 'bg-green-50 border-green-300' : ''}`}
              />
              {populatedFields.has('phone') && (
                <div className="flex items-center mt-1 text-xs text-green-600">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  <span>Auto-populated from extracted data</span>
                </div>
              )}
              {errors.phone && <p className="mt-1 text-sm text-red-600">{errors.phone}</p>}
            </div>
            <div>
              <label htmlFor="address" className="block text-sm font-medium text-gray-700 mb-1">Business Address</label>
              <input
                type="text"
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({...formData, address: e.target.value})}
                className={`w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 ${populatedFields.has('address') ? 'bg-green-50 border-green-300' : ''}`}
              />
              {populatedFields.has('address') && (
                <div className="flex items-center mt-1 text-xs text-green-600">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  <span>Auto-populated from extracted data</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Financial Information Section */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <DollarSign className="w-5 h-5 mr-2 text-blue-600" />
            Financial Information
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="annualRevenue" className="block text-sm font-medium text-gray-700 mb-1">Annual Revenue</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500">$</span>
                </div>
                <input
                  type="number"
                  id="annualRevenue"
                  value={formData.annualRevenue}
                  onChange={(e) => setFormData({...formData, annualRevenue: e.target.value})}
                  className={`w-full pl-8 px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 ${populatedFields.has('annualRevenue') ? 'bg-green-50 border-green-300' : ''}`}
                />
              </div>
              {populatedFields.has('annualRevenue') && (
                <div className="flex items-center mt-1 text-xs text-green-600">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  <span>Auto-populated from extracted data</span>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="averageMonthlyRevenue" className="block text-sm font-medium text-gray-700 mb-1">Average Monthly Revenue*</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500">$</span>
                </div>
                <input
                  type="text"
                  id="averageMonthlyRevenue"
                  value={formatWithCommas(formData.averageMonthlyRevenue)}
                  onChange={(e) => setFormData({
                    ...formData,
                    averageMonthlyRevenue: sanitizeNumeric(e.target.value)
                  })}
                  className={`w-full pl-8 px-4 py-2 border ${errors.averageMonthlyRevenue ? 'border-red-500' : 'border-gray-300'} rounded-lg focus:ring-blue-500 focus:border-blue-500 ${populatedFields.has('averageMonthlyRevenue') ? 'bg-green-50 border-green-300' : ''}`}
                  inputMode="decimal"
                />
              </div>
              {populatedFields.has('averageMonthlyRevenue') && (
                <div className="flex items-center mt-1 text-xs text-green-600">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  <span>Auto-populated from extracted data</span>
                </div>
              )}
              {errors.averageMonthlyRevenue && <p className="mt-1 text-sm text-red-600">{errors.averageMonthlyRevenue}</p>}
            </div>
            <div>
              <label htmlFor="averageMonthlyDeposits" className="block text-sm font-medium text-gray-700 mb-1">Average Monthly Deposits</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500">$</span>
                </div>
                <input
                  type="text"
                  id="averageMonthlyDeposits"
                  value={formatWithCommas(formData.averageMonthlyDeposits)}
                  onChange={(e) => setFormData({
                    ...formData,
                    averageMonthlyDeposits: sanitizeNumeric(e.target.value)
                  })}
                  className={`w-full pl-8 px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 ${populatedFields.has('averageMonthlyDeposits') ? 'bg-green-50 border-green-300' : ''}`}
                  inputMode="decimal"
                />
              </div>
              {populatedFields.has('averageMonthlyDeposits') && (
                <div className="flex items-center mt-1 text-xs text-green-600">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  <span>Auto-populated from extracted data</span>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="existingDebt" className="block text-sm font-medium text-gray-700 mb-1">Existing Business Debt</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500">$</span>
                </div>
                <input
                  type="text"
                  id="existingDebt"
                  value={formatWithCommas(formData.existingDebt)}
                  onChange={(e) => setFormData({
                    ...formData,
                    existingDebt: sanitizeNumeric(e.target.value)
                  })}
                  className={`w-full pl-8 px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 ${populatedFields.has('existingDebt') ? 'bg-green-50 border-green-300' : ''}`}
                  inputMode="decimal"
                />
              </div>
              {populatedFields.has('existingDebt') && (
                <div className="flex items-center mt-1 text-xs text-green-600">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  <span>Auto-populated from extracted data</span>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="creditScore" className="block text-sm font-medium text-gray-700 mb-1">Credit Score*</label>
              <input
                type="number"
                id="creditScore"
                value={formData.creditScore}
                onChange={(e) => setFormData({...formData, creditScore: e.target.value})}
                className={`w-full px-4 py-2 border ${errors.creditScore ? 'border-red-500' : 'border-gray-300'} rounded-lg focus:ring-blue-500 focus:border-blue-500 ${populatedFields.has('creditScore') ? 'bg-green-50 border-green-300' : ''}`}
                min="300"
                max="850"
              />
              {populatedFields.has('creditScore') && (
                <div className="flex items-center mt-1 text-xs text-green-600">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  <span>Auto-populated from extracted data</span>
                </div>
              )}
              {errors.creditScore && <p className="mt-1 text-sm text-red-600">{errors.creditScore}</p>}
            </div>
            <div>
              <label htmlFor="requestedAmount" className="block text-sm font-medium text-gray-700 mb-1">Requested Amount*</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500">$</span>
                </div>
                <input
                  type="number"
                  id="requestedAmount"
                  value={formData.requestedAmount}
                  onChange={(e) => setFormData({...formData, requestedAmount: e.target.value})}
                  className={`w-full pl-8 px-4 py-2 border ${errors.requestedAmount ? 'border-red-500' : 'border-gray-300'} rounded-lg focus:ring-blue-500 focus:border-blue-500 ${populatedFields.has('requestedAmount') ? 'bg-green-50 border-green-300' : ''}`}
                  min="10000"
                />
              </div>
              {populatedFields.has('requestedAmount') && (
                <div className="flex items-center mt-1 text-xs text-green-600">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  <span>Auto-populated from extracted data</span>
                </div>
              )}
              {errors.requestedAmount && <p className="mt-1 text-sm text-red-600">{errors.requestedAmount}</p>}
            </div>
          </div>
        </div>

        {/* Additional Documents */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Upload className="w-5 h-5 mr-2 text-blue-600" />
            Additional Documents
          </h3>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
            <div className="text-center">
              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <div className="text-sm text-gray-600 mb-2">
                Upload additional supporting documents (bank statements, tax returns, etc.)
              </div>
              <label htmlFor="file-upload" className="relative cursor-pointer bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500 transition-colors">
                <span>Choose Files</span>
                <input 
                  id="file-upload" 
                  name="file-upload" 
                  type="file" 
                  className="sr-only" 
                  multiple
                  onChange={handleFileUpload} 
                />
              </label>
            </div>
            
            {uploadedFiles.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Uploaded Files:</h4>
                <div className="space-y-2">
                  {uploadedFiles.map((fileName, index) => (
                    <div key={index} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded">
                      <div className="flex items-center">
                        <FileText className="w-4 h-4 text-gray-500 mr-2" />
                        <span className="text-sm text-gray-700">{fileName}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(fileName)}
                        className="text-red-500 hover:text-red-700 text-sm"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex justify-end pt-6 border-t border-gray-200">
          <button
            type="submit"
            className="bg-blue-600 text-white px-8 py-3 rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
          >
            Submit Application
          </button>
        </div>
      </form>
    </div>
  );
};

export default ApplicationForm;