'use client';

import { memo, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { PAGE_HEIGHT, PAGE_WIDTH } from '@/lib/album/bookModel';
import { MODE_SPREAD, describeLeaf, describeSide, photoOnSide, sidesNear, sidesOfSpread } from '@/lib/album/pageModel';
import { PageTextureCache } from '@/lib/album/pageTextureCache';
import { contactShadowTexture } from '@/lib/album/proceduralTextures';
import { pointerField } from '@/lib/ambient/pointerField';
import { getPhotoBlob } from '@/lib/storage/albumStore';
import Cover from './Cover';
import { PageFan } from './Effects';
import Page from './Page';
import PageStack from './PageStack';
import Ribbon from './Ribbon';
import Spine from './Spine';

/** Larger than a page's print can ever appear. The enlarged view shows the whole file. */
const PAGE_PHOTO_MAX = 1400;

async function loadBitmap(photo) {
  const blob = await getPhotoBlob(photo.id);
  const scale = PAGE_PHOTO_MAX / Math.max(photo.width, photo.height);
  if (!(scale < 1)) return createImageBitmap(blob);
  try {
    return await createImageBitmap(blob, {
      resizeWidth: Math.round(photo.width * scale),
      resizeHeight: Math.round(photo.height * scale),
      resizeQuality: 'high',
    });
  } catch {
    return createImageBitmap(blob); // browsers that don't take these options
  }
}

/** Small actions printed in the foot margin of a page holding a photo. */
const PageAction = memo(function PageAction({ side, photo, onCaption, onRemove, z, dark }) {
  return (
    <Html
      position={[(side * PAGE_WIDTH) / 2, -PAGE_HEIGHT / 2 + 0.135, z]}
      center
      zIndexRange={[20, 10]}
      wrapperClass="page-action-wrap"
    >
      <div className={`page-actions${dark ? ' is-dark' : ''}`}>
        <button type="button" className="page-action" onClick={() => onCaption(photo)}>
          {photo.caption ? 'Edit caption' : 'Add caption'}
        </button>
        <button type="button" className="page-action" onClick={() => onRemove(photo)}>
          Remove
        </button>
      </div>
    </Html>
  );
});

export default function Book({ controller, photos, title, description, theme, coverWidth, onCaptionPhoto, onRemovePhoto }) {
  const tiltRef = useRef(null);
  const groupRef = useRef(null);
  const shadowRef = useRef(null);
  const spinRef = useRef(null);
  const pivotRef = useRef(null);
  const wasAnimating = useRef(false);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  // The pages' gilding takes the cover's metal, so a silver-tooled book has silver pages.
  const paper = useMemo(() => ({ ...theme.paperInfo, foil: theme.colourInfo.foil }), [theme.paperInfo, theme.colourInfo.foil]);

  const textures = useMemo(() => new PageTextureCache(loadBitmap, paper), [paper]);
  useEffect(() => {
    textures.setRenderer(gl);
  }, [textures, gl]);
  useEffect(() => {
    textures.revive();
    return () => textures.destroy();
  }, [textures]);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      window.__albumRenderer = gl;
      window.__albumCamera = camera;
    }
  }, [gl, camera]);

  useEffect(() => {
    controller.wake = invalidate;
    invalidate();
    return () => {
      controller.wake = () => {};
    };
  }, [controller, invalidate]);

  // Runs ahead of the leaves (negative priority), so they read this frame's values.
  useFrame((_, delta) => {
    // With on-demand rendering, delta after a pause spans the whole pause. The first
    // frame of new motion must not leap ahead by it.
    controller.update(wasAnimating.current ? delta : 1 / 60);
    wasAnimating.current = controller.isAnimating;
    if (controller.isAnimating) invalidate();

    const { pose, layout, spin } = controller;
    if (groupRef.current) groupRef.current.position.x = pose.offsetX;
    // A shut book leans a hair toward the pointer, as if it knew someone were reaching for it.
    if (tiltRef.current) {
      tiltRef.current.rotation.x = -pointerField.smoothY * 0.018 * pose.closed;
      tiltRef.current.rotation.y = pointerField.smoothX * 0.024 * pose.closed;
    }

    // Turned about its own centre, and raised just enough that no corner meets the table.
    const halfZ = layout.boardT + layout.blockT / 2;
    const centre = spin.centreHeight(layout.closedWidth / 2, layout.bookHeight / 2, halfZ);
    if (spinRef.current) {
      spinRef.current.position.z = centre;
      spinRef.current.quaternion.set(spin.q[0], spin.q[1], spin.q[2], spin.q[3]);
    }
    if (pivotRef.current) pivotRef.current.position.z = -halfZ;

    if (shadowRef.current) {
      // Footprint blends from one board (closed) to two (open).
      const width = layout.closedWidth + (layout.openWidth - layout.closedWidth) * (1 - pose.closed);
      shadowRef.current.scale.set(width * 1.26, layout.bookHeight * 1.38, 1);
      shadowRef.current.position.x = pose.footprintX;
      // Lifted off the table it no longer touches, so this close-up shadow fades.
      shadowRef.current.material.opacity = 0.72 * Math.max(0.12, 1 - (centre - halfZ) * 1.4);
    }
  }, -2);

  const { layout } = controller;
  const { leafCount, mode } = snapshot;
  const leaves = useMemo(() => {
    const list = [];
    for (let leaf = snapshot.visibleFrom; leaf <= snapshot.visibleTo; leaf += 1) list.push(leaf);
    return list;
  }, [snapshot.visibleFrom, snapshot.visibleTo]);

  // Pages either side of the current view are prepared before they can be turned to.
  useEffect(() => {
    for (const side of sidesNear(snapshot.spread, leafCount, mode)) {
      textures.preload(describeSide(side, photos, title, mode, description));
    }
  }, [textures, snapshot.spread, leafCount, mode, photos, title, description]);

  const { left, right } = sidesOfSpread(snapshot.spread, leafCount, mode);
  const leftPhoto = photoOnSide(left, photos);
  const rightPhoto = photoOnSide(right, photos);
  // On a single page the print fills the page, leaving no margin to hold these. There,
  // tapping the photograph opens the enlarged view, which offers the same actions.
  const showActions = snapshot.resting && snapshot.stage === 'open' && mode === MODE_SPREAD;
  const actionZ = layout.boardT + layout.blockT;
  const darkPaper = theme.paper === 'black';

  return (
    <>
      <mesh ref={shadowRef} position={[0, -0.035, 0.002]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={contactShadowTexture()} transparent opacity={0.72} depthWrite={false} toneMapped={false} />
      </mesh>

      <group ref={tiltRef}>
      <group ref={spinRef}>
        <group ref={pivotRef}>
      <group ref={groupRef}>
        <Cover controller={controller} which="front" title={title} layout={layout} theme={theme} coverWidth={coverWidth} />
        <Cover controller={controller} which="back" layout={layout} theme={theme} coverWidth={coverWidth} />
        <Spine controller={controller} layout={layout} theme={theme} title={title} />
        <Ribbon controller={controller} colour={theme.colourInfo.ribbon} />
        <PageFan controller={controller} />

        {/* Every sheet not drawn on its own is part of these two solid blocks. */}
        <PageStack controller={controller} side={1} sheetCount={leafCount - 1 - snapshot.visibleTo} paper={paper} />
        <PageStack controller={controller} side={-1} sheetCount={snapshot.visibleFrom} paper={paper} />

        {leaves.map((leaf) => (
          <PageWithSides
            key={leaf}
            leaf={leaf}
            controller={controller}
            photos={photos}
            title={title}
            description={description}
            mode={mode}
            textures={textures}
            paper={paper}
          />
        ))}

        {showActions && leftPhoto && (
          <PageAction side={-1} photo={leftPhoto} onCaption={onCaptionPhoto} onRemove={onRemovePhoto} z={actionZ} dark={darkPaper} />
        )}
        {showActions && rightPhoto && (
          <PageAction side={1} photo={rightPhoto} onCaption={onCaptionPhoto} onRemove={onRemovePhoto} z={actionZ} dark={darkPaper} />
        )}
      </group>
        </group>
      </group>
      </group>
    </>
  );
}

function PageWithSides({ leaf, controller, photos, title, description, mode, textures, paper }) {
  const { front, back } = describeLeaf(leaf, photos, title, mode, description);
  return <Page leaf={leaf} controller={controller} frontDesc={front} backDesc={back} textures={textures} paper={paper} />;
}
