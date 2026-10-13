import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import RentalDetail from './RentalDetail';
import { TEST_CARDS, isTestMode } from '@/lib/rentals/stripe';

export const dynamic = 'force-dynamic';

export default async function RentalDetailPage({ params }: { params: { id: string } }) {
  await requireStaff();
  const supabase = createClient();
  const [{ data: rental }, { data: items }, { data: charges }, { data: agreement }, { data: events }, { data: addons }, { data: assets }, { data: settings }, { data: messages }, { data: junk }] = await Promise.all([
    supabase.from('rentals').select('*, customers(id,name,phone,email), rental_packages(name, extra_week_price), rental_partners(name, referral_code)').eq('id', params.id).single(),
    supabase.from('rental_items').select('*, rental_assets(asset_tag, asset_type, status)').eq('rental_id', params.id),
    supabase.from('rental_charges').select('*').eq('rental_id', params.id).order('created_at'),
    supabase.from('rental_agreements').select('*').eq('rental_id', params.id).order('signed_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('rental_events').select('*').eq('rental_id', params.id).order('created_at', { ascending: false }).limit(60),
    supabase.from('rental_addon_lines').select('qty, unit_price, rental_addons(name)').eq('rental_id', params.id),
    supabase.from('rental_assets').select('asset_tag, asset_type, status').in('status', ['available', 'reserved']).order('asset_tag'),
    supabase.from('rental_settings').select('*').eq('id', true).single(),
    supabase.from('rental_messages').select('template, channel, status, scheduled_at, sent_at, error').eq('rental_id', params.id).order('scheduled_at', { ascending: false }).limit(30),
    supabase.from('estimate_requests').select('id, status, quote_id').eq('rental_id', params.id).limit(1).maybeSingle(),
  ]);
  if (!rental) notFound();
  let pdfUrl: string | null = null;
  const admin = createAdminClient();
  if (admin && agreement?.pdf_url) { const { data } = await admin.storage.from('documents').createSignedUrl(agreement.pdf_url, 3600); pdfUrl = data?.signedUrl ?? null; }
  return <RentalDetail rental={rental} items={items ?? []} charges={charges ?? []} agreement={agreement ? { ...agreement, pdf_signed_url: pdfUrl } : null} events={events ?? []} addons={addons ?? []} freeAssets={assets ?? []} settings={settings} messages={messages ?? []} junk={junk ?? null} testMode={isTestMode()} testCards={TEST_CARDS} />;
}
