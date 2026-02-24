import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/lib/providers';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'NovaPM Dashboard',
  description: 'Next-generation process manager dashboard',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased bg-nova-bg text-nova-text-primary">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
