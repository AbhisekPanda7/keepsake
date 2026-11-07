/**
 * Page bending.
 *
 * Paper bends but barely stretches, which rules out simply displacing vertices:
 * a rotated, sagging plane visibly changes length. So each row of the sheet is
 * built by integration. We choose the tangent angle theta at every step along
 * the sheet and walk outward from the spine:
 *
 *     x += cos(theta) * ds
 *     z += sin(theta) * ds
 *
 * Whatever theta does, each row keeps its exact length, and the sheet stays
 * pinned at the spine. theta = 0 lies flat to the right, theta = PI flat to the
 * left, and everything between is a curl. Keeping theta inside the range of the
 * two resting angles also means the sheet can never dip through a page stack.
 */
import { PAGE_HEIGHT, SEGMENTS_U, SEGMENTS_V, gutterSlope, restHeightLeft, restHeightRight } from './bookModel.js';

/** Peak curl in radians between the spine and fore-edge at mid-turn. */
const CURL_STRENGTH = 1.35;
/** Where along the sheet the curl changes sign: inner part lags, outer part leads. */
const CURL_PIVOT = 0.35;
/** Corner lift, in radians, between the grabbed and opposite corners. */
const SKEW_STRENGTH = 0.9;
const RIPPLE_WAVES = 1.25;

export const REST_STATE = Object.freeze({ t: 0, curl: 0, skew: 0, shear: 0, ripple: 0, ripplePhase: 0 });

/**
 * Walks one row of the sheet. `v` is the row's height on the page (-0.5 to 0.5).
 * Writes the row's centre line into outX / outZ (SEGMENTS_U + 1 entries each).
 *
 * state.t     0 = resting right, 1 = resting left
 * state.curl  signed bend; + means the fore-edge leads a forward turn
 * state.skew  signed diagonal bend from holding a corner rather than the edge
 */
export function integrateRow(layout, slopeR, slopeL, hingeZ, state, v, outX, outZ) {
  const { t, curl, skew } = state;
  const ds = layout.ds;
  // A flat sheet at either end of the turn has no curl left to show.
  const envelope = Math.sin(Math.PI * t);
  const curlAmp = curl * CURL_STRENGTH * envelope;
  const skewAmp = skew * SKEW_STRENGTH * envelope * v;
  // A sheet moving through air ripples. A wave runs from spine to edge, growing toward
  // the free edge, where nothing holds the paper still.
  const rippleAmp = (state.ripple ?? 0) * envelope;
  const ripplePhase = state.ripplePhase ?? 0;

  let x = 0;
  let z = hingeZ;
  outX[0] = x;
  outZ[0] = z;
  for (let j = 0; j < SEGMENTS_U; j += 1) {
    const u = (j + 0.5) / SEGMENTS_U;
    const shape = layout.gutterShape[j];
    const restR = slopeR * shape;
    const restL = Math.PI - slopeL * shape;

    let theta = restR + (restL - restR) * t;
    theta += curlAmp * (u - CURL_PIVOT);
    // u² keeps the spine edge straight, so every row stays attached to the binding.
    theta += skewAmp * u * u;
    if (rippleAmp !== 0) theta += rippleAmp * u * Math.sin(u * RIPPLE_WAVES * 2 * Math.PI - ripplePhase + v * 1.4);
    if (theta < restR) theta = restR;
    else if (theta > restL) theta = restL;

    x += Math.cos(theta) * ds;
    z += Math.sin(theta) * ds;
    outX[j + 1] = x;
    outZ[j + 1] = z;
  }
}

export function leafSlopes(layout, leaf, hingeZ) {
  return {
    slopeR: gutterSlope(layout, restHeightRight(layout, leaf) - hingeZ),
    slopeL: gutterSlope(layout, restHeightLeft(layout, leaf) - hingeZ),
  };
}

const scratchX = new Float64Array(SEGMENTS_U + 1);
const scratchZ = new Float64Array(SEGMENTS_U + 1);

/**
 * Where a point on the sheet appears from a camera straight above the spine,
 * expressed on the z = 0 plane. A raised page looks further from the centre
 * because it is nearer the camera, so x is scaled by similar triangles.
 */
function apparentX(layout, slopes, hingeZ, state, u, v, cameraZ, offsetX) {
  integrateRow(layout, slopes.slopeR, slopes.slopeL, hingeZ, state, v, scratchX, scratchZ);
  const at = Math.min(SEGMENTS_U, u * SEGMENTS_U);
  const j = Math.min(SEGMENTS_U - 1, Math.floor(at));
  const k = at - j;
  const x = scratchX[j] + (scratchX[j + 1] - scratchX[j]) * k;
  const z = scratchZ[j] + (scratchZ[j + 1] - scratchZ[j]) * k;
  return ((x + offsetX) * cameraZ) / (cameraZ - z);
}

/**
 * Inverts the sheet shape: finds the turn progress that places the grabbed point
 * under the pointer. The point's on-screen x falls steadily as t rises, so
 * bisection is reliable, and a dozen steps are far more precise than a pixel.
 * `offsetX` is how far the book currently sits from the centre of the view.
 */
