/**
 * Prepares an uploaded file for storage: confirms it really is a decodable image,
 * limits the longest side and encodes as JPEG, keeping the aspect ratio.
 *
 * People upload from whatever they have, so this tries hard before giving up. iPhones
 * save HEIC, which Safari reads but Chrome doesn't. A 48-megapixel photo can exhaust a
 * phone's memory, in which case a smaller copy is still far better than an error.
 */

/** Sharp on a large screen, from a file a fraction of the size of a phone's original. */
export const MAX_DIMENSION = 2400;
/** Tried in turn if a phone runs out of memory working at the larger size. */
const FALLBACK_DIMENSIONS = [1600, 1200];
const JPEG_QUALITY = 0.9;
/** A JPEG within the size limit is kept untouched, unless it's very heavy for its size. */
const KEEP_ORIGINAL_UP_TO_BYTES = 6 * 1024 * 1024;
/** Transparent PNG/WebP areas become the album's paper colour rather than black. */
const FLATTEN_COLOR = '#f4ecdc';

const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

export class InvalidImageError extends Error {
  constructor(fileName) {
    super(`"${fileName}" is not an image this browser can read.`);
    this.name = 'InvalidImageError';
  }
}

export function fitWithin(width, height, max = MAX_DIMENSION) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Whether a file's first bytes mark it as HEIC or HEIF, whatever its name or stated type. */
export function isHeifHeader(bytes) {
  if (bytes.length < 12) return false;
  const text = (from, to) => String.fromCharCode(...bytes.slice(from, to));
  return text(4, 8) === 'ftyp' && HEIF_BRANDS.has(text(8, 12));
}

async function looksLikeHeif(file) {
  if (/^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) return true;
  try {
    return isHeifHeader(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  } catch {
    return false;
  }
}

/** An <img> applies EXIF orientation by itself, and works where createImageBitmap doesn't. */
function decodeWithImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () =>
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => URL.revokeObjectURL(url),
      });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('undecodable'));
    };
    image.src = url;
  });
}

async function decodeHere(file) {
  try {
    // from-image applies EXIF orientation, so phone photos are stored upright.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    return decodeWithImage(file);
  }
}

/**
 * Chrome and most other browsers can't read HEIC by themselves. The decoder is about 3 MB,
 * so it's fetched only when someone actually needs it, and never for anyone else.
 */
async function decodeHeif(file) {
  const { heicTo } = await import('heic-to/next');
  const jpeg = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.95 });
  return decodeHere(jpeg);
}

async function decode(file) {
  try {
    return await decodeHere(file);
  } catch {
    if (!(await looksLikeHeif(file))) throw new InvalidImageError(file.name);
  }
  try {
    return await decodeHeif(file);
  } catch {
    throw new InvalidImageError(file.name);
  }
}

/** A JPEG at this size, or null if the browser couldn't allocate or encode it. */
async function encode(image, width, height) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = FLATTEN_COLOR;
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image.source, 0, 0, width, height);
    return await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
    });
  } catch {
    return null;
  }
}

export async function resizeImage(file) {
  // Some systems give no type at all for a HEIC file, so only a stated non-image is refused.
  if (file.type && !file.type.startsWith('image/') && !/\.hei[cf]$/i.test(file.name)) {
    throw new InvalidImageError(file.name);
  }

  const image = await decode(file);
  try {
    const { width, height } = fitWithin(image.width, image.height);
    const fits = width === image.width && height === image.height;

    // A reasonable JPEG already within limits is kept byte for byte: re-encoding would
    // only lose quality, usually without saving any space.
    if (fits && file.type === 'image/jpeg' && file.size <= KEEP_ORIGINAL_UP_TO_BYTES) {
      return { blob: file, width, height };
    }

    for (const max of [MAX_DIMENSION, ...FALLBACK_DIMENSIONS]) {
      const size = fitWithin(image.width, image.height, max);
      const blob = await encode(image, size.width, size.height);
      if (blob) return { blob, width: size.width, height: size.height };
    }
    throw new InvalidImageError(file.name);
  } finally {
    image.close();
  }
}
