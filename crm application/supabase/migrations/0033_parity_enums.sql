-- 0033 Parity rebuild — enum extensions.
-- Each ADD VALUE must be committed before the value is used, so this file runs
-- FIRST and alone. Everything else is in 0034+.

alter type public.lead_source add value if not exists 'instagram';
alter type public.lead_source add value if not exists 'google_ads';
alter type public.estimate_status add value if not exists 'cancelled';
