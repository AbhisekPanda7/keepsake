'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { WINDOW_POSITION, WINDOW_TARGET } from '@/lib/album/bookModel';
import { surfaceMaterial } from '@/lib/album/proceduralTextures';
import { cinema, precompile } from '@/lib/ambient/cinema';
import Candelabra from './Candelabra';
import { FLAME_FRAGMENT, FLAME_VERTEX } from './flame';
import { prefersReducedMotion } from '@/lib/ambient/pointerField';

/**
 * The room around the book: a walnut desk against panelled wall, the things left on the
 * desk, and the light in the air. All assets are CC0, from Poly Haven and ambientCG (see
 * public/scene/CREDITS.md). Each loads on its own and nothing waits for it, so a slow or
 * failed download leaves plainer surroundings and never stops the album from working.
 */

const DESK_BACK = 6.5;

// ---- textures ---------------------------------------------------------------------

function loadTextures(files, gl, repeat) {
  const loader = new THREE.TextureLoader();
  return Promise.all(
    Object.entries(files).map(
      ([name, { url, srgb }]) =>
        new Promise((resolve, reject) => {
          loader.load(
            url,
            (texture) => {
              if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
              texture.wrapS = THREE.RepeatWrapping;
              texture.wrapT = THREE.RepeatWrapping;
              texture.repeat.set(repeat[0], repeat[1]);
              texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
              resolve([name, texture]);
            },
            undefined,
            reject,
          );
        }),
    ),
  ).then((entries) => Object.fromEntries(entries));
}

/** A set of textures, or null until all have arrived. Stays null if any can't be loaded. */
function useTextureSet(files, repeat) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const [set, setSet] = useState(null);
  useEffect(() => {
    let cancelled = false;
    let loaded = null;
    loadTextures(files, gl, repeat).then(
      (textures) => {
        if (cancelled) {
          Object.values(textures).forEach((t) => t.dispose());
          return;
        }
        loaded = textures;
        setSet(textures);
        invalidate();
      },
      () => {},
    );
    return () => {
      cancelled = true;
      if (loaded) Object.values(loaded).forEach((t) => t.dispose());
    };
    // The lists below are constants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, invalidate]);
  return set;
}

const DESK_FILES = {
  map: { url: '/scene/textures/desk-color.webp', srgb: true },
  normalMap: { url: '/scene/textures/desk-normal.webp' },
  roughnessMap: { url: '/scene/textures/desk-rough.webp' },
};
const DESK_REPEAT = [6, 4];
const WALL_FILES = {
  map: { url: '/scene/textures/wall-color.webp', srgb: true },
  normalMap: { url: '/scene/textures/wall-normal.webp' },
};
const WALL_REPEAT = [5, 1.8];

// Darkened from the scans: a deep, aged walnut, with room in it for the lamp to work.
const DESK_TINT = '#6f5543';
const DESK_FLAT = '#2a180e';
const NORMAL_SCALE = new THREE.Vector2(0.45, 0.45);

function useSurface(textures, tint, flatColour, roughness) {
  const material = useMemo(
    () => (textures ? surfaceMaterial({ ...textures, color: tint, normalScale: NORMAL_SCALE, roughness, metalness: 0 }) : surfaceMaterial({ color: flatColour, roughness, metalness: 0 })),
    [textures, tint, flatColour, roughness],
  );
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

function Desk() {
  const textures = useTextureSet(DESK_FILES, DESK_REPEAT);
  useEffect(() => {
    if (textures) cinema.roomLoaded = true;
  }, [textures]);
  const material = useSurface(textures, DESK_TINT, DESK_FLAT, 0.74);
  return (
    <mesh position={[0, DESK_BACK - 15, -0.002]} material={material} receiveShadow>
      <planeGeometry args={[44, 30]} />
    </mesh>
  );
}

function BackWall() {
  const textures = useTextureSet(WALL_FILES, WALL_REPEAT);
  const material = useSurface(textures, '#a58a74', '#1a0e08', 0.72);
  return (
    <mesh position={[0, DESK_BACK, 8]} rotation={[Math.PI / 2, 0, 0]} material={material}>
      <planeGeometry args={[44, 16]} />
    </mesh>
  );
}
// ---- things on the desk -----------------------------------------------------------

const LAMP_SPOT = [-4.5, 3.3];
const LAMP_SIZE = 2.9;
/** Beside the open book, where the oil lamp is out of frame. */
const CANDELABRA_SPOT = [-4.2, 0.55];

/** `size` is the object's longest side in scene units, where 1 unit is about 8 cm. */
const PROPS = [
  { file: 'vintage_oil_lamp', at: LAMP_SPOT, size: LAMP_SIZE, turn: 0.4, few: true, cast: true },
  { file: 'book_encyclopedia_set_01', at: [3.6, 4.6], size: 4.6, turn: 0, cast: true },
  { file: 'mantel_clock_01', at: [-0.6, 5.2], size: 2.6, turn: -0.08, cast: true },
  { file: 'standing_picture_frame_01', at: [6.8, 3.2], size: 2.3, turn: -0.5, cast: true },
  { file: 'round_spectacles', at: [4.5, -0.75], size: 1.8, turn: 0.55, few: true, cast: true },
  // Modelled standing on its rim. Laid back to rest almost flat, its dial tipped toward you.
  { file: 'vintage_pocket_watch', at: [-4.35, -1.15], size: 1.05, turn: -0.7, lay: 0.26, few: true, cast: true },
  { file: 'magnifying_glass_01', at: [-4.9, 1.45], size: 2.1, turn: 1.1, cast: true },
  { file: 'seadogs_compass', at: [5.2, 1.55], size: 1.05, turn: 0.3, cast: true },
];

function disposeObject(root) {
  root.traverse((node) => {
    node.geometry?.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (!material) return;
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) value.dispose();
      });
      material.dispose();
    });
  });
}

