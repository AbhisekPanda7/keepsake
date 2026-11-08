import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAGE_WIDTH, SEGMENTS_U, coverPose, makeBookLayout } from './bookModel.js';
import { integrateRow, leafSlopes, solveTurnForPointer } from './leafDeform.js';
import {
  MIN_LEAVES,
  MODE_SINGLE,
  MODE_SPREAD,
  convertSpread,
  describeLeaf,
  describeSide,
  leafCountFor,
  pageLabel,
  sidesNear,
  sidesOfSpread,
  spreadOfPhoto,
} from './pageModel.js';
import { MAX_CAPTION_LENGTH, capturedDate, describePhotoDate, formatPhotoDate, formatUpdated, normalizeCaption, photoCountText, wrapText } from './photoInfo.js';
import { applyOrder, moveItem, nearestSlot } from './reorder.js';
import { BookSpin, angleFromHome, reachBelowCentre } from './bookSpin.js';
import { TurnController } from './turnController.js';

const photos = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

function row(layout, leaf, state) {
  const pose = coverPose(layout, 1, 0);
  const { slopeR, slopeL } = leafSlopes(layout, leaf, pose.hingeZ);
  const x = new Float64Array(SEGMENTS_U + 1);
  const z = new Float64Array(SEGMENTS_U + 1);
  integrateRow(layout, slopeR, slopeL, pose.hingeZ, state, 0, x, z);
  return { x, z, pose };
}

function run(controller, seconds) {
  for (let i = 0; i < seconds * 60; i += 1) controller.update(1 / 60);
}

test('album grows with its photographs and keeps a minimum size', () => {
  assert.equal(leafCountFor(0), MIN_LEAVES);
  assert.equal(leafCountFor(5), MIN_LEAVES);
  assert.equal(leafCountFor(30), 17);
  // There is always room: every photo side exists, with spare blanks after it.
  for (const n of [0, 1, 5, 30, 31, 200]) {
    assert.ok(leafCountFor(n) * 2 >= n + 3, `room for ${n}`);
  }
});

test('photographs land on the spread that shows them, in order', () => {
  assert.equal(spreadOfPhoto(0), 1);
  assert.equal(spreadOfPhoto(1), 1);
  assert.equal(spreadOfPhoto(2), 2);
  const list = photos(5);
  for (let i = 0; i < 5; i += 1) {
    const { left, right } = sidesOfSpread(spreadOfPhoto(i), leafCountFor(5));
    const shown = [left, right].map((side) => describeSide(side, list).photo?.id);
    assert.ok(shown.includes(`p${i}`), `photo ${i} on its spread`);
  }
  assert.equal(describeSide(0, list).kind, 'title');
  assert.equal(describeSide(6, list).kind, 'blank');
});

test('page labels describe each state', () => {
  assert.equal(pageLabel('closed-front', 0, 4), 'Closed');
  assert.equal(pageLabel('open', 0, 4), 'Page 1 of 8');
  assert.equal(pageLabel('open', 1, 4), 'Pages 2–3 of 8');
  assert.equal(pageLabel('open', 4, 4), 'Page 8 of 8');
});

test('page width is preserved at every stage of a turn (paper does not stretch)', () => {
  const layout = makeBookLayout(8);
  for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    for (const curl of [-1, 0, 1]) {
      const { x, z } = row(layout, 3, { t, curl, skew: 0.8, shear: 0 });
      let length = 0;
      for (let j = 0; j < SEGMENTS_U; j += 1) length += Math.hypot(x[j + 1] - x[j], z[j + 1] - z[j]);
      assert.ok(Math.abs(length - PAGE_WIDTH) < 1e-9, `length at t=${t}, curl=${curl}`);
    }
  }
});

