/**
 * Every material surface is drawn here on plain canvases, with no image downloads:
 * paper, leather, book linen, foil tooling, endpapers and the table. No Three.js here,
 * so the album library can use the same cover art without loading a 3D engine. Each
 * canvas is built once on first use, per theme, and then shared.
 */
import { PAGE_HEIGHT, PAGE_WIDTH } from './bookModel.js';
import { atCorners, cornerScroll, crest, divider, foilFill, pressed } from './ornaments.js';

const cache = new Map();

function once(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}

export function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// ---- photographed leather -----------------------------------------------------

/**
 * Scanned leather (ambientCG, CC0), used as plain grey maps and tinted to a theme's colour.
 * Anything that fails to load falls back to the procedural grain below, so a book can
 * always be drawn.
 */
const LEATHER_FILES = { color: 'leather-color', height: 'leather-height', rough: 'leather-rough' };
const leatherImages = {};
let leatherLoading = null;

function loadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export function leatherReady() {
  leatherLoading ??= Promise.all(
    Object.entries(LEATHER_FILES).map(async ([key, file]) => {
      leatherImages[key] = await loadImage(`/scene/textures/${file}.webp`);
    }),
  );
  return leatherLoading;
}

const hasLeather = () => Boolean(leatherImages.color && leatherImages.height);

/** Everything cover art depends on. Awaited before any cover is drawn. */
export const coverArtReady = () => Promise.all([fontsReady(), leatherReady()]);

// ---- photographed paper --------------------------------------------------------

/** Cold-press paper (ambientCG, CC0). Pages fall back to drawn grain if it can't be loaded. */
const paperImages = {};
let paperLoading = null;

export function paperReady() {
  paperLoading ??= Promise.all(
    ['tooth', 'relief'].map(async (key) => {
      paperImages[key] = await loadImage(`/scene/textures/paper-${key}.webp`);
    }),
  );
  return paperLoading;
}

/** The scan, stretched to run from its mid-tone up to white, for multiplying over a page. */
export function paperToothCanvas() {
  if (!paperImages.tooth) return null;
  return once('paperTooth', () => {
    const size = paperImages.tooth.width;
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(paperImages.tooth, 0, 0, size, size);
    const image = ctx.getImageData(0, 0, size, size);
    const { data } = image;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i];
    const mean = sum / (data.length / 4) || 1;
    for (let i = 0; i < data.length; i += 4) {
      const value = Math.min(255, 251 + (data[i] - mean) * 1.3);
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  });
}

/** Small seeded generator so that textures look the same on every visit. */
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth tileable value noise, as a Float32Array of values in 0..1. */
function valueNoise(size, cells, random) {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = random();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const fy = (y / size) * cells;
    const y0 = Math.floor(fy);
    const ky = fy - y0;
    const sy = ky * ky * (3 - 2 * ky);
    for (let x = 0; x < size; x += 1) {
      const fx = (x / size) * cells;
      const x0 = Math.floor(fx);
      const kx = fx - x0;
      const sx = kx * kx * (3 - 2 * kx);
      const a = lattice[y0 * cells + x0];
      const b = lattice[y0 * cells + ((x0 + 1) % cells)];
      const c = lattice[((y0 + 1) % cells) * cells + x0];
      const d = lattice[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
      out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
  }
  return out;
}

export function grayscaleCanvas(size, sample) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i += 1) {
    const value = Math.max(0, Math.min(255, sample(i) * 255));
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value;
    image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// ---- paper ----------------------------------------------------------------

/** Tileable canvas of faint fibres and mottling, drawn beneath all page artwork. */
export function paperGrainCanvas(paper) {
  return once(`paperGrain:${paper.rgb}`, () => {
    const size = 512;
    const random = seededRandom(11);
    const coarse = valueNoise(size, 6, random);
    const fine = valueNoise(size, 96, random);
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);
    const [r, g, b] = paper.rgb;
    for (let i = 0; i < size * size; i += 1) {
      const shade = (coarse[i] - 0.5) * 6 + (fine[i] - 0.5) * 7;
      image.data[i * 4] = r + shade;
      image.data[i * 4 + 1] = g + shade;
      image.data[i * 4 + 2] = b + shade * 1.2;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 1500; i += 1) {
      const x = random() * size;
      const y = random() * size;
      const angle = random() * Math.PI;
      const length = 4 + random() * 16;
      ctx.strokeStyle = random() > 0.5 ? `rgba(${paper.faint},0.05)` : 'rgba(255,252,240,0.09)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      ctx.stroke();
    }
    return canvas;
  });
}

