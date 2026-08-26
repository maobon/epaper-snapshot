import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'USD to CNH Chart',
  description: 'A live 800 × 480 dashboard showing the 30-day USD to offshore Chinese yuan exchange-rate trend.',
  openGraph: {
    title: 'USD to CNH Chart',
    description: '30-day exchange rate dashboard for an 800 × 480 display.',
  },
  twitter: {
    card: 'summary',
    title: 'USD to CNH Chart',
    description: '30-day exchange rate dashboard for an 800 × 480 display.',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
