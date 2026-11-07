/**
 * Checks the site when albums are kept on the server: signing up and in, albums and
 * photographs saved to the account, and deletes that hide rather than erase.
 *
 * Needs the backend and an account-mode build running:
 *   cd backend && mvnw spring-boot:test-run                    (API on :8081)
 *   NEXT_PUBLIC_API_URL=http://localhost:8081 next build && next start -p 3001
 *   node scripts/e2e-account.mjs [site] [api] [photo folder]
 *
 * Every run makes a new throwaway account, so it can be repeated against the same backend.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SITE = process.argv[2] ?? 'http://localhost:3001';
const API = process.argv[3] ?? 'http://localhost:8081';
const PHOTO_DIR = resolve(process.argv[4] ?? '../backend/data/photos');
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9377;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail !== '' ? `  (${detail})` : ''}`);
};
const section = (name) => console.log(name);

const profile = mkdtempSync(join(tmpdir(), 'keepsake-account-'));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run',
  '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default', 'about:blank'], { stdio: 'ignore' });

let socket;
let nextId = 1;
const pending = new Map();
const problems = [];
const send = (method, params = {}) => new Promise((ok, fail) => {
  const id = nextId++;
  pending.set(id, { ok, fail, method });
  socket.send(JSON.stringify({ id, method, params }));
});
for (let i = 0; i < 100 && !socket; i += 1) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
    if (page) {
      socket = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((r) => { socket.onopen = r; });
    }
  } catch { /* still starting */ }
  if (!socket) await sleep(150);
}
socket.onmessage = (event) => {
  const m = JSON.parse(event.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) p.fail(new Error(`${p.method}: ${m.error.message}`));
    else p.ok(m.result);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    problems.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 240));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    problems.push(`exception: ${(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 240)}`);
  }
};
await send('Runtime.enable');
await send('Page.enable');

const js = async (body) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};
const waitFor = async (condition, timeout = 30000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await js(`return Boolean(${condition});`).catch(() => false)) return true;
    await sleep(120);
  }
  throw new Error(`Timed out waiting for ${condition}`);
};
const viewport = (width, height, mobile = false) =>
  send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
const go = async (url) => {
  await send('Page.navigate', { url });
  await sleep(300);
};
const clickButton = (text) =>
  js(`const b = [...document.querySelectorAll('button')].filter((x) => x.getBoundingClientRect().width > 0 && !x.closest('dialog:not([open])'))
      .reverse().find((x) => x.textContent.trim() === ${JSON.stringify(text)});
    if (!b) throw new Error('No button: ${text}'); b.click();`);
const setField = (selector, value) =>
  js(`const el = document.querySelector(${JSON.stringify(selector)}); el.focus();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));`);
const session = () => js("return JSON.parse(localStorage.getItem('keepsake.session') ?? 'null');");
const api = async (path, token, method = 'GET') => {
  const response = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? await response.json() : null };
};
const LIBRARY_READY = `document.querySelector('.library-intro .tool') && !document.querySelector('.library-intro .tool').disabled`;
const ALBUM_READY = `location.pathname.startsWith('/albums/') && document.querySelector('.toolbar') && document.querySelector('canvas.is-shown')`;

const email = `check-${Date.now()}@example.test`;
const password = `pw-${Math.random().toString(36).slice(2)}-local`;

