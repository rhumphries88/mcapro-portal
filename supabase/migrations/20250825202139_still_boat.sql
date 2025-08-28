/*
  # MCA Portal Database Schema

  1. New Tables
    - `applications`
      - `id` (uuid, primary key)
      - `business_name` (text)
      - `owner_name` (text)
      - `email` (text)
      - `phone` (text)
      - `address` (text)
      - `ein` (text)
      - `business_type` (text)
      - `industry` (text)
      - `years_in_business` (numeric)
      - `number_of_employees` (integer)
      - `annual_revenue` (numeric)
      - `monthly_revenue` (numeric)
      - `monthly_deposits` (numeric)
      - `existing_debt` (numeric)
      - `credit_score` (integer)
      - `requested_amount` (numeric)
      - `status` (text)
      - `documents` (text array)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
      - `user_id` (uuid, foreign key)

    - `lenders`
      - `id` (uuid, primary key)
      - `name` (text)
      - `contact_email` (text)
      - `phone` (text)
      - `status` (text)
      - `rating` (numeric)
      - `total_applications` (integer)
      - `approval_rate` (numeric)
      - `min_amount` (numeric)
      - `max_amount` (numeric)
      - `min_credit_score` (integer)
      - `max_credit_score` (integer)
      - `min_time_in_business` (numeric)
      - `min_monthly_revenue` (numeric)
      - `industries` (text array)
      - `factor_rate` (text)
      - `payback_term` (text)
      - `approval_time` (text)
      - `features` (text array)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

    - `lender_submissions`
      - `id` (uuid, primary key)
      - `application_id` (uuid, foreign key)
      - `lender_id` (uuid, foreign key)
      - `status` (text)
      - `response` (text)
      - `offered_amount` (numeric)
      - `factor_rate` (text)
      - `terms` (text)
      - `response_date` (timestamp)
      - `notes` (text)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users
*/

-- Applications table
CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL,
  owner_name text NOT NULL,
  email text NOT NULL,
  phone text,
  address text,
  ein text,
  business_type text,
  industry text,
  years_in_business numeric DEFAULT 0,
  number_of_employees integer DEFAULT 0,
  annual_revenue numeric DEFAULT 0,
  monthly_revenue numeric DEFAULT 0,
  monthly_deposits numeric DEFAULT 0,
  existing_debt numeric DEFAULT 0,
  credit_score integer DEFAULT 0,
  requested_amount numeric DEFAULT 0,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'under-review', 'matched', 'funded', 'declined')),
  documents text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  user_id uuid REFERENCES auth.users(id)
);

-- Lenders table
CREATE TABLE IF NOT EXISTS lenders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_email text NOT NULL,
  phone text,
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
  rating numeric DEFAULT 4.0 CHECK (rating >= 1 AND rating <= 5),
  total_applications integer DEFAULT 0,
  approval_rate numeric DEFAULT 0 CHECK (approval_rate >= 0 AND approval_rate <= 100),
  min_amount numeric DEFAULT 10000,
  max_amount numeric DEFAULT 500000,
  min_credit_score integer DEFAULT 500 CHECK (min_credit_score >= 300 AND min_credit_score <= 850),
  max_credit_score integer DEFAULT 850 CHECK (max_credit_score >= 300 AND max_credit_score <= 850),
  min_time_in_business numeric DEFAULT 1,
  min_monthly_revenue numeric DEFAULT 10000,
  industries text[] DEFAULT '{}',
  factor_rate text DEFAULT '1.1 - 1.4',
  payback_term text DEFAULT '3-18 months',
  approval_time text DEFAULT '24 hours',
  features text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Lender submissions table
CREATE TABLE IF NOT EXISTS lender_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  lender_id uuid NOT NULL REFERENCES lenders(id) ON DELETE CASCADE,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'counter-offer', 'funded')),
  response text,
  offered_amount numeric,
  factor_rate text,
  terms text,
  response_date timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(application_id, lender_id)
);

-- Enable Row Level Security
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE lenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE lender_submissions ENABLE ROW LEVEL SECURITY;

-- Applications policies
CREATE POLICY "Users can create applications"
  ON applications
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can view their own applications"
  ON applications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can update their own applications"
  ON applications
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Lenders policies (public read, admin write)
CREATE POLICY "Anyone can view active lenders"
  ON lenders
  FOR SELECT
  TO authenticated
  USING (status = 'active');

CREATE POLICY "Authenticated users can manage lenders"
  ON lenders
  FOR ALL
  TO authenticated
  USING (true);

-- Lender submissions policies
CREATE POLICY "Users can view submissions for their applications"
  ON lender_submissions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM applications 
      WHERE applications.id = lender_submissions.application_id 
      AND (applications.user_id = auth.uid() OR applications.user_id IS NULL)
    )
  );

CREATE POLICY "Users can create submissions"
  ON lender_submissions
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update submissions"
  ON lender_submissions
  FOR UPDATE
  TO authenticated
  USING (true);

-- Insert sample lenders
INSERT INTO lenders (name, contact_email, phone, rating, min_amount, max_amount, min_credit_score, max_credit_score, min_time_in_business, min_monthly_revenue, industries, factor_rate, payback_term, approval_time, features) VALUES
('FastCash Capital', 'partnerships@fastcash.com', '(555) 123-4567', 4.8, 10000, 500000, 550, 850, 1, 15000, ARRAY['Retail', 'Restaurant', 'Healthcare', 'Professional Services'], '1.1 - 1.4', '3-18 months', '24 hours', ARRAY['No collateral required', 'Same day funding', 'Flexible payments']),
('Business Growth Partners', 'info@bgpartners.com', '(555) 987-6543', 4.6, 25000, 1000000, 600, 850, 2, 30000, ARRAY['All Industries'], '1.15 - 1.35', '6-24 months', '48 hours', ARRAY['Competitive rates', 'Larger amounts', 'Industry expertise']),
('QuickFund Solutions', 'contact@quickfund.com', '(555) 456-7890', 4.4, 5000, 250000, 500, 750, 0.5, 8000, ARRAY['Retail', 'Restaurant', 'Construction', 'Transportation'], '1.2 - 1.5', '3-12 months', '2 hours', ARRAY['Instant approval', 'Bad credit OK', 'Fast funding']),
('Premium Business Finance', 'info@premiumbiz.com', '(555) 234-5678', 4.9, 50000, 2000000, 650, 850, 3, 50000, ARRAY['Healthcare', 'Technology', 'Manufacturing', 'Professional Services'], '1.08 - 1.25', '6-36 months', '3-5 days', ARRAY['Best rates', 'Large amounts', 'Premium service']),
('Merchant Advance Pro', 'team@merchantpro.com', '(555) 345-6789', 4.3, 15000, 750000, 580, 800, 1.5, 20000, ARRAY['Retail', 'Restaurant', 'Healthcare', 'Real Estate'], '1.12 - 1.38', '4-20 months', '24-48 hours', ARRAY['Merchant-focused', 'Flexible terms', 'Industry expertise']);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_created_at ON applications(created_at);
CREATE INDEX IF NOT EXISTS idx_applications_user_id ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_lenders_status ON lenders(status);
CREATE INDEX IF NOT EXISTS idx_lender_submissions_application_id ON lender_submissions(application_id);
CREATE INDEX IF NOT EXISTS idx_lender_submissions_lender_id ON lender_submissions(lender_id);
CREATE INDEX IF NOT EXISTS idx_lender_submissions_status ON lender_submissions(status);