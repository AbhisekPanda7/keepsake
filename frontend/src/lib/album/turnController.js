/**
 * The book's animation state: which spread is showing, how far each moving leaf
 * has travelled and how far the covers are open. Plain JS, no React and no Three,
 * so per-frame motion never touches React state. React subscribes only to the
 * snapshot, which changes when something discrete happens.
 *
 * The model is target-based. `spread` says where every leaf should end up: leaves
 * below it rest on the left, the others on the right. Only leaves away from their
 * rest position get an entry in `active`.
 */
import { BookSpin } from './bookSpin.js';
import { coverPose, makeBookLayout } from './bookModel.js';
import { REST_STATE, solveTurnForPointer } from './leafDeform.js';
import { MODE_SINGLE, MODE_SPREAD, convertSpread } from './pageModel.js';

const MAX_MOVING_LEAVES = 4;
/** Keeps neighbouring moving leaves apart so they fan out instead of intersecting. */
const LEAF_GAP = 0.07;
const COVER_OMEGA = 4.2;
const DRAG_OMEGA = 28;
const PEEK_OMEGA = 11;
const PEEK_T = 0.045;
const COMMIT_PROGRESS = 0.42;
/**
 * A finger on a single page can only pull the fore-edge as far as the screen's left
 * edge, which is about halfway through a turn, so the page commits much sooner.
 */
const COMMIT_PROGRESS_SINGLE = 0.26;
/** A returning page must have come past the spine, into view, before it can commit. */
const COMMIT_PROGRESS_SINGLE_BACK = 0.5;
/** Holding a sheet very near the spine gives too little leverage to follow the pointer. */
export const MIN_GRAB_U = 0.35;
/** World units per second of pointer speed that count as a flick. */
const FLICK_SPEED = 4.5;
const RIFFLE_INTERVAL = 0.11;
const OCCLUSION_RANGE = 0.42;
const OCCLUSION_STRENGTH = 0.6;
const RIPPLE_MAX = 0.2;
const RIPPLE_PER_SPEED = 0.12;
const RIPPLE_SPEED = 11;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const smoothstep = (a, b, x) => {
  const c = clamp((x - a) / (b - a), 0, 1);
  return c * c * (3 - 2 * c);
};

/**
 * Critically damped spring, solved exactly so that it behaves identically at any
 * frame rate. It starts from the release velocity of a drag and arrives without
 * overshoot, which is how a sheet of paper settles.
 */
function springStep(state, valueKey, velocityKey, goal, omega, dt) {
  const x0 = state[valueKey] - goal;
  const v0 = state[velocityKey];
  const c2 = v0 + omega * x0;
  const decay = Math.exp(-omega * dt);
  state[valueKey] = goal + (x0 + c2 * dt) * decay;
  state[velocityKey] = (c2 - omega * (x0 + c2 * dt)) * decay;
}

export class TurnController {
  constructor(leafCount, { turnOmega = 6.2, mode = MODE_SPREAD } = {}) {
    this.layout = makeBookLayout(leafCount);
    this.turnOmega = turnOmega;
    this.mode = mode;
    this.spread = 0;
    this.active = new Map();
    this.drag = null;
    this.peekLeaf = null;

    this.open = 0;
    this.openV = 0;
    /** How briskly the covers move. An opening scene slows them, to be seen. */
    this.coverOmega = COVER_OMEGA;
    this.openTarget = 0;
    this.backClosed = 0;
    this.backClosedV = 0;
    this.backTarget = 0;

    this.pendingSpread = null;
    this.pendingClose = false;
    this.riffleWait = 0;

    this.pose = coverPose(this.layout, this.open, this.backClosed, mode === MODE_SINGLE);
    /** Bumped when covers or layout move, telling meshes to rebuild. */
    this.poseVersion = 1;

    /** Moments for the visual effects layer to react to, emptied by takeEffects(). */
    this.effects = [];

    /** Told when something audible happens. Silent unless a page connects a sound to it. */
    this.sound = () => {};
    this.lastOpenTarget = this.openTarget;
    this.lastBackTarget = this.backTarget;

    /** Turning the closed book over in the hand. */
    this.spin = new BookSpin();
    /** A cover waiting for the book to come back down to the table before it opens. */
    this.afterSpin = null;

    this.listeners = new Set();
    this.wake = () => {};
    this.snapshot = this.buildSnapshot();
  }

