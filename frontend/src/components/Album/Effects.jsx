'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { cinema, stageReady } from '@/lib/ambient/cinema';
import { pointerField, prefersReducedMotion } from '@/lib/ambient/pointerField';
import { PAGE_HEIGHT, PAGE_WIDTH, WINDOW_POSITION, WINDOW_TARGET } from '@/lib/album/bookModel';
import { surfaceMaterial } from '@/lib/album/proceduralTextures';
import { getPhotoBlob } from '@/lib/storage/albumStore';

/** After this long with nobody touching anything, an open book stops being redrawn. */
const REST_AFTER_MS = 20000;

/**
 * Keeps the scene drawing every frame, because something in it is always moving. Once an
 * open book has been left alone for a while there's nothing worth the battery, so drawing
 * rests until the next touch, key or pointer movement.
 */
export function AliveLoop({ controller }) {
  const invalidate = useThree((s) => s.invalidate);
  const [enabled] = useState(() => !prefersReducedMotion());
  const lastInput = useRef(0);

  useEffect(() => {
    lastInput.current = performance.now();
    const onInput = () => {
      lastInput.current = performance.now();
      invalidate();
    };
    const events = ['pointermove', 'pointerdown', 'keydown', 'touchstart'];
    events.forEach((name) => window.addEventListener(name, onInput, { passive: true }));
    invalidate();
    return () => events.forEach((name) => window.removeEventListener(name, onInput));
  }, [invalidate]);

  useFrame(() => {
    if (!cinema.compiled) return;
    cinema.framesDrawn += 1;
    if (!stageReady()) invalidate();
    if (!enabled) return;
    const resting = controller.isCoverOpen && !controller.isAnimating && performance.now() - lastInput.current > REST_AFTER_MS;
    if (!resting) invalidate();
  });
  return null;
}
// ---- floating dust ---------------------------------------------------------------

const DUST_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  uniform vec2 uPointer;
  uniform vec3 uBeamFrom;
  uniform vec3 uBeamAxis;
  uniform float uBeamLength;
  attribute vec4 aSeed; // phase, speed, size, twinkle rate
  varying float vGlow;
  void main() {
    vec3 p = position;
    // Drifts very slowly and wraps around, wandering sideways as it goes.
    p.y = mod(p.y + uTime * aSeed.y * 0.05 + 9.0, 18.0) - 9.0;
    p.x += sin(uTime * 0.09 * aSeed.y + aSeed.x) * 0.7;
    p.z += sin(uTime * 0.13 + aSeed.x * 2.0) * 0.35;

    // Moving a hand through the air stirs it a little.
    vec2 d = p.xy - uPointer;
    float pull = exp(-dot(d, d) / 2.4);
    float a = pull * 0.55;
    p.xy = uPointer + mat2(cos(a), -sin(a), sin(a), cos(a)) * d;

    // Dust is only seen where light falls on it: inside the beam, and scarcely elsewhere.
    vec3 fromTop = p - uBeamFrom;
    float along = dot(fromTop, uBeamAxis);
    float s = clamp(along / uBeamLength, 0.0, 1.0);
    float radius = mix(1.0, 4.1, s);
    float off = length(fromTop - uBeamAxis * along);
    float lit = 1.0 - smoothstep(radius * 0.45, radius, off);

    vec4 view = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = aSeed.z * uScale / -view.z;
    float twinkle = 0.55 + 0.45 * sin(uTime * aSeed.w + aSeed.x);
    vGlow = twinkle * (0.018 + lit * 0.95);
  }
`;
const SOFT_POINT_FRAGMENT = /* glsl */ `
  uniform float uBright;
  varying float vGlow;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float disc = smoothstep(1.0, 0.0, r);
    gl_FragColor = vec4(vec3(1.0, 0.8, 0.52) * (0.5 + vGlow * 2.0) * uBright, disc * disc * (0.2 + vGlow * 0.75) * uBright);
  }