test('leaf rests on the right at t=0, on the left at t=1, always above the block', () => {
  const layout = makeBookLayout(8);
  const right = row(layout, 3, { t: 0, curl: 0, skew: 0, shear: 0 });
  const left = row(layout, 3, { t: 1, curl: 0, skew: 0, shear: 0 });
  assert.ok(right.x[SEGMENTS_U] > 2.9);
  assert.ok(left.x[SEGMENTS_U] < -2.9);
  // Spine attachment does not move during a turn.
  assert.equal(row(layout, 3, { t: 0.5, curl: 1, skew: 1, shear: 0 }).x[0], 0);
  // Sheet never dips below the hinge at any progress.
  for (let t = 0; t <= 1; t += 0.05) {
    const { z, pose } = row(layout, 3, { t, curl: 1, skew: 1, shear: 0 });
    z.forEach((value) => assert.ok(value >= pose.hingeZ - 1e-9));
  }
});

test('pointer solver places the fore-edge under the pointer', () => {
  const layout = makeBookLayout(8);
  const hingeZ = coverPose(layout, 1, 0).hingeZ;
  const state = { t: 0, curl: 1, skew: 0, shear: 0 };
  const cameraZ = 14;
  let previous = -1;
  for (const pointerX of [2.5, 1, 0, -1, -2.5]) {
    const t = solveTurnForPointer(layout, 3, hingeZ, state, 1, 0, pointerX, cameraZ);
    assert.ok(t > previous, 'moving left turns the page further');
    previous = t;
    const { x, z } = row(layout, 3, { ...state, t });
    const apparent = (x[SEGMENTS_U] * cameraZ) / (cameraZ - z[SEGMENTS_U]);
    assert.ok(Math.abs(apparent - pointerX) < 0.02, `edge at ${apparent}, pointer ${pointerX}`);
  }
});

test('next/prev walk through cover, spreads, back cover and return', () => {
  const c = new TurnController(4);
  assert.equal(c.stage(), 'closed-front');
  c.prev();
  assert.equal(c.stage(), 'closed-front');
  c.next();
  run(c, 3);
  assert.equal(c.stage(), 'open');
  for (let s = 1; s <= 4; s += 1) {
    c.next();
    run(c, 2);
    assert.equal(c.spread, s);
    assert.equal(c.active.size, 0, 'all leaves settle');
  }
  c.next();
  run(c, 3);
  assert.equal(c.stage(), 'closed-back');
  c.prev();
  run(c, 3);
  assert.equal(c.stage(), 'open');
  assert.equal(c.spread, 4);
});

test('releasing a drag early falls back; past the threshold it completes', () => {
  const c = new TurnController(6);
  c.next();
  run(c, 3);

  c.beginDrag(0, 1, -0.4, 0);
  c.dragTo(1.8, 0, 14);
  run(c, 0.4);
  const midway = c.active.get(0).t;
  assert.ok(midway > 0.05 && midway < 0.42, `small drag lifts the page (${midway})`);
  c.endDrag(0);
  assert.equal(c.spread, 0);
  run(c, 2);
  assert.equal(c.active.size, 0);
  assert.equal(c.leafState(0).t, 0);

  c.beginDrag(0, 1, -0.4, 0);
  c.dragTo(-1, 0, 14);
  run(c, 0.4);
  c.endDrag(0);
  assert.equal(c.spread, 1);
  run(c, 2);
  assert.equal(c.leafState(0).t, 1);

  // Dragging the left page back across undoes the turn.
  c.beginDrag(0, 1, 0.4, 0);
  c.dragTo(1.5, 0, 14);
  run(c, 0.4);
  c.endDrag(0);
  assert.equal(c.spread, 0);

  // A fast flick completes a turn even from a short drag.
  run(c, 2);
  c.beginDrag(0, 1, 0, 0);
  c.dragTo(2.2, 0, 14);
  run(c, 0.1);
  c.endDrag(-9);
  assert.equal(c.spread, 1);
});

