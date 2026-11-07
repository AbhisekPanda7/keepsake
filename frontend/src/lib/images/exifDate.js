/**
 * Reads when a photograph was taken from its EXIF metadata.
 *
 * Hand-written rather than a library: only three date fields are needed, from a
 * format that is simple to walk, and an EXIF library would add far more code than
 * this. Files can be damaged or hostile, so every read is bounds-checked (DataView
 * throws when out of range, and that is caught below), the number of entries read is
 * capped, and pointers are only followed one level, so that a loop can't hang it.
 */

const TAG_DATE_TIME = 0x0132; // when the file was last changed; the weakest evidence
const TAG_EXIF_IFD = 0x8769; // pointer to the sub-directory holding the capture dates
const TAG_DATE_ORIGINAL = 0x9003; // the moment the shutter fired
const TAG_DATE_DIGITIZED = 0x9004;

const TYPE_ASCII = 2;
const MAX_ENTRIES = 1024;
const EARLIEST_YEAR = 1826; // the oldest surviving photograph
const ONE_DAY_MS = 86400000;

/** Enough of a JPEG to contain its metadata, which comes before the image data. */
const JPEG_HEAD_BYTES = 512 * 1024;
/** PNG and WebP can put metadata after the image, so more must be read. */
const MAX_WHOLE_FILE_BYTES = 64 * 1024 * 1024;

const ascii = (dv, start, length) => {
  let text = '';
  for (let i = 0; i < length; i += 1) text += String.fromCharCode(dv.getUint8(start + i));
  return text;
};

/**
 * "2024:03:09 14:05:30" as a local timestamp. EXIF dates carry no time zone, so they
 * mean the local time where the photo was taken. Cameras write all sorts of
 * placeholders for an unset clock, so anything that isn't a real date gives null.
 */
export function parseExifDateString(text, now = Date.now()) {
  const match = /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/.exec(text ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 12);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  if (year < EARLIEST_YEAR || hour > 23 || minute > 59 || second > 59) return null;

  const date = new Date(year, month - 1, day, hour, minute, second);
  // JavaScript rolls 31 February over into March; a round trip catches that.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  const timestamp = date.getTime();
  // A camera clock set in the future is wrong; a day's grace allows for time zones.
  return timestamp > now + ONE_DAY_MS ? null : timestamp;
}

/** Reads one directory of tags. Returns text values and the sub-directory pointer. */
function readDirectory(dv, tiffStart, offset, little, wanted) {
  const found = { subDirectory: null };
  const start = tiffStart + offset;
  const count = Math.min(dv.getUint16(start, little), MAX_ENTRIES);
  for (let i = 0; i < count; i += 1) {
    const entry = start + 2 + i * 12;
    const tag = dv.getUint16(entry, little);
    if (tag === TAG_EXIF_IFD) {
      found.subDirectory = dv.getUint32(entry + 8, little);
    } else if (wanted.includes(tag) && dv.getUint16(entry + 2, little) === TYPE_ASCII) {
      const length = dv.getUint32(entry + 4, little);
      // Dates are 20 bytes, so they are stored at an offset, never inline.
      if (length >= 10 && length <= 64) {
        found[tag] = ascii(dv, tiffStart + dv.getUint32(entry + 8, little), length).replace(/\0.*$/, '');
      }
    }
  }
  return found;
}

function dateFromTiff(dv, tiffStart, now) {
  const order = dv.getUint16(tiffStart, false);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  if (dv.getUint16(tiffStart + 2, little) !== 42) return null;

  const main = readDirectory(dv, tiffStart, dv.getUint32(tiffStart + 4, little), little, [TAG_DATE_TIME]);
  const values = { [TAG_DATE_TIME]: main[TAG_DATE_TIME] };
  if (main.subDirectory !== null) {
    try {
      Object.assign(
        values,
        readDirectory(dv, tiffStart, main.subDirectory, little, [TAG_DATE_ORIGINAL, TAG_DATE_DIGITIZED]),
      );
    } catch {
      // A broken sub-directory should not lose a good date from the main one.
    }
  }

  for (const tag of [TAG_DATE_ORIGINAL, TAG_DATE_DIGITIZED, TAG_DATE_TIME]) {
    const timestamp = parseExifDateString(values[tag], now);
    if (timestamp !== null) return timestamp;
  }
  return null;
}

