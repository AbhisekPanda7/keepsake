/**
 * Gilded ornament for the inside of the book: corner scrollwork, leaves, curls, a crest,
 * pressed flowers and the small cartouche on the title page. Drawn with plain canvas paths,
 * so nothing is downloaded and every theme gets its own foil colour. No Three.js here.
 */

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

function rgbOf(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

const mix = (rgb, to, amount) => rgb.map((c, i) => clamp(c + (to[i] - c) * amount));
const css = (rgb, alpha = 1) => `rgba(${rgb.join(',')},${alpha})`;

/**
 * Foil as a sweep of light and shade across the whole sheet, so that every stroke catches
 * a little of both, as gold leaf does. Built from the theme's foil colour, so silver
 * themes get silver.
 */
export function foilFill(ctx, foilHex, w, h) {
  const base = rgbOf(foilHex);
  const light = mix(base, [255, 246, 214], 0.55);
  const dark = mix(base, [40, 22, 6], 0.42);
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, css(dark));
  gradient.addColorStop(0.18, css(light));
  gradient.addColorStop(0.34, css(base));
  gradient.addColorStop(0.5, css(mix(base, [255, 246, 214], 0.3)));
  gradient.addColorStop(0.66, css(dark));
  gradient.addColorStop(0.82, css(light));
  gradient.addColorStop(1, css(base));
  return gradient;
}

/** Pressed into the surface: a dark edge below each stroke, as the foil sits in a groove. */
export function pressed(ctx, depth, draw) {
  ctx.save();
  ctx.shadowColor = 'rgba(12,5,0,0.6)';
  ctx.shadowBlur = depth * 1.4;
  ctx.shadowOffsetX = depth * 0.4;
  ctx.shadowOffsetY = depth;
  draw();
  ctx.restore();
}

/** An almond-shaped leaf from (x, y), pointing along `angle`. */
export function leaf(ctx, x, y, length, angle, fatness = 0.36) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(length * 0.5, -length * fatness, length, 0);
  ctx.quadraticCurveTo(length * 0.5, length * fatness, 0, 0);
  ctx.fill();
  ctx.restore();
}

/** A tendril ending in a tight curl, drawn as a few arcs of shrinking radius. */
export function curl(ctx, x, y, radius, start, turns = 1.4, clockwise = true) {
  let r = radius;
  let a = start;
  let cx = x;
  let cy = y;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  const steps = Math.round(turns * 24);
  const dir = clockwise ? 1 : -1;
  for (let i = 0; i < steps; i += 1) {
    a += (dir * Math.PI * 2) / 24;
    r *= 0.955;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.stroke();
}

/**
 * Scrollwork for one corner, drawn into the +x, +y quarter from the corner at the origin;
 * the caller mirrors it into each corner. `s` is its overall size.
 */
export function cornerScroll(ctx, s, lineWidth) {
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  // Two long stems run out along the edges and turn in on themselves.
  for (const flip of [false, true]) {
    ctx.save();
    if (flip) {
      ctx.rotate(Math.PI / 2);
      ctx.scale(1, -1);
    }
    ctx.beginPath();
    ctx.moveTo(s * 0.16, s * 0.1);
    ctx.bezierCurveTo(s * 0.42, s * 0.02, s * 0.62, s * 0.2, s * 0.86, s * 0.1);
    ctx.stroke();
    curl(ctx, s * 0.92, s * 0.18, s * 0.08, -Math.PI / 2, 1.3, true);
    // An inner stem that sweeps back toward the corner and curls.
    ctx.beginPath();
    ctx.moveTo(s * 0.3, s * 0.1);
    ctx.bezierCurveTo(s * 0.42, s * 0.3, s * 0.3, s * 0.42, s * 0.46, s * 0.46);
    ctx.stroke();
    curl(ctx, s * 0.5, s * 0.38, s * 0.07, Math.PI / 2, 1.2, false);
    // Leaves along the outer stem.
    leaf(ctx, s * 0.38, s * 0.07, s * 0.13, -0.75);
    leaf(ctx, s * 0.5, s * 0.12, s * 0.12, 0.65);
    leaf(ctx, s * 0.66, s * 0.13, s * 0.11, -0.6);
    leaf(ctx, s * 0.36, s * 0.24, s * 0.1, 1.25);
    ctx.restore();
  }
  // A rosette sits in the corner where the stems meet.
  const r = s * 0.075;
  ctx.beginPath();
  ctx.arc(s * 0.13, s * 0.13, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 8; i += 1) leaf(ctx, s * 0.13, s * 0.13, r * 1.45, (i * Math.PI) / 4, 0.42);
}

/** Places `draw` at each of four corners, mirrored to face inward. */
export function atCorners(ctx, left, top, right, bottom, draw) {
  for (const [x, y, sx, sy] of [
    [left, top, 1, 1],
    [right, top, -1, 1],
    [left, bottom, 1, -1],
    [right, bottom, -1, -1],
  ]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, sy);
    draw();
    ctx.restore();
  }
}

