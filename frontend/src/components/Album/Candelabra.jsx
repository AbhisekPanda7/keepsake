'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { surfaceMaterial } from '@/lib/album/proceduralTextures';
import { cinema } from '@/lib/ambient/cinema';
import { prefersReducedMotion } from '@/lib/ambient/pointerField';
import { FLAME_FRAGMENT, FLAME_VERTEX } from './flame';

/**
 * A cast-brass candelabra on the desk: a turned foot and stem, four arms that sweep out and
 * curl up into candle cups, a fifth candle on top, and a scroll under each arm. It's drawn
 * from simple shapes rather than downloaded, and built standing up (Y up) like the models,
 * then turned to stand on the Z-up desk. One unit is about 8 cm.
 */

const ARM_TURNS = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
const STEM_TOP = 1.62;
const ARM_FROM = 1.12;
const ARM_REACH = 0.62;
const CUP_HEIGHT = 1.38;
const SIDE_CANDLE = 0.48;
const CENTRE_CANDLE = 0.6;

/** The profile of the turned foot and stem, as radius against height. */
const STEM_PROFILE = [
  [0, 0], [0.44, 0], [0.46, 0.035], [0.4, 0.075], [0.24, 0.13], [0.14, 0.22], [0.09, 0.36],
  [0.14, 0.43], [0.15, 0.47], [0.09, 0.53], [0.065, 0.8], [0.07, 1.04], [0.12, 1.1], [0.13, 1.15],
  [0.075, 1.21], [0.06, 1.45], [0.1, 1.52], [0.075, 1.58], [0, STEM_TOP],
];

function lathe(profile, segments = 40) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

/** A point at radius `r` along the arm turned by `turn`, at height `y`. */
const radial = (turn, r, y) => new THREE.Vector3(Math.cos(turn) * r, y, Math.sin(turn) * r);

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildParts() {
  const brass = [];
  const wax = [];
  const wicks = [];
  const flames = [];
  const random = seeded(11);

  brass.push(lathe(STEM_PROFILE));

  // A cup with a drip pan, then a candle with a few runs of wax down its side.
  const candleAt = (x, y, z, height) => {
    const pan = lathe([[0, 0], [0.06, 0], [0.15, 0.025], [0.17, 0.055], [0.15, 0.06], [0.07, 0.04], [0, 0.04]], 28);
    pan.translate(x, y, z);
    const socket = lathe([[0, 0], [0.055, 0], [0.08, 0.06], [0.085, 0.13], [0.075, 0.14], [0, 0.14]], 24);
    socket.translate(x, y + 0.03, z);
    brass.push(pan, socket);

    const base = y + 0.15;
    const candle = new THREE.CylinderGeometry(0.062, 0.066, height, 20);
    candle.translate(x, base + height / 2, z);
    wax.push(candle);
    for (let i = 0; i < 3; i += 1) {
      const a = random() * Math.PI * 2;
      const length = 0.08 + random() * 0.16;
      const drip = new THREE.CapsuleGeometry(0.014, length, 4, 8);
      drip.translate(x + Math.cos(a) * 0.064, base + height - length / 2 - 0.02, z + Math.sin(a) * 0.064);
      wax.push(drip);
    }
    const wick = new THREE.CylinderGeometry(0.008, 0.008, 0.05, 6);
    wick.translate(x, base + height + 0.02, z);
    wicks.push(wick);
    flames.push(new THREE.Vector3(x, base + height + 0.15, z));
  };

  for (const turn of ARM_TURNS) {
    // The arm: out from the stem, dipping, then rising into its cup.
    const arm = new THREE.CubicBezierCurve3(
      radial(turn, 0.05, ARM_FROM),
      radial(turn, 0.34, ARM_FROM - 0.2),
      radial(turn, ARM_REACH + 0.06, ARM_FROM - 0.08),
      radial(turn, ARM_REACH, CUP_HEIGHT),
    );
    brass.push(new THREE.TubeGeometry(arm, 32, 0.034, 10, false));
    // A scroll beneath it, ending in a curl, like the cast leaves on a sconce.
    const scroll = new THREE.CubicBezierCurve3(
      radial(turn, 0.06, ARM_FROM - 0.32),
      radial(turn, 0.3, ARM_FROM - 0.36),
      radial(turn, 0.36, ARM_FROM - 0.06),
      radial(turn, 0.24, ARM_FROM - 0.12),
    );
    brass.push(new THREE.TubeGeometry(scroll, 24, 0.018, 8, false));
    // A small cast leaf where the arm leaves the stem.
    const leaf = new THREE.SphereGeometry(0.07, 12, 8);
    leaf.scale(1.6, 0.45, 0.7);
    leaf.rotateY(-turn);
    const at = radial(turn, 0.14, ARM_FROM - 0.06);
    leaf.translate(at.x, at.y, at.z);
    brass.push(leaf);

    const cup = radial(turn, ARM_REACH, CUP_HEIGHT);
    candleAt(cup.x, cup.y, cup.z, SIDE_CANDLE);
  }
  candleAt(0, STEM_TOP - 0.02, 0, CENTRE_CANDLE);

  return { brass, wax, wicks, flames };
}

