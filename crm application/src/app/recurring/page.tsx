import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { flags } from '@/lib/flags';
import RecurringManager from './RecurringManager';
import type { JobRecurrence, Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function RecurringPage() {
  if (!flags.recurring) notFound(); // flag off → page doesn't exist, even by direct URL
  await requireStaff();
  const supabase = createClient();
  const [{ data: recurrences }, { data: customers }] = await Promise.all([
    supabase.from('job_recurrence').select('*, customers(id,name)').eq('active', true).order('next_run'),
    supabase.from('customers').select('id,name').order('name'),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <p className="panel-label">Recurring jobs</p>
        <h1 className="text-2xl">Maintenance plans</h1>
        <p className="mt-1 text-sm text-gray-500">Set a job to repeat. It auto-appears on the schedule each cycle.</p>
      </div>
      <RecurringManager
        recurrences={(recurrences ?? []) as JobRecurrence[]}
        customers={(customers ?? []) as Pick<Customer, 'id' | 'name'>[]}
      />
    </div>
  );
}