export function paperBumpCanvas() {
  if (paperImages.relief) {
    return once('paperBumpScan', () => {
      const canvas = makeCanvas(512, 512);
      canvas.getContext('2d').drawImage(paperImages.relief, 0, 0, 512, 512);
      return canvas;
    });
  }
  return once('paperBump', () => {
    const size = 256;
    const random = seededRandom(23);
    const a = valueNoise(size, 64, random);
    const b = valueNoise(size, 128, random);
    return grayscaleCanvas(size, (i) => 0.5 + (a[i] - 0.5) * 0.5 + (b[i] - 0.5) * 0.5);
  });
}

/** Horizontal hairlines reading as many sheets of paper seen edge-on, in the paper's tone. */
export function pageEdgeCanvas(paper) {
  return once(`pageEdge:${paper.rgb}`, () => {
    const height = 128;
    const random = seededRandom(7);
    const canvas = makeCanvas(8, height);
    const ctx = canvas.getContext('2d');
    const [r, g, b] = paper.rgb;
    for (let y = 0; y < height; y += 1) {
      const dip = y % 4 === 0 ? 0.78 : 0.96;
      const jitter = 1 + (random() - 0.5) * 0.08;
      ctx.fillStyle = `rgb(${r * dip * jitter},${g * dip * jitter},${b * dip * jitter})`;
      ctx.fillRect(0, y, 8, 1);
    }
    return canvas;
  });
}

// ---- cover materials ----------------------------------------------------------

/**
 * Leather's pebbled grain is the pattern of raised cells around creases, which is
 * what Worley (cellular) noise produces: distance to the nearest of many scattered
 * points. The lattice wraps around so that the grain tiles without a seam.
 */
function leatherGrain() {
  return once('leatherGrain', () => {
    const size = 512;
    const cells = 54;
    const random = seededRandom(31);
    const px = new Float32Array(cells * cells);
    const py = new Float32Array(cells * cells);
    for (let i = 0; i < cells * cells; i += 1) {
      px[i] = random();
      py[i] = random();
    }
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
      const fy = (y / size) * cells;
      const cy = Math.floor(fy);
      for (let x = 0; x < size; x += 1) {
        const fx = (x / size) * cells;
        const cx = Math.floor(fx);
        let d1 = 9;
        let d2 = 9;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const lx = (cx + ox + cells) % cells;
            const ly = (cy + oy + cells) % cells;
            const dx = cx + ox + px[ly * cells + lx] - fx;
            const dy = cy + oy + py[ly * cells + lx] - fy;
            const d = dx * dx + dy * dy;
            if (d < d1) {
              d2 = d1;
              d1 = d;
            } else if (d < d2) {
              d2 = d;
            }
          }
        }
        // Near zero along creases, where two cells are equally close.
        out[y * size + x] = Math.min(1, (Math.sqrt(d2) - Math.sqrt(d1)) * 3.4);
      }
    }
    return out;
  });
}

/** Woven book cloth: threads over and under each other, with slight irregularity. */
function linenGrain() {
  return once('linenGrain', () => {
    const size = 512;
    const threads = 96;
    const random = seededRandom(41);
    const slub = valueNoise(size, 48, random);
    const thickX = new Float32Array(threads);
    const thickY = new Float32Array(threads);
    for (let i = 0; i < threads; i += 1) {
      thickX[i] = 0.75 + random() * 0.5;
      thickY[i] = 0.75 + random() * 0.5;
    }
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
      const fy = (y / size) * threads;
      const ty = Math.floor(fy);
      for (let x = 0; x < size; x += 1) {
        const fx = (x / size) * threads;
        const tx = Math.floor(fx);
        const over = (tx + ty) % 2 === 0;
        const across = Math.sin((fx - tx) * Math.PI) * thickX[tx];
        const along = Math.sin((fy - ty) * Math.PI) * thickY[ty];
        const height = over ? across : along;
        out[y * size + x] = Math.min(1, height * 0.82 + (slub[y * size + x] - 0.5) * 0.4);
      }
    }
    return out;
  });
}