/** Joins many small geometries into one, so each material is a single draw. */
function merge(geometries) {
  const parts = geometries.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of parts) count += g.attributes.position.count;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let offset = 0;
  for (const g of parts) {
    position.set(g.attributes.position.array, offset * 3);
    normal.set(g.attributes.normal.array, offset * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, offset * 2);
    offset += g.attributes.position.count;
  }
  geometries.forEach((g) => g.dispose());
  parts.forEach((g) => g.dispose());
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return merged;
}

/**
 * `at` is its place on the desk, `size` its height in scene units. Its candles give a small,
 * even glow, low over the desk, so that nothing flickers across the photographs.
 */
export default function Candelabra({ at, size = 2.6, turn = 0 }) {
  const invalidate = useThree((s) => s.invalidate);
  const [still] = useState(() => prefersReducedMotion());
  const scale = size / (STEM_TOP + CENTRE_CANDLE + 0.3);

  const parts = useMemo(() => {
    const { brass, wax, wicks, flames } = buildParts();
    return { brass: merge(brass), wax: merge(wax), wicks: merge(wicks), flames };
  }, []);
  const materials = useMemo(
    () => ({
      brass: surfaceMaterial({ color: '#b98a3e', metalness: 1, roughness: 0.34 }),
      wax: surfaceMaterial({ color: '#efe3c8', metalness: 0, roughness: 0.5, emissive: '#ffb066', emissiveIntensity: 0.05 }),
      wick: surfaceMaterial({ color: '#2a1d14', metalness: 0, roughness: 0.9 }),
    }),
    [],
  );
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uStrength: { value: 1 } }), []);

  useEffect(() => {
    cinema.shadowsDirty = true;
    invalidate();
    return () => {
      Object.values(parts).forEach((g) => g.dispose?.());
      Object.values(materials).forEach((m) => m.dispose());
    };
  }, [parts, materials, invalidate]);

  const flameRefs = useRef([]);
  const time = useRef(0);
  useFrame(({ camera }, delta) => {
    time.current += still ? 0 : Math.min(delta, 0.1);
    uniforms.uTime.value = time.current;
    for (const flame of flameRefs.current) {
      if (!flame) continue;
      // Turned to face the camera in world space, whatever the candelabra's own turn.
      flame.parent.getWorldQuaternion(flame.quaternion).invert().multiply(camera.quaternion);
    }
  });

  return (
    <group position={[at[0], at[1], 0]} rotation={[0, 0, turn]}>
      <group rotation={[Math.PI / 2, 0, 0]} scale={scale}>
        <mesh geometry={parts.brass} material={materials.brass} castShadow receiveShadow />
        <mesh geometry={parts.wax} material={materials.wax} castShadow receiveShadow />
        <mesh geometry={parts.wicks} material={materials.wick} />
        {parts.flames.map((point, i) => (
          <mesh
            key={i}
            ref={(el) => {
              flameRefs.current[i] = el;
            }}
            position={point}
            renderOrder={7}
          >
            <planeGeometry args={[0.13, 0.3]} />
            <shaderMaterial
              uniforms={uniforms}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              vertexShader={FLAME_VERTEX}
              fragmentShader={FLAME_FRAGMENT}
            />
          </mesh>
        ))}
        <pointLight position={[0, STEM_TOP + CENTRE_CANDLE + 0.3, 0]} color="#ffa25a" distance={5} decay={2} intensity={2.4} />
      </group>
    </group>
  );
}