test('rapid turns never let neighbouring sheets cross', () => {
  const c = new TurnController(12);
  c.next();
  run(c, 3);
  for (let press = 0; press < 6; press += 1) {
    c.next();
    for (let f = 0; f < 6; f += 1) {
      c.update(1 / 60);
      const moving = [...c.active.keys()].sort((a, b) => a - b);
      for (let n = 0; n < moving.length - 1; n += 1) {
        if (moving[n + 1] !== moving[n] + 1) continue;
        assert.ok(c.active.get(moving[n]).t >= c.active.get(moving[n + 1]).t, 'upper leaf stays ahead');
      }
    }
  }
  assert.ok(c.visibleRange().to - c.visibleRange().from <= 8, 'mesh count stays bounded');
});

test('goToSpread opens the book and riffles there, even for a long way', () => {
  const c = new TurnController(30);
  c.goToSpread(25);
  run(c, 8);
  assert.equal(c.spread, 25);
  assert.equal(c.stage(), 'open');
  assert.equal(c.active.size, 0);
  c.closeAlbum();
  run(c, 10);
  assert.equal(c.spread, 0);
  assert.equal(c.stage(), 'closed-front');
  assert.equal(c.isAnimating, false);
});

test('a hover lift settles without keeping the render loop busy', () => {
  const c = new TurnController(6);
  c.next();
  run(c, 3);
  c.setPeek(0, -0.4);
  run(c, 2);
  assert.ok(c.active.get(0).t > 0.02, 'page corner is lifted');
  assert.equal(c.isAnimating, false);
  assert.equal(c.getSnapshot().resting, true);
  c.clearPeek();
  assert.equal(c.isAnimating, true);
  run(c, 2);
  assert.equal(c.active.size, 0);
});

test('a landing page reports one effect, on the side it lands', () => {
  const c = new TurnController(6);
  c.next();
  run(c, 3);
  c.takeEffects();
  c.next();
  run(c, 2);
  assert.deepEqual(c.takeEffects(), [{ type: 'land', side: -1 }]);
  assert.equal(c.takeEffects().length, 0, 'taken only once');
  c.prev();
  run(c, 2);
  assert.deepEqual(c.takeEffects(), [{ type: 'land', side: 1 }]);
});

test('a book can be turned to any angle and never passes through the table', () => {
  const halves = [1.535, 1.92, 0.08];
  for (let i = 0; i < 400; i += 1) {
    const spin = new BookSpin();
    spin.grab();
    for (let n = 0; n < 6; n += 1) spin.dragBy((Math.random() - 0.5) * 700, (Math.random() - 0.5) * 700);
    spin.update(1 / 60);
    const below = reachBelowCentre(spin.q, ...halves);
    assert.ok(spin.centreHeight(...halves) - below >= -1e-9, 'lowest corner is above the table');
    assert.ok(Math.abs(Math.hypot(...spin.q) - 1) < 1e-9, 'rotation stays valid');
  }
});

test('a book at rest lies flat, at exactly its own height', () => {
  const spin = new BookSpin();
  assert.equal(spin.isRotated, false);
  assert.ok(Math.abs(spin.centreHeight(1.5, 1.9, 0.08) - 0.08) < 1e-9);
});

test('a full turn is possible in both directions', () => {
  for (const [dx, dy] of [[310, 0], [0, 310]]) {
    const spin = new BookSpin();
    spin.grab();
    spin.dragBy(dx, dy); // half a turn
    assert.ok(Math.abs(angleFromHome(spin.q) - Math.PI) < 0.01, 'halfway round');
    spin.dragBy(dx, dy);
    assert.ok(angleFromHome(spin.q) < 0.01, 'all the way round');
  }
});

