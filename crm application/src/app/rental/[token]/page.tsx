import type { Metadata } from 'next';
import RentalPortal from './RentalPortal';
import { TOTE_FONTS } from '@/components/ToteBrand';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your tote rental — Sanchez Junk & Haul Co.', robots: { index: false, follow: false } };

/** PUBLIC (secure link per rental): status, dates, items, agreement, receipts, extend / reschedule / update card. */
export default function RentalPage({ params }: { params: { token: string } }) {
  return (<><link rel="stylesheet" href={TOTE_FONTS} /><RentalPortal token={params.token} /></>);
}
