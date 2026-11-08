'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { buildCoverTextures, coverEdgeTextures, endpaperTexture, liningTexture, surfaceMaterial } from '@/lib/album/proceduralTextures';
import { noteCoverDrawn } from '@/lib/ambient/cinema';
import { coverArtReady } from '@/lib/album/surfaces';

const CORNER_RADIUS = 0.055;
const BEVEL = 0.007;
const FACE_LIFT = 0.0012;

/** Board outline, hinge along x = 0, with its two free corners rounded. */
function boardShape(length, height, inset = 0) {
  const r = Math.max(0.005, CORNER_RADIUS - inset);
  const x0 = inset;
  const x1 = length - inset;
  const y0 = -height / 2 + inset;
  const y1 = height / 2 - inset;
  const shape = new THREE.Shape();
  shape.moveTo(x0, y0);
  shape.lineTo(x1 - r, y0);
  shape.quadraticCurveTo(x1, y0, x1, y0 + r);
  shape.lineTo(x1, y1 - r);
  shape.quadraticCurveTo(x1, y1, x1 - r, y1);
  shape.lineTo(x0, y1);
  shape.closePath();
  return shape;
}

/**
 * Flat decorative face. `facing` +1 looks along local +z, -1 along local -z.
 * A face on -z is read from the other side, so its U runs backward to stay unmirrored.
 */
function faceGeometry(length, height, z, facing, inset) {
  const geometry = new THREE.ShapeGeometry(boardShape(length, height, inset), 8);
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const normal = geometry.attributes.normal;
  for (let i = 0; i < pos.count; i += 1) {
    const u = pos.getX(i) / length;
    uv.setXY(i, facing > 0 ? u : 1 - u, pos.getY(i) / height + 0.5);
    pos.setZ(i, z);
    normal.setXYZ(i, 0, 0, facing);
  }
  if (facing < 0) {
    const index = geometry.index.array;
    for (let i = 0; i < index.length; i += 3) {
      const swap = index[i + 1];
      index[i + 1] = index[i + 2];
      index[i + 2] = swap;
    }
  }
  return geometry;
}

const CORNER_SIZE = 0.3;
const CORNER_PROUD = 0.007;

/**
 * Metal protector over a free corner of the board. The long edge curves inward, as on a
 * hand-made album. `sign` picks the head (+1) or foot (-1) corner.
 */
function cornerGeometry(length, height, thickness, sign) {
  const r = CORNER_RADIUS + CORNER_PROUD;
  const x1 = length + CORNER_PROUD;
  const y1 = height / 2 + CORNER_PROUD;
  const s = CORNER_SIZE;
  const shape = new THREE.Shape();
  shape.moveTo(x1 - s, y1);
  shape.lineTo(x1 - r, y1);
  shape.quadraticCurveTo(x1, y1, x1, y1 - r);
  shape.lineTo(x1, y1 - s);
  shape.quadraticCurveTo(x1 - s * 0.42, y1 - s * 0.42, x1 - s, y1);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness + CORNER_PROUD * 2 - 0.006,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 2,
    curveSegments: 10,
  });
  geometry.translate(0, 0, -CORNER_PROUD + 0.003);
  if (sign < 0) {
    geometry.scale(1, -1, 1);
    const index = geometry.index;
    if (index) {
      const array = index.array;
      for (let i = 0; i < array.length; i += 3) {
        const swap = array[i + 1];
        array[i + 1] = array[i + 2];
        array[i + 2] = swap;
      }
    } else {
      // Non-indexed: swap whole vertices, keeping every triangle's winding outward.
      for (const name of Object.keys(geometry.attributes)) {
        const attr = geometry.attributes[name];
        const n = attr.itemSize;
        const data = attr.array;
        for (let i = 0; i < data.length; i += n * 3) {
          for (let k = 0; k < n; k += 1) {
            const swap = data[i + n + k];
            data[i + n + k] = data[i + n * 2 + k];
            data[i + n * 2 + k] = swap;
          }
        }
      }
    }
    geometry.computeVertexNormals();
  }
  return geometry;
}

function boardGeometry(length, height, thickness) {
  const geometry = new THREE.ExtrudeGeometry(boardShape(length, height, BEVEL), {
    depth: thickness - BEVEL * 2,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelOffset: 0,
    bevelSegments: 2,
    curveSegments: 8,
  });
  geometry.translate(0, 0, BEVEL);
  // Extrude UVs are in world units, so grain would be stretched without this scale.
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
  return geometry;
}