`;

function pointMaterial(vertexShader, fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** World position under the pointer at a given height above the table. */
function usePointerOnPlane() {
  const camera = useThree((s) => s.camera);
  return useMemo(() => {
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hit = new THREE.Vector3();
    return (height) => {
      ndc.set(pointerField.smoothX, -pointerField.smoothY);
      raycaster.setFromCamera(ndc, camera);
      plane.constant = -height;
      return raycaster.ray.intersectPlane(plane, hit);
    };
  }, [camera]);
}

/**
 * Thousands of motes, animated entirely in the vertex shader, so the count adds almost
 * no work per frame. They turn in an eddy around the pointer.
 */
export function DustField({ controller, count }) {
  const size = useThree((s) => s.size);
  const viewport = useThree((s) => s.viewport);
  const camera = useThree((s) => s.camera);
  const pointerOnPlane = usePointerOnPlane();
  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 26;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 18;
      positions[i * 3 + 2] = 0.15 + Math.random() * 7;
      seeds[i * 4] = Math.random() * Math.PI * 2;
      seeds[i * 4 + 1] = 0.3 + Math.random();
      // Mostly fine dust, with the occasional larger fleck.
      seeds[i * 4 + 2] = 0.014 + Math.random() ** 3 * 0.04;
      seeds[i * 4 + 3] = 0.3 + Math.random() * 1.4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    return g;
  }, [count]);
  const material = useMemo(
    () =>
      pointMaterial(DUST_VERTEX, SOFT_POINT_FRAGMENT, {
        uTime: { value: 0 },
        uScale: { value: 1 },
        uBright: { value: 1 },
        uPointer: { value: new THREE.Vector2(100, 100) },
        uBeamFrom: { value: new THREE.Vector3(...WINDOW_POSITION) },
        uBeamAxis: { value: new THREE.Vector3(...WINDOW_TARGET).sub(new THREE.Vector3(...WINDOW_POSITION)).normalize() },
        uBeamLength: { value: new THREE.Vector3(...WINDOW_TARGET).distanceTo(new THREE.Vector3(...WINDOW_POSITION)) },
      }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((_, delta) => {
    material.uniforms.uTime.value += Math.min(delta, 0.1);
    material.uniforms.uBright.value = 0.16 + controller.pose.closed * 0.74;
    // Pixels per world unit at distance 1, so that nearer motes draw larger.
    material.uniforms.uScale.value = (size.height * viewport.dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const hit = pointerOnPlane(1.5);
    if (hit) material.uniforms.uPointer.value.set(hit.x, hit.y);
  });

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />;
}

// ---- bursts of sparks and paper dust ----------------------------------------------

const BURST_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  attribute vec3 aVelocity;
  attribute vec3 aSpark; // birth, life, size
  varying float vGlow;
  void main() {
    float age = uTime - aSpark.x;
    float k = clamp(age / aSpark.y, 0.0, 1.0);
    bool alive = age >= 0.0 && age < aSpark.y;
    // Air slows a spark quickly, and then it drifts down.
    float travel = (1.0 - exp(-2.6 * age)) / 2.6;
    vec3 p = position + aVelocity * travel + vec3(0.0, 0.0, -0.22 * age * age);
    p.z = max(p.z, 0.02);
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = alive ? aSpark.z * (1.0 - k * 0.5) * uScale / -view.z : 0.0;
    vGlow = alive ? (1.0 - k) * (1.0 - k) * 2.2 : 0.0;
  }
`;

const BURST_CAPACITY = 900;

/**
 * Short-lived particles from a fixed pool. Each is fired by writing where and when it
 * starts, and the shader works out everything after that from the time alone.
 */
