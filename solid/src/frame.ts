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
   * The pointer this frame, once, before the tree is declared: `down` is the button. A page that drags keeps its own
   * flag (`onPress` sets it, `down` false clears it) and follows x while it holds.
   */
  onPointer?: (x: number, y: number, down: boolean) => void;
  /** A press (the button going down) that no element with `onPress` was under: a click on empty space. */
  onPressMiss?: () => void;
  /** Each frame pushes its nanoseconds: [events and Solid's flush, the tree declared, layout, draw]. */
  stats?: [number, number, number, number][];
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
      ui.text(bytesOf(el), (style && variant(style, view.theme).text) || WHITE_14);
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
  return (px: number, py: number, down: boolean, dt: number, render = true): number => {
    const t0 = Bun.nanoseconds();
    ui.begin(px, py, down ? 1 : 0, dt);
    events(down, px, py);
    view.onPointer?.(px, py, down);
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