const grainOf = (material) => (material === 'linen' ? linenGrain() : leatherGrain());

/** Tileable cover surface in a colour. Light colours show less grain contrast. */
export function coverBaseCanvas(colour, material) {
  const scanned = material === 'leather' && hasLeather();
  return once(`coverBase:${colour.rgb}:${material}:${scanned}`, () => {
    if (scanned) return tintedLeather(colour);
    const size = 512;
    const grain = grainOf(material);
    const mottle = valueNoise(size, 8, seededRandom(5));
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);
    const grainAmount = material === 'linen' ? 0.34 : 0.3;
    const floor = material === 'linen' ? 0.76 : 0.72;
    for (let i = 0; i < size * size; i += 1) {
      const shade = floor + grain[i] * grainAmount + (mottle[i] - 0.5) * (material === 'linen' ? 0.08 : 0.22);
      image.data[i * 4] = colour.rgb[0] * shade;
      image.data[i * 4 + 1] = colour.rgb[1] * shade;
      image.data[i * 4 + 2] = colour.rgb[2] * shade;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  });
}

/**
 * The scan's own light and dark, around the cover's colour. Dividing by the scan's average
 * keeps every theme the colour it was chosen to be. Darker creases go further toward black
 * than highlights go toward white, as in real dyed hide.
 */
function tintedLeather(colour) {
  const size = leatherImages.color.width;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(leatherImages.color, 0, 0, size, size);
  const image = ctx.getImageData(0, 0, size, size);
  const { data } = image;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += data[i];
  const mean = sum / (data.length / 4) || 1;
  for (let i = 0; i < data.length; i += 4) {
    const k = data[i] / mean;
    const shade = k < 1 ? 1 - (1 - k) * 1.5 : 1 + (k - 1) * 1.15;
    data[i] = colour.rgb[0] * shade;
    data[i + 1] = colour.rgb[1] * shade;
    data[i + 2] = colour.rgb[2] * shade;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function coverBumpCanvas(material) {
  const scanned = material === 'leather' && hasLeather();
  return once(`coverBump:${material}:${scanned}`, () => {
    if (scanned) {
      const canvas = makeCanvas(1024, 1024);
      canvas.getContext('2d').drawImage(leatherImages.height, 0, 0, 1024, 1024);
      return canvas;
    }
    const grain = grainOf(material);
    return grayscaleCanvas(512, (i) => 0.15 + grain[i] * 0.8);
  });
}

// ---- type -------------------------------------------------------------------

/** Font of the page's display face, resolved from CSS for use in canvas. */
export function fontFamily() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim();
  return value || 'Georgia, serif';
}

/** A person's handwriting, for captions: they read as written into the album. */
export function handFontFamily() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--font-hand').trim();
  return value || `italic ${fontFamily()}`;
}

export function bodyFontFamily() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--font-body').trim();
  return value || 'Georgia, serif';
}

/** Waits for web fonts, so canvas text is not drawn in a fallback face. */
export async function fontsReady() {
  try {
    const display = fontFamily();
    const body = bodyFontFamily();
    await Promise.all([
      document.fonts.load(`500 40px ${display}`),
      document.fonts.load(`600 40px ${display}`),
      document.fonts.load(`italic 500 40px ${display}`),
      document.fonts.load(`400 40px ${body}`),
      document.fonts.load(`italic 400 40px ${body}`),
      document.fonts.load(`500 40px ${handFontFamily()}`),
    ]);
    await document.fonts.ready;
  } catch {
    // Text will use the fallback face; nothing else is affected.
  }
}

/** Shrinks the current font just enough for a long title to fit on one line. */
export function fitText(ctx, text, maxWidth) {
  const measured = ctx.measureText(text).width;
  if (measured <= maxWidth) return;
  const size = parseFloat(ctx.font.match(/([\d.]+)px/)[1]);
  ctx.font = ctx.font.replace(/[\d.]+px/, `${(size * maxWidth) / measured}px`);
}

