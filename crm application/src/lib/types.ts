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
  lead_source?: string | null;
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

export type PaymentMethod = 'cash' | 'venmo' | 'card' | 'check' | 'other';

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
export type LeadSource = 'google' | 'facebook' | 'referral' | 'yard_sign' | 'website' | 'repeat_customer' | 'other';
export type EstimateStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';
export type ExpenseCategory = 'dump_fees' | 'fuel' | 'payroll' | 'equipment_purchase' | 'equipment_repair' | 'vehicle_repair' | 'insurance' | 'marketing' | 'office' | 'software' | 'utilities' | 'permits' | 'misc';

export const LEAD_PIPELINE: LeadStatus[] = ['new', 'contacted', 'estimate_sent', 'accepted', 'scheduled', 'won', 'lost'];
export const LEAD_SOURCES: LeadSource[] = ['google', 'facebook', 'referral', 'yard_sign', 'website', 'repeat_customer', 'other'];
export const EXPENSE_CATEGORIES: ExpenseCategory[] = ['dump_fees', 'fuel', 'payroll', 'equipment_purchase', 'equipment_repair', 'vehicle_repair', 'insurance', 'marketing', 'office', 'software', 'utilities', 'permits', 'misc'];

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

export interface Expense {
  id: string;
  category: ExpenseCategory;
  amount: number;
  incurred_on: string;
  vendor: string | null;
  description: string | null;
  job_id: string | null;
  receipt_url: string | null;
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
