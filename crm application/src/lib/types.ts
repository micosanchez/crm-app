export type UserRole = 'admin' | 'dispatcher' | 'technician';
export type JobStatus = 'lead' | 'scheduled' | 'in_progress' | 'completed' | 'invoiced' | 'paid' | 'cancelled';
export type InvoiceStatus = 'draft' | 'sent' | 'paid';
export type CustomerTag = 'residential' | 'commercial' | 'repeat' | 'high_value';
export type ServiceType = 'junk_removal' | 'landscaping' | 'other';

/** Forward pipeline only — 'cancelled' is a side exit, never a column/next step. */
export const JOB_PIPELINE: JobStatus[] = ['lead', 'scheduled', 'in_progress', 'completed', 'invoiced', 'paid'];

export interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
}

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  notes: string | null;
  tags: CustomerTag[];
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  customer_id: string;
  title: string;
  description: string | null;
  service: ServiceType;
  status: JobStatus;
  scheduled_start: string | null;
  scheduled_end: string | null;
  address: string | null;
  estimated_value: number | null;
  /** Computed (not a DB column): sum of this job's non-draft invoice totals, or
   *  null when it hasn't been invoiced. Lets views show the real billed amount
   *  once a job is invoiced instead of the original estimate. */
  billed_value?: number | null;
  lead_source?: string | null;
  service_type?: JobServiceType | null;
  job_kind?: 'customer' | 'internal';
  is_test?: boolean;
  internal_notes?: string | null;
  cancel_reason?: string | null;
  hauling_unit?: string | null;
  load_fraction?: number | null;
  crew_size?: number | null;
  quoted_price?: number | null;
  photos: { url: string; caption?: string; uploaded_by?: string; uploaded_at?: string }[];
  created_at: string;
  updated_at: string;
  customers?: Pick<Customer, 'id' | 'name' | 'phone' | 'address'>;
}

export interface Invoice {
  id: string;
  invoice_number: number;
  job_id: string;
  customer_id: string;
  status: InvoiceStatus;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  subtotal: number;
  tax_rate: number;
  total: number;
  amount_paid?: number;
  tip?: number;
  voided_at?: string | null;
  void_reason?: string | null;
  deleted_at?: string | null;
  payment_method?: PaymentMethod | null;
  payment_instructions?: string | null;
  comments?: string | null;
  created_at: string;
  public_token?: string;
  signed_name?: string | null;
  signed_at?: string | null;
  viewed_at?: string | null;
  view_count?: number;
  customers?: Pick<Customer, 'id' | 'name' | 'email' | 'address'>;
  invoice_items?: InvoiceItem[];
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  kind: 'labor' | 'disposal' | 'materials' | 'other';
  description: string;
  details?: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
}

export type PaymentMethod = 'cash' | 'check' | 'venmo' | 'cash_app' | 'zelle' | 'stripe_card' | 'stripe_ach' | 'bank_transfer' | 'card' | 'other' | 'unknown_legacy';
/** Methods a person can pick; unknown_legacy is only for the 2025 backfill. */
export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'check', 'venmo', 'cash_app', 'zelle', 'stripe_card', 'stripe_ach', 'bank_transfer', 'other'];

export interface ScheduleEvent {
  id: string;
  job_id: string | null;
  user_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
}

