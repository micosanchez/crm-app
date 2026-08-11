'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/* Guarded hard-delete for a single record. Online-only (so the DB can enforce
   foreign-key guards and report them), double-confirm, and friendly errors:
   a record still linked to others (customer with jobs, job with an invoice…)
   is refused by the DB's ON DELETE RESTRICT rather than silently orphaning data. */
export default function DeleteRecordButton({
  table, id, redirectTo, label, confirmMessage, className = 'btn-ghost', linkedHint,
}: {
  table: string;
  id: string;
  redirectTo: string;
  label: string;              // e.g. "quote", "customer", "job", "invoice"
  confirmMessage?: string;
  className?: string;
  linkedHint?: string;        // what to remove first, shown when a link blocks the delete
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!window.confirm(confirmMessage ?? `Delete this ${label}? This can’t be undone.`)) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      alert('You need to be online to delete.');
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from(table).delete().eq('id', id);
    setBusy(false);
    if (error) {
      const linked = /foreign key|violates|referenced|constraint/i.test(error.message);
      alert(linked
        ? `This ${label} is linked to other records, so it can’t be deleted.${linkedHint ? ` ${linkedHint}` : ' Remove or reassign those first.'}`
        : `Couldn’t delete: ${error.message}`);
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <button type="button" onClick={del} disabled={busy} className={className} style={{ color: 'var(--status-danger)' }}>
      {busy ? 'Deleting…' : `Delete ${label}`}
    </button>
  );
}
