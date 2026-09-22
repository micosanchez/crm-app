import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth';
import BusinessSettingsForm, { type BusinessSettings } from './BusinessSettingsForm';
import { BIZ } from '@/components/EstimateDocument';

export const dynamic = 'force-dynamic';

// Only used when the business_settings row is missing; identity defaults live in one place.
const DEFAULTS: BusinessSettings = {
  business_name: BIZ.name,
  tagline: BIZ.tagline,
  phone: BIZ.phone,
  email: BIZ.email,
  website: BIZ.website,
  service_area: BIZ.area,
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
