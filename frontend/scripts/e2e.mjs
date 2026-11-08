/**
 * End-to-end test of the running app in real Chrome, with real input.
 *
 *   npm run dev            (in one terminal)
 *   npm run test:e2e       (in another)
 *
 * Talks to Chrome over the DevTools Protocol using Node's built-in WebSocket, so it
 * needs no test framework or other dependency. It runs in a throwaway profile, so it
 * never touches your own album or browser data.
 *
 * Touch here is sent through Chrome's real input pipeline, including touch-action and
 * scrolling behaviour. It is still EMULATION on this computer. It says nothing about
 * how a real phone's GPU, memory, browser bars or touch screen behave.
 *
 * Environment: E2E_URL, E2E_OUT (screenshot folder), CHROME_PATH, E2E_HEADED=1
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_ROOT = process.env.E2E_URL ?? 'http://localhost:3000';
const OUT = process.env.E2E_OUT ?? join(tmpdir(), 'keepsake-e2e');
const PORT = 9333;
mkdirSync(OUT, { recursive: true });

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- reporting --------------------------------------------------------------

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    failures.push(`${name}${detail ? ` (${detail})` : ''}`);
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}
const section = (title) => console.log(`\n${title}`);
const notes = [];
function note(text) {
  notes.push(text);
  console.log(`  note  ${text}`);
}

// ---- Chrome connection --------------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), 'keepsake-chrome-'));
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('Chrome not found. Set CHROME_PATH.');
  process.exit(2);
}
const chrome = spawn(
  chromePath,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    ...(process.env.E2E_HEADED ? [] : ['--headless=new']),
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--use-angle=default',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let socket;
let nextId = 1;
const pending = new Map();
const consoleProblems = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function connect() {
  let target;
  for (let i = 0; i < 80 && !target; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch {
      // Chrome is still starting.
    }
    if (!target) await sleep(150);
  }
  if (!target) throw new Error('Could not connect to Chrome');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => {
    socket.onopen = resolve;
  });
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, method } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(message.params.type)) {
      const text = message.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300);
      consoleProblems.push(`${message.params.type}: ${text}`);
    } else if (message.method === 'Runtime.exceptionThrown') {
      const d = message.params.exceptionDetails;
      consoleProblems.push(`exception: ${(d.exception?.description ?? d.text).slice(0, 300)}`);
    } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      consoleProblems.push(`log: ${message.params.entry.text.slice(0, 300)} ${message.params.entry.url ?? ''}`);
    }
  };
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Performance.enable');
}

async function js(expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) {
    throw new Error(`Page script failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
  }
  return result.value;
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
  writeFileSync(join(OUT, `${name}.jpg`), Buffer.from(data, 'base64'));
}

/**
 * Whether a photograph is actually visible, judged from a real screenshot. Data checks
 * can't see a page that renders blank, so this looks at the pixels: test photographs are
 * colourful, and paper, ink and the table aren't. Returns the fraction of colourful
 * pixels in the middle of the screen.
 */
async function colourfulFraction() {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  return js(`const img = new Image(); img.src = 'data:image/png;base64,${data}'; await img.decode();
    const c = document.createElement('canvas'); c.width = 240; c.height = 150;
    const x = c.getContext('2d');
    x.drawImage(img, img.width * .15, img.height * .15, img.width * .7, img.height * .6, 0, 0, 240, 150);
    const d = x.getImageData(0, 0, 240, 150).data; let colourful = 0;
    for (let i = 0; i < d.length; i += 4) {
      const hi = Math.max(d[i], d[i + 1], d[i + 2]), lo = Math.min(d[i], d[i + 1], d[i + 2]);
      // Ivory, kraft, leather and walnut are all warm. Photos here are green, blue and pink.
      const warmOnly = d[i] >= d[i + 1] && d[i + 1] >= d[i + 2];
      if (hi - lo > 40 && !warmOnly) colourful += 1;
    }
    return colourful / (240 * 150);`);
}

/** Fraction of pixels burnt out to near white in the middle of the screen. */
async function blownFraction() {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  return js(`const img = new Image(); img.src = 'data:image/png;base64,${data}'; await img.decode();
    const c = document.createElement('canvas'); c.width = 240; c.height = 150;
    const x = c.getContext('2d');
    x.drawImage(img, img.width * .15, img.height * .15, img.width * .7, img.height * .6, 0, 0, 240, 150);
    const d = x.getImageData(0, 0, 240, 150).data; let blown = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.min(d[i], d[i + 1], d[i + 2]) > 244) blown += 1;
    return blown / (240 * 150);`);
}

async function viewport(width, height, { touch = false, dpr = 1 } = {}) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: touch });
  await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 });
  await sleep(500);
}

/** The page load() returns to, which is the album under test or the library. */
let currentPath = '/';

async function waitFor(expression, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await js(`return Boolean(${expression});`).catch(() => false)) return true;
    await sleep(80);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

const ALBUM_READY = 'document.querySelector(".toolbar") && document.querySelector("canvas") && window.__album';
/** The scene has finished preparing and been faded in, so what's on screen is the real thing. */
const SCENE_SHOWN = 'document.querySelector("canvas.is-shown")';
const LIBRARY_READY = 'document.querySelector(".library-intro .tool") && !document.querySelector(".library-intro .tool").disabled';

async function load(path = currentPath) {
  currentPath = path;
  await send('Page.navigate', { url: URL_ROOT + path });
  await sleep(250);
  await waitFor(path.startsWith('/albums/') ? `${ALBUM_READY} && ${SCENE_SHOWN}` : LIBRARY_READY, 30000);
  await sleep(path.startsWith('/albums/') ? 1500 : 500);
}

// ---- reading the app ---------------------------------------------------------

const label = () => js('return document.querySelector(".toolbar-page").textContent;');
const countText = () => js('return document.querySelector(".toolbar-count").textContent;');
const state = () =>
  js(`const c = window.__album; return {
    spread: c.spread, stage: c.stage(), mode: c.mode, leaves: c.layout.leafCount,
    active: c.active.size, offset: c.pose.offsetX, animating: c.isAnimating };`);
async function settle(timeout = 7000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!(await state()).animating) return true;
    await sleep(80);
  }
  return false;
}
/** What is really on disk for one album, plus database-wide totals to catch cross-album damage. */
const storedPhotos = (albumId) =>
  js(`const id = ${JSON.stringify(albumId ?? null)} ?? decodeURIComponent(location.pathname.split('/')[2] ?? '');
    const db = await new Promise((res, rej) => { const q = indexedDB.open('keepsake'); q.onsuccess = () => res(q.result); q.onerror = rej; });
    const all = (s) => new Promise((res) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); });
    const every = await all('photos'); const allBlobs = await all('photoBlobs'); const albums = await all('albums'); db.close();
    const photos = every.filter((p) => p.albumId === id).sort((a, b) => a.order - b.order);
    const ids = new Set(photos.map((p) => p.id));
    const blobs = allBlobs.filter((b) => ids.has(b.id));
    const album = albums.find((a) => a.id === id) ?? null;
    const known = new Set(every.map((p) => p.id));
    return { names: photos.map((p) => p.name), orders: photos.map((p) => p.order),
      meta: photos.map((p) => ({ id: p.id, name: p.name, takenAt: p.takenAt, source: p.takenAtSource, w: p.width, h: p.height, caption: p.caption })),
      blobs: blobs.length, types: blobs.map((b) => b.blob.type), title: album?.title ?? null, album,
      totals: { albums: albums.length, photos: every.length, blobs: allBlobs.length,
        orphanBlobs: allBlobs.filter((b) => !known.has(b.id)).length,
        orphanPhotos: every.filter((p) => !albums.some((a) => a.id === p.albumId)).length } };`);

const setField = (selector, value) =>
  js(`const el = document.querySelector(${JSON.stringify(selector)});
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));`);

const libraryCards = () =>
  js(`return [...document.querySelectorAll('.album-card')].map((c) => ({ id: c.dataset.albumId,
    title: c.querySelector('h2').textContent, meta: c.querySelector('.album-label p').textContent }));`);

/** Makes an album through the real creation screen, and waits for its cover to open. */
async function createAlbum(title, { description, colour, material, paper } = {}) {
  await js(`[...document.querySelectorAll('.library-intro .tool')][0].click();`);
  await sleep(250);
  await setField('dialog[open] input[name="album-title"]', title);
  if (description) await setField('dialog[open] textarea[name="album-description"]', description);
  const pick = (legend, value) =>
    value ? js(`document.querySelector('dialog[open] input[name="${legend}"][value="${value}"]').click();`) : null;
  await pick('Cover colour', colour);
  await pick('Cover material', material);
  await pick('Paper', paper);
  await sleep(120);
  await clickButton('Create album');
  await waitFor(`location.pathname.startsWith('/albums/') && ${ALBUM_READY}`);
  await waitFor("window.__album.stage() === 'open'");
  await settle();
  currentPath = await js('return location.pathname;');
  await helpers();
  return decodeURIComponent(currentPath.split('/')[2]);
}

async function backToLibrary() {
  await js("document.querySelector('.back-link').click();");
  await waitFor(`location.pathname === '/' && ${LIBRARY_READY}`);
  await sleep(500);
  currentPath = '/';
  await helpers();
}

