/**
 * Albums kept in this browser, in IndexedDB. Used when no server is configured; see
 * albumStore.js, which chooses. remoteStore.js implements the same functions as requests:
 *   listAlbums()                GET    /api/albums
 *   getAlbum(id)                GET    /api/albums/{id}             (metadata only)
 *   createAlbum(fields)         POST   /api/albums
 *   saveAlbum(id, fields)       PATCH  /api/albums/{id}
 *   duplicateAlbum(id)          POST   /api/albums/{id}/copies
 *   deleteAlbum(id)             DELETE /api/albums/{id}
 *   getPhotoBlob(id)            GET    /api/photos/{id}/content     (or a blob SAS URL)
 *   addPhoto(albumId, photo)    POST   /api/albums/{id}/photos      (multipart)
 *   updatePhotoCaption(id, c)   PATCH  /api/photos/{id}
 *   deletePhoto(id)             DELETE /api/photos/{id}
 *   clearAlbum(id)              DELETE /api/albums/{id}/photos
 *   reorderPhotos(id, ids)      PUT    /api/albums/{id}/photo-order
 * Failures surface as StorageError, so the UI's messages are the same either way.
 *
 * Every operation that changes photographs is scoped to one album, by looking up that
 * album's photos through the byAlbum index. Nothing here may ever clear a whole store.
 */
import { normalizeCategory } from '../album/categories.js';
import { normalizeCaption } from '../album/photoInfo.js';
import { applyOrder } from '../album/reorder.js';
import { normalizeTheme } from '../album/themes.js';
import { STORES, StorageError, asPromise, toStorageError, transact } from './indexedDB.js';
import { DEFAULT_TITLE } from './migrations.js';

export { DEFAULT_TITLE };
export const MAX_TITLE_LENGTH = 48;
export const MAX_DESCRIPTION_LENGTH = 160;

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const albumRange = (albumId) => IDBKeyRange.bound([albumId, -Infinity], [albumId, Infinity]);
const cleanTitle = (title) => String(title ?? '').trim().slice(0, MAX_TITLE_LENGTH) || DEFAULT_TITLE;
const cleanDescription = (text) => String(text ?? '').trim().slice(0, MAX_DESCRIPTION_LENGTH);
/** Albums saved before categories existed have none, and are Individual. Nothing is rewritten. */
const withCategory = (record) => ({ ...record, category: normalizeCategory(record.category) });

/** Marks an album as changed, inside the same transaction as the change itself. */
async function touchAlbum(tx, albumId) {
  const albums = tx.objectStore(STORES.albums);
  const record = await asPromise(albums.get(albumId));
  if (record) albums.put({ ...record, updatedAt: Date.now() });
}

// ---- albums -----------------------------------------------------------------