test('a released book stays where it stops, until it is set down', () => {
  const c = new TurnController(6);
  const { spin } = c;
  const sounds = [];
  c.sound = (name) => sounds.push(name);
  spin.grab();
  spin.dragBy(120, 60);
  spin.release();
  run(c, 9);
  assert.equal(spin.isRotated, true, 'still turned');
  assert.equal(c.isAnimating, false, 'at rest in the air, it needs no more work');
  assert.equal(c.getSnapshot().turned, true);
  const left = [...spin.q];
  run(c, 5);
  assert.deepEqual(spin.q, left, 'does not drift');

  spin.goHome();
  assert.equal(c.isAnimating, true);
  run(c, 4);
  assert.equal(spin.isRotated, false);
  assert.deepEqual(spin.q, [0, 0, 0, 1]);
  assert.equal(c.getSnapshot().turned, false);
  assert.equal(c.isAnimating, false);
  assert.deepEqual(sounds, ['book-down'], 'lands with a thump');
});

test('a hard flick is limited, and spins for only a few seconds', () => {
  const spin = new BookSpin();
  spin.grab();
  spin.dragBy(900, 0);
  spin.release();
  assert.ok(spin.speed <= 12.0001, `speed ${spin.speed}`);
  for (let i = 0; i < 240; i += 1) spin.update(1 / 60);
  assert.equal(spin.speed, 0);
});

test('turning pages and moving covers each make their sound', () => {
  const c = new TurnController(6);
  const sounds = [];
  c.sound = (name) => sounds.push(name);
  c.next();
  run(c, 3);
  assert.deepEqual(sounds, ['cover-open']);
  sounds.length = 0;
  c.next();
  run(c, 2);
  assert.deepEqual(sounds, ['page-lift', 'page-land']);
  sounds.length = 0;
  c.closeAlbum();
  run(c, 6);
  assert.deepEqual(sounds, ['page-lift', 'page-land', 'cover-close', 'book-down']);
});

test('a book turned over goes back to the table before its cover opens', () => {
  const c = new TurnController(6);
  c.spin.grab();
  c.spin.dragBy(200, 50);
  c.spin.release();
  c.next();
  assert.equal(c.openTarget, 0, 'not while it is in the air');
  assert.equal(c.stage(), 'closed-front');
  run(c, 4);
  assert.equal(c.spin.isRotated, false);
  assert.equal(c.stage(), 'open');
  assert.equal(c.open, 1);
});

test('new photographs arriving bring the book back down to open it', () => {
  const c = new TurnController(6);
  c.spin.grab();
  c.spin.dragBy(200, 50);
  c.spin.release();
  c.goToSpread(1);
  run(c, 6);
  assert.equal(c.spin.isRotated, false);
  assert.equal(c.spread, 1);
});

test('quick repeated presses all register', () => {
  const c = new TurnController(30);
  c.next();
  run(c, 3);
  for (let press = 0; press < 14; press += 1) {
    c.next();
    run(c, 0.42);
  }
  assert.equal(c.spread, 14);
});

test('shrinking the album keeps the spread valid', () => {
  const c = new TurnController(17);
  c.goToSpread(16);
  run(c, 8);
  c.setLeafCount(4);
  assert.equal(c.spread, 4);
});

// ---- single-page mode -----------------------------------------------------

test('single-page mode gives every page its own leaf and every photo its own turn', () => {
  const list = photos(5);
  const leaves = leafCountFor(5, MODE_SINGLE);
  assert.equal(leaves, leafCountFor(5, MODE_SPREAD) * 2, 'same pages in both bindings');
  assert.equal(describeLeaf(0, list, 'T', MODE_SINGLE).front.kind, 'title');
  for (let i = 0; i < 5; i += 1) {
    const spread = spreadOfPhoto(i, MODE_SINGLE);
    assert.equal(spread, i + 1);
    const { right, left } = sidesOfSpread(spread, leaves, MODE_SINGLE);
    assert.equal(left, null, 'nothing on the left in this mode');
    assert.equal(describeSide(right, list, '', MODE_SINGLE).photo.id, `p${i}`);
    assert.equal(describeLeaf(spread, list, '', MODE_SINGLE).back.kind, 'verso');
  }
  assert.equal(pageLabel('open', 2, leaves, MODE_SINGLE), `Page 3 of ${leaves}`);
  assert.equal(pageLabel('open', leaves, leaves, MODE_SINGLE), 'End of album');
});

