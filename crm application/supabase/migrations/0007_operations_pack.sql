-- ============================================================
-- SJHC Phase 7: Operations Pack
-- ============================================================

alter table public.leads
  add column follow_up_on date,
  add column reason_lost text;

create index leads_followup_idx on public.leads(follow_up_on)
  where follow_up_on is not null;