/** Opens an album by its book in the library, with a real click on the book. */
async function openFromLibrary(albumId) {
  const at = await js(`const el = document.querySelector('[data-album-id="${albumId}"] .album-open');
    el.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 150));
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  await click(at.x, at.y);
  await waitFor(`location.pathname.startsWith('/albums/') && ${ALBUM_READY}`);
  await waitFor("window.__album.stage() === 'open'");
  await settle();
  currentPath = await js('return location.pathname;');
  await helpers();
}
const noHorizontalOverflow = () =>
  js('return document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth;');
const controlsOnScreen = () =>
  js(`return [...document.querySelectorAll('.toolbar button')].every((b) => { const r = b.getBoundingClientRect();
    return r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 && r.width > 0; });`);

/** Screen position of a point on the open pages, from the live camera. */
const onPage = (bookX, bookY) =>
  js(`const cam = window.__albumCamera, c = window.__album, r = document.querySelector('canvas').getBoundingClientRect();
    const ppu = r.height / (2 * cam.userData.baseZ * Math.tan(cam.fov * Math.PI / 360));
    return { x: r.width / 2 + (${bookX} + c.pose.offsetX) * ppu, y: r.height / 2 - (${bookY} - cam.userData.baseY) * ppu, ppu };`);

// ---- input ---------------------------------------------------------------------

const mouse = (type, x, y, buttons = 0, button = 'none') =>
  send('Input.dispatchMouseEvent', { type, x, y, buttons, button, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'mouse' });

async function mouseDrag(from, to, { steps = 18, hold = 0, release = true, stepMs = 12 } = {}) {
  await mouse('mouseMoved', from.x, from.y);
  await mouse('mousePressed', from.x, from.y, 1, 'left');
  for (let i = 1; i <= steps; i += 1) {
    const k = i / steps;
    await mouse('mouseMoved', from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, 1);
    await sleep(stepMs);
  }
  if (hold) await sleep(hold);
  if (release) await mouse('mouseReleased', to.x, to.y, 0, 'left');
}

async function click(x, y) {
  await mouse('mouseMoved', x, y);
  await mouse('mousePressed', x, y, 1, 'left');
  await mouse('mouseReleased', x, y, 0, 'left');
}

async function key(name) {
  const code = { ArrowRight: 39, ArrowLeft: 37, Escape: 27, Enter: 13 }[name];
  const base = { key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
  // Enter only activates a focused button if the key event also carries its text.
  await send('Input.dispatchKeyEvent', name === 'Enter' ? { type: 'keyDown', text: '\r', ...base } : { type: 'rawKeyDown', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

const touchEvent = (type, points) =>
  send('Input.dispatchTouchEvent', { type, touchPoints: points.map(({ x, y }) => ({ x, y, id: 1 })) });

async function swipe(from, to, { steps = 14, stepMs = 16, hold = 0, release = true } = {}) {
  await touchEvent('touchStart', [from]);
  for (let i = 1; i <= steps; i += 1) {
    const k = i / steps;
    await touchEvent('touchMove', [{ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }]);
    await sleep(stepMs);
  }
  if (hold) await sleep(hold);
  if (release) await touchEvent('touchEnd', []);
}

async function tap(x, y) {
  await touchEvent('touchStart', [{ x, y }]);
  await sleep(40);
  await touchEvent('touchEnd', []);
}

const clickButton = (text) =>
  js(`const b = [...document.querySelectorAll('button')].filter((x) => x.getBoundingClientRect().width > 0 && !x.closest('dialog:not([open])'))
      .reverse().find((x) => x.textContent.trim() === ${JSON.stringify(text)});
    if (!b) throw new Error('No button: ${text}'); b.click();`);
const dialogTitle = () => js("return document.querySelector('dialog[open] h2')?.textContent ?? null;");

// ---- making test photographs -----------------------------------------------------

const PHOTO_HELPERS = `
  window.__makePhoto = async (name, { w = 1600, h = 1067, type = 'image/jpeg', hue = 200, lastModified = Date.UTC(2023, 5, 15), text } = {}) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'hsl(' + hue + ',60%,72%)'); g.addColorStop(1, 'hsl(' + (hue + 60) + ',50%,26%)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,250,225,.92)'; x.beginPath(); x.arc(w * .72, h * .26, h * .09, 0, 7); x.fill();
    x.fillStyle = 'rgba(20,30,30,.35)'; x.beginPath(); x.moveTo(0, h);
    for (let i = 0; i <= 12; i++) x.lineTo(w * i / 12, h * (.7 + .08 * Math.sin(i + hue)));
    x.lineTo(w, h); x.fill();
    x.fillStyle = '#fff'; x.font = 'bold ' + Math.round(h * .14) + 'px sans-serif'; x.textAlign = 'center';
    x.fillText(text ?? name, w / 2, h * .55);
    const blob = await new Promise((r) => c.toBlob(r, type, .9));
    return new File([blob], name, { type, lastModified });
  };
  // Inserts a genuine EXIF block into an encoded JPEG.
  window.__withExif = async (file, date) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = [...date].map((c) => c.charCodeAt(0)).concat(0);
    const tiff = new Uint8Array(8 + 2 + 12 + 4 + 2 + 12 + 4 + text.length);
    const dv = new DataView(tiff.buffer);
    dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
    dv.setUint16(8, 1, true); dv.setUint16(10, 0x8769, true); dv.setUint16(12, 4, true); dv.setUint32(14, 1, true); dv.setUint32(18, 26, true);
    dv.setUint16(26, 1, true); dv.setUint16(28, 0x9003, true); dv.setUint16(30, 2, true); dv.setUint32(32, text.length, true); dv.setUint32(36, 44, true);
    tiff.set(text, 44);
    const exif = new TextEncoder().encode('Exif\\0\\0');
    const size = 2 + exif.length + tiff.length;
    const out = new Uint8Array(2 + 2 + size + bytes.length - 2);
    out.set([0xff, 0xd8, 0xff, 0xe1, size >> 8, size & 255]); out.set(exif, 6); out.set(tiff, 6 + exif.length);
    out.set(bytes.subarray(2), 6 + exif.length + tiff.length);
    return new File([out], file.name, { type: 'image/jpeg', lastModified: file.lastModified });
  };
  window.__upload = (files) => {
    const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f));
    const input = document.querySelector('.toolbar [data-testid=photo-input]');
    input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  window.__uploadDone = async () => {
    await new Promise((r) => setTimeout(r, 150));
    while (document.querySelector('.notice-bar')) await new Promise((r) => setTimeout(r, 60));
  };
`;
const helpers = () => js(`${PHOTO_HELPERS} return true;`);

async function uploadNumbered(count, start = 0) {
  await js(`const files = [];
    for (let i = ${start}; i < ${start + count}; i++) files.push(await __makePhoto('photo-' + (i + 1) + '.jpg',
      { hue: (i * 47) % 360, text: '#' + (i + 1), w: i % 3 === 2 ? 800 : 1200, h: i % 3 === 2 ? 1100 : 800 }));
    __upload(files); await __uploadDone();`);
  await settle();
}

async function rafStats(duringMs, action) {
  await js(`window.__raf = []; window.__rafOn = true;
    const loop = (t) => { window.__raf.push(t); if (window.__rafOn) requestAnimationFrame(loop); }; requestAnimationFrame(loop);`);
  await action();
  await sleep(duringMs);
  // Under CPU throttling Chrome can report the same timestamp for several callbacks.
  // Those aren't separate frames on screen, so they are left out of the count.
  return js(`window.__rafOn = false; const ts = [...new Set(window.__raf)];
    const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
    if (!d.length) return { fps: 0 };
    return { fps: +(1000 * d.length / (ts[ts.length - 1] - ts[0])).toFixed(1), p50: +d[d.length >> 1].toFixed(1),
      p95: +d[Math.floor(d.length * .95)].toFixed(1), max: +d[d.length - 1].toFixed(1) };`);
}

// ==== tests ======================================================================

/** Builds a real version 1 database, exactly as the previous release left it. */
const buildV1 = (titleRecord, photoCount) =>
  js(`await new Promise((res, rej) => { const q = indexedDB.deleteDatabase('keepsake'); q.onsuccess = res; q.onerror = rej; q.onblocked = res; });
    const db = await new Promise((res, rej) => {
      const q = indexedDB.open('keepsake', 1);
      q.onupgradeneeded = () => {
        const d = q.result;
        d.createObjectStore('albums', { keyPath: 'id' });
        d.createObjectStore('photos', { keyPath: 'id' }).createIndex('byAlbum', ['albumId', 'order']);
        d.createObjectStore('photoBlobs', { keyPath: 'id' });
      };
      q.onsuccess = () => res(q.result); q.onerror = rej;
    });
    const blobs = [];
    for (let i = 0; i < ${photoCount}; i++) {
      const c = document.createElement('canvas'); c.width = 900; c.height = 600;
      const x = c.getContext('2d'); x.fillStyle = 'hsl(' + (i * 70) + ',50%,50%)'; x.fillRect(0, 0, 900, 600);
      x.fillStyle = '#fff'; x.font = 'bold 120px sans-serif'; x.fillText('old ' + (i + 1), 200, 330);
      blobs.push(await new Promise((r) => c.toBlob(r, 'image/jpeg', .9)));
    }
    await new Promise((res, rej) => {
      const t = db.transaction(['albums', 'photos', 'photoBlobs'], 'readwrite');
      ${titleRecord ? `t.objectStore('albums').put({ id: 'default', title: ${JSON.stringify(titleRecord)} });` : ''}
      blobs.forEach((blob, i) => {
        const id = 'legacy-' + i;
        t.objectStore('photos').put({ id, albumId: 'default', order: i, name: 'old-' + (i + 1) + '.jpg', width: 900, height: 600,
          takenAt: Date.UTC(2019, i, 10), takenAtSource: 'file', addedAt: Date.UTC(2020, i, 1) });
        t.objectStore('photoBlobs').put({ id, blob });
      });
      t.oncomplete = res; t.onerror = rej;
    });
    db.close(); return db.version;`);

/** A same-origin page that never opens the database, so a v1 one can be built there. */
const NEUTRAL_PAGE = '/__e2e-neutral';

async function goNeutral() {
  await send('Page.navigate', { url: URL_ROOT + NEUTRAL_PAGE });
  await sleep(700);
}

async function migration() {
  section('Migration: a real version 1 database');
  await viewport(1440, 900);

  await goNeutral();
  check('built an old-format database', (await buildV1(null, 0)) === 1);
  await load('/');
  check('an unused old database gives an empty library', (await libraryCards()).length === 0);
  check('a quiet empty state', await js("return document.querySelector('.library-intro h1')?.textContent === 'Your albums' && document.querySelector('.library-intro p')?.textContent === 'No albums yet';"));
  await shot('library-1-empty');

  await goNeutral();
  await buildV1(null, 3);
  await load('/');
  let cards = await libraryCards();
  check('old album appears in the library', cards.length === 1 && cards[0].id === 'default', JSON.stringify(cards));
  check('with the default title and its photo count', cards[0]?.title === 'Our Memories' && cards[0]?.meta.includes('3 photographs'));
  let stored = await storedPhotos('default');
  check('every photograph kept, in order', stored.names.join() === 'old-1.jpg,old-2.jpg,old-3.jpg');
  check('every image kept', stored.blobs === 3 && stored.totals.orphanBlobs === 0 && stored.totals.orphanPhotos === 0);
  check('dates from the old data kept', stored.meta[0].takenAt === Date.UTC(2019, 0, 10));
  check('album dates come from the photographs', stored.album.createdAt === Date.UTC(2020, 0, 1) && stored.album.updatedAt === Date.UTC(2020, 2, 1));
  check('looks as it did: walnut leather on ivory', stored.album.theme.colour === 'walnut' && stored.album.theme.paper === 'ivory');
  check('database upgraded to version 2', await js("return (await indexedDB.databases()).find((d) => d.name === 'keepsake').version === 2;"));

  await goNeutral();
  await buildV1('Family 1998', 2);
  await load('/');
  cards = await libraryCards();
  check('a renamed old album keeps its title', cards[0]?.title === 'Family 1998');
  await helpers();
  await openFromLibrary('default');
  check('opening from the library lifts the cover', (await state()).stage === 'open', await label());
  await key('ArrowRight');
  await settle();
  const photo = await onPage(-1.5, 0.3);
  await click(photo.x, photo.y);
  await sleep(450);
  const loaded = await js("const i = document.querySelector('dialog.viewer[open] img'); if (!i) return false; await i.decode().catch(() => {}); return i.naturalWidth;");
  check('old image still opens, from the stored blob', loaded === 900, `naturalWidth=${loaded}`);
  await shot('migrated-photo');
  await key('Escape');
  await sleep(200);
  await uploadNumbered(1);
  stored = await storedPhotos();
  check('new photographs join a migrated album', stored.names.length === 3 && stored.names[2] === 'photo-1.jpg');

  await load();
  check('migration does not run again on refresh', (await storedPhotos()).title === 'Family 1998' && (await storedPhotos()).names.length === 3);

  await backToLibrary();
  await deleteFromLibrary('default');
  const after = await storedPhotos('default');
  check('a migrated album can be deleted cleanly', after.totals.albums === 0 && after.totals.photos === 0 && after.totals.blobs === 0);
}

async function deleteFromLibrary(albumId) {
  await js(`document.querySelector('[data-album-id="${albumId}"] .album-menu-button').click();`);
  await sleep(150);
  await js(`[...document.querySelectorAll('[data-album-id="${albumId}"] .album-menu-list button')].find((b) => b.textContent === 'Delete').click();`);
  await sleep(250);
  await clickButton('Delete album');
  await sleep(600);
}

/** Clicks a book in the library and returns as soon as its album is on screen. */
async function clickBookInLibrary(albumId) {
  const at = await js(`const el = document.querySelector('[data-album-id="${albumId}"] .album-open');
    el.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 150));
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  await click(at.x, at.y);
  await waitFor(`location.pathname.startsWith('/albums/') && ${ALBUM_READY} && document.querySelector('.album-canvas canvas')`);
}

