// libterm.dylib (solid/native/term.c) through bun:ffi: the terminal's binding, the counterpart of solid/src/ffi.ts.
// Clay over terminal/cells.c + render.c + measure.c + termbox2, behind the same declaration surface as the desktop
// (a packed 45-float box style, a 10-float text style, the value channel), so a page's styles.ts is one module on both
// targets and a page is declared by the same tree.
//
// The `ui` export below is what a Solid part finds in `solid/src/ffi.ts`: terminal/solid.ts aliases that module to this
// one, so a page's own module (src/entry.ts: `pageEntry`'s motion) writes its overrides into this binding and not into
// libui. Only the members a cell can act on are here; the rest throw with the reason rather than silently drawing
// nothing (a pixmap has no cell).
import { dlopen, FFIType as T, ptr } from "bun:ffi";

const LIB = new URL("../build/solid/libterm.dylib", import.meta.url).pathname;

const open = () =>
  dlopen(LIB, {
    term_open: { args: [T.i32, T.i32], returns: T.i32 },
    term_resize: { args: [], returns: T.void },
    term_size: { args: [T.ptr], returns: T.void },
    term_begin: { args: [T.f32, T.f32, T.i32, T.f32], returns: T.void },
    term_open_element: { args: [T.ptr, T.i32, T.ptr], returns: T.void },
    term_close_element: { args: [], returns: T.void },
    term_text: { args: [T.ptr, T.i32, T.ptr, T.i32, T.ptr], returns: T.void },
    term_value: { args: [T.ptr, T.i32, T.i32, T.f32], returns: T.void },
    term_end: { args: [T.f32], returns: T.i32 },
    term_present: { args: [], returns: T.void },
    term_poll: { args: [T.ptr, T.i32, T.ptr], returns: T.i32 },
    term_over: { args: [T.ptr, T.i32], returns: T.i32 },
    term_bounds: { args: [T.ptr, T.i32, T.ptr], returns: T.i32 },
    term_scroll_offset: { args: [T.ptr, T.i32, T.i32], returns: T.f32 },
    term_scroll_to: { args: [T.ptr, T.i32, T.i32, T.f32], returns: T.f32 },
    term_scroll_put: { args: [T.ptr, T.i32, T.i32, T.f32], returns: T.f32 },
    term_dump: { args: [T.cstring], returns: T.i32 },
    term_ansi: { args: [T.cstring], returns: T.i32 },
    term_console: { args: [T.cstring, T.i32], returns: T.i32 },
    term_ask: { args: [T.cstring, T.ptr, T.i32, T.i32], returns: T.i32 },
    term_errors: { args: [], returns: T.i32 },
    term_close: { args: [], returns: T.void },
  }).symbols;

type Symbols = ReturnType<typeof open>;
let symbols: Symbols | undefined;
/** libterm's symbols: dlopen's table above, opened once, at the first call that needs it. */
const lib = (): Symbols => (symbols ??= open());

const cstr = (x: string) => Buffer.from(`${x}\0`);