/** All albums, most recently changed first, each with its photo count. No image data. */
export async function listAlbums() {
  return transact([STORES.albums, STORES.photos], 'readonly', async (tx) => {
    const records = await asPromise(tx.objectStore(STORES.albums).getAll());
    const index = tx.objectStore(STORES.photos).index('byAlbum');
    const counts = await Promise.all(records.map((record) => asPromise(index.count(albumRange(record.id)))));
    return records
      .map((record, i) => ({ ...withCategory(record), photoCount: counts[i] }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  });
}

/** One album with its ordered photo metadata, or null if there is no such album. */
export async function getAlbum(albumId) {
  return transact([STORES.albums, STORES.photos], 'readonly', async (tx) => {
    const record = await asPromise(tx.objectStore(STORES.albums).get(albumId));
    if (!record) return null;
    const photos = await asPromise(tx.objectStore(STORES.photos).index('byAlbum').getAll(albumRange(albumId)));
    return { ...withCategory(record), photos };
  });
}

export async function createAlbum({ title, description, theme, category } = {}) {
  const now = Date.now();
  const record = {
    id: newId(),
    title: cleanTitle(title),
    description: cleanDescription(description),
    theme: normalizeTheme(theme),
    category: normalizeCategory(category),
    createdAt: now,
    updatedAt: now,
  };
  await transact([STORES.albums], 'readwrite', (tx) => {
    tx.objectStore(STORES.albums).add(record);
  });
  return record;
}

/** Changes an album's own details. Its photographs aren't touched. Returns the result. */
export async function saveAlbum(albumId, fields) {
  return transact([STORES.albums], 'readwrite', async (tx) => {
    const albums = tx.objectStore(STORES.albums);
    const record = await asPromise(albums.get(albumId));
    if (!record) throw new StorageError('unknown', 'This album is no longer stored.');
    const next = { ...record, updatedAt: Date.now() };
    if ('title' in fields) next.title = cleanTitle(fields.title);
    if ('description' in fields) next.description = cleanDescription(fields.description);
    if ('theme' in fields) next.theme = normalizeTheme(fields.theme);
    if ('category' in fields) next.category = normalizeCategory(fields.category);
    // Moving an album to the other collection is only shelving; it isn't an edit.
    if (Object.keys(fields).every((key) => key === 'category')) next.updatedAt = record.updatedAt;
    albums.put(next);
    return withCategory(next);
  });
}

/**
 * Copies an album and all its photographs, as one transaction, so that a failure part
 * way (a full disk, most likely) leaves no half-made copy behind. Captions are kept.
 */
export async function duplicateAlbum(albumId) {
  return transact([STORES.albums, STORES.photos, STORES.blobs], 'readwrite', async (tx) => {
    const albums = tx.objectStore(STORES.albums);
    const photoStore = tx.objectStore(STORES.photos);
    const blobStore = tx.objectStore(STORES.blobs);
    const source = await asPromise(albums.get(albumId));
    if (!source) throw new StorageError('unknown', 'This album is no longer stored.');

    const now = Date.now();
    const suffix = ' (copy)';
    const copy = {
      ...withCategory(source),
      id: newId(),
      title: source.title.slice(0, MAX_TITLE_LENGTH - suffix.length) + suffix,
      createdAt: now,
      updatedAt: now,
    };
    albums.add(copy);

    const photos = await asPromise(photoStore.index('byAlbum').getAll(albumRange(albumId)));
    const blobs = await Promise.all(photos.map((photo) => asPromise(blobStore.get(photo.id))));
    photos.forEach((photo, i) => {
      const id = newId();
      photoStore.add({ ...photo, id, albumId: copy.id });
      if (blobs[i]) blobStore.add({ id, blob: blobs[i].blob });
    });
    return { ...copy, photoCount: photos.length };
  });
}

/** Removes every photograph and image belonging to an album, and nothing else. */
async function removeAlbumPhotos(tx, albumId) {
  const photoStore = tx.objectStore(STORES.photos);
  const blobStore = tx.objectStore(STORES.blobs);
  const ids = await asPromise(photoStore.index('byAlbum').getAllKeys(albumRange(albumId)));
  for (const id of ids) {
    photoStore.delete(id);
    blobStore.delete(id);
  }
}

export async function deleteAlbum(albumId) {
  await transact([STORES.albums, STORES.photos, STORES.blobs], 'readwrite', async (tx) => {
    await removeAlbumPhotos(tx, albumId);
    tx.objectStore(STORES.albums).delete(albumId);
  });
}

/** Empties an album. The album itself and all other albums stay as they are. */
export async function clearAlbum(albumId) {
  await transact([STORES.albums, STORES.photos, STORES.blobs], 'readwrite', async (tx) => {
    await removeAlbumPhotos(tx, albumId);
    await touchAlbum(tx, albumId);
  });
}

// ---- photographs --------------------------------------------------------------

/**
 * Stores one prepared photograph at the end of its album and returns its metadata.
 * Once it resolves the photo has committed to disk.
 */
export async function addPhoto(albumId, { blob, name, width, height, takenAt, takenAtSource }) {
  const id = newId();
  let photo;
  await transact([STORES.albums, STORES.photos, STORES.blobs], 'readwrite', async (tx) => {
    const store = tx.objectStore(STORES.photos);
    const last = await asPromise(store.index('byAlbum').openCursor(albumRange(albumId), 'prev'));
    const order = last ? last.value.order + 1 : 0;
    photo = { id, albumId, order, name, width, height, takenAt, takenAtSource, caption: '', addedAt: Date.now() };
    store.put(photo);
    tx.objectStore(STORES.blobs).put({ id, blob });
    await touchAlbum(tx, albumId);
  });
  return photo;
}

/** Image data for one photograph, loaded only when a page needs to show it. */
export async function getPhotoBlob(id) {
  const record = await transact([STORES.blobs], 'readonly', (tx) =>
    asPromise(tx.objectStore(STORES.blobs).get(id)),
  );
  if (!record) throw new StorageError('unknown', 'This photograph is no longer stored.');
  return record.blob;
}

/** Sets a photograph's caption, leaving everything else about it as it was. */
export async function updatePhotoCaption(id, caption) {
  return transact([STORES.albums, STORES.photos], 'readwrite', async (tx) => {
    const store = tx.objectStore(STORES.photos);
    const photo = await asPromise(store.get(id));
    if (!photo) throw new StorageError('unknown', 'This photograph is no longer stored.');
    const next = { ...photo, caption: normalizeCaption(caption) };
    store.put(next);
    await touchAlbum(tx, photo.albumId);
    return next;
  });
}

export async function deletePhoto(id) {
  await transact([STORES.albums, STORES.photos, STORES.blobs], 'readwrite', async (tx) => {
    const store = tx.objectStore(STORES.photos);
    const photo = await asPromise(store.get(id));
    store.delete(id);
    tx.objectStore(STORES.blobs).delete(id);
    if (photo) await touchAlbum(tx, photo.albumId);
  });
}

/**
 * Saves a new photo order for one album. All of it happens in one transaction, so a
 * failure or a closed tab can't leave the album half-reordered.
 */
export async function reorderPhotos(albumId, ids) {
  return transact([STORES.albums, STORES.photos], 'readwrite', async (tx) => {
    const store = tx.objectStore(STORES.photos);
    const stored = await asPromise(store.index('byAlbum').getAll(albumRange(albumId)));
    const ordered = applyOrder(stored, ids);
    ordered.forEach((photo, index) => {
      if (photo !== stored[index]) store.put(photo);
    });
    await touchAlbum(tx, albumId);
    return ordered;
  });
}

/** Asks the browser not to evict albums under storage pressure. Best effort. */
export async function requestPersistence() {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Purely advisory; the album still works without it.
  }
}

export { toStorageError };