function drawDiamond(ctx, x, y, r, style) {
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
}

// ---- cover art ----------------------------------------------------------------

/**
 * Tooling is a single drawing painted in three versions: colour, surface
 * properties and relief. Doing it this way keeps them aligned, so the foil is
 * pressed into the cover and shines like metal while the cover itself stays matte.
 */
function drawTooling(ctx, w, h, foil, { title, hingeLeft }) {
  const line = (inset, width, style) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    const left = hingeLeft ? inset + w * 0.075 : inset;
    const right = hingeLeft ? w - inset : w - inset - w * 0.075;
    ctx.strokeRect(left, inset, right - left, h - inset * 2);
  };
  line(w * 0.05, w * 0.0065, foil);
  line(w * 0.064, w * 0.0022, foil);

  const left = hingeLeft ? w * 0.125 : w * 0.05;
  const right = hingeLeft ? w * 0.95 : w * 0.875;
  const cx = (left + right) / 2;

  // Small tooled flourish at each corner of the frame.
  const corner = (x, y, sx, sy) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, sy);
    ctx.strokeStyle = foil;
    ctx.lineWidth = w * 0.0026;
    const r = w * 0.05;
    ctx.beginPath();
    ctx.moveTo(r * 1.15, 0);
    ctx.bezierCurveTo(r * 0.55, r * 0.1, r * 0.3, r * 0.3, r * 0.42, r * 0.5);
    ctx.bezierCurveTo(r * 0.52, r * 0.68, r * 0.78, r * 0.48, r * 0.6, r * 0.34);
    ctx.moveTo(0, r * 1.15);
    ctx.bezierCurveTo(r * 0.1, r * 0.55, r * 0.3, r * 0.3, r * 0.5, r * 0.42);
    ctx.bezierCurveTo(r * 0.68, r * 0.52, r * 0.48, r * 0.78, r * 0.34, r * 0.6);
    ctx.stroke();
    ctx.fillStyle = foil;
    ctx.beginPath();
    ctx.arc(r * 0.17, r * 0.17, w * 0.0065, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  const top = w * 0.08;
  const bottom = h - w * 0.08;
  corner(left + w * 0.03, top, 1, 1);
  corner(right - w * 0.03, top, -1, 1);
  corner(left + w * 0.03, bottom, 1, -1);
  corner(right - w * 0.03, bottom, -1, -1);

  if (!title) {
    drawDiamond(ctx, cx, h / 2, w * 0.028, foil);
    return;
  }

  ctx.fillStyle = foil;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${w * 0.102}px ${fontFamily()}`;
  fitText(ctx, title, (right - left) * 0.8);
  ctx.fillText(title, cx, h * 0.45);

  ctx.strokeStyle = foil;
  ctx.lineWidth = w * 0.0024;
  const y = h * 0.53;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.15, y);
  ctx.lineTo(cx - w * 0.035, y);
  ctx.moveTo(cx + w * 0.035, y);
  ctx.lineTo(cx + w * 0.15, y);
  ctx.stroke();
  drawDiamond(ctx, cx, y, w * 0.012, foil);
}

/** How much of a tile shows across a 1024px cover: below 1, the grain draws larger. */
const GRAIN_SCALE = { leather: 0.72, linen: 1 };

/** Fills a canvas with a tile, keeping the tile's size relative to a 1024px cover. */
function tile(ctx, source, w, h, grainScale = 1) {
  const scale = (w / 1024) * grainScale;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = ctx.createPattern(source, 'repeat');
  ctx.fillRect(0, 0, w / scale, h / scale);
  ctx.restore();
}

/** Saddle stitching around the edge of a cover: short, slightly uneven lengths of thread. */
function drawStitches(ctx, w, h, style, hingeLeft) {
  const inset = w * 0.026;
  const left = hingeLeft ? w * 0.082 : inset;
  const right = hingeLeft ? w - inset : w * 0.918;
  const top = inset;
  const bottom = h - inset;
  const dash = w * 0.0135;
  const gap = w * 0.0072;
  const random = seededRandom(17);
  ctx.strokeStyle = style;
  ctx.lineWidth = w * 0.0031;
  ctx.lineCap = 'round';
  const run = (x0, y0, x1, y1) => {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / length;
    const uy = (y1 - y0) / length;
    for (let d = 0; d < length - dash * 0.5; d += dash + gap) {
      const wobble = (random() - 0.5) * w * 0.0011;
      ctx.beginPath();
      ctx.moveTo(x0 + ux * d - uy * wobble, y0 + uy * d + ux * wobble);
      ctx.lineTo(x0 + ux * (d + dash) + uy * wobble, y0 + uy * (d + dash) - ux * wobble);
      ctx.stroke();
    }
  };
  run(left, top, right, top);
  run(right, top, right, bottom);
  run(right, bottom, left, bottom);
  run(left, bottom, left, top);
  ctx.lineCap = 'butt';
}

/**
 * Blind tooling: a lattice pressed into the leather with no foil, seen only as light
 * rakes across it. The middle stays clear so that the title has room.
 */
function drawBlindTooling(ctx, w, h, style, hingeLeft) {
  const left = hingeLeft ? w * 0.158 : w * 0.082;
  const right = hingeLeft ? w * 0.918 : w * 0.842;
  const top = w * 0.112;
  const bottom = h - w * 0.112;
  const cx = (left + right) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, right - left, bottom - top);
  ctx.ellipse(cx, h * 0.47, (right - left) * 0.43, h * 0.2, 0, 0, Math.PI * 2);
  ctx.clip('evenodd');
  ctx.strokeStyle = style;
  ctx.lineWidth = w * 0.0024;
  const step = w * 0.1;
  ctx.beginPath();
  for (let d = -h; d < w + h; d += step) {
    ctx.moveTo(d, 0);
    ctx.lineTo(d + h, h);
    ctx.moveTo(d + h, 0);
    ctx.lineTo(d, h);
  }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = style;
  ctx.lineWidth = w * 0.003;
  ctx.beginPath();
  ctx.ellipse(cx, h * 0.47, (right - left) * 0.43, h * 0.2, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function softInk(colour) {
  const luminance = colour.rgb[0] * 0.3 + colour.rgb[1] * 0.59 + colour.rgb[2] * 0.11;
  return luminance > 110 ? 'rgba(40,24,12,0.7)' : 'rgba(226,204,160,0.72)';
}

/** The visible cover. Used at full size on the 3D book and small in the library. */
export function drawCoverColour(canvas, { title, hingeLeft, theme }) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  const { colourInfo, material } = theme;
  tile(ctx, coverBaseCanvas(colourInfo, material), w, h, GRAIN_SCALE[material]);

  // The hinge groove is pressed in near the spine and shows as a dark band.
  const grooveX = hingeLeft ? w * 0.052 : w * 0.948;
  const groove = ctx.createLinearGradient(grooveX - w * 0.022, 0, grooveX + w * 0.022, 0);
  groove.addColorStop(0, 'rgba(10,4,1,0)');
  groove.addColorStop(0.5, 'rgba(10,4,1,0.62)');
  groove.addColorStop(1, 'rgba(10,4,1,0)');
  ctx.fillStyle = groove;
  ctx.fillRect(0, 0, w, h);

  // Decades of handling: edges darkened by hands, and a little more at the fore-edge.
  const edge = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.74);
  edge.addColorStop(0, 'rgba(14,6,2,0)');
  edge.addColorStop(1, 'rgba(14,6,2,0.5)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);

  drawBlindTooling(ctx, w, h, 'rgba(8,3,1,0.13)', hingeLeft);
  drawStitches(ctx, w, h, softInk(colourInfo), hingeLeft);

  ctx.save();
  ctx.translate(w * 0.0014, w * 0.0018);
  drawTooling(ctx, w, h, 'rgba(10,4,1,0.72)', { title, hingeLeft });
  ctx.restore();
  drawTooling(ctx, w, h, colourInfo.foil, { title, hingeLeft });
}

export const COVER_ASPECT = PAGE_HEIGHT / PAGE_WIDTH;

/**
 * Turns a height drawing into a tangent-space normal map. Three.js can't combine a normal
 * map with a bump map, and a single baked map lets the leather's grain, the stitches and the
 * raised foil all light correctly together.
 */
export function bakeNormalMap(heightCanvas, strength) {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const source = heightCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h);
  const outCtx = out.getContext('2d');
  const image = outCtx.createImageData(w, h);
  const { data } = image;
  for (let y = 0; y < h; y += 1) {
    const up = (y === 0 ? y : y - 1) * w;
    const down = (y === h - 1 ? y : y + 1) * w;
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      const l = x === 0 ? x : x - 1;
      const r = x === w - 1 ? x : x + 1;
      const dx = (source[(row + r) * 4] - source[(row + l) * 4]) * strength;
      const dy = (source[(up + x) * 4] - source[(down + x) * 4]) * strength;
      const scale = 1 / Math.sqrt(dx * dx + dy * dy + 65025);
      const i = (row + x) * 4;
      data[i] = (-dx * scale * 255 + 255) / 2;
      data[i + 1] = (-dy * scale * 255 + 255) / 2;
      data[i + 2] = (255 * scale * 255 + 255) / 2;
      data[i + 3] = 255;
    }
  }
  outCtx.putImageData(image, 0, 0);
  return out;
}

/** The three aligned full-size maps for the 3D book's cover. */
export function drawCoverMaps({ title, hingeLeft, theme, width = 2048 }) {
  const w = width;
  const h = Math.round(w * COVER_ASPECT);
  const { material } = theme;
  const colorCanvas = makeCanvas(w, h);
  drawCoverColour(colorCanvas, { title, hingeLeft, theme });

  // Surface: three.js reads roughness from G and metalness from B.
  // Not fully metallic: foil pressed into a cover also scatters light, which keeps the
  // lettering legible when no reflection happens to be lined up with the viewer.
  const surfaceCanvas = makeCanvas(w, h);
  const surface = surfaceCanvas.getContext('2d');
  const coverRough = Math.min(255, Math.round(theme.materialInfo.roughness * (material === 'leather' && leatherImages.rough ? 300 : 240)));
  if (material === 'leather' && leatherImages.rough) {
    tile(surface, leatherImages.rough, w, h, GRAIN_SCALE.leather * 2);
    surface.globalCompositeOperation = 'multiply';
    surface.fillStyle = `rgb(0,${coverRough},0)`;
    surface.fillRect(0, 0, w, h);
    surface.globalCompositeOperation = 'source-over';
  } else {
    surface.fillStyle = `rgb(0,${coverRough},0)`;
    surface.fillRect(0, 0, w, h);
  }
  drawTooling(surface, w, h, 'rgb(0,88,205)', { title, hingeLeft });

  // Relief, where lighter is higher. Grain first, softened into the same range as the rest.
  const reliefCanvas = makeCanvas(w, h);
  const relief = reliefCanvas.getContext('2d', { willReadFrequently: true });
  tile(relief, coverBumpCanvas(material), w, h, GRAIN_SCALE[material]);
  relief.fillStyle = 'rgba(128,128,128,0.5)';
  relief.fillRect(0, 0, w, h);

  // A padded board: its surface rolls away toward every edge.
  const roll = (x0, y0, x1, y1) => {
    const g = relief.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(0,0,0,0.72)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    relief.fillStyle = g;
    relief.fillRect(0, 0, w, h);
  };
  const pad = w * 0.022;
  roll(0, 0, 0, pad);
  roll(0, h, 0, h - pad);
  roll(w, 0, w - pad, 0);
  roll(0, 0, pad, 0);

  // The hinge groove, pressed deep.
  const grooveX = hingeLeft ? w * 0.052 : w * 0.948;
  const groove = relief.createLinearGradient(grooveX - w * 0.018, 0, grooveX + w * 0.018, 0);
  groove.addColorStop(0, 'rgba(0,0,0,0)');
  groove.addColorStop(0.5, 'rgba(0,0,0,0.85)');
  groove.addColorStop(1, 'rgba(0,0,0,0)');
  relief.fillStyle = groove;
  relief.fillRect(0, 0, w, h);

  // Each is drawn on a layer and softened once. A canvas filter set while drawing is
  // applied to every single stroke, and at this size hundreds of stitches took over a minute.
  const softened = (blur, draw) => {
    const layer = makeCanvas(w, h);
    draw(layer.getContext('2d'));
    relief.filter = `blur(${w * blur}px)`;
    relief.drawImage(layer, 0, 0);
    relief.filter = 'none';
  };
  softened(0.0009, (ctx) => drawBlindTooling(ctx, w, h, 'rgba(0,0,0,0.3)', hingeLeft));
  // Each stitch sits in a little channel, with its thread standing proud of the leather.
  softened(0.0012, (ctx) => drawStitches(ctx, w, h, 'rgba(0,0,0,0.5)', hingeLeft));
  softened(0.0006, (ctx) => drawStitches(ctx, w, h, 'rgba(255,255,255,0.75)', hingeLeft));
  // The foil tooling stands raised, with its edges rounded over by the blur.
  softened(0.0011, (ctx) => drawTooling(ctx, w, h, 'rgba(255,255,255,0.9)', { title, hingeLeft }));

  const normalCanvas = bakeNormalMap(reliefCanvas, material === 'leather' ? 1.5 : 1.1);
  return { colorCanvas, surfaceCanvas, normalCanvas };
}

/**
 * The spine, as colour, surface and relief, with its raised bands and the title reading
 * from head to foot. `bands` are heights from 0 at the foot to 1 at the head.
 */
export const SPINE_BANDS = [0.13, 0.27, 0.73, 0.87];

export function drawSpineMaps({ title, theme }) {
  const w = 384;
  const h = 1536;
  const { colourInfo, material } = theme;
  const colorCanvas = makeCanvas(w, h);
  const color = colorCanvas.getContext('2d');
  tile(color, coverBaseCanvas(colourInfo, material), 1024, 4096, GRAIN_SCALE[material]);
  const surfaceCanvas = makeCanvas(w, h);
  const surface = surfaceCanvas.getContext('2d');
  surface.fillStyle = `rgb(0,${Math.round(theme.materialInfo.roughness * 215)},0)`;
  surface.fillRect(0, 0, w, h);

  const paint = (ctx, foil) => {
    ctx.fillStyle = foil;
    ctx.strokeStyle = foil;
    for (const band of SPINE_BANDS) {
      const y = h * (1 - band);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, y - 34);
      ctx.lineTo(w, y - 34);
      ctx.moveTo(0, y + 34);
      ctx.lineTo(w, y + 34);
      ctx.stroke();
    }
    drawDiamond(ctx, w / 2, h * (1 - 0.2), 15, foil);
    drawDiamond(ctx, w / 2, h * (1 - 0.8), 15, foil);
    if (!title) return;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${w * 0.3}px ${fontFamily()}`;
    fitText(ctx, title, h * 0.4);
    ctx.fillText(title, 0, 0);
    ctx.restore();
  };
  paint(color, colourInfo.foil);
  paint(surface, 'rgb(0,88,205)');
  return { colorCanvas, surfaceCanvas };
}
// ---- endpapers ------------------------------------------------------------------

