'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { usePageTurn } from '@/hooks/usePageTurn';
import { advancePointerField, pointerField, prefersReducedMotion, usePointerFieldListener } from '@/lib/ambient/pointerField';
import { playSound, setRustle, setWhoosh } from '@/lib/ambient/sound';
import { LAMP_POSITION, PAGE_WIDTH } from '@/lib/album/bookModel';
import { angleFromHome } from '@/lib/album/bookSpin';
import { MODE_SINGLE, leafCountFor, photoOnSide } from '@/lib/album/pageModel';
import { disposeProceduralTextures } from '@/lib/album/proceduralTextures';
import { approach, cinema, precompile, resetCinema, setCompileTarget, stageReady } from '@/lib/ambient/cinema';
import { TIERS, isTooSlow, viewSettings } from '@/lib/ambient/quality';
import { TurnController } from '@/lib/album/turnController';
import Book from './Book';
import CinemaPost from './CinemaPost';
import { AliveLoop, BurstField, DustField, FloatingPrints, OpeningGlow } from './Effects';
import Room, { WindowLight } from './Room';

// Long lens: stands well back so that a page lifted mid-turn isn't magnified off screen.
const FOV = 15;
const MIN_MARGIN_X = 14;
const MIN_MARGIN_Y = 10;
/** Page width plus a sliver either side: the cover's edge and the gutter's shadow. */
const SINGLE_PAGE_FRAME_WIDTH = PAGE_WIDTH + 0.16;
/** How far round the camera sits from straight overhead for a closed book, in radians. */
const CLOSED_ELEVATION = 1.03;
const CLOSED_AZIMUTH = 0.3;
/**
 * How far the pointer swings it. Small enough that a press lands within a few pixels of
 * where the page-turning maths expects, which treats the view as straight-on.
 */
const PARALLAX_ELEVATION = 0.035;
const PARALLAX_AZIMUTH = 0.045;
const LAMP_SWAY = 1.5;

/**
 * Distance and height for a camera looking straight down -z so that a book of the
 * given size fills the free rectangle between the UI bars. pixelsPerUnit is the
 * smaller of the two fits; the camera distance then follows from the frustum height.
 * Lifting the camera opposite the rectangle's offset centres the book within it.
 */
function fitCamera({ width, height }, top, bottom, bookW, bookH, marginX = MIN_MARGIN_X) {
  const pixelsPerUnit = Math.min(
    (width - marginX * 2) / (bookW * 1.03),
    Math.max(60, height - top - bottom - MIN_MARGIN_Y * 2) / (bookH * 1.03),
  );
  const distance = height / (2 * Math.tan((FOV * Math.PI) / 360) * pixelsPerUnit);
  return { distance, y: -(bottom - top) / 2 / pixelsPerUnit };
}

/**
 * Moves the camera between the framing for a closed book and an open one, and swings it
 * around that framing. A closed book is seen low across the desk, with the room behind it
 * out of focus. As it opens the camera rises to look straight down on the pages. The pointer
 * then adds a little movement on top, so that raised pages shift against the desk and
 * reflections slide across foil and prints. An enlarged photograph draws the camera in.
 */
