import type { Metadata } from 'next';
import { TOTE_FONTS } from '@/components/ToteBrand';
import QuoteForm from './QuoteForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Free junk removal quote for tote renters — Sanchez Junk & Haul Co.', robots: { index: false } };

/** PUBLIC: the QR sticker on every tote lands here (sanchezhaulco.com/q?t=T-014 forwards). Three fields, the tote renter offer, tap to text. */
export default function QPage({ searchParams }: { searchParams: { t?: string } }) {
  return (<><link rel="stylesheet" href={TOTE_FONTS} /><QuoteForm tag={(searchParams.t ?? '').toUpperCase().slice(0, 12)} /></>);
}
