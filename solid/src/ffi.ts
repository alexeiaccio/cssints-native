// libui.dylib (solid/native/ui.c) through bun:ffi. Every argument is a number or a pointer; `p` is the address of a
// typed array that the caller keeps alive.
//
// The library is opened at the first call that needs it, not at import. generator/page-to-c.ts renders a page's tree at
// build time and never calls into it, and the dylib needs SDL3 and ThorVG (brew, macOS) to build, so a missing build must
// not stop the C from being generated. A native call still fails on a missing library, with dlopen's own message and path.
import { dlopen, FFIType as T, ptr } from "bun:ffi";

const LIB = new URL("../../build/solid/libui.dylib", import.meta.url).pathname;

const open = () =>
  dlopen(LIB, {
    ui_init: { args: [T.i32, T.i32], returns: T.i32 },
    ui_density: { args: [T.f32], returns: T.i32 },
    ui_init_gpu: { args: [T.i32, T.i32], returns: T.i32 },
    ui_font: { args: [T.cstring], returns: T.i32 },
    ui_errors: { args: [], returns: T.i32 },
    ui_begin: { args: [T.f32, T.f32, T.i32, T.f32], returns: T.void },
    ui_wheel: { args: [T.f32, T.f32], returns: T.void },
    ui_wheel_pop: { args: [T.ptr], returns: T.i32 },
    ui_auto_scroll: { args: [T.i32], returns: T.void },
    ui_pointer_over: { args: [T.ptr, T.i32], returns: T.i32 },
    ui_open: { args: [T.ptr, T.i32, T.ptr], returns: T.void },
    ui_value: { args: [T.ptr, T.i32, T.i32, T.f32], returns: T.void },
    ui_image: { args: [T.ptr, T.i32], returns: T.void },
    ui_shadow: {
      args: [T.f32, T.f32, T.f32, T.f32, T.f32, T.f32, T.f32],
      returns: T.void,
    },
    ui_backdrop: { args: [T.f32], returns: T.void },
    ui_backgroundImage: { args: [T.i32, T.f32, T.i32, T.ptr], returns: T.void },
    ui_close: { args: [], returns: T.void },
    ui_text: { args: [T.ptr, T.i32, T.ptr, T.i32, T.ptr], returns: T.void },
    ui_end: { args: [T.f32], returns: T.i32 },
    ui_hash: { args: [], returns: T.u64 },
    ui_dump_json: { args: [T.cstring], returns: T.i32 },
    ui_draws: { args: [], returns: T.i32 },
    ui_presents: { args: [], returns: T.i32 },
    ui_draw: { args: [], returns: T.void },
    ui_text_weight: { args: [T.f32], returns: T.void },
    ui_pixel: { args: [T.i32, T.i32], returns: T.u32 },
    ui_pixels_copy: { args: [T.ptr, T.i32], returns: T.i32 },
    ui_load_png: { args: [T.cstring], returns: T.i32 },
    ui_png_size: { args: [T.ptr], returns: T.i32 },
    ui_png_copy: { args: [T.ptr, T.i32], returns: T.i32 },
    ui_save_png: { args: [T.cstring], returns: T.i32 },
    ui_diff_png: { args: [T.cstring, T.cstring], returns: T.i32 },
    ui_touch_map: { args: [T.f32, T.f32, T.ptr], returns: T.void },
    ui_window_open: { args: [T.cstring], returns: T.f32 },
    ui_window_poll: { args: [T.ptr], returns: T.void },
    ui_window_present: { args: [], returns: T.void },
    ui_key_pop: { args: [T.ptr], returns: T.i32 },
    ui_text_pop: { args: [T.ptr, T.i32], returns: T.i32 },
    ui_text_input: { args: [T.i32], returns: T.void },
    ui_clipboard_get: { args: [T.ptr, T.i32], returns: T.i32 },
    ui_clipboard_set: { args: [T.ptr, T.i32], returns: T.void },
    ui_bounds: { args: [T.ptr, T.i32, T.ptr], returns: T.i32 },
    ui_scroll_offset: { args: [T.ptr, T.i32, T.i32], returns: T.f32 },
    ui_scroll_to: { args: [T.ptr, T.i32, T.i32, T.f32], returns: T.f32 },
    ui_scroll_put: { args: [T.ptr, T.i32, T.i32, T.f32], returns: T.f32 },
  }).symbols;

type Symbols = ReturnType<typeof open>;
let symbols: Symbols | undefined;
/** libui's symbols: dlopen's table above, opened once, at the first call that needs it. */
const lib = (): Symbols => (symbols ??= open());

const cstr = (x: string) => Buffer.from(`${x}\0`);