function CameraRig({ controller, getInsets, showcase = false }) {
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const last = useRef({});
  const orbitTarget = useRef(new THREE.Vector3());
  const time = useRef(0);
  const [still] = useState(() => prefersReducedMotion());

  useLayoutEffect(() => {
    last.current = {}; // force a reframe when the viewport changes
    invalidate();
  }, [size, invalidate]);

  useEffect(() => usePointerFieldListener(invalidate), [invalidate]);

  useFrame((_, delta) => {
    const { pose, layout } = controller;
    const key = `${size.width}x${size.height}:${pose.closed}:${layout.leafCount}:${controller.mode}`;
    const reframe = last.current.key !== key;
    if (reframe) {
      last.current.key = key;
      updateFraming();
    }

    // The view holds still while a page is in hand, so that it stays under the finger.
    if (!controller.drag && advancePointerField(delta)) invalidate();

    const dt = Math.min(delta, 0.1);
    time.current += dt;
    // Starts at 1 and falls away: the camera coming in across the room.
    // It waits, far off, until the book is drawn: a stalled first moment shouldn't use up the approach.
    if (still || cinema.skipArrival) cinema.arrival = 0;
    else if (stageReady()) cinema.arrival = approach(cinema.arrival, 0, 2.3, dt);
    cinema.focus = still ? cinema.focusGoal : approach(cinema.focus, cinema.focusGoal, 3.2, dt);
    const t = time.current;
    const sweep = cinema.arrival;
    const focus = cinema.focus;

    const closedFront = 1 - controller.open;
    // A shut book is never quite still: the view drifts around it, as if someone were
    // walking slowly past. The showcase in the library travels much further.
    const drift = still ? 0 : pose.closed;
    const travel = showcase ? 0.2 : 0.04;
    const elevation =
      pose.closed * CLOSED_ELEVATION +
      pointerField.smoothY * PARALLAX_ELEVATION +
      Math.sin(t * 0.31) * drift * (showcase ? 0.03 : 0.012) +
      sweep * 0.16 * pose.closed +
      focus * 0.05;
    // Toward whichever side the spine is on, so that it's the spine that shows.
    const azimuth =
      (controller.backClosed - closedFront) * CLOSED_AZIMUTH +
      pointerField.smoothX * PARALLAX_AZIMUTH +
      Math.sin(t * 0.23) * drift * travel -
      sweep * 0.5 +
      Math.sin(t * 0.21) * focus * 0.02;
    const orbit = `${elevation.toFixed(5)}:${azimuth.toFixed(5)}:${focus.toFixed(4)}`;
    if (!reframe && last.current.orbit === orbit) return;
    last.current.orbit = orbit;

    const { baseY } = camera.userData;
    const baseZ = camera.userData.baseZ * (1 + sweep * 0.55) * (1 - focus * 0.16);
    const aimX = cinema.focusX * focus * 0.85;
    orbitTarget.current.set(aimX, baseY, 0);
    camera.position.set(
      aimX + baseZ * Math.sin(azimuth) * Math.cos(elevation),
      baseY - baseZ * Math.sin(elevation),
      baseZ * Math.cos(azimuth) * Math.cos(elevation),
    );
    camera.lookAt(orbitTarget.current);
    camera.updateMatrixWorld();
    // So that dragging the book turns it the way the pointer moves on screen.
    const m = camera.matrixWorld.elements;
    controller.spin.setViewAxes([m[0], m[1], m[2]], [m[4], m[5], m[6]]);
    invalidate();
  }, -1);

  function updateFraming() {
    const { pose, layout } = controller;
    const insets = getInsets();
    // A single page is framed by itself and bleeds to the screen edges. Its left
    // neighbour and the cover are out of view, which is what makes the page large.
    const open =
      controller.mode === MODE_SINGLE
        ? fitCamera(size, insets.openTop, insets.openBottom, SINGLE_PAGE_FRAME_WIDTH, layout.bookHeight, 0)
        : fitCamera(size, insets.openTop, insets.openBottom, layout.openWidth, layout.bookHeight);
    // Seen low across the desk, a book is foreshortened to much less than its true height.
    const closed = fitCamera(size, insets.closedTop, insets.closedBottom, layout.closedWidth * 1.75, layout.bookHeight * (showcase ? 0.82 : 1.2));
    const k = pose.closed;
    // Pointer input works from these, the framing without any swing applied.
    camera.userData.baseY = open.y + (closed.y - open.y) * k;
    camera.userData.baseZ = open.distance + (closed.distance - open.distance) * k;
  }

  return null;
}

/** Frames of shadow drawing after anything rebuilds, while its meshes are placed. */
const SHADOW_SETTLE_FRAMES = 30;

/**
 * Three lights with separate jobs, plus the room's reflections. Key: gives photographs even,
 * faithful light. Fill: soft light from everywhere. Rim: low and from behind, raking across
 * a closed book to show its grain and pick out its edges. With the oil lamp's flame that
 * makes four, and the window a fifth on the highest level. Each extra light slows every shader.
 *
 * A closed book is lit for mood: low fill and strong contrast. As it opens the balance
 * shifts to clear, even light, because at that point the photographs matter and the room doesn't.
 */