test('artwork keys differ between modes, because the same page is drawn differently', () => {
  const list = photos(3);
  assert.notEqual(describeSide(1, list, '', MODE_SPREAD).key, describeSide(1, list, '', MODE_SINGLE).key);
  // An odd side is a left page in a spread, but a lone page always has its spine on the left.
  assert.equal(describeSide(1, list, '', MODE_SPREAD).spineOnRight, true);
  assert.equal(describeSide(1, list, '', MODE_SINGLE).spineOnRight, false);
});

test('changing mode keeps the reader on the same page', () => {
  // Spread 3 shows sides 5 and 6, and the left page is kept when going to one page.
  assert.equal(convertSpread(3, MODE_SPREAD, MODE_SINGLE), 5);
  assert.equal(convertSpread(0, MODE_SPREAD, MODE_SINGLE), 0);
  // Side 5 and side 6 are both on spread 3.
  assert.equal(convertSpread(5, MODE_SINGLE, MODE_SPREAD), 3);
  assert.equal(convertSpread(6, MODE_SINGLE, MODE_SPREAD), 3);
  assert.equal(convertSpread(0, MODE_SINGLE, MODE_SPREAD), 0);

  const c = new TurnController(leafCountFor(30));
  c.goToSpread(6);
  run(c, 6);
  c.setMode(MODE_SINGLE, leafCountFor(30, MODE_SINGLE));
  assert.equal(c.spread, 11);
  assert.equal(c.layout.leafCount, 34);
  assert.equal(c.getSnapshot().mode, MODE_SINGLE);
  c.setMode(MODE_SPREAD, leafCountFor(30));
  assert.equal(c.spread, 6);
});

test('a single page is centred, and stays put while the cover opens', () => {
  const layout = makeBookLayout(8);
  const closed = coverPose(layout, 0, 0, true);
  const open = coverPose(layout, 1, 0, true);
  assert.equal(closed.offsetX, -PAGE_WIDTH / 2);
  assert.equal(open.offsetX, -PAGE_WIDTH / 2);
  assert.equal(coverPose(layout, 1, 0, false).offsetX, 0, 'a spread still centres on the spine');
  assert.equal(coverPose(layout, 1, 1, true).offsetX, PAGE_WIDTH / 2, 'closed at the back, the block sits left of the spine');
  assert.equal(closed.footprintX, 0);
  assert.equal(open.footprintX, -PAGE_WIDTH / 2);
});

test('a single page commits at a shorter drag, which a phone screen can actually reach', () => {
  const c = new TurnController(8, { mode: MODE_SINGLE });
  c.next();
  run(c, 3);
  const offset = c.pose.offsetX;
  assert.equal(offset, -PAGE_WIDTH / 2);

  // Pull the fore-edge only as far as the middle of the screen.
  c.beginDrag(0, 1, 0, 0);
  c.dragTo(0, 0, 24);
  run(c, 0.4);
  assert.ok(c.active.get(0).t > 0.26, `t=${c.active.get(0).t}`);
  c.endDrag(0);
  assert.equal(c.spread, 1);
  run(c, 2);

  // A small pull still falls back.
  c.beginDrag(1, 1, 0, 0);
  c.dragTo(1.25, 0, 24);
  run(c, 0.4);
  c.endDrag(0);
  assert.equal(c.spread, 1);
  run(c, 2);
  assert.equal(c.active.size, 0);
});

