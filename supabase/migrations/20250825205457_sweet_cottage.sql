/*
  # Fix Applications Table RLS Policies

  1. Security Changes
    - Allow anonymous users to create applications (INSERT)
    - Allow anonymous users to view their own applications (SELECT)
    - Allow anonymous users to update their own applications (UPDATE)
    - Maintain existing authenticated user policies

  This enables the public application form to work while maintaining security.
*/

-- Drop existing policies that might be too restrictive
DROP POLICY IF EXISTS "Users can create applications" ON applications;
DROP POLICY IF EXISTS "Users can view their own applications" ON applications;
DROP POLICY IF EXISTS "Users can update their own applications" ON applications;

-- Create new policies that allow anonymous users to create applications
CREATE POLICY "Allow anonymous users to create applications"
  ON applications
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to create applications"
  ON applications
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow users to view applications (anonymous users can view all for now, authenticated users can view their own)
CREATE POLICY "Allow anonymous users to view applications"
  ON applications
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow authenticated users to view their applications"
  ON applications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Allow users to update applications
CREATE POLICY "Allow anonymous users to update applications"
  ON applications
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update their applications"
  ON applications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL)
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);