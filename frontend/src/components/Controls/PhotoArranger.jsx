'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { capturedDate } from '@/lib/album/photoInfo';
import { moveItem, nearestSlot } from '@/lib/album/reorder';
import { sideOfPhoto } from '@/lib/album/pageModel';
import { getPhotoBlob } from '@/lib/storage/albumStore';

const THUMB_SIZE = 220;
const MOUSE_START_PX = 4;
/** On touch, a press must be held first, so that an ordinary swipe still scrolls. */
const TOUCH_HOLD_MS = 240;
const TOUCH_SLOP_PX = 10;
const AUTOSCROLL_EDGE_PX = 64;
const AUTOSCROLL_SPEED = 9;

/**
 * Small preview, decoded only when scrolled near the view. Each is a small canvas
 * rather than an <img> of the stored photo, so a long album doesn't hold every
 * full-size photograph decoded in memory at once.
 */
const Thumbnail = memo(function Thumbnail({ photo, scroller }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let cancelled = false;

    const draw = async () => {
      try {
        const blob = await getPhotoBlob(photo.id);
        const scale = Math.min(1, THUMB_SIZE / Math.max(photo.width, photo.height));
        const width = Math.max(1, Math.round(photo.width * scale));
        const height = Math.max(1, Math.round(photo.height * scale));
        const bitmap = await createImageBitmap(blob, {
          resizeWidth: width,
          resizeHeight: height,
          resizeQuality: 'medium',
        });
        if (cancelled) {
          bitmap.close();
          return;
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        bitmap.close();
      } catch {
        // The tile stays blank; the photo can still be moved or removed.
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          draw();
        }
      },
      { root: scroller, rootMargin: '300px' },
    );
    observer.observe(canvas);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [photo.id, photo.width, photo.height, scroller]);

  return <canvas ref={canvasRef} className="arrange-thumb" role="img" aria-label={photo.name} width={1} height={1} />;
});

/**
 * A contact sheet for rearranging the album. Dragging uses pointer events rather than
 * HTML drag-and-drop, which doesn't work on touch screens. The move buttons on each
 * tile give the same result with a keyboard or a screen reader.
 */