export function solveTurnForPointer(layout, leaf, hingeZ, state, grabU, grabV, pointerX, cameraZ, offsetX = 0) {
  const slopes = leafSlopes(layout, leaf, hingeZ);
  const probe = { ...state };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i += 1) {
    const mid = (lo + hi) / 2;
    probe.t = mid;
    if (apparentX(layout, slopes, hingeZ, probe, grabU, grabV, cameraZ, offsetX) > pointerX) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export const LEAF_COLUMNS = SEGMENTS_U + 1;
export const LEAF_ROWS = SEGMENTS_V + 1;
const GRID_VERTS = LEAF_COLUMNS * LEAF_ROWS;
/** Vertices per leaf: front grid, back grid, then fore-edge, head and tail strips. */
export const LEAF_VERTEX_COUNT = GRID_VERTS * 2 + LEAF_ROWS * 2 + LEAF_COLUMNS * 4;

const centreX = new Float32Array(GRID_VERTS);
const centreY = new Float32Array(GRID_VERTS);
const centreZ = new Float32Array(GRID_VERTS);
const rowX = new Float64Array(LEAF_COLUMNS);
const rowZ = new Float64Array(LEAF_COLUMNS);

/**
 * Writes a whole leaf into position / normal arrays. The sheet's centre surface
 * is solved first, then the two printed faces are offset along its normal by half
 * the paper thickness. That gives the page real thickness at any curl, and the
 * printed back face its own correct shading as it comes round to face the light.
 */
export function writeLeaf(positions, normals, layout, leaf, hingeZ, state) {
  const { slopeR, slopeL } = leafSlopes(layout, leaf, hingeZ);
  const envelope = Math.sin(Math.PI * state.t);
  const shearAmp = state.shear * envelope;

  for (let k = 0; k < LEAF_ROWS; k += 1) {
    const v = k / SEGMENTS_V - 0.5;
    integrateRow(layout, slopeR, slopeL, hingeZ, state, v, rowX, rowZ);
    const y = v * PAGE_HEIGHT;
    for (let j = 0; j < LEAF_COLUMNS; j += 1) {
      const u = j / SEGMENTS_U;
      const i = k * LEAF_COLUMNS + j;
      centreX[i] = rowX[j];
      // Lets the held corner drift toward the pointer vertically, spine still fixed.
      centreY[i] = y + shearAmp * u * u;
      centreZ[i] = rowZ[j];
    }
  }

  const half = layout.thick * 0.45;
  const backStart = GRID_VERTS;
  for (let k = 0; k < LEAF_ROWS; k += 1) {
    const kPrev = Math.max(0, k - 1);
    const kNext = Math.min(SEGMENTS_V, k + 1);
    for (let j = 0; j < LEAF_COLUMNS; j += 1) {
      const jPrev = Math.max(0, j - 1);
      const jNext = Math.min(SEGMENTS_U, j + 1);
      const i = k * LEAF_COLUMNS + j;
      const iu0 = k * LEAF_COLUMNS + jPrev;
      const iu1 = k * LEAF_COLUMNS + jNext;
      const iv0 = kPrev * LEAF_COLUMNS + j;
      const iv1 = kNext * LEAF_COLUMNS + j;

      // Surface normal = d/du × d/dv, from central differences across the grid.
      const ax = centreX[iu1] - centreX[iu0];
      const ay = centreY[iu1] - centreY[iu0];
      const az = centreZ[iu1] - centreZ[iu0];
      const bx = centreX[iv1] - centreX[iv0];
      const by = centreY[iv1] - centreY[iv0];
      const bz = centreZ[iv1] - centreZ[iv0];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;

      const front = i * 3;
      positions[front] = centreX[i] + nx * half;
      positions[front + 1] = centreY[i] + ny * half;
      positions[front + 2] = centreZ[i] + nz * half;
      normals[front] = nx;
      normals[front + 1] = ny;
      normals[front + 2] = nz;

      const back = (backStart + i) * 3;
      positions[back] = centreX[i] - nx * half;
      positions[back + 1] = centreY[i] - ny * half;
      positions[back + 2] = centreZ[i] - nz * half;
      normals[back] = -nx;
      normals[back + 1] = -ny;
      normals[back + 2] = -nz;
    }
  }

  // Edge strips reuse the two faces' boundary vertices with outward normals.
  let e = GRID_VERTS * 2;
  const copy = (index, nx, ny, nz) => {
    positions[e * 3] = positions[index * 3];
    positions[e * 3 + 1] = positions[index * 3 + 1];
    positions[e * 3 + 2] = positions[index * 3 + 2];
    normals[e * 3] = nx;
    normals[e * 3 + 1] = ny;
    normals[e * 3 + 2] = nz;
    e += 1;
  };
  for (let k = 0; k < LEAF_ROWS; k += 1) {
    const i = k * LEAF_COLUMNS + SEGMENTS_U;
    // The fore-edge faces along the sheet's tangent at its outer end.
    const tx = centreX[i] - centreX[i - 1];
    const tz = centreZ[i] - centreZ[i - 1];
    const tl = Math.hypot(tx, tz) || 1;
    copy(i, tx / tl, 0, tz / tl);
    copy(backStart + i, tx / tl, 0, tz / tl);
  }
  for (let j = 0; j < LEAF_COLUMNS; j += 1) {
    const i = SEGMENTS_V * LEAF_COLUMNS + j;
    copy(i, 0, 1, 0);
    copy(backStart + i, 0, 1, 0);
  }
  for (let j = 0; j < LEAF_COLUMNS; j += 1) {
    copy(j, 0, -1, 0);
    copy(backStart + j, 0, -1, 0);
  }
}

/** The unbent cross-section of a stack's top surface, for building page blocks. */
export function stackProfile(layout, rise, hingeZ, outX, outZ) {
  const slope = gutterSlope(layout, rise);
  let x = 0;
  let z = hingeZ;
  outX[0] = x;
  outZ[0] = z;
  for (let j = 0; j < SEGMENTS_U; j += 1) {
    const theta = slope * layout.gutterShape[j];
    x += Math.cos(theta) * layout.ds;
    z += Math.sin(theta) * layout.ds;
    outX[j + 1] = x;
    outZ[j + 1] = z;
  }
}
