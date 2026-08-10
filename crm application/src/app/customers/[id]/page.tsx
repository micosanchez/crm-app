import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import StatusBadge from '@/components/StatusBadge';
import NoteForm from '@/components/NoteForm';
import CustomerEditForm from './CustomerEditForm';
import BookAgainButton from './BookAgainButton';
import type { Customer, Job, ActivityEntry, Note, Invoice, Estimate } from '@/lib/types';

export const dynamic = 'force-dynamic';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default async function CustomerDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: customer }, { data:*�obs }, { data: invoices }, { data:)\�[X]\�K�]N���\�K�]N�X�]�]HWHB�]�Z]��Z\�K�[
�\X�\�K����J	��\��Y\���K��[X�
	ʉ�K�\J	�Y	�\�[\˚Y
K��[��J
K��\X�\�K����J	ڛ؜��K��[X�
	ʉ�K�\J	��\��Y\��Y	�\�[\˚Y
K�ܙ\�	�ܙX]Y�]	��\��[�[�Έ�[�HJK��\X�\�K����J	�[���X�\��K��[X�
	�Y[���X�W۝[X�\��]\��[[[�[��ZYZY�]ܙX]Y�]YW�]	�K�\J	��\��Y\��Y	�\�[\˚Y
K�ܙ\�	�ܙX]Y�]	��\��[�[�Έ�[�HJK��\X�\�K����J	�\�[X]\��K��[X�
	�Y\�[X]W۝[X�\��]\��[ܙX]Y�]	�K�\J	��\��Y\��Y	�\�[\˚Y
K�ܙ\�	�ܙX]Y�]	��\��[�[�Έ�[�HJK��\X�\�K����J	ۛ�\��K��[X�
	ʉ�K�\J	�[�]W�\I�	��\��Y\��K�\J	�[�]W�Y	�\�[\˚Y
K�ܙ\�	�ܙX]Y�]	��\��[�[�Έ�[�HJK��\X�\�K����J	�X�]�]W����K��[X�
	ʉ�K�\J	�[�]W�Y	�\�[\˚Y
K�ܙ\�	�ܙX]Y�]	��\��[�[�Έ�[�HJK�[Z]

L
K�JN�Y�
X�\��Y\�H�]\����\��Y\�����[�����ۜ��H�\��Y\�\��\��Y\��ۜ��ؓ\�H
�؜�\��ؖ�H�[
H���N�ۜ�[��\�H
[���X�\�\�[���X�V�H�[
H���N�ۜ�\�\�H
\�[X]\�\�\�[X]V�H�[
H���N���KKKKH�\��Y\�͌��\�KKKKB��ۜ�ZY[���X�\�H[��\���[\�
JHO�K��]\�OOH	�ZY	�N�ۜ�Y�][YT�]�[�YHHZY[���X�\˜�YX�J
�JHO��
��[X�\�K��[
K
N�ۜ��[[��S��YH[��\����[\�
JHO�K��]\�OOH	��[�	�B���YX�J
�JHO��
�
�[X�\�K��[
HH�[X�\�K�[[�[��ZY��
JK
N�ۜ�ZY�؜���[�H�ؓ\���[\�
�HO����]\�OOH	�ZY	�K�[���ۜ�]��X��]HZY[���X�\˛[���Y�][YT�]�[�YH�ZY[���X�\˛[�����[���X�[�XY��\��H�X�ܙYۈ[�Hو\��\��Y\����؜˂��ۜ�XY��\��HH�ؓ\��X\

�HO���XY���\��JK��[�
���X[�H���[�ۜ�\�X�]�]HH����ؓ\��X\

�HO���ܙX]Y�]
K����[��\��X\

JHO�K�ZY�]��K�ܙX]Y�]
K�K��[\����X[�K��ܝ

K��

N��ۜ��]Έ�X�[���[����[YN���[���ۙOΈ��[��V�HH�X�[�	�Y�][YH�]�[�YI��[YN�[ۙ^JY�][YT�]�[�YJKۙN�	ݘ\�KX��[�]^
I�K��X�[�	И[[��H��Y	��[YN�[ۙ^J�[[��S��Y
KۙN��[[��S��Y��	ݘ\�K\�]\�Y[��\�I��[�Y�[�YK��X�[�	қ؜���[YN���[���ؓ\��[��
HK��X�[�	�]��X��]	��[YN�[ۙ^J]��X��]
HK�N��]\��
�]��\�Ә[YOH��X�K^KM����]���[���Y�H���\��Y\�Ȉ�\�Ә[YOH�^\�H^X��[�M�ݙ\��[�\�[�H�����\��Y\���[�ς�H�\�Ә[YOH�^L��۝X�����˛�[Y_O�O���\�Ә[YOH�^\�H^Yܘ^KML����˜ۙH�H�Y�^�[��˜ۙ_XH�\�Ә[YOH�^X��[�M�ݙ\��[�\�[�H���˜ۙ_O�O��	��%	�B���0��	�B��˙[XZ[�H�Y�^�XZ[Ή�˙[XZ[XH�\�Ә[YOH�^X��[�M�ݙ\��[�\�[�H���˙[XZ[O�O��	��%	�B��˘Y�\��˘�]JH	���0���˘Y�\����	��H�˘�]H��	��OϟB��XY��\��H	���0����\��N����[��XY��\��JK��\X�J����	�	�_OϟB����]��\�Ә[YOH�]LH�^�\LH����˝Y�˛X\


HO��[��^O^�H�\�Ә[YOH��Y�H��X��[�ML^X��[�M������\X�J	���	�	�_O��[��_B��]���]��\�Ә[YOH�]L��^�^]ܘ\�\L��������Y�Z[��]ۈ�\��Y\�^��Hς��\��Y\�Y]�ܛH�\��Y\�^��Hς��]����]�����ʈ�\��Y\�͌��\
��B�]��\�Ә[YOH�ݙ\����ZY[���[�Y[Ȉ�[O^���ܙ\��	�\��Y�\�KX�ܙ\�\�X�JI�_O��]��\�Ә[YOH�ܚYܚYX���L��\\�N�ܚYX���M��[O^���X��ܛ�[��	ݘ\�KX�ܙ\�\�X�JI�_O����]˛X\

�HO�
�]��^O^�˛X�[H�\�Ә[YOH��^�^X���\LH��\�\��X�HMKLˍH����\�Ә[YOH�[�[[X�[���˛X�[O����\�Ә[YOH�Y]�X�^V̌�H�۝X��XY[��[�ۙH��[O^����܎�˝ۙH��	ݘ\�K]^\�[X\�JI�_O��˝�[Y_O����]���
J_B��]����\�X�]�]HZY�؜���[��
H	��
��\�Ә[YOH��ܙ\�]MKL�^^�^Yܘ^KML��[O^���ܙ\���܎�	ݘ\�KX�ܙ\�\�X�JI�_O���ZY�؜���[�HZY�؞�ZY�؜���[�OOHH�	���	���B��\�X�]�]H	���0��\�X�]�]Hۙ]�]J\�X�]�]JK����[Q]T��[��
_OϟB����
_B��]�����X�[ۏ����\�Ә[YOH�X�L��۝\�[ZX�����؈\�ܞH
ڛؓ\��[��JO����]��\�Ә[YOH��X�K^KL����ڛؓ\��X\

�HO�
�[���^O^ڋ�YH�Y�^�ڛ؜��ڋ�YXH�\�Ә[YOH��\��^][\�X�[�\��\�Y�KX�]�Y[�ݙ\���ܙ\�X��[�ML���]����\�Ә[YOH��۝[YY][H��ڋ�]_O����\�Ә[YOH�^^�^Yܘ^KML��ۙ]�]J��ܙX]Y�]
K����[Q]T��[��
_H0��ڋ��\��X�K��\X�J	���	�	�_O����]����]\ИY�H�]\�^ڋ��]\�Hς��[�ς�
J_B��Z�ؓ\��[��	���\�Ә[YOH�^\�H^Yܘ^KML�����؜�Y]���B��]�����X�[ۏ����X�[ۏ����\�Ә[YOH�X�L��۝\�[ZX����\�[X]\�
�\�\��[��JO����]��\�Ә[YOH��X�K^KL�����\�\��X\

JHO�
�[���^O^�K�YH�Y�^��\�[X]\���K�YXH�\�Ә[YOH��\��^][\�X�[�\��\�Y�KX�]�Y[�ݙ\���ܙ\�X��[�ML���]����\�Ә[YOH��۝[YY][H��\�[X]H��K�\�[X]W۝[X�\�O����\�Ә[YOH�^^�^Yܘ^KML��ۙ]�]JK�ܙX]Y�]
K����[Q]T��[��
_O����]����[��\�Ә[YOH��^][\�X�[�\��\L�^\�H���[��\�Ә[YOH��Y�H��Yܘ^KLL�\][^�H^Yܘ^KM����K��]\�O��[���[ۙ^J�[X�\�K��[
J_O��[����[�ς�
J_B��Y\�\��[��	���\�Ә[YOH�^\�H^Yܘ^KML����\�[X]\�Y]���B��]�����X�[ۏ����X�[ۏ����\�Ә[YOH�X�L��۝\�[ZX����[���X�\�
�[��\��[��JO����]��\�Ә[YOH��X�K^KL�����[��\��X\

JHO�
�[���^O^�K�YH�Y�^��[���X�\���K�YXH�\�Ә[YOH��\��^][\�X�[�\��\�Y�KX�]�Y[�ݙ\���ܙ\�X��[�ML���]����\�Ә[YOH��۝[YY][H��[���X�H��K�[���X�W۝[X�\�O����\�Ә[YOH�^^�^Yܘ^KML��ۙ]�]JK�ܙX]Y�]
K����[Q]T��[��
_O����]����[��\�Ә[YOH��^][\�X�[�\��\L�^\�H���]\ИY�H�]\�^�K��]\�Hψ�[ۙ^J�[X�\�K��[
J_O��[����[�ς�
J_B��Z[��\��[��	���\�Ә[YOH�^\�H^Yܘ^KML����[���X�\�Y]���B��]�����X�[ۏ����X�[ۏ����\�Ә[YOH�X�L��۝\�[ZX������\�������Q�ܛH[�]U\OH��\��Y\��[�]RY^�˚YHς�]��\�Ә[YOH�]L��X�K^KL�������\�\���V�H�[
O˛X\

�HO�
�]��^O^ۋ�YH�\�Ә[YOH��\�KL�^\�H����ۋ���_O����\�Ә[YOH�]LH^^�^Yܘ^KM��ۙ]�]J��ܙX]Y�]
K����[T��[��
_O����]���
J_B��]�����X�[ۏ����X�[ۏ����\�Ә[YOH�X�L��۝\�[ZX�����[[Y[[�H�[��\�Ә[YOH�^^��۝[�ܛX[^Yܘ^KM��X�]�]H��O��[������]��\�Ә[YOH��\�]�YK^H]�YKYܘ^KLLL����X�]�]H\�X�]�]Q[��V�H�[
O˛X\

JHO�
�]��^O^�K�YH�\�Ә[YOH��^�\�Y�KX�]�Y[�MKL�^\�H����[��\�Ә[YOH��\][^�H���K�[�]W�\_H�K�X�[ۗ�\K��\X�J	���	�	�_O��[����[��\�Ә[YOH�^^�^Yܘ^KM��ۙ]�]JK�ܙX]Y�]
K����[T��[��
_O��[����]���
J_B��XX�]�]O˛[��	���\�Ә[YOH�M^\�H^Yܘ^KML�����X�ܙYX�]�]K���B��]�����X�[ۏ���]���
NBimport Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import StatusBadge from '@/components/StatusBadge';
import NoteForm from '@/components/NoteForm';
import CustomerEditForm from './CustomerEditForm';
import BookAgainButton from './BookAgainButton';
import type { Customer, Job, ActivityEntry, Note, Invoice, Estimate } from '@/lib/types';

export const dynamic = 'force-dynamic';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default async function CustomerDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: customer }, { data: jobs }, { data: invoices }, { data: estimates }, { data: notes }, { data: activity }] =
    await Promise.all([
      supabase.from('customers').select('*').eq('id', params.id).single(),
      supabase.from('jobs').select('*').eq('customer_id', params.id).order('created_at', { ascending: false }),
      supabase.from('invoices').select('id,invoice_number,status,total,amount_paid,paid_at,created_at,due_at').eq('customer_id', params.id).order('created_at', { ascending: false }),
      supabase.from('estimates').select('id,estimate_number,status,total,created_at').eq('customer_id', params.id).order('created_at', { ascending: false }),
      supabase.from('notes').select('*').eq('entity_type', 'customer').eq('entity_id', params.id).order('created_at', { ascending: false }),
      supabase.from('activity_log').select('*').eq('entity_id', params.id).order('created_at', { ascending: false }).limit(50),
    ]);

  if (!customer) return <p>Customer not found.</p>;
  const c = customer as Customer;
  const jobList = (jobs as Job[] | null) ?? [];
  const invList = (invoices as Invoice[] | null) ?? [];
  const estList = (estimates as Estimate[] | null) ?? [];

  // ----- Customer 360 rollups -----
  const paidInvoices = invList.filter((i) => i.status === 'paid');
  const lifetimeRevenue = paidInvoices.reduce((s, i) => s + Number(i.total), 0);
  const balanceOwed = invList
    .filter((i) => i.status === 'sent')
    .reduce((s, i) => s + (Number(i.total) - Number(i.amount_paid ?? 0)), 0);
  const paidJobsCount = jobList.filter((j) => j.status === 'paid').length;
  const avgTicket = paidInvoices.length ? lifetimeRevenue / paidInvoices.length : 0;
  // Most recent lead source recorded on any of this customer's jobs.
  const leadSource = jobList.map((j) => j.lead_source).find(Boolean) ?? null;
  const lastActivity = [
    ...jobList.map((j) => j.created_at),
    ...invList.map((i) => i.paid_at ?? i.created_at),
  ].filter(Boolean).sort().pop();

  const stats: { label: string; value: string; tone?: string }[] = [
    { label: 'Lifetime revenue', value: money(lifetimeRevenue), tone: 'var(--brand-text)' },
    { label: 'Balance owed', value: money(balanceOwed), tone: balanceOwed > 0 ? 'var(--status-danger)' : undefined },
    { label: 'Jobs', value: String(jobList.length) },
    { label: 'Avg ticket', value: money(avgTicket) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/customers" className="text-sm text-brand-600 hover:underline">← Customers</Link>
        <h1 className="text-2xl font-bold">{c.name}</h1>
        <p className="text-sm text-gray-500">
          {c.phone ? <a href={`tel:${c.phone}`} className="text-brand-600 hover:underline">{c.phone}</a> : '—'}
          {' · '}
          {c.email ? <a href={`mailto:${c.email}`} className="text-brand-600 hover:underline">{c.email}</a> : '—'}
          {(c.address || c.city) && <> · {c.address ?? ''} {c.city ?? ''}</>}
          {leadSource && <> · source: {String(leadSource).replace(/_/g, ' ')}</>}
        </p>
        <div className="mt-1 flex gap-1">
          {c.tags.map((t) => <span key={t} className="badge bg-brand-50 text-brand-700">{t.replace('_', ' ')}</span>)}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <BookAgainButton customer={c} />
          <CustomerEditForm customer={c} />
        </div>
      </div>

      {/* Customer 360 rollup */}
      <div className="overflow-hidden rounded-lg" style={{ border: '1px solid var(--border-subtle)' }}>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: 'var(--border-subtle)' }}>
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-1 bg-surface px-4 py-3.5">
              <p className="panel-label">{s.label}</p>
              <p className="metric text-[22px] font-bold leading-none" style={{ color: s.tone ?? 'var(--text-primary)' }}>{s.value}</p>
            </div>
          ))}
        </div>
        {(lastActivity || paidJobsCount > 0) && (
          <p className="border-t px-4 py-2 text-xs text-gray-500" style={{ borderColor: 'var(--border-subtle)' }}>
            {paidJobsCount} paid job{paidJobsCount === 1 ? '' : 's'}
            {lastActivity && <> · last activity {new Date(lastActivity).toLocaleDateString()}</>}
          </p>
        )}
      </div>

      <section>
        <h2 className="mb-2 font-semibold">Job history ({jobList.length})</h2>
        <div className="space-y-2">
          {jobList.map((j) => (
            <Link key={j.id} href={`/jobs/${j.id}`} className="card flex items-center justify-between hover:border-brand-500">
              <div>
                <p className="font-medium">{j.title}</p>
                <p className="text-xs text-gray-500">{new Date(j.created_at).toLocaleDateString()} · {j.service.replace('_', ' ')}</p>
              </div>
              <StatusBadge status={j.status} />
            </Link>
          ))}
          {!jobList.length && <p className="text-sm text-gray-500">No jobs yet.</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Estimates ({estList.length})</h2>
        <div className="space-y-2">
          {estList.map((e) => (
            <Link key={e.id} href={`/estimates/${e.id}`} className="card flex items-center justify-between hover:border-brand-500">
              <div>
                <p className="font-medium">Estimate #{e.estimate_number}</p>
                <p className="text-xs text-gray-500">{new Date(e.created_at).toLocaleDateString()}</p>
              </div>
              <span className="flex items-center gap-2 text-sm"><span className="badge bg-gray-100 capitalize text-gray-700">{e.status}</span> {money(Number(e.total))}</span>
            </Link>
          ))}
          {!estList.length && <p className="text-sm text-gray-500">No estimates yet.</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Invoices ({invList.length})</h2>
        <div className="space-y-2">
          {invList.map((i) => (
            <Link key={i.id} href={`/invoices/${i.id}`} className="card flex items-center justify-between hover:border-brand-500">
              <div>
                <p className="font-medium">Invoice #{i.invoice_number}</p>
                <p className="text-xs text-gray-500">{new Date(i.created_at).toLocaleDateString()}</p>
              </div>
              <span className="flex items-center gap-2 text-sm"><StatusBadge status={i.status} /> {money(Number(i.total))}</span>
            </Link>
          ))}
          {!invList.length && <p className="text-sm text-gray-500">No invoices yet.</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Notes</h2>
        <NoteForm entityType="customer" entityId={c.id} />
        <div className="mt-2 space-y-2">
          {(notes as Note[] | null)?.map((n) => (
            <div key={n.id} className="card py-2 text-sm">
              <p>{n.body}</p>
              <p className="mt-1 text-xs text-gray-400">{new Date(n.created_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Full timeline <span className="text-xs font-normal text-gray-400">(activity log)</span></h2>
        <div className="card divide-y divide-gray-100 p-0">
          {(activity as ActivityEntry[] | null)?.map((a) => (
            <div key={a.id} className="flex justify-between px-4 py-2 text-sm">
              <span className="capitalize">{a.entity_type} {a.action_type.replace('_', ' ')}</span>
              <span className="text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</span>
            </div>
          ))}
          {!activity?.length && <p className="p-4 text-sm text-gray-500">No recorded activity.</p>}
        </div>
      </section>
    </div>
  );
}
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import StatusBadge from '@/components/StatusBadge';
import NoteForm from '@/components/NoteForm';
import CustomerEditForm from './CustomerEditForm';
import BookAgainButton from './BookAgainButton';
import type { Customer, Job, ActivityEntry, Note, Invoice, Estimate } from '@/lib/types';

export const dynamic = 'force-dynamic';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default async function CustomerDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: customer }, { data: jobs }, { data: invoices }, { data: estimates }, { data: notes }, { data: activity }] =
    await Promise.all([
      supabase.from('customers').select('*').eq('id', params.id).single(),
      supabase.from('jobs').select('*').eq('customer_id', params.id).order('created_at', { ascending: false }),
      supabase.from('invoices').select('id,invoice_number,status,total,amount_paid,paid_at,created_at,due_at').eq('customer_id', params.id).order('created_at', { ascending: false }),
      supabase.from('estimates').select('id,estimate_number,status,total,created_at').eq('customer_id', params.id).order('created_at', { ascending: false }),
      supabase.from('notes').select('*').eq('entity_type', 'customer').eq('entity_id', params.id).order('created_at', { ascending: false }),
      supabase.from('activity_log').select('*').eq('entity_id', params.id).order('created_at', { ascending: false }).limit(50),
    ]);

  if (!customer) return <p>Customer not found.</p>;
  const c = customer as Customer;
  const jobList = (jobs as Job[] | null) ?? [];
  const invList = (invoices as Invoice[] | null) ?? [];
  const estList = (estimates as Estimate[] | null) ?? [];

  // ----- Customer 360 rollups -----
  const paidInvoices = invList.filter((i) => i.status === 'paid');
  const lifetimeRevenue = paidInvoices.reduce((s, i) => s + Number(i.total), 0);
  const balanceOwed = invList
    .filter((i) => i.status === 'sent')
    .reduce((s, i) => s + (Number(i.total) - Number(i.amount_paid ?? 0)), 0);
  const paidJobsCount = jobList.filter((j) => j.status === 'paid').length;
  const avgTicket = paidInvoices.length ? lifetimeRevenue / paidInvoices.length : 0;
  // Most recent lead source recorded on any of this customer's jobs.
  const leadSource = jobList.map((j) => j.lead_source).find(Boolean) ?? null;
  const lastActivity = [
    ...jobList.map((j) => j.created_at),
    ...invList.map((i) => i.paid_at ?? i.created_at),
  ].filter(Boolean).sort().pop();

  const stats: { label: string; value: string; tone?: string }[] = [
    { label: 'Lifetime revenue', value: money(lifetimeRevenue), tone: 'var(--brand-text)' },
    { label: 'Balance owed', value: money(balanceOwed), tone: balanceOwed > 0 ? 'var(--status-danger)' : undefined },
    { label: 'Jobs', value: String(jobList.length) },
    { label: 'Avg ticket', value: money(avgTicket) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/customers" className="text-sm text-brand-600 hover:underline">← Customers</Link>
        <h1 className="text-2xl font-bold">{c.name}</h1>
        <p className="text-sm text-gray-500">
          {c.phone ? <a href={`tel:${c.phone}`} className="text-brand-600 hover:underline">{c.phone}</a> : '—'}
          {' · '}
          {c.email ? <a href={`mailto:${c.email}`} className="text-brand-600 hover:underline">{c.email}</a> : '—'}
          {(c.address || c.city) && <> · {c.address ?? ''} {c.city ?? ''}</>}
          {leadSource && <> · source: {String(leadSource).replace(/_/g, ' ')}</>}
        </p>
        <div className="mt-1 flex gap-1">
          {c.tags.map((t) => <span key={t} className="badge bg-brand-50 text-brand-700">{t.replace('_', ' ')}</span>)}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <BookAgainButton customer={c} />
          <CustomerEditForm customer={c} />
        </div>
      </div>

      {/* Customer 360 rollup */}
      <div className="overflow-hidden rounded-lg" style={{ border: '1px solid var(--border-subtle)' }}>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: 'var(--border-subtle)' }}>
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-1 bg-surface px-4 py-3.5">
              <p className="panel-label">{s.label}</p>
              <p className="metric text-[22px] font-bold leading-none" style={{ color: s.tone ?? 'var(--text-primary)' }}>{s.value}</p>
            </div>
          ))}
        </div>
        {(lastActivity || paidJobsCount > 0) && (
          <p className="border-t px-4 py-2 text-xs text-gray-500" style={{ borderColor: 'var(--border-subtle)' }}>
            {paidJobsCount} paid job{paidJobsCount === 1 ? '' : 's'}
            {lastActivity && <> · last activity {new Date(lastActivity).toLocaleDateString()}</>}
          </p>
        )}
      </div>

      <section>
        <h2 className="mb-2 font-semibold">Job history ({jobList.length})</h2>
        <div className="space-y-2">
          {jobList.map((j) => (
            <Link key={j.id} href={`/jobs/${j.id}`} className="card flex items-center justify-between hover:border-brand-500">
              <div>
                <p className="font-medium">{j.title}</p>
                <p className="text-xs text-gray-500">{new Date(j.created_at).toLocaleDateString()} · {j.service.replace('_', ' ')}</p>
              </div>
              <StatusBadge status={j.status} />
            </Link>
          ))}
          {!jobList.length && <p className="text-sm text-gray-500">No jobs yet.</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Estimates ({estList.length})</h2>
        <div className="space-y-2">
          {estList.map((e) => (
            <Link key={e.id} href={`/estimates/${e.id}`} className="card flex items-center justify-between hover:border-brand-500">
              <div>
                <p className="font-medium">Estimate #{e.estimate_number}</p>
                <p className="text-xs text-gray-500">{new Date(e.created_at).toLocaleDateString()}</p>
              </div>
              <span className="flex items-center gap-2 text-sm"><span className="badge bg-gray-100 capitalize text-gray-700">{e.status}</span> {money(Number(e.total))}</span>
            </Link>
          ))}
          {!estList.length && <p className="text-sm text-gray-500">No estimates yet.</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Invoices ({invList.length})</h2>
        <div className="space-y-2">
          {invList.map((i) => (
            <Link key={i.id} href={`/invoices/${i.id}`} className="card flex items-center justify-between hover:border-brand-500">
              <div>
                <p className="font-medium">Invoice #{i.invoice_number}</p>
                <p className="text-xs text-gray-500">{new Date(i.created_at).toLocaleDateString()}</p>
              </div>
              <span className="flex items-center gap-2 text-sm"><StatusBadge status={i.status} /> {money(Number(i.total))}</span>
            </Link>
          ))}
          {!invList.length && <p className="text-sm text-gray-500">No invoices yet.</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Notes</h2>
        <NoteForm entityType="customer" entityId={c.id} />
        <div className="mt-2 space-y-2">
          {(notes as Note[] | null)?.map((n) => (
            <div key={n.id} className="card py-2 text-sm">
              <p>{n.body}</p>
              <p className="mt-1 text-xs text-gray-400">{new Date(n.created_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Full timeline <span className="text-xs font-normal text-gray-400">(activity log)</span></h2>
        <div className="card divide-y divide-gray-100 p-0">
          {(activity as ActivityEntry[] | null)?.map((a) => (
            <div key={a.id} className="flex justify-between px-4 py-2 text-sm">
              <span className="capitalize">{a.entity_type} {a.action_type.replace('_', ' ')}</span>
              <span className="text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</span>
            </div>
          ))}
          {!activity?.length && <p className="p-4 text-sm text-gray-500">No recorded activity.</p>}
        </div>
      </section>
    </div>
  );
}
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import StatusBadge from '@/components/StatusBadge';
import NoteForm from '@/components/NoteForm';
import CustomerEditForm from './CustomerEditForm';
import BookAgainButton from './BookAgainButton';
import type { Customer, Job, ActivityEntry, Note } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function CustomerDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: customer }, { data: jobs }, { data: notes }, { data: activity }] = await Promise.all([
    supabase.from('customers').select('*').eq('id', params.id).single(),
    supabase.from('jobs').select('*').eq('customer_id', params.id).order('created_at', { ascending: false }),
    supabase.from('notes').select('*').eq('entity_type', 'customer').eq('entity_id', params.id).order('created_at', { ascending: false }),
    supabase.from('activity_log').select('*').eq('entity_id', params.id).order('created_at', { ascending: false }).limit(50),
  ]);

  if (!customer) return <p>Customer not found.</p>;
  const c = customer as Customer;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/customers" className="text-sm text-brand-600 hover:underline">← Customers</Link>
        <h1 className="text-2xl font-bold">{c.name}</h1>
        <p className="text-sm text-gray-500">{c.phone ?? '—'} · {c.email ?? '—'} · {c.address ?? ''} {c.city ?? ''}</p>
        <div className="mt-1 flex gap-1">
          {c.tags.map((t) => <span key={t} className="badge bg-brand-50 text-brand-700">{t.replace('_', ' ')}</span>)}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <BookAgainButton customer={c} />
          <CustomerEditForm customer={c} />
        </div>
      </div>

      <section>
        <h2 className="mb-2 font-semibold">Job history ({jobs?.length ?? 0})</h2>
        <div className="space-y-2">
          {(jobs as Job[] | null)?.map((j) => (
            <Link key={j.id} href={`/jobs/${j.id}`} className="card flex items-center justify-between hover:border-brand-500">
              <div>
                <p className="font-medium">{j.title}</p>
                <p className="text-xs text-gray-500">{new Date(j.created_at).toLocaleDateString()} · {j.service.replace('_', ' ')}</p>
              </div>
              <StatusBadge status={j.status} />
            </Link>
          ))}
          {!jobs?.length && <p className="text-sm text-gray-500">No jobs yet.</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Notes</h2>
        <NoteForm entityType="customer" entityId={c.id} />
        <div className="mt-2 space-y-2">
          {(notes as Note[] | null)?.map((n) => (
            <div key={n.id} className="card py-2 text-sm">
              <p>{n.body}</p>
              <p className="mt-1 text-xs text-gray-400">{new Date(n.created_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Full timeline <span className="text-xs font-normal text-gray-400">(activity log)</span></h2>
        <div className="card divide-y divide-gray-100 p-0">
          {(activity as ActivityEntry[] | null)?.map((a) => (
            <div key={a.id} className="flex justify-between px-4 py-2 text-sm">
              <span className="capitalize">{a.entity_type} {a.action_type.replace('_', ' ')}</span>
              <span className="text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</span>
            </div>
          ))}
          {!activity?.length && <p className="p-4 text-sm text-gray-500">No recorded activity.</p>}
        </div>
      </section>
    </div>
  );
}
