'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import EstimateDocument, { DOC_CSS, type Doc, type Biz } from '@/components/EstimateDocument';
import type { Estimate } from '@/lib/types';

export interface ComposerCustomer { id: string; name: string; phone?: string | null; address?: string | null }
export interface ComposerPriceItem { id: string; name: string; default_price: number; description: string | null }
export interface ComposerSettings {
  default_valid_days: number;
  default_line_item: string | null;
  default_payment_terms: string | null;
  default_additional_terms: string | null;
  business_name?: string | null;
  tagline?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  service_area?: string | null;
  licensed_insured?: boolean | null;
  ein?: string | null;
}

const todayPlus = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + (days || 0));
  return d.toISOString().slice(0, 10);
};

/* Driveway screen. Type a name, describe the job in one line, set a price, save.
   Handles both CREATE (no estimate) and EDIT (existing draft/sent). Writes
   first-class estimate columns (one line item, never itemized). The live preview
   is the SAME component the customer signs on. Internal notes are visually
   locked and never leave this screen. */
export default function QuoteComposer({ customers, settings, estimate, priceItems = [] }: {
  customers: ComposerCustomer[];
  settings: ComposerSettings;
  estimate?: Estimate;
  priceItems?: ComposerPriceItem[];
}) {
  const router = useRouter();
  const editing = !!estimate;

  // Customer: either an existing id, or a new one being typed inline.
  const initialCustomer = estimate?.customer_id ? customers.find((c) => c.id === estimate.customer_id) : null;
  const [query, setQuery] = useState(initialCustomer?.name ?? '');
  const [customerId, setCustomerId] = useState(estimate?.customer_id ?? '');
  const [newCustomer, setNewCustomer] = useState<{ name: string; phone: string; address: string } | null>(null);

  const [lineItem, setLineItem] = useState(estimate?.line_item ?? settings.default_line_item ?? '');
  const [description, setDescription] = useState(estimate?.description ?? '');
  const [price, setPrice] = useState(estimate ? String(estimate.total ?? '') : '');
  const [validUntil, setValidUntil] = useState(estimate?.valid_until ?? todayPlus(settings.default_valid_days ?? 14));
  const [paymentTerms, setPaymentTerms] = useState(estimate?.payment_terms ?? estimate?.payment_instructions ?? settings.default_payment_terms ?? '');
  const [additionalTerms, setAdditionalTerms] = useState(estimate?.additional_terms ?? estimate?.comments ?? settings.default_additional_terms ?? '');
  const [internalNotes, setInternalNotes] = useState(estimate?.internal_notes ?? estimate?.notes ?? '');
  const [termsOpen, setTermsOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const selected = customers.find((c) => c.id === customerId) || null;
  const priceNum = Number(price) || 0;

  const previewBiz: Biz = {
    name: settings.business_name, tagline: settings.tagline, phone: settings.phone, email: settings.email,
    website: settings.website, area: settings.service_area, licensed_insured: settings.licensed_insured, ein: settings.ein,
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, customers]);

  // Dedupe guard: exact (case-insensitive) name already on file.
  const dupe = newCustomer
    ? customers.find((c) => c.name.trim().toLowerCase() === newCustomer.name.trim().toLowerCase()) || null
    : null;

  const customerName = selected?.name ?? newCustomer?.name ?? null;
  const customerAddress = selected?.address ?? (newCustomer?.address || null);

  const previewDoc: Doc = {
    kind: 'estimate',
    number: estimate?.estimate_number ?? '—',
    status: estimate?.status ?? 'draft',
    total: priceNum,
    created_at: estimate?.created_at ?? new Date().toISOString(),
    customer_name: customerName,
    customer_address: customerAddress,
    valid_until: validUntil || null,
    items: [{ description: lineItem || 'Job description', details: description || null, quantity: 1, unit_price: priceNum, amount: priceNum }],
    payment_instructions: paymentTerms || null,
    comments: additionalTerms || null,
  };

  function pickExisting(c: ComposerCustomer) {
    setCustomerId(c.id);
    setNewCustomer(null);
    setQuery(c.name);
  }
  function startNew() {
    setCustomerId('');
    setNewCustomer({ name: query.trim(), phone: '', address: '' });
  }
  function clearCustomer() {
    setCustomerId('');
    setNewCustomer(null);
    setQuery('');
  }

  function applyPriceItem(it: ComposerPriceItem) {
    setLineItem(it.name);
    if (it.default_price) setPrice(String(it.default_price));
    if (it.description && !description.trim()) setDescription(it.description);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setError('Saving a quote needs a connection.');
      return;
    }
    if (!customerId && !newCustomer?.name.trim()) { setError('Add a customer first.'); return; }
    if (!lineItem.trim()) { setError('Give the job a one-line title.'); return; }
    if (priceNum <= 0) { setError('Set a price.'); return; }
    if (dupe) { setError(`A customer named "${dupe.name}" is already on file — pick them instead of creating a duplicate.`); return; }

    setBusy(true);
    const supabase = createClient();

    let custId = customerId;
    if (!custId && newCustomer) {
      const { data: cust, error: cErr } = await supabase
        .from('customers')
        .insert({ name: newCustomer.name.trim(), phone: newCustomer.phone.trim() || null, address: newCustomer.address.trim() || null })
        .select('id')
        .single();
      if (cErr || !cust) { setBusy(false); setError(`Couldn't create the customer: ${cErr?.message ?? 'unknown error'}`); return; }
      custId = cust.id;
    }

    const fields = {
      customer_id: custId,
      line_item: lineItem.trim(),
      description: description.trim() || null,
      total: priceNum,
      subtotal: priceNum,
      valid_until: validUntil || null,
      payment_terms: paymentTerms.trim() || null,
      additional_terms: additionalTerms.trim() || null,
      internal_notes: internalNotes.trim() || null,
    };

    if (editing && estimate) {
      const { error: uErr } = await supabase.from('estimates').update(fields).eq('id', estimate.id);
      setBusy(false);
      if (uErr) { setError(`Couldn't save: ${uErr.message}`); return; }
      setSaved(true);
      router.refresh();
      return;
    }

    const { data: est, error: eErr } = await supabase
      .from('estimates')
      .insert({ ...fields, status: 'draft' })
      .select('id')
      .single();
    setBusy(false);
    if (eErr || !est) { setError(`Couldn't create the quote: ${eErr?.message ?? 'unknown error'}`); return; }
    router.push(`/estimates/${est.id}`);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-6xl lg:grid lg:grid-cols-2 lg:gap-8">
      {/* ---- Form ---- */}
      <form onSubmit={submit} className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-brand-700">{editing ? `Edit quote #${estimate!.estimate_number}` : 'New quote'}</h1>
          <p className="text-sm text-gray-500">{editing ? 'Changes update the customer’s document instantly.' : 'Name, one line, a price. Ninety seconds.'}</p>
        </div>

        {/* Customer */}
        <div className="card space-y-3">
          <label className="block text-xs font-bold uppercase tracking-wide text-gray-400">Customer</label>

          {selected || newCustomer ? (
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
              <div>
                <p className="font-semibold">{selected?.name ?? newCustomer?.name}</p>
                {selected?.phone && <p className="text-xs text-gray-500">{selected.phone}</p>}
                {!selected && <p className="text-xs text-brand-600">New customer</p>}
              </div>
              <button type="button" className="text-sm text-gray-500 hover:underline" onClick={clearCustomer}>Change</button>
            </div>
          ) : (
            <>
              <input
                className="input w-full"
                placeholder="Search a name or number…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                inputMode="text"
              />
              {matches.length > 0 && (
                <div className="divide-y overflow-hidden rounded-lg border">
                  {matches.map((c) => (
                    <button type="button" key={c.id} className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-50" onClick={() => pickExisting(c)}>
                      <span className="font-medium">{c.name}</span>
                      {c.phone && <span className="text-xs text-gray-400">{c.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
              {query.trim() && (
                <button type="button" className="btn-ghost w-full justify-center" onClick={startNew}>
                  + Create new customer “{query.trim()}”
                </button>
              )}
            </>
          )}

          {newCustomer && (
            <div className="space-y-2">
              <input className="input w-full" placeholder="Name *" value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} />
              <input className="input w-full" placeholder="Phone" inputMode="tel" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
              <input className="input w-full" placeholder="Address (optional)" value={newCustomer.address} onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })} />
              {dupe && <p className="text-sm text-amber-600">Already on file — <button type="button" className="underline" onClick={() => pickExisting(dupe)}>use {dupe.name}</button>?</p>}
            </div>
          )}
        </div>

        {/* The job */}
        <div className="card space-y-3">
          {priceItems.length > 0 && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-gray-400">Quick pick from price book</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {priceItems.map((it) => (
                  <button key={it.id} type="button" onClick={() => applyPriceItem(it)}
                    className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-sm text-brand-700 hover:bg-brand-100">
                    {it.name}{it.default_price ? ` · $${Number(it.default_price).toFixed(0)}` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-400">The job</label>
            <input className="input mt-1 w-full text-lg" placeholder="e.g. Garage cleanout & haul-away" value={lineItem} onChange={(e) => setLineItem(e.target.value)} />
          </div>
          <textarea className="input w-full" rows={3} placeholder="A sentence or two the customer will read (optional)." value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-bold uppercase tracking-wide text-gray-400">Price</label>
              <div className="relative mt-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-gray-400">$</span>
                <input className="input w-full pl-7 text-xl font-bold" inputMode="decimal" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} />
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-bold uppercase tracking-wide text-gray-400">Valid until</label>
              <input className="input mt-1 w-full" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Terms — prefilled, collapsed by default */}
        <div className="card">
          <button type="button" className="flex w-full items-center justify-between" onClick={() => setTermsOpen(!termsOpen)}>
            <span className="text-xs font-bold uppercase tracking-wide text-gray-400">Terms {termsOpen ? '' : '· prefilled'}</span>
            <span className="text-gray-400">{termsOpen ? '▾' : '▸'}</span>
          </button>
          {termsOpen && (
            <div className="mt-3 space-y-3">
              <div>
                <label className="block text-xs text-gray-500">Payment</label>
                <textarea className="input w-full" rows={2} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500">Additional terms</label>
                <textarea className="input w-full" rows={2} value={additionalTerms} onChange={(e) => setAdditionalTerms(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        {/* Internal notes — visually locked, never customer-facing */}
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/60 p-3">
          <label className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-amber-700">
            🔒 Internal notes — the customer never sees this
          </label>
          <textarea className="mt-2 w-full rounded-md border border-amber-200 bg-white/70 p-2 text-sm" rows={2} placeholder="Your cost breakdown, gotchas, reminders…" value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && <p className="text-sm text-green-600">Saved ✓</p>}
        <div className="sticky bottom-0 -mx-1 flex gap-3 bg-gradient-to-t from-white via-white/95 to-transparent py-3">
          <button className="btn-primary flex-1 justify-center py-3 text-base" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save quote'}</button>
        </div>
      </form>

      {/* ---- Live preview: the exact document the customer will sign ---- */}
      <div className="mt-8 lg:mt-0">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">What the customer sees</p>
        <div className="sjhc-sign preview">
          <style>{DOC_CSS}</style>
          <EstimateDocument
            doc={previewDoc}
            kind="estimate"
            biz={previewBiz}
            signSlot={
              <div>
                <div className="lbl">Sign to accept</div>
                <p style={{ fontSize: 14, fontWeight: 600, margin: '6px 0 4px' }}>Approve this estimate by signing below.</p>
                <div style={{ border: '1.5px dashed #cbbfb4', borderRadius: 14, height: 90, display: 'grid', placeItems: 'center', color: '#ab9f94', fontSize: 13, letterSpacing: '.16em', textTransform: 'uppercase' }}>Tap and sign here</div>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
