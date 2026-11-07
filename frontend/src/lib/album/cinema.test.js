import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPENING_COVER_AT, OPENING_LENGTH, approach, cinema, noteCoverDrawn, openingAt, resetCinema, stageReady } from '../ambient/cinema.js';
import { TIER_BALANCED, TIER_HIGH, TIER_LOW, TIERS, isTooSlow, lowerTier, pickTier } from '../ambient/quality.js';
import { TurnController } from './turnController.js';
import { MAX_DIMENSION, fitWithin, isHeifHeader } from '../images/resizeImage.js';

test('the opening runs in order and stays short', () => {
  assert.ok(OPENING_COVER_AT < OPENING_LENGTH);
  assert.ok(OPENING_LENGTH <= 4, 'an opening should never feel like a game intro');
  assert.equal(openingAt(0).approach, 0);
  assert.equal(openingAt(0).coverCue, false);
  assert.equal(openingAt(OPENING_COVER_AT).coverCue, true);
  assert.equal(openingAt(OPENING_LENGTH).finished, true);
  assert.equal(openingAt(OPENING_LENGTH - 0.01).finished, false);
  assert.equal(openingAt(99).approach, 1);
});

test('the opening copes with a clock before its start', () => {
  assert.equal(openingAt(-5).approach, 0);
  assert.equal(openingAt(-5).coverCue, false);
});

test('the approach only ever moves forward', () => {
  let last = -1;
  for (let t = 0; t < 2; t += 0.05) {
    const { approach: a } = openingAt(t);
    assert.ok(a >= last);
    last = a;
  }
});

test('easing reaches the same place at any frame rate', () => {
  const run = (dt) => {
    let v = 1;
    for (let t = 0; t < 1 - 1e-9; t += dt) v = approach(v, 0, 3, dt);
    return v;
  };
  assert.ok(Math.abs(run(1 / 30) - run(1 / 120)) < 1e-6);
});

test('a scene waits until both covers are drawn and frames have followed', () => {
  resetCinema();
  assert.equal(stageReady(), false);
  cinema.compiled = true;
  noteCoverDrawn();
  cinema.framesDrawn = 10;
  assert.equal(stageReady(), false, 'one cover is not enough');
  noteCoverDrawn();
  assert.equal(stageReady(), false, 'the frame that uploads a new cover can stall');
  cinema.framesDrawn = 3;
  assert.equal(stageReady(), true);
  resetCinema();
  assert.equal(stageReady(), false, 'nothing carries over to the next scene');
});

test('devices get a level that suits them', () => {
  assert.equal(pickTier({ coarsePointer: false, cores: 12, memoryGB: 16 }), TIER_HIGH);
  assert.equal(pickTier({ coarsePointer: false, cores: 4, memoryGB: 8 }), TIER_BALANCED);
  assert.equal(pickTier({ coarsePointer: false, cores: 2, memoryGB: 8 }), TIER_LOW);
  assert.equal(pickTier({ coarsePointer: true, cores: 4, memoryGB: 4 }), TIER_LOW);
  assert.equal(pickTier({ coarsePointer: true, cores: 8, memoryGB: 8 }), TIER_BALANCED);
});

test('stepping down stops at the lowest level', () => {
  assert.equal(lowerTier(TIER_HIGH), TIER_BALANCED);
  assert.equal(lowerTier(TIER_BALANCED), TIER_LOW);
  assert.equal(lowerTier(TIER_LOW), TIER_LOW);
});

test('each lower level costs less', () => {
  assert.ok(TIERS[TIER_HIGH].dust > TIERS[TIER_BALANCED].dust && TIERS[TIER_BALANCED].dust > TIERS[TIER_LOW].dust);
  assert.ok(TIERS[TIER_HIGH].shadowSize > TIERS[TIER_LOW].shadowSize);
  assert.equal(TIERS[TIER_LOW].post, false);
});

test('slowness is judged by frames per second', () => {
  assert.equal(isTooSlow(30, 3), true);
  assert.equal(isTooSlow(180, 3), false);
  assert.equal(isTooSlow(0, 0), false);
});

test('a skipped opening finishes the cover at once', () => {
  const c = new TurnController(8);
  c.next();
  c.update(1 / 60);
  c.finishOpening();
  assert.equal(c.open, 1);
  assert.equal(c.openV, 0);
  assert.equal(c.stage(), 'open');
  assert.equal(c.isCoverOpen, true);
  assert.equal(c.isAnimating, false);
});

test('skipping before the cover has been cued still opens it', () => {
  const c = new TurnController(8);
  c.finishOpening();
  assert.equal(c.stage(), 'open');
  assert.equal(c.open, 1);
});

test('uploads keep enough detail for a large screen, at any shape', () => {
  assert.equal(MAX_DIMENSION, 2400);
  assert.deepEqual(fitWithin(4032, 3024), { width: 2400, height: 1800 });
  assert.deepEqual(fitWithin(3024, 4032), { width: 1800, height: 2400 });
  assert.deepEqual(fitWithin(8064, 6048), { width: 2400, height: 1800 }, 'a 48-megapixel iPhone photo');
  assert.deepEqual(fitWithin(900, 1200), { width: 900, height: 1200 }, 'smaller photos are not enlarged');
  assert.deepEqual(fitWithin(12000, 2000), { width: 2400, height: 400 }, 'a panorama');
});

test('HEIC is recognised from a file itself, whatever it is called', () => {
  const header = (brand) => new TextEncoder().encode(`\0\0\0\x18ftyp${brand}`);
  for (const brand of ['heic', 'heix', 'mif1', 'hevc']) assert.equal(isHeifHeader(header(brand)), true, brand);
  assert.equal(isHeifHeader(header('isom')), false, 'an MP4 video');
  assert.equal(isHeifHeader(new TextEncoder().encode('not an image at all')), false);
  assert.equal(isHeifHeader(new Uint8Array(2)), false);
});
