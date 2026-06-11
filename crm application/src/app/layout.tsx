import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Nav from '@/components/Nav';
import SwRegister from '@/components/SwRegister';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: 'SJHC Command Center',
  description: 'Sanchez Junk & Haul Co. — Remove. Refresh. Reclaim.',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#050505',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen antialiased`}>
        <SwRegister />
        <Nav />
        <main className="mx-auto max-w-7xl p-4 pb-24 md:pb-8">{children}</main>
      </body>
    </html>
  );
}