export function BurstField({ controller }) {
  const size = useThree((s) => s.size);
  const viewport = useThree((s) => s.viewport);
  const camera = useThree((s) => s.camera);
  const cursor = useRef(0);
  const time = useRef(0);
  const wasOpening = useRef(false);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BURST_CAPACITY * 3), 3));
    g.setAttribute('aVelocity', new THREE.BufferAttribute(new Float32Array(BURST_CAPACITY * 3), 3));
    const spark = new Float32Array(BURST_CAPACITY * 3);
    for (let i = 0; i < BURST_CAPACITY; i += 1) spark[i * 3] = -100;
    g.setAttribute('aSpark', new THREE.BufferAttribute(spark, 3));
    return g;
  }, []);
  const material = useMemo(
    () => pointMaterial(BURST_VERTEX, SOFT_POINT_FRAGMENT, { uTime: { value: 0 }, uScale: { value: 1 }, uBright: { value: 0.42 } }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const fire = (count, spawn) => {
    const { position, aVelocity, aSpark } = geometry.attributes;
    for (let n = 0; n < count; n += 1) {
      const i = cursor.current;
      cursor.current = (i + 1) % BURST_CAPACITY;
      const s = spawn(n);
      position.setXYZ(i, s.x, s.y, s.z);
      aVelocity.setXYZ(i, s.vx, s.vy, s.vz);
      aSpark.setXYZ(i, time.current + (s.delay ?? 0), s.life, s.size);
    }
    position.needsUpdate = true;
    aVelocity.needsUpdate = true;
    aSpark.needsUpdate = true;
  };

  useFrame((_, delta) => {
    time.current += Math.min(delta, 0.1);
    material.uniforms.uTime.value = time.current;
    material.uniforms.uScale.value = (size.height * viewport.dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const { pose, layout } = controller;
    const top = layout.boardT + layout.blockT;

    // The cover lifts: dust that lay along its edge is thrown up into the light.
    const opening = controller.openTarget === 1 && controller.open > 0.03 && controller.open < 0.6;
    if (opening && !wasOpening.current) {
      fire(46, (n) => {
        const onEdge = n % 3 !== 0;
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.3 + Math.random() * 1;
        return {
          x: pose.offsetX + Math.random() * PAGE_WIDTH,
          y: onEdge ? (Math.random() < 0.5 ? -1 : 1) * (PAGE_HEIGHT / 2) : (Math.random() - 0.5) * PAGE_HEIGHT,
          z: top + 0.05,
          vx: Math.cos(angle) * speed * 0.6,
          vy: Math.sin(angle) * speed * 0.8,
          vz: 0.3 + Math.random() * 1.1,
          delay: Math.random() * 0.5,
          life: 1.2 + Math.random() * 1.8,
          size: 0.012 + Math.random() * 0.024,
        };
      });
    }
    wasOpening.current = opening;

    // A page lands: air squeezed out from under it throws up dust along the fore-edge.
    for (const effect of controller.takeEffects()) {
      if (effect.type !== 'land') continue;
      fire(14, () => {
        const y = (Math.random() - 0.5) * PAGE_HEIGHT;
        return {
          x: pose.offsetX + effect.side * PAGE_WIDTH * (0.62 + Math.random() * 0.4),
          y,
          z: top + 0.03,
          vx: effect.side * (0.5 + Math.random() * 2.1),
          vy: y * 0.5 + (Math.random() - 0.5) * 0.6,
          vz: 0.3 + Math.random() * 1.5,
          life: 0.7 + Math.random() * 1.1,
          size: 0.012 + Math.random() * 0.026,
        };
      });
    }
  });

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={6} />;
}

// ---- light from inside the book, and a light under the pointer -----------------------

function glowCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const glow = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  glow.addColorStop(0, 'rgba(255,226,170,1)');
  glow.addColorStop(0.45, 'rgba(255,196,120,0.42)');
  glow.addColorStop(1, 'rgba(255,170,90,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 256, 256);
  return canvas;
}

/**
 * As the cover lifts, warm light floods out across the pages and fades as they settle. This
 * is a glow rather than a real light: every light in the scene makes every shader slower to
 * compile, and the page fan already carries the effect.
 */
export function OpeningGlow({ controller }) {
  const meshRef = useRef(null);
  const texture = useMemo(() => new THREE.CanvasTexture(glowCanvas()), []);
  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(() => {
    const { pose, layout, open } = controller;
    const strength = Math.sin(Math.PI * Math.min(1, open * 1.15)) ** 2 * (controller.openTarget === 1 ? 1 : 0.35);
    const x = pose.offsetX + PAGE_WIDTH / 2;
    const z = layout.boardT + layout.blockT + 0.04;
    if (meshRef.current) {
      meshRef.current.visible = strength > 0.005;
      meshRef.current.position.set(x, 0, z);
      meshRef.current.material.opacity = strength * 0.14;
    }

  });

  return (
    <mesh ref={meshRef} renderOrder={4}>
      <planeGeometry args={[PAGE_WIDTH * 2.5, PAGE_HEIGHT * 2]} />
      <meshBasicMaterial map={texture} color={[1.25, 0.98, 0.66]} transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

// ---- the pages fanning open ----------------------------------------------------------

const FAN_COUNT = 22;

const FAN_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying float vRank;
  void main() {
    // Distance to the nearest free edge of the sheet: the fore-edge, head and foot.
    float edge = min(1.0 - vUv.x, min(vUv.y, 1.0 - vUv.y) * 1.25);
    float rim = 1.0 - smoothstep(0.0, 0.012, edge);
    // The light is inside the book: hottest down at the spine, dying out across the sheet.
    float fromSpine = pow(max(1.0 - vUv.x, 0.0), 2.2);
    vec3 shade = mix(vec3(0.028, 0.012, 0.006), vec3(1.5, 0.5, 0.06), fromSpine);
    shade = mix(shade, vec3(2.4, 1.5, 0.42), pow(fromSpine, 4.0));
    // Each sheet catches it a little differently, which separates one from the next.
    shade *= 0.72 + 0.28 * sin(vRank * 57.0);
    vec3 colour = shade + vec3(2.6, 1.08, 0.2) * rim * (0.42 + fromSpine * 0.9);
    gl_FragColor = vec4(colour, 1.0);
  }
`;

/**
 * As the cover lifts, the pages riffle open behind it in a fan, lit from within: solid thin
 * sheets, each hiding the one behind, dark across their faces with their edges burning. The
 * light is strongest down at the spine. As the book settles they fall to either side and
 * draw back into the gutter, and they don't exist at all the rest of the time.
 */
export function PageFan({ controller }) {
  const meshRef = useRef(null);
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(PAGE_WIDTH * 0.98, PAGE_HEIGHT * 0.985);
    g.translate((PAGE_WIDTH * 0.98) / 2, 0, 0);
    const ranks = new Float32Array(FAN_COUNT);
    for (let i = 0; i < FAN_COUNT; i += 1) ranks[i] = i / (FAN_COUNT - 1);
    g.setAttribute('aRank', new THREE.InstancedBufferAttribute(ranks, 1));
    return g;
  }, []);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const scale = useMemo(() => new THREE.Matrix4(), []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const { open, openTarget, pose } = controller;
    const settle = Math.min(1, Math.max(0, (open - 0.56) / 0.36));
    mesh.visible = openTarget === 1 && open > 0.012 && settle < 1;
    if (!mesh.visible) return;
    const eased = settle * settle * (3 - 2 * settle);
    const sweep = pose.frontAngle;
    for (let i = 0; i < FAN_COUNT; i += 1) {
      const rank = i / (FAN_COUNT - 1);
      // Spread out behind the cover, then falling toward whichever stack is nearer.
      const fanned = sweep * (0.05 + 0.9 * rank ** 1.15);
      const rest = rank > 0.5 ? Math.PI : 0;
      const angle = fanned + (rest - fanned) * eased;
      matrix.makeRotationY(-angle);
      scale.makeScale(1 - eased, 1, 1);
      matrix.multiply(scale);
      matrix.setPosition(0, 0, pose.hingeZ + 0.012);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[geometry, null, FAN_COUNT]} frustumCulled={false} visible={false}>
      <shaderMaterial
        side={THREE.DoubleSide}
        vertexShader={/* glsl */ `
          attribute float aRank;
          varying vec2 vUv;
          varying float vRank;
          void main() {
            vUv = uv;
            vRank = aRank;
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={FAN_FRAGMENT}
      />
    </instancedMesh>
  );
}
// ---- photographs in the air ------------------------------------------------------------

const PRINT_W = 0.98;
const PRINT_H = 1.2;
const PRINT_THICK = 0.012;
/** Where each print hangs around a closed book, as a fraction of the room around it. */
const PRINT_ANCHORS = [
  { x: -1.02, y: -1.02, z: 1.2, spin: -0.1 },
  { x: 1.02, y: -1.08, z: 1.1, spin: 0.14 },
  { x: -0.72, y: 0.3, z: 1.5, spin: 0.1 },
];
/** A print cropped to fill its window, with the white paper border prints used to have. */
function drawPrint(canvas, bitmap) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4efe2';
  ctx.fillRect(0, 0, w, h);
  const m = w * 0.055;
  const imgW = w - m * 2;
  const imgH = h - m * 2 - h * 0.09;
  const scale = Math.max(imgW / bitmap.width, imgH / bitmap.height);
  const sw = imgW / scale;
  const sh = imgH / scale;
  ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, m, m, imgW, imgH);
  ctx.strokeStyle = 'rgba(30,20,10,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(m, m, imgW, imgH);
}

/** A thin sheet with real edges, bowed slightly as photographic paper always is. */
function printGeometry() {
  const g = new THREE.BoxGeometry(PRINT_W, PRINT_H, PRINT_THICK, 12, 12, 1);
  const position = g.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const u = position.getX(i) / (PRINT_W / 2);
    const v = position.getY(i) / (PRINT_H / 2);
    position.setZ(i, position.getZ(i) + (u * u * 0.055 + v * v * 0.02 + u * v * 0.016));
  }
  g.computeVertexNormals();
  return g;
}