/**
 * One cover board. Local x runs away from the hinge. Local z = 0 is the inner face
 * for the front board (outer face at +t), while the back board mirrors that with
 * its outer face at -t. coverPose() explains how the hinges move.
 */
export default function Cover({ controller, which, title, layout, theme, coverWidth = 2048 }) {
  const groupRef = useRef(null);
  const invalidate = useThree((s) => s.invalidate);
  const isFront = which === 'front';
  const { boardLength: length, boardHeight: height, boardT: t } = layout;

  const geometries = useMemo(() => {
    const zShift = isFront ? 0 : -t;
    const board = boardGeometry(length, height, t);
    board.translate(0, 0, zShift);
    const outer = isFront
      ? faceGeometry(length, height, t + FACE_LIFT, 1, 0.004)
      : faceGeometry(length, height, -t - FACE_LIFT, -1, 0.004);
    const inner = isFront
      ? faceGeometry(length, height, -FACE_LIFT, -1, 0.05)
      : faceGeometry(length, height, FACE_LIFT, 1, 0.05);
    const cornerHead = cornerGeometry(length, height, t, 1);
    const cornerFoot = cornerGeometry(length, height, t, -1);
    cornerHead.translate(0, 0, zShift);
    cornerFoot.translate(0, 0, zShift);
    return { board, outer, inner, cornerHead, cornerFoot };
  }, [isFront, length, height, t]);

  useEffect(
    () => () => {
      Object.values(geometries).forEach((g) => g.dispose());
    },
    [geometries],
  );

  const boardMaterial = useMemo(() => {
    const { map, normalMap } = coverEdgeTextures(theme);
    return surfaceMaterial({ map, normalMap, roughness: theme.materialInfo.roughness, metalness: 0 });
  }, [theme]);
  const innerMaterial = useMemo(
    () => surfaceMaterial({ map: endpaperTexture(theme.colourInfo), roughness: 0.88, metalness: 0 }),
    [theme],
  );
  const outerMaterial = useMemo(
    () => surfaceMaterial({ roughness: 1, metalness: 1 }),
    [],
  );

  const cornerMaterial = useMemo(
    () => surfaceMaterial({ color: theme.colourInfo.foil, metalness: 1, roughness: 0.42 }),
    [theme],
  );

  // Cover art includes text, so it is drawn only once the web fonts have arrived.
  const [art, setArt] = useState(null);
  useEffect(() => {
    let cancelled = false;
    let built = null;
    coverArtReady().then(() => {
      if (cancelled) return;
      built = buildCoverTextures({ title: isFront ? title : '', hingeLeft: isFront, theme, width: coverWidth });
      // The gilt lining replaces the plain endpaper once its fonts and leather are in.
      innerMaterial.map = liningTexture(theme, isFront);
      innerMaterial.needsUpdate = true;
      setArt(built);
      invalidate();
    });
    return () => {
      cancelled = true;
      if (built) {
        built.map.dispose();
        built.surfaceMap.dispose();
        built.normalMap.dispose();
      }
    };
  }, [isFront, title, theme, coverWidth, invalidate, innerMaterial]);

  useEffect(() => {
    if (!art) return;
    outerMaterial.map = art.map;
    outerMaterial.roughnessMap = art.surfaceMap;
    outerMaterial.metalnessMap = art.surfaceMap;
    outerMaterial.normalMap = art.normalMap;
    outerMaterial.needsUpdate = true;
    noteCoverDrawn();
    invalidate();
  }, [art, outerMaterial, invalidate]);

  useEffect(
    () => () => {
      boardMaterial.dispose();
      innerMaterial.dispose();
      outerMaterial.dispose();
      cornerMaterial.dispose();
    },
    [boardMaterial, innerMaterial, outerMaterial, cornerMaterial],
  );

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const { pose } = controller;
    if (isFront) {
      group.position.set(pose.frontX, 0, pose.frontZ);
      group.rotation.y = -pose.frontAngle; // +y rotation sends +x toward -z
    } else {
      group.position.set(pose.backX, 0, pose.backZ);
      group.rotation.y = -pose.backAngle;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh geometry={geometries.board} material={boardMaterial} castShadow receiveShadow />
      <mesh geometry={geometries.outer} material={art ? outerMaterial : boardMaterial} receiveShadow />
      <mesh geometry={geometries.inner} material={innerMaterial} receiveShadow />
      <mesh geometry={geometries.cornerHead} material={cornerMaterial} castShadow receiveShadow />
      <mesh geometry={geometries.cornerFoot} material={cornerMaterial} castShadow receiveShadow />
    </group>
  );
}