  // ---- subscription ------------------------------------------------------

  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  buildSnapshot() {
    const coversSettled = this.open === this.openTarget && this.backClosed === this.backTarget;
    const { from, to } = this.visibleRange();
    let turning = false;
    this.active.forEach((e) => {
      if (e.hold === null) turning = true; // a hover lift doesn't count as turning
    });
    return {
      spread: this.spread,
      leafCount: this.layout.leafCount,
      turned: this.spin.isRotated,
      mode: this.mode,
      stage: this.stage(),
      resting: coversSettled && !turning && !this.drag && this.pendingSpread === null,
      visibleFrom: from,
      visibleTo: to,
    };
  }

  emit() {
    const next = this.buildSnapshot();
    const prev = this.snapshot;
    const same = Object.keys(next).every((k) => next[k] === prev[k]);
    if (same) return;
    this.snapshot = next;
    this.listeners.forEach((fn) => fn());
  }

  /** Only these leaves exist as meshes. The rest are part of the solid page blocks. */
  visibleRange() {
    let from = this.spread - 2;
    let to = this.spread + 1;
    this.active.forEach((_, leaf) => {
      from = Math.min(from, leaf - 1);
      to = Math.max(to, leaf + 1);
    });
    return {
      from: clamp(from, 0, this.layout.leafCount - 1),
      to: clamp(to, 0, this.layout.leafCount - 1),
    };
  }

  stage() {
    if (this.backTarget === 1) return 'closed-back';
    if (this.openTarget === 0) return 'closed-front';
    return 'open';
  }

  takeEffects() {
    if (this.effects.length === 0) return NO_EFFECTS;
    const taken = this.effects;
    this.effects = [];
    return taken;
  }

  // ---- reading state -----------------------------------------------------

  restT(leaf) {
    return leaf < this.spread ? 1 : 0;
  }

  /** Current deform state for a leaf. Stable object identity for resting leaves. */
  leafState(leaf) {
    const e = this.active.get(leaf);
    if (e) return e;
    return this.restT(leaf) === 1 ? REST_LEFT : REST_STATE;
  }

  /** A hover lift that has reached its height needs no more frames until it changes. */
  isHoldSettled(e) {
    return (
      e.hold !== null &&
      !e.dragging &&
      Math.abs(e.t - e.hold) < 0.0005 &&
      Math.abs(e.v) < 0.002 &&
      Math.abs(e.curl - e.dir) < 0.002
    );
  }

  /** Leaves still in flight. One almost down no longer limits how fast pages can turn. */
  movingCount() {
    let count = 0;
    this.active.forEach((e, leaf) => {
      if (e.hold !== null) return;
      if (e.dragging || Math.abs(e.t - this.restT(leaf)) > 0.05) count += 1;
    });
    return count;
  }

  get isAnimating() {
    let leafMoving = false;
    this.active.forEach((e) => {
      if (!this.isHoldSettled(e)) leafMoving = true;
    });
    return (
      leafMoving ||
      this.spin.isActive ||
      this.afterSpin !== null ||
      this.open !== this.openTarget ||
      this.backClosed !== this.backTarget ||
      this.pendingSpread !== null ||
      this.pendingClose
    );
  }

  get isCoverOpen() {
    return this.openTarget === 1 && this.open > 0.9 && this.backTarget === 0 && this.backClosed < 0.1;
  }

  /**
   * How strongly a turning neighbour darkens a page lying under it, and how far out
   * from the spine it reaches (0 to 1). As a sheet lifts away or settles down, the
   * narrowing gap admits less room light, which is why pages darken just before
   * they touch. `overLeaf` is the sheet above, `flatT` its progress when lying flat here.
   */
  occlusionFrom(overLeaf, flatT) {
    const e = this.active.get(overLeaf);
    if (!e) return null;
    const away = Math.abs(e.t - flatT);
    if (away >= OCCLUSION_RANGE) return null;
    const closeness = 1 - away / OCCLUSION_RANGE;
    return {
      amount: OCCLUSION_STRENGTH * closeness * Math.min(1, away / 0.015),
      reach: Math.max(0.15, Math.cos(away * Math.PI)),
    };
  }