export default function PhotoArranger({ photos, onReorder, onClose }) {
  const dialogRef = useRef(null);
  const [scroller, setScroller] = useState(null);
  const [order, setOrder] = useState(() => photos.map((photo) => photo.id));
  const [draggingId, setDraggingId] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const orderRef = useRef(order);
  const tiles = useRef(new Map());
  const previousRects = useRef(new Map());
  const drag = useRef(null);

  const photoById = new Map(photos.map((photo) => [photo.id, photo]));

  // A photo removed elsewhere must leave this list too.
  useEffect(() => {
    const known = new Set(photos.map((photo) => photo.id));
    setOrder((current) => {
      const kept = current.filter((id) => known.has(id));
      return kept.length === current.length ? current : kept;
    });
  }, [photos]);

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  /**
   * Tiles glide to their new places. Each is first drawn where it just was, using a
   * transform, and then released to its real position so the CSS transition animates.
   */
  useLayoutEffect(() => {
    const next = new Map();
    tiles.current.forEach((element, id) => {
      next.set(id, element.getBoundingClientRect());
    });
    tiles.current.forEach((element, id) => {
      const before = previousRects.current.get(id);
      const after = next.get(id);
      if (!before || id === drag.current?.id) return;
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (!dx && !dy) return;
      element.style.transition = 'none';
      element.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        element.style.transition = '';
        element.style.transform = '';
      });
    });
    previousRects.current = next;
  }, [order]);

  /** Moves the held tile to follow the pointer, wherever its slot currently is. */
  const positionHeldTile = useCallback(() => {
    const state = drag.current;
    if (!state?.active) return;
    const element = tiles.current.get(state.id);
    if (!element) return;
    const index = orderRef.current.indexOf(state.id);
    const slot = state.slots[index];
    const scrollTop = state.scroller.scrollTop;
    const x = state.pointerX - state.grabX - (slot.left + state.originX);
    const y = state.pointerY - state.grabY - (slot.top + state.originY - scrollTop);
    element.style.transform = `translate(${x}px, ${y}px)`;
  }, []);

  /** Takes the slot nearest the pointer. Slots are stored in scroll-independent coordinates. */
  const updateTarget = useCallback(() => {
    const state = drag.current;
    if (!state?.active) return;
    const contentX = state.pointerX - state.originX;
    const contentY = state.pointerY - state.originY + state.scroller.scrollTop;
    const centres = state.slots.map((slot) => ({ x: slot.left + slot.width / 2, y: slot.top + slot.height / 2 }));
    const target = nearestSlot(centres, contentX, contentY);
    const from = orderRef.current.indexOf(state.id);
    if (target >= 0 && target !== from) {
      const next = moveItem(orderRef.current, from, target);
      orderRef.current = next;
      setOrder(next);
    }
    positionHeldTile();
  }, [positionHeldTile]);

  const stopAutoscroll = () => {
    if (drag.current?.frame) cancelAnimationFrame(drag.current.frame);
  };

  /** While a tile is held near the top or bottom of the sheet, the sheet scrolls. */
  const autoscroll = useCallback(() => {
    const state = drag.current;
    if (!state?.active) return;
    const rect = state.scroller.getBoundingClientRect();
    let delta = 0;
    if (state.pointerY < rect.top + AUTOSCROLL_EDGE_PX) delta = -AUTOSCROLL_SPEED;
    else if (state.pointerY > rect.bottom - AUTOSCROLL_EDGE_PX) delta = AUTOSCROLL_SPEED;
    if (delta) {
      state.scroller.scrollTop += delta;
      updateTarget();
    }
    state.frame = requestAnimationFrame(autoscroll);
  }, [updateTarget]);

  const activate = useCallback(() => {
    const state = drag.current;
    if (!state || state.active) return;
    const element = tiles.current.get(state.id);
    if (!element) return;
    clearTimeout(state.timer);

    // Slot positions are measured once. The grid doesn't change shape during a drag,
    // only which photo occupies which slot.
    const scrollerRect = state.scroller.getBoundingClientRect();
    state.originX = scrollerRect.left;
    state.originY = scrollerRect.top;
    state.slots = orderRef.current.map((id) => {
      const rect = tiles.current.get(id).getBoundingClientRect();
      return {
        left: rect.left - scrollerRect.left,
        top: rect.top - scrollerRect.top + state.scroller.scrollTop,
        width: rect.width,
        height: rect.height,
      };
    });
    const own = element.getBoundingClientRect();
    state.grabX = state.pointerX - own.left;
    state.grabY = state.pointerY - own.top;
    state.active = true;
    setDraggingId(state.id);
    positionHeldTile();
    state.frame = requestAnimationFrame(autoscroll);
  }, [autoscroll, positionHeldTile]);

  const finish = useCallback(
    (commit) => {
      const state = drag.current;
      if (!state) return;
      clearTimeout(state.timer);
      stopAutoscroll();
      window.removeEventListener('pointermove', state.onMove);
      window.removeEventListener('pointerup', state.onUp);
      window.removeEventListener('pointercancel', state.onCancel);
      drag.current = null;
      if (!state.active) return;

      const element = tiles.current.get(state.id);
      if (element) element.style.transform = '';
      setDraggingId(null);

      if (!commit) {
        orderRef.current = state.startOrder;
        setOrder(state.startOrder);
        return;
      }
      const changed = orderRef.current.some((id, index) => id !== state.startOrder[index]);
      if (changed) {
        onReorder(orderRef.current);
        const page = sideOfPhoto(orderRef.current.indexOf(state.id)) + 1;
        setAnnouncement(`Photograph moved to page ${page}.`);
      }
    },
    [onReorder],
  );

  const onTilePointerDown = (event, id) => {
    if (event.button !== 0 || !event.isPrimary || drag.current) return;
    if (event.target.closest('button')) return;
    const touch = event.pointerType !== 'mouse';
    const state = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      pointerX: event.clientX,
      pointerY: event.clientY,
      touch,
      active: false,
      scroller,
      startOrder: orderRef.current,
      slots: [],
      frame: 0,
      timer: 0,
    };
    state.onMove = (moveEvent) => {
      if (moveEvent.pointerId !== state.pointerId) return;
      state.pointerX = moveEvent.clientX;
      state.pointerY = moveEvent.clientY;
      if (state.active) {
        updateTarget();
        return;
      }
      const moved = Math.hypot(moveEvent.clientX - state.startX, moveEvent.clientY - state.startY);
      if (touch) {
        if (moved > TOUCH_SLOP_PX) finish(false); // it's a scroll, so let it be one
      } else if (moved > MOUSE_START_PX) {
        activate();
        updateTarget();
      }
    };
    state.onUp = (upEvent) => {
      if (upEvent.pointerId === state.pointerId) finish(true);
    };
    state.onCancel = (cancelEvent) => {
      if (cancelEvent.pointerId === state.pointerId) finish(false);
    };
    window.addEventListener('pointermove', state.onMove);
    window.addEventListener('pointerup', state.onUp);
    window.addEventListener('pointercancel', state.onCancel);
    if (touch) state.timer = setTimeout(activate, TOUCH_HOLD_MS);
    drag.current = state;
  };

  // Once a touch drag has begun, the browser must not also scroll or pull to refresh.
  // That takes a non-passive listener, which React's onTouchMove can't provide.
  useEffect(() => {
    if (!scroller) return undefined;
    const onTouchMove = (event) => {
      if (drag.current?.active) event.preventDefault();
    };
    scroller.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => scroller.removeEventListener('touchmove', onTouchMove);
  }, [scroller]);

  useEffect(() => () => finish(false), [finish]);

  const moveBy = (id, delta) => {
    const from = orderRef.current.indexOf(id);
    const to = from + delta;
    if (to < 0 || to >= orderRef.current.length) return;
    const next = moveItem(orderRef.current, from, to);
    orderRef.current = next;
    setOrder(next);
    onReorder(next);
    setAnnouncement(`Photograph moved to page ${sideOfPhoto(to) + 1}.`);
  };

  return (
    <dialog
      ref={dialogRef}
      className="arranger"
      aria-labelledby="arranger-heading"
      onCancel={(event) => {
        event.preventDefault();
        // Escape first drops a held photo back where it was; only then closes.
        if (drag.current?.active) finish(false);
        else onClose();
      }}
      onContextMenu={(event) => {
        // A long press on a phone would otherwise open the browser's image menu.
        if (drag.current) event.preventDefault();
      }}
    >
      <header className="arranger-head">
        <div>
          <h2 id="arranger-heading">Arrange photographs</h2>
          <p>Drag a photograph to a new place. On a touch screen, press and hold it first.</p>
        </div>
        <button type="button" className="paper-btn solid" onClick={onClose}>
          Done
        </button>
      </header>

      <div ref={setScroller} className="arranger-sheet">
        <ol className="arranger-grid">
          {scroller &&
            order.map((id, index) => {
              const photo = photoById.get(id);
              if (!photo) return null;
              const held = draggingId === id;
              return (
                <li
                  key={id}
                  ref={(element) => {
                    if (element) tiles.current.set(id, element);
                    else tiles.current.delete(id);
                  }}
                  className={`arrange-tile${held ? ' is-held' : ''}`}
                  data-photo-id={id}
                  onPointerDown={(event) => onTilePointerDown(event, id)}
                >
                  <div className="arrange-frame">
                    <Thumbnail photo={photo} scroller={scroller} />
                  </div>
                  <div className="arrange-info">
                    <button
                      type="button"
                      className="arrange-move"
                      aria-label={`Move ${photo.name} earlier`}
                      disabled={index === 0}
                      onClick={() => moveBy(id, -1)}
                    >
                      ‹
                    </button>
                    <span className="arrange-page">
                      <span>Page {sideOfPhoto(index) + 1}</span>
                      <small>{capturedDate(photo)}</small>
                    </span>
                    <button
                      type="button"
                      className="arrange-move"
                      aria-label={`Move ${photo.name} later`}
                      disabled={index === order.length - 1}
                      onClick={() => moveBy(id, 1)}
                    >
                      ›
                    </button>
                  </div>
                </li>
              );
            })}
        </ol>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </dialog>
  );
}
