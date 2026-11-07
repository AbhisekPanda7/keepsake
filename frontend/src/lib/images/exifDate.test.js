import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseExifDateString, readExifTimestamp, readPhotoDate } from './exifDate.js';

const NOW = new Date(2026, 0, 1).getTime();

/** Builds real TIFF bytes holding the given tags in either byte order. */
function tiff({ little = true, original, digitized, dateTime } = {}) {
  const encode = (text) => [...text].map((c) => c.charCodeAt(0)).concat(0);
  const sub = [];
  if (original) sub.push([0x9003, encode(original)]);
  if (digitized) sub.push([0x9004, encode(digitized)]);
  const main = [];
  if (dateTime) main.push([0x0132, encode(dateTime)]);

  const mainOffset = 8;
  const mainSize = 2 + (main.length + 1) * 12 + 4;
  const subOffset = mainOffset + mainSize;
  const subSize = 2 + sub.length * 12 + 4;
  let dataOffset = subOffset + subSize;
  const dataStart = dataOffset;
  const total = dataStart + [...main, ...sub].reduce((n, [, bytes]) => n + bytes.length, 0);

  const buffer = new ArrayBuffer(total);
  const dv = new DataView(buffer);
  dv.setUint16(0, little ? 0x4949 : 0x4d4d, false);
  dv.setUint16(2, 42, little);
  dv.setUint32(4, mainOffset, little);

  const writeEntry = (at, tag, bytes) => {
    dv.setUint16(at, tag, little);
    dv.setUint16(at + 2, 2, little); // ASCII
    dv.setUint32(at + 4, bytes.length, little);
    dv.setUint32(at + 8, dataOffset, little);
    bytes.forEach((byte, i) => dv.setUint8(dataOffset + i, byte));
    dataOffset += bytes.length;
  };

  dv.setUint16(mainOffset, main.length + 1, little);
  main.forEach(([tag, bytes], i) => writeEntry(mainOffset + 2 + i * 12, tag, bytes));
  const pointer = mainOffset + 2 + main.length * 12;
  dv.setUint16(pointer, 0x8769, little);
  dv.setUint16(pointer + 2, 4, little);
  dv.setUint32(pointer + 4, 1, little);
  dv.setUint32(pointer + 8, subOffset, little);

  dv.setUint16(subOffset, sub.length, little);
  sub.forEach(([tag, bytes], i) => writeEntry(subOffset + 2 + i * 12, tag, bytes));
  return new Uint8Array(buffer);
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};
const text = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const u32be = (n) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const u32le = (n) => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24);

function jpeg(tiffBytes) {
  const payload = concat(text('Exif\0\0'), tiffBytes);
  const size = payload.length + 2;
  return concat(
    Uint8Array.of(0xff, 0xd8),
    // A JFIF block first, as real files have, which the walker must step over.
    Uint8Array.of(0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46),
    Uint8Array.of(0xff, 0xe1, size >> 8, size & 255),
    payload,
    Uint8Array.of(0xff, 0xda, 0x00, 0x02, 0xff, 0xd9),
  ).buffer;
}

function png(tiffBytes) {
  return concat(
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    u32be(2), text('IHDR'), Uint8Array.of(0, 0), u32be(0),
    u32be(tiffBytes.length), text('eXIf'), tiffBytes, u32be(0),
    u32be(0), text('IEND'), u32be(0),
  ).buffer;
}

function webp(tiffBytes, { prefix = false } = {}) {
  const body = prefix ? concat(text('Exif\0\0'), tiffBytes) : tiffBytes;
  const pad = body.length % 2 ? Uint8Array.of(0) : new Uint8Array(0);
  const chunks = concat(text('VP8X'), u32le(1), Uint8Array.of(0, 0), text('EXIF'), u32le(body.length), body, pad);
  return concat(text('RIFF'), u32le(chunks.length + 4), text('WEBP'), chunks).buffer;
}

const at = (y, m, d, h = 0, i = 0, s = 0) => new Date(y, m - 1, d, h, i, s).getTime();

test('reads the capture date from JPEG in both byte orders', () => {
  for (const little of [true, false]) {
    const bytes = jpeg(tiff({ little, original: '2019:07:04 18:30:05' }));
    assert.equal(readExifTimestamp(bytes, NOW), at(2019, 7, 4, 18, 30, 5));
  }
});

test('reads the capture date from PNG and WebP', () => {
  const t = tiff({ original: '2020:02:29 09:00:00' });
  assert.equal(readExifTimestamp(png(t), NOW), at(2020, 2, 29, 9));
  assert.equal(readExifTimestamp(webp(t), NOW), at(2020, 2, 29, 9));
  assert.equal(readExifTimestamp(webp(t, { prefix: true }), NOW), at(2020, 2, 29, 9));
});

test('prefers the moment of capture over later dates', () => {
  const all = { original: '2001:01:01 01:01:01', digitized: '2002:02:02 02:02:02', dateTime: '2003:03:03 03:03:03' };
  assert.equal(readExifTimestamp(jpeg(tiff(all)), NOW), at(2001, 1, 1, 1, 1, 1));
  assert.equal(readExifTimestamp(jpeg(tiff({ digitized: all.digitized, dateTime: all.dateTime })), NOW), at(2002, 2, 2, 2, 2, 2));
  assert.equal(readExifTimestamp(jpeg(tiff({ dateTime: all.dateTime })), NOW), at(2003, 3, 3, 3, 3, 3));
});

