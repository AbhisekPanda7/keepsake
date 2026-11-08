import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COUPLE, DEFAULT_CATEGORY, INDIVIDUAL, countByCategory, inCategory, normalizeCategory, otherCategory } from './categories.js';

test('a new album is Individual unless it says otherwise', () => {
  assert.equal(DEFAULT_CATEGORY, INDIVIDUAL);
  assert.equal(normalizeCategory(undefined), INDIVIDUAL, 'albums saved before categories existed');
  assert.equal(normalizeCategory(null), INDIVIDUAL);
  assert.equal(normalizeCategory(''), INDIVIDUAL);
  assert.equal(normalizeCategory('FAMILY'), INDIVIDUAL);
  assert.equal(normalizeCategory('constructor'), INDIVIDUAL, 'nothing inherited from Object counts');
  assert.equal(normalizeCategory(7), INDIVIDUAL);
});

test('both categories are recognised however they are written', () => {
  assert.equal(normalizeCategory('COUPLE'), COUPLE);
  assert.equal(normalizeCategory(' couple '), COUPLE);
  assert.equal(normalizeCategory('individual'), INDIVIDUAL);
});

test('each collection shows only its own albums, in the order given', () => {
  const albums = [
    { id: 'a', category: COUPLE },
    { id: 'b' },
    { id: 'c', category: INDIVIDUAL },
    { id: 'd', category: COUPLE },
  ];
  assert.deepEqual(inCategory(albums, COUPLE).map((a) => a.id), ['a', 'd']);
  assert.deepEqual(inCategory(albums, INDIVIDUAL).map((a) => a.id), ['b', 'c']);
  assert.deepEqual(countByCategory(albums), { INDIVIDUAL: 2, COUPLE: 2 });
  assert.deepEqual(countByCategory([]), { INDIVIDUAL: 0, COUPLE: 0 });
});

test('moving goes to the other collection', () => {
  assert.equal(otherCategory(INDIVIDUAL), COUPLE);
  assert.equal(otherCategory(COUPLE), INDIVIDUAL);
  assert.equal(otherCategory(undefined), COUPLE, 'an album with no category is Individual, so it moves to Couple');
});
