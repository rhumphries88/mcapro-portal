import React, { useState } from 'react';
import { ArrowLeft, Send, Settings, CheckCircle, FileText, Loader, Eye, EyeOff, Server, Hash, AtSign, KeyRound, ShieldCheck } from 'lucide-react';
import { getLenders, createLenderSubmissions, Lender as DBLender, getApplicationDocuments, type ApplicationDocument, qualifyLenders, type Application as DBApplication, ApplicationMTD, getApplicationMTDByApplicationId, getApplicationFormByApplicationId, type ApplicationFormRow, getApplicationAdditionalByApplicationId, type ApplicationAdditionalRow } from '../lib/supabase';
import type { CleanedMatch } from '../lib/parseLenderMatches';

interface Application {
  id: string;
  businessName: string;
  monthlyRevenue: number;
  timeInBusiness: number;
  creditScore: number;
  industry: string;
  requestedAmount: number;
  status: 'draft' | 'submitted' | 'under-review' | 'matched';
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

type EmailSettings = {
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  fromEmail: string;
};

interface SubmissionRecapProps {
  application: Application | null;
  selectedLenderIds: string[];
  matches?: CleanedMatch[];
  onBack: () => void;
  onSubmit: () => void;
}

const SubmissionRecap: React.FC<SubmissionRecapProps> = ({ 
  application, 
  selectedLenderIds, 
  matches,
  onBack, 
  onSubmit 
}) => {
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [emailSettings, setEmailSettings] = useState<EmailSettings>(() => {
    // Load saved SMTP settings from localStorage
    const savedSettings = localStorage.getItem('mcaPortalSmtpSettings');
    const defaultSettings: EmailSettings = {
      smtpHost: '',
      smtpPort: '',
      smtpUser: '',
      smtpPassword: '',
      // Always start with empty fromEmail
      fromEmail: ''
    };
    
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        return {
          ...parsed,
          // Always use empty fromEmail and smtpUser
          fromEmail: '',
          smtpUser: ''
        };
      } catch (error) {
        console.error('Error parsing saved SMTP settings:', error);
        return defaultSettings;
      }
    }
    
    return defaultSettings;
  });
  const [showEmailSettings, setShowEmailSettings] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendingProgress, setSendingProgress] = useState(0);
  const [submissionComplete, setSubmissionComplete] = useState(false);
  const [selectedLenderForDetails, setSelectedLenderForDetails] = useState<DBLender | null>(null);
  const [lenders, setLenders] = useState<(DBLender & { match_score?: number; matchScore?: number })[]>([]);
  const [iframeHeight, setIframeHeight] = useState<number>(800);
  // Application documents (from Supabase)
  const [appDocs, setAppDocs] = useState<ApplicationDocument[]>([]);
  const [appDocsLoading, setAppDocsLoading] = useState<boolean>(false);
  // Additional documents (from Supabase)
  const [additionalDocs, setAdditionalDocs] = useState<ApplicationAdditionalRow[]>([]);
  const [additionalDocsLoading, setAdditionalDocsLoading] = useState<boolean>(false);
  // MTD documents (from Supabase)
  const [mtdDocs, setMtdDocs] = useState<ApplicationMTD[]>([]);
  const [mtdDocsLoading, setMtdDocsLoading] = useState<boolean>(false);
  // Exclude list for documents (persisted per application)
  const [excludedDocs, setExcludedDocs] = useState<Set<string>>(() => new Set());
  // UI: show/hide password in Email Settings
  const [showPassword, setShowPassword] = useState<boolean>(false);
  // UI: simple validation state for SMTP form
  const [smtpErrors, setSmtpErrors] = useState<{ host?: string; port?: string; user?: string; password?: string; fromEmail?: string }>({});
  const [smtpSettingsId, setSmtpSettingsId] = useState<string | null>(null);
  // Feature flag: temporarily hide Email Configuration card from UI
  const SHOW_EMAIL_CONFIG = false;

  const applyPreset = (preset: 'gmail_tls' | 'gmail_ssl' | 'outlook_tls') => {
    if (preset === 'gmail_tls') {
      setEmailSettings(prev => ({ ...prev, smtpHost: 'smtp.gmail.com', smtpPort: '587' }));
    } else if (preset === 'gmail_ssl') {
      setEmailSettings(prev => ({ ...prev, smtpHost: 'smtp.gmail.com', smtpPort: '465' }));
    } else if (preset === 'outlook_tls') {
      setEmailSettings(prev => ({ ...prev, smtpHost: 'smtp.office365.com', smtpPort: '587' }));
    }
  };
  
  // Simple validation for SMTP settings
  const validateSmtp = () => {
    const errors: { host?: string; port?: string; user?: string; password?: string; fromEmail?: string } = {};
    if (!emailSettings.smtpHost) errors.host = 'SMTP Host is required';
    if (!emailSettings.smtpPort) errors.port = 'SMTP Port is required';
    if (!emailSettings.smtpUser) errors.user = 'Username is required.';
    if (!emailSettings.smtpPassword) errors.password = 'Password is required.';
    if (!emailSettings.fromEmail) errors.fromEmail = 'From Email is required.';
    setSmtpErrors(errors);
    return Object.keys(errors).length === 0;
  };
  // Load lenders from Supabase
  React.useEffect(() => {
    const loadLenders = async () => {
      try {
        const dbLenders = await getLenders();
        // If we have an application, compute match scores like in LenderMatches
        if (application) {
          const allowedStatus: DBApplication['status'][] = ['draft', 'submitted', 'under-review', 'approved', 'funded', 'declined'];
          const status: DBApplication['status'] = allowedStatus.includes((application.status as DBApplication['status']))
            ? (application.status as DBApplication['status'])
            : 'draft';
          const dbApplication: DBApplication = {
            id: application.id,
            business_name: application.businessName,
            owner_name: application.contactInfo.ownerName,
            email: emailSettings.fromEmail || '',
            phone: application.contactInfo.phone,
            address: application.contactInfo.address,
            ein: application.businessInfo.ein,
            business_type: application.businessInfo.businessType,
            industry: application.industry,
            years_in_business: application.timeInBusiness,
            number_of_employees: application.businessInfo.numberOfEmployees,
            annual_revenue: application.financialInfo.annualRevenue,
            monthly_revenue: application.monthlyRevenue,
            monthly_deposits: application.financialInfo.averageMonthlyDeposits,
            existing_debt: application.financialInfo.existingDebt,
            credit_score: application.creditScore,
            requested_amount: application.requestedAmount,
            status,
            documents: application.documents,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          const qualified = qualifyLenders(dbLenders, dbApplication);
          // If we have matches data, use the actual match scores from LenderMatches
          if (Array.isArray(matches) && matches.length > 0) {
            const byId = new Map(qualified.map(l => [l.id, l] as const));
            const orderedWithScores: (DBLender & { match_score?: number; matchScore?: number })[] = [];
            for (const m of matches) {
              const found = byId.get(m.lender_id);
              if (found) orderedWithScores.push({ ...found, match_score: m.match_score });
            }
            setLenders(orderedWithScores);
          } else {
            setLenders(qualified);
          }
        } else {
          setLenders(dbLenders);
        }
      } catch (error) {
        console.error('Error loading lenders:', error);
      }
    };
    loadLenders();
  }, [application, emailSettings.fromEmail, matches]);

  // Load application documents from Supabase for this application
  React.useEffect(() => {
    const loadDocs = async () => {
      if (!application?.id) {
        setAppDocs([]);
        return;
      }
      try {
        setAppDocsLoading(true);
        const docs = await getApplicationDocuments(application.id);
        setAppDocs(docs || []);
      } catch (e) {
        console.warn('Failed to load application_documents for recap:', e);
        setAppDocs([]);
      } finally {
        setAppDocsLoading(false);
      }
    };
    loadDocs();
  }, [application?.id]);

  // Load Additional documents from Supabase for this application
  React.useEffect(() => {
    const loadAdditional = async () => {
      if (!application?.id) {
        setAdditionalDocs([]);
        return;
      }
      try {
        setAdditionalDocsLoading(true);
        const docs = await getApplicationAdditionalByApplicationId(application.id);
        setAdditionalDocs(docs || []);
      } catch (e) {
        console.warn('Failed to load application_additional for recap:', e);
        setAdditionalDocs([]);
      } finally {
        setAdditionalDocsLoading(false);
      }
    };
    loadAdditional();
  }, [application?.id]);

  // Load/save excluded docs per application id
  React.useEffect(() => {
    const key = application?.id ? `recap_excluded_docs_${application.id}` : null;
    if (!key) { setExcludedDocs(new Set()); return; }
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const arr: string[] = JSON.parse(raw);
        setExcludedDocs(new Set(arr));
      } else {
        setExcludedDocs(new Set());
      }
    } catch { setExcludedDocs(new Set()); }
  }, [application?.id]);

  React.useEffect(() => {
    const key = application?.id ? `recap_excluded_docs_${application.id}` : null;
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(Array.from(excludedDocs)));
    } catch { /* ignore */ }
  }, [excludedDocs, application?.id]);

  const keyForInline = (name: string) => `inline:${name}`;
  const keyForAppDoc = (doc: ApplicationDocument) => `app:${doc.id}`;
  const keyForAdditionalDoc = (doc: ApplicationAdditionalRow) => `add:${doc.id}`;
  const keyForMtdDoc = (doc: ApplicationMTD) => `mtd:${doc.id}`;
  const isExcluded = (key: string) => excludedDocs.has(key);
  const excludeKey = (key: string) => setExcludedDocs(prev => new Set(prev).add(key));
  const includeKey = (key: string) => {
    setExcludedDocs(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  // Derived lists for rendering and counts (declared after inlineDocs memo below)

  // Load MTD documents from Supabase for this application
  React.useEffect(() => {
    const loadMtdDocs = async () => {
      if (!application?.id) {
        setMtdDocs([]);
        return;
      }
      try {
        setMtdDocsLoading(true);
        console.log('Loading MTD docs for application ID:', application.id);
        const docs = await getApplicationMTDByApplicationId(application.id);
        console.log('MTD docs loaded:', docs);
        console.log('MTD docs count:', docs?.length || 0);
        setMtdDocs(docs || []);
      } catch (e) {
        console.error('Failed to load application_mtd for recap:', e);
        setMtdDocs([]);
      } finally {
        setMtdDocsLoading(false);
      }
    };
    loadMtdDocs();
  }, [application?.id]);

  // Application form files stored on the application row (text[])
  const inlineDocs: string[] = React.useMemo(() => {
    return Array.isArray(application?.documents) ? (application!.documents as string[]) : [];
  }, [application]);
  
  // Derived lists for rendering and counts (now that inlineDocs is defined)
  const includedInline = inlineDocs.filter((name: string) => !isExcluded(keyForInline(name)));
  const includedAppDocs = appDocs.filter((d: ApplicationDocument) => !isExcluded(keyForAppDoc(d)));
  const includedAdditionalDocs = additionalDocs.filter((d: ApplicationAdditionalRow) => !isExcluded(keyForAdditionalDoc(d)));
  const includedMtdDocs = mtdDocs.filter((d: ApplicationMTD) => !isExcluded(keyForMtdDoc(d)));
  const excludedInline = inlineDocs.filter((name: string) => isExcluded(keyForInline(name)));
  const excludedApp = appDocs.filter((d: ApplicationDocument) => isExcluded(keyForAppDoc(d)));
  const excludedAdditional = additionalDocs.filter((d: ApplicationAdditionalRow) => isExcluded(keyForAdditionalDoc(d)));
  const excludedMtd = mtdDocs.filter((d: ApplicationMTD) => isExcluded(keyForMtdDoc(d)));

  const selectedLenders = lenders.filter(lender => selectedLenderIds.includes(lender.id));
  
  // Debug useEffect to log document counts
  React.useEffect(() => {
    console.log('Document counts:', { 
      appDocs: appDocs?.length || 0, 
      additionalDocs: additionalDocs?.length || 0,
      inlineDocs: inlineDocs?.length || 0, 
      mtdDocs: mtdDocs?.length || 0,
      mtdDocsData: mtdDocs
    });
  }, [appDocs, additionalDocs, inlineDocs, mtdDocs]);

  const generateEmailContent = (lender: DBLender) => {
    if (!application) return '';

    // Get saved email template from localStorage
    const savedTemplate = localStorage.getItem('mcaPortalEmailTemplate');
    const defaultTemplate = `Subject: Merchant Cash Advance Application - {{businessName}}

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Merchant Cash Advance Application</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f8f9fa; }
        .container { max-width: 700px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 28px; font-weight: 700; }
        .header p { margin: 10px 0 0; font-size: 16px; opacity: 0.9; }
        .content { padding: 40px; }
        .section { margin-bottom: 35px; }
        .section h2 { color: #10b981; font-size: 20px; margin-bottom: 20px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
        .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 25px; }
        .info-card { background: #f8fafc; padding: 20px; border-radius: 8px; border-left: 4px solid #10b981; }
        .info-card h3 { margin: 0 0 10px; color: #374151; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
        .info-card p { margin: 0; font-size: 16px; font-weight: 600; color: #111827; }
        .highlight-box { background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); padding: 25px; border-radius: 10px; border: 1px solid #10b981; margin: 25px 0; }
        .highlight-box h3 { color: #065f46; margin: 0 0 15px; font-size: 18px; }
        .criteria-list { list-style: none; padding: 0; margin: 15px 0; }
        .criteria-list li { padding: 8px 0; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; }
        .criteria-list li:last-child { border-bottom: none; }
        .criteria-list .label { font-weight: 600; color: #374151; }
        .criteria-list .value { color: #10b981; font-weight: 700; }
        .documents { background: #fef3c7; padding: 20px; border-radius: 8px; border-left: 4px solid #f59e0b; }
        .documents h3 { color: #92400e; margin: 0 0 15px; }
        .doc-list { list-style: none; padding: 0; margin: 0; }
        .doc-list li { padding: 5px 0; color: #78350f; }
        .doc-list li:before { content: "📄"; margin-right: 8px; }
        .footer { background: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb; }
        .footer p { margin: 5px 0; color: #6b7280; }
        .contact-info { background: #eff6ff; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .contact-info h3 { color: #1e40af; margin: 0 0 15px; }
        .contact-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
        .contact-item { display: flex; align-items: center; }
        .contact-item .icon { margin-right: 10px; font-size: 16px; }
        .app-id { font-family: 'Courier New', monospace; background: #f3f4f6; padding: 8px 12px; border-radius: 6px; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Merchant Cash Advance Application</h1>
            <p>Professional Business Funding Request</p>
        </div>
        
        <div class="content">
            <p style="font-size: 16px; margin-bottom: 30px;">Dear <strong>{{lenderName}} Team</strong>,</p>
            
            <p style="margin-bottom: 30px;">I hope this email finds you well. I am writing to submit a merchant cash advance application for your review and consideration. Below you'll find comprehensive details about our business and funding requirements.</p>
            
            <div class="section">
                <h2>📊 Business Overview</h2>
                <div class="info-grid">
                    <div class="info-card">
                        <h3>Business Name</h3>
                        <p>{{businessName}}</p>
                    </div>
                    <div class="info-card">
                        <h3>Industry</h3>
                        <p>{{industry}}</p>
                    </div>
                    <div class="info-card">
                        <h3>Business Owner</h3>
                        <p>{{ownerName}}</p>
                    </div>
                    <div class="info-card">
                        <h3>Years in Business</h3>
                        <p>{{yearsInBusiness}} years</p>
                    </div>
                    <div class="info-card">
                        <h3>Business Type</h3>
                        <p>{{businessType}}</p>
                    </div>
                    <div class="info-card">
                        <h3>EIN</h3>
                        <p>{{ein}}</p>
                    </div>
                </div>
            </div>

            

            <div class="documents">
                <h3>📋 Attached Documents</h3>
                <ul class="doc-list">
                    <li>Business bank statements (last 6 months)</li>
                    <li>Tax returns</li>
                    <li>Completed application form</li>
                    <li>Voided business check</li>
                </ul>
            </div>

            <div class="highlight-box">
                <h3>🎯 Lending Criteria Alignment</h3>
                <p style="margin-bottom: 20px;">Based on your underwriting guidelines, I believe this application aligns well with your lending criteria:</p>
                <ul class="criteria-list">
                    <li>
                        <span class="label">Amount Range:</span>
                        <span class="value">$ {{lenderMinAmount}} - $ {{lenderMaxAmount}}</span>
                    </li>
                    <li>
                        <span class="label">Factor Rate:</span>
                        <span class="value">{{lenderFactorRate}}</span>
                    </li>
                    <li>
                        <span class="label">Payback Term:</span>
                        <span class="value">{{lenderPaybackTerm}}</span>
                    </li>
                    <li>
                        <span class="label">Approval Time:</span>
                        <span class="value">{{lenderApprovalTime}}</span>
                    </li>
                </ul>
            </div>

            <p style="margin: 30px 0;">I would appreciate the opportunity to discuss this application further and answer any questions you may have. Please let me know if you need any additional information or documentation.</p>
            
            <p style="margin-bottom: 30px;">Thank you for your time and consideration. I look forward to hearing from you soon.</p>
            
            <p style="margin-bottom: 10px;"><strong>Best regards,</strong></p>
            <p style="margin: 0;"><strong>{{ownerName}}</strong><br>
            {{businessName}}<br>
            {{email}} | {{phone}}</p>
        </div>
        
        <div class="footer">
            <p><strong>This application was submitted through MCAPortal Pro</strong></p>
            <p>Application ID: <span class="app-id">{{applicationId}}</span></p>
        </div>
    </div>
</body>
</html>`;

    // Prefer saved template only if it includes key sections; else fall back to default
    const hasKeySections = (tpl: string | null) =>
      !!tpl && tpl.includes('<div class="contact-info">') && tpl.includes('<div class="documents">') && tpl.includes('criteria-list');
    let template = hasKeySections(savedTemplate) ? (savedTemplate as string) : defaultTemplate;

    // Build dynamic documents list combining application_documents (appDocs), application_additional (additionalDocs), MTD (mtdDocs), and inline application documents (application.documents)
    const dbDocs = (Array.isArray(appDocs) ? appDocs : []).filter(d => !isExcluded(keyForAppDoc(d)));
    const addDocs = (Array.isArray(additionalDocs) ? additionalDocs : []).filter(d => !isExcluded(keyForAdditionalDoc(d)));
    const mtdDbDocs = (Array.isArray(mtdDocs) ? mtdDocs : []).filter(d => !isExcluded(keyForMtdDoc(d)));
    const inlineDocsList: string[] = (Array.isArray(inlineDocs) ? inlineDocs : []).filter(n => !isExcluded(keyForInline(n)));
    // Merge filenames: prefer explicit file_name from dbDocs and mtdDocs, and also include inline doc names
    const mergedNames: string[] = [
      ...dbDocs.map(doc => doc.file_name),
      ...addDocs.map(doc => doc.file_name),
      ...mtdDbDocs.map(doc => doc.file_name),
      ...inlineDocsList
    ];
    // Deduplicate while preserving order
    const seen = new Set<string>();
    const uniqueNames = mergedNames.filter(name => {
      const k = name.trim();
      if (!k || seen.has(k.toLowerCase())) return false;
      seen.add(k.toLowerCase());
      return true;
    });
    if (uniqueNames.length > 0) {
      const escapeHtml = (s: string) => s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
      const items = uniqueNames
        .map(name => `<li>${escapeHtml(name)}</li>`) 
        .join('\n');
      // Replace the default placeholder list with real documents
      template = template.replace(
        /<ul class="doc-list">[\s\S]*?<\/ul>/,
        `<ul class="doc-list">\n${items}\n</ul>`
      );

      // Add a download-all ZIP link right after the documents section
      const downloadUrl = `${window.location.origin}/.netlify/functions/application-docs-zip?applicationId=${application.id}`;
      const zipCtaHtml = `\n<div class="download-zip" style="margin-top:16px; text-align:center;">\n  <a href="${downloadUrl}" style="display:inline-block; background:#10b981; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none; font-weight:600;">\n    Download all documents (ZIP)\n  </a>\n</div>`;
      template = template.replace(
        /(<div class="documents">[\s\S]*?<\/div>)/,
        `$1${zipCtaHtml}`
      );
    }

    // Replace template variables with actual data
    // Remove signature contact line (email | phone), but keep owner and business lines
    template = template.replace(/\s*<br>\s*\{\{email\}\}\s*\|\s*\{\{phone\}\}\s*/g, '');

    return template
      .replace(/\{\{businessName\}\}/g, application.businessName)
      .replace(/\{\{ownerName\}\}/g, application.contactInfo.ownerName)
      .replace(/\{\{industry\}\}/g, application.industry)
      .replace(/\{\{yearsInBusiness\}\}/g, application.timeInBusiness.toString())
      .replace(/\{\{businessType\}\}/g, application.businessInfo.businessType)
      .replace(/\{\{ein\}\}/g, application.businessInfo.ein)
      .replace(/\{\{requestedAmount\}\}/g, application.requestedAmount.toLocaleString())
      .replace(/\{\{monthlyRevenue\}\}/g, application.monthlyRevenue.toLocaleString())
      .replace(/\{\{annualRevenue\}\}/g, application.financialInfo.annualRevenue.toLocaleString())
      .replace(/\{\{creditScore\}\}/g, application.creditScore.toString())
      .replace(/\{\{existingDebt\}\}/g, application.financialInfo.existingDebt.toLocaleString())
      .replace(/\{\{email\}\}/g, emailSettings.fromEmail || 'Not provided')
      .replace(/\{\{phone\}\}/g, application.contactInfo.phone)
      .replace(/\{\{address\}\}/g, application.contactInfo.address)
      .replace(/\{\{lenderName\}\}/g, lender.name)
      .replace(/\{\{lenderMinAmount\}\}/g, lender.min_amount.toLocaleString())
      .replace(/\{\{lenderMaxAmount\}\}/g, lender.max_amount.toLocaleString())
      .replace(/\{\{lenderFactorRate\}\}/g, lender.factor_rate)
      .replace(/\{\{lenderPaybackTerm\}\}/g, lender.payback_term)
      .replace(/\{\{lenderApprovalTime\}\}/g, lender.approval_time)
      .replace(/\{\{applicationId\}\}/g, application.id);
  };

  // Build a structured email payload (subject/body) for a lender using the same preview content
  const buildEmailPayloadForLender = (lender: DBLender) => {
    const full = generateEmailContent(lender);
    // Default subject if not present in template
    let subject = `Merchant Cash Advance Application - ${application?.businessName ?? ''}`.trim();
    let body = full;
    // If the template includes a leading "Subject:" line, split it out
    const m = full.match(/^Subject:\s*(.+)\s*\n([\s\S]*)$/i);
    if (m) {
      subject = m[1].trim();
      body = m[2].trim();
    }
    return {
      subject,
      body,
      from: emailSettings.fromEmail ? emailSettings.fromEmail.trim() : '',
      to: (lender.contact_email || '').trim(),
    };
  };

  // Fire-and-forget webhook for auditing/forwarding the application payload externally
  const sendApplicationToWebhook = async (payload: unknown) => {
    const webhookUrl = '/.netlify/functions/send-application';
    try {
      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        console.warn('send-application webhook non-OK status:', resp.status, await resp.text());
      }
    } catch (err) {
      console.warn('Failed to post to send-application webhook:', err);
    }
  };

  const saveSmtpSettings = (settings: typeof emailSettings) => {
    try {
      // Save SMTP settings to localStorage (excluding password, username, and fromEmail)
      const settingsToSave = {
        smtpHost: settings.smtpHost,
        smtpPort: settings.smtpPort,
        // Don't save username - it should be entered fresh each time
        smtpUser: '',
        // Don't save password for security reasons
        smtpPassword: '',
        // Don't save fromEmail - it should be entered fresh each time
        fromEmail: ''
      };
      localStorage.setItem('mcaPortalSmtpSettings', JSON.stringify(settingsToSave));
      
      // Remove any previously saved fromEmail
      localStorage.removeItem('mcaPortalFromEmail');
    } catch (error) {
      console.error('Error saving SMTP settings:', error);
    }
  };

  // Save SMTP settings via our backend to avoid RLS/client-side permission issues
  const saveSmtpSettingsBackend = async (appId: string, settings: EmailSettings): Promise<string | null> => {
    if (!appId) return null;
    try {
      const resp = await fetch('/.netlify/functions/save-smtp-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicationId: appId,
          smtp: {
            host: settings.smtpHost,
            port: settings.smtpPort,
            username: settings.smtpUser || '',
            password: settings.smtpPassword,
            fromEmail: settings.fromEmail || '',
          }
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        console.warn('Failed to save SMTP settings (backend):', resp.status, text);
        return null;
      }
      const json = await resp.json().catch(() => null);
      const id = json?.data?.id ?? null;
      return id;
    } catch (e) {
      console.warn('Failed to reach SMTP settings backend:', e);
      return null;
    }
  };

  const sendSmtpToWebhook = async (settings: EmailSettings) => {
    const webhookUrl = '/.netlify/functions/smtp';
    const payload = {
      applicationId: application?.id ?? null,
      smtp: {
        host: settings.smtpHost,
        port: settings.smtpPort,
        user: settings.smtpUser,
        password: settings.smtpPassword,
        fromEmail: settings.fromEmail || '',
      },
      context: {
        businessName: application?.businessName ?? null,
        applicantEmail: emailSettings.fromEmail || null,
      },
      sentAt: new Date().toISOString(),
    };
    try {
      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        console.warn('SMTP webhook non-OK status:', resp.status, resp.statusText);
      }
    } catch (err) {
      console.warn('Failed to send SMTP settings to webhook:', err);
    }
  };

  const handleFinalSubmit = async () => {
    // Proceed even if from email is not specified

    setIsSubmitting(true);
    setSendingProgress(0);
    // Simulate progress while processing
    const progressTimer = setInterval(() => {
      setSendingProgress(prev => {
        if (prev >= 90) return prev; // stop at 90% until completion
        return Math.min(90, prev + Math.random() * 12);
      });
    }, 200);
    
    // Save SMTP settings for future use
    saveSmtpSettings(emailSettings);
    // Ensure server-side smtp_settings row exists for this application when SMTP is complete
    let savedSmtpId: string | null = null;
    const hasSmtp = Boolean(
      emailSettings.smtpHost && emailSettings.smtpPort && emailSettings.smtpUser && emailSettings.smtpPassword
    );
    if (application?.id && hasSmtp) {
      savedSmtpId = await saveSmtpSettingsBackend(application.id, {
        ...emailSettings,
        fromEmail: emailSettings.fromEmail,
      });
      if (savedSmtpId) setSmtpSettingsId(savedSmtpId);
    }
    
    try {
      // Create lender submissions in database
      if (application) {
        await createLenderSubmissions(application.id, selectedLenderIds);
      }
      
      // Build lender emails array including cc_emails per lender
      const splitEmails = (raw?: unknown): string[] => {
        if (!raw) return [];
        const parse = (val: string) => val
          .split(/[;,]/)
          .map(e => e.trim())
          .filter(e => e.length > 0);
        if (Array.isArray(raw)) {
          return raw.flatMap(v => parse(String(v)));
        }
        if (typeof raw === 'string') {
          return parse(raw);
        }
        return [];
      };
      const dedupe = (arr: string[]) => Array.from(new Set(arr.map(e => e.toLowerCase()))).map(lower => arr.find(e => e.toLowerCase() === lower) as string);

      const primaryEmails = selectedLenders
        .map(l => (l.contact_email || '').trim())
        .filter(e => e.length > 0);
      const ccEmailsAll = selectedLenders.flatMap(l => {
        const ccRaw = (l as { cc_emails?: string | string[] | null }).cc_emails ?? null;
        return splitEmails(ccRaw);
      });
      const toEmails = dedupe(primaryEmails);
      // ccEmails should not duplicate any primary email
      const ccEmails = dedupe(ccEmailsAll.filter(e => !toEmails.map(x => x.toLowerCase()).includes(e.toLowerCase())));
      // Back-compat combined list
      const lenderEmails = dedupe([...toEmails, ...ccEmails]);

      // Keep lenderIds as unique primary lender IDs
      const lenderIds = Array.from(new Set(selectedLenders.map(l => l.id)));

      // lendersDetailed includes primary + cc entries, cc rows reuse the same lender id
      const lendersDetailed = selectedLenders.flatMap(l => {
        const items: { id: string; email: string; role?: 'to' | 'cc' }[] = [];
        const primary = (l.contact_email || '').trim();
        if (primary) items.push({ id: l.id, email: primary, role: 'to' });
        const ccs = (() => {
          const ccRaw = (l as { cc_emails?: string | string[] | null }).cc_emails ?? null;
          return splitEmails(ccRaw);
        })();
        for (const cc of ccs) items.push({ id: l.id, email: cc, role: 'cc' });
        return items;
      });

      // Subject/body from preview builder (use first lender for subject parsing, fall back to generic)
      const preview = selectedLenders[0] ? buildEmailPayloadForLender(selectedLenders[0]) : {
        subject: `Merchant Cash Advance Application - ${application?.businessName ?? ''}`.trim(),
        body: '',
        from: application?.contactInfo?.email || ''
      };

      // Extract HTML body from email content (skip subject line)
      const extractHtmlBody = (emailContent: string) => {
        const parts = emailContent.split('\n\n');
        return parts.length > 1 ? parts.slice(1).join('\n\n') : emailContent;
      };

      // Collect application documents as attachments when URLs are available (includes application_documents, application_additional, application_form, and application_mtd)
      let attachmentsUrl: { filename: string; url: string }[] = [];
      try {
        if (application?.id) {
          const docs: ApplicationDocument[] = await getApplicationDocuments(application.id);
          // Build a normalized filename=>url map to help resolve URLs for MTD rows without file_url
          const normalize = (s: string) => s
            .toLowerCase()
            .replace(/%20/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\.pdf$/i, '')
            .trim();
          const docUrlByName: Record<string, string> = {};
          (docs || []).forEach(d => {
            if (d.file_name && d.file_url) {
              docUrlByName[normalize(d.file_name)] = String(d.file_url);
            }
          });
          attachmentsUrl = (docs || [])
            .filter((d) => Boolean(d.file_url) && !isExcluded(keyForAppDoc(d)))
            .map((d) => ({ filename: d.file_name, url: d.file_url as string }));
          // Include application_additional documents
          try {
            const addDocs: ApplicationAdditionalRow[] = await getApplicationAdditionalByApplicationId(application.id);
            const addAttachments = (addDocs || [])
              .filter((d) => Boolean(d.file_url) && !isExcluded(keyForAdditionalDoc(d)))
              .map((d) => ({ filename: d.file_name || 'Additional Document', url: String(d.file_url) }));
            attachmentsUrl = [...attachmentsUrl, ...addAttachments];
          } catch (err) {
            console.warn('Failed to load application_additional documents for attachments:', err);
          }
          // Also include completed application form files from application_form table
          try {
            const forms: ApplicationFormRow[] = await getApplicationFormByApplicationId(application.id);
            const formAttachments = (forms || [])
              .filter((f) => Boolean(f.file_url))
              .map((f) => ({ filename: f.file_name || 'Application Form', url: String(f.file_url) }));
            attachmentsUrl = [...attachmentsUrl, ...formAttachments];
          } catch (err) {
            console.warn('Failed to load application_form documents for attachments:', err);
          }
          // Include MTD files from application_mtd table (e.g., Funder MTD)
          try {
            const mtdRows: ApplicationMTD[] = await getApplicationMTDByApplicationId(application.id);
            const mtdAttachments = (mtdRows || []).filter(m => !isExcluded(keyForMtdDoc(m))).map((m) => {
              // Prefer direct URL from application_mtd
              let url = m.file_url ? String(m.file_url) : '';
              // If missing, try to find same file_name in application_documents we already fetched
              if (!url && m.file_name) {
                const key = normalize(m.file_name);
                if (docUrlByName[key]) {
                  url = docUrlByName[key];
                } else {
                  // Try loose contains match (handles suffixes like "(1)")
                  const hit = (docs || []).find(d => normalize(d.file_name).includes(key) || key.includes(normalize(d.file_name)));
                  if (hit?.file_url) url = String(hit.file_url);
                }
              }
              return { filename: m.file_name || 'MTD File', url };
            }).filter(a => a.url);
            attachmentsUrl = [...attachmentsUrl, ...mtdAttachments];
            // De-duplicate by filename+url combo
            const seenKey = new Set<string>();
            attachmentsUrl = attachmentsUrl.filter(a => {
              const key = `${a.filename}::${a.url}`.toLowerCase();
              if (seenKey.has(key)) return false;
              seenKey.add(key);
              return true;
            });
          } catch (err) {
            console.warn('Failed to load application_mtd documents for attachments:', err);
          }
        }
      } catch (err) {
        console.warn('Failed to load application documents for attachments:', err);
      }

      // Use filename+URL only (no base64 payload)
      const attachmentsForWebhook: { filename: string; url: string }[] = attachmentsUrl;

      // Get HTML content for each lender
      const htmlContent = selectedLenders[0] ? extractHtmlBody(generateEmailContent(selectedLenders[0])) : '';
      // Apply the same preview stripping before sending to send-application webhook
      let previewHtml = htmlContent
        // Allow extra attributes after class and remove nested contact items
        .replace(/<div class="contact-info"[^>]*>[\s\S]*?<\/div>/, '')
        .replace(/<div class="documents"[^>]*>[\s\S]*?<\/div>/, '')
        .replace(/<div class="download-zip"[^>]*>[\s\S]*?<\/div>/, '')
        .replace(/<div class="highlight-box"[^>]*>[\s\S]*?<\/div>/, '')
        .replace(/<div class="contact-item"[^>]*>[\s\S]*?<\/div>/g, '')
        // Signature and narratives (simplified patterns)
        .replace(/<p[^>]*>\s*<strong>Best regards,[\s\S]*?<\/p>/, '')
        .replace(/<p[^>]*>\s*<strong>[^<]+<\/strong>\s*<br[^>]*>[\s\S]*?<\/p>/, '')
        .replace(/<p[^>]*>I would appreciate[\s\S]*?<\/p>/, '')
        .replace(/<p[^>]*>Thank you for your time[\s\S]*?<\/p>/, '')
        // Financial Information section
        .replace(/<div class="section">[\s\S]*?<h2>[\s\S]*?Financial Information[\s\S]*?<\/h2>[\s\S]*?<\/div>/, '')
        .replace(/<h2>[\s\S]*?Financial Information[\s\S]*?<\/h2>[\s\S]*?<div class="info-grid">[\s\S]*?<\/div>/, '')
        // Application ID paragraph
        .replace(/<p[^>]*>\s*Application ID:[\s\S]*?<\/p>/, '');
      try {
        const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const phone = esc(application?.contactInfo?.phone || '');
        const addr = esc(application?.contactInfo?.address || '');
        if (phone) previewHtml = previewHtml.replace(new RegExp(phone, 'g'), '');
        if (addr) previewHtml = previewHtml.replace(new RegExp(addr, 'g'), '');
      } catch { void 0; }

      // Send webhook ONCE PER LENDER with lender-specific recipients/content (fire-and-forget)
      for (const lender of selectedLenders) {
        // Build per-lender recipients
        const primary = (lender.contact_email || '').trim();
        const ccs = (() => {
          const ccRaw = (lender as { cc_emails?: string | string[] | null }).cc_emails ?? null;
          const parse = (val: string) => val
            .split(/[;,]/)
            .map(e => e.trim())
            .filter(e => e.length > 0);
          if (Array.isArray(ccRaw)) return ccRaw.flatMap(v => parse(String(v)));
          if (typeof ccRaw === 'string') return parse(ccRaw);
          return [];
        })();
        // Subject/body tailored to this lender
        const per = buildEmailPayloadForLender(lender);
        let perHtmlBody = extractHtmlBody(generateEmailContent(lender))
          .replace(/<div class="contact-info"[^>]*>[\s\S]*?<\/div>/, '')
          .replace(/<div class="documents"[^>]*>[\s\S]*?<\/div>/, '')
          .replace(/<div class="download-zip"[^>]*>[\s\S]*?<\/div>/, '')
          .replace(/<div class="highlight-box"[^>]*>[\s\S]*?<\/div>/, '')
          .replace(/<div class="contact-item"[^>]*>[\s\S]*?<\/div>/g, '')
          .replace(/<p[^>]*>\s*<strong>Best regards,[\s\S]*?<\/p>/, '')
          .replace(/<p[^>]*>\s*<strong>[^<]+<\/strong>\s*<br[^>]*>[\s\S]*?<\/p>/, '')
          .replace(/<p[^>]*>I would appreciate[\s\S]*?<\/p>/, '')
          .replace(/<p[^>]*>Thank you for your time[\s\S]*?<\/p>/, '')
          .replace(/<div class="section">[\s\S]*?<h2>[\s\S]*?Financial Information[\s\S]*?<\/h2>[\s\S]*?<\/div>/, '')
          .replace(/<h2>[\s\S]*?Financial Information[\s\S]*?<\/h2>[\s\S]*?<div class="info-grid">[\s\S]*?<\/div>/, '')
          .replace(/<p[^>]*>\s*Application ID:[\s\S]*?<\/p>/, '');
        try {
          const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const phone = esc(application?.contactInfo?.phone || '');
          const addr = esc(application?.contactInfo?.address || '');
          if (phone) perHtmlBody = perHtmlBody.replace(new RegExp(phone, 'g'), '');
          if (addr) perHtmlBody = perHtmlBody.replace(new RegExp(addr, 'g'), '');
        } catch { /* ignore */ }

        const payloadPerLender = {
          applicationId: application?.id,
          lenders: primary ? [primary] : [],
          toEmails: primary ? [primary] : [],
          ccEmails: ccs,
          lenderIds: [lender.id],
          lendersDetailed: [
            ...(primary ? [{ id: lender.id, email: primary, role: 'to' as const }] : []),
            ...ccs.map(e => ({ id: lender.id, email: e, role: 'cc' as const })),
          ],
          subject: per.subject,
          body: perHtmlBody,
          bodyHtml: perHtmlBody,
          attachments: attachmentsForWebhook,
          smtpSettingsId: savedSmtpId || smtpSettingsId || null,
          context: {
            businessName: application?.businessName,
            applicantEmail: emailSettings.fromEmail || null,
            requestedAmount: application?.requestedAmount,
            monthlyRevenue: application?.monthlyRevenue,
            creditScore: application?.creditScore,
            selectedLenderCount: 1,
            lenderName: lender.name,
          },
          sentAt: new Date().toISOString(),
        };
        // Fire-and-forget per lender
        sendApplicationToWebhook(payloadPerLender);
      }

      // POST to local email server only if smtp_settings exists
      if (savedSmtpId) {
        const resp = await fetch('/.netlify/functions/send-application-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            applicationId: application?.id,
            lenders: lenderEmails, // legacy combined
            toEmails: toEmails,
            ccEmails: ccEmails,
            lenderIds,
            lendersDetailed,
            subject: preview.subject,
            body: previewHtml,
            attachments: attachmentsUrl,
          }),
        });
        if (!resp.ok) {
          const text = await resp.text();
          console.warn('Email server responded with error:', resp.status, text);
          throw new Error('Email sending failed');
        }
      }

      setSubmissionComplete(true);
      onSubmit();
    } catch (error) {
      console.error('Error submitting application:', error);
      alert('Error submitting application. Please try again.');
    } finally {
      setSendingProgress(100);
      setIsSubmitting(false);
      // Clear timer
      clearInterval(progressTimer);
    }
  };

  if (!application) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No application data available</p>
      </div>
    );
  }

  if (submissionComplete) {
    return (
      <div className="relative min-h-screen bg-gradient-to-b from-emerald-50/30 via-white to-white">
        {/* Decorative background shapes */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-emerald-100/40 blur-3xl"></div>
          <div className="absolute -bottom-24 -left-24 w-96 h-96 rounded-full bg-blue-100/30 blur-3xl"></div>
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-white rounded-xl shadow-lg p-8">
            <div className="text-center">
              <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-6" />
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Application Submitted Successfully!</h2>
              <p className="text-gray-600 mb-6">
                Your application and business bank statements have been sent to {selectedLenders.length} selected lender{selectedLenders.length > 1 ? 's' : ''}. 
                You should receive responses within 24-48 hours.
              </p>
              
              <div className="bg-green-50 rounded-lg p-6 mb-6">
                <h3 className="text-lg font-medium text-green-800 mb-3">Submitted to:</h3>
                <div className="space-y-2">
                  {selectedLenders.map(lender => (
                    <div key={lender.id} className="flex items-center justify-between bg-white p-3 rounded border">
                      <div className="flex items-center">
                        <img src="https://images.pexels.com/photos/259027/pexels-photo-259027.jpeg?auto=compress&cs=tinysrgb&w=100&h=100" alt={lender.name} className="w-12 h-12 rounded-lg mr-4" />
                        <span className="font-medium text-green-900">{lender.name}</span>
                      </div>
                      <span className="text-sm text-green-600">✓ Sent</span>
                    </div>
                  ))}
                </div>
              </div>
              
              <button
                onClick={() => window.location.reload()}
                className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Submit Another Application
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-emerald-50/30 via-white to-white">
      {/* Decorative background shapes */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-emerald-100/40 blur-3xl"></div>
        <div className="absolute -bottom-24 -left-24 w-96 h-96 rounded-full bg-blue-100/30 blur-3xl"></div>
      </div>
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Sending overlay */}
      {isSubmitting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-8 border border-gray-100">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-100 to-emerald-200 flex items-center justify-center mb-6 shadow-inner">
                <Loader className="w-8 h-8 text-emerald-600 animate-spin" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Sending Your Application</h3>
              <p className="text-gray-600 mb-6">We're sending your application and attachments to selected lenders…</p>
              <div className="w-full">
                <div className="h-3 bg-gray-200 rounded-full overflow-hidden shadow-inner">
                  <div
                    className="h-3 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full transition-all duration-300 shadow-sm"
                    style={{ width: `${Math.round(sendingProgress)}%` }}
                  />
                </div>
                <div className="text-sm text-gray-500 mt-3">This can take 30–60 seconds</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header Section */}
      <div className="text-center mb-12">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={onBack}
            className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all duration-200"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Lender Selection
          </button>
          <div className="text-sm text-gray-500 font-mono bg-gray-50 px-3 py-1 rounded-lg">
            Application ID: {application.id}
          </div>
        </div>
        
        <div className="inline-flex items-center px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-full text-emerald-700 text-sm font-medium mb-4">
          <CheckCircle className="w-4 h-4 mr-2" />
          Ready to Submit to {selectedLenders.length} Lender{selectedLenders.length > 1 ? 's' : ''}
        </div>
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Submission Summary</h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto">
          Review your application details before sending to selected lenders
        </p>
      </div>

      {/* Application Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
        <div className="bg-white rounded-2xl p-6 shadow-lg ring-1 ring-gray-100 hover:shadow-xl transition-shadow">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shadow-inner">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div className="text-sm font-medium text-gray-600">Business</div>
          </div>
          <div className="text-2xl font-bold text-slate-800 mb-1">{application.businessName}</div>
          <div className="text-sm text-gray-500">{application.industry}</div>
        </div>
        
        <div className="bg-white rounded-2xl p-6 shadow-lg ring-1 ring-gray-100 hover:shadow-xl transition-shadow">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center shadow-inner">
              <Send className="w-5 h-5 text-green-600" />
            </div>
            <div className="text-sm font-medium text-gray-600">Requested Amount</div>
          </div>
          <div className="text-2xl font-bold text-slate-800">${application.requestedAmount.toLocaleString()}</div>
        </div>
        
        <div className="bg-white rounded-2xl p-6 shadow-lg ring-1 ring-gray-100 hover:shadow-xl transition-shadow">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center shadow-inner">
              <ArrowLeft className="w-5 h-5 text-purple-600" />
            </div>
            <div className="text-sm font-medium text-gray-600">Monthly Revenue</div>
          </div>
          <div className="text-2xl font-bold text-slate-800">${application.monthlyRevenue.toLocaleString()}</div>
        </div>
        
        <div className="bg-white rounded-2xl p-6 shadow-lg ring-1 ring-gray-100 hover:shadow-xl transition-shadow">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center shadow-inner">
              <CheckCircle className="w-5 h-5 text-orange-600" />
            </div>
            <div className="text-sm font-medium text-gray-600">Credit Score</div>
          </div>
          <div className="text-2xl font-bold text-slate-800">{application.creditScore}</div>
        </div>
      </div>

      {/* Selected Lenders */}
      <div className="mb-12">
        <h3 className="text-2xl font-bold text-gray-900 mb-6">
          Selected Lenders ({selectedLenders.length})
        </h3>
        <div className="space-y-4">
          {selectedLenders.map(lender => (
            <div
              key={lender.id}
              className="group bg-white rounded-2xl border-2 border-gray-200 hover:border-emerald-300 hover:shadow-xl hover:shadow-emerald-100/50 transition-all duration-200 p-6"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-100 to-emerald-200 flex items-center justify-center mr-4 shadow-sm border-2 border-emerald-300">
                    <FileText className="w-8 h-8 text-emerald-700" />
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-gray-900 mb-1">{lender.name}</h4>
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <span className="font-medium">Factor: {lender.factor_rate}</span>
                      <span>•</span>
                      <span className="font-medium">Term: {lender.payback_term}</span>
                      <span>•</span>
                      <span className="font-medium">Approval: {lender.approval_time}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-xl font-bold text-emerald-600">
                      {(() => {
                        const score = lender.match_score;
                        if (typeof score === 'number') {
                          const pct = score <= 1 ? Math.round(score * 100) : Math.round(score);
                          return `${pct}%`;
                        }
                        const q = lender.matchScore;
                        return typeof q === 'number' ? `${Math.round(q)}%` : '95%';
                      })()}
                    </div>
                    <div className="text-sm text-gray-500">Match Score</div>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedLenderForDetails(lender);
                      setShowEmailPreview(true);
                    }}
                    className="px-4 py-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl transition-all duration-200 text-sm font-medium"
                  >
                    Preview Email
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Email Configuration (hidden via feature flag) */}
      {SHOW_EMAIL_CONFIG && (
        <div className="bg-white rounded-2xl shadow-lg ring-1 ring-gray-100 p-6 mb-12">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center shadow-inner">
                <Settings className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-gray-900">Email Configuration</h4>
                <div className="text-sm text-gray-600">
                  Emails will be sent from: {' '}
                  {emailSettings.fromEmail ? (
                    <span className="font-semibold text-gray-800">{emailSettings.fromEmail}</span>
                  ) : (
                    <span className="font-semibold text-amber-600">No from email specified</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-gray-500 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-yellow-400" />
                  SMTP Status: Using default settings
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowEmailSettings(true)}
              className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-xl transition-all duration-200 text-sm font-medium"
            >
              <Settings className="w-4 h-4" />
              Configure SMTP
            </button>
          </div>
        </div>
      )}

      {/* Documents Section (dynamic from application_documents + application_additional + application_mtd + application_form inline) */}
      <div className="bg-white rounded-2xl shadow-lg ring-1 ring-gray-100 p-6 mb-12">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-lg font-bold text-gray-900">Documents to be Included</h4>
          <div className="text-xs text-gray-500">
            {(appDocsLoading || additionalDocsLoading || mtdDocsLoading) ? 'Loading…' : `${(includedAppDocs.length + includedAdditionalDocs.length + includedInline.length + includedMtdDocs.length)} file${((includedAppDocs.length + includedAdditionalDocs.length + includedInline.length + includedMtdDocs.length) === 1) ? '' : 's'}`}
          </div>
        </div>
        {/* Debug info in console */}
        {(appDocsLoading || additionalDocsLoading || mtdDocsLoading) ? (
          <div className="flex items-center gap-2 text-gray-600 text-sm">
            <Loader className="w-4 h-4 animate-spin" /> Fetching documents…
          </div>
        ) : ((includedAppDocs.length + includedAdditionalDocs.length + includedInline.length + includedMtdDocs.length) === 0) ? (
          <div className="text-sm text-gray-500">No documents uploaded yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {includedInline.map((fileName: string, idx: number) => (
              <div key={`inline-${idx}`} className="flex items-center justify-between p-3 rounded-xl border bg-gradient-to-br from-gray-50 to-white hover:shadow-md transition-shadow border-gray-200">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-500" />
                  <div>
                    <div className="text-sm font-medium text-gray-900">{fileName}</div>
                    <div className="text-xs text-gray-500">Application Form</div>
                  </div>
                </div>
                <button
                  onClick={() => excludeKey(keyForInline(fileName))}
                  className="px-2 py-1 text-xs rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100"
                >
                  Exclude
                </button>
              </div>
            ))}
            {includedAppDocs
              .sort((a: ApplicationDocument, b: ApplicationDocument) => {
                const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
                const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
                return dateB - dateA;
              })
              .map((doc: ApplicationDocument) => (
                <div key={doc.id} className="flex items-center justify-between p-3 rounded-xl border bg-gradient-to-br from-gray-50 to-white hover:shadow-md transition-shadow border-gray-200">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-500" />
                    <div>
                      <div className="text-sm font-medium text-gray-900">{doc.file_name}</div>
                      <div className="text-xs text-gray-500">Bank Statement</div>
                    </div>
                  </div>
                  <button
                    onClick={() => excludeKey(keyForAppDoc(doc))}
                    className="px-2 py-1 text-xs rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100"
                  >
                    Exclude
                  </button>
                </div>
              ))}
            {includedAdditionalDocs
              .sort((a: ApplicationAdditionalRow, b: ApplicationAdditionalRow) => {
                const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
                const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
                return dateB - dateA;
              })
              .map((doc: ApplicationAdditionalRow) => (
                <div key={doc.id} className="flex items-center justify-between p-3 rounded-xl border bg-gradient-to-br from-gray-50 to-white hover:shadow-md transition-shadow border-gray-200">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-500" />
                    <div>
                      <div className="text-sm font-medium text-gray-900">{doc.file_name}</div>
                      <div className="text-xs text-gray-500">Additional Document</div>
                    </div>
                  </div>
                  <button
                    onClick={() => excludeKey(keyForAdditionalDoc(doc))}
                    className="px-2 py-1 text-xs rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100"
                  >
                    Exclude
                  </button>
                </div>
              ))}
            {includedMtdDocs
              .sort((a: ApplicationMTD, b: ApplicationMTD) => {
                const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
                const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
                return dateB - dateA;
              })
              .map((doc: ApplicationMTD) => (
                <div key={doc.id} className="flex items-center justify-between p-3 rounded-xl border bg-gradient-to-br from-gray-50 to-white hover:shadow-md transition-shadow border-gray-200">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-500" />
                    <div>
                      <div className="text-sm font-medium text-gray-900">{doc.file_name}</div>
                      <div className="text-xs text-gray-500">Funder MTD</div>
                    </div>
                  </div>
                  <button
                    onClick={() => excludeKey(keyForMtdDoc(doc))}
                    className="px-2 py-1 text-xs rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100"
                  >
                    Exclude
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Excluded area */}
      {(excludedInline.length + excludedApp.length + excludedAdditional.length + excludedMtd.length) > 0 && (
        <div className="bg-white rounded-2xl shadow-inner ring-1 ring-red-100 p-6 mb-12">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-bold text-red-700">Excluded from Submission</h4>
            <div className="text-xs text-red-600">{excludedInline.length + excludedApp.length + excludedAdditional.length + excludedMtd.length} file(s)</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {excludedInline.map((fileName: string, idx: number) => (
              <div key={`x-inline-${idx}`} className="flex items-center justify-between p-3 rounded-xl border bg-red-50 border-red-200">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-red-500" />
                  <div>
                    <div className="text-sm font-medium text-red-900">{fileName}</div>
                    <div className="text-xs text-red-700">Application Form</div>
                  </div>
                </div>
                <button
                  onClick={() => includeKey(keyForInline(fileName))}
                  className="px-2 py-1 text-xs rounded-lg border border-red-300 text-red-700 hover:bg-red-100"
                >
                  Include
                </button>
              </div>
            ))}
            {excludedApp.map((doc: ApplicationDocument) => (
              <div key={`x-app-${doc.id}`} className="flex items-center justify-between p-3 rounded-xl border bg-red-50 border-red-200">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-red-500" />
                  <div>
                    <div className="text-sm font-medium text-red-900">{doc.file_name}</div>
                    <div className="text-xs text-red-700">Bank Statement</div>
                  </div>
                </div>
                <button
                  onClick={() => includeKey(keyForAppDoc(doc))}
                  className="px-2 py-1 text-xs rounded-lg border border-red-300 text-red-700 hover:bg-red-100"
                >
                  Include
                </button>
              </div>
            ))}
            {excludedAdditional.map((doc: ApplicationAdditionalRow) => (
              <div key={`x-add-${doc.id}`} className="flex items-center justify-between p-3 rounded-xl border bg-red-50 border-red-200">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-red-500" />
                  <div>
                    <div className="text-sm font-medium text-red-900">{doc.file_name}</div>
                    <div className="text-xs text-red-700">Additional Document</div>
                  </div>
                </div>
                <button
                  onClick={() => includeKey(keyForAdditionalDoc(doc))}
                  className="px-2 py-1 text-xs rounded-lg border border-red-300 text-red-700 hover:bg-red-100"
                >
                  Include
                </button>
              </div>
            ))}
            {excludedMtd.map((doc: ApplicationMTD) => (
              <div key={`x-mtd-${doc.id}`} className="flex items-center justify-between p-3 rounded-xl border bg-red-50 border-red-200">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-red-500" />
                  <div>
                    <div className="text-sm font-medium text-red-900">{doc.file_name}</div>
                    <div className="text-xs text-red-700">Funder MTD</div>
                  </div>
                </div>
                <button
                  onClick={() => includeKey(keyForMtdDoc(doc))}
                  className="px-2 py-1 text-xs rounded-lg border border-red-300 text-red-700 hover:bg-red-100"
                >
                  Include
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="text-sm text-gray-600">
            Ready to send your application to <span className="font-semibold text-emerald-600">{selectedLenders.length}</span> qualified lender{selectedLenders.length !== 1 ? 's' : ''}
          </div>
          <button
            onClick={handleFinalSubmit}
            disabled={isSubmitting}
            className={`w-full sm:w-auto justify-center flex items-center px-8 py-4 rounded-xl font-semibold text-lg transition-all duration-200 ${
              isSubmitting
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-emerald-600 to-emerald-700 text-white hover:from-emerald-700 hover:to-emerald-800 shadow-lg shadow-emerald-200/50 hover:shadow-xl hover:shadow-emerald-300/50'
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader className="w-5 h-5 mr-2 animate-spin" />
                Sending Applications...
              </>
            ) : (
              <>
                <Send className="w-5 h-5 mr-2" />
                Send to {selectedLenders.length} Lender{selectedLenders.length > 1 ? 's' : ''}
              </>
            )}
          </button>
        </div>

      {/* Email Settings Modal */}
      {showEmailSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-5 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-blue-100 border border-blue-200 shadow-sm">
                  <Settings className="w-5 h-5 text-blue-700" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Email Settings</h3>
                  <p className="text-sm text-gray-600">Configure your SMTP settings for sending applications</p>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 py-6">
              {/* Presets */}
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-600">Quick presets:</span>
                <button type="button" onClick={() => applyPreset('gmail_tls')} className="px-2.5 py-1.5 text-xs rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">Gmail TLS (587)</button>
                <button type="button" onClick={() => applyPreset('gmail_ssl')} className="px-2.5 py-1.5 text-xs rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">Gmail SSL (465)</button>
                <button type="button" onClick={() => applyPreset('outlook_tls')} className="px-2.5 py-1.5 text-xs rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100">Outlook (587)</button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="col-span-1">
                  <label className="block text-sm font-semibold text-gray-800 mb-1.5">SMTP Host</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <Server className="w-4 h-4" />
                    </span>
                    <input
                      type="text"
                      value={emailSettings.smtpHost}
                      onChange={(e) => setEmailSettings(prev => ({ ...prev, smtpHost: e.target.value }))}
                      className={`w-full pl-9 pr-3.5 py-2.5 rounded-lg border-2 ${smtpErrors.host ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : 'border-gray-200 focus:border-blue-500 focus:ring-blue-500/20'} focus:ring-2 transition-shadow shadow-sm`}
                      placeholder="smtp.gmail.com"
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">Examples: smtp.gmail.com, smtp.mailgun.org</p>
                  {smtpErrors.host && <p className="mt-1 text-xs text-red-600">{smtpErrors.host}</p>}
                </div>
                <div className="col-span-1">
                  <label className="block text-sm font-semibold text-gray-800 mb-1.5">SMTP Port</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <Hash className="w-4 h-4" />
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={emailSettings.smtpPort}
                      onChange={(e) => setEmailSettings(prev => ({ ...prev, smtpPort: e.target.value }))}
                      className={`w-full pl-9 pr-3.5 py-2.5 rounded-lg border-2 ${smtpErrors.port ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : 'border-gray-200 focus:border-blue-500 focus:ring-blue-500/20'} focus:ring-2 transition-shadow shadow-sm`}
                      placeholder="587 (TLS) or 465 (SSL)"
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">Common ports: 587 (TLS), 465 (SSL)</p>
                  {smtpErrors.port && <p className="mt-1 text-xs text-red-600">{smtpErrors.port}</p>}
                </div>
                <div className="col-span-1">
                  <label className="block text-sm font-semibold text-gray-800 mb-1.5">Username</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <AtSign className="w-4 h-4" />
                    </span>
                    <input
                      type="text"
                      value={emailSettings.smtpUser}
                      onChange={(e) => setEmailSettings(prev => ({ ...prev, smtpUser: e.target.value }))}
                      className={`w-full pl-9 pr-3.5 py-2.5 rounded-lg border-2 ${smtpErrors.user ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : 'border-gray-200 focus:border-blue-500 focus:ring-blue-500/20'} focus:ring-2 transition-shadow shadow-sm`}
                      placeholder="Enter your username"
                    />
                  </div>
                  {smtpErrors.user && <p className="mt-1 text-xs text-red-600">{smtpErrors.user}</p>}
                </div>
                <div className="col-span-1">
                  <label className="block text-sm font-semibold text-gray-800 mb-1.5">Password</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <KeyRound className="w-4 h-4" />
                    </span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={emailSettings.smtpPassword}
                      onChange={(e) => setEmailSettings(prev => ({ ...prev, smtpPassword: e.target.value }))}
                      className="w-full pl-9 pr-11 py-2.5 rounded-lg border-2 border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-shadow shadow-sm"
                      placeholder="your-app-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(prev => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">Use an app-specific password if using Gmail.</p>
                </div>
                <div className="col-span-1 md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-800 mb-1.5">From Email</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <AtSign className="w-4 h-4" />
                    </span>
                    <input
                      type="email"
                      value={emailSettings.fromEmail}
                      onChange={(e) => setEmailSettings(prev => ({ ...prev, fromEmail: e.target.value }))}
                      className={`w-full pl-9 pr-3.5 py-2.5 rounded-lg border-2 ${smtpErrors.fromEmail ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : 'border-gray-200 focus:border-blue-500 focus:ring-blue-500/20'} focus:ring-2 transition-shadow shadow-sm`}
                      placeholder="Enter your email address"
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">Enter the email address you want to appear in the "From" field</p>
                  {smtpErrors.fromEmail && <p className="mt-1 text-xs text-red-600">{smtpErrors.fromEmail}</p>}
                </div>
              </div>
              {/* Tips */}
              <div className="mt-6 p-3.5 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 text-xs text-blue-800 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                <span>Use a trusted SMTP provider. For Gmail, enable 2FA and create an App Password.</span>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (validateSmtp()) {
                      // client-side only confirmation
                      alert('SMTP settings look good.');
                    }
                  }}
                  className="px-3 py-2 rounded-lg border-2 border-gray-200 text-gray-700 hover:bg-gray-100 text-sm"
                >
                  Test Settings
                </button>
              </div>
              <div className="flex items-center gap-3">
              <button
                onClick={() => setShowEmailSettings(false)}
                className="px-4 py-2 rounded-lg border-2 border-gray-200 text-gray-700 hover:bg-gray-100 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!validateSmtp()) return;
                  saveSmtpSettings(emailSettings); // local persist
                  await sendSmtpToWebhook({ ...emailSettings, fromEmail: emailSettings.fromEmail }); // fire-and-forget backend
                  setShowEmailSettings(false);
                }}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-semibold shadow-sm"
              >
                Save Settings
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Email Preview Modal */}
      {showEmailPreview && selectedLenderForDetails && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-5xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">
                  Email Preview - {selectedLenderForDetails.name}
                </h3>
                <button
                  onClick={() => setShowEmailPreview(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="p-6">
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <div className="text-sm text-gray-600 mb-2">
                  <strong>From:</strong> {emailSettings.fromEmail ? emailSettings.fromEmail : <span className="text-amber-600 italic">No from email specified</span>}
                </div>
                <div className="text-sm text-gray-600 mb-2">
                  <strong>To:</strong> {selectedLenderForDetails.contact_email || '—'}
                </div>
                <div className="text-sm text-gray-600">
                  <strong>Format:</strong> HTML Email
                </div>
              </div>
              <div className="bg-white border rounded-lg overflow-hidden">
                <iframe
                  title="Email HTML Preview"
                  style={{ width: '100%', height: `${iframeHeight}px`, border: '0', display: 'block' }}
                  srcDoc={((): string => {
                    const content = generateEmailContent(selectedLenderForDetails);
                    const parts = content.split(/\r?\n\r?\n/);
                    const base = parts.length > 1 ? parts.slice(1).join('\n\n') : content;
                    // Strip sections from preview UI only
                    let out = base
                      .replace(/<div class="contact-info">[\s\S]*?<\/div>/, '')
                      .replace(/<div class="documents">[\s\S]*?<\/div>/, '')
                      .replace(/<div class="download-zip">[\s\S]*?<\/div>/, '')
                      .replace(/<div class="highlight-box">[\s\S]*?<\/div>/, '')
                      // remove signature block (Best regards + name/business), keep footer
                      .replace(/<p[^>]*>\s*<strong>Best regards,[\s\S]*?<\/p>/, '')
                      .replace(/<p[^>]*>\s*<strong>[^<]+<\/strong>\s*<br[^>]*>[\s\S]*?<\/p>/, '')
                      // remove narrative paragraphs before signature (default template text)
                      .replace(/<p[^>]*>I would appreciate[\s\S]*?<\/p>/, '')
                      .replace(/<p[^>]*>Thank you for your time[\s\S]*?<\/p>/, '')
                      // remove Financial Information section
                      .replace(/<div class="section">[\s\S]*?<h2>[\s\S]*?Financial Information[\s\S]*?<\/h2>[\s\S]*?<\/div>/, '')
                      .replace(/<h2>[\s\S]*?Financial Information[\s\S]*?<\/h2>[\s\S]*?<div class="info-grid">[\s\S]*?<\/div>/, '')
                      // remove Application ID paragraph in footer
                      .replace(/<p[^>]*>\s*Application ID:[\s\S]*?<\/p>/, '');
                    // remove any leftover plain phone/address occurrences (outside known blocks)
                    try {
                      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                      const phone = esc(application.contactInfo.phone || '');
                      const addr = esc(application.contactInfo.address || '');
                      if (phone) out = out.replace(new RegExp(phone, 'g'), '');
                      if (addr) out = out.replace(new RegExp(addr, 'g'), '');
                    } catch { void 0; }
                    return out;
                  })()}
                  onLoad={(e: React.SyntheticEvent<HTMLIFrameElement>) => {
                    try {
                      const iframe = e.currentTarget as HTMLIFrameElement;
                      const doc = iframe.contentDocument || iframe.contentWindow?.document;
                      const newHeight = Math.max(
                        doc?.body?.scrollHeight || 0,
                        doc?.documentElement?.scrollHeight || 0,
                        800
                      );
                      setIframeHeight(newHeight + 20); // small buffer
                    } catch { void 0; }
                  }}
                />
              </div>
              <div className="p-6 border-t border-gray-200 flex justify-between">
                <button
                  onClick={() => {
                    const content = generateEmailContent(selectedLenderForDetails);
                    const parts = content.split(/\r?\n\r?\n/);
                    let html = parts.length > 1 ? parts.slice(1).join('\n\n') : content;
                    html = html
                    .replace(/<div class="contact-info">[\s\S]*?<\/div>/, '')
                    .replace(/<div class="documents">[\s\S]*?<\/div>/, '')
                    .replace(/<div class="download-zip">[\s\S]*?<\/div>/, '')
                    .replace(/<div class="highlight-box">[\s\S]*?<\/div>/, '')
                    // remove signature block (Best regards + name/business), keep footer
                    .replace(/<p[^>]*>\s*<strong>Best regards,[\s\S]*?<\/p>/, '')
                    .replace(/<p[^>]*>\s*<strong>[^<]+<\/strong>\s*<br[^>]*>[\s\S]*?<\/p>/, '')
                    // remove narrative paragraphs
                    .replace(/<p[^>]*>I would appreciate[\s\S]*?<\/p>/, '')
                    .replace(/<p[^>]*>Thank you for your time[\s\S]*?<\/p>/, '')
                    // remove Financial Information section
                    .replace(/<div class="section">[\s\S]*?<h2>[\s\S]*?Financial Information[\s\S]*?<\/h2>[\s\S]*?<\/div>/, '')
                    .replace(/<h2>[\s\S]*?Financial Information[\s\S]*?<\/h2>[\s\S]*?<div class="info-grid">[\s\S]*?<\/div>/, '')
                    // remove Application ID paragraph in footer
                    .replace(/<p[^>]*>\s*Application ID:[\s\S]*?<\/p>/, '');
                    try {
                      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                      const phone = esc(application.contactInfo.phone || '');
                      const addr = esc(application.contactInfo.address || '');
                      if (phone) html = html.replace(new RegExp(phone, 'g'), '');
                      if (addr) html = html.replace(new RegExp(addr, 'g'), '');
                    } catch { void 0; }
                    const win = window.open('', '_blank');
                    if (win) {
                      win.document.open();
                      win.document.write(html);
                      win.document.close();
                    }
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Open in new window
                </button>
                <button
                  onClick={() => setShowEmailPreview(false)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Close Preview
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default SubmissionRecap;