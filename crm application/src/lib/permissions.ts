import type { UserRole } from './types';

const PERMS: Record<string, UserRole[]> = {
  'invoices.write': ['admin', 'dispatcher'],
  'users.manage': ['admin'],
  'jobs.write': ['admin', 'dispatcher', 'technician'],
  'customers.write': ['admin', 'dispatcher', 'technician'],
  'schedule.write': ['admin', 'dispatcher'],
};

export function can(role: UserRole | undefined, action: keyof typeof PERMS): boolean {
  if (!role) return false;
  return PERMS[action]?.includes(role) ?? false;
}
