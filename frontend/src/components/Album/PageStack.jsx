'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PAGE_HEIGHT, SEGMENTS_U } from '@/lib/album/bookModel';
import { stackProfile } from '@/lib/album/leafDeform';
import { pageEdgeTexture, surfaceMaterial } from '@/lib/album/proceduralTextures';

const profileX = new Float64Array(SEGMENTS_U + 1);
const profileZ = new Float64Array(SEGMENTS_U + 1);

/** Hairlines per unit of height in the edge texture's repeat. */
const EDGE_LINES_PER_UNIT = 8;
const GILT = '#d8ae62';
/** The board only overhangs the pages by slightly more than this. */
const MAX_FAN = 0.058;

/**
 * One solid block standing in for every sheet not currently drawn as its own mesh
 * on one side of the book. Its top follows the same gutter curve as the leaves, so
 * the lowest drawn leaf sits right on it. Rebuilt only when its size changes.
 */
export default function PageStack({ controller, side, sheetCount, paper }) {
  const meshRef = useRef(null);
  const material = useMemo(
    () => [
      surfaceMaterial({ color: paper.edge, roughness: 0.96, metalness: 0 }),
      // Gilded edges, burnished smooth: the sheet lines still show through the gold leaf.
      // A little self-light, as gilding seen edge-on would otherwise only ever mirror a dark room.
      surfaceMaterial({
        map: pageEdgeTexture(paper),
        color: GILT,
        metalness: 0.82,
        roughness: 0.44,
        emissive: GILT,
        emissiveIntensity: 0.16,
      }),
    ],
    [paper],
  );
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    // top (2 rows) + head + tail (2 rows each) + fore-edge (4 verts)
    const count = (SEGMENTS_U + 1) * 6 + 4;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    const index = [];
    const quad = (a, b, c, d) => {
      if (side > 0) index.push(a, b, c, a, c, d);
      else index.push(a, c, b, a, d, c); // mirrored in x, so the winding flips
    };
    const n = SEGMENTS_U + 1;
    for (let j = 0; j < SEGMENTS_U; j += 1) {
      quad(j, j + 1, n + j + 1, n + j); // top surface
    }
    const topCount = index.length;
    const head = n * 2;
    const tail = n * 4;
    for (let j = 0; j < SEGMENTS_U; j += 1) {
      quad(head + j + 1, head + j, head + n + j, head + n + j + 1); // head faces +y
      quad(tail + j, tail + j + 1, tail + n + j + 1, tail + n + j); // tail faces -y
    }
    const fore = n * 6;
    quad(fore, fore + 1, fore + 2, fore + 3);
    g.setIndex(index);
    g.addGroup(0, topCount, 0);
    g.addGroup(topCount, index.length - topCount, 1);
    return g;
  }, [side]);

  const seen = useRef({ version: -1, sheetCount: -1 });

  useEffect(
    () => () => {
      geometry.dispose();
      material.forEach((m) => m.dispose());
    },
    [geometry, material],
  );

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (seen.current.version === controller.poseVersion && seen.current.sheetCount === sheetCount) return;
    seen.current = { version: controller.poseVersion, sheetCount };

    mesh.visible = sheetCount > 0;
    if (sheetCount <= 0) return;

    const { layout, pose } = controller;
    const bottomZ = layout.boardT;
    const topZ = bottomZ + sheetCount * layout.thick;
    stackProfile(layout, topZ - pose.hingeZ, pose.hingeZ, profileX, profileZ);

    const pos = geometry.attributes.position.array;
    const uv = geometry.attributes.uv.array;
    const n = SEGMENTS_U + 1;
    const set = (i, x, y, z, u, v) => {
      pos[i * 3] = x * side;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      uv[i * 2] = u;
      uv[i * 2 + 1] = v;
    };
    const halfH = PAGE_HEIGHT / 2;
    for (let j = 0; j < n; j += 1) {
      const x = profileX[j];
      const z = profileZ[j];
      const low = Math.min(bottomZ, z);
      const edgeV = (z - bottomZ) * EDGE_LINES_PER_UNIT;
      set(j, x, -halfH, z, 0, 0);
      set(n + j, x, halfH, z, 0, 0);
      set(n * 2 + j, x, halfH, z, 0, edgeV);
      set(n * 3 + j, x, halfH, low, 0, 0);
      set(n * 4 + j, x, -halfH, low, 0, 0);
      set(n * 5 + j, x, -halfH, z, 0, edgeV);
    }
    const endX = profileX[SEGMENTS_U];
    const endZ = profileZ[SEGMENTS_U];
    const foreV = (endZ - bottomZ) * EDGE_LINES_PER_UNIT;
    const fore = n * 6;
    // An open book's pages fan out under their own weight, each sheet lying a little beyond
    // the one above, so their edges show as layers from above. A shut book's are square.
    const fan = Math.min(MAX_FAN, 0.032 + (topZ - bottomZ) * 0.3) * (1 - pose.closed);
    set(fore, endX + fan, -halfH, bottomZ, 0, 0);
    set(fore + 1, endX + fan, halfH, bottomZ, 3, 0);
    set(fore + 2, endX, halfH, endZ, 3, foreV);
    set(fore + 3, endX, -halfH, endZ, 0, foreV);

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.uv.needsUpdate = true;
    geometry.computeVertexNormals();
  });

  return <mesh ref={meshRef} geometry={geometry} material={material} castShadow frustumCulled={false} />;
}
