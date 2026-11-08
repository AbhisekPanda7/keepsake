/**
 * Pure album structure: how photographs map onto sheets of paper.
 *
 * Vocabulary
 *   leaf   – one physical sheet. It has two faces.
 *   side   – one printed page, numbered from 0. Side 0 is always the title page and
 *            photographs start on side 1.
 *   spread – what the book shows; spread s means s leaves have been turned.
 *
 * The same sides can be bound in two ways, called the mode:
 *
 *   spread   Printed on both faces, like a normal book. Leaf n carries sides 2n and
 *            2n + 1. Spread s shows side 2s - 1 on the left and 2s on the right.
 *
 *   single   Printed on one face only, like a traditional album. Leaf n carries side
 *            n and its back is plain paper. Spread s shows side s on the right, and
 *            the camera frames only that page. Used on portrait phones: every swipe
 *            is then a real page turn, rather than half of them being a camera pan.
 */

export const MODE_SPREAD = 'spread';
export const MODE_SINGLE = 'single';

export const MIN_LEAVES = 4;
const TITLE_SIDES = 1;
/** Sides always kept free at the end so the album never feels "full". */
const SPARE_SIDES = 2;

/** Total printed pages. Always even, so both modes hold the same pages. */
export function pageCountFor(photoCount) {
  const leaves = Math.max(MIN_LEAVES, Math.ceil((TITLE_SIDES + photoCount + SPARE_SIDES) / 2));
  return leaves * 2;
}

export function leafCountFor(photoCount, mode = MODE_SPREAD) {
  const pages = pageCountFor(photoCount);
  return mode === MODE_SINGLE ? pages : pages / 2;
}

export function sideOfPhoto(photoIndex) {
  return photoIndex + TITLE_SIDES;
}

export function spreadOfSide(sideIndex, mode = MODE_SPREAD) {
  return mode === MODE_SINGLE ? sideIndex : Math.ceil(sideIndex / 2);
}

export function spreadOfPhoto(photoIndex, mode = MODE_SPREAD) {
  return spreadOfSide(sideOfPhoto(photoIndex), mode);
}

export function sidesOfSpread(spread, leafCount, mode = MODE_SPREAD) {
  if (mode === MODE_SINGLE) {
    return { left: null, right: spread < leafCount ? spread : null };
  }
  return {
    left: spread > 0 ? spread * 2 - 1 : null,
    right: spread < leafCount ? spread * 2 : null,
  };
}

/**
 * Where to land when the binding changes, for instance when a phone is rotated.
 * A spread is read left page first, so that page is the one kept in view.
 */
export function convertSpread(spread, fromMode, toMode) {
  if (fromMode === toMode) return spread;
  if (fromMode === MODE_SINGLE) return spreadOfSide(spread, toMode);
  return spread === 0 ? 0 : spreadOfSide(spread * 2 - 1, toMode);
}

export function photoOnSide(sideIndex, photos) {
  if (sideIndex === null || sideIndex < TITLE_SIDES) return null;
  return photos[sideIndex - TITLE_SIDES] ?? null;
}

/**
 * The year printed on the title page's plaque: when the earliest photograph was taken, or
 * added if it has no date, or this year for an album still waiting for its first.
 */
export function memoriesSince(photos, now = Date.now()) {
  let earliest = Infinity;
  for (const photo of photos) {
    const when = Number.isFinite(photo.takenAt) && photo.takenAt > 0 ? photo.takenAt : photo.addedAt;
    if (Number.isFinite(when) && when > 0 && when < earliest) earliest = when;
  }
  return new Date(Number.isFinite(earliest) ? earliest : now).getFullYear();
}

/**
 * Everything needed to draw one page. `key` identifies the finished artwork, so it
 * changes whenever what is printed on the page would change.
 */
export function describeSide(sideIndex, photos, albumTitle = '', mode = MODE_SPREAD, description = '') {
  const single = mode === MODE_SINGLE;
  // A page's spine edge decides its gutter shading and which corner the number sits in.
  const base = { sideIndex, single, spineOnRight: !single && sideIndex % 2 === 1 };
  const suffix = single ? ':s' : '';
  if (sideIndex === 0) {
    const since = memoriesSince(photos);
    return {
      ...base,
      key: `title:${photos.length}:${albumTitle}:${description}:${since}${suffix}`,
      kind: 'title',
      photoCount: photos.length,
      title: albumTitle,
      description,
      since,
    };
  }
  const photo = photoOnSide(sideIndex, photos);
  if (photo) {
    // The caption is printed on the page, so a changed caption is changed artwork.
    return { ...base, key: `photo:${photo.id}:${sideIndex}:${photo.caption ?? ''}${suffix}`, kind: 'photo', photo };
  }
  return { ...base, key: `blank:${sideIndex}${suffix}`, kind: 'blank' };
}

/** The plain back of a one-sided leaf. Every leaf shares this one texture. */
const VERSO = Object.freeze({ key: 'verso', kind: 'verso', sideIndex: 1, single: true, spineOnRight: true });

/** The artwork for both faces of a leaf. */
export function describeLeaf(leaf, photos, albumTitle = '', mode = MODE_SPREAD, description = '') {
  if (mode === MODE_SINGLE) {
    return { front: describeSide(leaf, photos, albumTitle, mode, description), back: VERSO };
  }
  return {
    front: describeSide(leaf * 2, photos, albumTitle, mode, description),
    back: describeSide(leaf * 2 + 1, photos, albumTitle, mode, description),
  };
}

/** Sides worth preparing ahead of time around the current view. */
export function sidesNear(spread, leafCount, mode = MODE_SPREAD) {
  const from = mode === MODE_SINGLE ? Math.max(0, spread - 2) : Math.max(0, spread * 2 - 5);
  const to = mode === MODE_SINGLE ? Math.min(leafCount - 1, spread + 3) : Math.min(leafCount * 2 - 1, spread * 2 + 4);
  const sides = [];
  for (let side = from; side <= to; side += 1) sides.push(side);
  return sides;
}

/** Human page label for the toolbar. Page numbers are 1-based sides. */
export function pageLabel(stage, spread, leafCount, mode = MODE_SPREAD) {
  if (stage === 'closed-front') return 'Closed';
  if (stage === 'closed-back') return 'Back cover';
  if (mode === MODE_SINGLE) {
    return spread < leafCount ? `Page ${spread + 1} of ${leafCount}` : 'End of album';
  }
  const total = leafCount * 2;
  const { left, right } = sidesOfSpread(spread, leafCount);
  if (left === null) return `Page 1 of ${total}`;
  if (right === null) return `Page ${total} of ${total}`;
  return `Pages ${left + 1}–${right + 1} of ${total}`;
}
