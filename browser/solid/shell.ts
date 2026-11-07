// The shell both Solid pages of the browser share: the canvas, Clay in ui.wasm (browser/ui.c through ffi-browser.ts), one
// frame a requestAnimationFrame, the DOM's pointer and keyboard where the desktop's window poll has SDL's, and the object
// browser/solid-check.mjs drives (`window.__page`). A page supplies its tree and, if it takes keys, its `Input`.
//
// The loop is src/frame.ts's createDrawer: the tree is declared and laid out every iteration, and the canvas is drawn only
// when the frame hash moved or a discrete input came in (a press, a release, a wheel notch, a key) — a page at rest costs a
// layout and no pixels, as on the desktop. A press, a release, a wheel notch and a key each run their frame on the event,
// so a quick input cannot land two events inside one frame and lose one.
//
// Two lifetimes, because a dev server's hot re-mount needs them apart (browser/serve.ts's `hot` event):
//   - the **host** is one a page load: the canvas and its context, the wasm instance and Clay's state in it, the font, the
//     DOM listeners, the pointer and the wheel queue. It is made once and kept on `globalThis`, so a re-imported bundle —
//     which has its own copy of this module — finds it instead of a second canvas loop;
//   - a **session** is one page: the Solid tree, the frame, the drawer, the rAF loop and `window.__page`. A re-mount builds
//     the new tree and disposes the old session's root, and the host carries over what was never the page's.
// A page opts in with `hot: true` (`?hot=0` is the old full reload); the bundle re-imported is this one, so its own
// `mountPage` finds the host and becomes the next session instead of a second page.
import "./globals.ts";

import { snapshot } from "../../solid/a11y.ts";
import type { Motion } from "../../solid/src/entry.ts";
import { createDrawer, createFrame } from "../../solid/src/frame.ts";
import type { Input } from "../../solid/src/input.ts";
import { El, render } from "../../solid/src/renderer.ts";
import { createSurface, loadFont, readCommands, readEffects } from "../draw.js";
import { bindCanvas, setMeasure, ui, wasm } from "./ffi-browser.ts";
import { attachKeys } from "./keys.ts";

/** The page's pointer callback (app/Widgets.tsx's `Drag`): the shell's `onPointer` each frame. */
export interface Drag {
  onPointer?: (x: number, y: number, down: boolean) => void;
}

/** What a page's tree gets: its root, the host's motion hook (its entry, its tracks), its own drag state and a frame. */
export interface Setup {
  readonly root: El;
  readonly motion: Motion;
  readonly drag: Drag;
  /** One frame now, with the real elapsed seconds, as the loop's next iteration would run it: a discrete input. */
  immediate(): void;
}

/** What browser/solid-check.mjs drives: the scripted frames main.ts's flags take, the frame as a dump, and its ms. */
interface Page {
  warm(n?: number): unknown;
  pointer(x: number, y: number, down: boolean): void;
  commands(): unknown;
  errors(): number;
  dump(): string;
  /** The page's tree as a screen reader would walk it (solid/a11y.ts's `snapshot`), in the page. */
  a11y(): unknown;
  /** An element's box from the last frame's layout (`ui.bounds`): the List's rows and thumb, the field's caret. */
  bounds(id: string): number[] | undefined;
  /** A clip element's scroll offset, positive down (`ui.scrollOffset`; Clay's is negative down): the List's viewport's. */
  offset(id: string): number;
  /** Whether the last frame's pointer was a finger's (`src/frame.ts`'s `touch`): true after a touch, false after the
   *  mouse. */
  touch(): boolean;
  /** The finger's events the canvas has taken (`pointerdown`/`move`/`up`/`cancel` with `pointerType: "touch"`): a check
   *  waits on it, so it knows the renderer dispatched the event it sent. */
  touches(): number;
  /** The frames the drawer drew and the shell painted (`ui.draws`, `ui.presents`): the dev panel's counters. */
  draws(): number;
  presents(): number;
  /** The last frame's hash (`ui.hash`), as hex: the frame is the same when it is the same. */
  hash(): string;
  bench(n?: number): number;
  /** The frames the host's loop has run, every session it has had: a second loop would double the rate. */
  frames(): number;
}

