'use client';

import { useEffect, useState } from 'react';
import { getPhotoBlob } from '@/lib/storage/albumStore';

function FlatPhoto({ photo, onRemove }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let done = false;
    let objectUrl = null;
    getPhotoBlob(photo.id).then((blob) => {
      if (done) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }, () => {});
    return () => {
      done = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.id]);
  return (
    <li>
      {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
      {url && <img src={url} alt={photo.name} width={photo.width} height={photo.height} />}
      <button type="button" className="text-action" onClick={() => onRemove(photo)}>
        Remove
      </button>
    </li>
  );
}

/**
 * Shown when this device can't draw 3D graphics. It loses the book, not the
 * photographs: they can still be viewed, added and removed.
 */
export default function FlatAlbum({ photos, onRemove }) {
  return (
    <div className="flat-album">
      <p>This device can&rsquo;t display the 3D album, so your photographs are laid out here instead.</p>
      {photos.length === 0 && <p>Nothing here yet. Add your first photographs below.</p>}
      <ul>
        {photos.map((photo) => (
          <FlatPhoto key={photo.id} photo={photo} onRemove={onRemove} />
        ))}
      </ul>
    </div>
  );
}
