'use client';
import { useState } from 'react';
import Link from 'next/link';
import StatusBadge from '@/components/StatusBadge';
import NewJobForm from '@/app/jobs/NewJobForm';
import type { Customer, Job } from '@/lib/types';

export type ScheduleDay = {
  key: string;        // stable react key
  addDate: string;    // YYYY-MM-DD for prefilling a new job
  label: string;      // "Mon 5"
  isToday: boolean;
  jobs: (Job & { customers?: { name?: string } | null })[];
};

/** Week grid with per-day quick-add. Data is bucketed server-side (tz-safe); this
 *  component only handles the add-a-job modal so the Schedule tab isn't read-only. */
export default function ScheduleWeek({ days, customers }: {
  days: ScheduleDay[];
  customers: Pick<Customer, 'id' | 'name'>[];
}) {
  const [addDate, setAddDate] = useState<string | null>(null);

  return (
    <>
      <div className="grid gap-3 md:grid-cols-7">
        {days.map((day) => (
          <div key={day.key} className={`rounded-xl p-2 ${day.isToday ? 'bg-brand-50 ring-1 ring-brand-500' : 'bg-gray-100'}`}>
            <p className="mb-2 px-1 text-sm font-semibold text-gray-600">{day.label}</p>
            <div className="space-y-2">
              {day.jobs.map((j) => (
                <Link key={j.id} href={`/jobs/${j.id}`} className="block rounded-lg border border-gray-200 bg-white p-2 text-sm shadow-sm hover:border-brand-500">
                  <p className="text-xs font-semibold text-gray-500">{new Date(j.scheduled_start!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
                  <p className="font-medium leading-tight">{j.title}</p>
                  <p className="text-xs text-gray-500">{j.customers?.name}</p>
                  <div className="mt-1"><StatusBadge status={j.status} /></div>
                </Link>
              ))}
              <button
                onClick={() => setAddDate(day.addDate)}
                className="w-full rounded-lg border border-dashed border-gray-300 py-1.5 text-xs font-medium text-gray-400 hover:border-brand-400 hover:text-brand-600"
              >
                + Add
              </button>
            </div>
          </div>
        ))}
      </div>

      {addDate && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onClick={() => setAddDate(null)}>
          <div className="mt-10 w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 text-sm font-semibold text-white">
              New job — {new Date(addDate + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            <NewJobForm customers={customers} defaultDate={addDate} startOpen onClose={() => setAddDate(null)} />
          </div>
        </div>
      )}
    </>
  );
}
