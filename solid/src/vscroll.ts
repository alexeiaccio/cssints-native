// A page's own scroll: one motion track (src/motion.ts) owns the offset and the page writes it into Clay's clip
// element every frame, instead of letting Clay's scroll containers move it (`ui.autoScroll(false)`). The wheel accumulates
// 10px notches for the next tick, a burst flings, a press inside the viewport drags it 1:1 (and a press that travels past
// 4px is not a click), and a release hands the speed of the last frames to a decay. Past an end the same `rubber` resists
// wheel and drag, and the band lets go 80ms after the last notch (or at once on a key) and springs back to the clamp.
//
// The machine is one axis, instantiated twice: `scroll()` always has the page's y axis and gets an x one when the page
// describes horizontal content (`across`). Both run the same code over the same state (the wheel's notches, the burst, the
// band, the fling) with one coordinate swapped, so there is one scroll behaviour, not two: the notches are positive down or
// right, `place` resists past either end, and a drag's own axis is the pointer's y or x. The clock and the bars' fade are
// the machine's, shared: both bars come up while either axis moves and go down 600ms after both stop.
//
// The scrollbar is here too: `barOf` is its geometry (a pure function, so a test can check it against the formula), and
// with a `bar` id the machine writes the thumb's box and its fade every frame into the value channel. The thumb is a
// float attached to the viewport (`css.float({ parent: <the viewport's id> })`), so Clay positions it from the viewport's
// own box: it is a sibling of the scrolling content, sits over it, and does not travel with the clip's childOffset. It
// fades in while the offset moves and out 600ms after it stops; a press on it (only while it is visible: the float
// captures the press then, and passes it through when it is invisible) drags it, mapping the thumb's travel to the
// offset's 1:1, and the wheel and the keys move it as the offset moves because it is drawn from the offset. The vertical
// thumb's size is max(24, view²/content) of the viewport's height, its top is the offset's place of the travel; the
// horizontal one is the same turned: a width of the viewport's width, a left of the offset's place. A page with both
// (`across`) takes 6px off the vertical thumb's travel (the horizontal bar and its inset), so the two bars meet at the
// corner and do not overlap.
//
// A touch is a pointer too. The host passes a flag for a finger (SDL's finger events), and a finger's 4px click threshold
// is 0: a touch drag starts at once (a finger has no mouse's precision), while a touch press that never moves is still a
// click (the pointer travelled no distance at all).
//
// Sky's feed and the List's viewport are this machine. What stays with a page is where its content ends (its own last box,
// its own padding), its keys, and what a key reveals: Sky moves the offset by 40px a Down, the List moves the selection a
// row and then asks the track for the offset that shows it (the reveal, measured from the content's own place, so it works
// while the track is still travelling). The wheel's 10px, the drag's 1:1 and the band's f(x) are the same on every axis.
import { ui } from "./ffi.ts";
import { decay, effect, reduced, rubber, spatial, track, type Decay, type Sample, type Spring } from "./motion.ts";
import { FIELDS } from "./pack.ts";

const SPRING = spatial(); // a retarget: 0.35s, no bounce
const BAND_BACK = spatial(0.35, 0.1); // the band lets go with a light bounce, and settles exactly on the clamp
const BAND_HOLD = 0.08; // seconds without a notch before the band lets go
const DRAG_SLOP = 4; // px of travel: past it the press was a drag, and the element under it is not clicked on release
const FLING_FRAMES = 5; // the last frames' positions the release's speed is estimated from
const FLING_MIN = 1 / 120; // s: a span shorter than this is one frame's jitter, not a speed
const BAND_EPS = 0.01; // px: less past an end than this is the clamp's own float noise, not a band
const THUMB_MIN = 24; // px: the thumb never shrinks below this ...
const THUMB_HOLD = 0.6; // ... s of rest before it starts to fade out ...
const THUMB_FADE = effect(0.15); // ... and s of the fade itself (a colour, so `effect`: clamped, no overshoot)
const CROSS = 6; // px: the other bar's 4px and its 2px inset, which a bar's travel leaves free when a page has both

/** A bar's box along its axis, in the viewport's own coordinates: the start (a top or a left) and the size (a height or a
 *  width). */
export interface Bar {
  readonly start: number;
  readonly size: number;
}

