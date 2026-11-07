// One frame: the pointer goes in, events run (and Solid updates the JS tree), then the whole tree is declared to
// Clay again, in order, and Clay lays out and draws it. Clay is immediate mode, so Solid only keeps the tree.
import { flush } from "solid-js";

import { ui } from "./ffi.ts";
import { hasStates, packText, STYLE_FIELDS, variant, type State } from "./pack.ts";
import { El, Txt } from "./renderer.ts";

const encoder = new TextEncoder();
const ids = new Map<string, Uint8Array>();
// kept for good: Clay holds the id's pointer in its hash map past the frame
const idBytes = (id: string) => ids.get(id) ?? (ids.set(id, encoder.encode(id)), ids.get(id)!);
// an image path, encoded once: ui.c interns it, so the same bytes and the same address every frame
const paths = new Map<string, Uint8Array>();
const pathBytes = (path: string) => paths.get(path) ?? (paths.set(path, encoder.encode(path)), paths.get(path)!);

const NONE: State[] = [];
const HOVER: State[] = [":hover"];
const ACTIVE: State[] = [":active"];
const NO_STYLE = new Float32Array(STYLE_FIELDS);
const WHITE_14 = packText({ textColor: { r: 255, g: 255, b: 255, a: 255 }, fontSize: 14 });

interface Cached {
  str: string;
  bytes: Uint8Array;
}
const encoded = new WeakMap<El, Cached>();
/** The text of a `text` element as UTF-8, encoded again only when it changed. */
function bytesOf(el: El): Uint8Array {
  let str = "";
  for (const c of el.children) if (c instanceof Txt) str += c.text;
  let cached = encoded.get(el);
  if (!cached || cached.str !== str) encoded.set(el, (cached = { str, bytes: encoder.encode(str) }));
  return cached.bytes;
}

export interface View {
  /** The theme of the styles (`"light"`), or none for the base. */
  theme?: string;
  /**
   * The pointer this frame, once, before the tree is declared: `down` is the button, `touch` says the pointer is a
   * finger's (a mouse and a finger are one pointer). A page that drags keeps its own flag (`onPress` sets it, `down`
   * false clears it) and follows x while it holds.
   */
  onPointer?: (x: number, y: number, down: boolean, touch: boolean) => void;
  /** A press (the button going down) that no element with `onPress` was under: a click on empty space. */
  onPressMiss?: () => void;
  /** The wheel the host polled since the last frame, before this one: SDL's delta, positive y away from the user. */
  onWheel?: (dx: number, dy: number) => void;
  /** Called once a frame with the elapsed seconds, after the frame's events and before the tree is declared: a page's
   *  motion ticks here, so a headless frame (dt = 1/60) and a window frame (the real dt) take the same path. */
  tick?: (dt: number) => void;
  /** Each frame pushes its nanoseconds: [events and Solid's flush, the tree declared, layout, draw]. */
  stats?: [number, number, number, number][];
}

/** A frame: the pointer (x, y, the button, and whether it is a finger's), the elapsed seconds, whether to draw, and the
 *  touch flag again for the page (the drawer passes it through). */
export type Frame = (
  px: number,
  py: number,
  down: boolean,
  dt: number,
  render?: boolean,
  touch?: boolean,
) => number;

/**
 * A frame loop's draw decision. The frame is declared and laid out every iteration — that is what a page's tick reads
 * and writes, and it catches a timer or a track — but `ui_draw` runs only when the packed frame changed (`ui_hash`)
 * or the iteration carried a discrete input (a key, typed text, a press or release, a wheel): at rest it draws and
 * presents nothing, so a static page costs a layout and no pixels. A pointer move is not by itself an input here: it
 * draws through the hash when it changes a hover, and not at all once the hover has settled. Returns whether it drew.
 *
 * `stats` is the view's own (`View.stats`): the draw is this loop's, not `frame`'s, so its time is written into the last
 * frame's entry — a panel that reads the phases then has a draw to show.
 */
export function createDrawer(frame: Frame, stats?: View["stats"]) {
  let last: bigint | undefined;
  return (px: number, py: number, down: boolean, dt: number, discrete = false, touch = false): boolean => {
    frame(px, py, down, dt, false, touch);
    const hash = ui.hash();
    const draw = discrete || hash !== last;
    last = hash;
    if (draw) {
      const t = Bun.nanoseconds();
      ui.draw();
      const entry = stats?.[stats.length - 1];
      if (entry) entry[3] = Bun.nanoseconds() - t;
    }
    return draw;
  };
}

