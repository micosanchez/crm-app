import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import RentalsNav from '../RentalsNav';
import { Cluster, Cell } from '@/components/Hud';
import InventoryManager from './InventoryManager';

export const dynamic = 'force-dynamic';

export default async function InventoryPage() {
  await requireStaff();
  const supabase = createClient();
  const [{ data: assets }, { data: onRental }] = await Promise.all([
    supabase.from('rental_assets').select('*').order('asset_type').order('asset_tag'),
    supabase.from('rental_items').select('asset_id, rentals(id, rental_number, customers(name))').is('checked_in_at', null),
  ]);
  const where = new Map<string, { id: string; rental_number: string; customer: string }>();
  for (const i of onRental ?? []) { const r = i.rentals as unknown as { id: string; rental_number: string; customers: { name: string } | null } | null; if (r) where.set(i.asset_id, { id: r.id, rental_number: r.rental_number, customer: r.customers?.name ?? '' }); }
  const totes = (assets ?? []).filter((a) => a.asset_type === 'tote');
  const n = (s: string) => totes.filter((a) => a.status === s).length;
  return (
    <div className="space-y-4">
      <div><p className="panel-label">Rentals</p><h1 className="text-2xl">Inventory</h1></div>
      <RentalsNav active="/rentals/inventory" />
      <Cluster cols="grid-cols-3 sm:grid-cols-6">
        <Cell label="Totes" value={String(totes.length)} /><Cell label="Available" value={String(n('available'))} tone="var(--status-success)" /><Cell label="Out" value={String(n('out'))} /><Cell label="Dirty" value={String(n('returned_dirty'))} /><Cell label="Damaged" value={String(n('damaged'))} tone="var(--status-danger)" /><Cell label="Lost" value={String(n('lost'))} tone="var(--status-danger)" />
      </Cluster>
      <InventoryManager assets={(assets ?? []).map((a) => ({ ...a, on: where.get(a.id) ?? null }))} />
    </div>
  );
}
