// libui.dylib (solid/native/ui.c) through bun:ffi. Every argument is a number or a pointer; `p` is the address of a
// typed array that the caller keeps alive.
import { dlopen, FFIType as T, ptr } from "bun:ffi";

const { symbols: s } = dlopen(new URL("../../build/solid/libui.dylib", import.meta.url).pathname, {
  ui_init: { args: [T.i32, T.i32], returns: T.i32 },
  ui_font: { args: [T.cstring], returns: T.i32 },
  ui_errors: { args: [], returns: T.i32 },
  ui_begin: { args: [T.f32, T.f32, T.i32], returns: T.void },
  ui_pointer_over: { args: [T.ptr, T.i32], returns: T.i32 },
  ui_open: { args: [T.ptr, T.i32, T.ptr], returns: T.void },
  ui_close: { args: [], returns: T.void },
  ui_text: { args: [T.ptr, T.i32, T.ptr], returns: T.void },
  ui_end: { args: [T.f32], returns: T.i32 },
  ui_draw: { args: [], returns: T.void },
  ui_pixel: { args: [T.i32, T.i32], returns: T.u32 },
  ui_save_png: { args: [T.cstring], returns: T.i32 },
  ui_diff_png: { args: [T.cstring, T.cstring], returns: T.i32 },
  ui_window_open: { args: [T.cstring], returns: T.f32 },
  ui_window_poll: { args: [T.ptr], returns: T.void },
  ui_window_present: { args: [], returns: T.void },
  ui_key_pop: { args: [T.ptr], returns: T.i32 },
  ui_bounds: { args: [T.ptr, T.i32, T.ptr], returns: T.i32 },
});

const cstr = (x: string) => Buffer.from(`${x}\0`);

export const ui = {
  init: (w: number, h: number) => s.ui_init(w, h),
  font: (path: string) => s.ui_font(cstr(path)),
  errors: () => s.ui_errors(),
  begin: s.ui_begin,
  /** Is the pointer over the element with that id (UTF-8, no terminator) in the layout of the last frame? */
  over: (id: Uint8Array) => s.ui_pointer_over(ptr(id), id.length) !== 0,
  open: (id: Uint8Array | undefined, style: Float32Array) => s.ui_open(id ? ptr(id) : null, id?.length ?? 0, ptr(style)),
  close: s.ui_close,
  text: (bytes: Uint8Array, style: Float32Array) => s.ui_text(ptr(bytes), bytes.length, ptr(style)),
  end: s.ui_end,
  draw: s.ui_draw,
  /** The pixel at x, y of the last frame as [r, g, b, a]. */
  pixel: (x: number, y: number) => {
    const v = s.ui_pixel(x, y);
    return [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24];
  },
  savePng: (path: string) => s.ui_save_png(cstr(path)) === 0,
  /** Pixels of the last frame that differ from a PNG (-1: missing or another size); the frame goes to `actual`. */
  diffPng: (ref: string, actual: string) => s.ui_diff_png(cstr(ref), cstr(actual)),
  windowOpen: (title: string) => s.ui_window_open(cstr(title)),
  windowPoll: (out: Float32Array) => s.ui_window_poll(ptr(out)),
  windowPresent: s.ui_window_present,
  /** The oldest key event the window polled and nobody popped: down or up, SDL keycode, SDL_Keymod, repeat. */
  keyPop: (out: Int32Array) => s.ui_key_pop(ptr(out)) !== 0,
  /** x, y, width, height of the element in the last layout, or undefined. */
  bounds: (id: Uint8Array) => {
    const out = new Float32Array(4);
    return s.ui_bounds(ptr(id), id.length, ptr(out)) ? out : undefined;
  },
};