/** The terminal target, as a host drives it: a frame, its cells, and the terminal's keys and mouse. */
export const term = {
  /** cols x rows cells headless, or (0, 0) termbox2's own size and the real terminal; 0 on success, 2 without a tty. */
  open: (cols: number, rows: number) => lib().term_open(cols, rows),
  /** The terminal's new size after a resize; the grid is made again. */
  resize: () => lib().term_resize(),
  /** The grid's [cols, rows]. */
  size: () => {
    const out = new Int32Array(2);
    lib().term_size(ptr(out));
    return [out[0]!, out[1]!] as const;
  },
  /** The pointer (in cells) and the button, then Clay opens the layout. */
  begin: (px: number, py: number, down: boolean, dt: number) =>
    lib().term_begin(px, py, down ? 1 : 0, dt),
  /** Opens an element: its id (UTF-8, no terminator) and its 45 packed floats. */
  openElement: (id: Uint8Array | undefined, style: Float32Array) =>
    lib().term_open_element(id ? ptr(id) : null, id?.length ?? 0, ptr(style)),
  closeElement: () => lib().term_close_element(),
  /** A text: id or not, its bytes, and its 10 packed floats. */
  text: (id: Uint8Array | undefined, bytes: Uint8Array, style: Float32Array) =>
    lib().term_text(id ? ptr(id) : null, id?.length ?? 0, ptr(bytes), bytes.length, ptr(style)),
  /** An override of one number of that element's style for this frame (solid/src/pack.ts's FIELDS). */
  value: (id: Uint8Array, field: number, v: number) => lib().term_value(ptr(id), id.length, field, v),
  /** Clay lays out and the commands become cells; the command count. */
  end: (dt: number) => lib().term_end(dt),
  /** The cells to the terminal. */
  present: () => lib().term_present(),
  /** termbox2's next event, at most 16ms: 0 none, 1 an event, 2 a resize, 3 quit. `key` is the key's name ("" for a
   *  pointer edge); `out` is [x, y, down], x -1 when the event was not the mouse. */
  poll: (key: Uint8Array, out: Float32Array) => lib().term_poll(ptr(key), key.length, ptr(out)),
  /** Is the pointer over the element with that id, in the last layout? */
  over: (id: Uint8Array) => lib().term_over(ptr(id), id.length) !== 0,
  /** x, y, width, height of the element in the last layout, or undefined. */
  bounds: (id: Uint8Array) => {
    const out = new Float32Array(4);
    return lib().term_bounds(ptr(id), id.length, ptr(out)) ? out : undefined;
  },
  /** A clip element's offset (negative is scrolled down): the page's own scroll wrote it. 0 when there is no clip. */
  scrollOffset: (id: string) => {
    const bytes = Buffer.from(id);
    return lib().term_scroll_offset(ptr(bytes), bytes.length, 0);
  },
  /** Scrolls a clip element to y, clamped to its content (negative is down); the offset it took. */
  scrollTo: (id: string, y: number) => {
    const bytes = Buffer.from(id);
    return lib().term_scroll_to(ptr(bytes), bytes.length, 0, y);
  },
  /** ... and its x. */
  scrollToX: (id: string, x: number) => {
    const bytes = Buffer.from(id);
    return lib().term_scroll_to(ptr(bytes), bytes.length, 1, x);
  },
  /** Puts a clip element's offset where the page says, past its content too: a rubber band's overscroll. */
  scrollPut: (id: string, y: number) => {
    const bytes = Buffer.from(id);
    return lib().term_scroll_put(ptr(bytes), bytes.length, 0, y);
  },
  /** ... and its x. */
  scrollPutX: (id: string, x: number) => {
    const bytes = Buffer.from(id);
    return lib().term_scroll_put(ptr(bytes), bytes.length, 1, x);
  },
  /** The last frame as plain text: "-" is stdout. 0 on success. */
  dump: (path: string) => lib().term_dump(cstr(path)),
  /** The last frame as ANSI truecolour: "-" is stdout. 0 on success. */
  ansi: (path: string) => lib().term_ansi(cstr(path)),
  /** The last frame as a browser console.log call: mode 0 writes the whole frame over the file, 1 appends only the rows
   *  that changed since the last mode-1 call (one line a frame, as a console writes), 2 appends whole frames (a test's
   *  deliberately broken sink). The rows written, -1 when the file cannot be opened. */
  console: (path: string, mode: 0 | 1 | 2) => lib().term_console(cstr(path), mode),
  /** Writes a query to /dev/tty and reads the terminal's answer into `out` for at most `ms` (a quiet gap ends a real
   *  answer sooner); the byte count, 0 without a terminal. */
  ask: (query: string, out: Uint8Array, ms: number) =>
    lib().term_ask(cstr(query), ptr(out), out.length, ms),
  errors: () => lib().term_errors(),
  close: () => lib().term_close(),
};

/**
 * The `ui` a Solid part finds: what a page writes through the value channel. The entry's fields (46..49, the subtree's
 * opacity and translate) arrive and are dropped by the binding — a cell grid has no group to fade or move, and the
 * layout does not move, so the page's first mount is the frame its literals make. Anything else is a member this target
 * has no equivalent for, and says so.
 */
export const ui = {
  value: (id: Uint8Array, field: number, v: number) => term.value(id, field, v),
  over: (id: Uint8Array) => term.over(id),
  bounds: (id: Uint8Array) => term.bounds(id),
  /** Clay's own wheel scrolling: the terminal never drives it (term_begin does not call Clay_UpdateScrollContainers),
   *  so a page that asks for it off is asking for what it already has — the pre-cut lengths stay the page's. */
  autoScroll: () => {},
  scrollOffset: (id: string) => term.scrollOffset(id),
  scrollTo: (id: string, y: number) => term.scrollTo(id, y),
  scrollToX: (id: string, x: number) => term.scrollToX(id, x),
  scrollPut: (id: string, y: number) => term.scrollPut(id, y),
  scrollPutX: (id: string, x: number) => term.scrollPutX(id, x),
} as Record<string, (...args: unknown[]) => unknown>;
