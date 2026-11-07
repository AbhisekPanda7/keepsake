'use client';

import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { LAMP_POSITION, SEGMENTS_U, SEGMENTS_V } from '@/lib/album/bookModel';
import { LEAF_COLUMNS, LEAF_ROWS, LEAF_VERTEX_COUNT, writeLeaf } from '@/lib/album/leafDeform';
import { paperBumpTexture, plainPaperTexture, plainRoughnessTexture, surfaceMaterial } from '@/lib/album/proceduralTextures';

/** Toward the lamp, in view space, which matches world space for this straight-on camera. */
const PAPER_LIGHT_DIR = new THREE.Vector3(...LAMP_POSITION).normalize();

/** Index and UV data never change between leaves, so one copy of the arrays is kept. */
let sharedTopology = null;

function leafTopology() {
  if (sharedTopology) return sharedTopology;
  const grid = LEAF_COLUMNS * LEAF_ROWS;
  const uvs = new Float32Array(LEAF_VERTEX_COUNT * 2);
  const front = [];
  const back = [];
  const edge = [];

  for (let k = 0; k < LEAF_ROWS; k += 1) {
    for (let j = 0; j < LEAF_COLUMNS; j += 1) {
      const i = k * LEAF_COLUMNS + j;
      const u = j / SEGMENTS_U;
      const v = k / SEGMENTS_V;
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
      // The back is read from the other side of the sheet, so its art runs the other
      // way. Left of the canvas is the fore-edge, and on a left page that's screen-left.
      uvs[(grid + i) * 2] = 1 - u;
      uvs[(grid + i) * 2 + 1] = v;
      if (j < SEGMENTS_U && k < SEGMENTS_V) {
        const a = i;
        const b = i + 1;
        const c = i + LEAF_COLUMNS + 1;
        const d = i + LEAF_COLUMNS;
        front.push(a, b, c, a, c, d);
        back.push(grid + a, grid + c, grid + b, grid + a, grid + d, grid + c);
      }
    }
  }

  // Edge strips hold pairs of (front, back) vertices, written in leafDeform.writeLeaf.
  const outerStart = grid * 2;
  for (let k = 0; k < SEGMENTS_V; k += 1) {
    const f0 = outerStart + k * 2;
    const b0 = f0 + 1;
    const f1 = f0 + 2;
    const b1 = f0 + 3;
    edge.push(f0, b0, f1, b0, b1, f1);
  }
  const headStart = outerStart + LEAF_ROWS * 2;
  const tailStart = headStart + LEAF_COLUMNS * 2;
  for (let j = 0; j < SEGMENTS_U; j += 1) {
    const f0 = headStart + j * 2;
    const b0 = f0 + 1;
    const f1 = f0 + 2;
    const b1 = f0 + 3;
    edge.push(f0, f1, b0, f1, b1, b0);
    const tf0 = tailStart + j * 2;
    const tb0 = tf0 + 1;
    const tf1 = tf0 + 2;
    const tb1 = tf0 + 3;
    edge.push(tf0, tb0, tf1, tf1, tb0, tb1);
  }

  sharedTopology = {
    indices: new Uint16Array([...front, ...back, ...edge]),
    uvs,
    frontCount: front.length,
    backCount: back.length,
    edgeCount: edge.length,
  };
  return sharedTopology;
}

function createLeafGeometry() {
  const topology = leafTopology();
  const geometry = new THREE.BufferGeometry();
  // Each geometry gets its own attribute objects over the shared arrays: disposing a
  // geometry frees its attributes' GL buffers, which must not affect other leaves.
  geometry.setIndex(new THREE.BufferAttribute(topology.indices, 1));
  geometry.setAttribute('uv', new THREE.BufferAttribute(topology.uvs, 2));
  const position = new THREE.BufferAttribute(new Float32Array(LEAF_VERTEX_COUNT * 3), 3);
  const normal = new THREE.BufferAttribute(new Float32Array(LEAF_VERTEX_COUNT * 3), 3);
  position.setUsage(THREE.DynamicDrawUsage);
  normal.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.setAttribute('normal', normal);
  geometry.addGroup(0, topology.frontCount, 0);
  geometry.addGroup(topology.frontCount, topology.backCount, 1);
  geometry.addGroup(topology.frontCount + topology.backCount, topology.edgeCount, 2);
  return geometry;
}

/**
 * Paper is standard PBR plus the two things PBR leaves out for a thin sheet.
 *
 * Translucency: light striking the far side of a sheet comes through it, warmed by
 * the fibres, along with a ghost of whatever is printed there. The far side's art is
 * sampled with U mirrored, since it is seen through the sheet from behind. Lying flat
 * only a trace shows; lifted against the lamp it shows clearly.
 *
 * Occlusion: a nearby turning sheet shuts out room light, as a shadow map can't,
 * because that light comes from everywhere rather than from one lamp. The darkening
 * is strongest at the spine, where the gap between the sheets is narrowest.
 */
