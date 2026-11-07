/**
 * Geometry of the book, in scene units, with no Three.js dependency.
 *
 * Book space: the spine runs along Y at x = 0, +x is the right-hand page and
 * +z points up off the table toward the camera. The book lies on the table at
 * z = 0, so looking down the z axis is looking straight down at an open book.
 */

export const PAGE_WIDTH = 3;
export const PAGE_HEIGHT = 3.7;
export const SEGMENTS_U = 24; // across the page width, spine to fore-edge
export const SEGMENTS_V = 8; // along the page height
/** Where the room's lamp hangs. Paper needs this as well as the light itself. */
export const LAMP_POSITION = [-6.3, 8.4, 16.5];
/** Where daylight comes in through a window, and where it falls. */
export const WINDOW_POSITION = [-10.5, 5.5, 13.5];
export const WINDOW_TARGET = [0.5, -0.4, 0];

const BOARD_THICKNESS = 0.055;
const MAX_LEAF_THICKNESS = 0.012;
/** The block never grows beyond this, however many photographs are added. */
const MAX_BLOCK_THICKNESS = 0.8;
const BOARD_OVERHANG = 0.07;
const CROWN_FALL = 0.3;

const smoothstep = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

export function makeBookLayout(leafCount) {
  const thick = Math.min(MAX_LEAF_THICKNESS, MAX_BLOCK_THICKNESS / leafCount);
  const blockT = thick * leafCount;
  const spineWidth = blockT + BOARD_THICKNESS * 2;
  // The gutter must widen with the block, or a thick stack would need an
  // impossibly steep rise out of the spine.
  const gutterW = Math.max(0.28, blockT * 1.8);

  // Per-segment falloff of the gutter's slope: 1 at the spine, 0 once the paper
  // has climbed out and lies flat. Shared by leaves and the page block so the
  // top leaf sits exactly on the block's surface.
  const ds = PAGE_WIDTH / SEGMENTS_U;
  //
  // Beyond the gutter the slope goes gently negative, so an open book's pages crown
  // and then fall away toward the fore-edge, instead of lying dead flat. The height
  // lost is CROWN_FALL of the climb, and scales with it: a thin stack stays nearly flat.
  const gutterShape = new Float32Array(SEGMENTS_U);
  const crownLength = Math.max(ds, PAGE_WIDTH - gutterW);
  for (let j = 0; j < SEGMENTS_U; j += 1) {
    const s = (j + 0.5) * ds;
    const climb = 1 - smoothstep(s / gutterW);
    // Integrates to CROWN_FALL * gutterW / 2 over the crown, the climb's area being gutterW / 2.
    const fallProgress = Math.max(0, (s - gutterW) / crownLength);
    const fall = (CROWN_FALL * gutterW * fallProgress) / crownLength;
    gutterShape[j] = climb - fall;
  }

  return {
    leafCount,
    thick,
    blockT,
    boardT: BOARD_THICKNESS,
    spineWidth,
    gutterW,
    gutterShape,
    ds,
    boardLength: PAGE_WIDTH + BOARD_OVERHANG,
    boardHeight: PAGE_HEIGHT + BOARD_OVERHANG * 2,
    // Footprint used by the camera to frame each state of the book.
    openWidth: (PAGE_WIDTH + BOARD_OVERHANG + spineWidth / 2) * 2,
    closedWidth: PAGE_WIDTH + BOARD_OVERHANG,
    bookHeight: PAGE_HEIGHT + BOARD_OVERHANG * 2,
  };
}

/**
 * Hinge positions for covers and spine.
 *
 * `open` is 0 with the front cover shut and 1 with it fully open. `backClosed`
 * is the mirror: 1 when the back cover has been folded over the finished book.
 * Only one of them is ever away from its "open" value.
 *
 * Opening a real hardback does not just rotate the cover. The spine swings from
 * upright to flat, carrying the cover's hinge from the top of the block down to
 * the table. Without that the open cover would hover at the height of the block.
 */
export function coverPose(layout, open, backClosed, singlePage = false) {
  const { boardT: t, blockT: T, spineWidth: sw } = layout;
  const closedFront = 1 - open;
  const closed = Math.max(closedFront, backClosed);

  const swingF = closedFront * (Math.PI / 2);
  const swingB = backClosed * (Math.PI / 2);

  // Each cover's hinge moves on an arc around the other, which stays on the table.
  let backX = lerp(sw / 2, -0.005, closedFront);
  let backZ = t;
  let frontX = backX - sw * Math.cos(swingF);
  let frontZ = t + T * Math.sin(swingF);
  if (backClosed > 0) {
    frontX = lerp(-sw / 2, 0.005, backClosed);
    frontZ = t;
    backX = frontX + sw * Math.cos(swingB);
    backZ = t + T * Math.sin(swingB);
  }

  const frontAngle = Math.PI * open;
  const backAngle = Math.PI * backClosed;

  // The spine board joins the two covers' mid-thickness lines.
  const frontMidZ = frontZ + (t / 2) * Math.cos(frontAngle);
  const backMidZ = backZ - (t / 2) * Math.cos(backAngle);

  return {
    closed,
    frontX,
    frontZ,
    frontAngle,
    backX,
    backZ,
    backAngle,
    spine: {
      x: (frontX + backX) / 2,
      z: (frontMidZ + backMidZ) / 2,
      angle: Math.atan2(frontMidZ - backMidZ, frontX - backX),
      length: Math.hypot(frontX - backX, frontMidZ - backMidZ) + t,
    },
    // Slides the book so that it stays centred: a closed book's middle is half a
    // page from the spine, an open book's middle is the spine itself. On a single
    // page the middle of interest is that page, so the book doesn't slide at all when
    // opened: the cover swings away off-screen and the page beneath stays in place.
    offsetX: singlePage
      ? (-PAGE_WIDTH / 2) * (1 - backClosed) + (PAGE_WIDTH / 2) * backClosed
      : (-PAGE_WIDTH / 2) * closedFront + (PAGE_WIDTH / 2) * backClosed,
    // Where the book's footprint is centred, for its shadow on the table.
    footprintX: singlePage ? (PAGE_WIDTH / 2) * (closed - 1) : 0,
    // Height of the line the leaves are bound along. It sits low in an open book
    // (the gutter) and rises to the top of the block when the book is shut, so
    // that a closed block is flat instead of dipping toward the spine.
    hingeZ: lerp(t + 0.002, t + T, closed),
  };
}

const lerp = (a, b, k) => a + (b - a) * k;

/**
 * Resting height of a leaf's mid-surface on each side of the book. These do not
 * depend on the current spread: leaf i always rests on leaves after it when on
 * the right, and on leaves before it when on the left.
 */
export function restHeightRight(layout, leaf) {
  return layout.boardT + (layout.leafCount - leaf - 0.5) * layout.thick;
}

export function restHeightLeft(layout, leaf) {
  return layout.boardT + (leaf + 0.5) * layout.thick;
}

/**
 * Starting slope that makes a sheet climb `rise` out of the gutter.
 *
 * Slope falls off along the gutter as gutterShape, whose integral over the
 * gutter is about gutterW / 2, and sin(a) ≈ a for these shallow angles. So
 * rise ≈ a * gutterW / 2. Linear in `rise`, which keeps stacked sheets from
 * crossing: a higher leaf is higher at every point along its width.
 */
export function gutterSlope(layout, rise) {
  const a = (2 * rise) / layout.gutterW;
  return Math.max(-1.1, Math.min(1.1, a));
}