  // ---- structure changes -------------------------------------------------

  setLeafCount(leafCount) {
    if (leafCount === this.layout.leafCount) return;
    const wasAtEnd = this.backTarget === 1;
    this.layout = makeBookLayout(leafCount);
    this.active.clear();
    this.drag = null;
    this.peekLeaf = null;
    this.spread = wasAtEnd ? leafCount : Math.min(this.spread, leafCount);
    this.refreshPose();
    this.emit();
    this.wake();
  }

  /**
   * Changes how the pages are bound, for instance when a phone rotates. The reader
   * stays on the same page; the book is rearranged at once rather than animated,
   * because the whole screen is changing shape at that moment anyway.
   */
  setMode(mode, leafCount) {
    if (mode === this.mode) {
      this.setLeafCount(leafCount);
      return;
    }
    const wasAtEnd = this.backTarget === 1;
    const spread = convertSpread(this.spread, this.mode, mode);
    this.mode = mode;
    this.layout = makeBookLayout(leafCount);
    this.active.clear();
    this.drag = null;
    this.peekLeaf = null;
    this.cancelPending();
    this.spread = wasAtEnd ? leafCount : clamp(spread, 0, leafCount);
    this.refreshPose();
    this.emit();
    this.wake();
  }

  refreshPose() {
    this.pose = coverPose(this.layout, this.open, this.backClosed, this.mode === MODE_SINGLE);
    this.poseVersion += 1;
  }

  // ---- navigation --------------------------------------------------------

  next() {
    if (this.drag) return;
    this.cancelPending();
    if (this.stage() === 'closed-front') {
      this.whenOnTable(() => {
        this.openTarget = 1;
      });
    } else if (this.stage() === 'open' && this.isCoverOpen) {
      if (this.spread < this.layout.leafCount) this.startTurn(1);
      else if (this.active.size === 0) this.backTarget = 1;
    }
    this.emit();
    this.wake();
  }

  prev() {
    if (this.drag) return;
    this.cancelPending();
    if (this.stage() === 'closed-back') {
      this.whenOnTable(() => {
        this.backTarget = 0;
      });
    } else if (this.stage() === 'open' && this.isCoverOpen) {
      if (this.spread > 0) this.startTurn(-1);
      else if (this.active.size === 0) this.openTarget = 0;
    }
    this.emit();
    this.wake();
  }

  /** Puts the cover fully open straight away, for someone skipping the opening scene. */
  finishOpening() {
    this.spin.reset();
    this.afterSpin = null;
    this.coverOmega = COVER_OMEGA;
    this.openTarget = 1;
    this.open = 1;
    this.openV = 0;
    this.refreshPose();
    this.emit();
    this.wake();
  }

  /** A book can't open in mid-air: if it's in the hand, it goes back to the table first. */
  whenOnTable(action) {
    if (this.spin.isRotated) {
      this.spin.goHome();
      this.afterSpin = action;
    } else {
      action();
    }
  }

  /** Opens the book if needed, then riffles to `spread`. */
  goToSpread(spread) {
    this.pendingSpread = clamp(spread, 0, this.layout.leafCount);
    this.pendingClose = false;
    this.emit();
    this.wake();
  }

  closeAlbum() {
    this.pendingSpread = 0;
    this.pendingClose = true;
    this.emit();
    this.wake();
  }

  cancelPending() {
    this.pendingSpread = null;
    this.pendingClose = false;
  }

  startTurn(direction) {
    if (this.movingCount() >= MAX_MOVING_LEAVES) return false;
    const leaf = direction > 0 ? this.spread : this.spread - 1;
    const e = this.ensureEntry(leaf);
    e.hold = null;
    e.dragging = false;
    e.dir = direction;
    if (!e.skewSet) {
      // A hand-turned page is held slightly off-square, lower corner leading.
      e.skew = direction * -0.35;
      e.skewSet = true;
    }
    this.spread += direction;
    this.sound('page-lift');
    return true;
  }

