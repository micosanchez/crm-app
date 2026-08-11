'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export interface BusinessSettings {
  business_name: string | null;
  tagline: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  service_area: string | null;
  mailing_address: string | null;
  ein: string | null;
  licensed_insured: boolean | null;
  default_valid_days: number | null;
  estimate_prefix: string | null;
  default_line_item: string | null;
  default_payment_terms: string | null;
  default_additional_terms: string | null;
}

type Field = keyof BusinessSettings;

export default function BusinessSettingsForm({ initial }: { initial: BusinessSettings }) {
  const router = useRouter();
  const [s, setS] = useState<BusinessSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: Field, v: string | number | boolean) => { setS((prev) => ({ ...prev, [k]: v })); setSaved(false); };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setSaved(false);
    const supabase = createClient();
    const { error: uErr } = await supabase.from('business_settings').update({
      business_name: s.business_name?.trim() || null,
      tagline: s.tagline?.trim() || null,
      phone: s.phone?.trim() || null,
      email: s.email?.trim() || null,
      website: s.website?.trim() || null,
      service_area: s.service_area?.trim() || null,
      mailing_address: s.mailing_address?.trim() || null,
      ein: s.ein?.trim() || null,
      licensed_insured: !!s.licensed_insured,
      default_valid_days: Number(s.default_valid_days) || 14,
      estimate_prefix: s.estimate_prefix?.trim() || 'EST',
      default_line_item: s.default_line_item?.trim() || null,
      default_payment_terms: s.default_payment_terms?.trim() || null,
      default_additional_terms: s.default_additional_terms?.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', true);
    setBusy(false);
    if (uErr) { setError(uErr.message); return; }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-700">Settings</h1>
        <p className="text-sm text-gray-500">Business profile and the defaults every new quote starts from.</p>
      </div>

      {/* Business profile */}
      <div className="card space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Business profile</p>
        <Text label="Business name" value={s.business_name} onChange={(v) => set('business_name', v)} />
        <Text label="Tagline" value={s.tagline} onChange={(v) => set('tagline', v)} />
        <div className="grid gap-3 md:grid-cols-2">
          <Text label="Phone" value={s.phone} onChange={(v) => set('phone', v)} />
          <Text label="Email" value={s.email} onChange={(v) => set('email', v)} />
          <Text label="Website" value={s.website} onChange={(v) => set('website', v)} />
          <Text label="EIN" value={s.ein} onChange={(v) => set('ein', v)} />
        </div>
        <Text label="Service area" value={s.service_area} onChange={(v) => set('service_area', v)} />
        <Text label="Mailing address" value={s.mailing_address} onChange={(v) => set('mailing_address', v)} />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={!!s.licensed_insured} onChange={(e) => set('licensed_insured', e.target.checked)} />
          Show “Licensed &amp; Insured” on customer documents
        </label>
      </div>

      {/* Quote defaults */}
      <div className="card space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Quote defaults</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="block text-xs text-gray-500">Quote valid for (days)</label>
            <input className="input mt-1 w-full" type="number" min={1} value={s.default_valid_days ?? 14} onChange={(e) => set('default_valid_days', Number(e.target.value))} />
          </div>
          <div>
            <label className="block text-xs text-gray-500">Number prefix</label>
            <input className="input mt-1 w-full" value={s.estimate_prefix ?? ''} onChange={(e) => set('estimate_prefix', e.target.value)} placeholder="EST" />
          </div>
        </div>
        <Text label="Default line-item title (optional)" value={s.default_line_item} onChange={(v) => set('default_line_item', v)} placeholder="e.g. Junk removal & haul-away" />
        <div>
          <label className="block text-xs text-gray-500">Default payment terms</label>
          <textarea className="input mt-1 w-full" rows={2} value={s.default_payment_terms ?? ''} onChange={(e) => set('default_payment_terms', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-gray-500">Default additional terms</label>
          <textarea className="input mt-1 w-full" rows={2} value={s.default_additional_terms ?? ''} onChange={(e) => set('default_additional_terms', e.target.value)} />
        </div>
        <p className="text-xs text-gray-400">These prefill every new quote. You can still edit them per quote.</p>
      </div>

      {error && <p className="text-sm text-red-600">Couldn’t save: {error}</p>}
      {saved && <p className="text-sm text-green-600">Saved ✓</p>}
      <div className="sticky bottom-0 flex gap-3 bg-gradient-to-t from-white via-white/95 to-transparent py-3">
        <button className="btn-primary py-3" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
      </div>
    </form>
  );
}

function Text({ label, value, onChange, placeholder }: { label: string; value: string | null; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs text-gray-500">{label}</label>
      <input className="input mt-1 w-full" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
