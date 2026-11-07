/**
 * The same storage API as localStore.js, kept by the Keepsake server instead of this
 * browser. Each function is one request; the server checks and cleans everything itself,
 * and a failure reaches the UI as the same StorageError the browser store uses.
 */
import { StorageError } from './indexedDB.js';
import { API_URL, clearSession, getSession } from './session.js';

const UNREACHABLE = "Keepsake can't be reached right now. Check your connection and try again.";

async function request(path, { method = 'GET', json, form, anonymous = false } = {}) {
  const headers = {};
  if (!anonymous) {
    const session = getSession();
    if (!session) throw new StorageError('auth', 'Please sign in again.');
    headers.Authorization = `Bearer ${session.token}`;
  }
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { method, headers, body });
  } catch (error) {
    throw new StorageError('unavailable', UNREACHABLE, error);
  }
  if (response.ok) return response;

  let detail = null;
  try {
    detail = await response.json();
  } catch {
    // No readable explanation; the status says enough.
  }
  if (response.status === 401 && !anonymous) {
    clearSession();
    throw new StorageError('auth', 'Please sign in again.');
  }
  const error = new StorageError(
    response.status === 507 ? 'quota' : response.status >= 500 ? 'unavailable' : 'unknown',
    response.status === 507
      ? 'Your account has run out of space for photographs.'
      : (detail?.message ?? (response.status >= 500 ? UNREACHABLE : 'That could not be saved.')),
  );
  error.status = response.status;
  error.reason = detail?.code;
  throw error;
}

const readJson = async (path, options) => (await request(path, options)).json();

// ---- signing in -------------------------------------------------------------

/** Returns the new session. Errors carry the server's own explanation, such as a taken email. */
export const register = ({ email, password, displayName }) =>
  readJson('/api/auth/register', { method: 'POST', json: { email, password, displayName }, anonymous: true });

export const login = ({ email, password }) =>
  readJson('/api/auth/login', { method: 'POST', json: { email, password }, anonymous: true });

// ---- albums -----------------------------------------------------------------

export const listAlbums = () => readJson('/api/albums');

/** Null when there is no such album, which includes someone else's. */
export async function getAlbum(albumId) {
  try {
    return await readJson(`/api/albums/${encodeURIComponent(albumId)}`);
  } catch (error) {
    if (error.status === 404 || error.status === 400) return null;
    throw error;
  }
}

export const createAlbum = ({ title, description, theme } = {}) =>
  readJson('/api/albums', { method: 'POST', json: { title, description, theme } });

/** Only the fields given are changed. Returns the album's details, without its photographs. */
export async function saveAlbum(albumId, fields) {
  const changes = {};
  for (const key of ['title', 'description', 'theme']) if (key in fields) changes[key] = fields[key] ?? '';
  const { photos, ...album } = await readJson(`/api/albums/${encodeURIComponent(albumId)}`, { method: 'PATCH', json: changes });
  return album;
}

export const duplicateAlbum = (albumId) =>
  readJson(`/api/albums/${encodeURIComponent(albumId)}/copies`, { method: 'POST' });

export async function deleteAlbum(albumId) {
  await request(`/api/albums/${encodeURIComponent(albumId)}`, { method: 'DELETE' });
}

export async function clearAlbum(albumId) {
  await request(`/api/albums/${encodeURIComponent(albumId)}/photos`, { method: 'DELETE' });
}

// ---- photographs --------------------------------------------------------------

export function addPhoto(albumId, { blob, name, width, height, takenAt, takenAtSource }) {
  const form = new FormData();
  form.append('file', blob, name || 'photo.jpg');
  form.append('name', name || 'photo.jpg');
  form.append('width', String(width));
  form.append('height', String(height));
  if (Number.isFinite(takenAt) && takenAt > 0) form.append('takenAt', String(Math.round(takenAt)));
  if (takenAtSource) form.append('takenAtSource', takenAtSource);
  return readJson(`/api/albums/${encodeURIComponent(albumId)}/photos`, { method: 'POST', form });
}

/**
 * Pages, the viewer and the arranger often ask for the same photograph at once, so a
 * download already on its way is shared. Repeat visits come from the browser's own cache.
 */
const downloading = new Map();

export function getPhotoBlob(id) {
  if (downloading.has(id)) return downloading.get(id);
  const download = request(`/api/photos/${encodeURIComponent(id)}/content`)
    .then((response) => response.blob())
    .finally(() => downloading.delete(id));
  downloading.set(id, download);
  return download;
}

export const updatePhotoCaption = (id, caption) =>
  readJson(`/api/photos/${encodeURIComponent(id)}`, { method: 'PATCH', json: { caption } });

export async function deletePhoto(id) {
  await request(`/api/photos/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export const reorderPhotos = (albumId, ids) =>
  readJson(`/api/albums/${encodeURIComponent(albumId)}/photo-order`, { method: 'PUT', json: { ids } });

/** The server keeps the albums, so there is nothing to ask the browser for. */
export async function requestPersistence() {}
