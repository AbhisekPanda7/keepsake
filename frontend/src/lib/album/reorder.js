/** Pure helpers for rearranging photographs. */

/** Returns a new list with the item at `from` moved to index `to`. */
export function moveItem(list, from, to) {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

/** Index of the slot whose centre is closest to a point. Slots are {x, y} centres. */
export function nearestSlot(slots, x, y) {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < slots.length; i += 1) {
    const dx = slots[i].x - x;
    const dy = slots[i].y - y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/**
 * Puts photos in the order of `ids` and renumbers them. Anything unknown in `ids` is
 * ignored, and any photo missing from `ids` keeps its place at the end, so that a
 * stale list can never lose a photograph.
 */
export function applyOrder(photos, ids) {
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const ordered = [];
  for (const id of ids) {
    const photo = byId.get(id);
    if (photo) {
      ordered.push(photo);
      byId.delete(id);
    }
  }
  for (const photo of photos) {
    if (byId.has(photo.id)) ordered.push(photo);
  }
  // Unchanged photos keep their object identity, so nothing redraws needlessly.
  return ordered.map((photo, order) => (photo.order === order ? photo : { ...photo, order }));
}
