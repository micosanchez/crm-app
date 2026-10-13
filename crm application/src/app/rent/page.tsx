import type { Metadata } from 'next';
import BookingFlow from './BookingFlow';
import { TOTE_FONTS } from '@/components/ToteBrand';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Rent moving totes — Sanchez Junk & Haul Co.',
  description: 'Rent sturdy moving totes delivered to your door in Lincoln Park, Taylor, Allen Park and Downriver MI. Pick your dates, we deliver and pick up.',
  robots: { index: true, follow: true },
};

/** PUBLIC booking page. Also embeddable: /rent?embed=1 inside an iframe on sanchezhaulco.com/totes. */
export default function RentPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  return (
    <>
      <link rel="stylesheet" href={TOTE_FONTS} />
      <BookingFlow initial={{ package: searchParams.package ?? null, date: searchParams.date ?? null, embed: searchParams.embed === '1', resume: searchParams.resume ?? null, token: searchParams.token ?? null, promo: searchParams.code ?? searchParams.promo ?? null,
        utm: { source: searchParams.utm_source ?? null, medium: searchParams.utm_medium ?? null, campaign: searchParams.utm_campaign ?? null, ref: searchParams.ref ?? null, fbclid: searchParams.fbclid ?? null, gclid: searchParams.gclid ?? null } }} />
    </>
  );
}
