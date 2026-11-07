'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import AlbumEditor from '@/components/Controls/AlbumEditor';
import ConfirmationDialog from '@/components/Controls/ConfirmationDialog';
import Header from '@/components/UI/Header';
import LoadingState from '@/components/UI/LoadingState';
import Notice from '@/components/UI/Notice';
import { useLibrary } from '@/hooks/useLibrary';
import { advancePointerField, pointerField, usePointerFieldListener } from '@/lib/ambient/pointerField';
import { photoCountText } from '@/lib/album/photoInfo';
import { leafCountFor } from '@/lib/album/pageModel';
import { resolveTheme } from '@/lib/album/themes';
import { TurnController } from '@/lib/album/turnController';
import { markArrival } from '@/lib/navigation/arrival';
import { DEFAULT_TITLE, getAlbum } from '@/lib/storage/albumStore';
import AlbumCard from './AlbumCard';

const ShowcaseScene = dynamic(() => import('@/components/Album/AlbumScene').then((module) => module.ShowcaseScene), { ssr: false });

const FLY_MS = 480;

/**
 * Feeds the pointer's position into CSS, where the table and every book respond to it.
 * It's written straight to style, so that a moving mouse doesn't re-render React.
 */
function useLibraryParallax(ref) {
  useEffect(() => {
    let frame = 0;
    let last = 0;
    const step = (now) => {
      const moving = advancePointerField((now - last) / 1000);
      last = now;
      ref.current?.style.setProperty('--px', pointerField.smoothX.toFixed(4));
      ref.current?.style.setProperty('--py', pointerField.smoothY.toFixed(4));
      frame = moving ? requestAnimationFrame(step) : 0;
    };
    const stop = usePointerFieldListener(() => {
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(step);
      }
    });
    return () => {
      stop();
      cancelAnimationFrame(frame);
    };
  }, [ref]);
}