/**
 * The bar of a viewport `view` px long over `content` px of content, at `offset` (positive down or right), or null when
 * the content fits: its size is max(24, view²/content) — the fraction of the content a screenful is, and never shorter than
 * a target one can hit — and the offset's 0..(content - view) goes over the bar's travel, `start = offset/(content -
 * view)·(view - reserve - size)`. `reserve` is the far end another bar takes (the horizontal one's 4px off the vertical
 * one's travel), so two bars of one viewport meet and do not overlap. Its cross-axis size, its inset and its colour are the
 * page's style.
 */
export function barOf(content: number, view: number, offset: number, reserve = 0): Bar | null {
  if (!(content > view) || !(view > 0)) return null;
  const size = Math.max(THUMB_MIN, (view * view) / content);
  const max = content - view;
  const travel = Math.max(0, view - reserve - size);
  return { start: (Math.min(Math.max(offset, 0), max) / max) * travel, size };
}

/** The vertical thumb of an earlier spelling: its height and the distance of its top from the viewport's own top. */
export function thumbOf(content: number, view: number, offset: number): { top: number; height: number } | null {
  const bar = barOf(content, view, offset);
  return bar && { top: bar.start, height: bar.size };
}

/** Sky's feed, the List's viewport: its horizontal content end, when the page has one. */
export interface Across {
  /** How far the viewport can scroll sideways this frame, positive right (0 when it fits). */
  readonly max: () => number;
  /** The element id of the horizontal thumb, if the page declares one. */
  readonly bar?: string;
}

/** A page's scroll over the clip element `id`: the wheel, a drag, a band and a fling on one track, on one axis or two. */
export interface Scroll {
  /** The clock the track is given (seconds); a page's other motion can share it, so one frame is one instant. */
  readonly now: number;
  /** The wheel: 10px a notch on the axis the delta is (dy down the y axis, dx right along the x one), accumulated for the
   *  next tick. Both axes are fed: a page with no horizontal content ignores dx. */
  wheel(dx: number, dy: number): void;
  /** The page's `onPress` landed inside the viewport: the next pointer call grabs the vertical offset. */
  press(): void;
  /** The page's `onPress` landed on the vertical scrollbar's thumb: the next pointer call drags the thumb, not the
   *  content. A thumb that is not visible (the content fits, or it has faded out) does not grab: the press was the page's. */
  thumb(): void;
  /** The same for the horizontal thumb. With no `Across` the page declares none and this does nothing. */
  thumbX(): void;
  /**
   * The host's pointer once a frame: a press inside the viewport grabs the vertical offset, a held pointer drags it, a
   * release hands it to the fling (or to the band at an end). A press elsewhere leaves it alone. `touch` says the pointer
   * is a finger's: a touch drag starts at once (no 4px slop), a touch that does not move still clicks.
   */
  pointer(x: number, y: number, down: boolean, touch?: boolean): void;
  /** A key's target on the vertical axis: retargets the track (animated; at once under reduced motion), clamped, and drops
   *  the band and any fling. */
  seek(to: number): void;
  /** One tick: the wheel and a key retarget, the band lets go, the fling clamps, the offsets go to Clay, and the
   *  scrollbars (when the page gave them) are written. */
  tick(dt: number): void;
  /** Where the vertical track is going, positive down and clamped: what a key's reveal measures from. */
  target(): number;
  /** The vertical scrollbar's opacity as the last tick wrote it (0..255): 0 at rest, 255 while the offset moves. */
  readonly alpha: number;
  /** The pointer holds the vertical offset, and the press travelled past the click threshold (so it is not a click). */
  readonly held: boolean;
  readonly dragged: boolean;
}

/** What one axis's tick needs from the machine besides its own state. */
interface AxisOptions {
  readonly x: boolean; // this axis is horizontal
  readonly id: string;
  readonly max: () => number;
  readonly bar?: string;
  readonly reserve: number; // px of the far end this axis's bar leaves free
  readonly clock: () => number; // the machine's shared clock
}

