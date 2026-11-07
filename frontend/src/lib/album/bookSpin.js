/**
 * Turning a closed book over in the hand. Plain JS, like the rest of the book's motion.
 *
 * Rotation is held as a quaternion, not as separate angles. Angles lock up when a book
 * is turned on end, whereas this turns freely in every direction, and each drag always
 * moves the book the way the pointer moves, however it's currently facing.
 */

/** A full turn for a drag of this many pixels. */
const PIXELS_PER_TURN = 620;
const VELOCITY_DECAY = 2.2;
const MAX_SPIN_SPEED = 12;
const STOPPED_SPEED = 0.15;
const RETURN_RATE = 5.5;
/** Height it's held above the point where it would touch the table while in the hand. */
const HOLD_HEIGHT = 0.28;
const AT_HOME_ANGLE = 0.004;

const IDENTITY = Object.freeze([0, 0, 0, 1]);

export function multiply(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function fromAxisAngle(axis, angle) {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

function normalize(q) {
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

/** Rotation of q away from no rotation at all, in radians, by the shorter way round. */
export function angleFromHome(q) {
  return 2 * Math.acos(Math.min(1, Math.abs(q[3])));
}

/** Moves q part of the way home, always by the shorter way round. */
function towardHome(q, k) {
  const sign = q[3] < 0 ? -1 : 1;
  return normalize([q[0] * sign * (1 - k), q[1] * sign * (1 - k), q[2] * sign * (1 - k), q[3] * sign * (1 - k) + k]);
}

function rotateVector(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + y * tz - z * ty,
    v[1] + w * ty + z * tx - x * tz,
    v[2] + w * tz + x * ty - y * tx,
  ];
}

/**
 * How low a box with these half-sizes reaches below its own centre when rotated. The
 * book's centre is raised by exactly this, so no corner can ever pass through the table.
 */
export function reachBelowCentre(q, halfX, halfY, halfZ) {
  let lowest = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        lowest = Math.min(lowest, rotateVector(q, [sx * halfX, sy * halfY, sz * halfZ])[2]);
      }
    }
  }
  return -lowest;
}

export class BookSpin {
  constructor() {
    this.q = [...IDENTITY];
    this.velocity = [0, 0, 0]; // radians per second, about each world axis
    this.held = false;
    this.returning = false;
    this.height = 0; // extra height in the hand, eased
    this.landed = false; // set for one update when it comes back down onto the table
    // Which way is right and up on screen, kept current by the camera.
    this.viewRight = [1, 0, 0];
    this.viewUp = [0, 1, 0];
    this.lastDragTime = 0;
  }

  get isRotated() {
    return this.held || angleFromHome(this.q) > AT_HOME_ANGLE;
  }

  /** Whether it's moving. A book left hanging in the air isn't, and costs nothing to draw. */
  get isActive() {
    return (
      this.held ||
      this.returning ||
      Math.hypot(...this.velocity) > 0 ||
      Math.abs(this.height - this.heightGoal()) > 0.001
    );
  }

  get speed() {
    return Math.hypot(...this.velocity);
  }

  heightGoal() {
    return this.isRotated ? HOLD_HEIGHT : 0;
  }

  setViewAxes(right, up) {
    this.viewRight = right;
    this.viewUp = up;
  }

  grab() {
    this.held = true;
    this.returning = false;
    this.velocity = [0, 0, 0];
    this.lastDragTime = performance.now();
  }

  /**
   * Turns the book by a pointer movement. Right spins the near face to the right; down
   * tips the top of the book toward the viewer. So it feels like rolling it by hand.
   */
  dragBy(dx, dy) {
    const k = (Math.PI * 2) / PIXELS_PER_TURN;
    const spinAboutUp = fromAxisAngle(this.viewUp, dx * k);
    const spinAboutRight = fromAxisAngle(this.viewRight, dy * k);
    this.q = normalize(multiply(multiply(spinAboutUp, spinAboutRight), this.q));

    // How fast it's going now, for the momentum it keeps when let go.
    const now = performance.now();
    const dt = Math.max(0.004, (now - this.lastDragTime) / 1000);
    this.lastDragTime = now;
    for (let i = 0; i < 3; i += 1) {
      const sample = ((this.viewUp[i] * dx + this.viewRight[i] * dy) * k) / dt;
      this.velocity[i] += (sample - this.velocity[i]) * 0.35;
    }
  }

  release() {
    this.held = false;
    // A hand that stopped moving before letting go leaves no momentum behind.
    if (performance.now() - this.lastDragTime > 90) {
      this.velocity = [0, 0, 0];
      return;
    }
    // Even the hardest flick is a spin you can follow, not a blur.
    const speed = Math.hypot(...this.velocity);
    if (speed > MAX_SPIN_SPEED) this.velocity = this.velocity.map((v) => (v / speed) * MAX_SPIN_SPEED);
  }

  /** Sends it back down to the table: asked for by hand, or because it's being opened. */
  goHome() {
    if (!this.isRotated) return;
    this.held = false;
    this.returning = true;
    this.velocity = [0, 0, 0];
  }

  /** Back on the table at once, with no movement left over. */
  reset() {
    this.q = [...IDENTITY];
    this.velocity = [0, 0, 0];
    this.held = false;
    this.returning = false;
    this.height = 0;
  }

  update(dt) {
    this.landed = false;
    if (this.held) {
      // Still in the hand but not moving: any momentum it had has gone.
      const decay = Math.exp(-dt * 7);
      this.velocity = this.velocity.map((v) => v * decay);
    } else if (this.returning) {
      this.q = towardHome(this.q, 1 - Math.exp(-dt * RETURN_RATE));
      if (angleFromHome(this.q) <= AT_HOME_ANGLE) {
        this.q = [...IDENTITY];
        this.returning = false;
        this.landed = true;
      }
    } else {
      // Let go: it runs on and slows down, and then stays exactly where it stopped.
      const speed = this.speed;
      if (speed > STOPPED_SPEED) {
        const step = fromAxisAngle(this.velocity.map((v) => v / speed), speed * dt);
        this.q = normalize(multiply(step, this.q));
        const decay = Math.exp(-dt * VELOCITY_DECAY);
        this.velocity = this.velocity.map((v) => v * decay);
      } else {
        this.velocity = [0, 0, 0];
      }
    }
    const goal = this.heightGoal();
    this.height += (goal - this.height) * (1 - Math.exp(-dt * 7));
    if (Math.abs(this.height - goal) < 0.0005) this.height = goal;
  }

  /** Height of the book's centre above the table, for a book of the given half-sizes. */
  centreHeight(halfX, halfY, halfZ) {
    return Math.max(halfZ, reachBelowCentre(this.q, halfX, halfY, halfZ)) + this.height;
  }
}
