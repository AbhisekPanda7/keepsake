'use client';

import { useSyncExternalStore } from 'react';
import { getSession, subscribeSession, usesAccount } from '@/lib/storage/session';
import SignIn from './SignIn';

const SERVER = 'server';
const serverSnapshot = () => SERVER;

/**
 * When albums are kept on the server, everything waits for someone to sign in. Signing
 * out, or a token the server no longer accepts, brings this screen back. Without a server
 * there are no accounts and this does nothing.
 */
export default function AccountGate({ children }) {
  const session = useSyncExternalStore(subscribeSession, getSession, serverSnapshot);
  if (!usesAccount) return children;
  // Whether someone is signed in is only known in the browser, so the first render waits.
  if (session === SERVER) return null;
  if (!session) return <SignIn />;
  // A different person signing in starts from a fresh page.
  return <div key={session.user?.id} style={{ display: 'contents' }}>{children}</div>;
}