/**
 * The frame function of a tree. `onClick` of an element with an `id` runs on release over it, when the press was on
 * it too; `onPress` runs when the button goes down over it (a browser focuses on mousedown); both are called with the
 * pointer's x and y (a slider's rail reads where on it the press was). A style with `:hover` or
 * `:active` needs an `id` as well, to ask Clay where the pointer is; `:focus` applies while the prop `focused` is true.
 */
export function createFrame(root: El, view: View = {}) {
  let clickable: El[] = []; // the elements with onClick or onPress, as the last frame declared them
  let seen: El[] = [];
  let pressed = new Set<El>();
  let wasDown = false;

  const over = (el: El) => ui.over(idBytes(el.props.id));

  // not called `declare`: Bun's TypeScript transpiler drops a call to that name as an ambient declaration
  function emit(el: El, down: boolean) {
    const style = el.props.style;
    if (el.tag === "text") {
      // a text with an id can have its colour moved (the value channel's fields 51..54), so the id goes in with it
      const tid = el.props.id ? idBytes(el.props.id) : undefined;
      ui.text(tid, bytesOf(el), (style && variant(style, view.theme).text) || WHITE_14);
      return;
    }
    const id = el.props.id ? idBytes(el.props.id) : undefined;
    let states = NONE;
    if (id && style && hasStates(style)) {
      states = ui.over(id) ? (down ? ACTIVE : HOVER) : NONE;
      if (el.props.focused) states = [...states, ":focus"];
    }
    if (id && (el.props.onClick || el.props.onPress)) seen.push(el);
    const v = style ? variant(style, view.theme, states) : undefined;
    // an image's path goes in before its element: Clay's image config is a pointer, not a float field
    if (v?.image) ui.image(pathBytes(v.image));
    // ... and so does a shadow: no Clay field holds one, so it rides the renderer's table by the element's id
    const shadow = v?.shadow;
    if (shadow)
      ui.shadow(shadow.x, shadow.y, shadow.blur, shadow.color.r, shadow.color.g, shadow.color.b, shadow.color.a);
    // a backdrop too: the renderer blurs the pixels under the element, before the element's own commands
    if (v?.backdrop) ui.backdrop(v.backdrop.blur);
    // a gradient is a fill, not an effect: it lands in the element's first rectangle, over the shadow and any blurred page
    const gradient = v?.backgroundImage;
    if (gradient) ui.backgroundImage(gradient.kind, gradient.angle, gradient.count, gradient.stops);
    ui.open(id, v?.box || NO_STYLE);
    for (const c of el.children) if (c instanceof El) emit(c, down);
    ui.close();
  }

  function events(down: boolean, px: number, py: number) {
    if (down && !wasDown) {
      const hit = clickable.filter(over);
      pressed = new Set(hit);
      let handled = false;
      for (const el of hit) if (el.props.onPress) (handled = true), el.props.onPress(px, py);
      if (!handled) view.onPressMiss?.();
    } else if (!down && wasDown) {
      const hit = clickable.filter((el) => pressed.has(el) && over(el));
      pressed.clear();
      for (const el of hit) el.props.onClick?.(px, py);
    }
    wasDown = down;
  }

  /** Returns the number of render commands. `render: false` stops after the layout. */
  return (px: number, py: number, down: boolean, dt: number, render = true, touch = false): number => {
    const t0 = Bun.nanoseconds();
    ui.begin(px, py, down ? 1 : 0, dt);
    events(down, px, py);
    view.onPointer?.(px, py, down, touch);
    view.tick?.(dt);
    flush();
    const t1 = Bun.nanoseconds();
    seen = [];
    for (const c of root.children) if (c instanceof El) emit(c, down);
    clickable = seen;
    const t2 = Bun.nanoseconds();
    const commands = ui.end(dt);
    const t3 = Bun.nanoseconds();
    if (render) ui.draw();
    const t4 = Bun.nanoseconds();
    if (view.stats) view.stats.push([t1 - t0, t2 - t1, t3 - t2, t4 - t3]);
    return commands;
  };
}
