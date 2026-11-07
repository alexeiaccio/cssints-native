// Motion tracks: Rune's model, a spring from SwiftUI's (duration, bounce) and a decay for scroll physics. The clock is
// passed in (seconds); nothing here reads the time, so a headless frame at dt = 1/60 and a window frame at the real dt
// take the same path and a test can ask for any instant. Two classes, as Rune has them: `spatial` may overshoot, `effect`
// (colour, opacity) is clamped and critically damped even when a bounce is asked for.
//
// A spring is the analytic solution of the damped oscillator, so it is exact at any time and frame-rate independent: no
// integration, no accumulated error. `ω = 2π / duration`, `ζ = 1 - bounce`; the displacement d = x - target obeys
// d'' + 2ζω d' + ω² d = 0. A track holds one segment `{x0, v0, target, t0, spring}`; a retarget samples the presented
// (x, v) first, so position and velocity are continuous across it. The settle rule snaps exactly: within 0.5px and
// 0.5px/s of the target the value is the target and the velocity 0, which is Rune's 1/64px idea without the grid.
//
// A decay is a fling: v(t) = v0·r^t with r = 0.998 per millisecond, iOS's normal deceleration. In the script's seconds
// that is v0·e^(-kt), k = -1000·ln r ≈ 2.002, and x(t) = x0 + v0·(1 - e^(-kt))/k, so it stops at v0/k and `project()` is
// where it lands. It stops when |v| < 5px/s and snaps to the projection, the fraction of a pixel a mouse would not see.
//
// A node that leaves needs one thing the tracks cannot say: it must stay mounted while its exit runs, and come back
// where it is if it returns mid-exit (Rune's rule) — that is `presence`. Reduced motion is a module flag the host sets
// once (`--reduced-motion`): a retarget then lands on its target at once and a presence unmounts at once, so the pages
// keep one code path and the flag only changes what an instant means. `channel` is the page side of the value
// channel (`ui.value`): one call per element a frame instead of a loop over its fields.
//
// Not here: a velocity-only track for a drag (the host hands the page the pointer's positions and the page keeps the last
// few: Sky's `speed()` estimates the release's velocity from them, so a file that reads no clock has nothing to hold), and
// a value channel for anything but the style a page already packs (a page passes the value to ui.scrollTo or into its own
// draw; a style is a compile-time literal and a page animates it through ui.value). The rubber band is here because its
// resistance is geometry, not a page's business: `rubber`.

/** A spring's parameters: the natural frequency and damping ratio, and whether its output may overshoot. */
export interface Spring {
  readonly duration: number; // seconds; ω = 2π / duration
  readonly bounce: number; // 0 critically damped, > 0 springs past the target
  readonly omega: number;
  readonly zeta: number;
  readonly clamp: boolean; // `effect`: never leaves the start..target range
}

/** The default of Rune's tracks: 0.35s, no bounce. */
export const spatial = (duration = 0.35, bounce = 0): Spring => {
  const z = Math.min(Math.max(1 - bounce, 0), 2);
  return { duration, bounce, omega: (2 * Math.PI) / Math.max(duration, 1e-3), zeta: z, clamp: false };
};

/** The effect class: critically damped (a bounce is ignored) and clamped, so an opacity or a colour cannot overshoot. */
export const effect = (duration = 0.35): Spring => ({
  duration,
  bounce: 0,
  omega: (2 * Math.PI) / Math.max(duration, 1e-3),
  zeta: 1,
  clamp: true,
});

/** Where a track is at an instant: the value, its velocity and whether it has settled (then x is exactly the target). */
export interface Sample {
  readonly x: number;
  readonly v: number;
  readonly done: boolean;
}

const EPS = 0.5; // px
const EPS_V = 0.5; // px/s

// Reduced motion: the platform asks for less, so nothing travels and nothing waits. A module flag rather than a
// parameter of every call, because the host sets it once and no page should have to know.
let reducedMotion = false;

/** Whether the platform asked for reduced motion (the host's `--reduced-motion` / `REDUCED_MOTION=1`). */
export const reduced = (): boolean => reducedMotion;

