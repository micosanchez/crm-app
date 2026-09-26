'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from '@/lib/offline/sync';
import { SERVICE_TYPES, type Customer, type JobServiceType } from '@/lib/types';

/** One-tap repeat booking — creates a job pre-filled from the customer.
 *  Goes through the offline queue like every other create, so it still works
 *  (queues + syncs later) on spotty field signal instead of erroring. */
export default function BookAgainButton({ customer }: { customer: Customer }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  async function book(serviceType: JobServiceType) {
    setBusy(true);
    const res = await mutate({
      table: 'jobs', op: 'insert', label: 'repeat job',
      payload: {
        customer_id: customer.id,
        title: `${customer.name} — repeat job`,
        address: customer.address,
        status: 'lead',
        service_type: serviceType,
        lead_source: 'repeat_customer',
      },
    });
    setBusy(false);
    if (res.status === 'failed') { alert(`Couldn't create job: ${res.error}`); return; }
    setPicking(false);
    router.refresh(); // new job appears in this customer's job list (or syncs when back online)
  }

  if (picking) {
    return (
      <select className="input w-auto" autoFocus disabled={busy} defaultValue="" onChange={(e) => e.target.value && book(e.target.value as JobServiceType)} onBlur={() => !busy && setPicking(false)}>
        <option value="">What kind of job?</option>
        {SERVICE_TYPES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
      </select>
    );
  }
  return (
    <button className="btn-primary" disabled={busy} onClick={() => setPicking(true)}>
      {busy ? 'Creating…' : 'Book again'}
    </button>
  );
}
