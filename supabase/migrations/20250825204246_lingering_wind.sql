/*
  # Reset and Fix Lenders Table RLS Policies

  1. Security Changes
    - Drop all existing RLS policies on lenders table
    - Create new comprehensive policies for authenticated users
    - Allow full CRUD operations for authenticated users (admin functionality)
    
  2. New Policies
    - SELECT: Allow authenticated users to view all lenders
    - INSERT: Allow authenticated users to create new lenders
    - UPDATE: Allow authenticated users to update any lender
    - DELETE: Allow authenticated users to delete any lender
*/

-- First, drop all existing policies on the lenders table
DROP POLICY IF EXISTS "Authenticated users can view all lenders" ON lenders;
DROP POLICY IF EXISTS "Authenticated users can insert lenders" ON lenders;
DROP POLICY IF EXISTS "Authenticated users can update lenders" ON lenders;
DROP POLICY IF EXISTS "Authenticated users can delete lenders" ON lenders;
DROP POLICY IF EXISTS "Enable read access for all users" ON lenders;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON lenders;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON lenders;
DROP POLICY IF EXISTS "Enable delete for authenticated users only" ON lenders;

-- Ensure RLS is enabled
ALTER TABLE lenders ENABLE ROW LEVEL SECURITY;

-- Create new comprehensive policies
CREATE POLICY "Allow SELECT for authenticated users"
  ON lenders
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow INSERT for authenticated users"
  ON lenders
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow UPDATE for authenticated users"
  ON lenders
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow DELETE for authenticated users"
  ON lenders
  FOR DELETE
  TO authenticated
  USING (true);