/**
 * Sets reduced motion: a retarget then lands on its target with v = 0 (settled in the same call) and a `presence`
 * unmounts at once. A page needs no branch of its own.
 */
export const setReducedMotion = (on: boolean): void => {
  reducedMotion = on;
};

/** The displacement and velocity of a damped oscillator t seconds after (d0, v0), from rest at the target. */
function solve(spring: Spring, d0: number, v0: number, t: number): { d: number; v: number } {
  const { omega: w, zeta: z } = spring;
  const envelope = Math.exp(-z * w * t);
  if (z < 1 - 1e-4) {
    // under-damped: a decaying sinusoid
    const wd = w * Math.sqrt(1 - z * z);
    const a = d0;
    const b = (v0 + z * w * d0) / wd;
    const cos = Math.cos(wd * t);
    const sin = Math.sin(wd * t);
    return {
      d: envelope * (a * cos + b * sin),
      v: envelope * ((-z * w * a + b * wd) * cos + (-z * w * b - a * wd) * sin),
    };
  }
  if (z > 1 + 1e-4) {
    // over-damped: two real roots, both negative
    const a = w * Math.sqrt(z * z - 1);
    const r1 = -z * w + a;
    const r2 = -z * w - a;
    const c1 = (v0 - r2 * d0) / (r1 - r2);
    const c2 = d0 - c1;
    const e1 = Math.exp(r1 * t);
    const e2 = Math.exp(r2 * t);
    return { d: c1 * e1 + c2 * e2, v: r1 * c1 * e1 + r2 * c2 * e2 };
  }
  // critically damped: d = e^(-ωt)(d0 + (v0 + ω d0)t)
  const b = v0 + w * d0;
  return { d: envelope * (d0 + b * t), v: envelope * (v0 - w * b * t) };
}

/** A spring segment: it starts at (x0, v0) at t0 and runs towards `target`. */
export class Track {
  x0: number;
  v0: number;
  target: number;
  t0: number;
  spring: Spring;

  constructor(x: number, spring: Spring = spatial(), t0 = 0) {
    this.x0 = x;
    this.v0 = 0;
    this.target = x;
    this.t0 = t0;
    this.spring = spring;
  }

  /** The value and velocity at t (seconds). Settled means the value is exactly the target and the velocity 0. */
  at(t: number): Sample {
    const dt = Math.max(0, t - this.t0);
    const { d, v } = solve(this.spring, this.x0 - this.target, this.v0, dt);
    let x = this.target + d;
    let vv = v;
    if (this.spring.clamp) {
      const lo = Math.min(this.x0, this.target);
      const hi = Math.max(this.x0, this.target);
      if (x < lo || x > hi) (x = x < lo ? lo : hi), (vv = 0);
    }
    if (Math.abs(x - this.target) < EPS && Math.abs(vv) < EPS_V) return { x: this.target, v: 0, done: true };
    return { x, v: vv, done: false };
  }

  /** Starts a new segment at t from the presented (x, v), so the value and the velocity are continuous. Under reduced
   *  motion there is no segment: the value lands on the target with v = 0, settled in the same call. */
  retarget(t: number, target: number, spring?: Spring): void {
    if (reducedMotion) {
      if (spring) this.spring = spring;
      this.x0 = this.target = target;
      this.v0 = 0;
      this.t0 = t;
      return;
    }
    // the presented sample is the old segment's: it is taken before the new one starts
    const p = this.at(t);
    if (spring) this.spring = spring;
    this.x0 = p.x;
    this.v0 = p.v;
    this.target = target;
    this.t0 = t;
  }
}

/** A track starting at x at rest, its target x. */
export const track = (x: number, spring?: Spring, t0 = 0): Track => new Track(x, spring, t0);

/** iOS's normal deceleration, r = 0.998 per millisecond, as a rate per second. */
const RATE = -Math.log(0.998) * 1000;
const STOP = 5; // px/s