async function roomAndOpening() {
  section('The room and the opening scene');
  await viewport(1440, 900);
  await load('/');
  await helpers();
  const id = await createAlbum('Room test');

  check('colours go through the neutral tone curve', (await js('return window.__albumRenderer.toneMapping;')) === 7);
  await sleep(1500);
  const assets = await js(`return performance.getEntriesByType('resource').filter((e) => e.name.includes('/scene/')).map((e) => ({ name: e.name.split('/scene/')[1], status: e.responseStatus }));`);
  check('the room, its objects and its reflections all load', assets.length >= 10 && assets.every((a) => a.status === 200 || a.status === 304 || a.status === 0), `${assets.length} files`);

  await backToLibrary();
  await clickBookInLibrary(id);
  await waitFor("document.querySelector('.opening-skip')", 3000);
  check('an opening scene can be skipped', true);
  check('the interface steps aside while it plays', await js("return document.querySelector('.app').classList.contains('in-opening');"));
  await js("document.querySelector('.opening-skip').click();");
  await sleep(150);
  let opened = await js('const c = window.__album; return { open: c.open, stage: c.stage(), omega: c.coverOmega };');
  check('skipping opens the book at once', opened.open === 1 && opened.stage === 'open', JSON.stringify(opened));
  check('and the Skip control goes', await js("return !document.querySelector('.opening-skip');"));

  await backToLibrary();
  await clickBookInLibrary(id);
  await waitFor('window.__album.open > 0.02 && window.__album.open < 0.5', 5000);
  await shot('opening-page-fan');
  await sleep(4500);
  opened = await js('const c = window.__album; return { open: c.open, stage: c.stage(), omega: c.coverOmega };');
  check('left alone, it ends with the book open', opened.open === 1 && opened.stage === 'open', JSON.stringify(opened));
  check('and with covers back at their usual pace', opened.omega === 4.2, `omega ${opened.omega}`);
  check('the Skip control goes by itself', await js("return !document.querySelector('.opening-skip');"));
  const closingFrom = Date.now();
  await js('window.__album.closeAlbum();');
  await settle();
  check('closing afterwards takes normal time', Date.now() - closingFrom < 3500, `${Date.now() - closingFrom}ms`);

  await backToLibrary();
  await waitFor('window.__view');
  await js('window.__view.setOpeningScene(false);');
  await clickBookInLibrary(id);
  await sleep(200);
  check('the opening scene can be turned off', await js("return !document.querySelector('.opening-skip');"));
  await sleep(600);
  await settle();
  check('and a book still opens by itself', (await state()).stage === 'open');
  await js('window.__view.setOpeningScene(true);');

  section('Quality levels');
  for (const level of ['low', 'balanced', 'high']) {
    await js(`window.__view.setChoice('${level}');`);
    await sleep(900);
    const before = await js('return window.__albumRenderer.info.render.frame;');
    await sleep(500);
    const after = await js('return window.__albumRenderer.info.render.frame;');
    check(`${level} draws correctly`, after > before + 3, `${after - before} frames`);
    await shot(`quality-${level}`);
  }
  await js("window.__view.setChoice('auto');");
  await sleep(500);
  check('the choice is remembered', await js("return JSON.parse(localStorage.getItem('keepsake.view')).choice === 'auto';"));

  section('Photographs stay true');
  // A plain mid-grey photograph shows exactly what the lights and tone curve do to any picture.
  await js(`const c = document.createElement('canvas'); c.width = 1200; c.height = 800;
    const x = c.getContext('2d'); x.fillStyle = 'rgb(128,128,128)'; x.fillRect(0, 0, 1200, 800);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', .95));
    __upload([new File([blob], 'grey.jpg', { type: 'image/jpeg', lastModified: Date.UTC(2023, 1, 1) })]); await __uploadDone();`);
  await settle();
  await mouse('mouseMoved', 720, 870);
  await sleep(1500);
  const spot = await onPage(-1.5, 0.3);
  const { data: greyShot } = await send('Page.captureScreenshot', { format: 'png' });
  const grey = await js(`const img = new Image(); img.src = 'data:image/png;base64,${greyShot}'; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(${Math.round(spot.x)} - 20, ${Math.round(spot.y)} - 20, 40, 40).data; let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } const n = d.length / 4; return [r / n, g / n, b / n].map(Math.round);`);
  check('a grey photograph is not tinted', Math.max(...grey) - Math.min(...grey) <= 24, `rgb(${grey.join(',')})`);
  check('nor made much lighter or darker', grey[1] >= 100 && grey[1] <= 165, `rgb(${grey.join(',')})`);

  section('Uploads from phones and laptops');
  await js(`const make = async (w, h, type, name) => { const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#46a'); g.addColorStop(1, '#a64'); x.fillStyle = g; x.fillRect(0, 0, w, h);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', .9)); return new File([blob], name, { type, lastModified: Date.UTC(2023, 1, 1) }); };
    __upload([await make(8064, 6048, 'image/jpeg', 'iphone-48mp.jpg'), await make(3024, 4032, 'image/jpeg', 'iphone-portrait.jpg'), await make(1000, 700, '', 'no-stated-type.jpg')]);
    await __uploadDone();`);
  await settle();
  const uploads = (await storedPhotos()).meta;
  const uploaded = (name) => uploads.find((p) => p.name === name);
  check('a 48-megapixel photo is accepted, at a sensible size', uploaded('iphone-48mp.jpg')?.w === 2400 && uploaded('iphone-48mp.jpg')?.h === 1800, JSON.stringify(uploaded('iphone-48mp.jpg')));
  check('a 12-megapixel portrait keeps its shape', uploaded('iphone-portrait.jpg')?.w === 1800 && uploaded('iphone-portrait.jpg')?.h === 2400);
  check('a file with no stated type is still read', uploaded('no-stated-type.jpg')?.w === 1000);
  const notAnImage = await js(`__upload([new File(['just some text'], 'notes.txt', { type: 'text/plain' })]); await __uploadDone(); return document.querySelector('.notice')?.textContent ?? '';`);
  check('something that really is not a photo gets a clear message', notAnImage.includes('notes.txt') && notAnImage.includes('HEIC'), notAnImage);
  await js("document.querySelector('.notice-close')?.click();");
  await js('window.__album.goToSpread(1);');
  await settle();

  section('The enlarged photograph');
  const atPhoto = await onPage(-1.5, 0.3);
  const cameraBefore = await js('return window.__albumCamera.position.length();');
  await click(atPhoto.x, atPhoto.y);
  await sleep(1300);
  check('it opens', await js("return Boolean(document.querySelector('dialog.viewer[open] img'));"));
  check('the camera moves in', (await js('return window.__albumCamera.position.length();')) < cameraBefore * 0.92);
  check('the photograph is shown at full size, unfiltered', await js("const i = document.querySelector('dialog.viewer[open] img'); return i.naturalWidth === 1200 && getComputedStyle(i).filter === 'none';"));
  check('the room behind it goes out of focus', await js("return getComputedStyle(document.querySelector('.album-canvas canvas')).filter.includes('blur');"));
  check('a file date is not presented as the day it was taken', !(await js("return document.querySelector('.viewer-foot').textContent;")).match(/dated|Taken|2023/));
  await shot('viewer-cinematic');
  await key('Escape');
  await sleep(1800);
  check('and back out when it closes', Math.abs((await js('return window.__albumCamera.position.length();')) - cameraBefore) < 0.4);
  await js('window.__album.closeAlbum();');
  await settle();

  await backToLibrary();
  await deleteFromLibrary(id);
}

