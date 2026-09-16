import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { flags } from '@/lib/flags';
import RequestsTabs from '../RequestsTabs';
import RequestsList from './RequestsList';
import IntakeLink from './IntakeLink';
import type { EstimateRequest } from '@/lib/requests';

export const dynamic = 'force-dynamic';

export default async function RequestsPage({ searchParams }: {
  searchParams: { status?: string };
}) {
  if (!flags.requests) notFound();
  await requireStaff();

  const supabase = createClient();
  const { data } = await supabase
    .from('estimate_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);

  const requests = (data ?? []) as EstimateRequest[];
  const newCount = requests.filter((r) => r.status === 'new').length;

  return (
    <div className="space-y-5">
      <RequestsTabs active="requests" newCount={newCount} />
      <IntakeLink />
      <RequestsList requests={requests} initialStatus={searchParams.status ?? 'new'} />
    </div>
  );
}
