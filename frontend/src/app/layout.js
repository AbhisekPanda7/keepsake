import { Caveat, Cormorant_Garamond, EB_Garamond } from 'next/font/google';
import AccountGate from '@/components/Account/AccountGate';
import './globals.css';

const display = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

const body = EB_Garamond({
  subsets: ['latin'],
  weight: ['400', '500'],
  style: ['normal', 'italic'],
  variable: '--font-body',
  display: 'swap',
});

/** Captions, which read as written into the album by hand. */
const hand = Caveat({
  subsets: ['latin'],
  weight: ['500'],
  variable: '--font-hand',
  display: 'swap',
});

export const metadata = {
  title: 'Keepsake',
  description: 'Keep your photographs in a real album you can open, and turn its pages by hand.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0c0705',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${hand.variable}`}>
      <body>
        <AccountGate>{children}</AccountGate>
      </body>
    </html>
  );
}
