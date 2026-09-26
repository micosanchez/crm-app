-- 0041 — Business-metrics upgrade (2026-09-26): enum additions.
-- Postgres requires ADD VALUE to commit before the value is used, so this file
-- runs FIRST and alone. Everything else is in 0042+. Additive; nothing removed.

-- Expense categories: 13 existing + 8 new (spec 1.1)
alter type public.expense_category add value if not exists 'job_supplies';
alter type public.expense_category add value if not exists 'crew_meals';
alter type public.expense_category add value if not exists 'dumpster_rental';
alter type public.expense_category add value if not exists 'payment_processing';
alter type public.expense_category add value if not exists 'bank_fees';
alter type public.expense_category add value if not exists 'vehicle_mileage';
alter type public.expense_category add value if not exists 'owner_draw';
alter type public.expense_category add value if not exists 'personal';

-- Lead sources (spec 3.2). Existing: google, google_ads, facebook, instagram, referral,
-- yard_sign, website, repeat_customer, other. The old names stay valid.
alter type public.lead_source add value if not exists 'google_business_profile';
alter type public.lead_source add value if not exists 'google_search_organic';
alter type public.lead_source add value if not exists 'website_direct';
alter type public.lead_source add value if not exists 'facebook_organic_page';
alter type public.lead_source add value if not exists 'facebook_group_post';
alter type public.lead_source add value if not exists 'meta_ads';
alter type public.lead_source add value if not exists 'facebook_marketplace';
alter type public.lead_source add value if not exists 'nextdoor';
alter type public.lead_source add value if not exists 'commercial_account';
alter type public.lead_source add value if not exists 'truck_trailer_signage';
alter type public.lead_source add value if not exists 'yard_sign_flyer';
alter type public.lead_source add value if not exists 'unknown';

-- Lead pipeline statuses (spec 3.1). Existing: new, contacted, estimate_sent, accepted,
-- scheduled, won, lost.
alter type public.lead_status add value if not exists 'quoted';
alter type public.lead_status add value if not exists 'booked';
alter type public.lead_status add value if not exists 'spam';
alter type public.lead_status add value if not exists 'not_a_fit';

-- New enums (created whole, so no ordering issue)
do $$ begin
  create type public.expense_class as enum ('direct_job_cost','overhead','capital','owner_draw','personal');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.job_kind as enum ('customer','internal');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.date_precision as enum ('exact','month');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.labor_activity as enum ('on_job','drive','dump_run','site_visit_quote','quoting_admin','marketing','bookkeeping','other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.job_service_type as enum ('single_item','furniture','appliance','mattress','hot_tub','garage_cleanout','basement_cleanout','estate_cleanout','whole_home_cleanout','yard_waste','construction_debris','demo','commercial_cleanout','property_turnover','other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.hauling_unit as enum ('truck_bed','trailer_6x12','dumpster','multiple');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.access_flag as enum ('stairs','basement','long_carry','tight_access','second_floor','no_driveway_access');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.cancel_reason as enum ('customer_cancelled','no_show','price','scheduling','weather','hazmat_scope','went_with_competitor','other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.dump_material as enum ('mixed_junk','yard_waste','concrete_brick','metal','mattresses','tires','other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.customer_segment as enum ('residential','landlord','property_manager','realtor','commercial','nonprofit','contractor','other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.lead_channel as enum ('phone_call','text','web_form','facebook_dm','instagram_dm','marketplace','email','in_person','referral_intro');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.not_a_fit_reason as enum ('hazmat','labor_only','out_of_area','too_small','other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.quote_loss_reason as enum ('price_too_high','went_with_competitor','did_it_themselves','city_bulk_pickup','timing_scheduling','scope_changed','no_response_ghosted','hazmat_or_out_of_scope','deposit_required','other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.review_platform as enum ('google','facebook','nextdoor','yelp');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.account_kind as enum ('property_manager','landlord','realtor','apartment_complex','business','nonprofit_league','contractor','other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.account_stage as enum ('prospect','contacted','meeting','trial_job','active','inactive');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.recurring_cadence as enum ('none','weekly','biweekly','monthly','per_turnover');
exception when duplicate_object then null; end $$;
