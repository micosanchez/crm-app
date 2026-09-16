import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { flags } from '@/lib/flags';
import { REQUEST_PHOTOS_BUCKET, type EstimateRequest } from '@/lib/requests';
import RequestDetail from './RequestDetail';

export const dynamic = 'force-dynamic';

export default async function RequestDetailPage({ params, searchParams }: {
  params: { id: string };
  searchParams: { status?: string };
}) {
  if (!flags.requests) notFound();
  await requireStaff();

  const supabase = createClient();
  const { data } = await supabase
    .from('estimate_requests')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();
  if (!data) notFound();
  const request = data as EstimateRequest;

  // Photos live in a private bucket. Mint short-lived signed URLs per view;
  // nothing about this request is ever publicly readable.
  const paths = (Array.isArray(request.photos) ? request.photos : []).map((p) => p.path);
  let photoUrls: string[] = [];
  if (paths.length) {
    const { data: signed } = await supabase.storage
      .from(REQUEST_PHOTOS_BUCKET)
      .createSignedUrls(paths, 60 * 30);
    photoUrls = (signed ?? []).flatMap((x) => (x.signedUrl ? [x.signedUrl] : []));
  }

  // The estimate this request turned into, if it has one.
  let quote: { id: string; estimate_number: number; total: number; status: string } | null = null;
  if (request.quote_id) {
    const { data: q } = await supabase
      .from('estimates')
      .select('id,estimate_number,total,status')
      .eq('id', request.quote_id)
      .maybeSingle();
    quote = (q as typeof quote) ?? null;
  }

  const backHref = `/estimates/requests${searchParams.status ? `?status=${searchParams.status}` : ''}`;

  return (
    <div className="space-y-4">
      <Link href={backHref} className="text-sm text-brand-600 hover:underline">← Requests</Link>
      <RequestDetail request={request} photoUrls={photoUrls} quote={quote} />
    </div>
  );
}
