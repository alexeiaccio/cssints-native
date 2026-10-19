// Node's stand-in for `bun:ffi`, used only by solid/compile.tsx.ts: cssints runs a page's module to compute its tokens,
// so the page's imports run in Node too, and a host module (the dylib behind the FFI) means nothing there. Only a
// module's top-level code runs at compile time; anything it calls later goes through the real bun:ffi at run time.
export const dlopen = () => ({ symbols: {} });
export const ptr = () => 0;
export const FFIType = {};
export default {};