test('the pointer solver allows for a book that is off-centre', () => {
  const layout = makeBookLayout(8);
  const hingeZ = coverPose(layout, 1, 0, true).hingeZ;
  const state = { t: 0, curl: 1, skew: 0, shear: 0 };
  const offset = -PAGE_WIDTH / 2;
  const t = solveTurnForPointer(layout, 3, hingeZ, state, 1, 0, 0.5, 24, offset);
  const { x, z } = row(layout, 3, { ...state, t });
  const apparent = ((x[SEGMENTS_U] + offset) * 24) / (24 - z[SEGMENTS_U]);
  assert.ok(Math.abs(apparent - 0.5) < 0.02, `edge at ${apparent}`);
});

test('pages near the current view are prepared in both modes', () => {
  assert.deepEqual(sidesNear(0, 34, MODE_SINGLE), [0, 1, 2, 3]);
  assert.deepEqual(sidesNear(5, 34, MODE_SINGLE), [3, 4, 5, 6, 7, 8]);
  assert.deepEqual(sidesNear(33, 34, MODE_SINGLE), [31, 32, 33]);
  assert.deepEqual(sidesNear(1, 4, MODE_SPREAD), [0, 1, 2, 3, 4, 5, 6]);
});

// ---- reordering -----------------------------------------------------------

test('moveItem moves one item and leaves the original untouched', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveItem(list, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveItem(list, 3, 0), ['d', 'a', 'b', 'c']);
  assert.equal(moveItem(list, 1, 1), list);
  assert.deepEqual(moveItem(list, 1, 99), ['a', 'c', 'd', 'b']);
  assert.deepEqual(list, ['a', 'b', 'c', 'd']);
});

test('nearestSlot finds the closest centre', () => {
  const slots = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }];
  assert.equal(nearestSlot(slots, 90, 10), 1);
  assert.equal(nearestSlot(slots, 10, 80), 2);
  assert.equal(nearestSlot([], 0, 0), -1);
});

test('applyOrder renumbers, and can never lose or duplicate a photograph', () => {
  const list = [{ id: 'a', order: 0 }, { id: 'b', order: 1 }, { id: 'c', order: 2 }];
  const swapped = applyOrder(list, ['b', 'a', 'c']);
  assert.deepEqual(swapped.map((p) => [p.id, p.order]), [['b', 0], ['a', 1], ['c', 2]]);
  assert.equal(swapped[2], list[2], 'an unmoved photo keeps its identity');
  // Stale or malformed lists.
  assert.deepEqual(applyOrder(list, ['c']).map((p) => p.id), ['c', 'a', 'b']);
  assert.deepEqual(applyOrder(list, ['x', 'b', 'b']).map((p) => p.id), ['b', 'a', 'c']);
});

test('reordering reassigns photographs to the right pages', () => {
  const list = applyOrder(photos(4).map((p, order) => ({ ...p, order })), ['p3', 'p0', 'p1', 'p2']);
  assert.equal(describeSide(1, list).photo.id, 'p3');
  assert.equal(describeSide(2, list).photo.id, 'p0');
  assert.notEqual(describeSide(1, list).key, describeSide(1, photos(4)).key, 'artwork is redrawn');
});

// ---- photo information ----------------------------------------------------

test('a changed caption or description is changed artwork, in both bindings', () => {
  const plain = [{ id: 'p0' }];
  const noted = [{ id: 'p0', caption: 'At the lake' }];
  for (const mode of [MODE_SPREAD, MODE_SINGLE]) {
    assert.notEqual(describeSide(1, plain, '', mode).key, describeSide(1, noted, '', mode).key);
    assert.notEqual(describeSide(0, plain, 'T', mode, '').key, describeSide(0, plain, 'T', mode, 'Words').key);
  }
  assert.equal(describeSide(0, plain, 'T', MODE_SPREAD, 'Words').description, 'Words');
  assert.equal(describeLeaf(0, plain, 'T', MODE_SPREAD, 'Words').front.description, 'Words');
});

