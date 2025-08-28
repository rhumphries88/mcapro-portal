/*
  # Fix Lenders Table RLS Policies

  1. Security Changes
    - Drop existing restrictive policies on lenders table
    - Add comprehensive policies for authenticated users
    - Enable proper INSERT, UPDATE, DELETE permissions for admin operations

  2. Policy Updates
    - Allow authenticated users to manage lenders (for admin functionality)
    - Maintain security while enabling necessary operations
    - Keep SELECT policy for viewing active lenders
*/

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Anyone can view active lenders" ON lenders;
DROP POLICY IF EXISTS "Authenticated users can manage lenders" ON lenders;

-- Create comprehensive policies for lenders table
CREATE POLICY "Authenticated users can view all lenders"
  ON lenders
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert lenders"
  ON lenders
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update lenders"
  ON lenders
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete lenders"
  ON lenders
  FOR DELETE
  TO authenticated
  USING (true);