/**
 * Simplifies a model's materials. Real glass (transmission) makes three.js draw the entire
 * scene an extra time per frame, and each unusual material is another slow shader to compile.
 * At this size, on a dark desk, a faint clear surface looks just the same.
 */
function plainMaterial(source) {
  const clear = source.transmission > 0 || source.transparent || /glass|lens/i.test(source.name);
  const material = surfaceMaterial({
    name: source.name,
    map: source.map ?? undefined,
    normalMap: source.normalMap ?? undefined,
    roughnessMap: source.roughnessMap ?? undefined,
    metalnessMap: source.metalnessMap ?? undefined,
    color: source.color,
    roughness: clear ? 0.06 : source.roughness,
    metalness: clear ? 0 : source.metalness,
    transparent: clear,
    opacity: clear ? 0.16 : 1,
    depthWrite: !clear,
  });
  if (source.normalMap) material.normalScale.copy(source.normalScale);
  source.aoMap?.dispose();
  source.emissiveMap?.dispose();
  source.dispose();
  return { material, clear };
}

/**
 * A model loaded, stood on the desk and sized. Models come in metres and Y-up, whereas this
 * scene is Z-up, so each is turned upright (`lay`, a quarter turn) and then measured to find
 * where its feet are. A smaller `lay` tips a model back toward lying flat.
 */
function Prop({ file, at, size, turn, cast, post, lay = Math.PI / 2 }) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const rootScene = useThree((s) => s.scene);
  const [object, setObject] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let loaded = null;
    new GLTFLoader().load(
      `/scene/models/${file}.glb`,
      async ({ scene }) => {
        if (cancelled) {
          disposeObject(scene);
          return;
        }
        loaded = scene;
        scene.rotation.x = lay;
        scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(scene);
        const measured = box.getSize(new THREE.Vector3());
        const scale = size / Math.max(measured.x, measured.y, measured.z, 1e-3);
        const centre = box.getCenter(new THREE.Vector3());
        scene.scale.setScalar(scale);
        scene.position.set(-centre.x * scale, -centre.y * scale, -box.min.z * scale);
        scene.traverse((node) => {
          if (node.isMesh) {
            const { material, clear } = plainMaterial(node.material);
            node.material = material;
            // Clear glass lets light through: as a solid shadow it would read as a mistake.
            node.castShadow = cast && !clear;
            node.receiveShadow = !clear;
          }
        });
        // Shaders are prepared in the background first, so that it appears without a stall.
        await precompile(gl, scene, camera, rootScene, post);
        if (cancelled) return;        setObject(scene);
        cinema.shadowsDirty = true;
        invalidate();
      },
      undefined,
      () => {},
    );
    return () => {
      cancelled = true;
      if (loaded) disposeObject(loaded);
    };
  }, [file, size, lay, cast, post, gl, camera, rootScene, invalidate]);

  if (!object) return null;
  return (
    <group position={[at[0], at[1], 0]} rotation={[0, 0, turn]}>
      <primitive object={object} />
    </group>
  );
}