function fromJpeg(dv, now) {
  let i = 2;
  while (i + 4 <= dv.byteLength) {
    if (dv.getUint8(i) !== 0xff) return null;
    const marker = dv.getUint8(i + 1);
    if (marker === 0xff) {
      i += 1; // padding between markers
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null; // image data: no metadata past here
    const size = dv.getUint16(i + 2, false);
    if (size < 2) return null;
    if (marker === 0xe1 && ascii(dv, i + 4, 6) === 'Exif\0\0') {
      return dateFromTiff(dv, i + 10, now);
    }
    i += 2 + size;
  }
  return null;
}

function fromPng(dv, now) {
  let i = 8;
  while (i + 8 <= dv.byteLength) {
    const length = dv.getUint32(i, false);
    const type = ascii(dv, i + 4, 4);
    if (type === 'eXIf') return dateFromTiff(dv, i + 8, now);
    if (type === 'IEND') return null;
    i += 12 + length; // length + type + data + crc
  }
  return null;
}

function fromWebp(dv, now) {
  let i = 12;
  while (i + 8 <= dv.byteLength) {
    const type = ascii(dv, i, 4);
    const length = dv.getUint32(i + 4, true);
    if (type === 'EXIF') {
      // Some writers keep JPEG's "Exif\0\0" prefix in here, others leave it out.
      const start = ascii(dv, i + 8, 4) === 'Exif' ? i + 14 : i + 8;
      return dateFromTiff(dv, start, now);
    }
    i += 8 + length + (length % 2); // chunks are padded to an even size
  }
  return null;
}

/**
 * HEIC keeps its EXIF as a data item whose place is recorded in a box structure. It always
 * starts with the same marker and a TIFF header, so finding those is simpler and just as
 * reliable as walking the boxes.
 */
function fromHeif(dv, now) {
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
  for (let i = 0; i + 10 < bytes.length; i += 1) {
    if (bytes[i] !== 0x45 || bytes[i + 1] !== 0x78 || ascii(dv, i, 6) !== 'Exif\0\0') continue;
    const order = ascii(dv, i + 6, 2);
    if (order === 'II' || order === 'MM') {
      const timestamp = dateFromTiff(dv, i + 6, now);
      if (timestamp !== null) return timestamp;
    }
  }
  return null;
}

/** The capture time held in an image's bytes, or null if there isn't a valid one. */
export function readExifTimestamp(buffer, now = Date.now()) {
  try {
    const dv = new DataView(buffer);
    if (dv.byteLength < 12) return null;
    if (dv.getUint16(0, false) === 0xffd8) return fromJpeg(dv, now);
    if (dv.getUint32(0, false) === 0x89504e47) return fromPng(dv, now);
    if (ascii(dv, 0, 4) === 'RIFF' && ascii(dv, 8, 4) === 'WEBP') return fromWebp(dv, now);
    if (ascii(dv, 4, 4) === 'ftyp') return fromHeif(dv, now);
    return null;
  } catch {
    return null; // truncated or malformed metadata is the same as having none
  }
}

/**
 * The best date available for an uploaded file: the camera's own record, then the
 * file's modified date, and otherwise nothing. Never throws.
 */
export async function readPhotoDate(file) {
  try {
    const isJpeg = file.type === 'image/jpeg';
    if (isJpeg || file.size <= MAX_WHOLE_FILE_BYTES) {
      const bytes = isJpeg ? file.slice(0, JPEG_HEAD_BYTES) : file;
      const timestamp = readExifTimestamp(await bytes.arrayBuffer());
      if (timestamp !== null) return { takenAt: timestamp, takenAtSource: 'exif' };
    }
  } catch {
    // Falls through to the file date.
  }
  if (Number.isFinite(file.lastModified) && file.lastModified > 0) {
    return { takenAt: file.lastModified, takenAtSource: 'file' };
  }
  return { takenAt: null, takenAtSource: null };
}