function Lighting({ controller, themeKey, settings }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const targetRef = useRef(null);
  const lightRef = useRef(null);
  const fillRef = useRef(null);
  const rimRef = useRef(null);
  const shadowSettle = useRef(SHADOW_SETTLE_FRAMES);
  const lastLamp = useRef('');
  const lastPose = useRef(0);

  useLayoutEffect(() => {
    if (lightRef.current && targetRef.current) lightRef.current.target = targetRef.current;
  }, []);

  /**
   * The scene draws every frame for its dust and prints, but those cast no shadows. So
   * shadows are only redrawn when the book or lamp moves, and an idle book costs far less
   * than its constantly moving surroundings suggest.
   */
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    shadowSettle.current = SHADOW_SETTLE_FRAMES;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl, themeKey, settings]);

  // The lamp sways slightly with the view, which sends highlights across foil and prints.
  useFrame(() => {
    if (!lightRef.current) return;
    const moody = controller.pose.closed;
    const x = LAMP_POSITION[0] + pointerField.smoothX * LAMP_SWAY;
    const y = LAMP_POSITION[1] - pointerField.smoothY * LAMP_SWAY;
    lightRef.current.position.set(x, y, LAMP_POSITION[2]);
    // Around a shut book the window does the work, where there is one.
    lightRef.current.intensity = 1.95 - moody * (settings.windowLight ? 1.75 : 1.3);
    lightRef.current.color.copy(KEY_OPEN).lerp(KEY_MOODY, moody);
    if (fillRef.current) {
      fillRef.current.intensity = 0.62 - moody * 0.48;
      // Shadows go cool around a shut book, which is what makes warm light look warm.
      fillRef.current.color.copy(FILL_OPEN).lerp(FILL_MOODY, moody);
    }
    if (rimRef.current) {
      // One light with two jobs. A book in the hand needs light from the viewer's side,
      // or any face turned away from the lamp drops into near darkness.
      const inHand = Math.min(1, angleFromHome(controller.spin.q) / 0.7);
      rimRef.current.position.lerpVectors(RIM_POSITION, camera.position, inHand);
      rimRef.current.intensity = moody * (1 - inHand) + inHand * 1.25;
      rimRef.current.color.copy(RIM_COLOUR).lerp(FILL_OPEN, inHand);
    }

    const lamp = `${x.toFixed(3)}:${y.toFixed(3)}`;
    const lampMoved = lamp !== lastLamp.current;
    lastLamp.current = lamp;
    const poseChanged = controller.poseVersion !== lastPose.current;
    lastPose.current = controller.poseVersion;
    if (cinema.shadowsDirty) {
      cinema.shadowsDirty = false;
      shadowSettle.current = SHADOW_SETTLE_FRAMES;
    }
    if (shadowSettle.current > 0) shadowSettle.current -= 1;
    gl.shadowMap.needsUpdate = lampMoved || poseChanged || controller.isAnimating || shadowSettle.current > 0;
  });

  return (
    <>
      <hemisphereLight ref={fillRef} args={['#fff9f0', '#3a3026', 0.7]} />
      <object3D ref={targetRef} position={[0, -0.2, 0]} />
      <spotLight
        ref={lightRef}
        castShadow
        position={LAMP_POSITION}
        angle={0.62}
        penumbra={1}
        decay={0}
        intensity={2.15}
        color="#fff8ee"
        shadow-mapSize={[settings.shadowSize, settings.shadowSize]}
        shadow-bias={-0.0006}
        shadow-normalBias={0.01}
        shadow-radius={settings.shadowSize > 1024 ? 9 : 6}
        shadow-blurSamples={settings.shadowSize > 1024 ? 14 : 8}
        shadow-intensity={0.72}
        shadow-camera-near={6}
        shadow-camera-far={40}
      />
      <directionalLight ref={rimRef} position={RIM_POSITION} color={RIM_COLOUR} intensity={0} />
      {settings.windowLight && <WindowLight controller={controller} shadowSize={settings.shadowSize} />}
    </>
  );
}

