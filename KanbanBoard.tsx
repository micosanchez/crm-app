'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { mutate } from '@/lib/offline/sync';
import { JOB_PIPELINE, type Job, type JobStatus } from '@/lib/types';

const LABELS: Record<JobStatus, string> = {
  lead: 'Leads', scheduled: 'Scheduled', in_progress: 'In progress',
  completed: 'Completed', invoiced: 'Invoiced', paid: 'Paid',
};

export default function KanbanBoard({ jobs: initial }: { jobs: Job[] }) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);

  async function moveJob(id: string, status: JobStatus) {
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, status } : j))); // optimistic
    await mutate({ table: 'jobs', op: 'update', id, payload: { status } });
    router.refresh();
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {JOB_PIPELINE.map((status) => {
        const col = jobs.filter((j) => j.status === status);
        return (
          <div key={status}
            className="min-w-[240px] flex-1 rounded-xl bg-gray-100 p-2"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => dragId && moveJob(dragId, status)}>
            <p className="mb-2 px-1 text-sm font-semibold text-gray-600">
              {LABELS[status]} <span className="text-gray-400">({col.length})</span>
            </p>
            <div className="space-y-2">
              {col.map((j) => (
                <div key={j.id} draggable
                  onDragStart={() => setDragId(j.id)}
                  onDragEnd={() => setDragId(null)}
                  className="cursor-grab rounded-lg border border-gray-200 bg-white p-3 shadow-sm active:cursor-grabbing">
                  <Link href={`/jobs/${j.id}`} className="font-medium hover:text-brand-700">{j.title}</Link>
                  <p className="text-xs text-gray-500">{j.customers?.name}</p>
                  {j.estimated_value != null && <p className="text-xs font-semibold text-brand-700">${Number(j.estimated_value).toFixed(0)}</p>}
                  {/* Mobile-friendly advance button (drag/drop is desktop) */}
                  {status !== 'paid' && (
                    <button
                      className="mt-2 w-full rounded-md bg-gray-100 py-1 text-xs font-medium text-gray-600 hover:bg-brand-50 hover:text-brand-700"
                      onClick={() => moveJob(j.id, JOB_PIPELINE[JOB_PIPELINE.indexOf(status) + 1])}>
                      → {LABELS[JOB_PIPELINE[JOB_PIPELINE.indexOf(status) + 1]]}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
