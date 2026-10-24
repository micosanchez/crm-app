import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import RentalsNav from '../RentalsNav';
import { prettyDate } from '@/lib/rentals/format';

export const dynamic = 'force-dynamic';

export default async function WaitlistPage() {
  await requireStaff();
  const supabase = createClient();
  const { data } = await supabase.from('rental_waitlist').select('*').order('created_at');
  return (
    <div className="space-y-4">
      <div><p className="panel-label">Rentals</p><h1 className="text-2xl">Waitlist</h1><p className="text-sm text-gray-500">When totes free up for someone&apos;s dates, the cron texts the first person on the list a booking link (one text each).</p></div>
      <RentalsNav active="/rentals/waitlist" />
      <table className="w-full text-sm"><thead><tr className="text-left text-xs text-gray-500"><th>Name</th><th>Phone</th><th>Dates</th><th>Totes</th><th>Texted</th><th>Booked</th></tr></thead><tbody>
        {(data ?? []).map((w) => <tr key={w.id} className="border-t"><td className="py-1">{w.name}</td><td><a className="underline" href={`sms:${w.phone}`}>{w.phone}</a></td><td>{prettyDate(w.start_date)} – {prettyDate(w.end_date)}</td><td>{w.tote_count}</td><td>{w.notified_at ? new Date(w.notified_at).toLocaleString() : '—'}</td><td>{w.booked_rental_id ? 'yes' : '—'}</td></tr>)}
        {!data?.length && <tr><td colSpan={6} className="py-4 text-gray-400">Nobody waiting.</td></tr>}
      </tbody></table>
    </div>
  );
}