/** A plain, elegant camera, line-drawn, centred on (x, y). */
export function camera(ctx, x, y, size, lineWidth) {
  const w = size;
  const h = size * 0.66;
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  const r = h * 0.16;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + r, -h / 2);
  ctx.lineTo(-w * 0.2, -h / 2);
  ctx.lineTo(-w * 0.13, -h * 0.68);
  ctx.lineTo(w * 0.13, -h * 0.68);
  ctx.lineTo(w * 0.2, -h / 2);
  ctx.lineTo(w / 2 - r, -h / 2);
  ctx.arcTo(w / 2, -h / 2, w / 2, -h / 2 + r, r);
  ctx.lineTo(w / 2, h / 2 - r);
  ctx.arcTo(w / 2, h / 2, w / 2 - r, h / 2, r);
  ctx.lineTo(-w / 2 + r, h / 2);
  ctx.arcTo(-w / 2, h / 2, -w / 2, h / 2 - r, r);
  ctx.lineTo(-w / 2, -h / 2 + r);
  ctx.arcTo(-w / 2, -h / 2, -w / 2 + r, -h / 2, r);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, h * 0.04, h * 0.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, h * 0.04, h * 0.17, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w * 0.34, -h * 0.28, h * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The crest on the inside cover: a ring with a fleuron at each point of the compass and a
 * scroll either side, around the camera.
 */
export function crest(ctx, x, y, radius, lineWidth) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  // A scalloped ring: sixteen shallow arcs.
  const scallops = 16;
  ctx.beginPath();
  for (let i = 0; i < scallops; i += 1) {
    const a0 = (i / scallops) * Math.PI * 2;
    const a1 = ((i + 1) / scallops) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    if (i === 0) ctx.moveTo(Math.cos(a0) * radius, Math.sin(a0) * radius);
    ctx.quadraticCurveTo(Math.cos(am) * radius * 1.1, Math.sin(am) * radius * 1.1, Math.cos(a1) * radius, Math.sin(a1) * radius);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.86, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 4; i += 1) {
    const a = (i * Math.PI) / 2 - Math.PI / 2;
    ctx.save();
    ctx.rotate(a + Math.PI / 2);
    ctx.translate(0, -radius * 1.12);
    leaf(ctx, 0, 0, radius * 0.3, -Math.PI / 2, 0.42);
    leaf(ctx, 0, 0, radius * 0.18, -Math.PI / 2 - 0.9, 0.42);
    leaf(ctx, 0, 0, radius * 0.18, -Math.PI / 2 + 0.9, 0.42);
    ctx.restore();
  }
  // Scroll wings either side.
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    ctx.beginPath();
    ctx.moveTo(radius * 1.2, 0);
    ctx.bezierCurveTo(radius * 1.55, -radius * 0.32, radius * 1.85, radius * 0.24, radius * 2.15, -radius * 0.04);
    ctx.stroke();
    curl(ctx, radius * 2.22, radius * 0.06, radius * 0.11, -Math.PI / 2, 1.2, true);
    leaf(ctx, radius * 1.5, -radius * 0.14, radius * 0.24, -0.9);
    leaf(ctx, radius * 1.78, radius * 0.08, radius * 0.22, 0.75);
    ctx.restore();
  }
  camera(ctx, 0, 0, radius * 0.92, lineWidth * 1.1);
  ctx.restore();
}