test('a placeholder capture date falls through to a real one', () => {
  const bytes = jpeg(tiff({ original: '0000:00:00 00:00:00', dateTime: '2015:05:05 05:05:05' }));
  assert.equal(readExifTimestamp(bytes, NOW), at(2015, 5, 5, 5, 5, 5));
});

test('rejects dates that cannot be real', () => {
  for (const bad of [
    '0000:00:00 00:00:00',
    '    :  :     :  :  ',
    '2021:02:31 10:00:00', // no 31 February
    '2021:13:01 10:00:00',
    '2021:00:10 10:00:00',
    '2021:01:01 25:00:00',
    '2021:01:01 10:61:00',
    '1700:01:01 10:00:00', // before photography
    '2099:01:01 10:00:00', // a camera clock set in the future
    'yesterday',
    '',
    null,
    undefined,
  ]) {
    assert.equal(parseExifDateString(bad, NOW), null, String(bad));
  }
  assert.equal(parseExifDateString('2021:03:04', NOW), at(2021, 3, 4, 12), 'a date alone is usable');
});

test('never throws on damaged files', () => {
  const good = new Uint8Array(jpeg(tiff({ original: '2019:07:04 18:30:05' })));
  // Every possible truncation.
  for (let length = 0; length < good.length; length += 1) {
    assert.doesNotThrow(() => readExifTimestamp(good.slice(0, length).buffer, NOW));
  }
  // Corruption at each byte, in turn.
  for (let i = 0; i < good.length; i += 1) {
    const damaged = good.slice();
    damaged[i] ^= 0xff;
    assert.doesNotThrow(() => readExifTimestamp(damaged.buffer, NOW));
  }
  // Not images at all.
  assert.equal(readExifTimestamp(new ArrayBuffer(0), NOW), null);
  assert.equal(readExifTimestamp(text('just some words in a file').buffer, NOW), null);
  assert.equal(readExifTimestamp(new Uint8Array(4096).buffer, NOW), null);
});

test('a directory pointing at itself cannot hang the reader', () => {
  const t = tiff({ original: '2019:07:04 18:30:05' });
  const dv = new DataView(t.buffer);
  // Point the sub-directory entry back at the main directory.
  dv.setUint32(8 + 2 + 8, 8, true);
  assert.equal(readExifTimestamp(jpeg(t), NOW), null);
});

test('readPhotoDate falls back step by step', async () => {
  const withExif = new File([jpeg(tiff({ original: '2018:08:08 08:08:08' }))], 'a.jpg', { type: 'image/jpeg', lastModified: NOW });
  assert.deepEqual(await readPhotoDate(withExif), { takenAt: at(2018, 8, 8, 8, 8, 8), takenAtSource: 'exif' });

  const without = new File([new Uint8Array(100)], 'b.jpg', { type: 'image/jpeg', lastModified: NOW });
  assert.deepEqual(await readPhotoDate(without), { takenAt: NOW, takenAtSource: 'file' });

  const nothing = new File([new Uint8Array(100)], 'c.png', { type: 'image/png', lastModified: 0 });
  assert.deepEqual(await readPhotoDate(nothing), { takenAt: null, takenAtSource: null });

  const broken = { type: 'image/jpeg', size: 10, lastModified: NOW, slice() { throw new Error('disk failure'); } };
  assert.deepEqual(await readPhotoDate(broken), { takenAt: NOW, takenAtSource: 'file' });
});

test('reads the capture date from a HEIC file', () => {
  const tiff = (date) => {
    const text = [...date].map((ch) => ch.charCodeAt(0)).concat(0);
    const out = new Uint8Array(44 + text.length);
    const dv = new DataView(out.buffer);
    dv.setUint16(0, 0x4949);
    dv.setUint16(2, 42, true);
    dv.setUint32(4, 8, true);
    dv.setUint16(8, 1, true);
    dv.setUint16(10, 0x8769, true);
    dv.setUint16(12, 4, true);
    dv.setUint32(14, 1, true);
    dv.setUint32(18, 26, true);
    dv.setUint16(26, 1, true);
    dv.setUint16(28, 0x9003, true);
    dv.setUint16(30, 2, true);
    dv.setUint32(32, text.length, true);
    dv.setUint32(36, 44, true);
    out.set(text, 44);
    return out;
  };
  const heic = (...parts) => {
    const head = new TextEncoder().encode('\0\0\0\x18ftypheic\0\0\0\0mif1heic');
    const all = [head, new Uint8Array(4000), ...parts, new Uint8Array(4000)];
    const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of all) {
      out.set(p, at);
      at += p.length;
    }
    return out.buffer;
  };
  const marker = new TextEncoder().encode('Exif\0\0');
  const taken = readExifTimestamp(heic(marker, tiff('2022:03:04 05:06:07')));
  assert.equal(new Date(taken).getFullYear(), 2022);
  assert.equal(readExifTimestamp(heic()), null, 'one with no metadata has no date');
  assert.equal(readExifTimestamp(heic(marker, new Uint8Array(20))), null, 'a stray marker is not a date');
});
