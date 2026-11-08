/**
 * The library's two collections. Every album is in exactly one, and both hold the same
 * kind of album: a category only decides where it's shelved. The values match the server's.
 */

export const INDIVIDUAL = 'INDIVIDUAL';
export const COUPLE = 'COUPLE';
export const DEFAULT_CATEGORY = INDIVIDUAL;

export const CATEGORIES = {
  [INDIVIDUAL]: {
    id: INDIVIDUAL,
    name: 'Individual',
    description: 'Your personal memories, moments and stories.',
    empty: 'No individual albums yet.',
  },
  [COUPLE]: {
    id: COUPLE,
    name: 'Couple',
    description: 'Shared memories and special moments together.',
    empty: 'No couple albums yet.',
  },
};

export const CATEGORY_ORDER = [INDIVIDUAL, COUPLE];

/** Anything missing or unknown, such as an album saved before categories, is Individual. */
export function normalizeCategory(value) {
  const upper = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return Object.hasOwn(CATEGORIES, upper) ? upper : DEFAULT_CATEGORY;
}

export const otherCategory = (value) => (normalizeCategory(value) === INDIVIDUAL ? COUPLE : INDIVIDUAL);

export const inCategory = (albums, category) => albums.filter((album) => normalizeCategory(album.category) === category);

/** How many albums are in each collection. */
export function countByCategory(albums) {
  const counts = { [INDIVIDUAL]: 0, [COUPLE]: 0 };
  for (const album of albums) counts[normalizeCategory(album.category)] += 1;
  return counts;
}
