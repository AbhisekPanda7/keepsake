'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PAGE_HEIGHT } from '@/lib/album/bookModel';
import { surfaceMaterial } from '@/lib/album/proceduralTextures';

const WIDTH = 0.075;
const SEGMENTS = 28;
/** How far the tail hangs out below the pages. */
const TAIL = 0.34;

/**
 * Silk ribbon bookmark, bound in at the head of the spine. It lies along the gutter
 * and hangs out past the foot of the book, with a slight wander and a cut swallow-tail.
 * It is on the book's centre line, so it never crosses a photograph.
 */
function ribbonGeometry() {
  const rows = SEGMENTS + 1;
  const positions = new Float32Array(rows * 2 * 3 + 3);
  const uvs = new Float32Array(rows * 2 * 2 + 2);
  const top = PAGE_HEIGHT / 2;
  const length = PAGE_HEIGHT + TAIL;
  const index = [];

  for (let i = 0; i < rows; i += 1) {
    const k = i / SEGMENTS;
    const y = top - k * length;
    // Lies nearly straight along the gutter, then drifts once past the page's foot.
    const past = Math.max(0, (k * length - PAGE_HEIGHT) / TAIL);
    // Silk never lies quite straight, so it wanders a little either side of the gutter.
    const x = 0.018 * Math.sin(k * 5 + 0.6) + 0.008 * Math.sin(k * 13) + 0.11 * past * past;
    const twist = 0.25 * past;
    const half = (WIDTH / 2) * Math.cos(twist);
    const lift = Math.sin(twist) * (WIDTH / 2);
    positions.set([x - half, y, 0.012 * Math.sin(k * 11 + 1) - lift], i * 6);
    positions.set([x + half, y, 0.012 * Math.sin(k * 11 + 1) + lift], i * 6 + 3);
    uvs.set([0, k * length * 14], i * 4);
    uvs.set([1, k * length * 14], i * 4 + 2);
    if (i < SEGMENTS) {
      const a = i * 2;
      index.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  // The swallow-tail: the middle of the last row is drawn back up.
  const last = SEGMENTS * 2;
  const notch = rows * 2;
  const lastY = top - length;
  const lastX = (positions[last * 3] + positions[(last + 1) * 3]) / 2;
  positions.set([lastX, lastY + WIDTH * 0.75, 0], notch * 3);
  uvs.set([0.5, length * 14], notch * 2);
  // Replaces the last strip's simple end with two points.
  index.length -= 6;
  const prev = last - 2;
  index.push(prev, prev + 1, notch, prev, notch, last, prev + 1, last + 1, notch);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

export default function Ribbon({ controller, colour }) {
  const ref = useRef(null);
  const geometry = useMemo(ribbonGeometry, []);
  const material = useMemo(() => {
    // Both sides: the strip's triangles face into the book, so one-sided it was never seen.
    const silk = surfaceMaterial({ color: colour, roughness: 0.46, metalness: 0 });
    silk.side = THREE.DoubleSide;
    return silk;
  }, [colour]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(() => {
    if (!ref.current) return;
    const { pose, layout } = controller;
    // Rests above whichever sheets meet at the gutter. When shut it is inside the book,
    // and only the tail shows below the covers.
    // It's drawn in from the spine as the book shuts, so that it can't show past the rounded back.
    ref.current.position.x = pose.closed * 0.1;
    ref.current.position.z = pose.hingeZ + layout.thick + 0.022 - pose.closed * 0.05;
  });

  return <mesh ref={ref} geometry={geometry} material={material} castShadow receiveShadow frustumCulled={false} />;
}