test('captions are stored as one tidy line of limited length', () => {
  assert.equal(normalizeCaption('  At   the\n lake  '), 'At the lake');
  assert.equal(normalizeCaption(null), '');
  assert.equal(normalizeCaption('x'.repeat(500)).length, MAX_CAPTION_LENGTH);
});

test('wrapText breaks lines, marks overflow, and handles long words', () => {
  const measure = (t) => t.length; // one unit per character
  assert.deepEqual(wrapText('one two three', measure, 7, 2), ['one two', 'three']);
  assert.deepEqual(wrapText('short', measure, 20, 2), ['short']);
  assert.deepEqual(wrapText('', measure, 20, 2), []);
  const overflow = wrapText('aaaa bbbb cccc dddd eeee', measure, 9, 2);
  assert.equal(overflow.length, 2);
  assert.ok(overflow[1].endsWith('…') && overflow[1].length <= 9, overflow[1]);
  const long = wrapText('abcdefghijklmnop', measure, 6, 2);
  assert.equal(long.length, 1);
  assert.ok(long[0].endsWith('…') && long[0].length <= 6, long[0]);
});

test('album labels read naturally', () => {
  assert.equal(photoCountText(0), 'Empty');
  assert.equal(photoCountText(1), '1 photograph');
  assert.equal(photoCountText(12), '12 photographs');
  const now = new Date(2026, 5, 15, 9).getTime();
  assert.equal(formatUpdated(new Date(2026, 5, 15, 1).getTime(), now), 'today');
  assert.equal(formatUpdated(new Date(2026, 5, 14, 23).getTime(), now), 'yesterday');
  assert.equal(formatUpdated(new Date(2026, 5, 12).getTime(), now), '3 days ago');
  assert.match(formatUpdated(new Date(2024, 2, 9).getTime(), now, 'en-GB'), /^on 9 Mar 2024/);
  assert.equal(formatUpdated(null, now), '');
});

test('captions are honest about where a date came from, and survive bad data', () => {
  const when = new Date(2021, 5, 15, 12).getTime();
  assert.match(formatPhotoDate({ takenAt: when }, 'en-GB'), /15 June 2021/);
  assert.match(describePhotoDate({ takenAt: when, takenAtSource: 'exif' }, 'en-GB'), /^Taken /);
  // A file's date is usually when it was copied or shared, so it's never shown as a photo's date.
  assert.equal(describePhotoDate({ takenAt: when, takenAtSource: 'file' }, 'en-GB'), '');
  assert.equal(capturedDate({ takenAt: when, takenAtSource: 'file' }, 'en-GB'), '');
  assert.equal(capturedDate({ takenAt: when }, 'en-GB'), '', 'photos from before dates had a source');
  assert.match(capturedDate({ takenAt: when, takenAtSource: 'exif' }, 'en-GB'), /15 June 2021/);
  for (const bad of [null, undefined, 0, -5, NaN, Infinity, 'soon', 1e20]) {
    assert.equal(formatPhotoDate({ takenAt: bad }), '', `value ${bad}`);
    assert.equal(describePhotoDate({ takenAt: bad }), '');
  }
  assert.equal(formatPhotoDate(null), '');
});

test('the title page dates the album from its earliest photograph', async () => {
  const { memoriesSince } = await import('./pageModel.js');
  const at = (iso) => Date.parse(iso);
  assert.equal(memoriesSince([], at('2026-11-08T00:00:00Z')), 2026, 'a new album starts this year');
  assert.equal(memoriesSince([{ takenAt: at('2019-06-01T00:00:00Z'), addedAt: at('2026-01-01T00:00:00Z') }, { takenAt: at('2021-01-01T00:00:00Z') }]), 2019);
  assert.equal(memoriesSince([{ takenAt: null, addedAt: at('2024-03-03T00:00:00Z') }]), 2024, 'undated photos count from when they were added');
  assert.equal(describeSide(0, [], 'T').since, new Date().getFullYear());
});