async function desktopCore() {
  await roomAndOpening();
  section('Desktop: creating an album, then the album itself (1440x900, mouse)');
  await viewport(1440, 900);
  await load('/');
  await helpers();
  await createAlbum('Core album');
  check('a new album opens straight away', (await state()).stage === 'open', await label());
  check('new album is empty', (await countText()) === '0 photographs');
  await load();
  await helpers();
  check('after a refresh it stays in the album, closed', (await label()) === 'Closed' && (await js('return location.pathname;')).startsWith('/albums/'));
  await shot('desktop-1-closed-angle');
  const closedAngle = await js('const c = window.__albumCamera; return Math.hypot(c.rotation.x, c.rotation.y);');
  check('a closed book is seen at an angle', closedAngle > 0.4, `${closedAngle.toFixed(2)} rad`);
  check('no horizontal overflow', await noHorizontalOverflow());
  check('two-page mode on desktop', (await state()).mode === 'spread');
  const arrangeDisabled = await js("return [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent === 'Arrange').disabled;");
  check('arrange unavailable with no photos', arrangeDisabled);
  await shot('desktop-1-closed');
  await click(720, 450);
  await settle();
  check('clicking the cover opens the book', (await label()) === 'Page 1 of 8', await label());
  check('open book is centred on the spine', (await state()).offset === 0);
  await shot('desktop-2-empty-open');

  section('Desktop: turning the closed book by hand');
  await load();
  await helpers();
  await sleep(600);
  const bookAngle = () => js('const q = window.__album.spin.q; return 2 * Math.acos(Math.min(1, Math.abs(q[3])));');
  const heldShots = [[150, 0, 'side'], [160, 0, 'back'], [0, 150, 'over-the-top'], [90, 90, 'corner']];
  await mouse('mouseMoved', 720, 460);
  await mouse('mousePressed', 720, 460, 1, 'left');
  let turnX = 720;
  let turnY = 460;
  for (const [dx, dy, name] of heldShots) {
    for (let i = 1; i <= 8; i += 1) {
      await mouse('mouseMoved', turnX + (dx * i) / 8, turnY + (dy * i) / 8, 1);
      await sleep(16);
    }
    turnX += dx;
    turnY += dy;
    await sleep(120);
    await shot(`spin-${name}`);
  }
  check('dragging turns the book', (await bookAngle()) > 0.2, `${(await bookAngle()).toFixed(2)} rad from flat`);
  await sleep(200);
  await mouse('mouseReleased', turnX, turnY, 0, 'left');
  await sleep(120);
  check('turning a book does not open it', (await state()).stage === 'closed-front');
  await settle(8000);
  const leftAt = await bookAngle();
  await sleep(1800);
  check('it stays where it was left', leftAt > 0.2 && (await bookAngle()) === leftAt, `${leftAt.toFixed(2)} rad`);
  await shot('spin-left-in-the-air');
  await mouse('mouseMoved', 60, 560);
  await mouse('mousePressed', 60, 560, 1, 'left');
  await mouse('mouseReleased', 60, 560, 0, 'left');
  await sleep(500);
  check('clicking the table does not open a book left in the air', (await state()).stage === 'closed-front' && (await bookAngle()) === leftAt);
  await js("document.querySelector('.set-down').click();");
  await settle(8000);
  check('Set it down puts it back on the table', (await bookAngle()) === 0);
  check('the button goes away once it is down', await js("return !document.querySelector('.set-down') && Boolean(document.querySelector('.spin-hint'));"));

  section('Sound is off');
  await mouse('mouseMoved', 720, 460);
  await mouse('mousePressed', 720, 460, 1, 'left');
  await mouse('mouseReleased', 720, 460, 0, 'left');
  await settle(8000);
  await key('ArrowRight');
  await settle(8000);
  const silent = await js('return window.__albumSound();');
  check('no audio is created, even after clicks and page turns', silent.state === 'none', silent.state);
  check('there is no sound button', await js("return !document.querySelector('.sound-toggle');"));
  await load();
  await helpers();
  await sleep(600);

  await mouse('mouseMoved', 720, 460);
  await mouse('mousePressed', 720, 460, 1, 'left');
  for (let i = 1; i <= 10; i += 1) {
    await mouse('mouseMoved', 720 + i * 12, 460, 1);
    await sleep(16);
  }
  await mouse('mouseReleased', 840, 460, 0, 'left');
  await js('window.__album.next();');
  await sleep(120);
  check('asked to open while turned, it waits for the table', (await js('return window.__album.open;')) === 0);
  await settle(8000);
  check('and then opens', (await state()).stage === 'open' && (await bookAngle()) === 0);

  await load();
  await helpers();
  await sleep(600);
  const movedNot = await js('return window.__album.spin.isRotated;');
  check('a plain click still opens the book, unturned', movedNot === false);

  section('Desktop: living effects');
  await shot('fx-1-closed-with-prints');
  await js('window.__album.next();');
  await sleep(320);
  await shot('fx-2-cover-lifting');
  await sleep(350);
  await shot('fx-3-light-from-the-pages');
  await settle();

  section('Desktop: 3D view responds to the pointer');
  const viewAt = () => js('const p = window.__albumCamera.position; return { x: p.x, y: p.y, z: p.z };');
  await mouse('mouseMoved', 1400, 100);
  await sleep(1400);
  const swungRight = await viewAt();
  await mouse('mouseMoved', 40, 800);
  await sleep(1400);
  const swungLeft = await viewAt();
  check('camera moves with the mouse', swungRight.x > 0.3 && swungLeft.x < -0.3, `x ${swungLeft.x.toFixed(2)} to ${swungRight.x.toFixed(2)}`);
  const tilt = await js('const c = window.__albumCamera; return Math.hypot(c.rotation.x, c.rotation.y);');
  check('the swing stays slight on an open book', tilt < 0.09, `${tilt.toFixed(3)} rad`);
  await sleep(800);
  const framesAt = () => js('return window.__albumRenderer.info.render.frame;');
  const frameA = await framesAt();
  await sleep(600);
  check('the scene keeps living while nothing is touched', (await framesAt()) > frameA + 10, `${(await framesAt()) - frameA} frames`);
  check('an idle book does not redraw its costly shadows', (await js('return window.__albumRenderer.shadowMap.needsUpdate;')) === false);
  await mouse('mouseMoved', 720, 450);
  await sleep(1000);
  await shot('desktop-2b-open-parallax');

  section('Desktop: upload and persistence');
  await uploadNumbered(5);
  let stored = await storedPhotos();
  check('5 photographs stored', stored.names.length === 5 && stored.blobs === 5);
  check('in upload order', stored.names.join() === [1, 2, 3, 4, 5].map((n) => `photo-${n}.jpg`).join());
  check('jumped to the first new photo', (await state()).spread === 1);
  // With the mouse's light directly over the spread, the worst case for washing it out.
  await mouse('mouseMoved', 720, 400);
  await sleep(1500);
  await shot('desktop-3-photos');
  const blown = await blownFraction();
  check('photographs and paper are not washed out by the effects', blown < 0.03, `${(blown * 100).toFixed(1)}% of pixels near white`);
  await load();
  await helpers();
  check('survives a refresh', (await countText()) === '5 photographs');
  check('order survives a refresh', (await storedPhotos()).names[0] === 'photo-1.jpg');

  section('Desktop: page navigation');
  await click(720, 450);
  await settle();
  await key('ArrowRight');
  await settle();
  check('right arrow turns forward', (await state()).spread === 1);
  await key('ArrowRight');
  await settle();
  await key('ArrowLeft');
  await settle();
  check('left arrow turns back', (await state()).spread === 1);
  let edge = await onPage(2.85, 0);
  await click(edge.x, edge.y);
  await settle();
  check('clicking the right edge turns forward', (await state()).spread === 2);
  edge = await onPage(-2.85, 0);
  await click(edge.x, edge.y);
  await settle();
  check('clicking the left edge turns back', (await state()).spread === 1);
  await js("document.querySelector('[aria-label=\"Next page\"]').click();");
  await settle();
  check('toolbar next works', (await state()).spread === 2);
  await js("document.querySelector('[aria-label=\"Previous page\"]').click();");
  await settle();
  check('toolbar previous works', (await state()).spread === 1);

  section('Desktop: page curl under the pointer');
  const corner = await onPage(2.9, -1.6);
  const near = await onPage(1.9, -1.4);
  await mouseDrag(corner, near, { hold: 350, release: false });
  const held = await js('const e = window.__album.active.get(window.__album.spread); return { t: e?.t, curl: e?.curl, dragging: e?.dragging };');
  check('page lifts and curls while held', held.dragging && held.t > 0.05 && held.t < 0.42 && held.curl > 0.5, `t=${held.t?.toFixed(2)} curl=${held.curl?.toFixed(2)}`);
  await shot('desktop-4-curl-lifted');
  await mouse('mouseReleased', near.x, near.y, 0, 'left');
  await settle();
  check('short drag falls back', (await state()).spread === 1);

  const mid = await onPage(-0.4, -1.1);
  await mouseDrag(corner, mid, { hold: 400, release: false });
  await shot('desktop-5-curl-across');
  await mouse('mouseReleased', mid.x, mid.y, 0, 'left');
  await settle();
  check('long drag completes', (await state()).spread === 2);
  const leftEdge = await onPage(-2.9, 1.5);
  const backTo = await onPage(1.4, 1.2);
  await mouseDrag(leftEdge, backTo, { hold: 150 });
  await settle();
  check('dragging the left page back undoes it', (await state()).spread === 1);
  const flickFrom = await onPage(2.9, 0);
  const flickTo = await onPage(2.0, 0);
  await mouseDrag(flickFrom, flickTo, { steps: 4, stepMs: 8 });
  await settle();
  check('a quick flick completes a short drag', (await state()).spread === 2);
  await js("document.querySelector('[aria-label=\"Previous page\"]').click();");
  await settle();

  section('Desktop: removing a photograph');
  const removeAt = await js(`const b = [...document.querySelectorAll('.page-action')].find((x) => x.textContent === 'Remove').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };`);
  await click(removeAt.x, removeAt.y);
  await sleep(250);
  check('asks before deleting', (await dialogTitle()) === 'Remove this photograph?', await dialogTitle());
  check('focus starts on Keep', (await js('return document.activeElement.textContent;')) === 'Keep');
  await key('Escape');
  await sleep(200);
  check('Escape cancels', (await storedPhotos()).names.length === 5);
  await click(removeAt.x, removeAt.y);
  await sleep(250);
  await clickButton('Remove');
  await sleep(500);
  stored = await storedPhotos();
  check('removed from storage, with its image', stored.names.length === 4 && stored.blobs === 4);
  check('the right one was removed', stored.names[0] === 'photo-2.jpg');
}

