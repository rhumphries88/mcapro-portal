/*
  # Add APPROVED status to applications

  1. Changes
    - Update the status check constraint to include 'approved' status
    - This allows applications to have an 'approved' status in addition to existing statuses

  2. Security
    - No changes to RLS policies needed
    - Existing policies will work with the new status
*/

-- Update the status constraint to include 'approved'
ALTER TABLE applications 
DROP CONSTRAINT IF EXISTS applications_status_check;

ALTER TABLE applications 
ADD CONSTRAINT applications_status_check 
CHECK (status = ANY (ARRAY['draft'::text, 'submitted'::text, 'under-review'::text, 'approved'::text, 'funded'::text, 'declined'::text]));