export const ui = {
  init: (w: number, h: number) => lib().ui_init(w, h),
  /** The raster's pixel density: 2 draws the same layout into twice the pixels, as a Retina window does. */
  density: (scale: number) => lib().ui_density(scale) === 0,
  /** The same renderer on ThorVG's WebGPU canvas: only a libui.dylib built with desktop/build-thorvg-gpu.sh solid. */
  initGpu: (w: number, h: number) => lib().ui_init_gpu(w, h),
  font: (path: string) => lib().ui_font(cstr(path)),
  errors: () => lib().ui_errors(),
  begin: (px: number, py: number, down: number, dt: number) => lib().ui_begin(px, py, down, dt),
  /** Adds a wheel delta to the next frame: positive scrolls the content down (away from the user), as SDL's wheel y.
   *  Clay moves the scroll container the pointer is over by it at the next `begin`, unless the page turned that off. */
  wheel: (dx: number, dy: number) => lib().ui_wheel(dx, dy),
  /** The wheel the polls (or `wheel`) took since the last pop, into out[2] and drained; false when there is none. */
  wheelPop: (out: Float32Array) => lib().ui_wheel_pop(ptr(out)) !== 0,
  /** Clay's own wheel scrolling of its scroll containers: on by default, off while a page animates its own offset. */
  autoScroll: (on: boolean) => lib().ui_auto_scroll(on ? 1 : 0),
  /** Is the pointer over the element with that id (UTF-8, no terminator) in the layout of the last frame? */
  over: (id: Uint8Array) => lib().ui_pointer_over(ptr(id), id.length) !== 0,
  open: (id: Uint8Array | undefined, style: Float32Array) =>
    lib().ui_open(id ? ptr(id) : null, id?.length ?? 0, ptr(style)),
  /** An override of one number of that element's style for this frame only: a packed field 0..44 (`FIELDS` in pack.ts),
   *  45 for its shadow's blur, 46/47/48/49 for its whole subtree's opacity, scale and translate, 50 for the opacity of
   *  its background image, 51..54 for the colour of the text element with that id (its own fields, not its box's) and 55
   *  for its subtree's rotation in degrees. The next `open` (or `text`) declares from a copy with the overrides applied,
   *  so a value that is the style's own leaves the frame as the literal made it. Called from a page's `View.tick`,
   *  before the tree. */
  value: (id: Uint8Array, field: number, v: number) => lib().ui_value(ptr(id), id.length, field, v),
  /** The image of the element the next `open` declares (a css.image style): the path UTF-8, no terminator. */
  image: (path: Uint8Array) => lib().ui_image(ptr(path), path.length),
  /** The shadow of the element the next `open` declares (a css.shadow style): offset, blur, colour 0-255. */
  shadow: (x: number, y: number, blur: number, r: number, g: number, b: number, a: number) =>
    lib().ui_shadow(x, y, blur, r, g, b, a),
  /** The backdrop of the element the next `open` declares (a css.backdrop style): the blur radius in pixels. */
  backdrop: (blur: number) => lib().ui_backdrop(blur),
  /** The background image of the element the next `open` declares (a css.backgroundImage style): a linear gradient at
   *  `angle` degrees (0 up, 90 right), `count` stops of (offset, r, g, b, a) flattened. */
  backgroundImage: (kind: number, angle: number, count: number, stops: Float32Array) =>
    lib().ui_backgroundImage(kind, angle, count, ptr(stops)),
  close: () => lib().ui_close(),
  /** A text: its bytes (UTF-8, a pointer and a length) and its 10 floats. With an id, the page can move its colour
   *  through `value` (fields 51..54): a text's colour is its own, not its parent's box. */
  text: (id: Uint8Array | undefined, bytes: Uint8Array, style: Float32Array) =>
    lib().ui_text(id ? ptr(id) : null, id?.length ?? 0, ptr(bytes), bytes.length, ptr(style)),
  end: (dt: number) => lib().ui_end(dt),
  /** The FNV-1a hash of the last frame's commands and renderer effects: the same value twice means the same pixels, so
   *  a host that sees it unchanged may skip `draw` (and its present). */
  hash: (): bigint => lib().ui_hash(),
  /** Writes the last frame as JSON at `path` (the command-stream goldens of `src/dump.ts`): 0 on success, -1 when the
   *  file cannot be written. Every command field a draw reads, then the renderer's tables beside the commands. */
  dumpJson: (path: string) => lib().ui_dump_json(cstr(path)),
  /** ui_draw calls of the process: a page at rest keeps it still. */
  draws: () => lib().ui_draws(),
  /** ui_window_present calls of the process. */
  presents: () => lib().ui_presents(),
  draw: () => lib().ui_draw(),
  /** How much thicker than ThorVG's own raster a text line is drawn, in Clay units (0: as is). */
  textWeight: (px: number) => lib().ui_text_weight(px),
  /** The pixel at x, y of the last frame as [r, g, b, a]. */
  pixel: (x: number, y: number) => {
    const v = lib().ui_pixel(x, y);
    return [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24];
  },
  /** The last frame's pixels, RGBA32 and the top row first, as a copy of 4 * width * height bytes: empty when the frame
   *  is drawn at another scale (headless is 1:1). */
  pixels: (width: number, height: number): Uint8Array => {
    const out = new Uint8Array(width * height * 4);
    return lib().ui_pixels_copy(ptr(out), out.length) < 0 ? new Uint8Array(0) : out;
  },
  /** A PNG as { width, height, pixels } (RGBA32), or undefined when it is missing or unreadable. */
  png: (path: string) => {
    if (lib().ui_load_png(cstr(path)) !== 0) return undefined;
    const size = new Int32Array(2);
    if (!lib().ui_png_size(ptr(size))) return undefined;
    const [width, height] = [size[0]!, size[1]!];
    const pixels = new Uint8Array(width * height * 4);
    return lib().ui_png_copy(ptr(pixels), pixels.length) < 0 ? undefined : { width, height, pixels };
  },
  savePng: (path: string) => lib().ui_save_png(cstr(path)) === 0,
  /** Pixels of the last frame that differ from a PNG (-1: missing or another size); the frame goes to `actual`. */
  diffPng: (ref: string, actual: string) => lib().ui_diff_png(cstr(ref), cstr(actual)),
  windowOpen: (title: string) => lib().ui_window_open(cstr(title)),
  /** A finger's position normalised to the window (0..1) in the layout's pixels, into a Float32Array [x, y]: the same
   *  mapping the window poll does for SDL's finger events, so a headless script can drive a touch (--touch). */
  touchMap: (fx: number, fy: number) => {
    const out = new Float32Array(2);
    lib().ui_touch_map(fx, fy, ptr(out));
    return out;
  },
  /** Drains the window's events into out[6]: pointer x, y, button down, quit, the last key's character, and whether the
   *  last pointer event was a finger (1) or the mouse (0). */
  windowPoll: (out: Float32Array) => lib().ui_window_poll(ptr(out)),
  windowPresent: () => lib().ui_window_present(),
  /** The oldest key event the window polled and nobody popped: down or up, SDL keycode, SDL_Keymod, repeat. */
  keyPop: (out: Int32Array) => lib().ui_key_pop(ptr(out)) !== 0,
  /** The oldest typed run the window polled (UTF-8, a composed character); its byte length, 0 when there is none. */
  textPop: (out: Uint8Array) => lib().ui_text_pop(ptr(out), out.length),
  /** SDL's text input: only while it runs does the window poll TEXT_INPUT (it needs the window open). */
  setTextInput: (on: boolean) => lib().ui_text_input(on ? 1 : 0),
  /** The clipboard as UTF-8 into `out`; the byte length written, 0 when it is empty. */
  clipboardGet: (out: Uint8Array) => lib().ui_clipboard_get(ptr(out), out.length),
  clipboardSet: (text: string) => {
    const bytes = Buffer.from(text);
    lib().ui_clipboard_set(ptr(bytes), bytes.length);
  },
  /** The scroll offset of a clip element (negative is scrolled down), 0 when there is none. */
  scrollOffset: (id: string) => {
    const bytes = Buffer.from(id);
    return lib().ui_scroll_offset(ptr(bytes), bytes.length, 0);
  },
  /** The horizontal scroll offset of a clip element (negative is scrolled right), 0 when there is none. */
  scrollOffsetX: (id: string) => {
    const bytes = Buffer.from(id);
    return lib().ui_scroll_offset(ptr(bytes), bytes.length, 1);
  },
  /** Scrolls a clip element to y, clamped to its content; the offset it took. */
  scrollTo: (id: string, y: number) => {
    const bytes = Buffer.from(id);
    return lib().ui_scroll_to(ptr(bytes), bytes.length, 0, y);
  },
  /** ... and its x. */
  scrollToX: (id: string, x: number) => {
    const bytes = Buffer.from(id);
    return lib().ui_scroll_to(ptr(bytes), bytes.length, 1, x);
  },
  /** Puts a clip element's offset where the page says, past its content too: a rubber band's overscroll. */
  scrollPut: (id: string, y: number) => {
    const bytes = Buffer.from(id);
    return lib().ui_scroll_put(ptr(bytes), bytes.length, 0, y);
  },
  /** ... and its x. */
  scrollPutX: (id: string, x: number) => {
    const bytes = Buffer.from(id);
    return lib().ui_scroll_put(ptr(bytes), bytes.length, 1, x);
  },
  /** x, y, width, height of the element in the last layout, or undefined. */
  bounds: (id: Uint8Array) => {
    const out = new Float32Array(4);
    return lib().ui_bounds(ptr(id), id.length, ptr(out)) ? out : undefined;
  },
};
