// browser/ui.c (the wasm) through WebAssembly, in the shape solid/src/ffi.ts gives bun:ffi: the same `ui` object, so
// solid/src/frame.ts, src/entry.ts and the pages run in the page unmodified. Every call is a number or an address; a
// string, an id or a style's floats are copied into the wasm's linear memory first.
//
// Two lifetimes, because the wasm has two:
//   - the page's ids and strings (a `ui_open`'s id, a `ui_bounds`' id) are allocated once and kept for good: Clay's
//     Clay_ElementId holds a pointer to the bytes it hashed (`.stringId`), so they must stay valid past the frame;
//   - everything else (a style's floats, a text's bytes, a wheel's out array) lives until the next `ui_begin`, which is
//     a bump region the whole page shares.
// `ui.wasm` and the bundle are served from browser/solid/, so the fetch is relative to the document, as render.js
// fetches browser/page.wasm.
//
// The desktop's renderer's effects are the C's tables (a shadow, a gradient, a group, an image, a backdrop): browser/ui.c
// fills them beside the commands and browser/draw.js draws them, so `shadow`, `backgroundImage`, `image`, the value
// channel's group fields and `value`'s packed fields all reach the page. What this binding cannot bring over is the
// desktop's window: the window members are stubs, `pixel`/`pixels` read the page's own canvas (browser/solid/page.ts
// binds it), and `png`/`savePng`/`diffPng` have no file system — the check writes the canvas with Playwright instead.

type Ptr = number;

interface Exports {
  memory: WebAssembly.Memory;
  malloc(n: number): Ptr;
  free(p: Ptr): void;
  measure_slot(): Ptr;
  ui_init(w: number, h: number): number;
  ui_font(path: Ptr): number;
  ui_errors(): number;
  ui_wheel(dx: number, dy: number): void;
  ui_wheel_pop(out: Ptr): number;
  ui_auto_scroll(on: number): void;
  ui_begin(px: number, py: number, down: number, dt: number): void;
  ui_pointer_over(id: Ptr, len: number): number;
  ui_value(id: Ptr, len: number, field: number, v: number): void;
  ui_open(id: Ptr | null, len: number, style: Ptr): void;
  ui_close(): void;
  ui_text(id: Ptr | null, idLen: number, bytes: Ptr, len: number, style: Ptr): void;
  ui_end(dt: number): number;
  ui_hash(): bigint;
  ui_draw(): void;
  ui_draws(): number;
  ui_present(): void;
  ui_presents(): number;
  dump(): number;
  dump_ptr(): Ptr;
  ui_term_render(): number;
  ui_term_console(mode: number): number;
  ui_term_console_ptr(): Ptr;
  ui_term_console_len(): number;
  cmd_count(): number;
  cmd_size(): number;
  cmds(): Ptr;
  ui_bounds(id: Ptr, len: number, out: Ptr): number;
  ui_scroll_offset(id: Ptr, len: number, axis: number): number;
  ui_scroll_to(id: Ptr, len: number, axis: number, v: number): number;
  ui_scroll_put(id: Ptr, len: number, axis: number, v: number): number;
  ui_touch_map(fx: number, fy: number, out: Ptr): void;
  ui_image(path: Ptr, len: number): void;
  ui_shadow(x: number, y: number, blur: number, r: number, g: number, b: number, a: number): void;
  ui_backdrop(blur: number): void;
  ui_backgroundImage(kind: number, angle: number, count: number, stops: Ptr): void;
  fx(kind: number): Ptr;
  fx_count(kind: number): number;
  fx_stride(kind: number): number;
}

let onMeasure: (ptr: Ptr, len: number, fontId: number, size: number) => void = () => {};

