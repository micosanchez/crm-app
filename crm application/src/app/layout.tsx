import type { Metadata, Viewport } from 'next';
import './globals.css';
import Nav from '@/components/Nav';
import SwRegister from '@/components/SwRegister';

export const metadata: Metadata = {
  title: 'SJHC Command Center',
  description: 'Sanchez Junk & Haul Co. — Remove. Refresh. Reclaim.',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#2a0a1c',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <SwRegister />
        <Nav />
        <main className="mx-auto max-w-7xl p-4 pb-24 md:pb-4">{children}</main>
      </body>
    </html>
  );
}