declare global {
  interface Window {
    __page: Page;
    /** A hot re-mount (browser/serve.ts's `hot` event), on a page that opted in: the bundle again, at a new version. */
    __hotSwap?: (version: number) => Promise<void>;
  }
}

export interface Options {
  /** The layout's size, in Clay units (each page's own `size`; the Sensors page is 360x360). */
  width: number;
  height: number;
  /** The page's focus manager: the keys go into it. A page without keys (Sensors) has none. */
  input?: Input;
  /** The page's tree: `render`ed once, before the first frame. */
  tree: (setup: Setup) => () => El;
  /** The frame loop's own array (`View.stats`), for the dev page's panel: the four phases of every frame. */
  stats?: [number, number, number, number][];
  /** A dev server's `hot` event re-mounts this page instead of reloading it (`?hot=0` takes the reload back). */
  hot?: boolean;
  /** The display: the canvas (the default) or the console — the terminal's cells, printed as a console.log call a
   *  frame. A console page keeps the canvas dark: `paint` is never called. */
  sink?: "console";
  /** A console page's cell plan, run each frame after the page's motion and before the tree is declared: the value
   *  channel is read when an element opens, so a cell length must be written here (terminal/solid.ts's `cellStyle`). */
  beforeTree?: (dt: number) => void;
}

/** A page on the host: what a save replaces. */
interface Session {
  start(): void;
  stop(): void;
  /** One frame now, as the loop's next iteration would run it: the host's press, release, key and wheel call it. */
  immediate(): void;
  /** The page's focus manager, which the host's keys dispatch to. */
  readonly input: Input | undefined;
}

/**
 * The page load's own state: the canvas, the wasm instance (and Clay's state in it), the font, the DOM listeners and the
 * pointer. A re-mounted page finds this instead of making a second one.
 */
interface Host {
  readonly width: number;
  readonly height: number;
  readonly surface: ReturnType<typeof createSurface>;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly dpr: number;
  /** The pointer, as the layout's pixels: the last position, the button, and whether it is a finger's. */
  px: number;
  py: number;
  down: boolean;
  touch: boolean;
  touches: number;
  /** The frames the loop has run, over every session: one loop, one rAF. */
  steps: number;
  session?: Session;
}

/**
 * The page's first session: on the first call it loads the wasm and the font, binds the canvas and the DOM's input and
 * makes a session; on a later one (a hot re-mount's new bundle) it finds the host and only makes the session. The canvas
 * is `#frame` (each page's html), its density the device's, and it takes the DOM's focus on a press (`tabindex="0"` in
 * the html): a canvas is not focusable otherwise, and a keydown goes to the focused element. The page does not take focus
 * on load, as a page that scrolls or jumps under its reader should not.
 */
export async function mountPage(options: Options): Promise<void> {
  const host = await hostFor(options);
  // The new tree first: a save that parses and throws while it renders leaves the old page on the canvas and its error
  // in the injected bar, rather than an empty frame with nothing to go back to.
  const session = sessionFor(host, options);
  host.session?.stop();
  host.session = session;
  session.start();
  // The opt-in: the dev server's `hot` event imports this bundle again at a new version, and its `mountPage` — this
  // function, in that copy — finds the host and takes the session's place.
  if (options.hot && new URLSearchParams(location.search).get("hot") !== "0") {
    window.__hotSwap = (version) =>
      import(`${import.meta.url.split("?")[0]}?v=${version}`).then(() => undefined);
  }
}

/** The terminal's measure, for a console page (terminal/measure.c): one cell a UTF-8 code point, one cell a line. The
 *  wasm's `env.measure` writes its answer into the C's own slot, which Clay reads in the same call. */
function cellMeasure(ptr: number, len: number): void {
  const bytes = new Uint8Array(wasm.memory.buffer, ptr, len);
  let count = 0;
  for (let i = 0; i < len; count++) {
    const b = bytes[i]!;
    i += b < 0x80 ? 1 : (b >> 5) === 6 ? 2 : (b >> 4) === 14 ? 3 : (b >> 3) === 30 ? 4 : 1;
  }
  const slot = new Float32Array(wasm.memory.buffer, wasm.measure_slot(), 2);
  slot[0] = count * 8;
  slot[1] = 16;
}

