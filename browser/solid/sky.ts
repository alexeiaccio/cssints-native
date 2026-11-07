// The Sky page in the browser, on the desktop's own modules: src/renderer.ts (the Solid universal renderer), src/frame.ts
// (one frame: pointer in, events, flush, the tree declared to Clay) and app/Sky.tsx, unmodified. Clay runs in ui.wasm
// (browser/ui.c) through browser/solid/ffi-browser.ts; the commands and the effects beside them (shadows, gradients,
// groups, images) are drawn by browser/draw.js, the same file the no-JS page draws with.
//
// The loop is src/frame.ts's createDrawer: the tree is declared and laid out every iteration, and the canvas is drawn only
// when the frame hash moved or a discrete input came in — a page at rest costs a layout and no pixels, as on the desktop.
// The window's poll is the DOM's: mouse move/down/up, the wheel, and the keys the page's focus manager and its parts take
// (Tab, the arrows, Home/End, PageUp/Down, Escape, Enter, Space).
//
// The page's own data is the app's recorded fixtures (Sky.tsx's Discover/Science/News): a feed of six posts with drawn
// avatars, the gradient cards and their entry. The thread's loader is a promise that never settles — a browser page here
// asks no network, and the check's frames must not depend on one.
import "./globals.ts";

import { size, Sky } from "../../solid/app/Sky.tsx";
import type { Motion } from "../../solid/src/entry.ts";
import { createDrawer, createFrame } from "../../solid/src/frame.ts";
import { createInput } from "../../solid/src/input.ts";
import { El, render } from "../../solid/src/renderer.ts";
import { createSurface, loadFont, readCommands, readEffects } from "../draw.js";
import { bindCanvas, setMeasure, ui, wasm } from "./ffi-browser.ts";

// the page's own size (360x760): the bar, the feed, the status line
const W = size.width, H = size.height;

const canvas = document.getElementById("frame") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const dpr = Math.max(1, window.devicePixelRatio || 1);
canvas.width = W * dpr;
canvas.height = H * dpr;

// An avatar's path is the style's (an absolute path in this checkout): the page serves the repo tree, so the part from
// /examples/ on is its URL. A picture the page cannot fetch is simply not drawn (draw.js's bitmap).
const image = (path: string): string => {
  const at = path.lastIndexOf("/examples/");
  return at >= 0 ? path.slice(at) : path;
};

const surface = createSurface(ctx, { width: W, height: H, dpr, image, onImage: () => paint() });
setMeasure((ptr, len, fontId, fontSize) => surface.measure(wasm, ptr, len, fontId, fontSize));
bindCanvas(ctx, dpr);

await loadFont("../../vendor/fonts/Roboto-Regular.ttf");
if (ui.init(W, H)) throw new Error(`ui_init(${W}, ${H}) failed`);

// the page and the frame, as solid/main.ts wires them: the keys are the focus manager's, the wheel is the page's
const root = new El("root");
const input = createInput();
const motion: Motion = {};
render(() => Sky({ input, motion, theme: () => undefined, load: () => new Promise(() => {}) }), root);
const frame = createFrame(root, {
  onPressMiss: () => input.pressMiss(),
  // the finger's flag is kept for `window.__page.touch`
  onPointer: (x, y, down, finger) => ((touch = finger), motion.onPointer?.(x, y, down, finger)),
  onWheel: (dx, dy) => motion.onWheel?.(dx, dy),
  tick: (dt) => motion.tick?.(dt),
});
const draw = createDrawer(frame);

/** The last frame's commands and effects: what `paint` reads, and what the check reads. */
let commands = readCommands(wasm);
function paint(): void {
  commands = readCommands(wasm);
  surface.draw(commands, readEffects(wasm));
}

