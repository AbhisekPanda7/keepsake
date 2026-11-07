/**
 * Where the viewer is "looking from", shared by everything that responds to it: the 3D
 * camera, the lamp, the dust and the library's books. Values run from -1 to 1. A mouse
 * sets it directly; a phone's tilt sensor sets it where the browser allows that without
 * asking permission. Listeners are only attached while something is using it, and
 * not at all if the viewer has asked for reduced motion.
 */

const TILT_RANGE_DEGREES = 22;
/** Ignores a phone's sensor noise, which would otherwise keep the 3D scene redrawing. */
const SENSOR_DEADBAND = 0.04;

export const pointerField = { x: 0, y: 0, smoothX: 0, smoothY: 0 };

const subscribers = new Set();
let users = 0;
let tiltOrigin = null;

const clamp = (value) => Math.max(-1, Math.min(1, value));
const notify = () => subscribers.forEach((fn) => fn());

function onPointerMove(event) {
  if (event.pointerType !== 'mouse') return;
  pointerField.x = clamp((event.clientX / window.innerWidth) * 2 - 1);
  pointerField.y = clamp((event.clientY / window.innerHeight) * 2 - 1);
  notify();
}

function onOrientation(event) {
  if (event.gamma === null || event.beta === null) return;
  // Measured from how the phone was first held, as nobody holds one perfectly flat.
  tiltOrigin ??= { gamma: event.gamma, beta: event.beta };
  const x = clamp((event.gamma - tiltOrigin.gamma) / TILT_RANGE_DEGREES);
  const y = clamp((event.beta - tiltOrigin.beta) / TILT_RANGE_DEGREES);
  if (Math.abs(x - pointerField.x) < SENSOR_DEADBAND && Math.abs(y - pointerField.y) < SENSOR_DEADBAND) return;
  pointerField.x = x;
  pointerField.y = y;
  notify();
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Moves the smoothed values toward the pointer. Returns true if they're still moving. */
export function advancePointerField(dt) {
  const k = 1 - Math.exp(-Math.min(dt, 0.1) * 5);
  pointerField.smoothX += (pointerField.x - pointerField.smoothX) * k;
  pointerField.smoothY += (pointerField.y - pointerField.smoothY) * k;
  const settled = Math.abs(pointerField.x - pointerField.smoothX) < 0.001 && Math.abs(pointerField.y - pointerField.smoothY) < 0.001;
  if (settled) {
    pointerField.smoothX = pointerField.x;
    pointerField.smoothY = pointerField.y;
  }
  return !settled;
}

/** Starts listening, with `onChange` called as the pointer moves. Returns the way to stop. */
export function usePointerFieldListener(onChange) {
  subscribers.add(onChange);
  if (users === 0 && !prefersReducedMotion()) {
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    // iPhones require a permission prompt for this sensor, which isn't worth interrupting
    // the album for, so they simply don't get this effect.
    if (typeof DeviceOrientationEvent !== 'undefined' && !('requestPermission' in DeviceOrientationEvent)) {
      window.addEventListener('deviceorientation', onOrientation, { passive: true });
    }
  }
  users += 1;
  return () => {
    subscribers.delete(onChange);
    users -= 1;
    if (users === 0) {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('deviceorientation', onOrientation);
      tiltOrigin = null;
    }
  };
}
