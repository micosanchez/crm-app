'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from '@/lib/offline/sync';

export default function NoteForm({ entityType, entityId }: { entityType: 'customer' | 'job' | 'invoice'; entityId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    const res = await mutate({ table: 'notes', op: 'insert', label: 'note', payload: { entity_type: entityType, entity_id: entityId, body } });
    setBusy(false);
    if (res.status === 'failed') { setError(res.error); return; }
    setBody('');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-1">
      <div className="flex gap-2">
        <input className="input" placeholder="Add a note…" value={body} onChange={(e) => setBody(e.target.value)} />
        <button className="btn-primary" disabled={busy || !body.trim()}>Add</button>
      </div>
      {error && <p className="text-sm text-red-600">Couldn&apos;t save: {error}</p>}
    </form>
  );
}
