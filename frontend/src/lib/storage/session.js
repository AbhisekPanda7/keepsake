/**
 * Who is signed in, when albums are kept by the Keepsake server rather than in this browser.
 *
 * Set NEXT_PUBLIC_API_URL (for example https://keepsake-api.onrender.com) and the app keeps
 * albums in your account on that server. Leave it unset and everything stays in this
 * browser, exactly as before, with no account at all.
 *
 * The sign-in token is kept in localStorage, so a reload or a new tab stays signed in until
 * it expires. Signing out forgets it.
 */

const KEY = 'keepsake.session';

export const API_URL = String(process.env.NEXT_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');

/** True when albums live in an account on the server. */
export const usesAccount = API_URL !== '';

const listeners = new Set();
let current;

function read() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved?.token && saved.expiresAt > Date.now()) return saved;
  } catch {
    // Unreadable or blocked storage: simply not signed in.
  }
  return null;
}

/** { token, expiresAt, user: { id, email, displayName } }, or null. */
export function getSession() {
  if (typeof window === 'undefined') return null;
  if (current === undefined) current = read();
  if (current && current.expiresAt <= Date.now()) current = null;
  return current;
}

function publish(next) {
  current = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // Still signed in for this visit, just not remembered.
  }
  listeners.forEach((fn) => fn(next));
}

export const setSession = (session) => publish(session);
export const clearSession = () => publish(null);

export function subscribeSession(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Signing in or out in another tab applies here too.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY) return;
    current = read();
    listeners.forEach((fn) => fn(current));
  });
}