async function arrangeTitleExif() {
  section('Desktop: arranging photographs by mouse drag');
  await clickButton('Arrange');
  await sleep(600);
  check('arranger opens', (await dialogTitle()) === 'Arrange photographs');
  await shot('desktop-6-arranger');
  const rect = (i) =>
    js(`const r = document.querySelectorAll('.arrange-tile')[${i}].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 3 };`);
  const from = await rect(0);
  const to = await rect(2);
  await mouseDrag(from, to, { hold: 120, release: false });
  await shot('desktop-7-arranger-dragging');
  await mouse('mouseReleased', to.x, to.y, 0, 'left');
  await sleep(400);
  let stored = await storedPhotos();
  check('drag saved the new order', stored.names.join() === 'photo-3.jpg,photo-4.jpg,photo-2.jpg,photo-5.jpg', stored.names.join());
  check('order numbers are sequential', stored.orders.join() === '0,1,2,3');

  const before = stored.names.join();
  const a = await rect(0);
  await mouseDrag(a, await rect(3), { release: false, hold: 100 });
  await key('Escape');
  await sleep(250);
  await mouse('mouseReleased', a.x, a.y, 0, 'left');
  await sleep(250);
  check('Escape during a drag cancels only the drag', (await storedPhotos()).names.join() === before && (await dialogTitle()) === 'Arrange photographs');

  await js("document.querySelector('.arrange-tile:nth-child(2) [aria-label$=\"later\"]').focus();");
  await key('Enter');
  await sleep(300);
  stored = await storedPhotos();
  check('move buttons work from the keyboard', stored.names.join() === 'photo-3.jpg,photo-2.jpg,photo-4.jpg,photo-5.jpg', stored.names.join());
  await clickButton('Done');
  await sleep(300);

  await load();
  await helpers();
  stored = await storedPhotos();
  check('new order survives a refresh', stored.names[0] === 'photo-3.jpg');
  await click(720, 450);
  await settle();
  await key('ArrowRight');
  await settle();
  // Page 2 is the first photograph, so clicking its photo should open photo-3.
  const leftPhoto = await onPage(-1.5, 0.3);
  await click(leftPhoto.x, leftPhoto.y);
  await sleep(350);
  const shown = await js("return document.querySelector('dialog.viewer[open]')?.getAttribute('aria-label');");
  check('pages show the new order', shown === 'Photograph photo-3.jpg', shown);
  await key('Escape');
  await sleep(200);

  section('Desktop: album details');
  await clickButton('Details');
  await sleep(250);
  check('details dialog opens', (await dialogTitle()) === 'Album details');
  const namesBeforeRename = (await storedPhotos()).names.join();
  await setField('dialog[open] input[name="album-title"]', 'Summer in Puri');
  await clickButton('Save');
  await sleep(400);
  check('title stored', (await storedPhotos()).title === 'Summer in Puri');
  check('renaming does not touch the photographs', (await storedPhotos()).names.join() === namesBeforeRename);
  await js('window.__album.closeAlbum();');
  await settle(9000);
  await sleep(600);
  await shot('desktop-8-renamed-cover');
  await load();
  await helpers();
  check('title survives a refresh', (await storedPhotos()).title === 'Summer in Puri');
  await shot('desktop-9-cover-after-refresh');
  await clickButton('Details');
  await sleep(250);
  check('dialog shows the current title', (await js("return document.querySelector('dialog[open] input[name=\"album-title\"]').value;")) === 'Summer in Puri');
  await setField('dialog[open] input[name="album-title"]', '   ');
  await clickButton('Save');
  await sleep(400);
  check('blank title returns to the default', (await storedPhotos()).title === 'Our Memories');

  section('Desktop: capture dates');
  await js(`const fileDate = Date.UTC(2024, 10, 20, 12);
    const exif = await __withExif(await __makePhoto('with-exif.jpg', { lastModified: fileDate }), '2016:03:09 14:05:30');
    const big = await __withExif(await __makePhoto('big-exif.jpg', { w: 3000, h: 2000, lastModified: fileDate }), '2012:12:25 08:00:00');
    const placeholder = await __withExif(await __makePhoto('placeholder.jpg', { lastModified: fileDate }), '0000:00:00 00:00:00');
    const plain = await __makePhoto('plain.jpg', { lastModified: fileDate });
    const png = await __makePhoto('picture.png', { type: 'image/png', lastModified: fileDate });
    __upload([exif, big, placeholder, plain, png]); await __uploadDone();`);
  await settle();
  stored = await storedPhotos();
  const meta = (name) => stored.meta.find((m) => m.name === name);
  const y = (m) => new Date(m.takenAt).getFullYear();
  check('reads EXIF capture date', meta('with-exif.jpg').source === 'exif' && y(meta('with-exif.jpg')) === 2016);
  check('reads EXIF from an image that gets resized', meta('big-exif.jpg').source === 'exif' && y(meta('big-exif.jpg')) === 2012 && meta('big-exif.jpg').w === 2400);
  check('invalid EXIF falls back to the file date', meta('placeholder.jpg').source === 'file' && y(meta('placeholder.jpg')) === 2024);
  check('no EXIF falls back to the file date', meta('plain.jpg').source === 'file');
  check('PNG stored as JPEG', stored.types.every((t) => t === 'image/jpeg'));
  await sleep(500);
  const shownCaption = await js(`return document.querySelector('.toolbar-page').textContent;`);
  await shot('desktop-10-exif-captions');
  note(`after EXIF upload the book shows ${shownCaption}`);
}

