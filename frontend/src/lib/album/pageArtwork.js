/**
 * Draws one printed page as a fine photography book would set it: handmade paper with a
 * blind-pressed frame, the print mounted on it, then caption, date and folio. The page is
 * flattened into a single canvas so the GPU only ever samples one texture per side,
 * however much is on the page.
 */
import { PAGE_HEIGHT, PAGE_WIDTH } from './bookModel.js';
import { capturedDate, wrapText } from './photoInfo.js';
import { atCorners, blossomSpray, cartouche, cornerScroll, divider, foilFill, landscapeSketch } from './ornaments.js';
import { fitText, fontFamily, fontsReady, handFontFamily, makeCanvas, paperGrainCanvas, paperReady, paperToothCanvas, seededRandom } from './surfaces.js';

const ROUGH_PAPER = 235;
/** A soft lustre, as on a fine silver print: enough to catch a highlight, far from glass. */
const ROUGH_PHOTO = 104;

/** The pressed frame, as fractions of the page. The foot leaves room for the page's actions. */
const FRAME = { side: 0.052, top: 0.04, foot: 0.066 };

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const isDarkPaper = (paper) => paper.rgb[0] < 90;

/** Letter-spacing where the browser has it. Elsewhere the text is simply set closer. */
function setTracking(ctx, em, size) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${em * size}px`;
}

function drawPaper(ctx, w, h, desc, paper) {
  ctx.fillStyle = ctx.createPattern(paperGrainCanvas(paper), 'repeat');
  ctx.save();
  // Offset by page so that no two pages share the exact same grain.
  const shift = hash(String(desc.sideIndex)) % 512;
  ctx.translate(-shift, -shift);
  ctx.fillRect(0, 0, w + shift, h + shift);
  ctx.restore();

  const dark = isDarkPaper(paper);
  const random = seededRandom(hash(`paper${desc.sideIndex}`));

  // The tooth of real handmade paper, photographed. It's what stops a page looking printed.
  const tooth = paperToothCanvas();
  if (tooth) {
    ctx.save();
    ctx.globalCompositeOperation = dark ? 'screen' : 'multiply';
    ctx.globalAlpha = dark ? 0.1 : 0.62;
    ctx.fillStyle = ctx.createPattern(tooth, 'repeat');
    const scale = w / 1024;
    ctx.scale(scale, scale);
    ctx.translate(-shift, -shift);
    ctx.fillRect(0, 0, (w + shift * scale) / scale + shift, (h + shift * scale) / scale + shift);
    ctx.restore();
  }

  if (!dark) {
    // The warmth lives in the paper itself, so that the light can stay neutral for the
    // photographs. Without this, warm paper would mean warm prints.
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgb(255,250,238)';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // A sheet's fibres aren't even: broad, faint clouds of density.
    for (let i = 0; i < 7; i += 1) {
      const x = random() * w;
      const y = random() * h;
      const r = w * (0.2 + random() * 0.3);
      const cloud = ctx.createRadialGradient(x, y, 0, x, y, r);
      const tone = random() > 0.5 ? '255,250,236' : paper.faint;
      const alpha = tone === paper.faint ? 0.018 : 0.05;
      cloud.addColorStop(0, `rgba(${tone},${alpha})`);
      cloud.addColorStop(1, `rgba(${tone},0)`);
      ctx.fillStyle = cloud;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // Stray fibres and the odd fleck, of the kind no two handmade sheets share.
    ctx.lineCap = 'round';
    for (let i = 0; i < 26; i += 1) {
      const x = random() * w;
      const y = random() * h;
      const angle = random() * Math.PI;
      const length = w * (0.004 + random() * 0.016);
      ctx.strokeStyle = `rgba(${paper.faint},${0.05 + random() * 0.09})`;
      ctx.lineWidth = Math.max(0.5, w * 0.0007);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(angle) * length * 0.5 + (random() - 0.5) * length * 0.5, y + Math.sin(angle) * length * 0.5, x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      ctx.stroke();
    }
    for (let i = 0; i < 12; i += 1) {
      ctx.fillStyle = `rgba(${paper.gutter},${0.05 + random() * 0.1})`;
      ctx.beginPath();
      ctx.arc(random() * w, random() * h, Math.max(0.5, w * (0.0005 + random() * 0.0012)), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Old paper tones from the outside in, where air and hands reach it.
  const inner = desc.spineOnRight ? w * 0.62 : w * 0.38;
  const toning = ctx.createRadialGradient(inner, h / 2, h * 0.34, inner, h / 2, h * 0.82);
  toning.addColorStop(0, `rgba(${paper.gutter},0)`);
  toning.addColorStop(1, `rgba(${paper.gutter},${dark ? 0.2 : 0.07})`);
  ctx.fillStyle = toning;
  ctx.fillRect(0, 0, w, h);

  // The page rolls down into the binding: a long soft fall, then a tight dark line where
  // the sheets actually meet. Geometry alone can't darken it this much without light tricks.
  const atSpine = desc.spineOnRight ? w : 0;
  const away = desc.spineOnRight ? -1 : 1;
  const gutter = ctx.createLinearGradient(atSpine, 0, atSpine + away * w * 0.3, 0);
  gutter.addColorStop(0, `rgba(${paper.gutter},0.62)`);
  gutter.addColorStop(0.05, `rgba(${paper.gutter},0.3)`);
  gutter.addColorStop(0.2, `rgba(${paper.gutter},0.13)`);
  gutter.addColorStop(0.55, `rgba(${paper.gutter},0.03)`);
  gutter.addColorStop(1, `rgba(${paper.gutter},0)`);
  ctx.fillStyle = gutter;
  ctx.fillRect(0, 0, w, h);

  // Where the page crowns, it faces the lamp a little more squarely.
  if (!dark) {
    const crownAt = atSpine + away * w * 0.34;
    const crown = ctx.createLinearGradient(crownAt - w * 0.2, 0, crownAt + w * 0.2, 0);
    crown.addColorStop(0, 'rgba(255,252,240,0)');
    crown.addColorStop(0.5, 'rgba(255,252,240,0.09)');
    crown.addColorStop(1, 'rgba(255,252,240,0)');
    ctx.fillStyle = crown;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawFolio(ctx, w, h, desc, paper) {
  const size = w * 0.028;
  ctx.font = `600 ${size}px ${fontFamily()}`;
  setTracking(ctx, 0.12, size);
  ctx.fillStyle = paper.inkSoft;
  ctx.textBaseline = 'alphabetic';
  // Centred at the foot, inside the gilt border, clear of the scrollwork in its corners.
  ctx.textAlign = 'center';
  ctx.fillText(String(desc.sideIndex + 1), w / 2, h * (1 - FRAME.foot) - h * 0.024);
  setTracking(ctx, 0, size);
}

/**
 * An archival mounting corner: a small pocket of clear glassine with a fine gilt edge,
 * tucked over the corner of a print. It holds the print without covering much of the picture.
 */
function drawMountCorner(ctx, x, y, size, rotation, dark) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  const out = size * 0.1;
  ctx.beginPath();
  ctx.moveTo(-out, -out);
  ctx.lineTo(size, -out);
  ctx.lineTo(-out, size);
  ctx.closePath();
  ctx.shadowColor = 'rgba(30,18,6,0.34)';
  ctx.shadowBlur = size * 0.16;
  ctx.shadowOffsetX = size * 0.02;
  ctx.shadowOffsetY = size * 0.04;
  ctx.fillStyle = dark ? 'rgba(92,80,58,0.92)' : 'rgba(246,238,219,0.8)';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(166,128,66,0.85)';
  ctx.lineWidth = Math.max(0.75, size * 0.024);
  ctx.beginPath();
  ctx.moveTo(size, -out);
  ctx.lineTo(-out, size);
  ctx.stroke();
  ctx.restore();
}

function emptyMount(ctx, w, h, paper) {
  // A faint pressed window and corners suggest where a print will go.
  const mx = w * 0.2;
  const top = h * 0.25;
  const boxW = w - mx * 2;
  const boxH = h * 0.42;
  ctx.lineWidth = Math.max(1, w * 0.0014);
  ctx.strokeStyle = `rgba(${paper.faint},0.13)`;
  ctx.strokeRect(mx, top, boxW, boxH);
  ctx.strokeStyle = isDarkPaper(paper) ? 'rgba(255,255,255,0.04)' : 'rgba(255,253,245,0.55)';
  ctx.strokeRect(mx + ctx.lineWidth, top + ctx.lineWidth, boxW, boxH);

  ctx.font = `italic 500 ${w * 0.036}px ${fontFamily()}`;
  ctx.fillStyle = `rgba(${paper.faint},0.46)`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('a place for a memory', w / 2, top + boxH / 2);
}

/**
 * The metal used on the pages: the cover's own foil, so that gold covers have gilt pages
 * and silver ones silver. A dark foil (the Sand cover's brown) would look like a smudge on
 * paper, so those pages are gilt instead.
 */
function pageFoil(paper) {
  const foil = paper.foil ?? '#b8893a';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(foil.slice(i, i + 2), 16));
  if (0.299 * r + 0.587 * g + 0.114 * b < 110) return isDarkPaper(paper) ? '#d2ae66' : '#b8893a';
  // On light paper, pale foil needs deepening to read at all; gold is deepened the same way.
  return isDarkPaper(paper) ? foil : deepen(foil, 0.12);
}

function deepen(hex, amount) {
  return `#${[1, 3, 5]
    .map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount)).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * The gilt double rule around a page, on all four sides, with scrollwork in its corners.
 * The title page has larger corners; photograph pages keep them small, out of the picture's way.
 */
