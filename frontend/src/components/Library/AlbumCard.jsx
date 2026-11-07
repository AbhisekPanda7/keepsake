'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { playSound, setWhoosh } from '@/lib/ambient/sound';
import { formatUpdated, photoCountText } from '@/lib/album/photoInfo';
import { resolveTheme } from '@/lib/album/themes';
import BookCover from './BookCover';

/** One album lying on the table: the book itself, its label and a small menu. */
const AlbumCard = memo(function AlbumCard({ album, index, leaving, onOpen, onEdit, onDuplicate, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const theme = useMemo(() => resolveTheme(album.theme), [album.theme]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const choose = (action) => {
    setMenuOpen(false);
    action(album);
  };

  // Turning this small book by dragging it, in CSS. A press that doesn't move opens it.
  const turn = useRef({ id: null, x: 0, y: 0, rx: 0, ry: 0, moved: false });
  const openRef = useRef(null);
  const [turned, setTurned] = useState(false);

  const stopTurnListeners = useRef(null);
  const quieten = useRef(0);
  useEffect(
    () => () => {
      stopTurnListeners.current?.();
      clearTimeout(quieten.current);
    },
    [],
  );

  /**
   * A drag is followed on the whole window, not on this book: it will usually wander off
   * the card, and the book must still turn, and always be let go of, wherever it ends.
   */
  const onBookPointerDown = (event) => {
    if (event.button !== 0) return;
    const element = event.currentTarget;
    const t = turn.current;
    stopTurnListeners.current?.();
    t.id = event.pointerId;
    t.x = event.clientX;
    t.y = event.clientY;
    t.moved = false;

    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== t.id) return;
      const dx = moveEvent.clientX - t.x;
      const dy = moveEvent.clientY - t.y;
      if (!t.moved) {
        if (Math.hypot(dx, dy) < 6) return;
        t.moved = true;
        element.classList.remove('is-settling');
        element.classList.add('is-turning');
      }
      t.ry += dx * 0.6;
      t.rx -= dy * 0.6;
      t.x = moveEvent.clientX;
      t.y = moveEvent.clientY;
      element.style.setProperty('--turn-x', `${t.rx.toFixed(1)}deg`);
      element.style.setProperty('--turn-y', `${t.ry.toFixed(1)}deg`);
      setWhoosh(Math.min(0.6, Math.hypot(dx, dy) / 40));
      clearTimeout(quieten.current);
      quieten.current = setTimeout(() => setWhoosh(0), 90);
    };
    const onEnd = (endEvent) => {
      if (endEvent.pointerId !== t.id) return;
      stopTurnListeners.current?.();
      t.id = null;
      setWhoosh(0);
      // It stays where it was left, until it's set down or opened.
      element.classList.remove('is-turning');
      if (t.moved) setTurned(true);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    stopTurnListeners.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      stopTurnListeners.current = null;
    };
  };

  const setDown = () => {
    const t = turn.current;
    const element = openRef.current;
    setTurned(false);
    if (!element) return;
    // Comes back by the shorter way round, rather than unwinding each full turn.
    const nearest = (angle) => ((((angle + 180) % 360) + 360) % 360) - 180;
    element.classList.add('is-turning');
    element.style.setProperty('--turn-x', `${nearest(t.rx)}deg`);
    element.style.setProperty('--turn-y', `${nearest(t.ry)}deg`);
    t.rx = 0;
    t.ry = 0;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        element.classList.remove('is-turning');
        element.classList.add('is-settling');
        element.style.setProperty('--turn-x', '0deg');
        element.style.setProperty('--turn-y', '0deg');
        setTimeout(() => {
          element.classList.remove('is-settling');
          playSound('book-down');
        }, 640);
      });
    });
  };

  /** The book under the mouse leans toward it, and light slides across its cover. */
  const onBookPointerMove = (event) => {
    if (turn.current.id !== null || event.pointerType !== 'mouse') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const style = event.currentTarget.style;
    style.setProperty('--cx', (x * 2 - 1).toFixed(3));
    style.setProperty('--cy', (y * 2 - 1).toFixed(3));
    style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
    style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
  };

  const onBookPointerLeave = (event) => {
    event.currentTarget.style.setProperty('--cx', '0');
    event.currentTarget.style.setProperty('--cy', '0');
  };

  return (
    <li className={`album-card${leaving ? ' is-leaving' : ''}`} data-album-id={album.id} style={{ '--i': Math.min(index, 11) }}>
      <button
        ref={openRef}
        type="button"
        className="album-open"
        onClick={(event) => {
          // The press that ended a turn of the book isn't a request to open it.
          if (turn.current.moved) return;
          onOpen(album, event.currentTarget);
        }}
        onPointerDown={onBookPointerDown}
        onPointerMove={onBookPointerMove}
        onPointerLeave={onBookPointerLeave}
        aria-label={`Open ${album.title}`}
      >
        <BookCover title={album.title} theme={theme} photoCount={album.photoCount} />
      </button>
      {turned && (
        <button type="button" className="set-down set-down-card" onClick={setDown}>
          Set it down
        </button>
      )}
      <div className="album-label">
        <div className="album-label-text">
          <h2>{album.title}</h2>
          <p>
            {photoCountText(album.photoCount)}
            <span aria-hidden="true"> · </span>
            <span className="album-updated">updated {formatUpdated(album.updatedAt)}</span>
          </p>
        </div>
        <div className="album-menu" ref={menuRef}>
          <button
            type="button"
            className="album-menu-button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`More actions for ${album.title}`}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">⋯</span>
          </button>
          {menuOpen && (
            <div className="album-menu-list" role="menu">
              <button type="button" role="menuitem" onClick={() => choose(onOpen)}>
                Open
              </button>
              <button type="button" role="menuitem" onClick={() => choose(onEdit)}>
                Rename &amp; customise
              </button>
              <button type="button" role="menuitem" onClick={() => choose(onDuplicate)}>
                Duplicate
              </button>
              <button type="button" role="menuitem" className="is-danger" onClick={() => choose(onDelete)}>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
});

export default AlbumCard;
