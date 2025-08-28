import React, { useState } from 'react';
import { ArrowLeft, Send, Settings, CheckCircle, FileText, Loader } from 'lucide-react';
import { getLenders, createLenderSubmissions, Lender as DBLender } from '../lib/supabase';

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
  onBack: () => void;
  onSubmit: () => void;
}

const SubmissionRecap: React.FC<SubmissionRecapProps> = ({ 
  application, 
  selectedLenderIds, 
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
      fromEmail: application?.contactInfo?.email || ''
    };
    
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        return {
          ...parsed,
          fromEmail: application?.contactInfo?.email || parsed.fromEmail
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
  const [submissionComplete, setSubmissionComplete] = useState(false);
  const [selectedLenderForDetails, setSelectedLenderForDetails] = useState<DBLender | null>(null);
  const [lenders, setLenders] = useState<DBLender[]>([]);

  // Load lenders from Supabase
  React.useEffect(() => {
    const loadLenders = async () => {
      try {
        const dbLenders = await getLenders();
        setLenders(dbLenders);
      } catch (error) {
        console.error('Error loading lenders:', error);
      }
    };
    loadLenders();
  }, []);

  const selectedLenders = lenders.filter(lender => selectedLenderIds.includes(lender.id));

  const generateEmailContent = (lender: DBLender) => {
    if (!application) return '';

    // Get saved email template from localStorage
    const savedTemplate = localStorage.getItem('mcaPortalEmailTemplate');
    const defaultTemplate = `Subject: Merchant Cash Advance Application - {{businessName}}

Dear {{lenderName}} Team,

I hope this email finds you well. I am writing to submit a merchant cash advance application for your review and consideration.

BUSINESS INFORMATION:
• Business Name: {{businessName}}
• Owner: {{ownerName}}
• Industry: {{industry}}
• Years in Business: {{yearsInBusiness}}
• Business Type: {{businessType}}
• EIN: {{ein}}

FINANCIAL DETAILS:
• Requested Amount: \${{requestedAmount}}
• Monthly Revenue: \${{monthlyRevenue}}
• Annual Revenue: \${{annualRevenue}}
• Credit Score: {{creditScore}}
• Existing Debt: \${{existingDebt}}

CONTACT INFORMATION:
• Email: {{email}}
• Phone: {{phone}}
• Address: {{address}}

I have attached the following documents for your review:
• Business bank statements (last 6 months)
• Tax returns
• Completed application form
• Voided business check

Based on your underwriting guidelines, I believe this application aligns well with your lending criteria:
• Amount Range: \${{lenderMinAmount}} - \${{lenderMaxAmount}}
• Factor Rate: {{lenderFactorRate}}
• Payback Term: {{lenderPaybackTerm}}
• Approval Time: {{lenderApprovalTime}}

I would appreciate the opportunity to discuss this application further and answer any questions you may have. Please let me know if you need any additional information or documentation.

Thank you for your time and consideration. I look forward to hearing from you soon.

Best regards,
{{ownerName}}
{{businessName}}
{{email}}
{{phone}}

---
This application was submitted through MCAPortal Pro
Application ID: {{applicationId}}`;

    const template = savedTemplate || defaultTemplate;

    // Replace template variables with actual data
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
      .replace(/\{\{email\}\}/g, application.contactInfo.email)
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

  const saveSmtpSettings = (settings: typeof emailSettings) => {
    try {
      // Save SMTP settings to localStorage (excluding password for security)
      const settingsToSave = {
        smtpHost: settings.smtpHost,
        smtpPort: settings.smtpPort,
        smtpUser: settings.smtpUser,
        // Don't save password for security reasons
        smtpPassword: '',
        fromEmail: settings.fromEmail
      };
      localStorage.setItem('mcaPortalSmtpSettings', JSON.stringify(settingsToSave));
    } catch (error) {
      console.error('Error saving SMTP settings:', error);
    }
  };

  const handleFinalSubmit = async () => {
    setIsSubmitting(true);
    
    // Save SMTP settings for future use
    saveSmtpSettings(emailSettings);
    
    try {
      // Create lender submissions in database
      if (application) {
        await createLenderSubmissions(application.id, selectedLenderIds);
      }
      
      // Log submission details
      console.log(`Sending application from: ${application?.contactInfo?.email}`);
      console.log(`Selected lenders: ${selectedLenders.length}`);
      console.log(`SMTP Settings configured: ${emailSettings.smtpHost ? 'Yes' : 'No'}`);
      
      // Simulate email sending process
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      setSubmissionComplete(true);
      onSubmit();
    } catch (error) {
      console.error('Error submitting application:', error);
      alert('Error submitting application. Please try again.');
    } finally {
      setIsSubmitting(false);
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
      <div className="bg-white rounded-xl shadow-lg p-8">
        <div className="text-center">
          <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-6" />
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Application Submitted Successfully!</h2>
          <p className="text-gray-600 mb-6">
            Your application and business bank statements have been sent to {selectedLenders.length} selected lender{selectedLenders.length > 1 ? 's' : ''}. 
            You should receive responses within 24-48 hours at {application.contactInfo.email}.
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
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="w-full sm:w-auto flex items-center justify-center sm:justify-start text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 mr-2" />
          Back to Lender Selection
        </button>
        <div className="text-sm text-gray-500 break-all">
          Application ID: {application.id}
        </div>
      </div>

      {/* Submission Summary */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Submission Summary</h2>
        
        {/* Application Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="text-sm text-blue-600 font-medium">Business</div>
            <div className="text-lg font-bold text-blue-900">{application.businessName}</div>
            <div className="text-sm text-blue-700">{application.industry}</div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="text-sm text-green-600 font-medium">Requested Amount</div>
            <div className="text-lg font-bold text-green-900">${application.requestedAmount.toLocaleString()}</div>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg">
            <div className="text-sm text-purple-600 font-medium">Monthly Revenue</div>
            <div className="text-lg font-bold text-purple-900">${application.monthlyRevenue.toLocaleString()}</div>
          </div>
          <div className="bg-orange-50 p-4 rounded-lg">
            <div className="text-sm text-orange-600 font-medium">Credit Score</div>
            <div className="text-lg font-bold text-orange-900">{application.creditScore}</div>
          </div>
        </div>

        {/* Selected Lenders */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Selected Lenders ({selectedLenders.length})
          </h3>
          <div className="space-y-3">
            {selectedLenders.map(lender => (
              <div key={lender.id} className="flex items-center justify-between bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center">
                  <img src="https://images.pexels.com/photos/259027/pexels-photo-259027.jpeg?auto=compress&cs=tinysrgb&w=100&h=100" alt={lender.name} className="w-12 h-12 rounded-lg mr-4" />
                  <div>
                    <h4 className="font-medium text-gray-900">{lender.name}</h4>
                    <p className="text-sm text-gray-600">
                      {lender.factor_rate} • {lender.payback_term} • {lender.approval_time}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-green-600">
                    95% Match
                  </span>
                  <button
                    onClick={() => {
                      setSelectedLenderForDetails(lender);
                      setShowEmailPreview(true);
                    }}
                    className="text-blue-600 hover:text-blue-800 text-sm flex items-center"
                  >
                    Preview Email
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Email Configuration */}
        <div className="bg-blue-50 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-blue-900">Email Configuration</h4>
              <p className="text-sm text-blue-700">
                Emails will be sent from: <span className="font-medium">{application.contactInfo.email}</span>
              </p>
              <p className="text-sm text-blue-600 mt-1">
                SMTP Status: {emailSettings.smtpHost ? 'Configured ✓' : 'Not configured - using default settings'}
                {emailSettings.smtpHost && (
                  <span className="block text-xs text-blue-500 mt-1">
                    Settings saved for future submissions
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={() => setShowEmailSettings(true)}
              className="flex items-center text-blue-600 hover:text-blue-800 text-sm"
            >
              <Settings className="w-4 h-4 mr-1" />
              Configure SMTP
            </button>
          </div>
        </div>

        {/* Documents Included */}
        <div className="mb-6">
          <h4 className="font-medium text-gray-900 mb-3">Documents to be Included:</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="flex items-center text-sm text-gray-600">
              <FileText className="w-4 h-4 mr-2 text-blue-600" />
              Application Form
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <FileText className="w-4 h-4 mr-2 text-green-600" />
              Bank Statements (6 months)
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <FileText className="w-4 h-4 mr-2 text-purple-600" />
              Tax Returns
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <FileText className="w-4 h-4 mr-2 text-orange-600" />
              Voided Check
            </div>
          </div>
        </div>

        {/* Final Submit Button */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3 pt-6 border-t border-gray-200">
          <button
            onClick={handleFinalSubmit}
            disabled={isSubmitting}
            className={`w-full sm:w-auto justify-center flex items-center px-8 py-3 rounded-lg font-medium transition-colors ${
              isSubmitting
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
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
      </div>

      {/* Email Settings Modal */}
      {showEmailSettings && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Email Settings</h3>
              <p className="text-sm text-gray-600 mt-1">Configure your SMTP settings for sending applications</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Host</label>
                <input
                  type="text"
                  value={emailSettings.smtpHost}
                  onChange={(e) => setEmailSettings(prev => ({ ...prev, smtpHost: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="smtp.gmail.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Port</label>
                <input
                  type="text"
                  value={emailSettings.smtpPort}
                  onChange={(e) => setEmailSettings(prev => ({ ...prev, smtpPort: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="587"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input
                  type="text"
                  value={emailSettings.smtpUser}
                  onChange={(e) => setEmailSettings(prev => ({ ...prev, smtpUser: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="your-email@gmail.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={emailSettings.smtpPassword}
                  onChange={(e) => setEmailSettings(prev => ({ ...prev, smtpPassword: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="your-app-password"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">From Email</label>
                <input
                  type="email"
                  value={application.contactInfo.email}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
                  disabled
                />
                <p className="text-xs text-gray-500 mt-1">
                  Using your application email address
                </p>
              </div>
            </div>
            <div className="p-6 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => setShowEmailSettings(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  saveSmtpSettings(emailSettings);
                  setShowEmailSettings(false);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Preview Modal */}
      {showEmailPreview && selectedLenderForDetails && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">
                  Email Preview - {selectedLenderForDetails.name}
                </h3>
                <button
                  onClick={() => setShowEmailPreview(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="p-6">
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <div className="text-sm text-gray-600 mb-2">
                  <strong>From:</strong> {application.contactInfo.email}
                </div>
                <div className="text-sm text-gray-600 mb-2">
                  <strong>To:</strong> {selectedLenderForDetails.name} (contact email would be used)
                </div>
              </div>
              <div className="bg-white border rounded-lg p-6">
                <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono">
                  {generateEmailContent(selectedLenderForDetails)}
                </pre>
              </div>
            </div>
            <div className="p-6 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowEmailPreview(false)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubmissionRecap;