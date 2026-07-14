import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { flags } from '@/lib/flags';
import AccountingTabs from './AccountingTabs';
import SetupPanel from './SetupPanel';

export const dynamic = 'force-dynamic';

export default async function AccountingLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();

  if (!flags.accounting) {
    return (
      <div className="card">
        <p className="panel-label">Accounting</p>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          The accounting module is disabled. Set <code>NEXT_PUBLIC_FF_ACCOUNTING=1</code> and run migration
          <code> 0020_accounting.sql</code> to enable it.
        </p>
      </div>
    );
  }

  const supabase = createClient();
  const { count } = await supabase.from('accounts').select('id', { count: 'exact', head: true });
  const seeded = (count ?? 0) > 0;

  return (
    <div className="space-y-5">
      <div>
        <p className="panel-label">Accounting</p>
        <h1 className="text-2xl">Books &amp; bank reconciliation</h1>
      </div>
      <AccountingTabs />
      {seeded ? children : <SetupPanel />}
    </div>
  );
}
