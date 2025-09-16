/*
  # Align lender_submissions.status CHECK constraint with UI/client values
  - Ensures allowed values: pending, approved, declined, counter-offer, funded
*/

ALTER TABLE lender_submissions
  DROP CONSTRAINT IF EXISTS lender_submissions_status_check;

ALTER TABLE lender_submissions
  ADD CONSTRAINT lender_submissions_status_check
  CHECK (status IN ('pending','approved','declined','counter-offer','funded'));
