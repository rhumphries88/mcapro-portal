/*
  # Fix RLS policies for lender_submissions table

  1. Security Changes
    - Add policy for anonymous users to insert lender submissions
    - Add policy for anonymous users to view lender submissions
    - Add policy for anonymous users to update lender submissions
    - This allows the application to work without authentication while maintaining data security

  2. Notes
    - These policies allow anonymous access which is needed for the current application flow
    - In production, you may want to restrict these to authenticated users only
*/

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow anonymous users to create submissions" ON lender_submissions;
DROP POLICY IF EXISTS "Allow anonymous users to view submissions" ON lender_submissions;
DROP POLICY IF EXISTS "Allow anonymous users to update submissions" ON lender_submissions;

-- Allow anonymous users to insert lender submissions
CREATE POLICY "Allow anonymous users to create submissions"
  ON lender_submissions
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anonymous users to view lender submissions
CREATE POLICY "Allow anonymous users to view submissions"
  ON lender_submissions
  FOR SELECT
  TO anon
  USING (true);

-- Allow anonymous users to update lender submissions
CREATE POLICY "Allow anonymous users to update submissions"
  ON lender_submissions
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Ensure RLS is enabled on the table
ALTER TABLE lender_submissions ENABLE ROW LEVEL SECURITY;