function drawGiltFrame(ctx, w, h, paper, cornerSize) {
  const unit = w / 1000;
  const dark = isDarkPaper(paper);
  const gold = foilFill(ctx, pageFoil(paper), w, h);
  const left = w * FRAME.side;
  const top = h * FRAME.top;
  const right = w - left;
  const bottom = h * (1 - FRAME.foot);
  ctx.save();
  ctx.strokeStyle = gold;
  ctx.fillStyle = gold;
  ctx.globalAlpha = dark ? 0.95 : 0.88;
  ctx.lineWidth = 3.2 * unit;
  ctx.strokeRect(left, top, right - left, bottom - top);
  ctx.lineWidth = 1.2 * unit;
  const inset = 11 * unit;
  ctx.strokeRect(left + inset, top + inset, right - left - inset * 2, bottom - top - inset * 2);
  const c = inset + 8 * unit;
  atCorners(ctx, left + c, top + c, right - c, bottom - c, () => cornerScroll(ctx, w * cornerSize, 2.2 * unit));
  ctx.restore();
  return { gold, left, top, right, bottom };
}

/** Words for the title page when the album has none of its own. */
const DEFAULT_DEDICATION = ['A collection of special moments', 'and cherished photographs'];

/**
 * The title page of a presentation album: a gilt border with scrollwork in its corners,
 * sprays of pressed blossom, the title, a heart between two fine rules, a dedication, a
 * small plaque giving the year the memories begin, and a faint pencil landscape.
 */