/** The patterned paper pasted inside each cover, in a tone of the cover's colour. */
export function endpaperCanvas(colour) {
  return once(`endpaper:${colour.endpaper}:${colour.foil}`, () => {
    const w = 1024;
    const h = Math.round(w * COVER_ASPECT);
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = colour.endpaper;
    ctx.fillRect(0, 0, w, h);
    const hex = colour.foil.replace('#', '');
    const foil = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
    const step = w / 14;
    for (let row = 0; row * step * 0.5 < h + step; row += 1) {
      for (let col = -1; col * step < w + step; col += 1) {
        const x = col * step + (row % 2 ? step / 2 : 0);
        const y = row * step * 0.5;
        ctx.strokeStyle = `rgba(${foil},0.34)`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, y - step * 0.42);
        ctx.quadraticCurveTo(x + step * 0.12, y - step * 0.08, x + step * 0.42, y);
        ctx.quadraticCurveTo(x + step * 0.12, y + step * 0.08, x, y + step * 0.42);
        ctx.quadraticCurveTo(x - step * 0.12, y + step * 0.08, x - step * 0.42, y);
        ctx.quadraticCurveTo(x - step * 0.12, y - step * 0.08, x, y - step * 0.42);
        ctx.stroke();
        drawDiamond(ctx, x, y, step * 0.05, `rgba(${foil},0.5)`);
      }
    }
    return canvas;
  });
}