// The page's own slots: the wasm and the transient region below are the page's, not a module copy's.
const page = globalThis as typeof globalThis & {
  /** One WebAssembly.Instance a page: Clay's state — its arena, a scroll container's offset, the draws and presents the
   *  dev panel counts — is the instance's, and a second instance would be a new page. A hot re-mount
   *  (browser/serve.ts's `hot`) imports the bundle again and the new copy finds this one; a `.c` save rebuilds ui.wasm
   *  and a new instance is exactly what cannot be hot, which is why the server reloads the page for it. */
  __uiWasm?: Promise<Exports>;
  __uiRegion?: { heap: Ptr; heapSize: number; heapUsed: number };
};

async function load(): Promise<Exports> {
  const response = await fetch("ui.wasm");
  if (!response.ok) throw new Error(`ui.wasm: HTTP ${response.status}; run "sh browser/build.sh" first`);
  const module = await (response.headers.get("content-type") === "application/wasm"
    ? WebAssembly.compileStreaming(response)
    : WebAssembly.compile(await response.arrayBuffer()));
  const instance = await WebAssembly.instantiate(module, {
    env: { measure: (ptr: Ptr, len: number, fontId: number, size: number) => onMeasure(ptr, len, fontId, size) },
  });
  const exports = instance.exports as unknown as Exports;
  if ((exports as unknown as { _initialize?: () => void })._initialize) {
    (exports as unknown as { _initialize: () => void })._initialize(); // reactor: libc's constructors
  }
  return exports;
}

const wasm = await (page.__uiWasm ??= load());

/** The wasm's exports, for page.ts: its memory and its command array are what draw.js reads. */
export { wasm };

/** The Canvas2D measure callback browser/ui.c imports as env.measure (draw.js's `surface.measure`). */
export function setMeasure(fn: (ptr: Ptr, len: number, fontId: number, size: number) => void): void {
  onMeasure = fn;
}

const encoder = new TextEncoder();

// the transient region: a style's 45 floats, a text's bytes, an out array. Reset by `begin`. It is the page's (the slot
// above), so a hot re-mount's copy finds the same one in the wasm's memory and the wasm is not left with a second dead
// region.
const region0 = (page.__uiRegion ??= { heap: 0, heapSize: 0, heapUsed: 0 });

function region(n: number): Ptr {
  n = (n + 7) & ~7;
  if (region0.heapUsed + n > region0.heapSize) {
    const size = Math.max(1 << 16, region0.heapSize * 2, n);
    if (region0.heap) wasm.free(region0.heap);
    region0.heap = wasm.malloc(size);
    region0.heapSize = size;
    if (!region0.heap) throw new Error(`ui.wasm: malloc(${size}) failed`);
    region0.heapUsed = 0;
  }
  const at = region0.heap + region0.heapUsed;
  region0.heapUsed += n;
  return at;
}

function copy(bytes: Uint8Array): Ptr {
  const at = region(bytes.length || 1);
  new Uint8Array(wasm.memory.buffer, at, bytes.length).set(bytes);
  return at;
}

function floats(f: Float32Array): Ptr {
  const at = region(f.byteLength || 4);
  new Uint8Array(wasm.memory.buffer, at, f.byteLength).set(new Uint8Array(f.buffer, f.byteOffset, f.byteLength));
  return at;
}

/** A float array the C has just filled: the copy back into JS (the wasm's memory has not moved inside the call). */
function readBack(at: Ptr, f: Float32Array): Float32Array {
  f.set(new Float32Array(wasm.memory.buffer, at, f.length));
  return f;
}

// the page's own bytes, kept for good (Clay's ElementId holds the pointer it hashed)
const ids = new WeakMap<Uint8Array, Ptr>();
const strings = new Map<string, Ptr>();

function kept(bytes: Uint8Array): Ptr {
  const at = wasm.malloc(bytes.length || 1);
  if (!at) throw new Error(`ui.wasm: malloc(${bytes.length}) failed`);
  new Uint8Array(wasm.memory.buffer, at, bytes.length).set(bytes);
  return at;
}

