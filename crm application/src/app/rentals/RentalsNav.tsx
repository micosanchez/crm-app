import Link from 'next/link';

export const SUBNAV = [['/rentals', 'Board'], ['/rentals/calendar', 'Calendar'], ['/rentals/today', "Today's route"], ['/rentals/inventory', 'Inventory'], ['/rentals/packages', 'Packages'], ['/rentals/partners', 'Partners'], ['/rentals/waitlist', 'Waitlist'], ['/rentals/labels', 'Labels'], ['/rentals/reports', 'Reports'], ['/rentals/settings', 'Settings']];

export default function RentalsNav({ active }: { active: string }) {
  return (<nav className="flex flex-wrap gap-1 text-sm">{SUBNAV.map(([href, label]) => <Link key={href} href={href} className={`rounded-md px-3 py-1.5 ${active === href ? 'bg-[var(--brand-primary)] text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{label}</Link>)}</nav>);
}
