'use client';

import Link from 'next/link';
import { usesAccount } from '@/lib/storage/session';

/**
 * Screens that only mean something with accounts, such as resetting a password. When
 * albums are kept in this browser there are no passwords, so they say so instead.
 */
export default function AccountOnly({ children }) {
  if (usesAccount) return children;
  return (
    <main className="account">
      <span className="brand account-brand">Keepsake</span>
      <section className="account-card">
        <h1>No account needed</h1>
        <p className="account-lede">This copy of Keepsake keeps albums in this browser, without accounts or passwords.</p>
        <Link href="/" className="paper-btn solid account-submit">
          Open your albums
        </Link>
      </section>
    </main>
  );
}
