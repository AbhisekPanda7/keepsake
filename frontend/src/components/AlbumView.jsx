'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Component, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import AlbumEditor from '@/components/Controls/AlbumEditor';
import ConfirmationDialog from '@/components/Controls/ConfirmationDialog';
import PhotoArranger from '@/components/Controls/PhotoArranger';
import PhotoViewer from '@/components/Controls/PhotoViewer';
import Toolbar from '@/components/Controls/Toolbar';
import UploadButton from '@/components/Controls/UploadButton';
import EmptyState from '@/components/UI/EmptyState';
import FlatAlbum from '@/components/UI/FlatAlbum';
import Header from '@/components/UI/Header';
import LoadingState from '@/components/UI/LoadingState';
import Notice from '@/components/UI/Notice';
import { useAlbum } from '@/hooks/useAlbum';
import { useViewMode } from '@/hooks/useViewMode';
import { OPENING_COVER_AT, OPENING_LENGTH, cinema, stageReady } from '@/lib/ambient/cinema';
import { prefersReducedMotion } from '@/lib/ambient/pointerField';
import { viewSettings } from '@/lib/ambient/quality';
import { soundDebug } from '@/lib/ambient/sound';
import { PAGE_WIDTH } from '@/lib/album/bookModel';
import { MODE_SINGLE, leafCountFor, pageLabel, photoOnSide, sidesOfSpread, spreadOfPhoto } from '@/lib/album/pageModel';
import { formatDay } from '@/lib/album/photoInfo';
import { resolveTheme } from '@/lib/album/themes';
import { TurnController } from '@/lib/album/turnController';
import { clearArrival, isArriving } from '@/lib/navigation/arrival';

const AlbumScene = dynamic(() => import('@/components/Album/AlbumScene'), { ssr: false });

/** Time for the 3D book to appear on screen before its cover swings open, with no opening scene. */
const ARRIVAL_OPEN_DELAY_MS = 450;
/** With no pointer movement for this long, the controls step back from an open book. */
const CONTROLS_REST_MS = 3500;
/** Slower than a cover opened by hand, so that the pages can be seen fanning out behind it. */
const OPENING_COVER_OMEGA = 2.5;
/** Starts regardless after this long, so that nothing can leave a book waiting forever. */
const OPENING_MAX_WAIT_MS = 10000;

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(context);
  } catch {
    return false;
  }
}

/** If the 3D scene fails outright, the photographs should still be reachable. */
class SceneBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const emptySubscribe = () => () => {};

function MissingAlbum() {
  return (
    <main className="missing-album">
      <h1>This album isn&rsquo;t here</h1>
      <p>It may have been deleted, or it may be stored in a different browser.</p>
      <Link href="/" className="tool large strong">
        Back to your library
      </Link>
    </main>
  );
}

