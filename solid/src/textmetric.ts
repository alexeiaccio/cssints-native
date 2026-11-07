// The text metric: how much a line is covered, and how alike two rasters of it are. It is Rune's pair (their research,
// item 6): the ink weight — the sum of a line's coverage, in pixels — against a reference renderer's, and the structural
// similarity of the two, so a line that is thin overall and a line that is the wrong shape are told apart.
//
// Coverage is the pixel's luminance against the page's and the text's: 0 is bare paper, 1 is the text's colour. Both
// rasters are measured the same way, so a different background or colour cancels out.
//
// SSIM is the standard 11x11 Gaussian window (sigma 1.5, C1 = 0.01², C2 = 0.03²) over the coverage maps, and a line is
// compared at the whole-pixel shift that fits best (a hinting drift of a pixel is a fact about the raster, not a defect of
// the shape). One number a line, one the whole sheet.

export interface Bitmap {
  readonly width: number;
  readonly height: number;
  /** RGBA32, the top row first. */
  readonly pixels: Uint8Array;
}

export interface Crop {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** A crop's coverage: per pixel, how much of the text's colour it holds (0 the page, 1 the colour), clamped. */
export function coverage(bm: Bitmap, crop: Crop, bg: readonly number[], fg: readonly number[]): Float64Array {
  const page = lum(bg[0]!, bg[1]!, bg[2]!);
  const ink = lum(fg[0]!, fg[1]!, fg[2]!);
  const span = page - ink;
  const out = new Float64Array(crop.w * crop.h);
  for (let y = 0; y < crop.h; y++) {
    const row = (crop.y + y) * bm.width;
    for (let x = 0; x < crop.w; x++) {
      const o = (row + crop.x + x) * 4;
      const l = lum(bm.pixels[o]!, bm.pixels[o + 1]!, bm.pixels[o + 2]!);
      const c = span === 0 ? 0 : (page - l) / span;
      out[y * crop.w + x] = c < 0 ? 0 : c > 1 ? 1 : c;
    }
  }
  return out;
}

/** A line's ink: the coverage summed, in pixels of the text's colour. */
export function inkOf(map: Float64Array): number {
  let s = 0;
  for (const c of map) s += c;
  return s;
}

/** The ink's bounding box within a crop, [x, y, w, h] relative to it; undefined when nothing is covered. */
export function inkBox(map: Float64Array, w: number, h: number, floor = 0.02): [number, number, number, number] | undefined {
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (map[y * w + x]! > floor) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? undefined : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

/** The whole-pixel shift of `b` against `a` that fits best, by the sum of squared differences of their overlap. */
export function align(a: Float64Array, b: Float64Array, w: number, h: number, max = 3): { dx: number; dy: number } {
  let best = { dx: 0, dy: 0 };
  let least = Infinity;
  for (let dy = -max; dy <= max; dy++)
    for (let dx = -max; dx <= max; dx++) {
      let sum = 0;
      let n = 0;
      for (let y = Math.max(0, -dy); y < Math.min(h, h - dy); y++)
        for (let x = Math.max(0, -dx); x < Math.min(w, w - dx); x++) {
          const d = a[y * w + x]! - b[(y + dy) * w + x + dx]!;
          sum += d * d;
          n++;
        }
      const ssd = n ? sum / n : Infinity;
      if (ssd < least) (least = ssd), (best = { dx, dy });
    }
  return best;
}

/** `b` shifted by (dx, dy), the vacated edges zero. */
export function shift(b: Float64Array, w: number, h: number, dx: number, dy: number): Float64Array {
  const out = new Float64Array(w * h);
  for (let y = Math.max(0, -dy); y < Math.min(h, h - dy); y++)
    for (let x = Math.max(0, -dx); x < Math.min(w, w - dx); x++) out[y * w + x] = b[(y + dy) * w + x + dx]!;
  return out;
}

const WINDOW = 11;
const SIGMA = 1.5;
const C1 = 0.01 * 0.01;
const C2 = 0.03 * 0.03;
/** An 11x11 Gaussian, normalised (sigma 1.5). */
const GAUSS = (() => {
  const g = new Float64Array(WINDOW * WINDOW);
  let sum = 0;
  for (let i = 0; i < WINDOW; i++)
    for (let j = 0; j < WINDOW; j++) {
      const d = (i - 5) ** 2 + (j - 5) ** 2;
      g[i * WINDOW + j] = Math.exp(-d / (2 * SIGMA * SIGMA));
      sum += g[i * WINDOW + j]!;
    }
  for (let i = 0; i < g.length; i++) g[i] = g[i]! / sum;
  return g;
})();

/**
 * The structural similarity of two same-size coverage maps (the standard window and constants, 1 is identical), over the
 * windows that carry ink: a crop is mostly the page, and averaging over empty paper would score every pair 1.0.
 */
export function ssim(a: Float64Array, b: Float64Array, w: number, h: number): number {
  if (w < WINDOW || h < WINDOW) return 0;
  const half = 5;
  let total = 0, n = 0;
  for (let y = half; y < h - half; y++)
    for (let x = half; x < w - half; x++) {
      let ma = 0, mb = 0, va = 0, vb = 0, cov = 0, most = 0;
      for (let j = 0; j < WINDOW; j++)
        for (let i = 0; i < WINDOW; i++) {
          const g = GAUSS[j * WINDOW + i]!;
          const [pa, pb] = [a[(y + j - half) * w + x + i - half]!, b[(y + j - half) * w + x + i - half]!];
          ma += g * pa;
          mb += g * pb;
          if (pa > most) most = pa;
          if (pb > most) most = pb;
        }
      if (most < 0.02) continue;
      for (let j = 0; j < WINDOW; j++)
        for (let i = 0; i < WINDOW; i++) {
          const g = GAUSS[j * WINDOW + i]!;
          const [pa, pb] = [a[(y + j - half) * w + x + i - half]!, b[(y + j - half) * w + x + i - half]!];
          va += g * (pa - ma) ** 2;
          vb += g * (pb - mb) ** 2;
          cov += g * (pa - ma) * (pb - mb);
        }
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      n++;
    }
  return n ? total / n : 0;
}

/** One line measured against the reference: its ink on both rasters, their ratio, and the SSIM at the best shift. */
export interface LineScore {
  readonly id: string;
  readonly text: string;
  readonly size: number;
  /** The line's ink on this frame and on the reference, in pixels of the text's colour. */
  readonly ink: number;
  readonly reference: number;
  /** ink / reference: below 1 is thin, above 1 is fat. */
  readonly weight: number;
  /** The structural similarity at the best whole-pixel shift. */
  readonly ssim: number;
  /** The shift the reference needed to fit, in pixels. */
  readonly dx: number;
  readonly dy: number;
  /** The ink's own box width on both rasters: the line's measured extent, which hinting moves. */
  readonly width: number;
  readonly referenceWidth: number;
}

/** A line to score: the id of its row, its text, its size and the crop both rasters draw it in. */
export interface Line {
  readonly id: string;
  readonly text: string;
  readonly size: number;
  readonly box: Crop;
}

/** Every line of a sheet, this frame against a reference raster of the same page. */
export function scoreLines(
  lines: readonly Line[],
  frame: Bitmap,
  reference: Bitmap,
  bg: readonly number[],
  fg: readonly number[],
  maxShift = 3,
): LineScore[] {
  return lines.map((line) => {
    const a = coverage(frame, line.box, bg, fg);
    const b = coverage(reference, line.box, bg, fg);
    const { dx, dy } = align(a, b, line.box.w, line.box.h, maxShift);
    const moved = shift(b, line.box.w, line.box.h, dx, dy);
    const ink = inkOf(a);
    const ref = inkOf(b);
    const box = inkBox(a, line.box.w, line.box.h);
    const refBox = inkBox(b, line.box.w, line.box.h);
    return {
      id: line.id,
      text: line.text,
      size: line.size,
      ink,
      reference: ref,
      weight: ref === 0 ? 0 : ink / ref,
      ssim: ssim(a, moved, line.box.w, line.box.h),
      dx,
      dy,
      width: box ? box[2] : 0,
      referenceWidth: refBox ? refBox[2] : 0,
    };
  });
}