// the pointer, as the layout's pixels: the canvas is drawn at W x H CSS pixels, so the only mapping is the element's box
let px = -1, py = -1, down = false;
// ... and whether it is a finger's (src/frame.ts's `touch`): the shell.ts loop keeps the same flag for its pages
let touch = false;
// the finger's events the canvas has taken (`window.__page.touches`): a check waits on it rather than on a guessed time
let touches = 0;
const at = (e: MouseEvent): [number, number] => {
  const box = canvas.getBoundingClientRect();
  return [((e.clientX - box.left) * W) / box.width, ((e.clientY - box.top) * H) / box.height];
};
canvas.addEventListener("mousemove", (e) => {
  [px, py] = at(e);
});
// a press and a release are discrete inputs: the frame runs on the event, not on the next tick, so a quick click cannot
// land two events inside one frame and lose the press (the desktop's loop runs a frame after every poll)
canvas.addEventListener("mousedown", (e) => {
  [px, py] = at(e), (down = true), (touch = false), immediate();
});
canvas.addEventListener("mouseup", (e) => {
  [px, py] = at(e), (down = false), (touch = false), immediate();
});
canvas.addEventListener("mouseleave", () => {
  px = py = -1, down = false, touch = false;
});
// A finger: the pointer events a touchscreen sends, at the same mapping and with the frame's `touch` flag, which is what
// the feed's machine reads for a drag with no click threshold (src/vscroll.ts). `sky.html`'s canvas already has
// `touch-action: none` (the page owns the gesture, not the browser), and a tap's compatibility mouse events are cancelled
// so one tap is one press and one release; the pointer is captured on a press, so a finger that leaves the canvas still
// lifts on it.
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "touch") return;
  e.preventDefault();
  [px, py] = at(e), (down = true), (touch = true), touches++, canvas.setPointerCapture(e.pointerId), immediate();
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType === "touch") [px, py] = at(e), (touch = true), touches++;
});
canvas.addEventListener("pointerup", (e) => {
  if (e.pointerType !== "touch") return;
  [px, py] = at(e), (down = false), (touch = true), touches++, immediate();
});
// the browser took the gesture back (a system edge swipe): it ends where the finger last was, as a release
canvas.addEventListener("pointercancel", (e) => {
  if (e.pointerType === "touch") (down = false), (touch = true), touches++, immediate();
});
// SDL's wheel is ±1 a notch and positive is away from the user (a wheel up); a browser's delta is in pixels and positive
// is a wheel down (the content goes up). So one event is one notch, with the sign turned round — which is what
// `src/vscroll.ts` takes (`n = -dy`, so a wheel down moves the content up), the same as the desktop's `ui_wheel`.
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    ui.wheel(-Math.sign(e.deltaX), -Math.sign(e.deltaY));
    immediate();
  },
  { passive: false },
);

// The keys are DOM names already ("ArrowDown", "Tab", " ", "Escape", "Enter"), which is what the focus manager and the
// parts take (`createInput`'s own names). Tab, the arrows, Space and PageUp/Down would scroll the page instead.
// `n` is the page's own key (the feed's notifications, `Sky.tsx`'s fallback), as the desktop's `keyName` gives a letter
const KEYS = new Set(["Tab", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp",
  "PageDown", "Enter", "Escape", "Backspace", "n"]);
const keys = (down: boolean) => (e: KeyboardEvent) => {
  const name = e.key;
  if (!KEYS.has(name)) return;
  if (down) e.preventDefault();
  // a held key is a repeat only while the focused part has one; a Tab is never a repeat
  if (down) input.down(name, e.repeat && name !== "Tab");
  else input.up(name);
  immediate();
};
window.addEventListener("keydown", keys(true));
window.addEventListener("keyup", keys(false));

/** One frame now, with the real elapsed seconds, as the loop's next iteration would run it. */
function immediate(): void {
  if (!running) return;
  const now = performance.now();
  step(Math.min((now - last) / 1000, 0.1), true);
  last = now;
}

const wheelOut = new Float32Array(2);
const pumpWheel = () => {
  let had = false;
  while (ui.wheelPop(wheelOut)) had = true, motion.onWheel?.(wheelOut[0]!, wheelOut[1]!);
  return had;
};

/** One iteration of the desktop's window loop: the wheel, then the frame; the canvas is drawn when the drawer drew. */
function step(dt: number, discrete = false): boolean {
  pumpWheel();
  const painted = draw(px, py, down, dt, discrete, touch);
  if (painted) paint();
  return painted;
}