  ensureEntry(leaf) {
    let e = this.active.get(leaf);
    if (!e) {
      const dir = this.restT(leaf) === 1 ? -1 : 1;
      e = {
        leaf,
        t: this.restT(leaf),
        v: 0,
        curl: 0,
        skew: 0,
        shear: 0,
        dir,
        hold: null,
        dragging: false,
        skewSet: false,
      };
      this.active.set(leaf, e);
    }
    return e;
  }

  // ---- pointer interaction -----------------------------------------------

  /** Hover lift: the corner under the mouse rises a little to invite a drag. */
  setPeek(leaf, grabV) {
    if (this.drag || leaf === this.peekLeaf) return;
    this.clearPeek();
    if (leaf === null || this.movingCount() >= MAX_MOVING_LEAVES) return;
    const e = this.ensureEntry(leaf);
    const dir = this.restT(leaf) === 1 ? -1 : 1;
    e.dir = dir;
    e.hold = this.restT(leaf) === 1 ? 1 - PEEK_T : PEEK_T;
    e.skew = dir * clamp(grabV * 2, -1, 1);
    e.skewSet = true;
    this.peekLeaf = leaf;
    this.emit();
    this.wake();
  }

  clearPeek() {
    if (this.peekLeaf === null) return;
    const e = this.active.get(this.peekLeaf);
    if (e && !e.dragging) e.hold = null;
    this.peekLeaf = null;
    this.wake();
  }

  /** The leaf the pointer would pick up on a side, or null at the book's ends. */
  grabbableLeaf(side) {
    if (!this.isCoverOpen) return null;
    if (side > 0) return this.spread < this.layout.leafCount ? this.spread : null;
    return this.spread > 0 ? this.spread - 1 : null;
  }

  beginDrag(leaf, grabU, grabV, pointerY) {
    if (this.drag || this.movingCount() >= MAX_MOVING_LEAVES) return false;
    this.cancelPending();
    if (this.peekLeaf !== leaf) this.clearPeek();
    this.peekLeaf = null;
    const e = this.ensureEntry(leaf);
    e.dragging = true;
    e.hold = null;
    e.dir = this.restT(leaf) === 1 ? -1 : 1;
    // Holding the bottom corner means the bottom of the sheet leads, and vice
    // versa. Grabbing the middle of the edge turns the sheet with no diagonal.
    e.skew = e.dir * clamp(grabV * 2, -1, 1);
    e.skewSet = true;
    e.dragT = e.t;
    this.sound('page-lift');
    this.drag = {
      leaf,
      grabU: clamp(grabU, MIN_GRAB_U, 1),
      grabV,
      startY: pointerY,
      startRest: this.restT(leaf),
    };
    this.emit();
    this.wake();
    return true;
  }

  /** Pointer position on the z = 0 plane, with the camera's height for parallax. */
  dragTo(pointerX, pointerY, cameraZ) {
    if (!this.drag) return;
    const e = this.active.get(this.drag.leaf);
    if (!e) return;
    e.dragT = solveTurnForPointer(
      this.layout,
      this.drag.leaf,
      this.pose.hingeZ,
      e,
      this.drag.grabU,
      this.drag.grabV,
      pointerX,
      cameraZ,
      this.pose.offsetX,
    );
    e.shearGoal = clamp((pointerY - this.drag.startY) * 0.3, -0.4, 0.4);
    this.wake();
  }

  /** Finishes a drag: completes the turn past the threshold or falls back. */
  endDrag(pointerSpeedX = 0) {
    if (!this.drag) return;
    const { leaf, startRest } = this.drag;
    const e = this.active.get(leaf);
    this.drag = null;
    if (e) {
      e.dragging = false;
      e.shearGoal = 0;
      const forward = startRest === 0;
      const progress = forward ? e.t : 1 - e.t;
      const flick = forward ? pointerSpeedX < -FLICK_SPEED : pointerSpeedX > FLICK_SPEED;
      const flickAway = forward ? pointerSpeedX > FLICK_SPEED : pointerSpeedX < -FLICK_SPEED;
      let threshold = COMMIT_PROGRESS;
      if (this.mode === MODE_SINGLE) threshold = forward ? COMMIT_PROGRESS_SINGLE : COMMIT_PROGRESS_SINGLE_BACK;
      const commit = (progress > threshold && !flickAway) || flick;
      if (commit) this.spread = forward ? leaf + 1 : leaf;
      e.dir = this.spread > leaf ? 1 : -1;
    }
    this.emit();
    this.wake();
  }

