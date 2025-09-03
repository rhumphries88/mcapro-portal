-- Create table: application_documents
create table if not exists public.application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  file_name text not null,
  file_size bigint,
  file_type text,
  statement_date date,
  file_url text,
  extracted_json jsonb,
  created_at timestamptz not null default now()
);

-- Index for faster lookups by application
create index if not exists application_documents_application_id_idx
  on public.application_documents (application_id);

-- Enable Row Level Security
alter table public.application_documents enable row level security;

-- Policies
-- Read policy: allow all authenticated users to read documents.
-- If you need to restrict to application owners, replace with a join against applications.user_id.
create policy if not exists "Read application documents"
  on public.application_documents
  for select
  to authenticated
  using (true);

-- Insert policy: typically inserts come from server-side service key; allow authenticated for convenience.
create policy if not exists "Insert application documents"
  on public.application_documents
  for insert
  to authenticated
  with check (true);

-- Update/Delete policies (optional). Restrict by default; uncomment if needed.
-- create policy "Update application documents" on public.application_documents for update to authenticated using (true) with check (true);
-- create policy "Delete application documents" on public.application_documents for delete to authenticated using (true);

-- Grant minimal privileges
grant usage on schema public to anon, authenticated;
grant select on public.application_documents to anon, authenticated;
