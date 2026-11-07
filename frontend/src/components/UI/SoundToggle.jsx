'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { enableSound, isSoundOn, setSoundOn, soundDebug, subscribeSound } from '@/lib/ambient/sound';

/** Browsers only allow sound after a click or key press, so this listens for the first. */
function useEnableSoundOnFirstGesture() {
  useEffect(() => {
    const enable = () => {
      enableSound();
      window.removeEventListener('pointerdown', enable, true);
      window.removeEventListener('keydown', enable, true);
    };
    window.addEventListener('pointerdown', enable, true);
    window.addEventListener('keydown', enable, true);
    if (process.env.NODE_ENV === 'development') window.__albumSound = soundDebug;
    return () => {
      window.removeEventListener('pointerdown', enable, true);
      window.removeEventListener('keydown', enable, true);
    };
  }, []);
}

export default function SoundToggle() {
  useEnableSoundOnFirstGesture();
  const on = useSyncExternalStore(subscribeSound, isSoundOn, () => true);
  return (
    <button
      type="button"
      className="sound-toggle"
      aria-pressed={on}
      aria-label="Sound"
      title={on ? 'Turn sound off' : 'Turn sound on'}
      onClick={() => setSoundOn(!on)}
    >
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <path d="M3 8v4h3l4 3.5v-11L6 8H3z" fill="currentColor" />
        {on ? (
          <path d="M12.6 7.2a4 4 0 0 1 0 5.6M14.8 5a7 7 0 0 1 0 10" fill="none" stroke="currentColor" strokeWidth="1.3" />
        ) : (
          <path d="m13 8 4 4m0-4-4 4" fill="none" stroke="currentColor" strokeWidth="1.3" />
        )}
      </svg>
      <span className="sound-label">{on ? 'Sound on' : 'Sound off'}</span>
    </button>
  );
}
