// WCAG 2.x relative luminance and contrast ratio, in a dozen lines and **no dependency**: `spec.ts` is checked wherever a
// spec is read — a terminal, a browser, the desktop host — and a layout is drawn on all three, so neither can import
// culori. The engine's own is `packages/cssints/src/color.ts` (culori's `wcagLuminance` and the same ratio, `shown`), and
// that is the one this repository calls a contrast figure's own: `solid/specs/from-tokens.ts` writes every ratio in
// `solid/specs/contrast.json` and every step's contrast in `palette.json` from it.
//
// This copy exists for two jobs only, and `solid/figure.test.ts` holds it to the engine's on every pair and every swatch
// the four design-system specs draw (they are bit-identical, not merely close):
//   — `check` refuses a spec whose ratio disagrees with its own colours before a frame is declared, with no import at all;
//   — a layout paints a palette's step's contrast on the page, which it must do at draw time.
// So the *drawing* and the *refusal* cannot drift from each other, and neither drifts from the engine.

/** A colour as `#rrggbb`, or nothing: the only form a palette's or a pair's value may take. */
export const HEX = /^#([0-9a-f]{6})$/i;

/**
 * WCAG 2.x relative luminance of a `#rrggbb` colour: the sRGB channels linearised, then 0.2126 R + 0.7152 G + 0.0722 B.
 * Undefined for anything but six hex digits, so a spec that writes `rgb(0 0 0)` is refused rather than measured.
 */
export function luminance(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = HEX.exec(value);
  if (!match) return undefined;
  const linear = [0, 2, 4].map((i) => {
    const channel = parseInt(match[1]!.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** The contrast ratio of two luminances, 1 to 21. The brighter one is on top, as WCAG writes it. */
export const ratio = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** The ratio of two hex colours, or undefined when one is not a hex colour. */
export function contrastOf(fg: unknown, bg: unknown): number | undefined {
  const [f, b] = [luminance(fg), luminance(bg)];
  return f === undefined || b === undefined ? undefined : ratio(f, b);
}

/** A ratio as a figure prints it: the floor at two places, so 4.499 does not read as the 4.5 it misses (the engine's
 *  `shown`, character for character). */
export const shown = (value: number): string => (Math.floor(value * 100) / 100).toFixed(2);

/** The floor a step of a palette has to pass to read as words: WCAG's AA for body text, which the kit's `▲` marks. */
export const WORDS = 4.5;
