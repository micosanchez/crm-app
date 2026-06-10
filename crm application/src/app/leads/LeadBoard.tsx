'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { LEAD_PIPELINE, LEAD_SOURCES, type Lead, type LeadStatus, type LeadSource, type ServiceType } from '@/lib/types';

const LABELS: Record<LeadStatus, string> = {
  new: 'New', contacted: 'Contacted', estimate_sent: 'Estimate sent',
  accepted: 'Accepted', scheduled: 'Scheduled', won: 'Won', lost: 'Lost',
};

export default function LeadBoard({ leads: initial }: { leads: Lead[] }) {
  const router = useRouter();
  const [leads, setLeads] = useState(initial);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', address: '', source: 'google' as LeadSource, service: 'junk_removal' as ServiceType, est_value: '', notes: '' });

  async function moveLead(id: string, status: LeadStatus) {
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status } : l)));
    const supabase = createClient();

    if (status === 'won') {
      // Convert: create customer (if none) so the lead becomes real business
      const lead = leads.find((l) => l.id === id);
      if (lead && !lead.customer_id) {
        const { data: customer } = await supabase
          .from('customers')
          .insert({ name: lead.name, phone: lead.phone, address: lead.address, lead_source: lead.source })
          .select()
          .single();
        if (customer) {
          await supabase.from('leads').update({ status, customer_id: customer.id }).eq('id', id);
          router.refresh();
          return;
        }
      }
    }
    await supabase.from('leads').update({ status }).eq('id', id);
    router.refresh();
  }

  async function addLead(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = createClient();
    await supabase.from('leads').insert({
      name: form.name, phone: form.phone || null, address: form.address || null,
      source: form.source, service: form.service,
      est_value: form.est_value ? Number(form.est_value) : null,
      notes: form.notes || null,
    });
    setBusy(false);
    setOpen(false);
    setForm({ name: '', phone: '', address: '', source: 'google', service: 'junk_removal', est_value: '', notes: '' });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {!open ? (
        <button className="btn-primary" onClick={() => setOpen(true)}>+ New lead</button>
      ) : (
        <form onSubmit={addLead} className="card grid gap-3 md:grid-cols-3">
          <input className="input" placeholder="Name *" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input className="input" placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <select className="input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as LeadSource })}>
            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <select className="input" value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value as ServiceType })}>
            <option value="junk_removal">Junk removal</option>
            <option value="landscaping">Landscaping</option>
            <option value="other">Other</option>
          </select>
          <input className="input" type="number" step="0.01" placeholder="Est. value $" value={form.est_value} onChange={(e) => setForm({ ...form, est_value: e.target.value })} />
          <input className="input md:col-span-2" placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Add lead'}</button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {LEAD_PIPELINE.map((status) => {
          const col = leads.filter((l) => l.status === status);
          return (
            <div key={status}
              className={`min-w-[210px] flex-1 rounded-xl p-2 ${status === 'won' ? 'bg-brand-50' : status === 'lost' ? 'bg-red-50' : 'bg-gray-100'}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dragId && moveLead(dragId, status)}>
              <p className="mb-2 px-1 text-sm font-semibold text-gray-600">{LABELS[status]} <span className="text-gray-400">({col.length})</span></p>
              <div className="space-y-2">
                {col.map((l) => (
                  <div key={l.id} draggable
                    onDragStart={() => setDragId(l.id)}
                    onDragEnd={() => setDragId(null)}
                    className="cursor-grab rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                    <p className="font-medium">{l.name}</p>
                    <p className="text-xs text-gray-500">{l.source.replace('_', ' ')} · {l.service.replace('_', ' ')}</p>
                    {l.est_value != null && <p className="text-xs font-semibold text-brand-700">~${Number(l.est_value).toFixed(0)}</p>}
                    {l.phone && <a className="text-xs text-brand-600 hover:underline" href={`tel:${l.phone}`}>📞 {l.phone}</a>}
                    {status !== 'won' && status !== 'lost' && (
                      <div className="mt-2 flex gap-1">
                        <button className="flex-1 rounded-md bg-gray-100 py-1 text-xs font-medium text-gray-600 hover:bg-brand-50"
                          onClick={() => moveLead(l.id, LEAD_PIPELINE[LEAD_PIPELINE.indexOf(status) + 1])}>
                          → {LABELS[LEAD_PIPELINE[LEAD_PIPELINE.indexOf(status) + 1]]}
                        </button>
                        <button className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500 hover:bg-red-50 hover:text-red-600"
                          onClick={() => moveLead(l.id, 'lost')}>✕</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