export default function AlbumLibrary() {
  const router = useRouter();
  const library = useLibrary();
  const { albums, status } = library;
  const rootRef = useRef(null);
  useLibraryParallax(rootRef);

  const [editing, setEditing] = useState(null); // an album, or 'new'
  const [deleting, setDeleting] = useState(null);
  const [leavingId, setLeavingId] = useState(null);

  // Loaded ahead of time so that opening a book doesn't wait on the 3D engine.
  useEffect(() => {
    const timer = setTimeout(() => {
      import('@/components/Album/AlbumScene').catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  /**
   * The book being opened rises to the middle of the screen, where the 3D version of
   * the same book appears when the album loads. The rest of the table fades away.
   */
  const openAlbum = useCallback(
    (album, element) => {
      if (leavingId) return;
      setLeavingId(album.id);
      markArrival(album.id);
      const path = `/albums/${encodeURIComponent(album.id)}`;
      router.prefetch(path);
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const source = element ?? document.querySelector(`[data-album-id="${album.id}"] .album-open`);
      const book = source?.querySelector('.book');
      if (book && !reduced) {
        const rect = book.getBoundingClientRect();
        const dx = window.innerWidth / 2 - (rect.left + rect.width / 2);
        const dy = window.innerHeight / 2 - (rect.top + rect.height / 2);
        const scale = Math.min(2.4, (window.innerHeight * 0.62) / rect.height, (window.innerWidth * 0.8) / rect.width);
        book.style.transition = `transform ${FLY_MS}ms cubic-bezier(.3,.1,.2,1)`;
        book.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
        setTimeout(() => router.push(path), FLY_MS);
      } else {
        router.push(path);
      }
    },
    [leavingId, router],
  );

  const saveEditor = async (fields) => {
    const target = editing;
    setEditing(null);
    if (target === 'new') {
      const album = await library.createAlbum(fields);
      if (album) openAlbum(album);
    } else {
      await library.saveDetails(target.id, fields);
    }
  };

  const onDuplicate = useCallback((album) => library.duplicateAlbum(album.id), [library]);

  const confirmDelete = async () => {
    const album = deleting;
    setDeleting(null);
    await library.deleteAlbum(album.id);
  };

  const empty = status === 'ready' && albums.length === 0;
  const total = albums.reduce((sum, album) => sum + album.photoCount, 0);

  // The most recently used album stars in the 3D scene. New visitors see a blank book.
  const featured = albums[0] ?? null;
  const [featuredPhotos, setFeaturedPhotos] = useState([]);
  const featuredId = featured?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!featuredId) {
      setFeaturedPhotos([]);
      return undefined;
    }
    getAlbum(featuredId).then(
      (album) => {
        if (!cancelled) setFeaturedPhotos(album?.photos ?? []);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [featuredId]);
  const showcaseTheme = useMemo(() => resolveTheme(featured?.theme), [featured?.theme]);

  // Kept out here because the page lies over the 3D scene: this button takes the drag.
  const showcase = useMemo(() => new TurnController(leafCountFor(featured?.photoCount ?? 0)), [featured?.photoCount]);
  const showcaseSnapshot = useSyncExternalStore(showcase.subscribe, showcase.getSnapshot, showcase.getSnapshot);
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') window.__showcase = showcase;
  }, [showcase]);
  const showcaseDrag = useRef({ id: null, x: 0, y: 0, startX: 0, startY: 0, turned: false });
  const showcaseHandlers = useMemo(
    () => ({
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        showcaseDrag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, turned: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event) => {
        const drag = showcaseDrag.current;
        if (drag.id !== event.pointerId) return;
        if (!drag.turned) {
          if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
          drag.turned = true;
          showcase.spin.grab();
        }
        showcase.spin.dragBy(event.clientX - drag.x, event.clientY - drag.y);
        drag.x = event.clientX;
        drag.y = event.clientY;
        showcase.wake();
      },
      onPointerUp: (event) => {
        const drag = showcaseDrag.current;
        if (drag.id !== event.pointerId) return;
        drag.id = null;
        if (drag.turned) showcase.spin.release();
      },
      onPointerCancel: () => {
        const drag = showcaseDrag.current;
        drag.id = null;
        if (drag.turned) showcase.spin.release();
      },
    }),
    [showcase],
  );

  const [webgl, setWebgl] = useState(false);
  useEffect(() => {
    try {
      const probe = document.createElement('canvas');
      const context = probe.getContext('webgl2') || probe.getContext('webgl');
      context?.getExtension('WEBGL_lose_context')?.loseContext();
      setWebgl(Boolean(context));
    } catch {
      setWebgl(false);
    }
  }, []);

  /** Keeps the 3D book inside the space that the page's text leaves for it. */
  const slotRef = useRef(null);
  const getInsets = useCallback(() => {
    const slot = slotRef.current;
    const height = rootRef.current?.getBoundingClientRect().height ?? window.innerHeight;
    if (!slot) return { openTop: 0, openBottom: 0, closedTop: 0, closedBottom: 0 };
    const top = slot.offsetTop;
    const bottom = height - (slot.offsetTop + slot.offsetHeight);
    return { openTop: top, openBottom: bottom, closedTop: top, closedBottom: bottom };
  }, []);

  return (
    <main ref={rootRef} className={`library${leavingId ? ' is-leaving' : ''}`}>
      <div className="library-table" aria-hidden="true" />
      <div className="library-light" aria-hidden="true" />
      {webgl && status === 'ready' && (
        <div className="library-stage" aria-hidden="true">
          <ShowcaseScene
            key={featuredId ?? 'blank'}
            controller={showcase}
            title={featured?.title ?? DEFAULT_TITLE}
            photos={featuredPhotos}
            theme={showcaseTheme}
            getInsets={getInsets}
          />
        </div>
      )}

      <div className="library-scroll">
        <Header />

        <section className={`library-intro${empty ? ' is-empty' : ''}`}>
          <h1>{empty ? 'Photographs deserve pages, not folders.' : 'Your albums'}</h1>
          {empty ? (
            <p>Keep your pictures in albums you can open, and turn their pages whenever you want to go back.</p>
          ) : (
            status === 'ready' && (
              <p>
                {albums.length} {albums.length === 1 ? 'album' : 'albums'}, {photoCountText(total).toLowerCase()}
              </p>
            )
          )}
          <button type="button" className="tool large strong" onClick={() => setEditing('new')} disabled={status === 'loading'}>
            {empty ? 'Begin your first album' : 'New album'}
          </button>
        </section>

        {/* Empty space on the page: the real 3D book shows through it from behind. */}
        <div ref={slotRef} className="library-slot">
          <button
            type="button"
            className="library-slot-open"
            {...showcaseHandlers}
            onClick={(event) => {
              // The press that ended a turn of the book isn't a request to open it.
              if (showcaseDrag.current.turned) {
                event.preventDefault();
                return;
              }
              if (featured) openAlbum(featured);
              else setEditing('new');
            }}
          >
            <span className="visually-hidden">{featured ? `Open ${featured.title}` : 'Begin your first album'}</span>
          </button>
          {webgl &&
            (showcaseSnapshot.turned ? (
              <button type="button" className="set-down" onClick={() => showcase.spin.goHome()}>
                Set it down
              </button>
            ) : (
              <p className="spin-hint">Drag the book to turn it over</p>
            ))}
        </div>

        {status === 'loading' ? (
          <LoadingState />
        ) : (
          albums.length > 0 && (
            <div className="album-shelf">
              <ul className="album-grid">
                {albums.map((album, index) => (
                  <AlbumCard
                    key={album.id}
                    index={index}
                    album={album}
                    leaving={leavingId && leavingId !== album.id}
                    onOpen={openAlbum}
                    onEdit={setEditing}
                    onDuplicate={onDuplicate}
                    onDelete={setDeleting}
                  />
                ))}
              </ul>
            </div>
          )
        )}
      </div>

      <Notice notice={library.notice} onDismiss={library.dismissNotice} />

      {editing && <AlbumEditor album={editing === 'new' ? null : editing} onSave={saveEditor} onCancel={() => setEditing(null)} />}
      {deleting && (
        <ConfirmationDialog
          title={`Delete “${deleting.title}”?`}
          message={
            deleting.photoCount
              ? `Are you sure? This album and its ${photoCountText(deleting.photoCount)} will be deleted. Other albums won't be affected. Once deleted, it can't be recovered.`
              : "Are you sure? This empty album will be deleted. Once deleted, it can't be recovered."
          }
          confirmLabel="Delete album"
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </main>
  );
}
