/**
 * Checks the site when albums are kept on the server: signing up and in, albums and
 * photographs saved to the account, and deletes that hide rather than erase.
 *
 * Needs the backend and an account-mode build running:
 *   cd backend && mvnw spring-boot:test-run                    (API on :8081)
 *   NEXT_PUBLIC_API_URL=http://localhost:8081 next build && next start -p 3001
 *   node scripts/e2e-account.mjs [site] [api] [photo folder] [mail outbox folder]
 *
 * Every run makes a new throwaway account, so it can be repeated against the same backend.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SITE = process.argv[2] ?? 'http://localhost:3001';
const API = process.argv[3] ?? 'http://localhost:8081';
const PHOTO_DIR = resolve(process.argv[4] ?? '../backend/data/photos');
// The local backend writes emails here instead of sending them (see LocalBackend.java).
const OUTBOX = resolve(process.argv[5] ?? '../backend/data/outbox');
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
let password = `pw-${Math.random().toString(36).slice(2)}-local`;

const emailsTo = (to) => (existsSync(OUTBOX) ? readdirSync(OUTBOX).sort() : [])
  .map((f) => readFileSync(join(OUTBOX, f), 'utf8')).filter((t) => t.startsWith(`To: ${to}\n`));
const awaitResetCode = async (to, already) => {
  for (let i = 0; i < 100; i += 1) {
    const all = emailsTo(to);
    if (all.length > already) return all.at(-1).match(/reset-password#token=([A-Za-z0-9_-]{43})/)?.[1] ?? null;
    await sleep(100);
  }
  return null;
};
const tabs = () => js(`return [...document.querySelectorAll('.collection-tab')].map((t) => ({ id: t.id.replace('collection-', ''),
  name: t.querySelector('.collection-name').textContent, count: Number(t.querySelector('.collection-count').textContent),
  selected: t.getAttribute('aria-selected') === 'true' }));`);
const shelf = () => js("return [...document.querySelectorAll('.album-card h2')].map((h) => h.textContent);");
const backToLibrary = async () => {
  await js("document.querySelector('.back-link').click();");
  await waitFor(`location.pathname === '/' && ${LIBRARY_READY} && document.querySelector('.collection-tab')`);
  await sleep(500);
};
const moveFromMenu = async (albumId, label) => {
  await js(`document.querySelector('[data-album-id="${albumId}"] .album-menu-button').click();`);
  await sleep(200);
  await js(`[...document.querySelectorAll('[data-album-id="${albumId}"] .album-menu-list button')].find((b) => b.textContent === ${JSON.stringify(label)}).click();`);
  // The notice names where it went, so an earlier move's notice can't be mistaken for this one.
  await waitFor(`document.querySelector('.notice')?.textContent.includes(${JSON.stringify(label.replace('Move to', 'moved to'))})`, 15000);
  await sleep(300);
};

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
  check('the corner shows Sign out, without a name beside it', await js("return Boolean(document.querySelector('.account-out')) && !document.querySelector('.account-who');"));
  const token = signedIn.token;
  const owner = signedIn.user.id;

  section('A new account starts with one album');
  await waitFor("document.querySelector('.album-card h2')");
  const starter = (await api('/api/albums', token)).body;
  check('a new account has an empty Our Memories album', starter.length === 1 && starter[0].title === 'Our Memories' && starter[0].photoCount === 0);
  check('kept in Individual', starter[0].category === 'INDIVIDUAL');
  check('the library opens on it, with the plain heading', (await js("return document.querySelector('.library-intro h1').textContent + ' | ' + document.querySelector('.album-card h2').textContent;")) === 'Your albums | Our Memories');
  // The rest of this run starts from an empty library, so the starter album is deleted.
  await api(`/api/albums/${starter[0].id}`, token, 'DELETE');
  await send('Page.reload');
  await waitFor(LIBRARY_READY);
  await sleep(400);
  check('an empty library keeps the same quiet heading', await js("return document.querySelector('.library-intro h1').textContent === 'Your albums' && document.querySelector('.library-intro p').textContent === 'No albums yet';"));

  section('An album kept in the account');
  await clickButton('New album');
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

  section('Individual and Couple collections');
  let t = await tabs();
  check('the library has Individual and Couple collections', t.map((x) => x.name).join() === 'Individual,Couple', JSON.stringify(t));
  check('it opens on Individual', t[0].selected && !t[1].selected);
  await clickButton('New album');
  await sleep(300);
  check('the form has a close button', await js("return Boolean(document.querySelector('dialog[open] .dialog-close'));"));
  await js("document.querySelector('dialog[open] .dialog-close').click();");
  await sleep(300);
  check('which closes it without making an album', !(await js("return Boolean(document.querySelector('dialog[open]'));")) && (await api('/api/albums', token)).body.length === 0);
  await clickButton('New album');
  await sleep(300);
  check('a new album starts as Individual', await js("return document.querySelector('dialog[open] input[name=album-category][value=INDIVIDUAL]').checked && !document.querySelector('dialog[open] input[name=album-category][value=COUPLE]').checked;"));
  check('both choices are explained', (await js("return document.querySelector('dialog[open] .category-picker').textContent;")).includes('Shared memories and special moments together.'));
  await setField('dialog[open] input[name="album-title"]', 'Just mine');
  await clickButton('Create album');
  await waitFor(ALBUM_READY);
  const mineId = await js('return decodeURIComponent(location.pathname.split("/")[2]);');
  check('left unchanged, it is saved as Individual', (await api(`/api/albums/${mineId}`, token)).body?.category === 'INDIVIDUAL');
  await backToLibrary();
  check('and it is on the Individual shelf', (await shelf()).join() === 'Just mine');

  await clickButton('New album');
  await sleep(300);
  await js("document.querySelector('dialog[open] input[name=album-category][value=COUPLE]').click();");
  await sleep(100);
  check('Couple can be chosen instead', await js("return document.querySelector('dialog[open] .category-option.is-chosen input').value === 'COUPLE';"));
  await setField('dialog[open] input[name="album-title"]', 'Ours');
  await clickButton('Create album');
  await waitFor(ALBUM_READY);
  const oursId = await js('return decodeURIComponent(location.pathname.split("/")[2]);');
  check('a Couple album is saved as Couple', (await api(`/api/albums/${oursId}`, token)).body?.category === 'COUPLE');
  await backToLibrary();
  t = await tabs();
  check('back in the library, its shelf is open', t[1].selected && (await shelf()).join() === 'Ours', JSON.stringify(t));
  check('each collection counts its own albums', t[0].count === 1 && t[1].count === 1);
  await js("document.querySelector('#collection-INDIVIDUAL').click();");
  await sleep(500);
  check('Individual shows only Individual albums', (await shelf()).join() === 'Just mine');
  const coupleOnly = (await api('/api/albums?category=COUPLE', token)).body;
  check('the server lists one collection on request', coupleOnly.length === 1 && coupleOnly[0].id === oursId);

  const beforeMove = (await api(`/api/albums/${mineId}`, token)).body;
  await moveFromMenu(mineId, 'Move to Couple');
  check('a moved album leaves its old shelf', (await shelf()).length === 0);
  check('the empty shelf says so', (await js("return document.querySelector('.collection-empty')?.textContent ?? '';")).includes('No individual albums yet'));
  const afterMove = (await api(`/api/albums/${mineId}`, token)).body;
  check('it is now Couple, and otherwise unchanged', afterMove.category === 'COUPLE'
    && JSON.stringify({ ...afterMove, category: 'INDIVIDUAL' }) === JSON.stringify(beforeMove));
  await js("document.querySelector('#collection-COUPLE').click();");
  await sleep(500);
  check('and it is on the Couple shelf', (await shelf()).sort().join() === 'Just mine,Ours');
  await moveFromMenu(oursId, 'Move to Individual');
  check('moving back the other way works too', (await api(`/api/albums/${oursId}`, token)).body.category === 'INDIVIDUAL' && (await shelf()).join() === 'Just mine');
  await send('Page.reload');
  await waitFor(`${LIBRARY_READY} && document.querySelector('.album-card')`);
  await sleep(400);
  check('the open collection is remembered after a reload', (await tabs())[1].selected && (await shelf()).join() === 'Just mine');

  section('Signing out and in');
  check('Sign out takes a real click, not just a scripted one', await js("const b = document.querySelector('.account-out'); const r = b.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b;"));
  await clickButton('Sign out');
  await waitFor("document.querySelector('dialog[open] h2')?.textContent === 'Sign out?'");
  check('signing out asks first', true);
  check('and says whose account it is', (await js("return document.querySelector('dialog[open] p').textContent;")).includes(`Album Tester (${email})`));
  check('focus starts on Stay signed in', (await js('return document.activeElement.textContent;')) === 'Stay signed in');
  await clickButton('Stay signed in');
  await sleep(200);
  check('Stay signed in keeps you signed in', Boolean((await session())?.token) && !(await js("return document.querySelector('dialog[open]');")));
  await clickButton('Sign out');
  await waitFor("document.querySelector('dialog[open] h2')?.textContent === 'Sign out?'");
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

  section('Forgetting the password');
  const tokenBeforeReset = (await session()).token;
  await clickButton('Sign out');
  await waitFor("document.querySelector('dialog[open] h2')?.textContent === 'Sign out?'");
  await clickButton('Sign out');
  await waitFor("document.querySelector('.account-card')");
  check('the sign-in screen offers Forgot Password?', (await js("return document.querySelector('.account-forgot a')?.textContent;")) === 'Forgot Password?');
  await setField('input[name=email]', email);
  await js("document.querySelector('.account-forgot a').click();");
  await waitFor("location.pathname === '/forgot-password' && document.querySelector('.account-card h1')?.textContent.startsWith('Forgotten')");
  check('it opens its own screen', true);
  check('carrying over the email already typed', (await js("return document.querySelector('input[name=email]').value;")) === email);
  const already = emailsTo(email).length;
  await clickButton('Send Reset Link');
  await waitFor("document.querySelector('.account-sent')", 20000);
  const sentMessage = await js("return document.querySelector('.account-sent .account-lede').textContent;");
  check('a confirmation that reveals nothing', sentMessage.startsWith('If that email belongs to a Keepsake account'), sentMessage);
  await clickButton('Use a different email');
  await setField('input[name=email]', `nobody-${Date.now()}@example.test`);
  await clickButton('Send Reset Link');
  await waitFor("document.querySelector('.account-sent')", 20000);
  check('an unknown email gets exactly the same answer', (await js("return document.querySelector('.account-sent .account-lede').textContent;")) === sentMessage);
  const code = await awaitResetCode(email, already);
  check('the email arrives, with a reset link', Boolean(code));

  await go(`${SITE}/reset-password#token=${'x'.repeat(43)}`);
  await waitFor("document.querySelector('.account-card h1') && !document.querySelector('.account-card[aria-busy]')");
  check('a made-up link is refused kindly', (await js("return document.querySelector('.account-card h1').textContent;")) === 'This link can’t be used');
  await go(`${SITE}/reset-password#token=${code}`);
  await waitFor("document.querySelector('input[name=new-password]')", 20000);
  check('the real link opens the form', true);
  check('the code leaves the address bar', await js("return location.hash === '' && location.pathname === '/reset-password';"));
  await setField('input[name=new-password]', 'abc');
  await sleep(100);
  check('a weak password is shown as too weak', (await js("return document.querySelector('.password-meter-text').textContent;")).startsWith('Too weak'));
  check('and can’t be submitted', await js("return document.querySelector('.account-submit').disabled;"));
  const newPassword = `new ${Math.random().toString(36).slice(2)} 2nd`;
  await setField('input[name=new-password]', newPassword);
  await setField('input[name=confirm-password]', `${newPassword}x`);
  await sleep(100);
  check('a mismatch is pointed out', (await js("return document.querySelector('.password-match').textContent;")).includes('don’t match') && await js("return document.querySelector('.account-submit').disabled;"));
  await js("document.querySelector('.password-toggle').click();");
  await sleep(50);
  check('the password can be shown', await js("return document.querySelector('input[name=new-password]').type === 'text';"));
  await js("document.querySelector('.password-toggle').click();");
  await setField('input[name=confirm-password]', newPassword);
  await sleep(100);
  check('matching passwords can be submitted', await js("return !document.querySelector('.account-submit').disabled && document.querySelector('.password-match').textContent === 'They match.';"));
  await clickButton('Set new password');
  await waitFor("document.querySelector('.account-sent h1')", 20000);
  check('success is confirmed', (await js("return document.querySelector('.account-sent h1').textContent;")) === 'Your password is changed');
  check('with a way back to sign in', (await js("return document.querySelector('.account-sent a').textContent;")) === 'Return to sign in');
  check('earlier sign-ins have ended', (await api('/api/albums', tokenBeforeReset)).status === 401);
  await go(`${SITE}/reset-password#token=${code}`);
  await waitFor("document.querySelector('.account-card h1') && !document.querySelector('.account-card[aria-busy]')");
  check('the link can’t be used twice', (await js("return document.querySelector('.account-card h1').textContent;")) === 'This link can’t be used');
  await go(SITE);
  await waitFor("document.querySelector('.account-card')");
  await setField('input[name=email]', email);
  await setField('input[name=password]', password);
  await clickButton('Sign in');
  await waitFor("document.querySelector('.account-error')?.textContent", 15000);
  check('the old password no longer works', (await js("return document.querySelector('.account-error').textContent;")).includes("isn't right"));
  password = newPassword;
  await setField('input[name=password]', password);
  await clickButton('Sign in');
  await waitFor(LIBRARY_READY);
  check('the new one does, and the albums are all there', (await api('/api/albums', (await session()).token)).body.length === 2);

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
  await waitFor("document.querySelector('.collection-tab')");
  check('both collections fit a phone', await js("return [...document.querySelectorAll('.collection-tab')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.height >= 44; });"));
  await clickButton('Sign out');
  await waitFor("document.querySelector('dialog[open] h2')?.textContent === 'Sign out?'");
  await clickButton('Sign out');
  await waitFor("document.querySelector('.account-forgot a')");
  await js("document.querySelector('.account-forgot a').click();");
  await waitFor("location.pathname === '/forgot-password'");
  check('the forgotten-password screen fits a phone', await js("const r = document.querySelector('.account-card').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;"));
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
