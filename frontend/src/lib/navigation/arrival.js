/**
 * Remembers that an album was just opened from the library, so its cover swings open
 * on arrival. It's held in memory on purpose: a refresh or a shared link shows the
 * closed book instead, since nobody has reached for it.
 */
let arrivingAlbumId = null;

export function markArrival(albumId) {
  arrivingAlbumId = albumId;
}

export function isArriving(albumId) {
  return arrivingAlbumId === albumId;
}

export function clearArrival() {
  arrivingAlbumId = null;
}
