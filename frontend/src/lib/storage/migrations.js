/**
 * Upgrading stored data between database versions. The decisions are pure functions
 * here, so they can be tested in Node without a browser. indexedDB.js only applies them.
 *
 * Version 1 had a single album. Its photographs already carried albumId 'default', but
 * an album record existed only if the title had been changed. Version 2 requires a full
 * record for every album. The upgrade only ever adds records and fields: no photograph
 * or image is rewritten or removed, and if it fails IndexedDB rolls it all back to v1.
 */
import { DEFAULT_THEME, normalizeTheme } from '../album/themes.js';

export const DEFAULT_TITLE = 'Our Memories';
export const LEGACY_ALBUM_ID = 'default';

/** A complete album record from whatever partial record exists. */
export function completeAlbumRecord(id, existing, photos, now) {
  const added = photos.map((p) => p.addedAt).filter((t) => Number.isFinite(t));
  return {
    id,
    title: typeof existing?.title === 'string' && existing.title.trim() ? existing.title : DEFAULT_TITLE,
    description: typeof existing?.description === 'string' ? existing.description : '',
    theme: normalizeTheme(existing?.theme ?? DEFAULT_THEME),
    createdAt: Number.isFinite(existing?.createdAt) ? existing.createdAt : added.length ? Math.min(...added) : now,
    updatedAt: Number.isFinite(existing?.updatedAt) ? existing.updatedAt : added.length ? Math.max(...added) : now,
  };
}

/**
 * Which album records must exist after upgrading: one for each stored record and one
 * for every albumId any photograph refers to, so that no photograph is left orphaned.
 * A version 1 database that was never used gets no records, and so an empty library.
 */
export function albumRecordsForUpgrade(records, photos, now) {
  const photosByAlbum = new Map();
  for (const photo of photos) {
    const id = photo.albumId ?? LEGACY_ALBUM_ID;
    if (!photosByAlbum.has(id)) photosByAlbum.set(id, []);
    photosByAlbum.get(id).push(photo);
  }
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const ids = new Set([...recordsById.keys(), ...photosByAlbum.keys()]);
  return [...ids].map((id) => completeAlbumRecord(id, recordsById.get(id), photosByAlbum.get(id) ?? [], now));
}