const KEY_OPEN = new THREE.Color('#ffffff');
const KEY_MOODY = new THREE.Color('#ffcf96');
const RIM_POSITION = new THREE.Vector3(3.5, 11, 2.3);
const RIM_COLOUR = new THREE.Color('#ffb877');
const FILL_OPEN = new THREE.Color('#ffffff');
const FILL_MOODY = new THREE.Color('#7f9bd0');

/** The longest a scene stays hidden for, whatever else hasn't finished by then. */
const REVEAL_WITHIN_MS = 9000;

/**
 * Nothing is drawn until the scene's shaders are ready, because compiling them on first use
 * would freeze the whole page, for many seconds on some systems. They're compiled in the
 * background instead, and Chrome keeps the results for later visits. The canvas then fades
 * up once the book is really there. Also draws the frame when there are no lens effects.
 */
function ScenePreparation({ settings, onCompiled }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    let cancelled = false;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    setCompileTarget(target);
    const started = performance.now();
    const finish = () => {
      if (cancelled) return;
      cinema.compiled = true;
      onCompiled();
      invalidate();
    };
    const compile = () => {
      if (cancelled) return;
      // Waits briefly for the desk's textures, so that its real material is compiled too.
      if (!cinema.roomLoaded && performance.now() - started < 2500) {
        setTimeout(compile, 60);
        return;
      }
      precompile(gl, scene, camera, scene, settings.post).then(finish, finish);
    };
    // The next tick, once React has placed everything in the scene.
    const first = setTimeout(compile, 0);
    const reveal = setTimeout(() => gl.domElement.classList.add('is-shown'), REVEAL_WITHIN_MS);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearTimeout(reveal);
      setCompileTarget(null);
      target.dispose();
    };
  }, [gl, scene, camera, invalidate, settings.post, onCompiled]);

  useFrame(() => {
    if (stageReady()) gl.domElement.classList.add('is-shown');
    else invalidate();
    if (!settings.post && cinema.compiled) gl.render(scene, camera);
  }, 1);
  return null;
}

/** Measures real frame rate for a few seconds at a time, and steps the level down if needed. */
function QualityGovernor() {
  const frames = useRef(0);
  const elapsed = useRef(-2.5); // ignores the first moments, while things are loading
  useFrame((_, delta) => {
    // A long gap is a hidden tab or a rendering rest, not slowness.
    if (delta > 0.5) return;
    elapsed.current += delta;
    if (elapsed.current <= 0) return;
    frames.current += 1;
    if (elapsed.current < 4) return;
    if (isTooSlow(frames.current, elapsed.current)) viewSettings.stepDown();
    frames.current = 0;
    elapsed.current = -1;
  });
  return null;
}
function InteractionLayer({ controller, photosRef, onPhotoTap }) {
  const leafContext = useRef({
    photoOnSide: (side) => photoOnSide(side, photosRef.current),
  });
  usePageTurn(controller, onPhotoTap, leafContext);
  return null;
}

const NOTHING = () => {};

/** Connects the book's motion to its sounds, including those that follow speed. */
function SoundBridge({ controller }) {
  useEffect(() => {
    controller.sound = playSound;
    return () => {
      controller.sound = NOTHING;
      setRustle(0);
      setWhoosh(0);
    };
  }, [controller]);

  useFrame(() => {
    const held = controller.drag ? controller.active.get(controller.drag.leaf) : null;
    setRustle(held ? Math.min(1, Math.abs(held.v) * 0.45) : 0);
    setWhoosh(Math.min(1, controller.spin.speed / 11));
  });
  return null;
}

const MAX_RECOVERIES = 3;

/**
 * The graphics card can take a page's 3D context away: after the computer sleeps, when a
 * driver resets, or when many other tabs or apps want it. The scene is then rebuilt on a
 * fresh canvas, which brings it back without a reload. Only if that keeps failing is the
 * page told, so that it can offer a reload.
 */