// ---- the oil lamp's flame ---------------------------------------------------------



/** The oil lamp's flame. Its light swells when the book is shut, and sinks low when it opens. */
function OilLampFlame({ controller, spot, size }) {
  const FLAME_POINT = [spot[0], spot[1], size * 0.56];
  const scale = size / LAMP_SIZE;
  const meshRef = useRef(null);
  const lightRef = useRef(null);
  const [still] = useState(() => prefersReducedMotion());
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uStrength: { value: 1 } }), []);
  const time = useRef(0);

  useFrame(({ camera }, delta) => {
    time.current += still ? 0 : Math.min(delta, 0.1);
    const t = time.current;
    uniforms.uTime.value = t;
    if (meshRef.current) meshRef.current.quaternion.copy(camera.quaternion);
    if (lightRef.current) {
      const flicker = 1 + Math.sin(t * 9.3) * 0.05 + Math.sin(t * 17.1) * 0.04 + Math.sin(t * 3.1) * 0.05;
      // Low beneath an open book, so that a flickering light never crosses the photographs.
      lightRef.current.intensity = (0.1 + controller.pose.closed * 14.4) * flicker;
    }
  });

  return (
    <>
      <mesh ref={meshRef} position={FLAME_POINT} renderOrder={7}>
        <planeGeometry args={[0.2 * scale, 0.42 * scale]} />
        <shaderMaterial
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          vertexShader={FLAME_VERTEX}
          fragmentShader={FLAME_FRAGMENT}
        />
      </mesh>
      <pointLight
        ref={lightRef}
        position={[FLAME_POINT[0], FLAME_POINT[1] - 0.15, FLAME_POINT[2] + 0.2]}
        color="#ff9d54"
        distance={15}
        decay={1.45}
        intensity={8}
      />
    </>
  );
}

// ---- light in the air ------------------------------------------------------------

/** Soft-edged cone from the window, brightest where it's looked through most thickly. */
function LightBeam({ controller }) {
  const meshRef = useRef(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uStrength: { value: 0.1 } }), []);
  const placed = useMemo(() => {
    const from = new THREE.Vector3(...WINDOW_POSITION);
    const to = new THREE.Vector3(...WINDOW_TARGET);
    const axis = to.clone().sub(from);
    const length = axis.length();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), axis.clone().normalize());
    return { middle: from.clone().add(to).multiplyScalar(0.5), length, quaternion };
  }, []);

  useFrame((_, delta) => {
    uniforms.uTime.value += Math.min(delta, 0.1);
    // A faint haze over an open book, and no more: it would lift the blacks in a photograph.
    uniforms.uStrength.value = 0.012 + controller.pose.closed ** 2 * 0.3;
  });

  return (
    <mesh ref={meshRef} position={placed.middle} quaternion={placed.quaternion} renderOrder={3} frustumCulled={false}>
      <cylinderGeometry args={[1.0, 4.1, placed.length, 48, 1, true]} />
      <shaderMaterial
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
        vertexShader={/* glsl */ `
          varying vec3 vNormal;
          varying vec3 vView;
          varying vec2 vUv;
          varying float vHeight;
          void main() {
            vUv = uv;
            vHeight = (modelMatrix * vec4(position, 1.0)).z;
            vNormal = normalize(normalMatrix * normal);
            vec4 view = modelViewMatrix * vec4(position, 1.0);
            vView = normalize(-view.xyz);
            gl_Position = projectionMatrix * view;
          }
        `}
        fragmentShader={/* glsl */ `
          varying vec3 vNormal;
          varying vec3 vView;
          varying vec2 vUv;
          varying float vHeight;
          uniform float uTime;
          uniform float uStrength;
          void main() {
            float thick = pow(abs(dot(normalize(vNormal), normalize(vView))), 2.6);
            // Gone before it reaches the desk, where the cone's cut edge would show as a hard line.
            float along = smoothstep(0.6, 4.2, vHeight) * smoothstep(0.0, 0.45, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
            float drift = 0.82 + 0.18 * sin(vUv.x * 21.0 + uTime * 0.17) * sin(vUv.y * 9.0 - uTime * 0.11);
            gl_FragColor = vec4(vec3(1.0, 0.72, 0.42) * thick * along * drift * uStrength, 1.0);
          }
        `}
      />
    </mesh>
  );
}

