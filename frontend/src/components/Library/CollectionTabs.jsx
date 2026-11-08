'use client';

import { useRef } from 'react';
import CategoryIcon from '@/components/UI/CategoryIcon';
import { CATEGORIES, CATEGORY_ORDER } from '@/lib/album/categories';

/**
 * The library's two collections, as two small engraved tabs in the header's corner, beside
 * Sign out and View. Arrow keys move between them, as in any set of tabs.
 */
export default function CollectionTabs({ active, counts, onChange, panelId }) {
  const refs = useRef({});

  const onKeyDown = (event) => {
    const index = CATEGORY_ORDER.indexOf(active);
    let next = null;
    if (event.key === 'ArrowRight') next = CATEGORY_ORDER[(index + 1) % CATEGORY_ORDER.length];
    if (event.key === 'ArrowLeft') next = CATEGORY_ORDER[(index - 1 + CATEGORY_ORDER.length) % CATEGORY_ORDER.length];
    if (event.key === 'Home') next = CATEGORY_ORDER[0];
    if (event.key === 'End') next = CATEGORY_ORDER[CATEGORY_ORDER.length - 1];
    if (!next) return;
    event.preventDefault();
    onChange(next);
    refs.current[next]?.focus();
  };

  return (
    <div className="collections" role="tablist" aria-label="Collections" onKeyDown={onKeyDown}>
      {CATEGORY_ORDER.map((id) => {
        const selected = id === active;
        return (
          <button
            key={id}
            ref={(element) => {
              refs.current[id] = element;
            }}
            type="button"
            role="tab"
            id={`collection-${id}`}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            className={`collection-tab${selected ? ' is-active' : ''}`}
            onClick={() => onChange(id)}
          >
            <CategoryIcon category={id} size={16} />
            <span className="collection-name">{CATEGORIES[id].name}</span>
            <span className="collection-count" aria-label={`${counts[id]} ${counts[id] === 1 ? 'album' : 'albums'}`}>
              {counts[id]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
