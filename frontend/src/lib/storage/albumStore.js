/**
 * The album's persistence API, and the only module the UI talks to for storage.
 *
 * With NEXT_PUBLIC_API_URL set, albums are kept in the signed-in person's account on the
 * Keepsake server (remoteStore.js). Without it, they are kept in this browser
 * (localStore.js). Both have the same functions and fail with the same StorageError.
 */
import * as local from './localStore.js';
import * as remote from './remoteStore.js';
import { usesAccount } from './session.js';

const store = usesAccount ? remote : local;

export { DEFAULT_TITLE, MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH, toStorageError } from './localStore.js';

export const listAlbums = (...args) => store.listAlbums(...args);
export const getAlbum = (...args) => store.getAlbum(...args);
export const createAlbum = (...args) => store.createAlbum(...args);
export const saveAlbum = (...args) => store.saveAlbum(...args);
export const duplicateAlbum = (...args) => store.duplicateAlbum(...args);
export const deleteAlbum = (...args) => store.deleteAlbum(...args);
export const clearAlbum = (...args) => store.clearAlbum(...args);
export const addPhoto = (...args) => store.addPhoto(...args);
export const getPhotoBlob = (...args) => store.getPhotoBlob(...args);
export const updatePhotoCaption = (...args) => store.updatePhotoCaption(...args);
export const deletePhoto = (...args) => store.deletePhoto(...args);
export const reorderPhotos = (...args) => store.reorderPhotos(...args);
export const requestPersistence = (...args) => store.requestPersistence(...args);
