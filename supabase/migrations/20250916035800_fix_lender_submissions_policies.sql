/*
  # Fix lender_submissions RLS policies to allow updates from the client

  - Ensures both anon and authenticated roles can SELECT/INSERT/UPDATE lender_submissions
  - Keeps RLS enabled. In production you may wish to tighten these further.
*/

-- Safety: enable RLS
ALTER TABLE lender_submissions ENABLE ROW LEVEL SECURITY;

-- Drop existing overlapping policies if they exist
DROP POLICY IF EXISTS "Users can update submissions" ON lender_submissions;
DROP POLICY IF EXISTS "Allow anonymous users to update submissions" ON lender_submissions;
DROP POLICY IF EXISTS "Allow anonymous users to view submissions" ON lender_submissions;
DROP POLICY IF EXISTS "Allow anonymous users to create submissions" ON lender_submissions;
DROP POLICY IF EXISTS "Anyone can update lender_submissions" ON lender_submissions;
DROP POLICY IF EXISTS "Anyone can select lender_submissions" ON lender_submissions;
DROP POLICY IF EXISTS "Anyone can insert lender_submissions" ON lender_submissions;

-- Allow SELECT
CREATE POLICY "Anyone can select lender_submissions"
  ON lender_submissions
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Allow INSERT
CREATE POLICY "Anyone can insert lender_submissions"
  ON lender_submissions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Allow UPDATE
CREATE POLICY "Anyone can update lender_submissions"
  ON lender_submissions
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
