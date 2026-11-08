/**
 * GPU textures for the 3D book, made from the canvases in surfaces.js. Each is created
 * once per look and shared, so a hundred pages still use one paper-grain texture.
 */
import * as THREE from 'three';
import {
  bakeNormalMap,
  contactShadowCanvas,
  coverBaseCanvas,
  coverBumpCanvas,
  drawCoverMaps,
  drawSpineMaps,
  endpaperCanvas,
  liningCanvas,
  pageEdgeCanvas,
  paperBumpCanvas,
  paperGrainCanvas,
  paperReady,
  plainRoughnessCanvas,
} from './surfaces.js';

const cache = new Map();

function once(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}

function solidTexture(r, g, b) {
  const texture = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Almost everything in the scene is this one material, with neutral textures standing in
 * for any map a surface doesn't need. It looks exactly as if the map were absent. The point
 * is that it's all one shader: each different combination of maps is a separate shader to
 * compile, and on Windows that can take seconds each, which once meant a first visit that
 * froze for over a minute. See docs/architecture.md before adding a different material.
 */
export function surfaceMaterial({ map, normalMap, roughnessMap, metalnessMap, ...rest } = {}) {
  const { white, flat } = once('neutralMaps', () => ({ white: solidTexture(255, 255, 255), flat: solidTexture(128, 128, 255) }));
  return new THREE.MeshStandardMaterial({
    map: map ?? white,
    normalMap: normalMap ?? flat,
    roughnessMap: roughnessMap ?? white,
    metalnessMap: metalnessMap ?? white,
    ...rest,
  });
}

function tiling(texture, repeatX, repeatY) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  return texture;
}

/** Fine surface relief that catches light as a page curls. Shared by all pages. */
export function paperBumpTexture() {
  return once('paperBump', () => {
    const texture = tiling(new THREE.CanvasTexture(paperBumpCanvas()), 2, 2.5);
    // Swapped for the scan of real paper as soon as that has arrived.
    paperReady().then(() => {
      texture.image = paperBumpCanvas();
      texture.needsUpdate = true;
    });
    return texture;
  });
}

/** Neutral paper artwork, used for a page until its own artwork is ready. */
export function plainPaperTexture(paper) {
  return once(`plainPaper:${paper.rgb}`, () => {
    const texture = new THREE.CanvasTexture(paperGrainCanvas(paper));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  });
}

/** Uniform matte roughness (channel G), matching pages that hold no photograph. */
export function plainRoughnessTexture() {
  return once('plainRough', () => new THREE.CanvasTexture(plainRoughnessCanvas()));
}

export function pageEdgeTexture(paper) {
  return once(`pageEdge:${paper.rgb}`, () => {
    const texture = new THREE.CanvasTexture(pageEdgeCanvas(paper));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  });
}

/** Plain cover material for board edges and the spine. */
export function coverEdgeTextures(theme) {
  return once(`coverEdge:${theme.colour}:${theme.material}`, () => {
    const map = new THREE.CanvasTexture(coverBaseCanvas(theme.colourInfo, theme.material));
    map.colorSpace = THREE.SRGBColorSpace;
    tiling(map, 1, 1);
    const normalMap = tiling(new THREE.CanvasTexture(bakeNormalMap(coverBumpCanvas(theme.material), 1.2)), 1, 1);
    return { map, normalMap };
  });
}

/** New textures each time, since they hold the title. The caller disposes of them. */
export function buildCoverTextures({ title, hingeLeft, theme, width }) {
  const { colorCanvas, surfaceCanvas, normalCanvas } = drawCoverMaps({ title, hingeLeft, theme, width });
  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const surfaceMap = new THREE.CanvasTexture(surfaceCanvas);
  const normalMap = new THREE.CanvasTexture(normalCanvas);
  for (const texture of [map, surfaceMap, normalMap]) texture.anisotropy = 8;
  return { map, surfaceMap, normalMap };
}

export function buildSpineTextures({ title, theme }) {
  const { colorCanvas, surfaceCanvas } = drawSpineMaps({ title, theme });
  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const surfaceMap = new THREE.CanvasTexture(surfaceCanvas);
  for (const texture of [map, surfaceMap]) texture.anisotropy = 8;
  return { map, surfaceMap };
}

export function endpaperTexture(colour) {
  return once(`endpaper:${colour.endpaper}`, () => {
    const texture = new THREE.CanvasTexture(endpaperCanvas(colour));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  });
}

/** The gilt-tooled lining of a board. Shared by every book with the same look. */
export function liningTexture(theme, crest) {
  const { colourInfo, material } = theme;
  return once(`lining:${theme.key}:${crest}`, () => {
    const texture = new THREE.CanvasTexture(liningCanvas(colourInfo, material, { crest }));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  });
}

export function contactShadowTexture() {
  return once('contactShadow', () => new THREE.CanvasTexture(contactShadowCanvas()));
}

/**
 * Frees the GPU copies. Each texture keeps its canvas, so three.js re-uploads it
 * automatically if the next album's scene uses it again.
 */
export function disposeProceduralTextures() {
  cache.forEach((value) => {
    if (value instanceof THREE.Texture) value.dispose();
    else if (value && typeof value === 'object') {
      Object.values(value).forEach((v) => {
        if (v instanceof THREE.Texture) v.dispose();
      });
    }
  });
}