  // ---- per-frame update --------------------------------------------------

  update(rawDt) {
    // Springs are solved exactly, so a slow device stays on real time at a lower
    // frame rate rather than playing in slow motion. The cap only limits a long stall.
    const dt = Math.min(rawDt, 0.1);
    this.spin.update(dt);
    if (this.spin.landed) this.sound('book-down');
    this.soundCovers();
    if (this.afterSpin && !this.spin.isRotated) {
      const action = this.afterSpin;
      this.afterSpin = null;
      action();
      this.emit();
    }
    // New photographs may arrive while the book's in the hand, wanting it opened.
    let structureChanged = false;
    if (this.pendingSpread !== null && this.spin.isRotated) this.spin.goHome();
    else structureChanged = this.pumpPending(dt);

    if (this.updateCovers(dt)) this.refreshPose();

    let removed = false;
    this.active.forEach((e, leaf) => {
      const goal = e.dragging ? e.dragT : (e.hold ?? this.restT(leaf));
      const omega = e.dragging ? DRAG_OMEGA : e.hold !== null ? PEEK_OMEGA : this.turnOmega;
      springStep(e, 't', 'v', goal, omega, dt);
      e.t = clamp(e.t, 0, 1);

      // A sheet being pulled leads with its edge. Once let go, air under the sheet
      // holds the edge back as it comes down, so the curl reverses on landing.
      const progress = e.dir > 0 ? e.t : 1 - e.t;
      const curlGoal = e.dragging || e.hold !== null
        ? e.dir
        : e.dir * (1 - 1.55 * smoothstep(0.5, 0.92, progress));
      e.curl += (curlGoal - e.curl) * (1 - Math.exp(-dt * 9));
      const shearGoal = e.dragging ? (e.shearGoal ?? 0) : 0;
      e.shear += (shearGoal - e.shear) * (1 - Math.exp(-dt * 14));

      // Ripple follows the sheet's speed, so a page flicked across flutters more than
      // one eased over, and a page being held still doesn't flutter at all.
      const rippleGoal = Math.min(RIPPLE_MAX, Math.abs(e.v) * RIPPLE_PER_SPEED);
      e.ripple = (e.ripple ?? 0) + (rippleGoal - (e.ripple ?? 0)) * (1 - Math.exp(-dt * 10));
      e.ripplePhase = (e.ripplePhase ?? 0) + dt * RIPPLE_SPEED;

      // A falling sheet touching down, the moment for its puff of air and dust.
      if (!e.landed && !e.dragging && e.hold === null && Math.abs(e.t - goal) < 0.05 && Math.abs(e.v) > 0.02) {
        e.landed = true;
        this.effects.push({ type: 'land', side: goal === 1 ? -1 : 1 });
        this.sound('page-land');
      }

      if (!e.dragging && e.hold === null && Math.abs(e.t - goal) < 0.0012 && Math.abs(e.v) < 0.02) {
        this.active.delete(leaf);
        removed = true;
      }
    });

    this.keepLeavesApart();

    if (removed) structureChanged = true;
    if (structureChanged || removed) {
      this.emit();
    } else {
      const next = this.buildSnapshot();
      if (this.snapshot.resting !== next.resting || this.snapshot.turned !== next.turned) this.emit();
    }
  }

