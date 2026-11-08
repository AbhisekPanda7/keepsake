'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { takeEmail } from '@/lib/account/emailHandoff';
import { requestPasswordReset } from '@/lib/storage/remoteStore';

const SLOW_AFTER_MS = 5000;
const GENERIC = 'If that email belongs to a Keepsake account, a link to choose a new password is on its way.';

/**
 * Asks for a reset link. The answer is the same whether or not the email has an account,
 * so this screen can't be used to find out who has one.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(null);
  const emailRef = useRef(null);

  useEffect(() => {
    const handed = takeEmail();
    if (handed) setEmail(handed);
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
    setBusy(true);
    setError('');
    try {
      const answer = await requestPasswordReset(email.trim());
      setSent({ email: email.trim(), message: answer?.message || GENERIC });
    } catch (failure) {
      setError(failure.message || 'That did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="account">
      <span className="brand account-brand">Keepsake</span>
      {sent ? (
        <section className="account-card account-sent" aria-live="polite">
          <span className="account-seal" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path d="M3.5 6.5h17v11h-17z M3.8 6.8 12 13l8.2-6.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          </span>
          <h1>Check your email</h1>
          <p className="account-lede">{sent.message}</p>
          <p className="account-note">
            Sent to <strong>{sent.email}</strong>. If nothing arrives in a few minutes, look in your spam folder, or ask again.
          </p>
          <Link href="/" className="paper-btn solid account-submit">
            Back to sign in
          </Link>
          <p className="account-switch">
            <button type="button" className="text-action" onClick={() => setSent(null)}>
              Use a different email
            </button>
          </p>
        </section>
      ) : (
        <form className="account-card" onSubmit={submit}>
          <h1>Forgotten your password?</h1>
          <p className="account-lede">Enter the email you signed up with, and we&rsquo;ll send you a link to choose a new one.</p>
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
          <p className="account-error" role="alert">
            {error}
          </p>
          <button type="submit" className="paper-btn solid account-submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send Reset Link'}
          </button>
          {slow && (
            <p className="account-wait" aria-live="polite">
              The server is waking up. The first visit after a quiet spell can take up to a minute.
            </p>
          )}
          <p className="account-switch">
            Remembered it? <Link href="/" className="text-action">Back to sign in</Link>
          </p>
        </form>
      )}
    </main>
  );
}
