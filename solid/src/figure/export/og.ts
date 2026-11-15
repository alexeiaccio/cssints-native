// A figure as an **OG card**: 1200×630, the size social scrapers ask for, which the desktop host cannot draw — its
// frames are multiples of the cell grid (8 × 16 px, times a whole density), and 630 is not (16 · 39.375). So the card is
// the HTML export's own markup, printed by Chromium — the same Playwright dependency `./pdf.ts` uses, and no second
// renderer: the SVG inside is `./svg.ts`, the roles are `./html.ts`'s, and the text is text.
//
// The card is the document, not the figure: the title at the top, the intent under it, the figure filling the room left
// and keeping its aspect (`preserveAspectRatio` letterboxes it inside a box that is the card's), and the source at the
// bottom. A figure wider than the card's 1072 px of room shrinks; a tall one stops at the height. Nothing is cropped.
//
// `--og -o out.png` is the CLI's (`solid/figure.ts`); the size is `OG` below unless a caller asks for another.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Spec } from "../spec.ts";
import { DARK, FIGURE_ROLES, paletteVars } from "./html.ts";
import { escapeXml, svg } from "./svg.ts";
import { layoutOf } from "../kinds.ts";
import { loadChromium } from "../../playwright.ts";

/** The card's size in pixels: the 1.91:1 Open Graph size every scraper documents. */
export const OG = { width: 1200, height: 630 } as const;

export interface OgOptions {
  /** The file to write. */
  readonly path: string;
  /** The card's size, in pixels; `OG` unless given. */
  readonly width?: number;
  readonly height?: number;
}

const STYLE = `:root {
  color-scheme: dark;
${paletteVars(DARK)}
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background: var(--page);
  color: var(--ink);
  font-family: Roboto, Helvetica, Arial, sans-serif;
}
main { display: flex; flex-direction: column; gap: 18px; height: 100%; padding: 56px 64px; }
h1 { margin: 0; font-size: 44px; line-height: 1.15; font-weight: 500; letter-spacing: -0.01em; }
.intent { margin: 0; max-width: 62ch; font-size: 19px; line-height: 1.4; color: var(--muted); }
figure { margin: 0; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px; }
.fig { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
/* the figure's own width and height are its layout's; the box it lands in is the card's, so it fills it and keeps its
   aspect (SVG's preserveAspectRatio letterboxes, and the figure's own page background is the card's colour) */
.fig svg { width: 100%; height: 100%; }
figcaption { color: var(--muted); font-size: 16px; line-height: 1.35; }
${FIGURE_ROLES}`;

/**
 * One spec as the card's HTML: what `--og` prints, and what the test rasterises without the CLI. Self-contained — the
 * SVG inline, the styles in a `<style>`, no script, no web font.
 */
export function ogCard(spec: Spec, options: { width?: number; height?: number } = {}): string {
  const width = options.width ?? OG.width;
  const height = options.height ?? OG.height;
  const l = layoutOf(spec);
  const title = spec.title ?? "A figure";
  return `<!doctype html>
<html lang="${escapeXml(l.lang)}">
<head>
<meta charset="utf-8">
<title>${escapeXml(title)}</title>
<style>
html, body { width: ${width}px; height: ${height}px; }
${STYLE}
</style>
</head>
<body>
<main>
<header>
<h1>${escapeXml(title)}</h1>
${spec.intent ? `<p class="intent">${escapeXml(spec.intent)}</p>` : ""}
</header>
<figure role="img" aria-label="${escapeXml(l.label)}">
<div class="fig">${svg(spec)}</div>
${spec.source ? `<figcaption>${escapeXml(spec.source)}</figcaption>` : ""}</figure>
</main>
</body>
</html>
`;
}

/**
 * Writes one spec's card to `options.path`, at `options.width`×`options.height` (1200×630). Throws what Chromium throws;
 * the caller says which flag was missing Playwright.
 */
export async function og(spec: Spec, options: OgOptions): Promise<void> {
  const width = options.width ?? OG.width;
  const height = options.height ?? OG.height;
  const browser = await (await loadChromium()).launch();
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(ogCard(spec, { width, height }), { waitUntil: "load" });
    // the card is the viewport: a full-page shot would be the document's height, which is the card's either way, but a
    // clip says it once
    const bytes = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } });
    writeFileSync(resolve(options.path), bytes);
  } finally {
    await browser.close();
  }
}