/** A divider: fine rules either side of a centre motif, each ending in a small curl. */
export function divider(ctx, cx, y, halfWidth, lineWidth, motif = 'diamond') {
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  const gap = halfWidth * 0.16;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * gap, y);
    ctx.lineTo(cx + side * halfWidth * 0.86, y);
    ctx.stroke();
    curl(ctx, cx + side * halfWidth * 0.92, y - halfWidth * 0.04, halfWidth * 0.06, side > 0 ? Math.PI / 2 : Math.PI / 2, 1.1, side > 0);
    ctx.beginPath();
    ctx.arc(cx + side * gap * 0.62, y, lineWidth * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  const m = halfWidth * 0.07;
  ctx.beginPath();
  if (motif === 'heart') {
    ctx.moveTo(cx, y + m * 0.9);
    ctx.bezierCurveTo(cx - m * 1.6, y - m * 0.1, cx - m * 0.7, y - m * 1.2, cx, y - m * 0.35);
    ctx.bezierCurveTo(cx + m * 0.7, y - m * 1.2, cx + m * 1.6, y - m * 0.1, cx, y + m * 0.9);
    ctx.stroke();
  } else {
    ctx.moveTo(cx, y - m);
    ctx.lineTo(cx + m, y);
    ctx.lineTo(cx, y + m);
    ctx.lineTo(cx - m, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** The small plaque on the title page: a frame with pointed ends, around one short line. */
export function cartouche(ctx, cx, cy, width, height, lineWidth) {
  const point = height * 0.42;
  const outline = (inset) => {
    const l = cx - width / 2 + inset;
    const r = cx + width / 2 - inset;
    const t = cy - height / 2 + inset;
    const b = cy + height / 2 - inset;
    ctx.beginPath();
    ctx.moveTo(l + point, t);
    ctx.lineTo(r - point, t);
    ctx.quadraticCurveTo(r - point * 0.2, t, r, cy);
    ctx.quadraticCurveTo(r - point * 0.2, b, r - point, b);
    ctx.lineTo(l + point, b);
    ctx.quadraticCurveTo(l + point * 0.2, b, l, cy);
    ctx.quadraticCurveTo(l + point * 0.2, t, l + point, t);
    ctx.closePath();
    ctx.stroke();
  };
  ctx.save();
  ctx.lineWidth = lineWidth * 1.6;
  outline(0);
  ctx.lineWidth = lineWidth * 0.8;
  outline(height * 0.12);
  ctx.restore();
}

/**
 * A spray of small white blossoms with leaves, as if pressed into the page. Seeded, so a
 * page always draws the same spray.
 */
export function blossomSpray(ctx, x, y, size, angle, random) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // The stem, with leaves along it.
  ctx.strokeStyle = 'rgba(122,128,92,0.85)';
  ctx.lineWidth = size * 0.012;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(size * 0.3, -size * 0.06, size * 0.6, size * 0.04, size * 0.95, -size * 0.04);
  ctx.stroke();
  ctx.fillStyle = 'rgba(132,140,98,0.78)';
  for (let i = 0; i < 6; i += 1) {
    const t = 0.12 + i * 0.14;
    const side = i % 2 ? 1 : -1;
    leaf(ctx, size * t, -size * 0.02 * Math.sin(t * 6), size * (0.13 + random() * 0.05), side * (0.7 + random() * 0.4), 0.34);
  }
  // Blossoms: five petals with a warm centre, and a few buds.
  const blooms = [
    [0.2, -0.12, 0.11],
    [0.45, 0.08, 0.13],
    [0.7, -0.1, 0.1],
    [0.92, 0.02, 0.085],
    [0.34, 0.16, 0.07],
  ];
  for (const [bx, by, br] of blooms) {
    const px = size * bx;
    const py = size * by;
    const r = size * br * (0.9 + random() * 0.2);
    const turn = random() * Math.PI;
    ctx.save();
    ctx.shadowColor = 'rgba(90,64,30,0.28)';
    ctx.shadowBlur = r * 0.35;
    ctx.shadowOffsetY = r * 0.08;
    for (let p = 0; p < 5; p += 1) {
      const a = turn + (p * Math.PI * 2) / 5;
      const petal = ctx.createRadialGradient(px, py, r * 0.1, px, py, r);
      petal.addColorStop(0, 'rgba(255,252,244,1)');
      petal.addColorStop(1, 'rgba(236,228,212,1)');
      ctx.fillStyle = petal;
      ctx.beginPath();
      ctx.ellipse(px + Math.cos(a) * r * 0.48, py + Math.sin(a) * r * 0.48, r * 0.5, r * 0.34, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(214,170,74,1)';
    ctx.beginPath();
    ctx.arc(px, py, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(160,112,40,0.9)';
    for (let d = 0; d < 6; d += 1) {
      const a = (d * Math.PI) / 3;
      ctx.beginPath();
      ctx.arc(px + Math.cos(a) * r * 0.12, py + Math.sin(a) * r * 0.12, r * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** A faint pencil landscape, low on the page: hills, a path and a lone tree. */
export function landscapeSketch(ctx, x, y, width, ink) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineWidth = width * 0.004;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(width * 0.2, -width * 0.12, width * 0.36, -width * 0.2, width * 0.52, -width * 0.1);
  ctx.bezierCurveTo(width * 0.62, -width * 0.04, width * 0.78, -width * 0.12, width, -width * 0.05);
  ctx.stroke();
  ctx.lineWidth = width * 0.003;
  ctx.beginPath();
  ctx.moveTo(width * 0.1, width * 0.04);
  ctx.bezierCurveTo(width * 0.4, -width * 0.02, width * 0.6, width * 0.05, width * 0.95, width * 0.02);
  ctx.stroke();
  // Hatching on the far hill.
  for (let i = 0; i < 9; i += 1) {
    const hx = width * (0.26 + i * 0.03);
    ctx.beginPath();
    ctx.moveTo(hx, -width * 0.12 + Math.abs(i - 4) * width * 0.012);
    ctx.lineTo(hx + width * 0.02, -width * 0.06);
    ctx.stroke();
  }
  // The tree.
  const tx = width * 0.76;
  const ty = -width * 0.08;
  ctx.lineWidth = width * 0.005;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx, ty - width * 0.12);
  ctx.stroke();
  ctx.globalAlpha *= 0.85;
  for (const [ox, oy, r] of [
    [0, -0.17, 0.06],
    [-0.04, -0.14, 0.045],
    [0.045, -0.135, 0.045],
    [0, -0.12, 0.04],
  ]) {
    ctx.beginPath();
    ctx.arc(tx + width * ox, ty + width * oy, width * r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
