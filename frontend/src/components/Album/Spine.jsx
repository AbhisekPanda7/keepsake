'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { buildSpineTextures, coverEdgeTextures, surfaceMaterial } from '@/lib/album/proceduralTextures';
import { SPINE_BANDS, coverArtReady } from '@/lib/album/surfaces';

const ACROSS = 18;
const ALONG = 96;
/** How far the middle of a closed spine rounds outward. */
const ROUNDING = 0.075;
const BAND_HEIGHT = 0.024;
const BAND_WIDTH = 0.022;

/**
 * Length runs along x from -0.5 to 0.5 and is stretched each frame, since the spine's
 * width changes as a book opens. Height and depth are in world units. +z faces outward.
 * The outer face is rounded across its width, with raised bands around it.
 */
function spineGeometry(height, thickness) {
  const positions = [];
  const uvs = [];
  const index = [];
  const columns = ACROSS + 1;
  const rows = ALONG + 1;
  for (let j = 0; j < rows; j += 1) {
    const v = j / ALONG;
    const y = (v - 0.5) * height;
    let band = 0;
    for (const at of SPINE_BANDS) {
      const d = Math.abs(y - (at - 0.5) * height) / BAND_WIDTH;
      band = Math.max(band, Math.exp(-d * d));
    }
    for (let i = 0; i < columns; i += 1) {
      const u = i / ACROSS;
      const across = 2 * u - 1;
      const dome = Math.sqrt(Math.max(0, 1 - across * across));
      positions.push(u - 0.5, y, thickness / 2 + dome * (ROUNDING + band * BAND_HEIGHT));
      uvs.push(u, v);
    }
  }
  for (let j = 0; j < ALONG; j += 1) {
    for (let i = 0; i < ACROSS; i += 1) {
      const a = j * columns + i;
      const b = a + 1;
      const c = a + columns + 1;
      const d = a + columns;
      index.push(a, b, c, a, c, d);
    }
  }

  // Head and foot caps, closing the curve down to the flat inner face.
  const cap = (j, flip) => {
    const start = positions.length / 3;
    for (let i = 0; i < columns; i += 1) {
      const p = (j * columns + i) * 3;
      positions.push(positions[p], positions[p + 1], positions[p + 2]);
      uvs.push(i / ACROSS, j === 0 ? 0 : 1);
      positions.push(positions[p], positions[p + 1], -thickness / 2);
      uvs.push(i / ACROSS, j === 0 ? 0 : 1);
    }
    for (let i = 0; i < ACROSS; i += 1) {
      const a = start + i * 2;
      if (flip) index.push(a, a + 1, a + 3, a, a + 3, a + 2);
      else index.push(a, a + 3, a + 1, a, a + 2, a + 3);
    }
  };
  cap(0, true);
  cap(ALONG, false);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The spine joining the two covers. Its ends follow the cover hinges, so it stands upright
 * on a closed book and lies flat beneath the pages of an open one.
 */
export default function Spine({ controller, layout, theme, title }) {
  const meshRef = useRef(null);
  const invalidate = useThree((s) => s.invalidate);
  const geometry = useMemo(() => spineGeometry(layout.boardHeight - 0.01, layout.boardT), [layout.boardHeight, layout.boardT]);
  const material = useMemo(() => {
    const { map, normalMap } = coverEdgeTextures(theme);
    return surfaceMaterial({ map, normalMap, roughness: theme.materialInfo.roughness, metalness: 0 });
  }, [theme]);

  const [art, setArt] = useState(null);
  useEffect(() => {
    let cancelled = false;
    let built = null;
    coverArtReady().then(() => {
      if (cancelled) return;
      built = buildSpineTextures({ title, theme });
      setArt(built);
      invalidate();
    });
    return () => {
      cancelled = true;
      built?.map.dispose();
      built?.surfaceMap.dispose();
    };
  }, [title, theme, invalidate]);

  const artMaterial = useMemo(() => {
    if (!art) return null;
    return surfaceMaterial({
      map: art.map,
      normalMap: coverEdgeTextures(theme).normalMap,
      roughnessMap: art.surfaceMap,
      metalnessMap: art.surfaceMap,
      roughness: 1,
      metalness: 1,
    });
  }, [art, theme]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => artMaterial?.dispose(), [artMaterial]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const { spine } = controller.pose;
    mesh.position.set(spine.x, 0, spine.z);
    mesh.rotation.y = -spine.angle;
    mesh.scale.x = spine.length;
  });

  return <mesh ref={meshRef} geometry={geometry} material={artMaterial ?? material} castShadow receiveShadow />;
}
