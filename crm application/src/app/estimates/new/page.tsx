import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { flags } from '@/lib/flags';
import { REQUEST_PHOTOS_BUCKET, type EstimateRequest } from '@/lib/requests';
import QuoteComposer, {
  type ComposerCustomer, type ComposerSettings, type ComposerPriceItem, type ComposerPrefill,
} from '../QuoteComposer';

export const dynamic = 'force-dynamic';

/** First line of the description becomes the suggested job title. */
function suggestTitle(description: string): string {
  const first = (description || '').split(/[\n.!?]/)[0]!.trim();
  if (!first) return '';
  return first.length > 60 ? `${first.slice(0, 57)}…` : first;
}

export default async function NewQuotePage({ searchParams }: {
  searchParams: { request?: string };
}) {
  await requireStaff();
  const supabase = createClient();
  const [{ data: customers }, { data: settings }, { data: priceItems }] = await Promise.all([
    supabase.from('customers').select('id,name,phone,address').order('name'),
    supabase.from('business_settings').select('*').eq('id', true).maybeSingle(),
    supabase.from('service_items').select('id,name,default_price,description').eq('active', true).order('name'),
  ]);

  const s: ComposerSettings = {
    default_valid_days: settings?.default_valid_days ?? 14,
    default_line_item: settings?.default_line_item ?? null,
    default_payment_terms: settings?.default_payment_terms ?? null,
    default_additional_terms: settings?.default_additional_terms ?? null,
    business_name: settings?.business_name ?? null,
    tagline: settings?.tagline ?? null,
    phone: settings?.phone ?? null,
    email: settings?.email ?? null,
    website: settings?.website ?? null,
    service_area: settings?.service_area ?? null,
    licensed_insured: settings?.licensed_insured ?? null,
    ein: settings?.ein ?? null,
  };

  // Building from an accepted request: carry the customer, their own words, and
  // their photos straight into the composer so nothing gets retyped.
  let prefill: ComposerPrefill | undefined;
  let requestId: string | undefined;
  let requestPhotos: string[] = [];
  let backHref = '/estimates';
  let backLabel = 'Estimates';

  if (flags.requests && searchParams.request) {
    const { data } = await supabase
      .from('estimate_requests')
      .select('*')
      .eq('id', searchParams.request)
      .maybeSingle();
    const r = data as EstimateRequest | null;
    if (r?.customer_id) {
      requestId = r.id;
      prefill = {
        customerId: r.customer_id,
        lineItem: suggestTitle(r.description),
        description: r.description,
      };
      backHref = `/estimates/requests/${r.id}`;
      backLabel = 'Request';

      const paths = (Array.isArray(r.photos) ? r.photos : []).map((p) => p.path);
      if (paths.length) {
        const { data: signed } = await supabase.storage
          .from(REQUEST_PHOTOS_BUCKET)
          .createSignedUrls(paths, 60 * 30);
        requestPhotos = (signed ?? []).flatMap((x) => (x.signedUrl ? [x.signedUrl] : []));
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="no-print">
        <Link href={backHref} className="text-sm text-brand-600 hover:underline">← {backLabel}</Link>
      </div>
      <QuoteComposer
        customers={(customers ?? []) as ComposerCustomer[]}
        settings={s}
        priceItems={(priceItems ?? []) as ComposerPriceItem[]}
        prefill={prefill}
        requestId={requestId}
        requestPhotos={requestPhotos}
      />
    </div>
  );
}
