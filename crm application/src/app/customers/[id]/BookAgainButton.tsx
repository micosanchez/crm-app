'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Customer } from '@/lib/types';

/** One-tap repeat booking — creates a job pre-filled from the customer. */
export default function BookAgainButton({ customer }: { customer: Customer }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function book() {
    setBusy(true);
    const supabase = createClient();
    const { data: job, error } = await supabase.from('jobs').insert({
      customer_id: customer.id,
      title: `${customer.name} — repeat job`,
      address: customer.address,
      status: 'lead',
    }).select().single();
    setBusy(false);
    if (error) { alert(`Couldn't create job: ${error.message}`); return; }
    if (job) router.push(`/jobs/${job.id}`);
  }

  return (
    <button className="btn-primary" disabled={busy} onClick={book}>
      {busy ? 'Creating…' : 'Book again'}
    </button>
  );
}
