import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface Snapshot {
  id: string;
  kind: 'estimate' | 'invoice';
  doc_number: number;
  customer_name: string | null;
  total: number | null;
  signed_name: string;
  signed_at: string;
}

/** Permanent record of every signed estimate & invoice — frozen at signing. */
export default async function SignaturesPage() {
  await requireStaff();
  const supabase = createClient();
  const { data } = await supabase
    .from('document_snapshots')
    .select('id, kind, doc_number, customer_name, total, signed_name, signed_at')
    .order('signed_at', { ascending: false })
    .limit(200);
  const snaps = (data ?? []) as Snapshot[];

  return (
    <div className="space-y-4">
      <div>
        <p className="panel-label">Signatures</p>
        <h1 className="text-2xl">Signed documents</h1>
        <p className="mt-1 text-sm text-gray-500">
          A permanent copy of every signed estimate and invoice, exactly as it was approved.
          These records never change, even if the original document is edited later.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg" style={{ border: '1px solid var(--border-subtle)' }}>
        {snaps.map((s) => (
          <Link key={s.id} href={`/signatures/${s.id}`}
            className="flex items-center justify-between gap-3 bg-surface px-4 py-3 transition-colors duration-fast hover:bg-[var(--bg-tertiary)]"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="min-w-0">
              <p className="truncate font-medium text-gray-900">
                {s.kind === 'invoice' ? `Invoice #INV${s.doc_number}` : `Estimate #EST${s.doc_number}`}
                {s.customer_name ? ` — ${s.customer_name}` : ''}
              </p>
              <p className="panel-label mt-0.5 normal-case" style={{ letterSpacing: 0 }}>
                Signed by {s.signed_name} · {new Date(s.signed_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </p>
            </div>
            <div className="shrink-0 text-right">
              {s.total != null && <p className="metric font-semibold text-gray-900">${Number(s.total).toFixed(2)}</p>}
              <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--status-success)' }}>✓ Signed</p>
            </div>
          </Link>
        ))}
        {!snaps.length && (
          <p className="px-4 py-8 text-center text-sm text-gray-500">
            No signed documents yet. When a customer signs an estimate or invoice link, a permanent copy lands here.
          </p>
        )}
      </div>
    </div>
  );
}