try {
  section('Signing up');
  await viewport(1440, 900);
  await go(SITE);
  await waitFor("document.querySelector('.account-card')");
  check('the site asks you to sign in first', (await js("return document.querySelector('.account-card h1').textContent;")) === 'Welcome back');
  await clickButton('Create an account');
  await setField('input[name=name]', 'Album Tester');
  await setField('input[name=email]', email);
  await setField('input[name=password]', 'short');
  await clickButton('Create account');
  await sleep(200);
  check('a short password is refused before sending', (await js("return document.querySelector('.account-error').textContent;")).includes('at least 8'));
  await setField('input[name=password]', password);
  await clickButton('Create account');
  await waitFor(LIBRARY_READY);
  const signedIn = await session();
  check('creating an account signs you in', Boolean(signedIn?.token) && signedIn.user.email === email);
  check('the header says who is signed in', (await js("return document.querySelector('.account-who')?.textContent;")) === 'Album Tester');
  const token = signedIn.token;
  const owner = signedIn.user.id;

  section('An album kept in the account');
  await clickButton('Begin your first album');
  await sleep(300);
  await setField('dialog[open] input[name="album-title"]', 'Kept on the server');
  await clickButton('Create album');
  await waitFor(ALBUM_READY);
  const albumId = await js('return decodeURIComponent(location.pathname.split("/")[2]);');
  check('the new album is in the account', (await api(`/api/albums/${albumId}`, token)).body?.title === 'Kept on the server');

  await js(`const make = async (name, hue) => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1067;
      const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, 1067); g.addColorStop(0, 'hsl(' + hue + ',60%,70%)'); g.addColorStop(1, 'hsl(' + (hue + 50) + ',50%,25%)');
      x.fillStyle = g; x.fillRect(0, 0, 1600, 1067); const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      return new File([blob], name, { type: 'image/jpeg', lastModified: Date.UTC(2024, 4, 2) }); };
    const files = [await make('one.jpg', 20), await make('two.jpg', 140), await make('three.jpg', 260)];
    const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f));
    const input = document.querySelector('.toolbar [data-testid=photo-input]'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor("document.querySelector('.notice')?.textContent.includes('added')", 60000);
  let album = (await api(`/api/albums/${albumId}`, token)).body;
  check('three photographs are uploaded to the account', album.photos.length === 3, album.photos.map((p) => p.name).join());
  check('their sizes and dates come through', album.photos.every((p) => p.width === 1600 && p.height === 1067 && p.takenAt > 0));
  const image = await fetch(`${API}/api/photos/${album.photos[0].id}/content`, { headers: { Authorization: `Bearer ${token}` } });
  check('the image itself is stored and served', image.status === 200 && image.headers.get('content-type') === 'image/jpeg');
  check('images are on the server’s disk', album.photos.every((p) => existsSync(join(PHOTO_DIR, owner, albumId, p.id))));

  section('After a reload');
  await send('Page.reload');
  await sleep(400);
  await waitFor(ALBUM_READY);
  await sleep(1500);
  check('you stay signed in', Boolean((await session())?.token));
  check('the pages draw the photographs from the server',
    (await js("return performance.getEntriesByType('resource').filter((e) => e.name.includes('/content')).length;")) >= 1);

  section('Arranging, captions and removing');
  await clickButton('Arrange');
  await sleep(700);
  await js("document.querySelector('.arrange-tile:nth-child(1) [aria-label$=\"later\"]').click();");
  await sleep(300);
  await clickButton('Done');
  await sleep(500);
  album = (await api(`/api/albums/${albumId}`, token)).body;
  check('a new order is saved', album.photos.map((p) => p.name).join() === 'two.jpg,one.jpg,three.jpg', album.photos.map((p) => p.name).join());

  // After a reload the album is shut: the first press opens it, the next reaches the
  // photographs. A turn is ignored until the cover has settled, so ask until it happens;
  // each try waits longer than a turn takes, so it never goes past the first spread.
  for (let i = 0; i < 12 && !(await js("return /Pages \\d/.test(document.querySelector('.toolbar').innerText);")); i += 1) {
    await js("document.querySelector('.toolbar button[aria-label=\"Next page\"]').click();");
    await sleep(1600);
  }
  await waitFor("[...document.querySelectorAll('.page-action')].some((b) => b.textContent.endsWith('caption'))", 15000);
  await js("[...document.querySelectorAll('.page-action')].find((b) => b.textContent.endsWith('caption')).click();");
  await waitFor("document.querySelector('dialog.viewer[open] .viewer-caption')");
  await setField('dialog.viewer[open] .viewer-caption', 'Saved on the server');
  await clickButton('Close');
  await sleep(800);
  album = (await api(`/api/albums/${albumId}`, token)).body;
  check('a caption is saved', album.photos.some((p) => p.caption === 'Saved on the server'));

  await js("[...document.querySelectorAll('.page-action')].find((b) => b.textContent === 'Remove').click();");
  await waitFor("document.querySelector('dialog[open] h2')?.textContent === 'Remove this photograph?'");
  check('removing asks first, and says it can’t be recovered', (await js("return document.querySelector('dialog[open] p').textContent;")).includes("can't be recovered"));
  await clickButton('Keep');
  await sleep(300);
  check('Keep removes nothing', (await api(`/api/albums/${albumId}`, token)).body.photos.length === 3);
  await js("[...document.querySelectorAll('.page-action')].find((b) => b.textContent === 'Remove').click();");
  await waitFor("document.querySelector('dialog[open] h2')");
  const before = album.photos.map((p) => p.id);
  await clickButton('Remove');
  await waitFor("document.querySelector('.notice')?.textContent.includes('removed')", 15000);
  album = (await api(`/api/albums/${albumId}`, token)).body;
  const removed = before.find((id) => !album.photos.some((p) => p.id === id));
  check('the photograph leaves the album', album.photos.length === 2);
  check('its image can no longer be opened', (await api(`/api/photos/${removed}/content`, token)).status === 404);
  check('but the server still keeps its file', existsSync(join(PHOTO_DIR, owner, albumId, removed)));

  section('Deleting the album');
  await js("document.querySelector('.back-link').click();");
  await waitFor(`${LIBRARY_READY} && document.querySelector('.album-card')`);
  await js(`document.querySelector('[data-album-id="${albumId}"] .album-menu-button').click();`);
  await sleep(200);
  await clickButton('Delete');
  await waitFor("document.querySelector('dialog[open] h2')?.textContent.startsWith('Delete')");
  check('deleting asks first, and says it can’t be recovered', (await js("return document.querySelector('dialog[open] p').textContent;")).includes("can't be recovered"));
  await clickButton('Delete album');
  await waitFor("document.querySelector('.notice')?.textContent.includes('deleted')", 15000);
  check('the album leaves the library', (await api('/api/albums', token)).body.length === 0);
  check('it can no longer be opened', (await api(`/api/albums/${albumId}`, token)).status === 404);
  check('the server still keeps its photographs', album.photos.every((p) => existsSync(join(PHOTO_DIR, owner, albumId, p.id))));

  section('Signing out and in');
  await clickButton('Sign out');
  await waitFor("document.querySelector('.account-card')");
  check('signing out returns to the sign-in screen', (await session()) === null);
  await setField('input[name=email]', email);
  await setField('input[name=password]', 'not-the-password');
  await clickButton('Sign in');
  await waitFor("document.querySelector('.account-error')?.textContent", 15000);
  check('a wrong password gets a clear message', (await js("return document.querySelector('.account-error').textContent;")).includes("isn't right"));
  await setField('input[name=password]', password);
  await clickButton('Sign in');
  await waitFor(LIBRARY_READY);
  check('signing in again opens your library', Boolean((await session())?.token));

  section('A token the server no longer accepts');
  await js("const s = JSON.parse(localStorage.getItem('keepsake.session')); s.token = 'expired.' + s.token.slice(8); localStorage.setItem('keepsake.session', JSON.stringify(s));");
  await send('Page.reload');
  await waitFor("document.querySelector('.account-card')", 20000);
  check('it leads back to signing in, not to an error', true);

  section('On a phone');
  await viewport(390, 844, true);
  await go(SITE);
  await waitFor("document.querySelector('.account-card')");
  check('the sign-in form fits a phone', await js("const r = document.querySelector('.account-card').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;"));
  await setField('input[name=email]', email);
  await setField('input[name=password]', password);
  await clickButton('Sign in');
  await waitFor(LIBRARY_READY);
  check('signing in works on a phone', await js("return document.documentElement.scrollWidth <= innerWidth && Boolean(document.querySelector('.account-out'));"));
} catch (error) {
  failed += 1;
  console.log(`  FAIL  ${error.message.split('\n')[0]}`);
  try {
    const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    const file = join(tmpdir(), 'keepsake-account-failure.jpg');
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`  screenshot: ${file}`);
    console.log(`  page: ${await js("return location.pathname + ' | ' + document.querySelector('.toolbar')?.innerText.replace(/\\s+/g, ' ');")}`);
  } catch { /* the page itself is gone */ }
}

const unexpected = [...new Set(problems)].filter((p) => !/401|404|Failed to load resource/.test(p));
check('no unexpected errors in the console', unexpected.length === 0, unexpected.slice(0, 3).join(' | '));
console.log(`${passed} passed, ${failed} failed`);
socket?.close();
chrome.kill();
await sleep(400);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* still closing */ }
process.exit(failed ? 1 : 0);