export interface ActivityEntry {
  id: number;
  entity_type: string;
  entity_id: string;
  action_type: string;
  user_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Note {
  id: string;
  entity_type: 'customer' | 'job' | 'invoice';
  entity_id: string;
  body: string;
  author_id: string | null;
  created_at: string;
}

export type LeadStatus = 'new' | 'contacted' | 'estimate_sent' | 'accepted' | 'scheduled' | 'won' | 'lost';
export type LeadSource = 'google_business_profile' | 'google_search_organic' | 'google_ads' | 'website_direct' | 'facebook_organic_page' | 'facebook_group_post' | 'meta_ads' | 'facebook_marketplace' | 'instagram' | 'nextdoor' | 'referral' | 'repeat_customer' | 'commercial_account' | 'truck_trailer_signage' | 'yard_sign_flyer' | 'other' | 'unknown'
  | 'google' | 'facebook' | 'yard_sign' | 'website'; // legacy values still on old rows
export type EstimateStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'cancelled';
export type ExpenseCategory = 'dump_fees' | 'fuel' | 'payroll' | 'equipment_purchase' | 'equipment_repair' | 'vehicle_repair' | 'insurance' | 'marketing' | 'office' | 'software' | 'utilities' | 'permits' | 'misc'
  | 'job_supplies' | 'crew_meals' | 'dumpster_rental' | 'payment_processing' | 'bank_fees' | 'vehicle_mileage' | 'owner_draw' | 'personal';
export type ExpenseClass = 'direct_job_cost' | 'overhead' | 'capital' | 'owner_draw' | 'personal';
export const EXPENSE_CLASSES: ExpenseClass[] = ['direct_job_cost', 'overhead', 'capital', 'owner_draw', 'personal'];
export type JobServiceType = 'single_item' | 'furniture' | 'appliance' | 'mattress' | 'hot_tub' | 'garage_cleanout' | 'basement_cleanout' | 'estate_cleanout' | 'whole_home_cleanout' | 'yard_waste' | 'construction_debris' | 'demo' | 'commercial_cleanout' | 'property_turnover' | 'other';
export const SERVICE_TYPES: JobServiceType[] = ['single_item', 'furniture', 'appliance', 'mattress', 'hot_tub', 'garage_cleanout', 'basement_cleanout', 'estate_cleanout', 'whole_home_cleanout', 'yard_waste', 'construction_debris', 'demo', 'commercial_cleanout', 'property_turnover', 'other'];
export const QUOTE_LOSS_REASONS = ['price_too_high', 'went_with_competitor', 'did_it_themselves', 'city_bulk_pickup', 'timing_scheduling', 'scope_changed', 'no_response_ghosted', 'hazmat_or_out_of_scope', 'deposit_required', 'other'] as const;
export const CANCEL_REASONS = ['customer_cancelled', 'no_show', 'price', 'scheduling', 'weather', 'hazmat_scope', 'went_with_competitor', 'other'] as const;
export const HAULING_UNITS = ['truck_bed', 'trailer_6x12', 'dumpster', 'multiple'] as const;

export const LEAD_PIPELINE: LeadStatus[] = ['new', 'contacted', 'estimate_sent', 'accepted', 'scheduled', 'won', 'lost'];
/** Lead sources a person can pick (0041). Legacy google/facebook/yard_sign/website stay valid on old rows. */
export const LEAD_SOURCES: LeadSource[] = ['google_business_profile', 'google_search_organic', 'google_ads', 'website_direct', 'facebook_organic_page', 'facebook_group_post', 'meta_ads', 'facebook_marketplace', 'instagram', 'nextdoor', 'referral', 'repeat_customer', 'commercial_account', 'truck_trailer_signage', 'yard_sign_flyer', 'other', 'unknown'];
export const EXPENSE_CATEGORIES: ExpenseCategory[] = ['dump_fees', 'dumpster_rental', 'fuel', 'payroll', 'job_supplies', 'crew_meals', 'equipment_purchase', 'equipment_repair', 'vehicle_repair', 'vehicle_mileage', 'insurance', 'marketing', 'office', 'software', 'utilities', 'permits', 'payment_processing', 'bank_fees', 'owner_draw', 'personal', 'misc'];

export interface Lead {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  source: LeadSource;
  status: LeadStatus;
  service: ServiceType;
  est_value: number | null;
  notes: string | null;
  follow_up_on?: string | null;
  reason_lost?: string | null;
  customer_id: string | null;
  job_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Estimate {
  id: string;
  estimate_number: number;
  customer_id: string | null;
  lead_id: string | null;
  job_id: string | null;
  status: EstimateStatus;
  notes: string | null;
  subtotal: number;
  tax_rate: number;
  total: number;
  valid_until: string | null;
  accepted_at: string | null;
  created_at: string;
  payment_instructions?: string | null;
  comments?: string | null;
  line_item?: string | null;
  description?: string | null;
  scheduled_start?: string | null;
  payment_terms?: string | null;
  additional_terms?: string | null;
  internal_notes?: string | null;
  service_type?: JobServiceType | null;
  loss_reason?: string | null;
  is_test?: boolean;
  account_id?: string | null;
  public_token?: string;
  signed_name?: string | null;
  signed_at?: string | null;
  viewed_at?: string | null;
  view_count?: number;
  customers?: Pick<Customer, 'id' | 'name'>;
  estimate_items?: EstimateItem[];
}

export interface EstimateItem {
  id: string;
  estimate_id: string;
  description: string;
  details?: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
}

export type PaidWith = 'bluevine' | 'credit_card' | 'cash' | 'cash_app' | 'venmo' | 'zelle' | 'other';
export const PAID_WITH_OPTIONS: { value: PaidWith; label: string }[] = [
  { value: 'bluevine', label: 'Bluevine' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'cash', label: 'Cash' },
  { value: 'cash_app', label: 'Cash App' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'other', label: 'Other' },
];

export interface Expense {
  id: string;
  category: ExpenseCategory;
  amount: number;
  incurred_on: string;
  vendor: string | null;
  description: string | null;
  job_id: string | null;
  receipt_url: string | null;
  paid_with?: PaidWith;
  expense_class?: ExpenseClass | null;
  is_tax_deductible?: boolean;
  is_pending?: boolean;
  bank_txn_ref?: string | null;
  created_at: string;
  jobs?: Pick<Job, 'id' | 'title'>;
}

/** Tables that may be written through the offline sync queue. */
export type SyncTable =
  | 'customers' | 'jobs' | 'notes' | 'schedule_events' | 'job_assignments'
  | 'invoices' | 'invoice_items' | 'estimates' | 'estimate_items'
  | 'expenses' | 'leads';

export interface ServiceItem {
  id: string;
  name: string;
  description: string | null;
  default_price: number;
  kind: 'labor' | 'disposal' | 'materials' | 'other';
  active: boolean;
}

export interface JobRecurrence {
  id: string;
  customer_id: string;
  title: string;
  service: ServiceType;
  estimated_value: number | null;
  address: string | null;
  interval_days: number;
  next_run: string;
  active: boolean;
  lead_source: string | null;
  customers?: Pick<Customer, 'id' | 'name'>;
}

export interface TimeEntry {
  id: string;
  user_id: string;
  job_id: string | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
  jobs?: Pick<Job, 'id' | 'title'>;
  users?: Pick<UserProfile, 'id' | 'full_name'>;
}

/** One queued offline mutation. */
export interface QueuedAction {
  idempotency_key: string; // uuid generated client-side
  table: SyncTable;
  op: 'insert' | 'update' | 'delete';
  id?: string; // required for update + delete
  payload?: Record<string, unknown>; // omitted for delete
  client_ts: string; // ISO timestamp when action happened (conflict resolution)
  attempts?: number; // failed flush attempts so far
  last_error?: string; // last server error message, if any
  label?: string; // human label for toasts, e.g. "customer", "invoice item"
}

/** Result of a single mutate() call, so callers can react to failures. */
export type MutateResult =
  | { status: 'applied' }          // saved to the server
  | { status: 'queued' }           // saved offline, will sync later
  | { status: 'failed'; error: string }; // rejected by the server
