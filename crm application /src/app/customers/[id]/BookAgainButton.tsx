'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from '@/lib/offline/sync';
import type { Customer } from '@/lib/types';

/** One-tap repeat booking — creates a job pre-filled from the customer.
 *  Goes through the offline queue like every other create, so it still works
 *  (queues + syncs later) on spotty field signal instead of erroring. */
export default function BookAgainButton({ customer }: { customer: Customer }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function book() {
    setBusy(true);
    const res = await mutate({
      table: 'jobs', op: 'insert', label: 'repeat job',
      payload: {
        customer_id: customer.id,
        title: `${customer.name} — repeat job`,
        address: customer.address,
        status: 'lead',
      },
    });
    setBusy(false);
    if (res.status === 'failed') { alert(`Couldn't create job: ${res.error}`); return; }
    router.refresh(); // new job appears in this customer's job list (or syncs when back online)
  }

  return (
    <button className="btn-primary" disabled={busy} onClick={book}>
      {busy ? 'Creating…' : 'Book again'}
    </button>
  );
}