/** One axis of the machine: every rule above, in one coordinate (positive down, or right). */
interface Axis {
  wheel(dx: number, dy: number): void;
  press(): void;
  thumb(): void;
  pointer(x: number, y: number, down: boolean, touch?: boolean): void;
  seek(to: number): void;
  /** The wheel, a key and the fling at the current clock (before it moves): the retargets of this frame. */
  advance(dt: number): void;
  /** After the clock moved: the offset goes to Clay, and the bar's rest follows what the track presented. */
  frame(dt: number): void;
  /** After the clock moved: the bar's box and the shared fade's alpha into the value channel. */
  writeBar(alpha: number): void;
  target(): number;
  /** Seconds since the offset last moved, which holds the bars up while it is under THUMB_HOLD. */
  readonly rest: number;
  readonly alpha: number;
  readonly held: boolean;
  readonly dragged: boolean;
}

/** One axis's state and rules over a page's clip element. Two of these are a `scroll`. */
function axis(opts: AxisOptions): Axis {
  const { x: across, id } = opts;
  const barId = opts.bar === undefined ? undefined : Buffer.from(opts.bar);
  const clock = opts.clock;
  let anim = track(0, SPRING);
  let fling: Decay | null = null;
  let notches = 0; // the wheel's notches since the last tick, positive down/right (a notch is 10px)
  let notchDir = 0; // the last notch's direction: a fling only continues that way
  let burst = 0; // how many notches have come without a tick between them: one notch is a step, two are a flick
  let chasing = false; // the last tick had a notch, so this one decides whether a fling follows
  let target = 0; // where the track is going: the wheel's, clamped, plus the rubber band at an end
  let want = 0; // the wheel's own target before the clamp: past an end it feeds the band
  let band = 0; // raw px past an end (positive past the far end, negative past the start): 0 is not over-scrolled
  let idle = 0; // seconds since the last notch, for the band's hold
  let maxWas = -1; // the content's clamp last frame: a changed one is a shorter page, and is clamped hard
  let keyed = false;
  // The drag is direct manipulation: a press inside the viewport grabs it, and while the pointer holds it the offset is
  // the press point's offset less the pointer's own travel — no track between them, so a drag lags nothing. Past an end
  // the same `rubber` resists it as the wheel's pull. A press that travels past DRAG_SLOP is a drag and not a click.
  let held = false; // the pointer holds the offset
  let pressed = false; // a press landed inside the viewport (the page's `onPress`), and this frame grabs it
  let dragX = 0; // the offset the pointer presents while it holds the page
  let grabFrom = 0; // the offset when it grabbed, and ...
  let grabX = 0;
  let grabY = 0; // ... the pointer's x and y there: the drag is 1:1 from this pair
  let dragSlop = DRAG_SLOP; // px of travel past which the press is a drag: 0 for a finger (it drags at once)
  let dragMoved = false; // the press passed the slop: the element under it is not clicked on release
  let trail: { t: number; x: number }[] = []; // the last frames' (clock, offset) while held
  // The scrollbar's drag: a press on the thumb (the page's `onPress` there) holds it, and the pointer's travel along the
  // axis moves the thumb by the same distance, which is the offset's travel over (view - thumb). A press keeps the place
  // on the thumb it landed on, as a native scrollbar's does: the thumb does not jump under the finger.
  let thumbWant = false; // a press landed on the visible thumb this frame, and this frame grabs it
  let thumbHeld = false;
  let thumbX = 0; // the offset the thumb presents while it holds it
  let thumbFrom = 0; // the offset when it grabbed, and ...
  let thumbGrab = 0; // ... the pointer's coordinate there
  let thumbMoved = false;
  let rest = THUMB_HOLD; // seconds since the offset last moved (at rest: no thumb on the first frame)
  let was = 0; // the presented offset at the last tick
  let alpha = 0; // the bar's opacity the last tick wrote

  const clamp = (v: number, m: number) => Math.min(Math.max(v, 0), m);
  /** The pointer's coordinate this axis reads: y for the vertical, x for the horizontal. */
  const pos = (px: number, py: number) => (across ? px : py);
  /** The viewport's extent along this axis: the rubber band's `d`. */
  const view = () => ui.bounds(Buffer.from(id))?.[across ? 2 : 3] ?? 0;

  /** Where the wheel's own target sits: clamped to the content, and past an end the band's resistance (`rubber` in
   *  motion.ts, Rune's f(x) = (1 - 1/(x·c/d + 1))·d, c = 0.55). Sets `band` to the raw overscroll it was given. */
  const place = (w: number, m: number): number => {
    const c = clamp(w, m);
    band = reduced() ? 0 : w - c; // reduced motion has no band: the wheel is clamped hard
    return band ? c + Math.sign(band) * rubber(Math.abs(band), view()) : c;
  };

  /** Where the scroll is at t: the drag that holds it, the thumb while a press holds that, the fling, the spring. */
  const presented = (t: number): Sample =>
    held
      ? { x: dragX, v: 0, done: false }
      : thumbHeld
        ? { x: thumbX, v: 0, done: false }
        : fling
          ? fling.at(t)
          : anim.at(t);

  /** Starts a segment at t from a presented (x, v), so position and velocity are continuous across a retarget. */
  const restart = (p: { x: number; v: number }, t: number, to: number, s: Spring = SPRING) => {
    anim = track(p.x, s, t);
    anim.v0 = p.v;
    anim.retarget(t, to, s); // samples the (x, v) above and starts the new segment from it
    fling = null;
  };

  /** The wheel: 10px a notch on this axis, accumulated for the next tick (positive down or right). */
  const wheel = (dx: number, dy: number) => {
    if (held || thumbHeld) return; // the finger is the offset's: a wheel under it is not a scroll
    const n = -(across ? dx : dy);
    if (n) (notches += n), (notchDir = Math.sign(n));
  };

  /** The speed the last frames carry at the release, px/s positive down/right: the last `FLING_FRAMES` samples' offsets
   *  over their span. A span under `FLING_MIN` is one frame's jitter and not a speed (Rune's rule: no single spikes). */
  const speed = (): number => {
    const last = trail[trail.length - 1];
    const first = trail[Math.max(0, trail.length - FLING_FRAMES)];
    if (!last || !first) return 0;
    const dt = last.t - first.t;
    return dt < FLING_MIN ? 0 : (last.x - first.x) / dt;
  };

  /** The pointer moves the grab: the offset follows it from the press point, resisted at the ends as the wheel is. */
  const dragTo = (px: number, py: number, t: number) => {
    dragX = place(grabFrom - (pos(px, py) - pos(grabX, grabY)), opts.max());
    if (!dragMoved && Math.hypot(px - grabX, py - grabY) > dragSlop) dragMoved = true;
    trail.push({ t, x: dragX });
    if (trail.length > FLING_FRAMES) trail.shift();
  };

  /** The release: the drag stops being the offset's owner, and what follows starts from where the finger left it. */
  const release = (px: number, py: number, t: number) => {
    held = false;
    dragTo(px, py, t); // the release's own point counts: the pointer may have moved into it
    const m = opts.max();
    const end = clamp(dragX, m);
    const v = reduced() || !dragMoved || band ? 0 : speed();
    trail = [];
    fling = null;
    if (band) {
      // past an end: the band lets go on the next tick, from where the finger left it, and settles on the clamp
      anim = track(dragX, SPRING, t);
      want = dragX;
      target = end;
      idle = BAND_HOLD;
      return;
    }
    if (!v) {
      // a click (no travel), no speed, or reduced motion: the offset stops where the finger left it, clamped
      anim = track(end, SPRING, t);
      want = target = end;
      return;
    }
    const d = decay(dragX, v, t);
    const raw = d.project();
    const land = clamp(raw, m);
    want = target = land;
    if (land === raw) fling = d;
    else restart({ x: dragX, v }, t, land);
  };

  /** The pointer's coordinate on the thumb at t: what the press kept, so the drag starts from where it landed (a press in
   *  the thumb's middle drags from its middle). */
  const grabThumb = (p: number, t: number) => {
    const m = opts.max();
    // the offset the thumb presents now, before `thumbHeld` is set (or `presented` would give the drag's own 0)
    thumbFrom = thumbX = clamp(presented(t).x, m);
    thumbGrab = p;
    thumbMoved = false;
    anim = track(thumbX, SPRING, t);
    fling = null;
    pressed = false;
    notches = 0;
    chasing = false;
    keyed = false;
    band = 0;
    idle = 0;
  };

  /** The pointer moves the thumb: the offset follows the thumb's own travel, so the drag is 1:1 on the bar and the offset
   *  covers the content's whole range over the thumb's travel. It clamps at both ends: a scrollbar has no band. */
  const dragThumb = (p: number, t: number) => {
    const m = opts.max();
    const v = view();
    const box = barOf(m + v, v, 0, opts.reserve);
    const travel = box ? Math.max(0, v - opts.reserve - box.size) : 0;
    thumbX = !box || travel <= 0 ? thumbFrom : clamp(thumbFrom + ((p - thumbGrab) * m) / travel, m);
    if (p !== thumbGrab) thumbMoved = true;
    anim = track(thumbX, SPRING, t); // the release starts from here, so the track is kept in step while the thumb holds it
  };

  /** The host's pointer, once a frame: a press inside the viewport grabs it, a held pointer drags the offset, a release
   *  hands it to the fling (or to the band at an end). A press elsewhere leaves it alone. A press the page reported on the
   *  thumb (`thumb()`) grabs the thumb instead, and the content's own press is dropped. */
  const pointer = (px: number, py: number, down: boolean, touch = false) => {
    const t = clock();
    if (!down) {
      pressed = thumbWant = false;
      if (held) release(px, py, t);
      if (thumbHeld) {
        // the bar stops where it is: no fling (a scrollbar is not a throw), and the track takes the value as its target
        thumbHeld = false;
        want = target = clamp(thumbX, opts.max());
      }
      return;
    }
    if (thumbWant) {
      thumbWant = false;
      grabThumb(pos(px, py), t); // before `thumbHeld`: the thumb's drag starts from the offset the track presents
      thumbHeld = true;
      return;
    }
    if (pressed) {
      // the press was inside the viewport: grab it where it is, so the frame it lands on shows the offset it had (the
      // sample is taken before `held`, or it would be the last drag's own `dragX`)
      pressed = false;
      const from = clamp(presented(t).x, opts.max());
      held = true;
      grabX = px, grabY = py;
      grabFrom = dragX = from;
      dragSlop = touch ? 0 : DRAG_SLOP;
      dragMoved = false;
      trail = [{ t, x: dragX }];
      // a glide or a fling under the finger stops, and the band has no hold: the pointer owns the offset from here
      fling = null;
      notches = 0;
      chasing = false;
      keyed = false;
      idle = 0;
      band = 0;
      return;
    }
    if (held) dragTo(px, py, t);
    else if (thumbHeld) dragThumb(pos(px, py), t);
  };

  /** A key's target, as the wheel's own: the track eases to it, it does not jump (and under reduced motion it lands at
   *  once), and it comes back to the content first — a key is not the wheel, so the band lets go. */
  const seek = (to: number) => {
    if (thumbHeld) return; // the pointer owns the bar's offset
    want = clamp(to, opts.max());
    keyed = true;
  };

  /** One tick's retargets, before the clock moves: the wheel and the keys, the release may fling, the band lets go. */
  const advance = (dt: number) => {
    const t = clock();
    const m = opts.max();
    if (held || thumbHeld) {
      // the pointer owns the offset: this tick only writes it — a band cannot let go under the finger, and no notch or
      // key retargets the track until the release
      maxWas = m;
      return;
    }
    const n = notches;
    notches = 0;
    const key = keyed;
    keyed = false;
    idle = n ? 0 : idle + dt;
    if (!band) want = clamp(want, m);
    target = clamp(target, m);
    // A shorter page (a feed switch) must not leave the offset past the new end — its content would not fill the
    // viewport — so a clamp that moved is hard. A band past an end, and its spring back, are on purpose: those are the
    // tracks'.
    const shrank = Math.abs(m - maxWas) > 0.01;
    maxWas = m;
    const before = presented(t);
    if (shrank && (before.x < 0 || before.x > m)) {
      const v = clamp(before.x, m);
      restart({ x: v, v: 0 }, t, v);
      target = want = v;
    }
    if (n) {
      burst += Math.abs(n);
      want += n * 10;
      const p = presented(t);
      const to = place(want, m);
      // a notch past an end is a pull of the edge, not a scroll of the content: once the content has arrived at the end
      // it is pushed past (or is already over it), the band is where the wheel puts it on this tick. A notch that only
      // reaches the end while the content is still travelling there is a scroll like any other: a snap would jump it.
      const pull = band !== 0 && (n > 0 ? p.x >= m - 0.5 : p.x <= 0.5);
      target = to;
      if (pull) (anim = track(to, SPRING, t)), (fling = null);
      else {
        restart(p, t, to);
        // a notch from rest starts with the velocity a critically damped spring needs to glide the 10px without
        // overshoot (ω·d): the offset moves on the first frame and each frame after it moves less. A notch during a
        // burst keeps the presented velocity, so the steps grow with the accumulated target. Reduced motion has no
        // glide: its retarget has already landed on the target, and a velocity here would send it past (and back).
        if (!reduced() && Math.abs(p.v) < 1) anim.v0 = SPRING.omega * (to - p.x);
      }
      chasing = true;
    } else if (key) {
      // a key drops the band and retargets the same track
      chasing = false;
      burst = 0;
      want = clamp(want, m);
      band = 0;
      target = want;
      restart(presented(t), t, target);
    } else if (chasing) {
      chasing = false;
      const p = anim.at(t);
      // a fling only for a burst (a flick, not one notch) whose presented velocity still follows the wheel — and not at
      // all over an end: a stroke that ends past one is a band's pull, and it lets go on the band's own clock. Reduced
      // motion has no throw either: the notches' own target is where it stops.
      if (!reduced() && !band && burst >= 2 && Math.abs(p.v) > 10 && Math.sign(p.v) === notchDir) {
        const d = decay(p.x, p.v, t);
        const raw = d.project();
        const land = clamp(notchDir > 0 ? Math.max(raw, target) : Math.min(raw, target), m);
        // inside the content: the decay runs to its projection. Past an end (or short of the wheel's target): a spring
        // from the presented (x, v) to the clamped end.
        if (land === raw) (fling = d), (target = land);
        else restart(p, t, land), (target = land);
        // the throw's landing is where the wheel's next notch counts from, as its target always was
        want = land;
      }
      burst = 0;
    } else if (fling) {
      const d = fling.at(t);
      if (d.done) restart({ x: d.x, v: 0 }, t, d.x), (target = want = d.x);
      else if (d.x < 0 || d.x > m) {
        const v = clamp(d.x, m);
        restart({ x: v, v: 0 }, t, v), (target = want = v);
      }
    }
    // the wheel has stopped past an end: the band lets go, from what it presents, and settles exactly on the clamp
    if (band && !chasing && idle >= BAND_HOLD) {
      want = clamp(want, m);
      band = 0;
      target = want;
      restart(presented(t), t, target, BAND_BACK);
    }
  };

  /** After the clock moved: the offset goes on Clay's clip element, and the bar's rest follows what the track presented.
   *  The offset is clamped to the content as always, and past an end written as it is (the band's own value, and the first
   *  frames of its way back): only the page knows how far past the end it is. The 0.01px is the boundary's own float noise
   *  (a clamp the layout computed a hair past): a settled value is written through `scrollTo`, so a page at rest is the
   *  exact integer the stored frames have always been. */
  const frame = (dt: number) => {
    const x = presented(clock()).x;
    const m = opts.max();
    const put = x < -BAND_EPS || x > m + BAND_EPS;
    if (across) {
      if (put) ui.scrollPutX(id, -x);
      else ui.scrollToX(id, -x);
    } else if (put) ui.scrollPut(id, -x);
    else ui.scrollTo(id, -x);
    // the fade: the thumb is up while the offset moves — the track's own settle, so a spring's tail counts as moving, and
    // a frame that moved at all, which under reduced motion is the jump itself — and it goes down 600ms after the last
    // frame that did. The bar's own axis knows it here; the machine's tick fades both bars from the two rests.
    if (barId) (rest = presented(clock()).done && Math.abs(x - was) <= 0.01 ? rest + dt : 0), (was = x);
  };

  /** The scrollbar: the thumb's box from the presented offset and its fade, written into the value channel for the frame
   *  about to be declared. Five numbers along the axis: a FIXED length is its min and max (ui.c's `axis`), the float's
   *  offset (y, or x) is the thumb's start, the background's alpha is the fade, and a visible thumb captures the press (a
   *  press on an invisible one is the page's: the fade decides, one frame late, which is a frame of a 0.15s fade). */
  const writeBar = (fade: number) => {
    if (!barId) return;
    const p = presented(clock());
    const v = view();
    const box = barOf(opts.max() + v, v, p.x, opts.reserve);
    alpha = box ? fade : 0;
    const size = box ? box.size : 0;
    if (across) {
      ui.value(barId, FIELDS.WIDTH + 1, size);
      ui.value(barId, FIELDS.WIDTH + 2, size);
      ui.value(barId, FIELDS.OFFSET_X, box ? box.start : 0);
    } else {
      ui.value(barId, FIELDS.HEIGHT + 1, size);
      ui.value(barId, FIELDS.HEIGHT + 2, size);
      ui.value(barId, FIELDS.OFFSET_Y, box ? box.start : 0);
    }
    ui.value(barId, FIELDS.BACKGROUND_ALPHA, alpha);
    ui.value(barId, FIELDS.CAPTURE, alpha >= 128 ? 0 : 1);
  };

  return {
    wheel,
    press: () => (pressed = true),
    thumb: () => {
      // an invisible thumb is not there to grab: the press belongs to the page under it
      if (barId && alpha >= 128) thumbWant = true;
    },
    pointer,
    seek,
    advance,
    frame,
    writeBar,
    target: () => clamp(want, opts.max()),
    get rest() {
      return rest;
    },
    get alpha() {
      return alpha;
    },
    get held() {
      return held;
    },
    get dragged() {
      return (held && dragMoved) || (thumbHeld && thumbMoved);
    },
  };
}

