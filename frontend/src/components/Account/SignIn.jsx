'use client';

import { useEffect, useRef, useState } from 'react';
import { login, register } from '@/lib/storage/remoteStore';
import { setSession } from '@/lib/storage/session';

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72;
// A free server sleeps when unused and can take up to a minute to wake.
const SLOW_AFTER_MS = 5000;

/** Signing in and creating an account are one form, so switching keeps what was typed. */
export default function SignIn() {
  const [mode, setMode] = useState('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');
  const emailRef = useRef(null);
  const creating = mode === 'create';

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!busy) return undefined;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [busy]);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (creating && password.length < MIN_PASSWORD) {
      setError(`Please choose a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const session = creating
        ? await register({ email: email.trim(), password, displayName: name.trim() })
        : await login({ email: email.trim(), password });
      setSession(session);
    } catch (failure) {
      setError(failure.message || 'That did not work. Please try again.');
      setBusy(false);
    }
  };

  const switchTo = (next) => {
    setMode(next);
    setError('');
  };

  return (
    <main className="account">
      <span className="brand account-brand">Keepsake</span>
      <form className="account-card" onSubmit={submit}>
        <h1>{creating ? 'Begin your albums' : 'Welcome back'}</h1>
        <p className="account-lede">
          {creating
            ? 'An account keeps your albums safe, and lets you open them on your phone or your computer.'
            : 'Sign in to open your albums.'}
        </p>

        {creating && (
          <label className="field">
            <span>Your name</span>
            <input name="name" type="text" value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input
            ref={emailRef}
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Password{creating ? ` (at least ${MIN_PASSWORD} characters)` : ''}</span>
          <input
            name="password"
            type="password"
            required
            minLength={creating ? MIN_PASSWORD : undefined}
            maxLength={MAX_PASSWORD}
            autoComplete={creating ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <p className="account-error" role="alert">
          {error}
        </p>

        <button type="submit" className="paper-btn solid account-submit" disabled={busy}>
          {busy ? (creating ? 'Creating your account…' : 'Signing in…') : creating ? 'Create account' : 'Sign in'}
        </button>
        {slow && (
          <p className="account-wait" aria-live="polite">
            The server is waking up. The first visit after a quiet spell can take up to a minute.
          </p>
        )}

        <p className="account-switch">
          {creating ? 'Already have an account? ' : 'New to Keepsake? '}
          <button type="button" className="text-action" onClick={() => switchTo(creating ? 'sign-in' : 'create')}>
            {creating ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </form>
    </main>
  );
}
