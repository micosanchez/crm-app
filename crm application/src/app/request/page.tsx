import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/admin';
import { BIZ, type Biz } from '@/components/EstimateDocument';
import RequestForm from './RequestForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Request an estimate — Sanchez Junk & Haul Co.',
  description: 'Tell us what needs to go and send a few photos. We text you a price, usually the same day.',
  robots: { index: true, follow: true },
};

/**
 * PUBLIC — no session, no app chrome (Nav and BackButton both stand down for
 * /request, same as the signing pages).
 *
 * The letterhead is read with the service-role client because business_settings
 * is staff-readable and there's no token to hang a security-definer RPC off
 * here. Only the public identity fields are passed to the browser.
 */
export default async function RequestPage({ searchParams }: {
  searchParams: { ref?: string };
}) {
  const admin = createAdminClient();
  let biz: Biz = { ...BIZ };

  if (admin) {
    const { data } = await admin
      .from('business_settings')
      .select('business_name,tagline,phone,email,website,service_area,licensed_insured,ein')
      .eq('id', true)
      .maybeSingle();
    if (data) {
      biz = {
        name: data.business_name ?? BIZ.name,
        tagline: data.tagline ?? BIZ.tagline,
        phone: data.phone ?? BIZ.phone,
        email: data.email ?? BIZ.email,
        website: data.website ?? BIZ.website,
        area: data.service_area ?? BIZ.area,
        licensed_insured: data.licensed_insured ?? BIZ.licensed_insured,
        ein: data.ein ?? BIZ.ein,
      };
    }
  }

  return (
    <RequestForm
      biz={biz}
      leadRef={(searchParams.ref ?? '').slice(0, 40)}
      turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null}
    />
  );
}
