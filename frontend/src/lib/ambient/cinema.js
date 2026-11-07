/**
 * Direction for the scene: what the camera is attending to, shared between the page's
 * React code and the render loop without causing React renders. Pure timeline logic and a
 * single mutable record, so that this file can be tested without a browser.
 */

/** When the cover starts to lift after the camera begins its approach, in seconds. */
export const OPENING_COVER_AT = 0.85;
/** When the whole opening is over and the Skip control goes away. */
export const OPENING_LENGTH = 3.6;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (x) => 1 - (1 - x) ** 3;

/**
 * The opening scene at a moment in time. Only the camera's approach is on the clock here:
 * the cover and pages follow their own springs once cued, so they behave the same as when
 * opened by hand.
 *   approach  0 far from the book, 1 arrived
 *   coverCue  the moment to lift the cover has come
 *   finished  nothing further is planned
 */
export function openingAt(seconds) {
  const t = Math.max(0, seconds);
  return {
    approach: easeOut(clamp01(t / 1.5)),
    coverCue: t >= OPENING_COVER_AT,
    finished: t >= OPENING_LENGTH,
  };
}

/** Moves a value toward a goal by an amount independent of the frame rate. */
export function approach(value, goal, rate, dt) {
  return goal + (value - goal) * Math.exp(-rate * dt);
}

export const cinema = {
  /** 1 as the camera starts to arrive, falling to 0. Read by the camera and the prints. */
  arrival: 1,
  /** Asks the camera to be in place at once, for a skipped opening. */
  skipArrival: false,
  /** The enlarged photograph: 0 none, 1 fully attending to it. Eased by the camera. */
  focus: 0,
  focusGoal: 0,
  /** Where on the book the enlarged photograph lies, along x. */
  focusX: 0,
  /** Set when something static has been added, so that shadows are drawn once more. */
  shadowsDirty: false,
  /** Finished cover boards, and frames drawn since the last one. See stageReady. */
  coversDrawn: 0,
  framesDrawn: 0,
  /** The scene's shaders are ready, so drawing it won't freeze the page. */
  compiled: false,
  /** The desk's textures have arrived, so that compiling now covers its real material. */
  roomLoaded: false,
};

const COVERS = 2;
const FRAMES_TO_SETTLE = 3;

/**
 * Whether the book is really on screen. The first frames of a scene can stall the browser
 * for a moment while shaders compile and cover maps are baked, and a scene timed from
 * before that would play half unseen.
 */
export function stageReady() {
  return cinema.compiled && cinema.coversDrawn >= COVERS && cinema.framesDrawn >= FRAMES_TO_SETTLE;
}

export function noteCoverDrawn() {
  cinema.coversDrawn += 1;
  cinema.framesDrawn = 0;
}

export function resetCinema() {
  cinema.arrival = 1;
  cinema.skipArrival = false;
  cinema.focus = 0;
  cinema.focusGoal = 0;
  cinema.focusX = 0;
  cinema.coversDrawn = 0;
  cinema.framesDrawn = 0;
  cinema.compiled = false;
  cinema.roomLoaded = false;
}

/**
 * Compiles an object's shaders in the background, using the browser's parallel compiling
 * where there is one, so that first drawing it doesn't freeze the page. Which shader a
 * material needs depends on whether it's drawn to a render target, as it is under the lens
 * effects, so a small target is selected just while the shaders are being requested.
 */
let compileTarget = null;
export function setCompileTarget(target) {
  compileTarget = target;
}

export async function precompile(gl, object, camera, scene, drawnToTarget) {
  const previous = gl.getRenderTarget();
  if (drawnToTarget && compileTarget) gl.setRenderTarget(compileTarget);
  const materials = gl.compile(object, camera, scene);
  gl.setRenderTarget(previous);
  // Waits as renderer.compileAsync does, except that a material replaced in the meantime
  // (a desk whose textures just arrived, say) is passed over, where that would throw.
  await new Promise((resolve) => {
    const check = () => {
      materials.forEach((material) => {
        const program = gl.properties.get(material).currentProgram;
        if (!program || program.isReady()) materials.delete(material);
      });
      if (materials.size === 0) resolve();
      else setTimeout(check, 10);
    };
    check();
  });
}
