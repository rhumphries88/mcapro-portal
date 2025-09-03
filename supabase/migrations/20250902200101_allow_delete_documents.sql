-- Add delete policy for application_documents so authenticated users can delete their own docs
-- Note: You may further restrict this using ownership checks if available.

begin;

-- Grant delete privilege to authenticated role (RLS will still apply)
grant delete on table public.application_documents to authenticated;

-- RLS policy to allow delete by any authenticated user
create policy "allow delete for authenticated"
  on public.application_documents
  for delete
  to authenticated
  using (true);

commit;
