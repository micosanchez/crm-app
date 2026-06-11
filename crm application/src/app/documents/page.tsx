import { createClient } from '@/lib/supabase/server';
import DocumentManager, { type Doc } from './DocumentManager';

export const dynamic = 'force-dynamic';

export default async function DocumentsPage() {
  const supabase = createClient();
  const { data: documents } = await supabase
    .from('documents')
    .select('*')
    .eq('archived', false)
    .order('created_at', { ascending: false });

  const docs = (documents ?? []) as Doc[];
  const soon = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  const expiring = docs.filter((d) => d.expires_on && d.expires_on <= soon);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Documents</h1>
      {expiring.length > 0 && (
        <div className="card border-red-300 bg-red-50">
          <p className="mb-1 text-sm font-semibold text-red-800">⚠ Expiring within 30 days</p>
          <ul className="space-y-0.5 text-sm text-red-800">
            {expiring.map((d) => (
              <li key={d.id}>{d.name} — {new Date(d.expires_on! + 'T12:00:00').toLocaleDateString()}</li>
            ))}
          </ul>
        </div>
      )}
      <DocumentManager documents={docs} />
    </div>
  );
}
