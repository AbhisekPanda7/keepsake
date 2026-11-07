'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { TIERS, TIER_BALANCED, TIER_HIGH, TIER_LOW, viewSettings } from '@/lib/ambient/quality';

const CHOICES = [
  { id: 'auto', label: 'Automatic' },
  { id: TIER_HIGH, label: TIERS[TIER_HIGH].label },
  { id: TIER_BALANCED, label: TIERS[TIER_BALANCED].label },
  { id: TIER_LOW, label: TIERS[TIER_LOW].label },
];

/** A small menu for how much the scene draws, and whether books open with their scene. */
export default function ViewSettings() {
  const view = useSyncExternalStore(viewSettings.subscribe, viewSettings.get, viewSettings.getServer);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="view-settings">
      <button type="button" className="view-settings-button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        View
      </button>
      {open && (
        <div className="view-settings-panel">
          <fieldset>
            <legend>Picture quality</legend>
            {CHOICES.map((choice) => (
              <label key={choice.id}>
                <input
                  type="radio"
                  name="view-quality"
                  value={choice.id}
                  checked={view.choice === choice.id}
                  onChange={() => viewSettings.setChoice(choice.id)}
                />
                {choice.label}
              </label>
            ))}
          </fieldset>
          <label className="view-settings-toggle">
            <input type="checkbox" checked={view.openingScene} onChange={(event) => viewSettings.setOpeningScene(event.target.checked)} />
            Opening scene when a book is opened
          </label>
        </div>
      )}
    </div>
  );
}
