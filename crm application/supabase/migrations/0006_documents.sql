-- ============================================================
-- SJHC Phase 5: document management with expiration tracking
-- ============================================================

create type document_category as enum (
  'insurance','vehicle_registration','permit','contract',
  'employee_record','vendor','tax','other'
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category document_category not null default 'other',
  file_path text not null,           -- storage path in the private documents bucket
  expires_on date,
  notes text,
  archived boolean not null default false,  -- soft delete per PRD
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_cat_idx on public.documents(category);
create index documents_exp_idx on public.documents(expires_on) where expires_on is not null;

create trigger documents_touch before update on public.documents
  for each row execute function public.touch_updated_at();
create trigger documents_log after insert or update or delete on public.documents
  for each row execute function public.log_activity();

alter table public.documents enable row level security;

-- Sensitive business records: admin/dispatcher only
create policy documents_admin on public.documents for all to authenticated
  using (public.app_role() in ('admin','dispatcher'))
  with check (public.app_role() in ('admin','dispatcher'));

-- Private storage bucket (no public URLs — files served via signed URLs)
insert into storage.buckets (id, name, public) values ('documents','documents', false)
  on conflict (id) do nothing;

create policy documents_storage on storage.objects for all to authenticated
  using (bucket_id = 'documents' and public.app_role() in ('admin','dispatcher'))
  with check (bucket_id = 'documents' and public.app_role() in ('admin','dispatcher'));