function drawTitlePage(ctx, w, h, desc, paper) {
  const cx = w / 2;
  const unit = w / 1000;
  const dark = isDarkPaper(paper);
  const random = seededRandom(hash(`title${desc.title}`));
  // The gilt border, with scrollwork filling each corner.
  const { gold, left, top, right, bottom } = drawGiltFrame(ctx, w, h, paper, 0.2);

  // Pressed blossom: one spray falling from the top right, one rising at the bottom left.
  blossomSpray(ctx, right - w * 0.07, top + h * 0.035, w * 0.34, Math.PI * 0.78, random);
  blossomSpray(ctx, left + w * 0.06, bottom - h * 0.05, w * 0.32, -Math.PI * 0.24, random);

  // A faint pencil landscape low on the right, as if sketched before the photographs came.
  ctx.save();
  ctx.globalAlpha = dark ? 0.16 : 0.2;
  landscapeSketch(ctx, cx + w * 0.02, bottom - h * 0.075, w * 0.36, paper.inkSoft);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = paper.ink;
  ctx.font = `italic 600 ${w * 0.112}px ${fontFamily()}`;
  fitText(ctx, desc.title, w * 0.7);
  ctx.fillText(desc.title, cx, h * 0.31);

  ctx.save();
  ctx.strokeStyle = gold;
  ctx.fillStyle = gold;
  divider(ctx, cx, h * 0.375, w * 0.2, 1.6 * unit, 'heart');
  ctx.restore();

  let y = h * 0.43;
  const lineStep = h * 0.042;
  ctx.fillStyle = paper.inkSoft;
  ctx.font = `italic 500 ${w * 0.04}px ${fontFamily()}`;
  const words = desc.description
    ? wrapText(desc.description, (t) => ctx.measureText(t).width, w * 0.62, 4)
    : DEFAULT_DEDICATION;
  for (const line of words) {
    ctx.fillText(line, cx, y);
    y += lineStep;
  }

  // The plaque: the year these memories begin.
  const plaqueY = Math.max(y + h * 0.045, h * 0.56);
  ctx.save();
  ctx.strokeStyle = gold;
  ctx.fillStyle = gold;
  cartouche(ctx, cx, plaqueY, w * 0.34, h * 0.062, 1.4 * unit);
  ctx.restore();
  ctx.fillStyle = paper.ink;
  const plaqueSize = w * 0.034;
  ctx.font = `500 ${plaqueSize}px ${fontFamily()}`;
  setTracking(ctx, 0.04, plaqueSize);
  ctx.fillText(`•  Since ${desc.since}  •`, cx, plaqueY + plaqueSize * 0.06);
  setTracking(ctx, 0, plaqueSize);

  ctx.fillStyle = paper.inkSoft;
  if (desc.photoCount > 0) {
    // Set quietly under the plaque, as a book states its edition.
    const size = w * 0.0215;
    ctx.font = `600 ${size}px ${fontFamily()}`;
    setTracking(ctx, 0.2, size);
    const noun = desc.photoCount === 1 ? 'photograph' : 'photographs';
    ctx.fillText(`${desc.photoCount} ${noun}`.toUpperCase(), cx, plaqueY + h * 0.065);
    setTracking(ctx, 0, size);
  }
}

