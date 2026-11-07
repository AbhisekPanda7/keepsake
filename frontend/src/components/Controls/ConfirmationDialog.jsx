'use client';

import { useEffect, useRef } from 'react';

/**
 * Asks before a destructive action. A native modal <dialog> provides the focus trap,
 * Escape handling and inert background. Focus starts on Keep so that a stray Enter
 * can't delete anything.
 */
export default function ConfirmationDialog({ title, message, confirmLabel, onConfirm, onCancel }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="paper-dialog"
      aria-labelledby="confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="confirm-title">{title}</h2>
      <p>{message}</p>
      <div className="dialog-actions">
        <button type="button" className="paper-btn" autoFocus onClick={onCancel}>
          Keep
        </button>
        <button type="button" className="paper-btn danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
