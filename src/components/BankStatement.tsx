import React, { type ComponentProps } from 'react';
import ApplicationForm from './ApplicationForm';
import { createApplication, updateApplication, type Application as DBApplication, updateApplicationForm, getLatestPendingApplicationForm, type ApplicationFormRow } from '../lib/supabase';
import { useAuth } from '../App';

// Keep this type minimal to avoid tight coupling; it matches what SubmissionsPortal passes
type AppDataLike = {
  id?: string;
  businessName?: string;
  monthlyRevenue?: number;
  timeInBusiness?: number;
  creditScore?: number;
  industry?: string;
  requestedAmount?: number;
  documents?: string[];
  contactInfo?: {
    ownerName?: string;
    email?: string;
    phone?: string;
    address?: string;
  };
  businessInfo?: {
    ein?: string;
    businessType?: string;
    yearsInBusiness?: number;
    numberOfEmployees?: number;
  };
  financialInfo?: {
    annualRevenue?: number;
    averageMonthlyRevenue?: number;
    averageMonthlyDeposits?: number;
    existingDebt?: number;
  };
};

interface BankStatementProps {
  // Pass updated application values captured in review mode back to parent
  onContinue: (updated?: ComponentProps<typeof ApplicationForm>['reviewInitial']) => void;
  application: AppDataLike | null;
  onReplaceDocument?: () => void;
}

const BankStatement: React.FC<BankStatementProps> = ({ onContinue, application, onReplaceDocument }) => {
  const { user } = useAuth(); // Get the current logged-in user
  type ReviewInitialType = ComponentProps<typeof ApplicationForm>['reviewInitial'];
  const docName = (() => {
    const first = application?.documents && application.documents.length > 0 ? application.documents[0] : '';
    if (!first) return '';
    const parts = first.split(/[/\\]/);
    return parts[parts.length - 1];
  })();

  // Persist the application when the user clicks the Submit button in Bank Statement step
  const handleReviewSubmit: NonNullable<ComponentProps<typeof ApplicationForm>['onReviewSubmit']> = async (app) => {
    let createdId: string | null = null;
    try {
      const dbPayload: Partial<DBApplication> = {
        business_name: app.businessName,
        owner_name: app.contactInfo?.ownerName ?? '',
        email: app.contactInfo?.email ?? '',
        phone: app.contactInfo?.phone ?? '',
        dateBirth: app.contactInfo?.dateOfBirth ?? '',
        address: app.contactInfo?.address ?? '',
        ein: app.businessInfo?.ein ?? '',
        business_type: app.businessInfo?.businessType ?? '',
        industry: app.industry,
        years_in_business: Number(app.businessInfo?.yearsInBusiness ?? app.timeInBusiness ?? 0) || 0,
        number_of_employees: Number(app.businessInfo?.numberOfEmployees ?? 0) || 0,
        annual_revenue: Number(app.financialInfo?.annualRevenue ?? 0) || 0,
        monthly_revenue: Number(app.financialInfo?.averageMonthlyRevenue ?? app.monthlyRevenue ?? 0) || 0,
        monthly_deposits: Number(app.financialInfo?.averageMonthlyDeposits ?? 0) || 0,
        existing_debt: Number(app.financialInfo?.existingDebt ?? 0) || 0,
        credit_score: Number(app.creditScore ?? 0) || 0,
        requested_amount: Number(app.requestedAmount ?? 0) || 0,
        status: (app.status as DBApplication['status']) ?? 'submitted',
        documents: Array.isArray(app.documents) ? app.documents : [],
        user_id: user?.id, // Add the logged-in user's ID
      };

      if (app.id) {
        console.log('[BankStatement] Updating application id', app.id, 'with payload', dbPayload);
        await updateApplication(app.id, dbPayload);
      } else {
        console.log('[BankStatement] Creating application with payload', dbPayload);
        console.log('[BankStatement] User ID being added:', user?.id);
        const created = await createApplication(dbPayload as Omit<DBApplication, 'id' | 'created_at' | 'updated_at'>);
        console.log('[BankStatement] Created application id', created.id);
        // Capture created ID to propagate back to parent
        createdId = created.id;
      }
      const applicationId = app.id || createdId;
      if (applicationId) {
        let linkedFormId: string | null = null;
        let linkedFormName: string | null = null;
        let linkedFormUrl: string | null = null;
        try {
          if (user?.id) {
            const pending: ApplicationFormRow | null = await getLatestPendingApplicationForm(user.id);
            console.log('[BankStatement] Pending application_form for user', { userId: user.id, id: pending?.id });
            if (pending?.id) {
              const updated = await updateApplicationForm(pending.id, { application_id: applicationId });
              console.log('[BankStatement] Linked application_form via review submit', { id: updated.id, application_id: updated.application_id });
              linkedFormId = updated.id || pending.id;
              linkedFormName = updated.file_name ?? pending.file_name ?? null;
              linkedFormUrl = updated.file_url ?? pending.file_url ?? null;
            }
          }
        } catch (linkErr) {
          console.warn('[BankStatement] Failed to link application_form:', linkErr);
        }
        try {
          const payload = {
            applicationId,
            applicationFormId: linkedFormId,
            userId: user?.id || null,
            file_name: linkedFormName,
            file_url: linkedFormUrl,
          };
          let resp: Response | null = null;
          try {
            resp = await fetch('/.netlify/functions/forward-application-id', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
          } catch (fnErr) {
            console.warn('[Webhook][BankStatement] Function request error, fallback to direct:', fnErr);
          }
          if (resp) {
            let text = '';
            try { text = await resp.text(); } catch { text = ''; }
            console.log('[Webhook][BankStatement] Function response', { status: resp.status, ok: resp.ok, body: text });
          }
          if (!resp || !resp.ok || resp.status === 404) {
            try {
              const direct = await fetch('https://primary-production-c8d0.up.railway.app/webhook/application-id', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });
              let directText = '';
              try { directText = await direct.text(); } catch { directText = ''; }
              console.log('[Webhook][BankStatement] Direct response', { status: direct.status, ok: direct.ok, body: directText });
            } catch (directErr) {
              console.warn('[Webhook][BankStatement] Direct request failed:', directErr);
            }
          }
        } catch (sendErr) {
          console.warn('[Webhook][BankStatement] Unexpected error sending webhook:', sendErr);
        }
      }
    } catch (e) {
      console.error('[BankStatement] Failed to persist application on review submit:', e);
      // Continue flow even if persistence fails to not block user
    } finally {
      // Return the latest form values to parent so it can update its application state
      const next = { ...(app as ReviewInitialType), id: (app as ReviewInitialType)?.id || createdId || '' } as ReviewInitialType;
      onContinue(next);
    }
  };

  return (
    <ApplicationForm
      key={JSON.stringify(application)}
      initialStep="form"
      reviewMode
      reviewInitial={application as ReviewInitialType}
      reviewDocName={docName}
      onReplaceDocument={onReplaceDocument}
      onReviewSubmit={handleReviewSubmit}
      onSubmit={() => { /* no-op in review mode */ }}
    />
  );
}
;

export default BankStatement;
