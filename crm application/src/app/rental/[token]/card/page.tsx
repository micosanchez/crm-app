import UpdateCard from './UpdateCard';
import { TOTE_FONTS } from '@/components/ToteBrand';

export const dynamic = 'force-dynamic';

/** PUBLIC: replace the saved card with a Stripe SetupIntent (off_session). */
export default function CardPage({ params }: { params: { token: string } }) {
  return (<><link rel="stylesheet" href={TOTE_FONTS} /><UpdateCard token={params.token} /></>);
}