// the window loop: a browser's tick is requestAnimationFrame, and its dt is the real elapsed seconds (the first frame
// gets 1/60, as a headless one does)
let last = performance.now();
let running = true;
function tick(): void {
  if (!running) return;
  const now = performance.now();
  step(Math.min((now - last) / 1000, 0.1));
  last = now;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/** What browser/sky-check.mjs drives: the scripted frames solid/main.ts's flags take (`--settle 40`, a wheel, a hover),
 *  the frame as its commands and its effects, the dump, and its ms. Functions, so nothing holds a stale list. */
interface Page {
  warm(n?: number): unknown;
  pointer(x: number, y: number, down: boolean): void;
  touch(): boolean;
  touches(): number;
  offset(): number;
  wheel(notches: number): void;
  commands(): unknown;
  effects(): unknown;
  images(): { path: string; complete: boolean; width: number }[];
  errors(): number;
  shadow(): { near: number[]; far: number[] };
  draws(): number;
  dump(): string;
  pixel(x: number, y: number): number[];
  bench(n?: number): number;
}

declare global {
  interface Window {
    __page: Page;
  }
}

/** A smoke test for the one effect the Sky page has none of — a shadow (`css.shadow`, the Dialog's panel): a white box
 *  with a black shadow 10px to the right of it, blurred by 8, on a scratch canvas. Returns the pixel 4px right of the
 *  shadow's own edge (inside its blur) and one 40px further right (clear of it), as [r, g, b, a]. */
function shadow(): { near: number[]; far: number[] } {
  const canvas = document.createElement("canvas");
  canvas.width = 120, canvas.height = 120;
  const c = canvas.getContext("2d")!;
  const probe = createSurface(c, { width: 120, height: 120, dpr: 1 });
  const box = { type: 1, id: 7, x: 20, y: 20, w: 40, h: 40, color: "#ffffff", alpha: 1,
    radius: [0, 0, 0, 0], border: [0, 0, 0, 0], text: "", fontId: 0, fontSize: 0 };
  probe.draw([box], { shadows: new Map([[7, { x: 10, y: 0, blur: 8, color: [0, 0, 0, 255] }]]), gradients: new Map(),
    groups: [], backdrops: new Map() });
  const at = (x: number, y: number) => Array.from(c.getImageData(x, y, 1, 1).data);
  return { near: at(74, 40), far: at(114, 40) };
}

window.__page = {
  /** N frames at rest at 1/60s with the pointer where it is (the cards' entry settles over ~40). */
  warm(n = 40) {
    for (let i = 0; i < n; i++) step(1 / 60);
    return commands;
  },
  /** The point and the button of the next frames (no frame runs: the loop's next one, or `warm`). */
  pointer(x: number, y: number, isDown: boolean) {
    px = x, py = y, down = isDown;
  },
  /** The last frame's pointer was a finger's (src/frame.ts's `touch`): what a touch event set and a mouse event clears. */
  touch: () => touch,
  touches: () => touches,
  /** The feed's offset this instant, positive down: the page's own scroll (`src/vscroll.ts` writes it on the clip element,
   *  whose offset is negative down), which a drag and a throw move. */
  offset: () => -ui.scrollOffset("sky-feed"),
  /** N wheel notches down over the feed, a frame each: the feed's own track (10px a notch, one a frame is a flick). */
  wheel(notches: number) {
    for (let i = 0; i < notches; i++) {
      ui.wheel(0, -1); // SDL's sign: one notch down is -1, as solid/main.ts's wheel
      step(1 / 60, true);
    }
    return commands;
  },
  commands: () => commands,
  effects: () => readEffects(wasm),
  /** The bitmaps draw.js has asked for: the check waits until they are decoded, so a frame it reads has its avatars. */
  images: () => surface.images(),
  /** The shadow's drawing, on a scratch canvas: no page here (nor the Sensors one) has a shadow. */
  shadow,
  /** The draws the drawer has asked for (ui_draw): a page at rest keeps it still. */
  draws: () => ui.draws(),
  errors: () => ui.errors(),
  /** The last frame as desktop/clay_dump.c's JSON (browser/ui.c's `dump`), read out of the memory. */
  dump() {
    const length = wasm.dump();
    return new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, wasm.dump_ptr(), length));
  },
  /** The page's canvas at a layout pixel, as [r, g, b, a]. */
  pixel(x: number, y: number): number[] {
    const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0];
  },
  /** Ms a frame: the tree declared, Clay's layout, the commands and the effects read out, Canvas2D's raster, one readback. */
  bench(n = 100) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      frame(px, py, down, 1 / 60, false, touch);
      paint();
      ctx.getImageData(0, 0, 1, 1); // a readback, so the raster is done, not just queued
    }
    return (performance.now() - t0) / n;
  },
};

const ms = document.getElementById("ms");
// a page a person opens prints its ms; the check's frames are scripted, and its entry has to start at the first frame, so
// `sky.html?bench=0` takes the auto bench (twenty frames) out of the way
if (ms && new URLSearchParams(location.search).get("bench") !== "0") ms.textContent = `${window.__page.bench(20).toFixed(2)} ms a frame`;