/** The page load's host, made by the first page and found by a re-mounted one (a bundle has its own copy of this file). */
function hostFor(options: Options): Promise<Host> {
  const globals = globalThis as typeof globalThis & { __shellHost?: Promise<Host> };
  return (globals.__shellHost ??= createHost(options));
}

async function createHost(options: Options): Promise<Host> {
  const { width, height } = options;
  const canvas = document.getElementById("frame") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const surface = createSurface(ctx, { width, height, dpr });
  // a console page has no canvas text: its measure is the terminal's (terminal/measure.c), one cell a UTF-8 code point
  setMeasure(
    options.sink === "console"
      ? cellMeasure
      : (ptr, len, fontId, size) => surface.measure(wasm, ptr, len, fontId, size),
  );
  bindCanvas(ctx, dpr);

  // the font the frame is measured and drawn with: a FontFace is in document.fonts once it is loaded, and Clay's measure
  // callback is Canvas2D's, so the layout is this font's metrics
  await loadFont("../../vendor/fonts/Roboto-Regular.ttf");
  if (ui.init(width, height)) throw new Error(`ui_init(${width}, ${height}) failed`);

  const host: Host = {
    width,
    height,
    surface,
    canvas,
    ctx,
    dpr,
    // the pointer, as the layout's pixels: the canvas is drawn at W x H CSS pixels, so the only mapping is the element's
    // box
    px: -1,
    py: -1,
    down: false,
    // the flag the frame's pointer carries (src/frame.ts's `touch`): the mouse's events clear it, a touch's set it, and
    // `window.__page.touch` reports what the last frame got
    touch: false,
    // how many of a finger's events the canvas has taken, `window.__page.touches`: a check waits for the renderer to have
    // dispatched the one it sent, instead of guessing a time
    touches: 0,
    steps: 0,
  };
  const at = (event: MouseEvent): [number, number] => {
    const box = canvas.getBoundingClientRect();
    return [((event.clientX - box.left) * width) / box.width, ((event.clientY - box.top) * height) / box.height];
  };
  /** One frame on the event: the session the host has now (none between a re-mount's two). */
  const now = () => host.session?.immediate();

  // the pointer, as the layout's pixels: the canvas is drawn at W x H CSS pixels, so the only mapping is the element's box
  canvas.addEventListener("mousemove", (event) => {
    [host.px, host.py] = at(event);
  });
  // a press and a release are discrete inputs, and the press gives the canvas the DOM's focus, so the keys reach it
  canvas.addEventListener("mousedown", (event) => {
    [host.px, host.py] = at(event);
    host.down = true;
    host.touch = false;
    canvas.focus();
    now();
  });
  canvas.addEventListener("mouseup", (event) => {
    [host.px, host.py] = at(event);
    host.down = false;
    host.touch = false;
    now();
  });
  canvas.addEventListener("mouseleave", () => {
    host.px = host.py = -1;
    host.down = false;
    host.touch = false;
  });
  // A finger is the same pointer with the frame's `touch` flag: the pointer events a touchscreen sends, at the same
  // mapping, down while the finger is on the canvas and up where it lifts. The flag is what a page's machine reads to
  // start a drag with no click threshold (src/vscroll.ts); the mouse's path above is its own and stays `touch = false`.
  // `touch-action: none` takes the browser's pan and zoom off the canvas — with it a finger's drag is the page's, without
  // it the browser scrolls the document and sends a pointercancel — and the compatibility mouse events a tap would also
  // send are cancelled here, so one tap is one press and one release. The pointer is captured on a press, so a finger
  // that leaves the canvas mid-drag still lifts on it.
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    event.preventDefault();
    [host.px, host.py] = at(event);
    host.down = true;
    host.touch = true;
    host.touches++;
    canvas.setPointerCapture(event.pointerId);
    canvas.focus();
    now();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") [host.px, host.py] = at(event), (host.touch = true), host.touches++;
  });
  canvas.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "touch") return;
    [host.px, host.py] = at(event);
    host.down = false;
    host.touch = true;
    host.touches++;
    now();
  });
  // the browser took the gesture back (a system edge swipe): it ends where the finger last was, as a release
  canvas.addEventListener("pointercancel", (event) => {
    if (event.pointerType !== "touch") return;
    host.down = false;
    host.touch = true;
    host.touches++;
    now();
  });
  // SDL's wheel y is positive away from the user, and a browser's deltaY is positive scrolling down the page: the same
  // sign. `ui.wheel` feeds Clay's containers and the page's own channel; the loop drains it before the frame, as the
  // desktop's window loop does with ui.wheelPop
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      ui.wheel(event.deltaX, event.deltaY);
    },
    { passive: false },
  );

  // the keyboard: the canvas has the DOM's focus (the press above), so its own keydown/keyup are the page's; a key goes
  // into the session's Input and then its frame runs, as main.ts's loop pops a key before the frame. The Input is the
  // page's (its signals are), and a re-mounted page's is a new one: the listener is the host's, and it dispatches to
  // whichever session is current (browser/solid/keys.ts takes an `Input`, and only calls `down`/`up` on it)
  const keys = {
    down: (name: string, repeat?: boolean) => host.session?.input?.down(name, repeat),
    up: (name: string) => host.session?.input?.up(name),
  };
  attachKeys(canvas, keys as unknown as Input, now);

  return host;
}

