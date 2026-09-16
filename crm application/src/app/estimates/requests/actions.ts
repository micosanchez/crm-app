'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { fullName, refToLeadSource, type EstimateRequest } from '@/lib/requests';

/* Staff-only server actions for the Requests queue. Everything runs through the
   caller's own session, so RLS (0038: staff read + update) is the real gate and
   nothing here can be reached by a technician or by the public form. */

export interface DupeCandidate {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  reason: 'phone' | 'email' | 'address';
}

export type AcceptResult =
  | { ok: true; customerId: string }
  | { ok: false; duplicates: DupeCandidate[] }
  | { ok: false; error: string };

const digits = (s: string | null | undefined) => (s || '').replace(/\D/g, '').slice(-10);
const norm = (s: string | null | undefined) =>
  (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Accept a request. With no `customerId` and no `createNew`, it first looks for
 * an existing customer on the same phone, email or street and hands those back
 * so the caller can choose, instead of quietly making a second Chris Bujaki.
 */
export async function acceptRequest(
  id: string,
  opts: { customerId?: string; createNew?: boolean } = {},
): Promise<AcceptResult> {
  await requireStaff();
  const supabase = createClient();

  const { data: reqRow } = await supabase
    .from('estimate_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!reqRow) return { ok: false, error: 'That request is gone.' };
  const r = reqRow as EstimateRequest;

  let customerId = opts.customerId;

  if (!customerId) {
    const { data: all } = await supabase
      .from('customers')
      .select('id,name,phone,email,address')
      .is('deleted_at', null)
      .limit(2000);

    const wantPhone = digits(r.phone);
    const wantEmail = (r.email || '').toLowerCase().trim();
    const wantStreet = norm(r.address);

    const hits = new Map<string, DupeCandidate>();
    for (const c of (all ?? []) as Omit<DupeCandidate, 'reason'>[]) {
      let reason: DupeCandidate['reason'] | null = null;
      if (wantPhone && digits(c.phone) === wantPhone) reason = 'phone';
      else if (wantEmail && (c.email || '').toLowerCase().trim() === wantEmail) reason = 'email';
      else if (wantStreet && wantStreet.length > 5 && norm(c.address).includes(wantStreet)) reason = 'address';
      if (reason && !hits.has(c.id)) hits.set(c.id, { ...c, reason });
    }

    const duplicates = Array.from(hits.values()).slice(0, 5);
    if (duplicates.length && !opts.createNew) return { ok: false, duplicates };

    const { data: created, error } = await supabase
      .from('customers')
      .insert({
        name: fullName(r),
        phone: r.phone,
        email: r.email,
        address: r.address,
        city: r.city,
        state: r.state,
        postal_code: r.postal_code,
        lead_source: refToLeadSource(r.lead_source),
      })
      .select('id')
      .single();
    if (error || !created) {
      return { ok: false, error: `Couldn't create the customer: ${error?.message ?? 'unknown error'}` };
    }
    customerId = created.id as string;
  }
  if (!customerId) return { ok: false, error: 'No customer to link the request to.' };

  const { error: uErr } = await supabase
    .from('estimate_requests')
    .update({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      customer_id: customerId,
      declined_at: null,
      decline_reason: null,
    })
    .eq('id', id);
  if (uErr) return { ok: false, error: `Couldn't accept the request: ${uErr.message}` };

  revalidatePath('/estimates/requests');
  revalidatePath(`/estimates/requests/${id}`);
  return { ok: true, customerId };
}

export async function declineRequest(id: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const supabase = createClient();
  const { error } = await supabase
    .from('estimate_requests')
    .update({
      status: 'declined',
      declined_at: new Date().toISOString(),
      decline_reason: reason.trim() || null,
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/estimates/requests');
  revalidatePath(`/estimates/requests/${id}`);
  return { ok: true };
}

export async function markRequestSpam(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const supabase = createClient();
  const { error } = await supabase.from('estimate_requests').update({ status: 'spam' }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/estimates/requests');
  revalidatePath(`/estimates/requests/${id}`);
  return { ok: true };
}

/** Put a worked request back in the queue. */
export async function reopenRequest(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const supabase = createClient();
  const { error } = await supabase
    .from('estimate_requests')
    .update({ status: 'new', declined_at: null, decline_reason: null, accepted_at: null })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/estimates/requests');
  revalidatePath(`/estimates/requests/${id}`);
  return { ok: true };
}

export async function saveRequestNotes(id: string, notes: string): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const supabase = createClient();
  const { error } = await supabase
    .from('estimate_requests')
    .update({ internal_notes: notes.trim() || null })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/estimates/requests/${id}`);
  return { ok: true };
}

/** Called by the composer once a quote is saved from a request. */
export async function linkRequestQuote(id: string, quoteId: string): Promise<void> {
  await requireStaff();
  const supabase = createClient();
  await supabase.from('estimate_requests').update({ quote_id: quoteId }).eq('id', id);
  revalidatePath(`/estimates/requests/${id}`);
}