// ---- window light ----------------------------------------------------------------

/** What a window throws across a room: panes of light, softened by distance. */
function windowPaneTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.filter = 'blur(5px)';
  ctx.fillStyle = '#fff';
  const margin = size * 0.1;
  const bar = size * 0.05;
  const cols = 3;
  const rows = 4;
  const cellW = (size - margin * 2 - bar * (cols - 1)) / cols;
  const cellH = (size - margin * 2 - bar * (rows - 1)) / rows;
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      ctx.fillRect(margin + c * (cellW + bar), margin + r * (cellH + bar), cellW, cellH);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Daylight through a window, laid across a closed book. It fades away as the book opens:
 * bars of shadow across someone's photograph would be a real intrusion. Three.js needs a
 * shadow map for a light with a pattern, which is why only the highest level has this.
 */
export function WindowLight({ controller, shadowSize }) {
  const lightRef = useRef(null);
  const targetRef = useRef(null);
  const texture = useMemo(windowPaneTexture, []);
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => {
    if (lightRef.current && targetRef.current) lightRef.current.target = targetRef.current;
  }, []);
  useFrame(() => {
    if (lightRef.current) lightRef.current.intensity = controller.pose.closed ** 2 * 4.6;
  });
  return (
    <>
      <object3D ref={targetRef} position={WINDOW_TARGET} />
      <spotLight
        ref={lightRef}
        castShadow
        map={texture}
        position={WINDOW_POSITION}
        angle={0.36}
        penumbra={0.3}
        decay={0}
        intensity={0}
        color="#ffd29c"
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-bias={-0.0006}
        shadow-normalBias={0.012}
        shadow-radius={5}
        shadow-blurSamples={10}
        shadow-camera-near={6}
        shadow-camera-far={40}
      />
    </>
  );
}

// ---- reflections ------------------------------------------------------------------

/**
 * A real room photographed in every direction, seen only as reflections in foil, gilt and
 * brass. Until it loads, or if it can't, the simpler lights in the scene stand in for it.
 */
function RoomReflections({ controller }) {
  const environmentReady = useRef(false);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    let cancelled = false;
    let target = null;
    let generator = null;
    const previous = { environment: null, restored: false };
    new HDRLoader().load(
      '/scene/hdri/room.hdr',
      (equirect) => {
        if (cancelled) {
          equirect.dispose();
          return;
        }
        equirect.mapping = THREE.EquirectangularReflectionMapping;
        generator = new THREE.PMREMGenerator(gl);
        target = generator.fromEquirectangular(equirect);
        equirect.dispose();
        previous.environment = scene.environment;
        scene.environment = target.texture;
        // The photograph's up is Y, and this scene's is Z.
        scene.environmentRotation.set(Math.PI / 2, 0, 0);
        environmentReady.current = true;
        previous.restored = true;
        invalidate();
      },
      undefined,
      () => {},
    );
    return () => {
      cancelled = true;
      if (previous.restored) {
        scene.environment = previous.environment;
        scene.environmentRotation.set(0, 0, 0);
        scene.environmentIntensity = 1;
      }
      target?.dispose();
      generator?.dispose();
    };
  }, [gl, scene, invalidate]);

  // The reflected room is warm, which suits leather and gilt but would tint photographs.
  // So it's kept low over open pages, and the neutral lamp does the work there.
  useFrame(() => {
    if (environmentReady.current) scene.environmentIntensity = 0.14 + controller.pose.closed * 0.28;
  });
  return null;
}

export default function Room({ controller, settings }) {
  const props = settings.props === 'all' ? PROPS : PROPS.filter((p) => p.few);
  return (
    <>
      <Desk />
      <BackWall />
      <RoomReflections controller={controller} />
      {props.map((prop) => (
        <Prop key={prop.file} {...prop} post={settings.post} />
      ))}
      <OilLampFlame controller={controller} spot={LAMP_SPOT} size={LAMP_SIZE} />
      <Candelabra at={CANDELABRA_SPOT} size={2.1} turn={0.2} />
      <LightBeam controller={controller} />
    </>
  );
}