function Stage(props) {
  const [generation, setGeneration] = useState(0);
  const recoveries = useRef(0);
  const { onContextLost } = props;
  const lost = useCallback(() => {
    if (recoveries.current >= MAX_RECOVERIES) {
      onContextLost?.();
      return;
    }
    recoveries.current += 1;
    setGeneration(recoveries.current);
  }, [onContextLost]);
  return <StageCanvas key={generation} {...props} onLost={lost} />;
}

/** Everything shared by the album's scene and the library's showcase. */
function StageCanvas({ controller, photos, title, description, theme, getInsets, showcase, onPhotoTap, onRemovePhoto, onLost, children }) {
  const view = useSyncExternalStore(viewSettings.subscribe, viewSettings.get, viewSettings.getServer);
  const settings = TIERS[view.tier];
  const [compiled, setCompiled] = useState(false);
  const onCompiled = useCallback(() => setCompiled(true), []);
  useEffect(() => {
    resetCinema();
    return () => {
      resetCinema();
      disposeProceduralTextures();
    };
  }, []);
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') window.__view = viewSettings;
  }, []);

  return (
    <Canvas
      className="album-canvas"
      frameloop="demand"
      shadows="variance"
      dpr={[1, settings.dpr]}
      camera={{ fov: FOV, near: 2, far: 240, position: [0, 0, 30] }}
      gl={GL_OPTIONS}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', (event) => {
          event.preventDefault();
          // Rebuilt once the current frame has finished with the old context.
          setTimeout(onLost, 250);
        });
      }}
      aria-hidden="true"
    >
      <AliveLoop controller={controller} />
      {view.choice === 'auto' && <QualityGovernor />}
      <SoundBridge controller={controller} />
      <Lighting controller={controller} themeKey={theme.key} settings={settings} />
      <Room controller={controller} settings={settings} compiled={compiled} />
      <CameraRig controller={controller} getInsets={getInsets} showcase={showcase} />
      {/* A new look is a new book: rebuilding is simpler than repainting every material. */}
      <Book
        key={theme.key}
        controller={controller}
        photos={showcase ? EMPTY_PHOTOS : photos}
        title={title}
        description={description}
        theme={theme}
        coverWidth={settings.post ? 2048 : 1024}
        onCaptionPhoto={onPhotoTap ?? NOTHING}
        onRemovePhoto={onRemovePhoto ?? NOTHING}
      />
      <FloatingPrints key={settings.prints} controller={controller} photos={showcase ? EMPTY_PHOTOS : photos} count={settings.prints} />
      <DustField key={settings.dust} controller={controller} count={settings.dust} />
      <BurstField controller={controller} />
      <OpeningGlow controller={controller} />
      <ScenePreparation settings={settings} onCompiled={onCompiled} />
      {settings.post && <CinemaPost key={view.tier} controller={controller} settings={settings} />}
      {children}
    </Canvas>
  );
}

/**
 * Khronos PBR Neutral: colours pass through unchanged until they near white, which keeps
 * photographs true where the usual filmic curves would shift them all.
 */
const GL_OPTIONS = { antialias: true, powerPreference: 'high-performance', toneMapping: THREE.NeutralToneMapping };
const EMPTY_PHOTOS = [];

export default function AlbumScene({ controller, photos, title, description, theme, getInsets, onPhotoTap, onRemovePhoto, onContextLost }) {
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  return (
    <Stage
      controller={controller}
      photos={photos}
      title={title}
      description={description}
      theme={theme}
      getInsets={getInsets}
      onPhotoTap={onPhotoTap}
      onRemovePhoto={onRemovePhoto}
      onContextLost={onContextLost}
    >
      <InteractionLayer controller={controller} photosRef={photosRef} onPhotoTap={onPhotoTap} />
    </Stage>
  );
}

/** The library's centrepiece: one album's real 3D book, shut and slowly turning. */
export function ShowcaseScene({ controller, title, photos, theme, getInsets }) {
  return <Stage controller={controller} photos={photos} title={title} theme={theme} getInsets={getInsets} showcase />;
}
