import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth';
import BusinessSettingsForm, { type BusinessSettings } from './BusinessSettingsForm';

export const dynamic = 'force-dynamic';

const DEFAULTS: BusinessSettings = {
  business_name: 'Sanchez Junk & Haul Co.',
  tagline: 'Remove · Refresh · Reclaim',
  phone: '313-348-3325',
  email: 'sanchezhaulco@gmail.com',
  website: 'sanchezhaulco.com',
  service_area: 'Lincoln Park · Taylor · Allen Park & surrounding Downriver MI',
  mailing_address: null,
  ein: null,
  licensed_insured: true,
  default_valid_days: 14,
  estimate_prefix: 'EST',
  default_line_item: null,
  default_payment_terms: null,
  default_additional_terms: null,
  default_tax_rate: 0,
  default_invoice_due_days: 14,
  default_invoice_payment_instructions: null,
};

export default async function SettingsPage() {
  await requireAdmin();
  const supabase = createClient();
  const { data } = await supabase.from('business_settings').select('*').eq('id', true).maybeSingle();
  const initial = { ...DEFAULTS, ...(data ?? {}) } as BusinessSettings;

  return (
    <div className="mx-auto max-w-3xl">
      <BusinessSettingsForm initial={initial} />
    </div>
  );
}
