'use client';

import Link from 'next/link';
import { forwardRef, useState, useSyncExternalStore } from 'react';
import { clearSession, getSession, subscribeSession, usesAccount } from '@/lib/storage/session';
import ConfirmationDialog from '@/components/Controls/ConfirmationDialog';
import CollectionTabs from '@/components/Library/CollectionTabs';
import ViewSettings from './ViewSettings';

const noSession = () => null;

/**
 * The way out. Signing out asks first, and says whose account it is, which is the one place
 * that matters: the corner itself stays uncluttered.
 */
function AccountMenu() {
  const session = useSyncExternalStore(subscribeSession, getSession, noSession);
  const [asking, setAsking] = useState(false);
  if (!session) return null;
  const name = session.user?.displayName;
  const email = session.user?.email;
  const who = name && email ? `${name} (${email})` : name || email || 'this account';
  return (
    <span className="account-menu">
      <button type="button" className="text-action account-out" onClick={() => setAsking(true)}>
        Sign out
      </button>
      {asking && (
        <ConfirmationDialog
          title="Sign out?"
          message={`You're signed in as ${who}. Your albums stay safe in your account, and you can sign in again at any time.`}
          cancelLabel="Stay signed in"
          confirmLabel="Sign out"
          confirmTone="solid"
          onConfirm={() => {
            setAsking(false);
            clearSession();
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </span>
  );
}

/**
 * Inside an album, the brand gives way to the way back to the library. In the library,
 * `collections` adds the Individual and Couple tabs to the top right corner.
 */
const Header = forwardRef(function Header({ backToLibrary = false, collections = null }, ref) {
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
        {collections && <CollectionTabs {...collections} />}
        {usesAccount ? <AccountMenu /> : <span className="site-note">Kept privately in this browser</span>}
        <ViewSettings />
      </span>
    </header>
  );
});

export default Header;
