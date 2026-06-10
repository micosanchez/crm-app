'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Job } from '@/lib/types';

/** Job photo grid + camera/file upload to the job-photos bucket. */
export default function PhotoSection({ job, big = false }: { job: Job; big?: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const photos = job.photos ?? [];

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    const supabase = createClient();
    const added: { url: string; uploaded_at: string }[] = [];
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${job.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from('job-photos').upload(path, file);
      if (!error) {
        const { data } = supabase.storage.from('job-photos').getPublicUrl(path);
        added.push({ url: data.publicUrl, uploaded_at: new Date().toISOString() });
      } else {
        alert(`Upload failed: ${error.message}`);
      }
    }
    if (added.length) {
      await supabase.from('jobs').update({ photos: [...photos, ...added] }).eq('id', job.id);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
          {photos.map((p, i) => (
            <a key={i} href={p.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-gray-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.caption ?? `Job photo ${i + 1}`} className="aspect-square w-full object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" capture="environment" multiple hidden
        onChange={(e) => upload(e.target.files)} />
      <button className={big ? 'btn-ghost btn-big' : 'btn-ghost'} disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Uploading…' : '📷 Add photos'}
      </button>
    </div>
  );
}
