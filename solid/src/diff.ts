// A pixel diff that says **where**: the count of differing pixels and the box they are in. The count alone tells a
// failing frame that something moved, not what; the box says which element, and lets a report name it.
//
// Taken from gpucanvas's `diffImages` (MIT, berkantay), which returns `{ changed, bounds, image }` for exactly this
// question: "what moved, and where". The image stayed behind — this host has no PNG encoder of its own, and the frame
// already lands next to its reference as `<ref>.actual.png` when it fails.
//
// The pixels are RGBA32, the top row first, as `ui.png` and `ui.pixels` hand them over. A diff of two images of another
// size is not a diff: the caller gets `undefined`, which is the case the comparison refuses anyway.

/** An RGBA32 image, the top row first: a PNG `ui.png` read, or the frame's own bytes. */
export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

/** A rectangle of pixels: `x`, `y` from the top left, in pixels. */
export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Difference {
  /** How many pixels differ. */
  readonly changed: number;
  /** The box that holds all of them; absent when none do. */
  readonly bounds?: Bounds;
}

/** What differs between two images, by count and by box; `undefined` when they are of different sizes. */
export const diffImages = (a: Raster, b: Raster): Difference | undefined => {
  if (a.width !== b.width || a.height !== b.height) return undefined;
  let left = a.width;
  let right = -1;
  let top = a.height;
  let bottom = -1;
  let changed = 0;
  const stride = a.width * 4;
  for (let y = 0; y < a.height; y++) {
    const row = y * stride;
    for (let x = 0; x < a.width; x++) {
      const i = row + x * 4;
      if (
        a.pixels[i] === b.pixels[i] &&
        a.pixels[i + 1] === b.pixels[i + 1] &&
        a.pixels[i + 2] === b.pixels[i + 2] &&
        a.pixels[i + 3] === b.pixels[i + 3]
      )
        continue;
      changed++;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (!changed) return { changed };
  return { changed, bounds: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } };
};
