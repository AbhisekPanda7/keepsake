/**
 * Thin promise wrapper around IndexedDB. Knows about stores and transactions and
 * nothing about albums, beyond applying migrations. Metadata and image blobs live in
 * separate object stores, so listing an album never pulls image data into memory.
 */
import { albumRecordsForUpgrade } from './migrations.js';

const DB_NAME = 'keepsake';
const DB_VERSION = 2;
export const STORES = { albums: 'albums', photos: 'photos', blobs: 'photoBlobs' };

/** Every storage failure reaches the UI as one of these. */
export class StorageError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = 'StorageError';
    this.code = code; // 'quota' | 'unavailable' | 'unknown', and from the server also 'auth'
  }
}

export function toStorageError(error) {
  if (error instanceof StorageError) return error;
  if (error?.name === 'QuotaExceededError') {
    return new StorageError('quota', 'This browser has run out of storage for photographs.', error);
  }
  if (error?.name === 'InvalidStateError' || error?.name === 'SecurityError') {
    return new StorageError('unavailable', 'This browser is not allowing the album to be saved here.', error);
  }
  return new StorageError('unknown', 'The album could not be read or saved.', error);
}

/**
 * Version 1 to 2. Runs inside IndexedDB's upgrade transaction, so if anything here
 * fails the whole upgrade aborts and the database stays exactly as it was at version 1.
 */
function upgradeToV2(transaction) {
  const albums = transaction.objectStore(STORES.albums);
  const photos = transaction.objectStore(STORES.photos);
  const readAlbums = albums.getAll();
  readAlbums.onsuccess = () => {
    const readPhotos = photos.getAll();
    readPhotos.onsuccess = () => {
      for (const record of albumRecordsForUpgrade(readAlbums.result, readPhotos.result, Date.now())) {
        albums.put(record);
      }
    };
  };
}

let dbPromise = null;

export function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new StorageError('unavailable', 'This browser has no local storage for photographs.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        db.createObjectStore(STORES.albums, { keyPath: 'id' });
        const photos = db.createObjectStore(STORES.photos, { keyPath: 'id' });
        photos.createIndex('byAlbum', ['albumId', 'order']);
        db.createObjectStore(STORES.blobs, { keyPath: 'id' });
      }
      if (event.oldVersion < 2) upgradeToV2(request.transaction);
    };
    request.onsuccess = () => {
      const db = request.result;
      // A newer version in another tab must be able to upgrade, so let go of ours.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(toStorageError(request.error));
    request.onblocked = () =>
      reject(new StorageError('unavailable', 'Please close other tabs with this album open and try again.'));
  }).catch((error) => {
    dbPromise = null; // allow a later retry
    throw toStorageError(error);
  });
  return dbPromise;
}

/**
 * Runs `work(tx)` in one transaction and resolves once it has actually committed.
 * Waiting for commit, not just the last request, matters: quota errors often
 * surface only at commit, and a photo must not be reported as saved before then.
 */
export async function transact(storeNames, mode, work) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let result;
    let tx;
    try {
      tx = db.transaction(storeNames, mode);
    } catch (error) {
      reject(toStorageError(error));
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(toStorageError(tx.error));
    tx.onabort = () => reject(toStorageError(tx.error));
    try {
      Promise.resolve(work(tx)).then(
        (value) => {
          result = value;
        },
        (error) => {
          try {
            tx.abort();
          } catch {
            // Already finished; the original error is what matters.
          }
          reject(toStorageError(error));
        },
      );
    } catch (error) {
      reject(toStorageError(error));
    }
  });
}

export function asPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