  /** A cover starting to move creaks, and one coming shut lands with a thump. */
  soundCovers() {
    if (this.openTarget !== this.lastOpenTarget) {
      this.sound(this.openTarget === 1 ? 'cover-open' : 'cover-close');
      this.lastOpenTarget = this.openTarget;
    }
    if (this.backTarget !== this.lastBackTarget) {
      this.sound(this.backTarget === 1 ? 'cover-close' : 'cover-open');
      this.lastBackTarget = this.backTarget;
    }
    const shutting = (this.openTarget === 0 && this.open > 0) || (this.backTarget === 1 && this.backClosed < 1);
    if (this.wasShutting && !shutting && (this.openTarget === 0 || this.backTarget === 1)) this.sound('book-down');
    this.wasShutting = shutting;
  }

  updateCovers(dt) {
    let moved = false;
    if (this.open !== this.openTarget) {
      springStep(this, 'open', 'openV', this.openTarget, this.coverOmega, dt);
      if (Math.abs(this.open - this.openTarget) < 0.0008 && Math.abs(this.openV) < 0.01) {
        this.open = this.openTarget;
        this.openV = 0;
      }
      moved = true;
    }
    if (this.backClosed !== this.backTarget) {
      springStep(this, 'backClosed', 'backClosedV', this.backTarget, COVER_OMEGA, dt);
      if (Math.abs(this.backClosed - this.backTarget) < 0.0008 && Math.abs(this.backClosedV) < 0.01) {
        this.backClosed = this.backTarget;
        this.backClosedV = 0;
      }
      moved = true;
    }
    if (moved) {
      this.open = clamp(this.open, 0, 1);
      this.backClosed = clamp(this.backClosed, 0, 1);
    }
    return moved;
  }

  /**
   * Sheets cannot pass through each other, so leaf i must stay ahead of leaf i + 1.
   * Clamping to that order also produces a natural riffle when turning quickly.
   */
  keepLeavesApart() {
    if (this.active.size < 2) return;
    const leaves = [...this.active.keys()].sort((a, b) => a - b);
    for (let n = 0; n < leaves.length - 1; n += 1) {
      if (leaves[n + 1] !== leaves[n] + 1) continue;
      const upper = this.active.get(leaves[n]);
      const lower = this.active.get(leaves[n + 1]);
      if (lower.t <= 0 || upper.t >= 1) continue;
      // The gap closes near either stack, where sheets really do settle together.
      // A fixed gap would hold each sheet off the one landing ahead of it.
      const gap = LEAF_GAP * Math.min(1, (1 - upper.t) / 0.3, lower.t / 0.3);
      const limit = upper.t - gap;
      if (lower.t <= limit) continue;
      if (lower.dir > 0) {
        lower.t = Math.max(0, limit);
        lower.v = Math.min(lower.v, upper.v);
      } else {
        upper.t = Math.min(1, lower.t + gap);
        upper.v = Math.max(upper.v, lower.v);
      }
    }
  }

  /** Advances any goToSpread / closeAlbum request. Returns true if spread jumped. */
  pumpPending(dt) {
    if (this.pendingSpread === null) {
      if (this.pendingClose && this.active.size === 0 && !this.drag) {
        this.pendingClose = false;
        this.openTarget = 0;
        return true;
      }
      return false;
    }
    if (this.drag) return false;

    if (this.backTarget === 1) {
      this.backTarget = 0;
      return true;
    }
    if (this.backClosed > 0.1) return false;
    if (this.openTarget === 0) {
      if (this.pendingClose) {
        // Already shut and asked to close: nothing to do.
        this.cancelPending();
        return true;
      }
      this.openTarget = 1;
      return true;
    }
    if (this.open < 0.9) return false;

    const delta = this.pendingSpread - this.spread;
    if (delta === 0) {
      this.pendingSpread = null;
      return true;
    }

    // Long journeys skip the middle: only the last few leaves actually fly.
    const direction = Math.sign(delta);
    if (Math.abs(delta) > MAX_MOVING_LEAVES && this.active.size === 0) {
      this.spread = this.pendingSpread - direction * MAX_MOVING_LEAVES;
      return true;
    }

    this.riffleWait -= dt;
    if (this.riffleWait > 0) return false;
    if (this.startTurn(direction)) {
      this.riffleWait = RIFFLE_INTERVAL;
      return true;
    }
    return false;
  }
}

const REST_LEFT = Object.freeze({ ...REST_STATE, t: 1 });
const NO_EFFECTS = Object.freeze([]);