async function multiAlbum() {
  section('Several albums: independence');
  const coreId = decodeURIComponent(currentPath.split('/')[2]);
  const coreBefore = await storedPhotos();
  await backToLibrary();
  check('back link returns to the library', (await js('return location.pathname;')) === '/');
  const created = await js("return document.querySelector('.album-grid') !== null;");
  check('library lists the album', created && (await libraryCards()).some((c) => c.id === coreId));

  const greenId = await createAlbum('Green Hills', {
    description: 'A week in the valley, with everyone together.',
    colour: 'forest', material: 'linen', paper: 'black',
  });
  await shot('album-theme-open');
  let green = await storedPhotos();
  check('new album has a unique id', greenId !== coreId);
  check('chosen look stored', green.album.theme.colour === 'forest' && green.album.theme.material === 'linen' && green.album.theme.paper === 'black');
  check('description stored', green.album.description.startsWith('A week'));
  check('creation date stored', Math.abs(green.album.createdAt - Date.now()) < 120000);
  await uploadNumbered(4);
  green = await storedPhotos();
  check('photographs go only into this album', green.names.length === 4);
  check('other album untouched', (await storedPhotos(coreId)).names.join() === coreBefore.names.join());
  await sleep(600);
  await shot('album-theme-photos');
  const shownAfterUpload = await colourfulFraction();
  check('uploaded photographs are visible on the page', shownAfterUpload > 0.04, `${(shownAfterUpload * 100).toFixed(1)}% of pixels`);

  await backToLibrary();
  // Moves the mouse off, then onto, a book: the cover should lift under the pointer.
  const hoverAt = await js(`const el = document.querySelector('[data-album-id="${greenId}"] .album-open'); el.scrollIntoView({ block: 'center' });
    await new Promise((r) => setTimeout(r, 150)); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  await mouse('mouseMoved', hoverAt.x, hoverAt.y);
  await sleep(500);
  await sleep(300);
  const leaning = await js(`return document.querySelector('[data-album-id="${greenId}"] .album-open').style.getPropertyValue('--gx');`);
  check('the book under the mouse responds to it', Boolean(leaning), `glare at ${leaning}`);
  await shot('library-hover');
  await mouse('mouseMoved', hoverAt.x, hoverAt.y);
  await mouse('mousePressed', hoverAt.x, hoverAt.y, 1, 'left');
  for (let i = 1; i <= 14; i += 1) {
    await mouse('mouseMoved', hoverAt.x + i * 14, hoverAt.y + i * 5, 1);
    await sleep(16);
  }
  await sleep(150);
  check('a small book turns under the mouse', await js(`return Boolean(document.querySelector('[data-album-id="${greenId}"] .album-open.is-turning'));`));
  await shot('library-card-turned');
  await mouse('mouseReleased', hoverAt.x + 196, hoverAt.y + 70, 0, 'left');
  await sleep(1000);
  check('turning a small book does not open it', (await js('return location.pathname;')) === '/');
  const smallBook = () => js(`const el = document.querySelector('[data-album-id="${greenId}"] .album-open');
    return { turning: el.classList.contains('is-turning'), y: el.style.getPropertyValue('--turn-y'), x: el.style.getPropertyValue('--turn-x') };`);
  const leftSmall = await smallBook();
  check('a small book stays where it was left', !leftSmall.turning && leftSmall.y !== '0deg', JSON.stringify(leftSmall));
  await js(`document.querySelector('[data-album-id="${greenId}"] .set-down').click();`);
  await sleep(1000);
  const downSmall = await smallBook();
  check('and goes back when set down', downSmall.y === '0deg' && downSmall.x === '0deg', JSON.stringify(downSmall));
  check('setting a small book down does not open it', (await js('return location.pathname;')) === '/');

  await js("document.querySelector('.library-scroll').scrollTop = 0;");
  await sleep(200);
  const slot = await js(`const r = document.querySelector('.library-slot-open').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  await mouse('mouseMoved', slot.x, slot.y);
  await mouse('mousePressed', slot.x, slot.y, 1, 'left');
  for (let i = 1; i <= 16; i += 1) {
    await mouse('mouseMoved', slot.x + i * 15, slot.y + i * 4, 1);
    await sleep(16);
  }
  await sleep(200);
  const showcaseAngle = await js('const q = window.__showcase.spin.q; return 2 * Math.acos(Math.min(1, Math.abs(q[3])));');
  check('the big 3D book in the library turns under the mouse', showcaseAngle > 0.2, `${showcaseAngle.toFixed(2)} rad`);
  await shot('library-showcase-turned');
  await mouse('mouseReleased', slot.x + 240, slot.y + 64, 0, 'left');
  await sleep(600);
  check('turning it does not open it', (await js('return location.pathname;')) === '/');
  await sleep(2500);
  check('the big book offers to be set down', await js("return Boolean(document.querySelector('.library-slot .set-down'));"));
  await shot('library-showcase-left');
  await js("document.querySelector('.library-slot .set-down').click();");
  await sleep(1800);
  check('and goes back', await js('const q = window.__showcase.spin.q; return q[3] === 1;'));

  await mouse('mouseMoved', 5, 5);
  await openFromLibrary(greenId);
  await key('ArrowRight');
  await settle();
  await sleep(500);
  const shownAfterReturn = await colourfulFraction();
  check('photographs are visible on returning to an album', shownAfterReturn > 0.04, `${(shownAfterReturn * 100).toFixed(1)}% of pixels`);
  await backToLibrary();
  const blueId = await createAlbum('Blue Coast', { colour: 'midnight', paper: 'white' });
  await uploadNumbered(3, 10);
  await backToLibrary();
  const cards = await libraryCards();
  check('library shows every album', [coreId, greenId, blueId].every((id) => cards.some((c) => c.id === id)));
  check('most recently changed comes first', cards[0].id === blueId, cards[0].title);
  check('each shows its own count', cards.find((c) => c.id === greenId).meta.includes('4 photographs') && cards.find((c) => c.id === blueId).meta.includes('3 photographs'));
  check('each shows when it changed', cards[0].meta.includes('updated today'));
  await sleep(500);
  await shot('library-2-collection');

  section('Several albums: ordering and captions stay separate');
  const greenNames = (await storedPhotos(greenId)).names.join();
  await openFromLibrary(blueId);
  await clickButton('Arrange');
  await sleep(600);
  await js("document.querySelector('.arrange-tile:nth-child(1) [aria-label$=\"later\"]').click();");
  await sleep(300);
  await clickButton('Done');
  await sleep(200);
  const blue = await storedPhotos();
  check('reordering works per album', blue.names.join() === 'photo-12.jpg,photo-11.jpg,photo-13.jpg', blue.names.join());
  check('order numbers are per album', blue.orders.join() === '0,1,2');
  check('other album keeps its order', (await storedPhotos(greenId)).names.join() === greenNames);

  await key('ArrowRight');
  await settle();
  const left = await onPage(-1.5, 0.3);
  await click(left.x, left.y);
  await sleep(450);
  await setField('dialog.viewer[open] .viewer-caption', '  Sunset   at the lighthouse  ');
  await shot('caption-editing');
  await clickButton('Close');
  await sleep(700);
  let photo = (await storedPhotos()).meta[0];
  check('caption saved and tidied', photo.caption === 'Sunset at the lighthouse', photo.caption);
  check('caption keeps the photo’s other information', photo.takenAt > 0 && photo.w > 0 && photo.source === 'file');
  check('blob untouched by captioning', (await storedPhotos()).blobs === 3);
  await sleep(500);
  await shot('caption-on-page');

  const captionAction = await js(`const b = [...document.querySelectorAll('.page-action')].find((x) => x.textContent === 'Edit caption');
    if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  check('page offers to edit its caption', Boolean(captionAction));
  await click(captionAction.x, captionAction.y);
  await sleep(450);
  check('caption shown again for editing', (await js("return document.querySelector('dialog.viewer[open] .viewer-caption').value;")) === 'Sunset at the lighthouse');
  await key('Escape');
  await sleep(250);

  await load();
  await helpers();
  check('caption survives a refresh', (await storedPhotos()).meta[0].caption === 'Sunset at the lighthouse');
  check('order survives a refresh', (await storedPhotos()).names[0] === 'photo-12.jpg');
  check('no other album gains the caption', (await storedPhotos(greenId)).meta.every((m) => !m.caption));

  await key('ArrowRight');
  await settle(); // cover opens
  await key('ArrowRight');
  await settle();
  const leftAgain = await onPage(-1.5, 0.3);
  await click(leftAgain.x, leftAgain.y);
  await sleep(450);
  await setField('dialog.viewer[open] .viewer-caption', '');
  await clickButton('Close');
  await sleep(500);
  check('a caption can be cleared', (await storedPhotos()).meta[0].caption === '');
  await click(leftAgain.x, leftAgain.y);
  await sleep(450);
  await setField('dialog.viewer[open] .viewer-caption', 'Sunset at the lighthouse');
  await key('Escape');
  await sleep(600);
  check('closing with Escape still saves the caption', (await storedPhotos()).meta[0].caption === 'Sunset at the lighthouse');

  section('Several albums: customising');
  await clickButton('Details');
  await sleep(300);
  await js(`document.querySelector('dialog[open] input[name="Cover colour"][value="burgundy"]').click();
    document.querySelector('dialog[open] input[name="Paper"][value="kraft"]').click();`);
  await sleep(200);
  await shot('editor-in-album');
  await clickButton('Save');
  await sleep(1100);
  await settle();
  await sleep(600);
  const shownAfterChange = await colourfulFraction();
  check('photographs are still visible after changing the look', shownAfterChange > 0.04, `${(shownAfterChange * 100).toFixed(1)}% of pixels`);
  const changed = await storedPhotos();
  check('look can be changed later', changed.album.theme.colour === 'burgundy' && changed.album.theme.paper === 'kraft');
  check('changing the look keeps the photographs', changed.names.length === 3 && changed.meta[0].caption === 'Sunset at the lighthouse');
  check('book still shows the same page after the change', (await state()).spread === 1);
  await shot('album-rethemed');

  section('Several albums: management from the library');
  await backToLibrary();
  await js(`document.querySelector('[data-album-id="${greenId}"] .album-menu-button').click();`);
  await sleep(200);
  await shot('library-3-menu');
  await js(`[...document.querySelectorAll('[data-album-id="${greenId}"] .album-menu-list button')].find((b) => b.textContent.startsWith('Rename')).click();`);
  await sleep(300);
  await shot('library-4-editor');
  await setField('dialog[open] input[name="album-title"]', 'The Green Hills');
  await clickButton('Save');
  await sleep(500);
  check('renamed from the library', (await libraryCards()).some((c) => c.id === greenId && c.title === 'The Green Hills'));
  check('rename keeps its photographs', (await storedPhotos(greenId)).names.join() === greenNames);

  const totalsBefore = (await storedPhotos(blueId)).totals;
  await js(`document.querySelector('[data-album-id="${blueId}"] .album-menu-button').click();`);
  await sleep(150);
  await js(`[...document.querySelectorAll('[data-album-id="${blueId}"] .album-menu-list button')].find((b) => b.textContent === 'Duplicate').click();`);
  await sleep(700);
  const withCopy = await libraryCards();
  const copy = withCopy.find((c) => c.title === 'Blue Coast (copy)');
  check('duplicate appears', Boolean(copy), JSON.stringify(withCopy.map((c) => c.title)));
  const copied = await storedPhotos(copy.id);
  const original = await storedPhotos(blueId);
  check('duplicate has the photographs, order and captions', copied.names.join() === original.names.join() && copied.meta[0].caption === 'Sunset at the lighthouse');
  check('duplicate has its own images', copied.blobs === 3 && copied.meta.every((m, i) => m.id !== original.meta[i].id));
  check('duplicate keeps the look', copied.album.theme.colour === 'burgundy');
  check('totals grew by exactly one album', copied.totals.albums === totalsBefore.albums + 1 && copied.totals.blobs === totalsBefore.blobs + 3);

  await openFromLibrary(copy.id);
  await clickButton('Arrange');
  await sleep(500);
  await js("document.querySelector('.arrange-tile:nth-child(1) [aria-label$=\"later\"]').click();");
  await sleep(300);
  await clickButton('Done');
  await sleep(200);
  check('changing a duplicate leaves the original alone', (await storedPhotos(blueId)).names[0] === 'photo-12.jpg' && (await storedPhotos()).names[0] !== 'photo-12.jpg');
  await clickButton('Clear album');
  await sleep(300);
  await js(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Clear album').click();`);
  await sleep(600);
  await settle(9000);
  check('clearing one album empties only that album', (await storedPhotos()).names.length === 0 && (await storedPhotos(blueId)).names.length === 3 && (await storedPhotos(greenId)).names.length === 4);
  await backToLibrary();

  const beforeDelete = await storedPhotos(blueId);
  await js(`document.querySelector('[data-album-id="${blueId}"] .album-menu-button').click();`);
  await sleep(150);
  await js(`[...document.querySelectorAll('[data-album-id="${blueId}"] .album-menu-list button')].find((b) => b.textContent === 'Delete').click();`);
  await sleep(300);
  check('deleting asks first', (await dialogTitle()) === 'Delete “Blue Coast”?', await dialogTitle());
  check('focus starts on Keep', (await js('return document.activeElement.textContent;')) === 'Keep');
  await shot('library-5-delete');
  await clickButton('Keep');
  await sleep(250);
  check('Keep deletes nothing', (await storedPhotos(blueId)).totals.blobs === beforeDelete.totals.blobs);
  await deleteFromLibrary(blueId);
  const afterDelete = await storedPhotos(greenId);
  check('album removed', !(await libraryCards()).some((c) => c.id === blueId) && (await storedPhotos(blueId)).album === null);
  check('its images removed', afterDelete.totals.blobs === beforeDelete.totals.blobs - 3 && afterDelete.totals.orphanBlobs === 0);
  check('other albums fully intact', afterDelete.names.join() === greenNames && afterDelete.blobs === 4 && (await storedPhotos(coreId)).blobs === coreBefore.blobs + 0);

  section('Individual and Couple collections (kept in this browser)');
  await load('/');
  const tabs = () => js(`return [...document.querySelectorAll('.collection-tab')].map((t) => ({ name: t.querySelector('.collection-name').textContent,
    count: Number(t.querySelector('.collection-count').textContent), selected: t.getAttribute('aria-selected') === 'true' }));`);
  let collectionTabs = await tabs();
  const shelfIds = async () => (await libraryCards()).map((c) => c.id);
  check('the library has Individual and Couple collections', collectionTabs.map((x) => x.name).join() === 'Individual,Couple');
  check('every existing album is Individual', collectionTabs[0].selected && collectionTabs[1].count === 0
    && collectionTabs[0].count === afterDelete.totals.albums && (await shelfIds()).length === afterDelete.totals.albums);
  check('new albums were saved as Individual by default', (await storedPhotos(greenId)).album.category === 'INDIVIDUAL');
  // An album saved before categories existed has no category at all.
  await js(`const db = await new Promise((res, rej) => { const q = indexedDB.open('keepsake'); q.onsuccess = () => res(q.result); q.onerror = rej; });
    await new Promise((res) => { const tx = db.transaction('albums', 'readwrite');
      tx.objectStore('albums').put({ id: 'from-before', title: 'From before', description: '', theme: { colour: 'sand', material: 'linen', paper: 'white' }, createdAt: 1, updatedAt: 2 });
      tx.oncomplete = res; }); db.close();`);
  await load('/');
  check('an album from before categories appears under Individual', (await shelfIds()).includes('from-before') && (await tabs())[0].count === afterDelete.totals.albums + 1);
  await deleteFromLibrary('from-before');

  const greenBefore = await storedPhotos(greenId);
  await js(`document.querySelector('[data-album-id="${greenId}"] .album-menu-button').click();`);
  await sleep(150);
  await js(`[...document.querySelectorAll('[data-album-id="${greenId}"] .album-menu-list button')].find((b) => b.textContent === 'Move to Couple').click();`);
  await waitFor("document.querySelector('.notice')?.textContent.includes('moved to Couple')");
  await sleep(300);
  const greenAfter = await storedPhotos(greenId);
  check('moving leaves the Individual shelf', !(await shelfIds()).includes(greenId));
  check('the moved album keeps everything', greenAfter.album.category === 'COUPLE' && greenAfter.album.id === greenId
    && greenAfter.album.updatedAt === greenBefore.album.updatedAt && greenAfter.album.title === greenBefore.album.title
    && JSON.stringify(greenAfter.album.theme) === JSON.stringify(greenBefore.album.theme)
    && JSON.stringify(greenAfter.meta) === JSON.stringify(greenBefore.meta) && greenAfter.blobs === greenBefore.blobs);
  await js("document.querySelector('#collection-COUPLE').click();");
  await sleep(500);
  collectionTabs = await tabs();
  check('the Couple shelf has it', collectionTabs[1].selected && collectionTabs[1].count === 1 && (await shelfIds()).join() === greenId);
  await shot('library-couple');
  check('tabs follow the arrow keys', await js(`document.querySelector('#collection-COUPLE').focus();
    document.querySelector('#collection-COUPLE').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    return document.activeElement.id === 'collection-INDIVIDUAL' && document.activeElement.getAttribute('aria-selected') === 'true';`));
  await js("document.querySelector('#collection-COUPLE').click();");
  await sleep(400);
  await js(`document.querySelector('[data-album-id="${greenId}"] .album-menu-button').click();`);
  await sleep(150);
  await js(`[...document.querySelectorAll('[data-album-id="${greenId}"] .album-menu-list button')].find((b) => b.textContent === 'Move to Individual').click();`);
  await waitFor("document.querySelector('.notice')?.textContent.includes('moved to Individual')");
  await sleep(300);
  check('and back again', (await storedPhotos(greenId)).album.category === 'INDIVIDUAL' && (await shelfIds()).length === 0);
  await js("document.querySelector('#collection-INDIVIDUAL').click();");
  await sleep(400);

  await js(`[...document.querySelectorAll('.library-intro .tool')][0].click();`);
  await sleep(250);
  check('the creation screen starts on Individual', await js("return document.querySelector('dialog[open] input[name=album-category][value=INDIVIDUAL]').checked;"));
  await js("document.querySelector('dialog[open] input[name=album-category][value=COUPLE]').click();");
  await setField('dialog[open] input[name="album-title"]', 'Together');
  await shot('library-create-couple');
  await clickButton('Create album');
  await waitFor(`location.pathname.startsWith('/albums/') && ${ALBUM_READY}`);
  const togetherId = decodeURIComponent((await js('return location.pathname;')).split('/')[2]);
  check('a Couple album is saved as Couple', (await storedPhotos(togetherId)).album.category === 'COUPLE');
  await waitFor("window.__album.stage() === 'open'");
  currentPath = await js('return location.pathname;');
  await backToLibrary();
  check('and is waiting on the Couple shelf', (await tabs())[1].selected && (await shelfIds()).join() === togetherId);
  await deleteFromLibrary(togetherId);
  check('the Couple shelf can be empty', (await js("return document.querySelector('.collection-empty')?.textContent ?? '';")).includes('No couple albums yet'));
  await js("document.querySelector('#collection-INDIVIDUAL').click();");
  await sleep(400);
  check('accounts screens explain they are not needed here', await (async () => {
    await send('Page.navigate', { url: `${URL_ROOT}/forgot-password` });
    await waitFor("document.querySelector('.account-card h1')");
    return (await js("return document.querySelector('.account-card h1').textContent;")) === 'No account needed';
  })());

  section('Navigation');
  await load('/');
  check('library survives a refresh', (await libraryCards()).length === afterDelete.totals.albums);
  await load(`/albums/${encodeURIComponent(blueId)}`).catch(() => {});
  await waitFor("document.querySelector('.missing-album')");
  check('a deleted album gives a helpful page', (await js("return document.querySelector('.missing-album h1').textContent;")).includes('isn’t here'));
  await shot('missing-album');
  await js("document.querySelector('.missing-album a').click();");
  await waitFor(`location.pathname === '/' && ${LIBRARY_READY}`);
  check('and a way back', true);
  currentPath = '/';
  await helpers();

  await openFromLibrary(greenId);
  await js('history.back();');
  await waitFor(`location.pathname === '/' && ${LIBRARY_READY}`);
  check('browser back returns to the library', true);
  await js('history.forward();');
  await waitFor(`location.pathname.startsWith('/albums/') && ${ALBUM_READY}`);
  check('browser forward returns to the album', true);
  await sleep(800);
  currentPath = await js('return location.pathname;');
  await helpers();

  section('Going in and out repeatedly');
  await backToLibrary();
  const heapStart = await heapMB();
  for (let i = 0; i < 8; i += 1) {
    await openFromLibrary(i % 2 ? greenId : coreId);
    await key('ArrowRight');
    await settle();
    await backToLibrary();
  }
  const heapEnd = await heapMB();
  note(`JS heap over 8 visits to an album: ${heapStart}MB -> ${heapEnd}MB`);
  check('no steady memory growth across visits', heapEnd <= heapStart + 40, `${heapStart}MB -> ${heapEnd}MB`);
  await openFromLibrary(greenId);
  const lost = await js('return window.__albumRenderer.getContext().isContextLost();');
  check('3D still healthy after repeated visits', lost === false);
  await backToLibrary();

  section('A large album');
  const largeId = await createAlbum('Large album');
  await js(`const files = [];
    for (let i = 0; i < 150; i++) files.push(await __makePhoto('big-' + (i + 1) + '.jpg', { w: 500, h: 340, hue: i * 11 % 360, text: String(i + 1) }));
    __upload(files); await __uploadDone();`);
  await settle(12000);
  let large = await storedPhotos();
  check('150 photographs stored in order', large.names.length === 150 && large.names[149] === 'big-150.jpg' && large.orders[149] === 149);
  await js('const c = window.__album; c.goToSpread(c.layout.leafCount - 1);');
  await settle(15000);
  check('reaches the far end of the book', (await state()).spread === (await state()).leaves - 1);
  await shot('large-album-end');
  const info = await js('const i = window.__albumRenderer.info; return { textures: i.memory.textures, geometries: i.memory.geometries };');
  note(`at the end of 150 photographs: ${JSON.stringify(info)}`);
  // Page textures plus a fixed set for the room, its objects and the lens, whatever the album's size.
  check('GPU use stays bounded', info.textures < 130 && info.geometries < 115, JSON.stringify(info));
  await backToLibrary();
  const started = Date.now();
  await load('/');
  note(`library with a 150-photo album ready in ${Date.now() - started - 500}ms`);
  const largeCard = (await libraryCards()).find((c) => c.id === largeId);
  check('library counts it', largeCard.meta.includes('150 photographs'));
  await helpers();
  await deleteFromLibrary(largeId);
  large = await storedPhotos(largeId);
  check('a large album deletes completely', large.album === null && large.totals.orphanBlobs === 0 && large.totals.orphanPhotos === 0);
  check('nothing else is lost', (await storedPhotos(greenId)).blobs === 4);
}

const heapMB = async () => {
  await send('HeapProfiler.collectGarbage');
  const { metrics } = await send('Performance.getMetrics');
  return Math.round(metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576);
};

async function phone() {
  section('Phone: library and navigation (390x844, emulated touch, DPR 3)');
  await viewport(390, 844, { touch: true, dpr: 3 });
  await load('/');
  await helpers();
  check('library has no horizontal overflow', await noHorizontalOverflow());
  check('library cards fit the screen', await js("return [...document.querySelectorAll('.album-card')].every((c) => { const r = c.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });"));
  check('both collections fit a phone, with room for a finger', await js("return [...document.querySelectorAll('.collection-tab')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.height >= 44; });"));
  await shot('phone-library');
  await js(`[...document.querySelectorAll('.library-intro .tool')][0].click();`);
  await sleep(300);
  check('creation screen fits a phone', await js("const d = document.querySelector('dialog[open]').getBoundingClientRect(); return d.left >= 0 && d.right <= innerWidth && d.bottom <= innerHeight;"));
  await shot('phone-create');
  await clickButton('Cancel');
  await sleep(200);
  await createAlbum('Phone album', { colour: 'burgundy' });
  check('new album opens on a phone', (await state()).stage === 'open');
  await backToLibrary();
  const phoneCard = (await libraryCards()).find((c) => c.title === 'Phone album');
  const cardAt = await js(`const el = document.querySelector('[data-album-id="${phoneCard.id}"] .album-open'); el.scrollIntoView({ block: 'center' });
    await new Promise((r) => setTimeout(r, 150)); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  await tap(cardAt.x, cardAt.y);
  await waitFor(`location.pathname.startsWith('/albums/') && ${ALBUM_READY}`);
  // The opening scene starts only once the scene is prepared, which a phone-sized screen at
  // three times the pixels can take a few seconds to do; the book is still until then.
  await waitFor(SCENE_SHOWN, 20000).catch(() => {});
  await waitFor("window.__album.stage() === 'open' && !window.__album.isAnimating", 20000).catch(() => {});
  check('tapping a book opens it', (await state()).stage === 'open' && (await state()).mode === 'single', JSON.stringify(await state()));
  await js(`[...document.querySelectorAll('.toolbar button')].find((b) => b.textContent === 'Details').click();`);
  await sleep(300);
  check('save button in reach on a phone without scrolling', await js("const b = [...document.querySelectorAll('dialog[open] button')].find((x) => x.textContent === 'Save').getBoundingClientRect(); return b.bottom <= innerHeight && b.top >= 0;"));
  await clickButton('Cancel');
  await sleep(200);
  currentPath = await js('return location.pathname;');
  await load();
  await helpers();
  await sleep(500);
  await swipe({ x: 195, y: 420 }, { x: 330, y: 500 }, { release: false, hold: 150 });
  const phoneAngle = await js('const q = window.__album.spin.q; return 2 * Math.acos(Math.min(1, Math.abs(q[3])));');
  check('a finger turns a closed book', phoneAngle > 0.2, `${phoneAngle.toFixed(2)} rad`);
  await shot('phone-book-turned');
  await touchEvent('touchEnd', []);
  await sleep(100);
  check('turning by finger does not open it', (await state()).stage === 'closed-front');
  await settle(8000);

  section('Phone: single-page mode');
  check('single-page mode on a portrait phone', (await state()).mode === 'single');
  check('no horizontal overflow', await noHorizontalOverflow());
  check('all toolbar controls on screen', await controlsOnScreen());
  check('the closed book\'s actions fit on screen', await js(`return [...document.querySelectorAll('.cta button, .cta label')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });`));
  await shot('phone-1-closed');
  await tap(195, 400);
  await settle();
  await sleep(300);
  let s = await state();
  check('tapping the cover opens', s.stage === 'open');
  check('no sideways slide: the page stays centred', s.offset === -1.5);
  check('page label counts single pages', (await label()) === 'Page 1 of 8', await label());
  await shot('phone-2-title-page');

  await uploadNumbered(30);
  s = await state();
  check('30 photographs give one leaf per page', s.leaves === 34, `leaves=${s.leaves}`);
  check('jumped to the first new photo', s.spread === 1);
  await sleep(400);
  await shot('phone-3-photo');

  const pageRect = await onPage(0, 0);
  const pageWidthPx = 3 * pageRect.ppu;
  check('page fills the screen width', pageWidthPx > 390 * 0.9, `${Math.round(pageWidthPx)}px wide on a 390px screen`);
  note(`page is ${Math.round(pageWidthPx)}px wide, compared with about ${Math.round(((390 - 28) / (6.14 + 0.41 + 0.11) / 1.03) * 3)}px when the spread was scaled to fit`);
  const pageLeft = pageRect.x;
  const midY = pageRect.y;

  section('Phone: real touch gestures');
  await swipe({ x: 350, y: midY }, { x: 240, y: midY - 10 }, { hold: 350, release: false });
  let e = await js('const c = window.__album; const e = c.active.get(c.spread); return { t: e?.t, curl: e?.curl };');
  check('swipe lifts the page and curls it', e.t > 0.05 && e.curl > 0.5, `t=${e.t?.toFixed(2)} curl=${e.curl?.toFixed(2)}`);
  await shot('phone-4-curl-lifted');
  await touchEvent('touchEnd', []);
  await settle();
  check('a small slow swipe falls back', (await state()).spread === 1);

  await swipe({ x: 360, y: midY + 60 }, { x: 60, y: midY + 30 }, { hold: 300, release: false });
  await shot('phone-5-curl-across');
  await touchEvent('touchEnd', []);
  await settle();
  check('a full swipe turns one page', (await state()).spread === 2);
  // Photo #1 is a warm gradient, which this check can't tell from paper. #2 turns green.
  await sleep(400);
  const shownOnPhone = await colourfulFraction();
  check('photograph visible on a phone', shownOnPhone > 0.04, `${(shownOnPhone * 100).toFixed(1)}% of pixels`);

  await swipe({ x: 340, y: midY }, { x: 250, y: midY }, { steps: 4, stepMs: 12 });
  await settle();
  check('a quick flick turns one page', (await state()).spread === 3);

  await swipe({ x: 50, y: midY }, { x: 180, y: midY }, { hold: 250, release: false });
  await shot('phone-6-coming-back');
  await touchEvent('touchMove', [{ x: 350, y: midY }]);
  await sleep(150);
  await touchEvent('touchEnd', []);
  await settle();
  check('swiping right brings the previous page back', (await state()).spread === 2);

  await swipe({ x: 50, y: midY }, { x: 110, y: midY }, { hold: 300 });
  await settle();
  check('a small slow swipe right falls back', (await state()).spread === 2);

  await swipe({ x: 195, y: midY - 100 }, { x: 205, y: midY + 120 });
  await settle();
  check('an up-and-down swipe does not turn', (await state()).spread === 2);

  await tap(370, midY);
  await settle();
  check('tapping the right edge turns forward', (await state()).spread === 3);
  await tap(25, midY);
  await settle();
  check('tapping the left edge turns back', (await state()).spread === 2);

  await tap(pageLeft + pageRect.ppu * 1.5, midY);
  await sleep(450);
  check('tapping a photograph opens it', await js("return Boolean(document.querySelector('dialog.viewer[open]'));"));
  await setField('dialog.viewer[open] .viewer-caption', 'A long afternoon on the beach, with everyone together before the rain came in over the hills');
  await shot('phone-7-viewer');
  await clickButton('Close');
  await sleep(900);
  check('caption saved from a phone', (await storedPhotos()).meta[1].caption.startsWith('A long afternoon'));
  await shot('phone-7b-caption-on-page');

  await js("document.querySelector('[aria-label=\"Next page\"]').click();");
  await settle();
  check('toolbar next works', (await state()).spread === 3);

  section('Phone: rotation and resizing keep your place');
  const before = (await state()).spread; // page side = spread in this mode
  await viewport(844, 390, { touch: true, dpr: 3 });
  await sleep(500);
  s = await state();
  check('landscape phone shows the spread', s.mode === 'spread' && s.leaves === 17);
  check('same page still in view', s.spread === Math.ceil(before / 2), `side ${before} -> spread ${s.spread}`);
  check('no overflow in landscape', await noHorizontalOverflow());
  check('controls on screen in landscape', await controlsOnScreen());
  await sleep(400);
  await shot('phone-8-landscape');
  const landscapeEdge = await onPage(2.8, 0);
  await swipe(landscapeEdge, await onPage(-1, 0), { hold: 100 });
  await settle();
  check('touch drag works on a landscape spread', (await state()).spread === s.spread + 1);

  await viewport(390, 844, { touch: true, dpr: 3 });
  await sleep(500);
  s = await state();
  check('back to one page in portrait', s.mode === 'single' && s.leaves === 34);
  check('no overflow after rotating back', await noHorizontalOverflow());
  await sleep(400);
  await shot('phone-9-rotated-back');
  await swipe({ x: 350, y: midY }, { x: 60, y: midY });
  await settle();
  check('still turns after rotating', (await state()).spread === s.spread + 1);

  for (const [w, h, name] of [[360, 640, 'small phone'], [320, 568, 'very small phone'], [412, 915, 'large phone'], [600, 960, 'small tablet portrait'], [820, 1180, 'tablet portrait'], [1180, 820, 'tablet landscape']]) {
    await viewport(w, h, { touch: true, dpr: 2 });
    await sleep(350);
    s = await state();
    const expected = w <= 640 && h > w ? 'single' : 'spread';
    check(`${name} ${w}x${h}: ${expected} mode, nothing cut off`, s.mode === expected && (await noHorizontalOverflow()) && (await controlsOnScreen()));
    await shot(`size-${w}x${h}`);
  }
  await viewport(390, 844, { touch: true, dpr: 3 });
  await sleep(400);

  section('Phone: arranging by touch');
  await clickButton('Arrange');
  await sleep(700);
  check('arranger opens', (await dialogTitle()) === 'Arrange photographs');
  await shot('phone-10-arranger');
  check('arranger has no sideways overflow', await js("const s = document.querySelector('.arranger-sheet'); return s.scrollWidth <= s.clientWidth;"));
  const tile = (i) => js(`const r = document.querySelectorAll('.arrange-tile')[${i}].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 3 };`);
  const namesBefore = (await storedPhotos()).names;

  const start = await tile(0);
  await touchEvent('touchStart', [start]);
  await sleep(320); // press and hold
  const dest = await tile(3);
  for (let i = 1; i <= 12; i += 1) {
    await touchEvent('touchMove', [{ x: start.x + ((dest.x - start.x) * i) / 12, y: start.y + ((dest.y - start.y) * i) / 12 }]);
    await sleep(20);
  }
  await sleep(250);
  await shot('phone-11-arranger-dragging');
  await touchEvent('touchEnd', []);
  await sleep(500);
  const namesAfter = (await storedPhotos()).names;
  check('press, hold and drag reorders', namesAfter[0] === namesBefore[1] && namesAfter[3] === namesBefore[0], namesAfter.slice(0, 4).join());

  const scrollBefore = await js("return document.querySelector('.arranger-sheet').scrollTop;");
  const swipeStart = await tile(4);
  await swipe(swipeStart, { x: swipeStart.x, y: swipeStart.y - 240 }, { steps: 10, stepMs: 16 });
  await sleep(400);
  const scrollAfter = await js("return document.querySelector('.arranger-sheet').scrollTop;");
  check('a quick swipe scrolls instead of dragging', scrollAfter > scrollBefore, `scrollTop ${scrollBefore} -> ${scrollAfter}`);
  check('a scroll does not reorder', (await storedPhotos()).names.join() === namesAfter.join());
  await clickButton('Done');
  await sleep(300);

  await load();
  await helpers();
  check('touch reorder survives a refresh', (await storedPhotos()).names[0] === namesBefore[1]);
  check('still one-page mode after refresh', (await state()).mode === 'single');
}

async function performance() {
  section('Performance and memory (Chrome on this computer, NOT a phone)');
  const gpu = await js(`const gl = window.__albumRenderer.getContext(); const d = gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';`);
  note(`renderer: ${gpu}`);
  await tap(195, 400);
  await settle();

  const info = () => js('const i = window.__albumRenderer.info; return { textures: i.memory.textures, geometries: i.memory.geometries, calls: i.render.calls, triangles: i.render.triangles };');
  const heap = async () => {
    await send('HeapProfiler.collectGarbage');
    const { metrics } = await send('Performance.getMetrics');
    return Math.round(metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576);
  };
  const turn = async (forward = true) => {
    await swipe(forward ? { x: 350, y: 400 } : { x: 50, y: 400 }, forward ? { x: 60, y: 400 } : { x: 350, y: 400 }, { steps: 10, stepMs: 16 });
    await sleep(900);
  };

  const plain = await rafStats(1400, () => turn());
  note(`phone-sized view, turning, no throttle: ${JSON.stringify(plain)}`);
  await send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const slow = await rafStats(1400, () => turn());
  await send('Emulation.setCPUThrottlingRate', { rate: 1 });
  note(`same with CPU throttled 4x (no GPU throttle is available): ${JSON.stringify(slow)}`);
  check('stays usable with a 4x slower CPU', slow.fps >= 24, `${slow.fps} fps`);

  await settle();
  const startInfo = await info();
  const startHeap = await heap();
  for (let i = 0; i < 24; i += 1) await turn(i % 12 < 6);
  await settle();
  await sleep(600);
  const endInfo = await info();
  const endHeap = await heap();
  note(`after 24 more turns: ${JSON.stringify(startInfo)} -> ${JSON.stringify(endInfo)}; JS heap ${startHeap}MB -> ${endHeap}MB`);
  check('GPU textures stay bounded', endInfo.textures <= startInfo.textures + 12, `${startInfo.textures} -> ${endInfo.textures}`);
  check('geometries stay bounded', endInfo.geometries <= startInfo.geometries + 6, `${startInfo.geometries} -> ${endInfo.geometries}`);
  check('JS heap does not grow steadily', endHeap <= startHeap + 40, `${startHeap}MB -> ${endHeap}MB`);

  check('an idle book does not redraw its costly shadows', (await js('return window.__albumRenderer.shadowMap.needsUpdate;')) === false);
  const idleStats = await rafStats(1400, async () => {});
  note(`phone-sized view at rest, effects running: ${JSON.stringify(idleStats)}`);

  await viewport(1440, 900);
  await sleep(600);
  const desk = await rafStats(1600, async () => {
    await js('window.__album.next();');
  });
  note(`desktop view 1440x900, turning: ${JSON.stringify(desk)}`);
  await shot('desktop-11-30-photos');
}

