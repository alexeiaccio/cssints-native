// A figure as an **OG card**: 1200×630, the size social scrapers ask for. Two things live here, and only one of them
// draws the card now:
//
// - `og()`, the exporter: the desktop host's `figure-card` page (`solid/app/FigureCard.tsx`) — the title, the intent, the
//   figure filling the room and keeping its aspect, the source as the caption — drawn by Clay and ThorVG, with no
//   Chromium under it. The figure is the spec's own SVG (`./svg.ts`), which the host draws like any picture.
// - `ogCard()`, the HTML document, kept as the **reference**: what the card looked like printed by a browser, what
//   `figure-export.test.ts` rasterises to check the geometry the host has to match, and what `figure.ts` used to write.
//   Its layout and the page's are the same numbers; the test holds the two to each other.
//
// The card is the document, not the figure: the title at the top, the intent under it, the figure filling the room left
// and keeping its aspect (`preserveAspectRatio` letterboxes it inside a box that is the card's), and the source at the
// bottom. A figure wider than the card's 1072 px of room shrinks; a tall one stops at the height. Nothing is cropped.
//
// `--og -o out.png` is the CLI's (`solid/figure.ts`); the size is `OG` below unless a caller asks for another.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import type { Spec } from "../spec.ts";
import { DARK, FIGURE_ROLES, paletteVars } from "./html.ts";
import { escapeXml, svg } from "./svg.ts";
import { layoutOf } from "../kinds.ts";

/** The native host, the process that draws the card: `png.ts`'s own path, one directory down from this file. */
const NATIVE = new URL("../../../../", import.meta.url).pathname;

/** The card's size in pixels: the 1.91:1 Open Graph size every scraper documents. */
export const OG = { width: 1200, height: 630 } as const;

export interface OgOptions {
  /** The spec's file: the host parses it itself, so a bad one is refused by the page that draws it. */
  readonly specPath: string;
  /** The file to write. */
  readonly path: string;
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
 * Writes one spec's card to `options.path` at 1200×630: one child process of `bun solid/main.ts`, the spec and the
 * destination passed through — the same shape `./png.ts` has, and the same reason: the card is the host's own page, not a
 * second drawer. A spec the host refuses exits non-zero and its stderr is this call's message.
 */
export function og(options: OgOptions): { ok: boolean; message: string } {
  const bun = (): string => process.env.BUN ?? process.execPath;
  const run = spawnSync(
    bun(),
    [resolve(NATIVE, "solid/main.ts"), "figure-card", "--spec", resolve(options.specPath), "--png", resolve(options.path)],
    { cwd: NATIVE, encoding: "utf8" },
  );
  if (run.status === 0) return { ok: true, message: "" };
  return { ok: false, message: (run.stderr ?? "").trim() };
}
