import type { Metadata } from 'next';
import './globals.css';
import HourlyAutoRefresh from './hourly-auto-refresh';

export const metadata: Metadata = {
  metadataBase: new URL('https://tokyo-weather-800x480.maobon.chatgpt.site'),
  title: 'USD to CNH Chart',
  description: 'A live 800 × 480 dashboard showing the 30-day USD to offshore Chinese yuan exchange-rate trend.',
  openGraph: {
    title: 'USD to CNH Chart',
    description: '30-day exchange rate dashboard for an 800 × 480 display.',
    images: [{ url: '/og.png', width: 768, height: 512, alt: 'USD to CNH 30-day exchange rate dashboard' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'USD to CNH Chart',
    description: '30-day exchange rate dashboard for an 800 × 480 display.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <HourlyAutoRefresh />
        {children}
      </body>
    </html>
  );
}