async function endToEnd30() {
  section('Regression: thirty photos, covers and clearing (desktop)');
  await viewport(1440, 900);
  await sleep(400);
  await load();
  await helpers();
  check('thirty photographs still there', (await countText()) === '30 photographs');
  await js(`const c = window.__album; c.goToSpread(c.layout.leafCount);`);
  await settle(12000);
  const s = await state();
  check('riffles to the last spread', s.spread === s.leaves && s.stage === 'open');
  await js('window.__album.next();');
  await settle();
  check('back cover closes', (await state()).stage === 'closed-back' && (await label()) === 'Back cover');
  await sleep(300);
  await shot('desktop-12-back-cover');
  await js('window.__album.prev();');
  await settle();
  check('back cover reopens', (await state()).stage === 'open');
  await clickButton('Clear album');
  await sleep(300);
  check('clearing asks first', (await dialogTitle()) === 'Clear this album?');
  await clickButton('Keep');
  await sleep(200);
  check('Keep leaves the album alone', (await storedPhotos()).names.length === 30);
  await clickButton('Clear album');
  await sleep(300);
  await js(`const buttons = [...document.querySelectorAll('dialog[open] button')]; buttons.find((b) => b.textContent === 'Clear album').click();`);
  await sleep(700);
  await settle(12000);
  const stored = await storedPhotos();
  check('album emptied, images included', stored.names.length === 0 && stored.blobs === 0);
  check('book back to minimum size, closed', (await state()).stage === 'closed-front' && (await state()).leaves === 4);
  await load();
  check('stays empty after a refresh', (await countText()) === '0 photographs');
  check('the album itself still exists, empty', (await storedPhotos()).album !== null);
}

