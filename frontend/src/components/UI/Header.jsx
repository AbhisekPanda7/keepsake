'use client';

import Link from 'next/link';
import { forwardRef, useSyncExternalStore } from 'react';
import { clearSession, getSession, subscribeSession, usesAccount } from '@/lib/storage/session';
import ViewSettings from './ViewSettings';

const noSession = () => null;

/** Whose albums these are, and the way out. */
function AccountMenu() {
  const session = useSyncExternalStore(subscribeSession, getSession, noSession);
  if (!session) return null;
  const who = session.user?.displayName || session.user?.email || '';
  return (
    <span className="account-menu">
      <span className="site-note account-who" title={session.user?.email}>
        {who}
      </span>
      <button type="button" className="text-action account-out" onClick={clearSession}>
        Sign out
      </button>
    </span>
  );
}

/** Inside an album, the brand gives way to the way back to the library. */
const Header = forwardRef(function Header({ backToLibrary = false }, ref) {
  return (
    <header ref={ref} className="site-header">
      {backToLibrary ? (
        <Link href="/" className="back-link">
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M10 2.5 4.8 8l5.2 5.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          Library
        </Link>
      ) : (
        <span className="brand">Keepsake</span>
      )}
      <span className="site-header-end">
        {usesAccount ? <AccountMenu /> : <span className="site-note">Kept privately in this browser</span>}
        <ViewSettings />
      </span>
    </header>
  );
});

export default Header;