const idPtr = (id: Uint8Array): Ptr => {
  let at = ids.get(id);
  if (at === undefined) {
    at = kept(id);
    ids.set(id, at);
  }
  return at;
};

/** A string the C hashes (a `ui_bounds`, a scroll call): allocated once by its content. */
function strPtr(s: string): { at: Ptr; len: number } {
  const bytes = encoder.encode(s);
  let at = strings.get(s);
  if (at === undefined) {
    at = kept(bytes);
    strings.set(s, at);
  }
  return { at, len: bytes.length };
}

export const ui = {
  init: (w: number, h: number) => wasm.ui_init(w, h),
  /** The canvas's devicePixelRatio is this target's density (draw.js scales the transform by it): nothing to retarget. */
  density: (_scale: number) => true,
  /** No WebGPU canvas: the page draws through Canvas2D. */
  initGpu: (_w: number, _h: number) => 1,
  /** A font is the document's (a FontFace measured by Canvas2D): the call is kept, the id is the first one. */
  font: (_path: string) => wasm.ui_font(0),
  errors: () => wasm.ui_errors(),
  begin: (px: number, py: number, down: number, dt: number) => {
    region0.heapUsed = 0; // the previous frame's styles and texts are dead: a bump region the whole page shares
    wasm.ui_begin(px, py, down, dt);
  },
  wheel: (dx: number, dy: number) => wasm.ui_wheel(dx, dy),
  wheelPop: (out: Float32Array) => {
    const at = floats(out);
    const had = wasm.ui_wheel_pop(at) !== 0;
    if (had) readBack(at, out);
    return had;
  },
  autoScroll: (on: boolean) => wasm.ui_auto_scroll(on ? 1 : 0),
  over: (id: Uint8Array) => wasm.ui_pointer_over(idPtr(id), id.length) !== 0,
  open: (id: Uint8Array | undefined, style: Float32Array) =>
    wasm.ui_open(id ? idPtr(id) : null, id ? id.length : 0, floats(style)),
  value: (id: Uint8Array, field: number, v: number) => wasm.ui_value(idPtr(id), id.length, field, v),
  /** The image of the element the next `open` declares (a css.image style): the path, which the C interns for the process
   *  and browser/draw.js decodes into a bitmap. */
  image: (path: Uint8Array) => wasm.ui_image(copy(path), path.length),
  /** The shadow of the element the next `open` declares (a css.shadow style): offset, blur, colour 0-255. */
  shadow: (x: number, y: number, blur: number, r: number, g: number, b: number, a: number) =>
    wasm.ui_shadow(x, y, blur, r, g, b, a),
  /** The backdrop of the element the next `open` declares: recorded and hashed; the page draws its tint, not the blur. */
  backdrop: (blur: number) => wasm.ui_backdrop(blur),
  /** The background image of the element the next `open` declares: a linear gradient, `count` stops of 5 floats each. */
  backgroundImage: (kind: number, angle: number, count: number, stops: Float32Array) =>
    wasm.ui_backgroundImage(kind, angle, count, floats(stops)),
  close: () => wasm.ui_close(),
  text: (id: Uint8Array | undefined, bytes: Uint8Array, style: Float32Array) =>
    wasm.ui_text(id ? idPtr(id) : null, id ? id.length : 0, copy(bytes), bytes.length, floats(style)),
  end: (dt: number) => wasm.ui_end(dt),
  hash: (): bigint => wasm.ui_hash(),
  /** No file system: the dump goes to the page (`page.ts` reads it out of the memory), not to a path. */
  dumpJson: (_path: string) => -1,
  draws: () => wasm.ui_draws(),
  /** The terminal's cells for the last frame (terminal/render.c in this wasm): the grid from the layout's size, the
   *  commands rendered into it, the rows. The console page's display. */
  termRender: () => wasm.ui_term_render(),
  /** The frame as the console call's JSON — 0 the whole frame, 1 the rows changed since the last 1, 2 the whole frame
   *  again — with its length; the bytes are at termConsolePtr. The rows written. */
  termConsole: (mode: 0 | 1 | 2) => wasm.ui_term_console(mode),
  termConsolePtr: (): Ptr => wasm.ui_term_console_ptr(),
  termConsoleLen: () => wasm.ui_term_console_len(),
  /** The frames the shell put on the canvas: browser/draw.js's paint, the desktop's window present. */
  present: () => wasm.ui_present(),
  presents: () => wasm.ui_presents(),
  /** The raster is the page's (draw.js, called by its loop when the hash moved): this is the count it draws. */
  draw: () => wasm.ui_draw(),
  textWeight: (_px: number) => {},
  /** The pixel at x, y (layout pixels) of the page's canvas, as [r, g, b, a]; black before a canvas is bound. */
  pixel: (x: number, y: number): number[] => {
    if (!canvasCtx) return [0, 0, 0, 0];
    const d = canvasCtx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0];
  },
  /** The page's last frame as RGBA32, top row first, at the raster's scale (width and height are the layout's pixels,
   *  the canvas's are `dpr` times them): a copy of the page's canvas. */
  pixels: (width: number, height: number): Uint8Array => {
    if (!canvasCtx) return new Uint8Array(0);
    const image = canvasCtx.getImageData(0, 0, Math.round(width * dpr), Math.round(height * dpr)).data;
    return new Uint8Array(image.buffer, image.byteOffset, image.byteLength).slice();
  },
  png: (_path: string) => undefined,
  savePng: (_path: string) => false,
  diffPng: (_ref: string, _actual: string) => -1,
  /** No window: the page is one. */
  windowOpen: (_title: string) => 0,
  windowPoll: (out: Float32Array) => out.fill(0),
  windowPresent: () => {},
  /** No SDL key or text queue: the page's own DOM listeners are its input (page.ts). */
  keyPop: (_out: Int32Array) => false,
  textPop: (_out: Uint8Array) => 0,
  setTextInput: (_on: boolean) => {},
  clipboardGet: (_out: Uint8Array) => 0,
  clipboardSet: (_text: string) => {},
  scrollOffset: (id: string) => {
    const { at, len } = strPtr(id);
    return wasm.ui_scroll_offset(at, len, 0);
  },
  scrollOffsetX: (id: string) => {
    const { at, len } = strPtr(id);
    return wasm.ui_scroll_offset(at, len, 1);
  },
  scrollTo: (id: string, y: number) => {
    const { at, len } = strPtr(id);
    return wasm.ui_scroll_to(at, len, 0, y);
  },
  scrollToX: (id: string, x: number) => {
    const { at, len } = strPtr(id);
    return wasm.ui_scroll_to(at, len, 1, x);
  },
  scrollPut: (id: string, y: number) => {
    const { at, len } = strPtr(id);
    return wasm.ui_scroll_put(at, len, 0, y);
  },
  scrollPutX: (id: string, x: number) => {
    const { at, len } = strPtr(id);
    return wasm.ui_scroll_put(at, len, 1, x);
  },
  bounds: (id: Uint8Array): Float32Array | undefined => {
    const out = new Float32Array(4);
    const at = floats(out);
    return wasm.ui_bounds(idPtr(id), id.length, at) ? readBack(at, out) : undefined;
  },
  touchMap: (fx: number, fy: number): Float32Array => {
    const out = new Float32Array(2);
    const at = floats(out);
    wasm.ui_touch_map(fx, fy, at);
    return readBack(at, out);
  },
};

// the page's canvas: `pixel` and `pixels` read what draw.js drew (page.ts binds it once, with the density it draws at)
let canvasCtx: CanvasRenderingContext2D | undefined;
let dpr = 1;

export function bindCanvas(ctx: CanvasRenderingContext2D, pixelRatio = 1): void {
  canvasCtx = ctx;
  dpr = pixelRatio;
}