/** One album's screen: the 3D book and everything for working with it. */
export default function AlbumView({ albumId }) {
  const album = useAlbum(albumId);
  const { photos, details, status } = album;
  const { title, description } = details;
  const theme = useMemo(() => resolveTheme(details.theme), [details.theme]);

  const [controller] = useState(() => {
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return new TurnController(leafCountFor(0), { turnOmega: reduced ? 16 : 6.2 });
  });
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { spread, stage, leafCount } = snapshot;
  const mode = useViewMode();

  const isClient = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const webgl = useMemo(() => (isClient ? supportsWebGL() : true), [isClient]);

  const [pendingRemoval, setPendingRemoval] = useState(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [viewingId, setViewingId] = useState(null);
  const [arranging, setArranging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [hasTurned, setHasTurned] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  const viewing = viewingId ? photos.find((photo) => photo.id === viewingId) ?? null : null;
  const openViewer = useCallback((photo) => setViewingId(photo.id), []);
  const closeViewer = useCallback(() => setViewingId(null), []);

  // The book always has room for the current photographs, bound to suit the screen.
  useEffect(() => {
    controller.setMode(mode, leafCountFor(photos.length, mode));
  }, [controller, photos.length, mode]);

  useEffect(() => {
    if (spread > 0) setHasTurned(true);
  }, [spread]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      window.__album = controller;
      window.__albumSound = soundDebug;
    }
  }, [controller]);

  // Coming from the library, the cover opens by itself: you just reached for this book.
  // The opening scene is the camera arriving, the cover lifting and the light coming out
  // of the pages. Everything after the cue follows the same motion as opening by hand.
  const [inOpening, setInOpening] = useState(false);
  const stopOpeningClock = useRef(() => {});
  const endOpening = useCallback(() => {
    stopOpeningClock.current();
    setInOpening(false);
  }, []);
  useEffect(() => {
    if (status !== 'ready' || !isArriving(albumId)) return undefined;
    const open = () => {
      clearArrival();
      if (controller.stage() === 'closed-front') controller.next();
    };
    if (prefersReducedMotion() || !viewSettings.get().openingScene) {
      const timer = setTimeout(open, ARRIVAL_OPEN_DELAY_MS);
      return () => clearTimeout(timer);
    }
    setInOpening(true);
    // Only for this one opening: covers go back to their usual pace straight after it.
    const usualOmega = controller.coverOmega;
    const restorePace = () => {
      controller.coverOmega = usualOmega;
    };
    controller.coverOmega = OPENING_COVER_OMEGA;
    // The clock starts once the book is really on screen, not when the page has loaded.
    const timers = [];
    const waitingSince = performance.now();
    const waiting = setInterval(() => {
      if (!stageReady() && performance.now() - waitingSince < OPENING_MAX_WAIT_MS) return;
      clearInterval(waiting);
      timers.push(
        setTimeout(open, OPENING_COVER_AT * 1000),
        setTimeout(() => {
          restorePace();
          setInOpening(false);
        }, OPENING_LENGTH * 1000),
      );
    }, 40);
    stopOpeningClock.current = () => {
      clearInterval(waiting);
      timers.forEach(clearTimeout);
    };
    return () => {
      restorePace();
      endOpening();
    };
  }, [status, albumId, controller, endOpening]);
  const skipOpening = useCallback(() => {
    endOpening();
    clearArrival();
    cinema.skipArrival = true;
    controller.finishOpening();
  }, [controller, endOpening]);

  useEffect(() => {
    if (!inOpening) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') skipOpening();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inOpening, skipOpening]);

  // The camera moves in on an enlarged photograph, and back out when it's closed.
  useEffect(() => {
    if (!viewingId) {
      cinema.focusGoal = 0;
      return;
    }
    const { spread: current, layout, mode: bound } = controller;
    const { right } = sidesOfSpread(current, layout.leafCount, bound);
    const onRight = photoOnSide(right, photos)?.id === viewingId;
    cinema.focusX = bound === MODE_SINGLE ? 0 : ((onRight ? 1 : -1) * PAGE_WIDTH) / 2;
    cinema.focusGoal = 1;
  }, [viewingId, controller, photos]);
  useEffect(
    () => () => {
      cinema.focusGoal = 0;
    },
    [],
  );

  // The controls step back from an open book while nobody is reaching for them. Only for
  // a mouse: on a touch screen there's no way to hover them back, so they stay.
  const mainRef = useRef(null);
  useEffect(() => {
    if (!window.matchMedia('(hover: hover)').matches) return undefined;
    let timer = 0;
    const wake = () => {
      mainRef.current?.classList.remove('controls-resting');
      clearTimeout(timer);
      timer = setTimeout(() => mainRef.current?.classList.add('controls-resting'), CONTROLS_REST_MS);
    };
    wake();
    const events = ['pointermove', 'pointerdown', 'keydown', 'focusin'];
    events.forEach((name) => window.addEventListener(name, wake));
    return () => {
      clearTimeout(timer);
      events.forEach((name) => window.removeEventListener(name, wake));
    };
  }, []);
  const { addFiles: addToAlbum } = album;
  const addFiles = useCallback(
    (files) => {
      addToAlbum(files, (firstIndex, total) => {
        // Show the first new photograph as soon as it is safely stored.
        controller.setLeafCount(leafCountFor(total, controller.mode));
        controller.goToSpread(spreadOfPhoto(firstIndex, controller.mode));
      });
    },
    [addToAlbum, controller],
  );

  const confirmRemoval = useCallback(async () => {
    const photo = pendingRemoval;
    setPendingRemoval(null);
    setViewingId(null);
    if (photo) await album.removePhoto(photo);
  }, [album, pendingRemoval]);

  const confirmClear = useCallback(async () => {
    setConfirmingClear(false);
    if (await album.clearAll()) controller.closeAlbum();
  }, [album, controller]);

  useEffect(() => {
    const onKey = (event) => {
      if (document.querySelector('dialog[open]')) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        controller.next();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        controller.prev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);

  // ---- Framing: the camera keeps the book in the space the UI leaves free. ----
  const headerRef = useRef(null);
  const toolbarRef = useRef(null);
  const heroRef = useRef(null);
  const ctaRef = useRef(null);
  const guideRef = useRef(null);
  const getInsets = useCallback(() => {
    // Measured against the app itself, which a phone's browser bar can make shorter.
    const height = headerRef.current?.parentElement.getBoundingClientRect().height ?? window.innerHeight;
    const bottomOf = (ref) => ref.current?.getBoundingClientRect().bottom ?? 0;
    const topOf = (ref) => ref.current?.getBoundingClientRect().top ?? height;
    return {
      openTop: bottomOf(guideRef),
      openBottom: height - topOf(toolbarRef),
      closedTop: bottomOf(heroRef),
      closedBottom: height - topOf(ctaRef),
    };
  }, []);

  if (status === 'missing') return <MissingAlbum />;

  const closed = stage !== 'open';
  const atStart = stage === 'closed-front';

  const fallback = <FlatAlbum photos={photos} onRemove={setPendingRemoval} />;
  const ready = status === 'ready' || status === 'unavailable';

  return (
    <main
      ref={mainRef}
      className={`app stage-${stage}${dropActive ? ' is-dropping' : ''}${inOpening ? ' in-opening' : ''}`}
      onDragOver={(event) => {
        if ([...event.dataTransfer.types].includes('Files')) {
          event.preventDefault();
          setDropActive(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target || !event.relatedTarget) setDropActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropActive(false);
        if (event.dataTransfer.files?.length) addFiles(event.dataTransfer.files);
      }}
    >
      {!ready ? (
        <LoadingState />
      ) : webgl ? (
        <SceneBoundary fallback={fallback}>
          <AlbumScene
            controller={controller}
            photos={photos}
            title={title}
            description={description}
            theme={theme}
            getInsets={getInsets}
            onPhotoTap={openViewer}
            onRemovePhoto={setPendingRemoval}
            onContextLost={() => setContextLost(true)}
          />
        </SceneBoundary>
      ) : (
        fallback
      )}
      <div className="vignette" aria-hidden="true" />

      <Header ref={headerRef} backToLibrary />

      <section ref={heroRef} className={`hero${atStart && ready ? ' is-visible' : ''}`} aria-hidden={!atStart}>
        <h1>{title || ' '}</h1>
        <p>{description || (details.createdAt ? `Begun ${formatDay(details.createdAt)}` : ' ')}</p>
      </section>

      <EmptyState
        ref={guideRef}
        visible={!closed && ready}
        isEmpty={photos.length === 0}
        showHint={!hasTurned}
        singlePage={mode === MODE_SINGLE}
        uploading={Boolean(album.upload)}
        onFiles={addFiles}
      />

      <div ref={ctaRef} className={`cta${closed ? ' is-visible' : ''}`}>
        {snapshot.turned ? (
          <button type="button" className="set-down" onClick={() => controller.spin.goHome()}>
            Set it down
          </button>
        ) : (
          <p className="spin-hint">Drag the book to turn it over</p>
        )}
        <button type="button" className="tool strong large" onClick={() => (atStart ? controller.next() : controller.prev())} tabIndex={closed ? 0 : -1}>
          {atStart ? 'Open album' : 'Open again'}
        </button>
        <UploadButton className="tool large" onFiles={addFiles} disabled={Boolean(album.upload) || !closed}>
          Add photographs
        </UploadButton>
      </div>

      <Toolbar
        ref={toolbarRef}
        pageText={pageLabel(stage, spread, leafCount, snapshot.mode)}
        photoCount={photos.length}
        canPrev={stage !== 'closed-front'}
        canNext={stage !== 'closed-back'}
        canClose={stage === 'open'}
        uploading={Boolean(album.upload)}
        onPrev={() => controller.prev()}
        onNext={() => controller.next()}
        onFiles={addFiles}
        onArrange={() => setArranging(true)}
        onEdit={() => setEditing(true)}
        onClose={() => controller.closeAlbum()}
        onClear={() => setConfirmingClear(true)}
      />

      <p className="visually-hidden" aria-live="polite">
        {pageLabel(stage, spread, leafCount, snapshot.mode)}
      </p>

      {inOpening && (
        <button type="button" className="opening-skip" onClick={skipOpening}>
          Skip
        </button>
      )}

      <Notice upload={album.upload} notice={album.notice} onDismiss={album.dismissNotice} />

      {contextLost && (
        <div className="notice is-error" role="alert">
          <span>The 3D view was interrupted. Your photographs are safe.</span>
          <button type="button" className="text-action" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}

      {arranging && (
        <PhotoArranger photos={photos} onReorder={album.reorderPhotos} onClose={() => setArranging(false)} />
      )}
      {editing && (
        <AlbumEditor
          album={{ ...details, photos }}
          onCancel={() => setEditing(false)}
          onSave={(fields) => {
            setEditing(false);
            album.saveDetails(fields);
          }}
        />
      )}
      {viewing && (
        <PhotoViewer
          key={viewing.id}
          photo={viewing}
          onClose={closeViewer}
          onRemove={setPendingRemoval}
          onCaption={album.setCaption}
        />
      )}
      {pendingRemoval && (
        <ConfirmationDialog
          title="Remove this photograph?"
          message="Are you sure? It will be taken out of this album, and once removed it can't be recovered."
          confirmLabel="Remove"
          onConfirm={confirmRemoval}
          onCancel={() => setPendingRemoval(null)}
        />
      )}
      {confirmingClear && (
        <ConfirmationDialog
          title="Clear this album?"
          message={`Are you sure? ${photos.length === 1 ? 'The 1 photograph' : `All ${photos.length} photographs`} in “${title}” will be removed. Other albums won't be affected. Once removed, ${photos.length === 1 ? 'it' : 'they'} can't be recovered.`}
          confirmLabel="Clear album"
          onConfirm={confirmClear}
          onCancel={() => setConfirmingClear(false)}
        />
      )}
    </main>
  );
}