/**
 * Mounts a print on the page. Everything beneath a print takes its room from the print,
 * and the whole group is centred a little above the middle of the frame, where the eye
 * expects it, so that a page with no caption or date never looks as if something's missing.
 * Prints sit a touch off-square, by an angle taken from the photo's id, so each always sits
 * the same way however often it's redrawn.
 */
function drawPhoto(ctx, rough, w, h, bitmap, desc, paper) {
  const { photo, single } = desc;
  const caption = photo.caption ?? '';
  const date = capturedDate(photo);
  const scaleToRough = rough.canvas.width / w;

  // Measured first, because their height decides how large the print can be.
  const captionSize = w * 0.054;
  ctx.font = `500 ${captionSize}px ${handFontFamily()}`;
  const captionLines = caption ? wrapText(caption, (t) => ctx.measureText(t).width, w * 0.76, 2) : [];
  const captionStep = h * 0.042;
  const dateSize = w * 0.0195;
  const beneath = (captionLines.length ? h * 0.044 + captionLines.length * captionStep : 0) + (date ? h * 0.042 : 0);

  const frameTop = h * FRAME.top;
  const frameBottom = h * (1 - FRAME.foot);
  const maxW = w * (single ? 0.82 : 0.72);
  const maxH = Math.min(h * (single ? 0.76 : 0.7), frameBottom - frameTop - h * 0.12 - beneath);
  const border = w * 0.02;
  const aspect = bitmap.width / bitmap.height;
  let imgW = maxW - border * 2;
  let imgH = imgW / aspect;
  if (imgH > maxH - border * 2) {
    imgH = maxH - border * 2;
    imgW = imgH * aspect;
  }
  const printW = imgW + border * 2;
  const printH = imgH + border * 2;

  const random = seededRandom(hash(photo.id));
  const tilt = (random() - 0.5) * 0.014;
  const cx = w / 2 + (random() - 0.5) * w * 0.008;
  const groupHeight = printH + beneath;
  const groupTop = frameTop + (frameBottom - frameTop - groupHeight) * 0.44;
  const cy = groupTop + printH / 2;

  const place = (target) => {
    target.translate(cx, cy);
    target.rotate(tilt);
  };

  ctx.save();
  place(ctx);
  // Two shadows, as a sheet lying on paper has: a wide soft one, and a tight dark one at
  // the very edge where the print touches the page. The lamp is up and to the left.
  ctx.fillStyle = paper.print;
  ctx.shadowColor = 'rgba(40,24,8,0.3)';
  ctx.shadowBlur = w * 0.024;
  ctx.shadowOffsetX = w * 0.0045;
  ctx.shadowOffsetY = w * 0.008;
  ctx.fillRect(-printW / 2, -printH / 2, printW, printH);
  ctx.shadowColor = 'rgba(30,16,4,0.58)';
  ctx.shadowBlur = w * 0.0035;
  ctx.shadowOffsetX = w * 0.001;
  ctx.shadowOffsetY = w * 0.0018;
  ctx.fillRect(-printW / 2, -printH / 2, printW, printH);
  ctx.shadowColor = 'transparent';
  // The print's thickness: its cut edges catch the lamp on one side and fall dark on the other.
  ctx.lineWidth = Math.max(1, w * 0.0013);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.moveTo(-printW / 2, printH / 2);
  ctx.lineTo(-printW / 2, -printH / 2);
  ctx.lineTo(printW / 2, -printH / 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(70,52,30,0.38)';
  ctx.beginPath();
  ctx.moveTo(printW / 2, -printH / 2);
  ctx.lineTo(printW / 2, printH / 2);
  ctx.lineTo(-printW / 2, printH / 2);
  ctx.stroke();

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, -imgW / 2, -imgH / 2, imgW, imgH);
  // A hairline where the picture meets the border, as a darkroom print has.
  ctx.strokeStyle = 'rgba(30,20,10,0.16)';
  ctx.lineWidth = Math.max(0.75, w * 0.0007);
  ctx.strokeRect(-imgW / 2, -imgH / 2, imgW, imgH);

  const corner = w * 0.03;
  const dark = isDarkPaper(paper);
  drawMountCorner(ctx, -printW / 2, -printH / 2, corner, 0, dark);
  drawMountCorner(ctx, printW / 2, -printH / 2, corner, Math.PI / 2, dark);
  drawMountCorner(ctx, printW / 2, printH / 2, corner, Math.PI, dark);
  drawMountCorner(ctx, -printW / 2, printH / 2, corner, -Math.PI / 2, dark);
  ctx.restore();

  // The print's surface takes the light differently from the paper around it.
  rough.save();
  rough.scale(scaleToRough, scaleToRough);
  place(rough);
  rough.fillStyle = `rgb(0,${ROUGH_PHOTO},0)`;
  rough.fillRect(-imgW / 2, -imgH / 2, imgW, imgH);
  rough.restore();

  // Written beneath the print by hand. The date is set in quiet capitals beneath that, and
  // only if the camera recorded one: a guessed date in a keepsake is worse than none.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let y = cy + printH / 2 + h * 0.016;
  if (captionLines.length) {
    y += h * 0.028;
    ctx.font = `500 ${captionSize}px ${handFontFamily()}`;
    ctx.fillStyle = paper.ink;
    for (const line of captionLines) {
      ctx.fillText(line, cx, y);
      y += captionStep;
    }
    y -= captionStep * 0.5;
  }
  if (date) {
    y += h * 0.024;
    ctx.font = `600 ${dateSize}px ${fontFamily()}`;
    setTracking(ctx, 0.18, dateSize);
    ctx.fillStyle = paper.inkSoft;
    ctx.fillText(date.toUpperCase(), cx, y);
    setTracking(ctx, 0, dateSize);
  }
}

