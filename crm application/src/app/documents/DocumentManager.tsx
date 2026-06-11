'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export interface Doc {
  id: string;
  name: string;
  category: string;
  file_path: string;
  expires_on: string | null;
  notes: string | null;
  created_at: string;
}

const CATEGORIES = ['insurance', 'vehicle_registration', 'permit', 'contract', 'employee_record', 'vendor', 'tax', 'other'];
const ICONS: Record<string, string> = {
  insurance: '🛡️', vehicle_registration: '🚚', permit: '📋', contract: '📜',
  employee_record: '👤', vendor: '🤝', tax: '🧾', other: '📁',
};

export default function DocumentManager({ documents }: { documents: Doc[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState({ name: '', category: 'insurance', expires_on: '', notes: '' });

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { alert('Choose a file first.'); return; }
    setBusy(true);
    const supabase = createClient();
    const ext = file.name.split('.').pop() || 'pdf';
    const path = `${form.category}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('documents').upload(path, file);
    if (upErr) { setBusy(false); alert(`Upload failed: ${upErr.message}`); return; }
    await supabase.from('documents').insert({
      name: form.name || file.name,
      category: form.category,
      file_path: path,
      expires_on: form.expires_on || null,
      notes: form.notes || null,
    });
    setBusy(false);
    setForm({ name: '', category: 'insurance', expires_on: '', notes: '' });
    if (fileRef.current) fileRef.current.value = '';
    router.refresh();
  }

  async function open(doc: Doc) {
    const supabase = createClient();
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 300);
    if (error || !data?.signedUrl) { alert('Could not open file.'); return; }
    window.open(data.signedUrl, '_blank');
  }

  async function archive(doc: Doc) {
    if (!confirm(`Archive "${doc.name}"? (It stays in the audit log and storage.)`)) return;
    const supabase = createClient();
    await supabase.from('documents').update({ archived: true }).eq('id', doc.id);
    router.refresh();
  }

  const shown = filter === 'all' ? documents : documents.filter((d) => d.category === filter);
  const soon = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <form onSubmit={upload} className="card space-y-2">
        <p className="text-xs font-bold uppercase text-gray-400">Upload document</p>
        <div className="grid gap-2 md:grid-cols-4">
          <input ref={fileRef} type="file" className="input md:col-span-2" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" required />
          <input className="input" placeholder="Name (defaults to filename)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
          </select>
          <div>
            <label className="mb-1 block text-xs text-gray-400">Expires on (for renewal reminders)</label>
            <input className="input" type="date" value={form.expires_on} onChange={(e) => setForm({ ...form, expires_on: e.target.value })} />
          </div>
          <input className="input md:col-span-2" placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <button className="btn-primary self-end" disabled={busy}>{busy ? 'Uploading…' : '⬆ Upload'}</button>
        </div>
      </form>

      <div className="flex flex-wrap gap-2">
        <button className={`badge border px-3 py-1 ${filter === 'all' ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-300 text-gray-500'}`} onClick={() => setFilter('all')}>all</button>
        {CATEGORIES.map((c) => (
          <button key={c} className={`badge border px-3 py-1 ${filter === c ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-300 text-gray-500'}`} onClick={() => setFilter(c)}>
            {ICONS[c]} {c.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <div className="card divide-y divide-gray-100 p-0">
        {shown.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <p className="font-medium">{ICONS[d.category]} {d.name}</p>
              <p className="text-xs text-gray-500">
                {d.category.replace(/_/g, ' ')} · added {new Date(d.created_at).toLocaleDateString()}
                {d.expires_on && (
                  <span className={d.expires_on <= soon ? ' font-semibold text-red-600' : ''}>
                    {' '}· expires {new Date(d.expires_on + 'T12:00:00').toLocaleDateString()}
                  </span>
                )}
                {d.notes && ` · ${d.notes}`}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button className="btn-ghost py-1 text-xs" onClick={() => open(d)}>👁 View</button>
              <button className="rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600" onClick={() => archive(d)}>Archive</button>
            </div>
          </div>
        ))}
        {!shown.length && <p className="p-4 text-sm text-gray-500">No documents{filter !== 'all' ? ' in this category' : ''} yet. Upload your insurance, registrations, and permits so the expiration reminders can watch them for you.</p>}
      </div>
    </div>
  );
}