/**
 * The lining of each board: the cover's own leather, a shade deeper, with gilt tooling.
 * Inside the front board a crest and the album's maker's mark sit in the middle, as in a
 * presentation album; inside the back board only the border and corners. Needs the web
 * fonts and the scanned leather, so it's drawn once coverArtReady() has resolved.
 */
export function liningCanvas(colour, material, { crest: withCrest }) {
  const scanned = material === 'leather' && hasLeather();
  return once(`lining:${colour.rgb}:${colour.foil}:${material}:${scanned}:${withCrest}`, () => {
    const w = 1024;
    const h = Math.round(w * COVER_ASPECT);
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d');

    // A deeper, richer tone of the cover, so the gilt glows against it.
    const deeper = { ...colour, rgb: colour.rgb.map((c) => Math.round(c * 0.72)) };
    const base = coverBaseCanvas(deeper, material);
    tile(ctx, base, w, h, GRAIN_SCALE[material] ?? 1);
    const vignette = ctx.createRadialGradient(w / 2, h * 0.46, w * 0.18, w / 2, h / 2, w * 0.82);
    vignette.addColorStop(0, 'rgba(255,214,150,0.07)');
    vignette.addColorStop(0.6, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(8,3,0,0.42)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    const gold = foilFill(ctx, colour.foil, w, h);
    ctx.strokeStyle = gold;
    ctx.fillStyle = gold;
    const unit = w / 1000;

    pressed(ctx, 2.2 * unit, () => {
      // A double rule all round.
      const outer = w * 0.055;
      ctx.lineWidth = 5 * unit;
      ctx.strokeRect(outer, outer, w - outer * 2, h - outer * 2);
      ctx.lineWidth = 1.8 * unit;
      const inner = outer + 14 * unit;
      ctx.strokeRect(inner, inner, w - inner * 2, h - inner * 2);
      // Scrollwork filling each corner of the frame.
      const c = inner + 10 * unit;
      atCorners(ctx, c, c, w - c, h - c, () => cornerScroll(ctx, w * 0.27, 3 * unit));
    });

    if (!withCrest) return canvas;

    const cx = w / 2;
    pressed(ctx, 2 * unit, () => {
      crest(ctx, cx, h * 0.4, w * 0.085, 3.4 * unit);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `italic 600 ${w * 0.118}px ${fontFamily()}`;
      ctx.fillText('Keepsake', cx, h * 0.565);

      const small = w * 0.034;
      ctx.font = `500 ${small}px ${fontFamily()}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${small * 0.14}px`;
      ctx.fillText('Photo Album', cx, h * 0.618);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      const half = ctx.measureText('Photo Album').width / 2 + small * 0.9;
      ctx.lineWidth = 1.8 * unit;
      ctx.beginPath();
      ctx.moveTo(cx - half - w * 0.05, h * 0.607);
      ctx.lineTo(cx - half, h * 0.607);
      ctx.moveTo(cx + half, h * 0.607);
      ctx.lineTo(cx + half + w * 0.05, h * 0.607);
      ctx.stroke();

      divider(ctx, cx, h * 0.67, w * 0.15, 2 * unit, 'diamond');
    });
    return canvas;
  });
}

// ---- on the desk ------------------------------------------------------------------

/** Soft blurred blob placed under the book so that it visibly rests on the table. */
export function contactShadowCanvas() {
  return once('contactShadow', () => {
    const w = 512;
    const h = 256;
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.filter = 'blur(16px)';
    ctx.fillStyle = 'rgba(8,3,1,1)';
    ctx.fillRect(w * 0.11, h * 0.14, w * 0.78, h * 0.72);
    return canvas;
  });
}

export function plainRoughnessCanvas() {
  return once('plainRough', () => {
    const canvas = makeCanvas(4, 4);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgb(0,235,0)';
    ctx.fillRect(0, 0, 4, 4);
    return canvas;
  });
}
