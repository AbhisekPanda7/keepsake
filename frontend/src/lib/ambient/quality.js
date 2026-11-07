/**
 * How much the scene draws, chosen to suit the device. Someone can pick a level by hand,
 * and on "auto" it steps down by itself if frames are being missed. The choice functions
 * are pure; the store around them only touches the browser when one is there.
 */

export const TIER_HIGH = 'high';
export const TIER_BALANCED = 'balanced';
export const TIER_LOW = 'low';

export const TIERS = {
  [TIER_HIGH]: { label: 'High', dpr: 2, post: true, dof: true, dofSamples: 16, windowLight: true, props: 'all', dust: 900, prints: 3, shadowSize: 2048, msaa: 4 },
  [TIER_BALANCED]: { label: 'Balanced', dpr: 1.5, post: true, dof: true, dofSamples: 10, windowLight: false, props: 'all', dust: 600, prints: 3, shadowSize: 1536, msaa: 2 },
  [TIER_LOW]: { label: 'Light', dpr: 1.5, post: false, dof: false, dofSamples: 0, windowLight: false, props: 'few', dust: 220, prints: 2, shadowSize: 1024, msaa: 0 },
};
const ORDER = [TIER_HIGH, TIER_BALANCED, TIER_LOW];

/** A sensible starting level from what the browser reveals about the device. */
export function pickTier({ coarsePointer = false, cores = 8, memoryGB = 8 } = {}) {
  if (coarsePointer) return cores >= 8 && memoryGB >= 6 ? TIER_BALANCED : TIER_LOW;
  if (cores <= 2 || memoryGB <= 2) return TIER_LOW;
  if (cores <= 4 || memoryGB <= 4) return TIER_BALANCED;
  return TIER_HIGH;
}

export function lowerTier(tier) {
  return ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(tier) + 1)];
}

/**
 * Whether a measured stretch of frames is too slow for the current level. Below this the
 * pages themselves start to feel heavy, which matters more than anything else drawn here.
 */
export const MIN_ACCEPTABLE_FPS = 24;
export function isTooSlow(frames, seconds) {
  return seconds > 0 && frames / seconds < MIN_ACCEPTABLE_FPS;
}

// ---- the store ------------------------------------------------------------------

const STORAGE_KEY = 'keepsake.view';
const listeners = new Set();
let state = null;

function detect() {
  if (typeof window === 'undefined') return TIER_HIGH;
  return pickTier({
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    cores: navigator.hardwareConcurrency ?? 8,
    memoryGB: navigator.deviceMemory ?? 8,
  });
}

function read() {
  if (state) return state;
  let saved = {};
  try {
    saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch {
    // Private windows and blocked storage just use the defaults.
  }
  const choice = saved.choice === 'auto' || Object.hasOwn(TIERS, saved.choice ?? '') ? saved.choice : 'auto';
  state = {
    choice,
    tier: choice === 'auto' ? detect() : choice,
    openingScene: saved.openingScene !== false,
  };
  return state;
}

function write(next) {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ choice: next.choice, openingScene: next.openingScene }));
  } catch {
    // The choice still applies until the page is closed.
  }
  listeners.forEach((fn) => fn());
}

const SERVER_STATE = Object.freeze({ choice: 'auto', tier: TIER_HIGH, openingScene: true });

export const viewSettings = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get: () => (typeof window === 'undefined' ? SERVER_STATE : read()),
  getServer: () => SERVER_STATE,
  setChoice(choice) {
    write({ ...read(), choice, tier: choice === 'auto' ? detect() : choice });
  },
  setOpeningScene(openingScene) {
    write({ ...read(), openingScene });
  },
  /** Called by the scene when frames are being missed. Never overrides a hand-picked level. */
  stepDown() {
    const current = read();
    if (current.choice !== 'auto' || current.tier === TIER_LOW) return;
    state = { ...current, tier: lowerTier(current.tier) };
    listeners.forEach((fn) => fn());
  },
};
