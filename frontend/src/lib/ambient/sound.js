/**
 * The album's sounds, all synthesised from filtered noise and low tones, so there are
 * no audio files to download. Browsers don't allow sound before the first click or key
 * press, so nothing is created until then. Silence is always one button away, and the
 * choice is remembered on this device only.
 */

const STORAGE_KEY = 'keepsake-sound';

/**
 * The album is currently silent, by choice. With this false no audio is ever created,
 * and every sound below does nothing. To bring sound back, set it to true and put
 * <SoundToggle /> back in components/UI/Header.jsx.
 */
const SOUND_ENABLED = false;

let context = null;
let master = null;
let noiseBuffer = null;
let rustle = null;
let whoosh = null;
let muted = false;
let loaded = false;
const listeners = new Set();
/** The last few sounds, which the browser tests read. Tests can't hear. */
const recent = [];

function loadPreference() {
  if (loaded) return;
  loaded = true;
  try {
    muted = window.localStorage.getItem(STORAGE_KEY) === 'off';
  } catch {
    // Storage may be blocked; sound just stays on for this visit.
  }
}

function makeNoise(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Slightly smoothed white noise, a softer starting point for paper than pure hiss.
  let last = 0;
  for (let i = 0; i < data.length; i += 1) {
    last = last * 0.35 + (Math.random() * 2 - 1) * 0.65;
    data[i] = last;
  }
  return buffer;
}

/** A looping noise that's always running, silent until its level is raised. */
function makeContinuous(ctx, destination, frequency, q) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(gain).connect(destination);
  source.start();
  return { gain, filter };
}

/** Called from the first click or key press, which is what browsers require. */
export function enableSound() {
  if (!SOUND_ENABLED) return;
  loadPreference();
  if (context) {
    if (context.state === 'suspended') context.resume().catch(() => {});
    return;
  }
  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    context = new AudioContextClass();
  } catch {
    context = null;
    return;
  }
  master = context.createGain();
  master.gain.value = muted ? 0 : 0.8;
  master.connect(context.destination);
  noiseBuffer = makeNoise(context);
  rustle = makeContinuous(context, master, 3000, 0.7);
  whoosh = makeContinuous(context, master, 520, 0.9);
  if (context.state === 'suspended') context.resume().catch(() => {});
}

// ---- building blocks -------------------------------------------------------------------

function noiseBurst({ type = 'bandpass', from, to = from, q = 0.8, gain, attack = 0.005, length, delay = 0 }) {
  const t = context.currentTime + delay;
  const source = context.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + length);
  const level = context.createGain();
  level.gain.setValueAtTime(0.0001, t);
  level.gain.exponentialRampToValueAtTime(gain, t + attack);
  level.gain.exponentialRampToValueAtTime(0.0001, t + length);
  source.connect(filter).connect(level).connect(master);
  source.start(t, Math.random() * 1.5, length + 0.05);
}

function tone({ wave = 'sine', from, to = from, gain, attack = 0.004, length, delay = 0 }) {
  const t = context.currentTime + delay;
  const oscillator = context.createOscillator();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(from, t);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + length);
  const level = context.createGain();
  level.gain.setValueAtTime(0.0001, t);
  level.gain.exponentialRampToValueAtTime(gain, t + attack);
  level.gain.exponentialRampToValueAtTime(0.0001, t + length);
  oscillator.connect(level).connect(master);
  oscillator.start(t);
  oscillator.stop(t + length + 0.05);
}

/** Small random differences, so that no two page turns sound quite the same. */
const vary = (value, amount = 0.15) => value * (1 + (Math.random() - 0.5) * 2 * amount);

// ---- the sounds --------------------------------------------------------------------------

const SOUNDS = {
  // Paper peeling away from the page beneath it, in a couple of small crackles.
  'page-lift': () => {
    noiseBurst({ from: vary(1800), to: vary(4200), q: 0.7, gain: 0.2, attack: 0.03, length: 0.26 });
    noiseBurst({ type: 'highpass', from: vary(4800), q: 0.5, gain: 0.06, length: 0.05, delay: vary(0.06) });
    noiseBurst({ type: 'highpass', from: vary(5600), q: 0.5, gain: 0.045, length: 0.04, delay: vary(0.14) });
  },
  // The soft slap of a sheet settling on the others, with air pushed out from under it.
  'page-land': () => {
    noiseBurst({ type: 'lowpass', from: vary(1500), to: 400, q: 0.5, gain: 0.26, attack: 0.004, length: 0.13 });
    tone({ from: vary(140), to: 75, gain: 0.1, length: 0.08 });
  },
  // A hinge taking the weight: a low creak of stiff leather, and air moving.
  'cover-open': () => {
    tone({ wave: 'sawtooth', from: 62, to: 92, gain: 0.018, attack: 0.08, length: 0.55 });
    tone({ wave: 'sawtooth', from: 93, to: 131, gain: 0.009, attack: 0.1, length: 0.42, delay: 0.05 });
    noiseBurst({ from: 520, to: 1500, q: 1.4, gain: 0.07, attack: 0.1, length: 0.5 });
    noiseBurst({ type: 'lowpass', from: 700, to: 300, q: 0.5, gain: 0.11, attack: 0.25, length: 0.7, delay: 0.1 });
  },
  'cover-close': () => {
    tone({ wave: 'sawtooth', from: 92, to: 62, gain: 0.014, attack: 0.08, length: 0.42 });
    noiseBurst({ type: 'lowpass', from: 800, to: 300, q: 0.5, gain: 0.09, attack: 0.15, length: 0.5 });
  },
  // A solid book coming to rest on wood.
  'book-down': () => {
    tone({ from: 104, to: 48, gain: 0.5, attack: 0.003, length: 0.2 });
    tone({ from: 215, to: 120, gain: 0.08, attack: 0.002, length: 0.07 });
    noiseBurst({ type: 'lowpass', from: 1000, to: 220, q: 0.6, gain: 0.2, attack: 0.002, length: 0.09 });
  },
};

export function playSound(name) {
  recent.push(name);
  if (recent.length > 60) recent.shift();
  if (!context || muted || context.state !== 'running') return;
  try {
    SOUNDS[name]?.();
  } catch {
    // A sound that fails to play shouldn't interrupt anything.
  }
}

/** Paper dragging: louder and brighter the faster a page is moved by hand. 0 to 1. */
export function setRustle(amount) {
  if (!context || !rustle) return;
  const level = muted ? 0 : Math.min(1, amount) * 0.18;
  rustle.gain.gain.setTargetAtTime(level, context.currentTime, 0.04);
  rustle.filter.frequency.setTargetAtTime(2400 + amount * 2200, context.currentTime, 0.05);
}

/** Air past a turning book: louder and higher the faster it spins. 0 to 1. */
export function setWhoosh(amount) {
  if (!context || !whoosh) return;
  const level = muted ? 0 : Math.min(1, amount) * 0.34;
  whoosh.gain.gain.setTargetAtTime(level, context.currentTime, 0.06);
  whoosh.filter.frequency.setTargetAtTime(340 + amount * 800, context.currentTime, 0.08);
}

// ---- on and off ---------------------------------------------------------------------------

export function isSoundOn() {
  loadPreference();
  return !muted;
}

export function setSoundOn(on) {
  loadPreference();
  muted = !on;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Works for this visit even if it can't be remembered.
  }
  enableSound();
  if (master && context) master.gain.setTargetAtTime(on ? 0.8 : 0, context.currentTime, 0.02);
  listeners.forEach((fn) => fn());
}

export function subscribeSound(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const soundDebug = () => ({ state: context?.state ?? 'none', muted, recent: [...recent] });