/** A fling: exponential decay from (x0, v0) at t0, stopping when the velocity is below 5px/s. */
export class Decay {
  x0: number;
  v0: number;
  t0: number;

  constructor(x: number, v: number, t0 = 0) {
    this.x0 = x;
    this.v0 = v;
    this.t0 = t0;
  }

  /** Where the fling would land if it ran out: x0 + v0 / k. */
  project(): number {
    return this.x0 + this.v0 / RATE;
  }

  at(t: number): Sample {
    const dt = Math.max(0, t - this.t0);
    const v = this.v0 * Math.exp(-RATE * dt);
    if (Math.abs(this.v0) <= STOP || Math.abs(v) < STOP) return { x: this.project(), v: 0, done: true };
    return { x: this.x0 + (this.v0 * (1 - Math.exp(-RATE * dt))) / RATE, v, done: false };
  }
}

/** A fling from x moving at v px/s (positive to the right or down) at t0. */
export const decay = (x: number, v: number, t0 = 0): Decay => new Decay(x, v, t0);

/** Rune's and iOS's resistance constant: the band moves c px for the first px past an end. */
export const BAND_C = 0.55;

/**
 * The rubber band: how far the content moves for `x` px of wheel past an end, in a viewport `d` px tall,
 * `f(x) = (1 - 1/(x·c/d + 1))·d`. It starts at slope `c` (0.55: a notch past the end moves 5.5 of its 10px), it is
 * always shorter than the push, and it never reaches `d` however hard it is pushed. `x` is the raw overscroll, so a
 * notch further past the end moves less than the one before it; a notch back inside the content is the wheel's own.
 */
export const rubber = (x: number, d: number, c = BAND_C): number =>
  x <= 0 || d <= 0 ? 0 : (1 - 1 / ((x * c) / d + 1)) * d;

/** What a frame says about a node that may leave: whether it is mounted this frame, and whether it is on its way out. */
export interface Shown {
  readonly mounted: boolean;
  readonly closing: boolean;
}

/**
 * A node that leaves. `when` false keeps it mounted while its exit tracks run — `exit` seconds of it — and then unmounts
 * it; `when` true again during the exit revives it, and since the tracks retarget from what they present it does not
 * jump. The exit is `exit` seconds, not "until the tracks settle": the tracks are the page's, and a spring's settle time
 * is not a number the presence could hold. A page makes them agree by settling inside `exit` (the Dialog's 0.2s exits
 * inside a 0.35s presence, which is what its 32px blur needs). Under reduced motion, or with `exit` 0, it unmounts on the
 * falling edge.
 *
 * `update` is called once a frame from the page's tick, before the tree is declared; the page keeps the two booleans in
 * its own signal, because whether a node is in the tree is Solid's business, not this file's.
 */
export function presence(when: boolean, exit = 0.3): { update(when: boolean, dt: number): Shown } {
  let mounted = when;
  let closing = false;
  let left = 0;
  return {
    update(next, dt) {
      if (next) {
        mounted = true;
        closing = false;
        return { mounted, closing };
      }
      if (!mounted) return { mounted, closing };
      if (!closing) {
        // the frame it closes on is the exit's first: the page retargets there, so it is drawn at the start of it
        closing = true;
        left = reducedMotion ? 0 : exit;
        if (left <= 0) (mounted = false), (closing = false);
        return { mounted, closing };
      }
      left -= dt;
      if (left <= 0) (mounted = false), (closing = false);
      return { mounted, closing };
    },
  };
}

/**
 * The page's per-frame write of animated numbers into a style's value channel: `write` is `ui.value` (id, field, value),
 * and the result takes one element's fields at t. A page's `View.tick` is then one call per element rather than a loop
 * over its fields. A field given as a number rather than a track is written as it is — a flag that is on for the length
 * of an exit, say.
 */
export function channel(write: (id: Uint8Array, field: number, value: number) => void) {
  return (id: Uint8Array, at: number, ...fields: readonly (readonly [number, Track | number])[]): void => {
    for (const [field, v] of fields) write(id, field, typeof v === "number" ? v : v.at(at).x);
  };
}
