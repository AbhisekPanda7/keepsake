'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_CAPTION_LENGTH, describePhotoDate } from '@/lib/album/photoInfo';
import { getPhotoBlob } from '@/lib/storage/albumStore';

/**
 * One photograph, lifted off the page toward you. The real image is shown untouched: it's
 * the room behind that blurs and falls away, with the photograph's own colours spread faintly
 * through the air around it. It's also where a caption is written, in the album's hand. The
 * caption saves when you leave the field or close the view, so there's no Save step to forget.
 */
export default function PhotoViewer({ photo, onClose, onRemove, onCaption }) {
  const ref = useRef(null);
  const [url, setUrl] = useState(null);
  const [caption, setCaption] = useState(photo.caption ?? '');

  const saveCaption = useCallback(() => onCaption(photo.id, caption), [onCaption, photo.id, caption]);
  const closeAndSave = useCallback(() => {
    saveCaption();
    onClose();
  }, [saveCaption, onClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    let revoked = false;
    let objectUrl = null;
    getPhotoBlob(photo.id).then(
      (blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      },
      () => onClose(),
    );
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.id, onClose]);

  const date = describePhotoDate(photo);

  return (
    <dialog
      ref={ref}
      className="viewer"
      aria-label={`Photograph ${photo.name}`}
      onCancel={(event) => {
        event.preventDefault();
        closeAndSave();
      }}
      onClick={(event) => {
        if (event.target === ref.current) closeAndSave();
      }}
    >
      {url && <div className="viewer-aura" aria-hidden="true" style={{ backgroundImage: `url(${url})` }} />}
      <figure className={url ? 'is-lifted' : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
        {url && <img src={url} alt={caption || photo.name} />}
        <figcaption>
          <input
            className="viewer-caption"
            type="text"
            value={caption}
            maxLength={MAX_CAPTION_LENGTH}
            placeholder="Add a caption"
            aria-label="Caption"
            onChange={(event) => setCaption(event.target.value)}
            onBlur={saveCaption}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
          <div className="viewer-foot">
            <span>{date}</span>
            <span className="viewer-actions">
              <button type="button" className="tool quiet" onClick={() => onRemove(photo)}>
                Remove
              </button>
              <button type="button" className="tool strong" autoFocus onClick={closeAndSave}>
                Close
              </button>
            </span>
          </div>
        </figcaption>
      </figure>
    </dialog>
  );
}
