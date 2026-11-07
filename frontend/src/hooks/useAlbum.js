'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { applyOrder } from '@/lib/album/reorder';
import { normalizeCaption } from '@/lib/album/photoInfo';
import { DEFAULT_THEME } from '@/lib/album/themes';
import { readPhotoDate } from '@/lib/images/exifDate';
import { InvalidImageError, resizeImage } from '@/lib/images/resizeImage';
import {
  addPhoto,
  clearAlbum,
  deletePhoto,
  getAlbum,
  reorderPhotos as storeOrder,
  requestPersistence,
  saveAlbum,
  toStorageError,
  updatePhotoCaption,
} from '@/lib/storage/albumStore';

const plural = (n, word = 'photograph') => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * One album's data for the UI. React state holds only metadata; image data stays in
 * storage and is read by the page textures when a page needs it.
 */
export function useAlbum(albumId) {
  const [status, setStatus] = useState('loading'); // loading | ready | missing | unavailable
  const [details, setDetails] = useState({ title: '', description: '', theme: DEFAULT_THEME, createdAt: null });
  const [photos, setPhotos] = useState([]);
  const [upload, setUpload] = useState(null); // { done, total } while running
  const [notice, setNotice] = useState(null); // { tone, text }
  const busy = useRef(false);
  const count = useRef(0); // photo count readable mid-upload, between renders
  const latestPhotos = useRef(photos);

  useEffect(() => {
    count.current = photos.length;
    latestPhotos.current = photos;
  }, [photos]);

  useEffect(() => {
    let cancelled = false;
    getAlbum(albumId).then(
      (album) => {
        if (cancelled) return;
        if (!album) {
          setStatus('missing');
          return;
        }
        const { photos: stored, ...record } = album;
        setDetails(record);
        setPhotos(stored);
        setStatus('ready');
      },
      (error) => {
        if (cancelled) return;
        setStatus('unavailable');
        setNotice({ tone: 'error', text: `${toStorageError(error).message} Photographs can't be kept right now.` });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [albumId]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  /** Adds files in the order given. Calls onFirstAdded(index, total) after the first. */
  const addFiles = useCallback(
    async (fileList, onFirstAdded) => {
      const files = [...fileList];
      if (!files.length || busy.current) return;
      busy.current = true;
      setNotice(null);
      setUpload({ done: 0, total: files.length });
      requestPersistence();

      let added = 0;
      const rejected = [];
      let storageFailure = null;

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        try {
          const prepared = await resizeImage(file);
          // Read from the original: re-encoding during resizing drops the metadata.
          const date = await readPhotoDate(file);
          const photo = await addPhoto(albumId, {
            blob: prepared.blob,
            name: file.name,
            width: prepared.width,
            height: prepared.height,
            ...date,
          });
          added += 1;
          count.current += 1;
          setPhotos((current) => [...current, photo]);
          if (added === 1) onFirstAdded?.(count.current - 1, count.current);
        } catch (error) {
          if (error instanceof InvalidImageError) {
            rejected.push(file.name);
          } else {
            // Full or failing storage won't recover on the next file, so stop here.
            storageFailure = toStorageError(error);
            break;
          }
        }
        setUpload({ done: i + 1, total: files.length });
      }

      setUpload(null);
      busy.current = false;

      if (storageFailure) {
        const kept = added ? `${plural(added)} saved before that. ` : '';
        const advice = storageFailure.code === 'quota' ? 'Remove some photographs to make room.' : 'Please try again.';
        setNotice({ tone: 'error', text: `${storageFailure.message} ${kept}${advice}` });
      } else if (rejected.length) {
        const names = rejected.slice(0, 3).join(', ') + (rejected.length > 3 ? ` and ${rejected.length - 3} more` : '');
        const lead = added ? `${plural(added)} added. ` : '';
        setNotice({ tone: 'error', text: `${lead}Couldn't read ${names}. Only image files such as JPG, PNG, WebP and HEIC can be added.` });
      } else {
        setNotice({ tone: 'ok', text: `${plural(added)} added to your album.` });
      }
    },
    [albumId],
  );

  const removePhoto = useCallback(async (photo) => {
    try {
      await deletePhoto(photo.id);
      setPhotos((current) => current.filter((p) => p.id !== photo.id));
      setNotice({ tone: 'ok', text: 'Photograph removed.' });
      return true;
    } catch (error) {
      setNotice({ tone: 'error', text: toStorageError(error).message });
      return false;
    }
  }, []);

  /**
   * Applies a new order straight away and then saves it. If saving fails, the album
   * goes back to the order that is actually stored, so screen and disk always agree.
   */
  const reorderPhotos = useCallback(
    async (ids) => {
      const previous = latestPhotos.current;
      setPhotos(applyOrder(previous, ids));
      try {
        await storeOrder(albumId, ids);
        return true;
      } catch (error) {
        setPhotos(previous);
        setNotice({ tone: 'error', text: `${toStorageError(error).message} The previous order was kept.` });
        return false;
      }
    },
    [albumId],
  );

  /** Saves a caption. The page's artwork redraws because its key includes the caption. */
  const setCaption = useCallback(async (photoId, text) => {
    const caption = normalizeCaption(text);
    const current = latestPhotos.current.find((p) => p.id === photoId);
    if (!current || (current.caption ?? '') === caption) return true;
    setPhotos((list) => list.map((p) => (p.id === photoId ? { ...p, caption } : p)));
    try {
      await updatePhotoCaption(photoId, caption);
      return true;
    } catch (error) {
      setPhotos((list) => list.map((p) => (p.id === photoId ? { ...p, caption: current.caption } : p)));
      setNotice({ tone: 'error', text: `${toStorageError(error).message} The caption was not saved.` });
      return false;
    }
  }, []);

  /** Saves title, description or theme. The store handles a blank title. */
  const saveDetails = useCallback(
    async (fields) => {
      try {
        const saved = await saveAlbum(albumId, fields);
        setDetails(saved);
        return true;
      } catch (error) {
        setNotice({ tone: 'error', text: `${toStorageError(error).message} The album was not changed.` });
        return false;
      }
    },
    [albumId],
  );

  const clearAll = useCallback(async () => {
    try {
      await clearAlbum(albumId);
      setPhotos([]);
      setNotice({ tone: 'ok', text: 'This album is empty again.' });
      return true;
    } catch (error) {
      setNotice({ tone: 'error', text: toStorageError(error).message });
      return false;
    }
  }, [albumId]);

  return {
    status,
    details,
    photos,
    upload,
    notice,
    dismissNotice,
    addFiles,
    removePhoto,
    reorderPhotos,
    setCaption,
    saveDetails,
    clearAll,
  };
}
