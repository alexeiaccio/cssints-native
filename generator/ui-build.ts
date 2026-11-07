// The build-time `ui`: what solid/src/ffi.ts is when generator/page-to-c.ts renders a page. A page's tick asks the host
// for what only a layout knows — `ui.bounds` of its viewport, `ui.scrollOffset` of its clip element — and writes numbers
// back through the value channel; at build time there is no Clay frame and no dylib (a machine with node, bun and cc
// must generate the C), so the generator answers:
//
//   — the layout: the box an element's own style states (a fixed width or height), recorded by page-to-c from the tree;
//   — the scroll offset: the offset the host will put in the page's container (`--scroll <id>=<px>`);
//   — the value channel: every write is recorded, and page-to-c bakes it into the emitted declaration.
//
// Everything that needs a frame is a no-op: there is nothing to draw, to upload or to scroll here. This file is a module
// of its own so page-to-c and the page share one instance (the generator fills the tables, the page reads them).
const decoder = new TextDecoder();

/** The boxes the build knows, by element id: what the style itself states (a fixed length), not a laid-out box. */
const boxes = new Map<string, Float32Array>();
/** The offsets the host will put in a page's scroll containers, by element id, positive down or right. */
const offsets = new Map<string, number>();
/** The value channel: the fields a page wrote for an element id this build (`ui.value`), the last write winning. */
const written = new Map<string, Map<number, number>>();

/** Forgets the page's layout and values (a fresh page), keeping the offsets the host's own (`--scroll`). */
export function reset(): void {
  boxes.clear();
  written.clear();
}

/** The box an element's style states, for `ui.bounds`: `{ x, y, w, h }`, 0 where the style states no length. */
export function box(id: string, w: number, h: number): void {
  boxes.set(id, new Float32Array([0, 0, w, h]));
}

/** The offset the host puts in the container `id`, positive down or right (the page reads Clay's, which is negative). */
export function scroll(id: string, px: number): void {
  offsets.set(id, px);
}

/** The value-channel writes for one element id, by packed field (`solid/src/pack.ts`): undefined when the page wrote none. */
export function values(id: string): ReadonlyMap<number, number> | undefined {
  return written.get(id);
}

const id = (bytes: Uint8Array) => decoder.decode(bytes);

export const ui = {
  init: () => 0,
  density: () => true,
  initGpu: () => 0,
  font: () => 0,
  errors: () => 0,
  begin: () => {},
  wheel: () => {},
  wheelPop: () => false,
  autoScroll: () => {},
  over: () => false,
  open: () => {},
  value: (bytes: Uint8Array, field: number, v: number) => {
    const key = id(bytes);
    const mine = written.get(key) ?? written.set(key, new Map()).get(key)!;
    mine.set(field, v);
  },
  image: () => {},
  shadow: () => {},
  backdrop: () => {},
  backgroundImage: () => {},
  close: () => {},
  text: () => {},
  end: () => 0,
  hash: () => 0n,
  draw: () => {},
  draws: () => 0,
  presents: () => 0,
  /** The box the build knows for that element, as `ui_bounds` returns it (a Float32Array [x, y, w, h]). */
  bounds: (bytes: Uint8Array) => boxes.get(id(bytes)),
  /** Clay's offset is negative down or right; the build is told the positive distance the page scrolls to. */
  scrollOffset: (key: string) => -(offsets.get(key) ?? 0),
  scrollOffsetX: (key: string) => -(offsets.get(key) ?? 0),
  scrollTo: (_key: string, v: number) => v,
  scrollToX: (_key: string, v: number) => v,
  scrollPut: (_key: string, v: number) => v,
  scrollPutX: (_key: string, v: number) => v,
};
