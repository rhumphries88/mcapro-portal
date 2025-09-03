import React, { type ComponentProps } from 'react';
import ApplicationForm from './ApplicationForm';

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
  onContinue: () => void;
  application: AppDataLike | null;
  onReplaceDocument?: () => void;
}

const BankStatement: React.FC<BankStatementProps> = ({ onContinue, application, onReplaceDocument }) => {
  type ReviewInitialType = ComponentProps<typeof ApplicationForm>['reviewInitial'];
  const docName = (() => {
    const first = application?.documents && application.documents.length > 0 ? application.documents[0] : '';
    if (!first) return '';
    const parts = first.split(/[/\\]/);
    return parts[parts.length - 1];
  })();

  return (
    <ApplicationForm
      key={JSON.stringify(application)}
      initialStep="form"
      reviewMode
      reviewInitial={application as ReviewInitialType}
      reviewDocName={docName}
      onReplaceDocument={onReplaceDocument}
      onReviewSubmit={() => onContinue()}
      onSubmit={() => { /* no-op in review mode */ }}
    />
  );
}
;

export default BankStatement;
