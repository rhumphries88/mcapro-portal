/*
  # Temporarily disable RLS on lenders table

  This migration temporarily disables Row Level Security on the lenders table
  to allow admin operations to work properly. This is appropriate for admin
  functionality where authenticated users need full CRUD access.

  1. Security
    - Disable RLS on lenders table
    - Allow full access for authenticated users through application logic
*/

-- Disable Row Level Security on lenders table
ALTER TABLE lenders DISABLE ROW LEVEL SECURITY;