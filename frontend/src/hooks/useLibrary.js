'use client';

import { useCallback, useEffect, useState } from 'react';
import { CATEGORIES } from '@/lib/album/categories';
import {
  createAlbum as storeCreate,
  deleteAlbum as storeDelete,
  duplicateAlbum as storeDuplicate,
  listAlbums,
  saveAlbum,
  toStorageError,
} from '@/lib/storage/albumStore';

/** The collection of albums for the library screen. Holds no photograph data. */
export function useLibrary() {
  const [status, setStatus] = useState('loading'); // loading | ready | unavailable
  const [albums, setAlbums] = useState([]);
  const [notice, setNotice] = useState(null);

  const refresh = useCallback(async () => {
    setAlbums(await listAlbums());
    setStatus('ready');
  }, []);

  useEffect(() => {
    let cancelled = false;
    listAlbums().then(
      (list) => {
        if (cancelled) return;
        setAlbums(list);
        setStatus('ready');
      },
      (error) => {
        if (cancelled) return;
        setStatus('unavailable');
        setNotice({ tone: 'error', text: `${toStorageError(error).message} Albums can't be kept right now.` });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const guarded = useCallback(
    async (work, successText) => {
      try {
        const result = await work();
        await refresh();
        if (successText) setNotice({ tone: 'ok', text: successText });
        return result ?? true;
      } catch (error) {
        setNotice({ tone: 'error', text: toStorageError(error).message });
        return null;
      }
    },
    [refresh],
  );

  const createAlbum = useCallback((fields) => guarded(() => storeCreate(fields)), [guarded]);
  const saveDetails = useCallback((id, fields) => guarded(() => saveAlbum(id, fields)), [guarded]);
  const duplicateAlbum = useCallback(
    (id) => guarded(() => storeDuplicate(id), 'Album duplicated, with all its photographs and captions.'),
    [guarded],
  );
  const deleteAlbum = useCallback((id) => guarded(() => storeDelete(id), 'Album deleted.'), [guarded]);
  /** Only the collection changes: the album keeps its id, photographs, captions, order and cover. */
  const moveAlbum = useCallback(
    (album, category) =>
      guarded(() => saveAlbum(album.id, { category }), `“${album.title}” moved to ${CATEGORIES[category].name}.`),
    [guarded],
  );

  return { status, albums, notice, dismissNotice, createAlbum, saveDetails, duplicateAlbum, moveAlbum, deleteAlbum };
}
