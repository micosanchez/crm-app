import type { JobStatus, InvoiceStatus } from '@/lib/types';

const COLORS: Record<string, string> = {
  lead: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  invoiced: 'bg-purple-100 text-purple-700',
  paid: 'bg-brand-100 text-brand-700',
  cancelled: 'bg-red-50 text-red-600',
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
};

export default function StatusBadge({ status }: { status: JobStatus | InvoiceStatus }) {
  return <span className={`badge ${COLORS[status] ?? 'bg-gray-100 text-gray-700'}`}>{status.replace('_', ' ')}</span>;
}
