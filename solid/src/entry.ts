// What a page hands the host's frame loop, and the entry a page gets on its first mount.
//
// `Motion` is the page's half of the host: `onWheel` (the polled wheel delta, before the frame), `onPointer` (the pointer
// once a frame, after the events and before the tick: a page that drags keeps its own flag) and `tick` (the elapsed
// seconds, after the events and before the tree is declared). main.ts wires all three to the page it renders.
//
// `pageEntry` is the four plain pages' first mount (List, Widgets, Sensors, Text field): the root's whole subtree rises 8px
// and fades in — `TRANSLATE_Y` 8 → 0 on `spatial(0.25, 0)` and `ALPHA` 0 → 255 on `effect(0.25)`, the group fields, so
// nothing moves in the layout — and then writes nothing at all, so a page at rest is the frame its literals make. The
// clock is the tick, so a headless frame at 1/60 and a window frame at the real dt take the same path. Reduced motion has
// no entry: the first frame is the settled one. The Sky page's entry is its cards' stagger, and the Dialog's its two
// overlays; both own their ticks.
import { ui } from "./ffi.ts";
import { effect, reduced, spatial, track } from "./motion.ts";
import { FIELDS } from "./pack.ts";

/** The page's frame hook, as the host calls it. */
export interface Motion {
  /** The wheel the host polled since the last frame (SDL's delta: positive y away from the user). */
  onWheel?: (dx: number, dy: number) => void;
  /** The pointer this frame, once, before the tick: `down` is the button. */
  onPointer?: (x: number, y: number, down: boolean) => void;
  /** The elapsed seconds: the page's motion ticks here, before the tree is declared. */
  tick?: (dt: number) => void;
}

const RISE = 8; // px low on the first frame
const TIME = 0.25; // s

/**
 * Gives the page its first-mount entry: the root element's subtree (`root`, the id of the page's outermost box) rises and
 * fades in over 0.25s, once, and the tick then writes nothing. A page with no motion hook (the tests that render one
 * without a host) gets no tick at all, so its frames are the literals'.
 */
export function pageEntry(motion: Motion | undefined, root = "Root"): void {
  if (!motion) return;
  const id = Buffer.from(root);
  const rise = track(RISE, spatial(TIME));
  const fade = track(0, effect(TIME));
  rise.retarget(0, 0);
  fade.retarget(0, 255);
  let t = 0;
  let done = reduced();
  motion.tick = (dt) => {
    if (done) return;
    const y = rise.at(t), a = fade.at(t);
    ui.value(id, FIELDS.TRANSLATE_Y, y.x);
    ui.value(id, FIELDS.ALPHA, a.x);
    // the frame both settle on is the literal, written once: a frame at rest writes nothing at all
    if (y.done && a.done) done = true;
    t += dt;
  };
}
