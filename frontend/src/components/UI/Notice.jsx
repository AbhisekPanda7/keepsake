'use client';

import { useEffect } from 'react';

const AUTO_DISMISS_MS = 4500;

/** A slip of paper with progress and results. It never blocks the book. */
export default function Notice({ upload, notice, onDismiss }) {
  useEffect(() => {
    if (!notice || notice.tone !== 'ok') return undefined;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notice, onDismiss]);

  if (upload) {
    const shown = Math.min(upload.done + 1, upload.total);
    return (
      <div className="notice" role="status">
        <span>
          Preparing photograph {shown} of {upload.total}…
        </span>
        <span className="notice-bar">
          <span style={{ transform: `scaleX(${upload.done / upload.total})` }} />
        </span>
      </div>
    );
  }
  if (!notice) return null;
  return (
    <div className={`notice ${notice.tone === 'error' ? 'is-error' : ''}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
      <span>{notice.text}</span>
      <button type="button" className="notice-close" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
