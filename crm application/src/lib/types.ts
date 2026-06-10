export type UserRole = 'admin' | 'dispatcher' | 'technician';
export type JobStatus = 'lead' | 'scheduled' | 'in_progress' | 'completed' | 'invoiced' | 'paid';
export type InvoiceStatus = 'draft' | 'sent' | 'paid';
export type CustomerTag = 'residential' | 'commercial' | 'repeat' | 'high_value';
export type ServiceType = 'junk_removal' | 'landscaping' | 'other';

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
  quantity: number;
  unit_price: number;
  amount: number;
}

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

/** One queued offline mutation. */
export interface QueuedAction {
  idempotency_key: string; // uuid generated client-side
  table: 'customers' | 'jobs' | 'notes' | 'schedule_events' | 'job_assignments';
  op: 'insert' | 'update';
  id?: string; // required for update
  payload: Record<string, unknown>;
  client_ts: string; // ISO timestamp when action happened (conflict resolution)
}