// ==== run ========================================================================

let crashed = null;
try {
  await connect();
  await migration();
  await desktopCore();
  await arrangeTitleExif();
  await multiAlbum();
  await phone();
  await performance();
  await endToEnd30();
} catch (error) {
  crashed = error;
  console.error(`\nStopped early: ${error.stack}`);
  await shot('crash').catch(() => {});
}

section('Console');
// The tests deliberately visit one page that doesn't exist. Only that 404 is excused.
const unexpected = consoleProblems.filter((p) => !p.includes(NEUTRAL_PAGE));
check('no console errors or warnings', unexpected.length === 0, unexpected.length ? `${unexpected.length} found` : '');
[...new Set(unexpected)].slice(0, 12).forEach((p) => console.log(`        ${p}`));

console.log(`\n${passed} passed, ${failures.length} failed${crashed ? ', and the run stopped early' : ''}`);
failures.forEach((f) => console.log(`  - ${f}`));
console.log(`Screenshots: ${OUT}`);
console.log('Touch was emulated in Chrome on this computer. This was not a physical device.');

try {
  socket?.close();
} catch {
  // Already closed.
}
chrome.kill();
await sleep(400);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // Chrome can hold files briefly; the OS temp folder will clear it.
}
process.exit(failures.length || crashed ? 1 : 0);