/**
 * The scroll of the clip element `id`. `max` is the page's content end this frame, positive down (0 when it fits): the
 * page computes it from its own last box and the viewport, so no rule of it lives here. `bar` is the element id of the
 * page's vertical thumb (a float on `id`): with one, the machine writes its height, its top and its opacity every frame,
 * and it needs nothing else from the page. `across` adds the horizontal axis (its own content end and, if the page
 * declares one, its thumb), which turns the horizontal bar on and shortens the vertical one's travel by its 4px.
 */
export function scroll(id: string, max: () => number, bar?: string, across?: Across): Scroll {
  let clock = 0; // seconds, the clock both axes and a page's other motion are given
  const y = axis({ x: false, id, max, bar, reserve: across ? CROSS : 0, clock: () => clock });
  const x =
    across === undefined ? undefined : axis({ x: true, id, max: across.max, bar: across.bar, reserve: 0, clock: () => clock });
  // The bars' fade is the machine's: one opacity for both, so a page with two bars shows and hides them together.
  const fade = track(0, THUMB_FADE);
  let fadeTo = 0;
  let alpha = 0;

  /** One tick: the two axes retarget (on the same clock), then it moves once, the offsets go to Clay, and the bars are
   *  written from the one fade. A page with no horizontal axis still clears the clip's x offset: Clay keeps a scroll
   *  container's x across frames, and the id can outlive a page in one process. */
  const tick = (dt: number) => {
    y.advance(dt);
    x?.advance(dt);
    clock += dt;
    y.frame(dt);
    if (x) x.frame(dt);
    else ui.scrollToX(id, 0);
    const up = y.rest < THUMB_HOLD || (x !== undefined && x.rest < THUMB_HOLD);
    if ((up ? 255 : 0) !== fadeTo) fade.retarget(clock, (fadeTo = up ? 255 : 0));
    const fadeAt = fade.at(clock).x;
    y.writeBar(fadeAt);
    x?.writeBar(fadeAt);
    alpha = y.alpha;
  };

  return {
    get now() {
      return clock;
    },
    wheel: (dx: number, dy: number) => (y.wheel(dx, dy), x?.wheel(dx, dy)),
    press: y.press,
    thumb: y.thumb,
    thumbX: () => x?.thumb(),
    pointer: (px: number, py: number, down: boolean, touch = false) => (y.pointer(px, py, down, touch), x?.pointer(px, py, down, touch)),
    seek: y.seek,
    tick,
    target: y.target,
    get alpha() {
      return alpha;
    },
    get held() {
      return y.held;
    },
    get dragged() {
      return y.dragged || (x?.dragged ?? false);
    },
  };
}
