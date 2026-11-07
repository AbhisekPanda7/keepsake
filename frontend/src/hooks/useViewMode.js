'use client';

import { useSyncExternalStore } from 'react';
import { MODE_SINGLE, MODE_SPREAD } from '@/lib/album/pageModel';

/**
 * Portrait phones get one page at a time. Width alone is not the test: a landscape
 * phone has room for a spread at a useful size, and so does a portrait tablet.
 */
const SINGLE_PAGE_QUERY = '(max-width: 640px) and (orientation: portrait)';

function subscribe(onChange) {
  const media = window.matchMedia(SINGLE_PAGE_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

const getSnapshot = () => (window.matchMedia(SINGLE_PAGE_QUERY).matches ? MODE_SINGLE : MODE_SPREAD);
const getServerSnapshot = () => MODE_SPREAD;

export function useViewMode() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
