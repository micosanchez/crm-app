import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import NewCustomerForm from './NewCustomerForm';
import type { Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({ searchParams }: { searchParams: { q?: string } }) {
  const supabase = createClient();
  let query = supabase.from('customers').select('*').order('updated_at', { ascending: false }).limit(200);
  if (searchParams.q) {
    const q = searchParams.q.trim();
    query = query.or(`name.ilike.%${q}%,phone.ilike.%${q.replace(/[^\d+]/g, '') || q}%,email.ilike.%${q}%`);
  }
  const { data: customers } = await query;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Customers</h1>
      </div>
      <form className="flex gap-2">
        <input className="input max-w-xs" name="q" placeholder="Search name, phone, or email…" defaultValue={searchParams.q ?? ''} />
        <button className="btn-ghost">Search</button>
      </form>
      <NewCustomerForm />
      <div className="grid gap-2 md:grid-cols-2">
        {(customers as Customer[] | null)?.map((c) => (
          <Link key={c.id} href={`/customers/${c.id}`} className="card hover:border-brand-500">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold">{c.name}</p>
                <p className="text-sm text-gray-500">{c.phone ?? '—'} · {c.city ?? ''}</p>
              </div>
              <div className="flex flex-wrap justify-end gap-1">
                {c.tags.map((t) => (
                  <span key={t} className="badge bg-brand-50 text-brand-700">{t.replace('_', ' ')}</span>
                ))}
              </div>
            </div>
          </Link>
        ))}
        {!customers?.length && <p className="text-sm text-gray-500">No customers yet — add your first above.</p>}
      </div>
    </div>
  );
}
