'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from '@/lib/offline/sync';

export default function NoteForm({ entityType, entityId }: { entityType: 'customer' | 'job' | 'invoice'; entityId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    await mutate({ table: 'notes', op: 'insert', payload: { entity_type: entityType, entity_id: entityId, body } });
    setBody('');
    setBusy(false);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input className="input" placeholder="Add a note…" value={body} onChange={(e) => setBody(e.target.value)} />
      <button className="btn-primary" disabled={busy || !body.trim()}>Add</button>
    </form>
  );
}
