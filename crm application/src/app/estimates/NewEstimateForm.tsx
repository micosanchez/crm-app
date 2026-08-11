'use client';
import Link from 'next/link';
import type { Customer } from '@/lib/types';

/* Kept for call-site compatibility: the "New estimate" action now opens the
   full-screen quote composer at /estimates/new instead of an inline modal. */
export default function NewEstimateForm({ triggerClassName = 'btn-primary', triggerLabel = '+ New estimate' }: {
  customers?: Pick<Customer, 'id' | 'name'>[];
  triggerClassName?: string;
  triggerLabel?: string;
}) {
  return <Link href="/estimates/new" className={triggerClassName}>{triggerLabel}</Link>;
}
