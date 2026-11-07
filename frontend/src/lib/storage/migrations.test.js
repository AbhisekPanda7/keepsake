import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_THEME, normalizeTheme, resolveTheme } from '../album/themes.js';
import { DEFAULT_TITLE, LEGACY_ALBUM_ID, albumRecordsForUpgrade, completeAlbumRecord } from './migrations.js';

const NOW = 5_000_000;
const photo = (id, addedAt, albumId = LEGACY_ALBUM_ID) => ({ id, albumId, order: 0, addedAt });

test('a version 1 album with photographs but no record gets one', () => {
  const [album, ...rest] = albumRecordsForUpgrade([], [photo('a', 100), photo('b', 300), photo('c', 200)], NOW);
  assert.equal(rest.length, 0);
  assert.equal(album.id, LEGACY_ALBUM_ID, 'keeps the id its photographs already point to');
  assert.equal(album.title, DEFAULT_TITLE);
  assert.equal(album.createdAt, 100, 'created when its first photo was added');
  assert.equal(album.updatedAt, 300, 'updated when its last photo was added');
  assert.deepEqual(album.theme, { ...DEFAULT_THEME }, 'looks the same as before');
  assert.equal(album.description, '');
});

test('a renamed version 1 album keeps its title', () => {
  const [album] = albumRecordsForUpgrade([{ id: LEGACY_ALBUM_ID, title: 'Family 1998' }], [photo('a', 100)], NOW);
  assert.equal(album.title, 'Family 1998');
  assert.equal(album.createdAt, 100);
});

test('a renamed album with no photographs left is kept', () => {
  const [album] = albumRecordsForUpgrade([{ id: LEGACY_ALBUM_ID, title: 'Empty now' }], [], NOW);
  assert.equal(album.title, 'Empty now');
  assert.equal(album.createdAt, NOW);
});

test('an unused version 1 database gives an empty library', () => {
  assert.deepEqual(albumRecordsForUpgrade([], [], NOW), []);
});

test('no photograph is left without an album, whatever album it names', () => {
  const records = albumRecordsForUpgrade(
    [{ id: 'one', title: 'One' }],
    [photo('a', 1, 'one'), photo('b', 2, 'two'), { id: 'c', order: 0, addedAt: 3 }],
    NOW,
  );
  assert.deepEqual(records.map((r) => r.id).sort(), [LEGACY_ALBUM_ID, 'one', 'two'].sort());
});

test('running the upgrade over complete records changes nothing', () => {
  const full = { id: 'x', title: 'T', description: 'D', theme: { colour: 'forest', material: 'linen', paper: 'black' }, createdAt: 1, updatedAt: 2 };
  assert.deepEqual(completeAlbumRecord('x', full, [photo('a', 9)], NOW), full);
});

test('damaged records are repaired rather than rejected', () => {
  const album = completeAlbumRecord('x', { title: '   ', description: 7, theme: { colour: 'neon' }, createdAt: 'then' }, [], NOW);
  assert.equal(album.title, DEFAULT_TITLE);
  assert.equal(album.description, '');
  assert.equal(album.theme.colour, DEFAULT_THEME.colour);
  assert.equal(album.createdAt, NOW);
});

test('themes tolerate anything stored, including keys inherited from Object', () => {
  assert.deepEqual(normalizeTheme(undefined), { ...DEFAULT_THEME });
  assert.deepEqual(normalizeTheme({ colour: 'constructor', material: 'toString', paper: '__proto__' }), { ...DEFAULT_THEME });
  assert.deepEqual(normalizeTheme({ colour: 'sand', material: 'linen', paper: 'kraft' }), { colour: 'sand', material: 'linen', paper: 'kraft' });
  const resolved = resolveTheme({ colour: 'midnight', paper: 'black' });
  assert.equal(resolved.key, 'midnight-leather-black');
  assert.equal(resolved.colourInfo.name, 'Midnight');
  assert.equal(resolved.paperInfo.name, 'Black card');
});