/** Colour resolution follows how large the page can actually appear on screen. */
export function pagePixelWidth(desc) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // A lone page fills the width of the screen; a spread gives each page half.
  const onScreen = desc.single
    ? Math.min(window.innerWidth, window.innerHeight) * dpr
    : Math.max(window.innerWidth, window.innerHeight * 1.6) * 0.5 * dpr;
  return Math.min(1024, Math.max(512, Math.round(onScreen / 128) * 128));
}

/**
 * Returns two canvases: page colour and a small roughness map (in channel G).
 * `loadBitmap` supplies the decoded photo; a failed load leaves a blank mount.
 */
export async function composePage(desc, loadBitmap, paper) {
  await Promise.all([fontsReady(), paperReady()]);
  const w = pagePixelWidth(desc);
  const h = Math.round((w * PAGE_HEIGHT) / PAGE_WIDTH);

  const roughCanvas = makeCanvas(128, Math.round((128 * PAGE_HEIGHT) / PAGE_WIDTH));
  const rough = roughCanvas.getContext('2d');
  rough.fillStyle = `rgb(0,${ROUGH_PAPER},0)`;
  rough.fillRect(0, 0, roughCanvas.width, roughCanvas.height);

  // Decode before touching the canvas, so slow disks do not hold a half-made page.
  let bitmap = null;
  if (desc.kind === 'photo') {
    try {
      bitmap = await loadBitmap(desc.photo);
    } catch {
      bitmap = null;
    }
  }

  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { alpha: false });
  drawPaper(ctx, w, h, desc, paper);

  if (desc.kind === 'verso') {
    // Nothing is printed on the back of a one-sided leaf.
    return { canvas, roughCanvas };
  }
  // Every page has the gilt border; the title page draws its own, with larger corners.
  if (desc.kind !== 'title') drawGiltFrame(ctx, w, h, paper, 0.09);
  if (desc.kind === 'title') {
    drawTitlePage(ctx, w, h, desc, paper);
  } else if (bitmap) {
    drawPhoto(ctx, rough, w, h, bitmap, desc, paper);
    bitmap.close();
  } else {
    emptyMount(ctx, w, h, paper);
  }
  if (desc.kind !== 'title') drawFolio(ctx, w, h, desc, paper);

  return { canvas, roughCanvas };
}