/** One page on the host: the tree, the frame, the drawer, the loop and `window.__page`. */
function sessionFor(host: Host, options: Options): Session {
  const { ctx } = host;
  const root = new El("root");
  const motion: Motion = {};
  const drag: Drag = {};
  const setup: Setup = { root, motion, drag, immediate: () => immediate() };
  const dispose = render(options.tree(setup), root);
  const frame = createFrame(root, {
    // the pointer goes to both hooks: the Widgets slider's drag and the page's own (the List's viewport), with the
    // finger's flag, which the shell keeps for `window.__page.touch`
    onPointer: (x, y, down, finger) => {
      host.touch = finger;
      drag.onPointer?.(x, y, down);
      motion.onPointer?.(x, y, down, finger);
    },
    // a press that no element with `onPress` was under: a click on empty space blurs, as a browser's does
    onPressMiss: () => options.input?.pressMiss(),
    onWheel: (dx, dy) => motion.onWheel?.(dx, dy),
    tick: (dt) => {
      motion.tick?.(dt);
      options.beforeTree?.(dt);
    },
    stats: options.stats,
  });
  const draw = createDrawer(frame, options.stats);

  const wheelOut = new Float32Array(2);
  const pumpWheel = () => {
    let had = false;
    while (ui.wheelPop(wheelOut)) had = true, motion.onWheel?.(wheelOut[0]!, wheelOut[1]!);
    return had;
  };

  /** One frame's commands and the renderer's tables beside them (a page with no effect has empty ones). */
  function paint(): void {
    host.surface.draw(readCommands(wasm), readEffects(wasm));
    ui.present(); // the desktop's window present: what the dev panel's `presents` counts
  }

  /** The console's display: the terminal's cells for the last frame, printed only when a cell changed (the sink's
   *  diff is [] at rest, and a console has no double buffer: a frame written every tick would scroll). */
  function consolePaint(): void {
    ui.termRender();
    if (ui.termConsole(1) === 0) return;
    const bytes = new Uint8Array(wasm.memory.buffer, ui.termConsolePtr(), ui.termConsoleLen());
    console.log(...(JSON.parse(new TextDecoder().decode(bytes)) as [string, ...string[]]));
  }

  /** The last frame's cells as the sink's JSON (the whole frame), for a check: no console line, no diff state. */
  function cells(): string {
    ui.termRender();
    ui.termConsole(0);
    return new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, ui.termConsolePtr(), ui.termConsoleLen()));
  }

  /** One iteration of the desktop's window loop: the wheel, then the frame; the canvas is drawn when the drawer drew. */
  function step(dt: number, discrete = false): boolean {
    pumpWheel();
    host.steps++;
    const painted = draw(host.px, host.py, host.down, dt, discrete, host.touch);
    if (options.sink === "console") consolePaint();
    else if (painted) paint();
    return painted;
  }

  // the window loop: a browser's tick is requestAnimationFrame, and its dt is the real elapsed seconds (the first frame
  // gets 1/60, as a headless one does)
  let last = performance.now();
  let running = false;
  let raf = 0;
  function tick(): void {
    if (!running) return;
    const now = performance.now();
    step(Math.min((now - last) / 1000, 0.1));
    last = now;
    raf = requestAnimationFrame(tick);
  }

  /** One frame now, as the loop's next iteration would run it. */
  function immediate(): void {
    if (!running) return;
    const now = performance.now();
    step(Math.min((now - last) / 1000, 0.1), true);
    last = now;
  }

  // the ids `bounds` encodes: Clay holds the pointer it hashed, so an id's bytes are made once and kept
  const bound = new Map<string, Uint8Array>();

  return {
    input: options.input,
    immediate,
    start() {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);

      // for browser/solid-check.mjs: the same scripted frames main.ts --png/--click take, the last frame's commands,
      // dump and a11y tree, and the frame's ms. `warm` is dump.ts's `--warm 30` (31 frames at 1/60), so a page's
      // first-mount entry is over. Functions, so nothing can hold a stale command list.
      window.__page = {
        /** N frames at rest at 1/60s with the pointer where it is (a page's entry settles over ~21). */
        warm(n = 31) {
          for (let i = 0; i < n; i++) step(1 / 60);
          return readCommands(wasm);
        },
        /** The point and the button of the next frames (no frame runs: the loop's next one, or `warm`). */
        pointer(x: number, y: number, isDown: boolean) {
          host.px = x, host.py = y, host.down = isDown;
        },
        /** The last frame's pointer was a finger's: what a touch event set and a mouse event clears. */
        touch: () => host.touch,
        /** The finger's events the canvas has taken: `touch()` is the frame's, this is the listener's. */
        touches: () => host.touches,
        /** A clip element's offset, positive down. */
        offset: (id: string) => -ui.scrollOffset(id),
        commands: () => readCommands(wasm),
        errors: () => ui.errors(),
        /** The last frame as desktop/clay_dump.c's JSON (browser/ui.c's `dump`), read out of the memory. */
        dump() {
          const length = wasm.dump();
          return new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, wasm.dump_ptr(), length));
        },
        a11y: () => snapshot(root),
        /** A console page's whole frame as the sink's JSON (what it would log, whether or not a cell changed). */
        cells,
        /** A box of the last frame's layout, as [x, y, w, h] (the element's own, clipped or not), or undefined for an id
         *  the page did not declare. The bytes are made once an id, as every id is. */
        bounds(id: string) {
          const box = ui.bounds(bound.get(id) ?? (bound.set(id, new TextEncoder().encode(id)), bound.get(id)!));
          return box === undefined ? undefined : [...box];
        },
        /** The drawer's draws and the shell's paints, the two counters the dev panel prints. */
        draws: () => ui.draws(),
        presents: () => ui.presents(),
        /** The last frame's hash (a string: a bigint does not cross the page's edge): the same value, the same pixels. */
        hash: () => ui.hash().toString(16),
        /** The frames the host's loop has run: one a rAF, so a leaked loop doubles the rate. */
        frames: () => host.steps,
        /** Ms a frame: the tree declared, Clay's layout, the commands read out, Canvas2D's raster and one readback. */
        bench(n = 100) {
          const t0 = performance.now();
          for (let i = 0; i < n; i++) {
            frame(host.px, host.py, host.down, 1 / 60, false, host.touch);
            if (options.sink === "console") consolePaint();
            else {
              paint();
              ctx.getImageData(0, 0, 1, 1); // a readback, so the raster is done, not just queued
            }
          }
          return (performance.now() - t0) / n;
        },
      };

      // a page a person opens prints its ms; `?bench=0` takes the auto bench (twenty frames) out of the way, for a check
      // whose frames have to start at the first one
      const ms = document.getElementById("ms");
      if (ms && new URLSearchParams(location.search).get("bench") !== "0") {
        ms.textContent = `${window.__page.bench(20).toFixed(2)} ms a frame`;
      }
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      dispose();
    },
  };
}
