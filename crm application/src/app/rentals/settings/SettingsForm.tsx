'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { DEFAULT_TEMPLATES, VARS, type RentalTemplateKey } from '@/lib/rentals/templates';

/* eslint-disable @typescript-eslint/no-explicit-any */
const GROUPS: { title: string; fields: [string, string, 'money' | 'number' | 'text' | 'select' | 'json'][] }[] = [
  { title: 'Fees', fields: [['late_fee_per_day', 'Late fee per day', 'money'], ['replacement_fee_per_tote', 'Replacement per tote', 'money'], ['replacement_fee_per_dolly', 'Replacement per dolly', 'money'], ['cleaning_fee_per_tote', 'Cleaning per tote', 'money'], ['damage_fee_per_tote', 'Damage per tote', 'money'], ['failed_trip_fee', 'Failed trip fee', 'money']] },
  { title: 'Payment', fields: [['balance_charge_mode', 'Rental price is charged at (booking = paid in full up front)', 'select'], ['cancel_full_refund_hours', 'Full refund if cancelled this many hours before delivery', 'number']] },
  { title: 'Scheduling', fields: [['booking_lead_time_hours', 'Booking lead time (hours)', 'number'], ['max_bookings_per_slot', 'Max bookings per window', 'number'], ['turnaround_days', 'Turnaround buffer (days to clean and stack)', 'number'], ['service_days', 'Service days (0=Sun … 6=Sat)', 'json'], ['slot_windows', 'Time windows', 'json'], ['blackout_dates', 'Blackout dates (YYYY-MM-DD)', 'json']] },
  { title: 'Delivery', fields: [['delivery_fee_base', 'Delivery fee base', 'money'], ['free_delivery_radius_miles', 'Free radius (miles)', 'number'], ['per_mile_fee', 'Per mile beyond', 'money'], ['max_service_radius_miles', 'Max service radius (miles)', 'number']] },
  { title: 'Goals', fields: [['monthly_goal_low', 'Monthly profit goal low', 'money'], ['monthly_goal_high', 'Monthly profit goal high', 'money']] },
];
const SELECTS: Record<string, string[]> = { balance_charge_mode: ['booking', 'delivery', 'pickup'] };

export default function SettingsForm({ settings, defaultTerms }: { settings: any; defaultTerms: string }) {
  const router = useRouter();
  const [s, setS] = useState<any>({ ...settings, templates: settings.templates ?? {} });
  const [json, setJson] = useState<Record<string, string>>({ service_days: JSON.stringify(settings.service_days), slot_windows: JSON.stringify(settings.slot_windows), blackout_dates: JSON.stringify(settings.blackout_dates) });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setS({ ...s, [k]: v });
  async function save() {
    const patch: any = { ...s };
    delete patch.id; delete patch.updated_at; delete patch.terms_version;
    try { for (const k of Object.keys(json)) patch[k] = JSON.parse(json[k]); } catch { setMsg('Scheduling JSON is not valid.'); return; }
    for (const g of GROUPS) for (const [k, , t] of g.fields) if ((t === 'money' || t === 'number') && (patch[k] === '' || patch[k] === undefined)) patch[k] = null;
    const { error } = await createClient().from('rental_settings').update(patch).eq('id', true);
    setMsg(error ? error.message : 'Saved.'); if (!error) router.refresh();
  }
  const tpl = (k: RentalTemplateKey) => ({ ...DEFAULT_TEMPLATES[k], ...(s.templates?.[k] ?? {}) });
  return (
    <div className="space-y-4">
      {msg && <p className="rounded-lg bg-emerald-50 p-2 text-sm">{msg}</p>}
      {GROUPS.map((g) => (<section key={g.title} className="card grid gap-2 md:grid-cols-3"><p className="panel-label md:col-span-3">{g.title}</p>
        {g.fields.map(([k, label, t]) => (<label key={k} className="text-xs text-gray-600">{label}
          {t === 'select' ? <select className="input" value={s[k] ?? ''} onChange={(e) => set(k, e.target.value)}>{SELECTS[k].map((o) => <option key={o}>{o}</option>)}</select>
            : t === 'json' ? <input className="input font-mono" value={json[k]} onChange={(e) => setJson({ ...json, [k]: e.target.value })} />
            : <input className="input" type="number" step={t === 'money' ? '0.01' : '1'} value={s[k] ?? ''} onChange={(e) => set(k, e.target.value)} placeholder={t === 'money' ? 'blank = not set' : ''} />}
        </label>))}</section>))}
      <section className="card space-y-2"><p className="panel-label">Terms (version {settings.terms_version})</p>
        <p className="text-xs text-gray-500">Placeholders: {'{rental_number} {totes} {addons} {delivery_date} {pickup_date} {late_fee_per_day} {replacement_fee_per_tote} {replacement_fee_per_dolly} {cleaning_fee_per_tote} {damage_fee_per_tote} {cancel_hours} {failed_trip_fee}'}. The card authorization clause is added automatically if you leave it out.</p>
        <textarea className="input font-mono text-xs" rows={14} value={s.terms_text ?? ''} placeholder={defaultTerms} onChange={(e) => set('terms_text', e.target.value)} />
        {!s.terms_text && <button className="btn-ghost" onClick={() => set('terms_text', defaultTerms)}>Start from the default terms</button>}
      </section>
      <section className="card space-y-3"><p className="panel-label">Message templates</p><p className="text-xs text-gray-500">Texts never include prices. Variables: {VARS.map((v) => `{${v}}`).join(' ')}. Automated texts only go to customers who ticked &quot;Text me updates&quot;, between 8am and 8pm.</p>
        {(Object.keys(DEFAULT_TEMPLATES) as RentalTemplateKey[]).map((k) => { const t = tpl(k); return (
          <div key={k} className="grid gap-1 border-t pt-2 md:grid-cols-[180px_1fr]"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={t.enabled} onChange={(e) => set('templates', { ...s.templates, [k]: { ...(s.templates?.[k] ?? {}), enabled: e.target.checked } })} />{t.label}</label>
            <div><textarea className="input text-sm" rows={2} value={t.sms} onChange={(e) => set('templates', { ...s.templates, [k]: { ...(s.templates?.[k] ?? {}), sms: e.target.value } })} />{DEFAULT_TEMPLATES[k].email !== undefined && <textarea className="input mt-1 text-xs" rows={3} value={t.email ?? ''} placeholder="Email body" onChange={(e) => set('templates', { ...s.templates, [k]: { ...(s.templates?.[k] ?? {}), email: e.target.value } })} />}</div></div>); })}
      </section>
      <button className="btn-primary" onClick={save}>Save settings</button>
    </div>
  );
}
