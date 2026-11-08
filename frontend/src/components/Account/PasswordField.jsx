'use client';

import { useId, useState } from 'react';

/** A password input that can be shown while typing, so a new password can be checked by eye. */
export default function PasswordField({ label, name, value, onChange, autoComplete = 'new-password', describedBy, inputRef, invalid }) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <div className="field password-field">
      <label htmlFor={id}>{label}</label>
      <span className="password-input">
        <input
          ref={inputRef}
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          required
          maxLength={128}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="password-toggle"
          aria-pressed={visible}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          onClick={() => setVisible((shown) => !shown)}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </span>
    </div>
  );
}