/**
 * The album's own photographs, as physical prints hanging in the air around the closed
 * book. As the cover opens they drift down into the pages, and they come out when it shuts.
 * An album with no photographs has none: blank cards in the air would mean nothing.
 */
export function FloatingPrints({ controller, photos, count }) {
  const groupRef = useRef(null);
  const viewport = useThree((s) => s.viewport);
  const time = useRef(0);
  const [loaded, setLoaded] = useState(() => new Set());

  const edge = useMemo(() => surfaceMaterial({ color: '#efe8d8', roughness: 0.8, metalness: 0 }), []);
  const back = useMemo(() => surfaceMaterial({ color: '#e7dfcd', roughness: 0.92, metalness: 0 }), []);
  const geometry = useMemo(printGeometry, []);
  const prints = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = Math.round((320 * PRINT_H) / PRINT_W);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        const face = surfaceMaterial({ map: texture, roughness: 0.34, metalness: 0 });
        return {
          canvas,
          texture,
          face,
          materials: [edge, edge, edge, edge, face, back],
          anchor: PRINT_ANCHORS[i % PRINT_ANCHORS.length],
          phase: Math.random() * Math.PI * 2,
          stagger: i / count,
        };
      }),
    [count, edge, back],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      edge.dispose();
      back.dispose();
      prints.forEach((print) => {
        print.texture.dispose();
        print.face.dispose();
      });
    },
    [geometry, edge, back, prints],
  );

  // Small decodes only, so these cost little however large the album is.
  const photoKey = photos.slice(0, count).map((p) => p.id).join();
  useEffect(() => {
    let cancelled = false;
    setLoaded(new Set());
    if (photos.length === 0) return undefined;
    // With only a few photographs, they repeat rather than leaving gaps.
    prints.forEach(async (print, i) => {
      const photo = photos[i % photos.length];
      try {
        const blob = await getPhotoBlob(photo.id);
        const scale = Math.min(1, 420 / Math.max(photo.width, photo.height));
        const bitmap = await createImageBitmap(blob, {
          resizeWidth: Math.round(photo.width * scale),
          resizeHeight: Math.round(photo.height * scale),
        });
        if (cancelled) {
          bitmap.close();
          return;
        }
        drawPrint(print.canvas, bitmap);
        bitmap.close();
        print.texture.needsUpdate = true;
        setLoaded((set) => new Set(set).add(i));
      } catch {
        // That print just stays out of the air.
      }
    });
    return () => {
      cancelled = true;
    };
    // photoKey stands for the first few photos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoKey, prints]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    time.current += Math.min(delta, 0.1);
    const t = time.current;
    const { pose, layout } = controller;
    const inAir = pose.closed;
    group.visible = inAir > 0.01;
    if (!group.visible) return;

    // Keeps them on screen, but clear of the book, on any shape of window.
    const rx = Math.max(layout.closedWidth * 0.92, viewport.width * 0.34);
    const ry = Math.max(layout.bookHeight * 0.72, viewport.height * 0.34);
    const homeX = pose.offsetX + PAGE_WIDTH / 2;
    // They rise from the desk as the camera arrives.
    const risen = 1 - cinema.arrival * 0.75;

    group.children.forEach((mesh, i) => {
      const print = prints[i];
      const { anchor } = print;
      const k = Math.min(1, Math.max(0, (inAir - print.stagger * (1 - inAir) * 0.5) * 1.1));
      const eased = k * k * (3 - 2 * k);
      // Gone before it reaches the page, rather than piling up there.
      mesh.visible = eased > 0.06 && loaded.has(i);
      const ax = homeX * (1 - eased) + anchor.x * rx * eased;
      const ay = anchor.y * ry * eased;
      const bob = Math.sin(t * 0.34 + print.phase) * 0.07;
      mesh.position.set(ax + Math.sin(t * 0.19 + print.phase) * 0.05, ay + bob * 0.6, 0.3 + (anchor.z * risen + bob) * eased);
      // Tipped back toward the viewer, as if each had just been held up to be looked at.
      mesh.rotation.set(
        0.86 + Math.sin(t * 0.23 + print.phase) * 0.05,
        -anchor.x * 0.32 + Math.cos(t * 0.19 + print.phase) * 0.05,
        anchor.spin + Math.sin(t * 0.16 + print.phase) * 0.03,
      );
      const size = 0.3 + eased * 0.7;
      mesh.scale.set(size, size, size);
    });
  });

  return (
    <group ref={groupRef}>
      {prints.map((print, i) => (
        <mesh key={i} geometry={geometry} material={print.materials} visible={false} />
      ))}
    </group>
  );
}