function createPaperMaterial(spineU, paper) {
  const material = new THREE.MeshStandardMaterial({
    map: plainPaperTexture(paper),
    roughnessMap: plainRoughnessTexture(),
    roughness: 1,
    metalness: 0,
    bumpMap: paperBumpTexture(),
    bumpScale: 0.2,
    envMapIntensity: 0.5,
  });
  const uniforms = {
    uFarSide: { value: plainPaperTexture(paper) },
    uPaperTone: { value: new THREE.Vector3(...paper.linear) },
    uOcclusion: { value: 0 },
    uOcclusionReach: { value: 1 },
    uSpineU: { value: spineU },
    uLightDir: { value: PAPER_LIGHT_DIR },
  };
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uFarSide;
         uniform vec3 uPaperTone;
         uniform float uOcclusion;
         uniform float uOcclusionReach;
         uniform float uSpineU;
         uniform vec3 uLightDir;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
         {
           float fromSpine = abs(vMapUv.x - uSpineU);
           float shut = 1.0 - uOcclusion * (1.0 - smoothstep(0.0, uOcclusionReach, fromSpine));
           reflectedLight.indirectDiffuse *= shut;
           reflectedLight.directDiffuse *= mix(1.0, shut, 0.65);

           vec3 farSide = texture2D(uFarSide, vec2(1.0 - vMapUv.x, vMapUv.y)).rgb;
           vec3 inkThrough = min(farSide / uPaperTone, vec3(1.0));
           float behind = clamp(-dot(normal, uLightDir), 0.0, 1.0);
           float thin = smoothstep(0.0, 0.55, behind);

           reflectedLight.directDiffuse *= mix(vec3(1.0), inkThrough, 0.045);
           reflectedLight.directDiffuse += material.diffuseColor
             * mix(vec3(1.0), inkThrough, 0.75)
             * vec3(1.0, 0.86, 0.66) * thin * 0.95;
         }`,
      );
  };
  // All paper shares one compiled program; its differences are only uniform values.
  material.customProgramCacheKey = () => 'album-paper-v1';
  return material;
}

const edgeMaterials = new Map();
function edgeMaterial(paper) {
  if (!edgeMaterials.has(paper.edge)) {
    edgeMaterials.set(paper.edge, surfaceMaterial({ color: paper.edge, roughness: 0.95, metalness: 0 }));
  }
  return edgeMaterials.get(paper.edge);
}

/**
 * Shows a page's artwork on a material as soon as it is ready, and gives it to the
 * material on the sheet's other face, which shows it faintly through the paper.
 */
function usePageArtwork(textures, desc, material, farSideMaterial, invalidate) {
  useEffect(() => {
    if (!desc) return undefined;
    return textures.acquire(desc, ({ map, roughnessMap }) => {
      material.map = map;
      material.roughnessMap = roughnessMap;
      farSideMaterial.userData.uniforms.uFarSide.value = map;
      invalidate();
    });
    // Identity of the artwork is its key; other fields follow from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textures, desc?.key, material, farSideMaterial, invalidate]);
}

function applyOcclusion(material, occlusion) {
  const { uOcclusion, uOcclusionReach } = material.userData.uniforms;
  uOcclusion.value = occlusion ? occlusion.amount : 0;
  if (occlusion) uOcclusionReach.value = occlusion.reach;
}

/**
 * One sheet of paper. The mesh is a deformable grid whose vertices are rewritten
 * only on frames where this leaf's shape changed, so resting pages cost nothing
 * once placed.
 */
const Page = memo(function Page({ leaf, controller, frontDesc, backDesc, textures, paper }) {
  const meshRef = useRef(null);
  const invalidate = useThree((s) => s.invalidate);
  const geometry = useMemo(createLeafGeometry, []);
  // U runs from the spine on the front face, and toward the spine on the back face.
  const frontMaterial = useMemo(() => createPaperMaterial(0, paper), [paper]);
  const backMaterial = useMemo(() => createPaperMaterial(1, paper), [paper]);
  const materials = useMemo(() => [frontMaterial, backMaterial, edgeMaterial(paper)], [frontMaterial, backMaterial, paper]);
  const last = useRef({ t: -1, curl: 0, skew: 0, shear: 0, version: 0 });

  useEffect(
    () => () => {
      geometry.dispose();
      frontMaterial.dispose();
      backMaterial.dispose();
    },
    [geometry, frontMaterial, backMaterial],
  );

  usePageArtwork(textures, frontDesc, frontMaterial, backMaterial, invalidate);
  usePageArtwork(textures, backDesc, backMaterial, frontMaterial, invalidate);

  useFrame(() => {
    const state = controller.leafState(leaf);

    // Each face can only be darkened by the sheet that would come to rest on top of it.
    applyOcclusion(frontMaterial, state.t === 0 ? controller.occlusionFrom(leaf - 1, 0) : null);
    applyOcclusion(backMaterial, state.t === 1 ? controller.occlusionFrom(leaf + 1, 1) : null);

    const seen = last.current;
    if (
      seen.t === state.t &&
      seen.curl === state.curl &&
      seen.skew === state.skew &&
      seen.shear === state.shear &&
      seen.version === controller.poseVersion
    ) {
      return;
    }
    seen.t = state.t;
    seen.curl = state.curl;
    seen.skew = state.skew;
    seen.shear = state.shear;
    seen.version = controller.poseVersion;

    const { position, normal } = geometry.attributes;
    writeLeaf(position.array, normal.array, controller.layout, leaf, controller.pose.hingeZ, state);
    position.needsUpdate = true;
    normal.needsUpdate = true;
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={materials}
      castShadow
      receiveShadow
      // Bounds would have to be recomputed every frame of a turn, and at most a
      // handful of leaves exist at a time, so culling them would gain nothing.
      frustumCulled={false}
    />
  );
});

export default Page;
