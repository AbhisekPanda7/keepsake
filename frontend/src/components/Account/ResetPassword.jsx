'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { MIN_PASSWORD, passwordProblem, passwordStrength } from '@/lib/account/passwordRules';
import { checkPasswordReset, confirmPasswordReset } from '@/lib/storage/remoteStore';
import { clearSession } from '@/lib/storage/session';
import PasswordField from './PasswordField';

/** Kept for this tab only, so that a reload still works after the code leaves the address bar. */
const KEY = 'keepsake.reset';
const CODE = /^[A-Za-z0-9_-]{43}$/;

/** The code from the link (…/reset-password#token=…), which never reaches any server's logs. */
function readCode() {
  const fromLink = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (fromLink) {
    try {
      sessionStorage.setItem(KEY, fromLink);
    } catch {
      // Then a reload simply needs the link again.
    }
    // Out of the address bar and the history, where it could be seen or copied.
    window.history.replaceState(null, '', window.location.pathname);
    return fromLink;
  }
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

function forgetCode() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}

const UNUSABLE = {
  reset_expired: { title: 'This link has expired', text: 'Reset links only last a short while. Please ask for a new one.' },
  reset_invalid: {
    title: 'This link can’t be used',
    text: 'It may have been used already, or replaced by a newer one. Please ask for a new link.',
  },
  missing: { title: 'This link is incomplete', text: 'Please open the link from your email again, or ask for a new one.' },
};

export default function ResetPassword() {
  const [stage, setStage] = useState('checking'); // checking | ready | unusable | done
  const [unusable, setUnusable] = useState(UNUSABLE.missing);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const firstRef = useRef(null);
  // Opening another reset link in the same tab only changes the part after #, so the page
  // isn't reloaded; it starts again here instead.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const onHashChange = () => {
      if (!new URLSearchParams(window.location.hash.slice(1)).get('token')) return;
      setPassword('');
      setAgain('');
      setError('');
      setUnusable(UNUSABLE.missing);
      setStage('checking');
      setAttempt((n) => n + 1);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const found = readCode();
    setCode(found);
    if (!CODE.test(found)) {
      setStage('unusable');
      return undefined;
    }
    let cancelled = false;
    checkPasswordReset(found).then(
      () => {
        if (!cancelled) setStage('ready');
      },
      (failure) => {
        if (cancelled) return;
        if (UNUSABLE[failure.reason]) {
          forgetCode();
          setUnusable(UNUSABLE[failure.reason]);
          setStage('unusable');
        } else {
          // The server couldn't be asked; the form still works, and the answer comes then.
          setError(failure.message || '');
          setStage('ready');
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    if (stage === 'ready') firstRef.current?.focus();
  }, [stage]);

  const problem = passwordProblem(password);
  const strength = passwordStrength(password);
  const mismatch = again !== '' && again !== password;
  const ready = !problem && again === password && !busy;

  const submit = async (event) => {
    event.preventDefault();
    if (problem) {
      setError(problem);
      return;
    }
    if (again !== password) {
      setError('The two passwords don’t match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await confirmPasswordReset({ token: code, password, confirmPassword: again });
      forgetCode();
      // Every earlier sign-in has ended, including any in this browser.
      clearSession();
      setStage('done');
    } catch (failure) {
      if (UNUSABLE[failure.reason]) {
        forgetCode();
        setUnusable(UNUSABLE[failure.reason]);
        setStage('unusable');
      } else {
        setError(failure.message || 'That did not work. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  let card;
  if (stage === 'checking') {
    card = (
      <section className="account-card" aria-busy="true">
        <h1>Choose a new password</h1>
        <p className="account-lede">Checking your link…</p>
      </section>
    );
  } else if (stage === 'unusable') {
    card = (
      <section className="account-card">
        <h1>{unusable.title}</h1>
        <p className="account-lede">{unusable.text}</p>
        <Link href="/forgot-password" className="paper-btn solid account-submit">
          Ask for a new link
        </Link>
        <p className="account-switch">
          <Link href="/" className="text-action">
            Back to sign in
          </Link>
        </p>
      </section>
    );
  } else if (stage === 'done') {
    card = (
      <section className="account-card account-sent" aria-live="polite">
        <span className="account-seal" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="m5.5 12.5 4.2 4.2 8.8-9.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h1>Your password is changed</h1>
        <p className="account-lede">Sign in with your new password. Anywhere you were signed in before has been signed out.</p>
        <Link href="/" className="paper-btn solid account-submit">
          Return to sign in
        </Link>
      </section>
    );
  } else {
    card = (
      <form className="account-card" onSubmit={submit} noValidate>
        <h1>Choose a new password</h1>
        <p className="account-lede">At least {MIN_PASSWORD} characters, mixing letters with numbers, spaces or symbols.</p>
        <PasswordField
          label="New password"
          name="new-password"
          value={password}
          onChange={setPassword}
          inputRef={firstRef}
          describedBy="password-strength"
          invalid={password !== '' && Boolean(problem)}
        />
        <div id="password-strength" className={`password-meter is-${strength.score}`} aria-live="polite">
          <span className="password-meter-bar" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="password-meter-text">
            {password ? (problem ? `${strength.label}. ${problem}` : strength.label) : ' '}
          </span>
        </div>
        <PasswordField
          label="Confirm password"
          name="confirm-password"
          value={again}
          onChange={setAgain}
          describedBy="password-match"
          invalid={mismatch}
        />
        <p id="password-match" className={`password-match${mismatch ? ' is-wrong' : again && !mismatch ? ' is-right' : ''}`}>
          {mismatch ? 'These don’t match yet.' : again && !mismatch ? 'They match.' : ' '}
        </p>
        <p className="account-error" role="alert">
          {error}
        </p>
        <button type="submit" className="paper-btn solid account-submit" disabled={!ready}>
          {busy ? 'Saving…' : 'Set new password'}
        </button>
        <p className="account-switch">
          <Link href="/" className="text-action">
            Back to sign in
          </Link>
        </p>
      </form>
    );
  }

  return (
    <main className="account">
      <span className="brand account-brand">Keepsake</span>
      {card}
    </main>
  );
}
