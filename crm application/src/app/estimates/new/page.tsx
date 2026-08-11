import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import QuoteComposer, { type ComposerCustomer, type ComposerSettings } from '../QuoteComposer';

export const dynamic = 'force-dynamic';

export default async function NewQuotePage() {
  await requireStaff();
  const supabase = createClient();
  const [{ data: customers }, { data: settings }] = await Promise.all([
    supabase.from('customers').select('id,name,phone,address').order('name'),
    supabase.from('business_settings').select('default_valid_days,default_line_item,default_payment_terms,default_additional_terms').eq('id', true).maybeSingle(),
  ]);

  const s: ComposerSettings = {
    default_valid_days: settings?.default_valid_days ?? 14,
    default_line_item: settings?.default_line_item ?? null,
    default_payment_terms: settings?.default_payment_terms ?? null,
    default_additional_terms: settings?.default_additional_terms ?? null,
  };

  return (
    <div className="space-y-4">
      <div className="no-print">
        <Link href="/estimates" className="text-sm text-brand-600 hover:underline">← Estimates</Link>
      </div>
      <QuoteComposer customers={(customers ?? []) as ComposerCustomer[]} settings={s} />
    </div>
  );
}
