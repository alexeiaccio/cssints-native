// A figure as one page: the same standalone SVG `./svg.ts` makes, inline, with the document around it — the title, the
// intent, the figure's accessible label, the `►` focus line and the source, and `prefers-color-scheme` for the two
// palettes of `app/Figure.styles.ts`. The shapes are written **once**: this file embeds `svg(spec)` verbatim and never
// repeats a box, a bar or a text, so the page and the `.svg` export cannot disagree.
//
// No JavaScript, on purpose. The one thing the kit's live pages add is the arrival (a figure grows in, once, on view);
// an export that has to open from a file, in a mail client or in a slide does not get to run script, so the still is the
// export's job. The live colour probe, the Still button and the ↺ replay are the same trade. What remains is a static
// page whose meaning is in its text: every number is printed, so a monochrome print, a forced-colors screen and a
// `@media print` sheet read the same figure. `NO_COLOR` is an environment variable a page with no script cannot read;
// the page is colour-independent by construction instead (the roles only restyle what is already written).
//
// The palette is the page's own roles, not two literal colours: `--page`, `--panel`, `--ink`, `--muted`, `--accent`,
// `--line`, `--problem` and `--good`, dark by default and overridden under `prefers-color-scheme: light` and in print.
// The SVG's elements carry classes (`fig-ink`, `fig-track`, `fig-fill--good`, ...), so the same inline markup follows
// the page's palette; the `.svg` file keeps the dark literals as its own fallback.
import { FOCUS_MARK, layoutOf } from "../kinds.ts";
import type { Spec } from "../spec.ts";
import { escapeXml, svg } from "./svg.ts";

/** The dark palette, `app/Figure.styles.ts`' tokens as hex: what a dark page and the standalone SVG start from. */
export const DARK = {
  page: "#101316",
  panel: "#1b2026",
  ink: "#e6e9ec",
  muted: "#8b98a5",
  accent: "#3b9cf0",
  line: "#2d333d",
  problem: "#e63c3c",
  good: "#5abe78",
} as const;
/** The light palette, the page's `createGlobalTheme` override. */
export const LIGHT = {
  page: "#f3f5f7",
  panel: "#ffffff",
  ink: "#0f1419",
  muted: "#56636f",
  accent: "#1170cf",
  line: "#d5dce4",
  problem: "#be1e28",
  good: "#148246",
} as const;

/** One palette as the page's role variables, four spaces in: what `:root` and its light/print overrides are made of. */
export const paletteVars = (palette: typeof DARK): string =>
  Object.entries(palette)
    .map(([role, value]) => `  --${role}: ${value};`)
    .join("\n");

/** The figure's roles: the inline SVG follows the page's palette, so one markup serves light, dark, print and contrast. */
export const FIGURE_ROLES = `.fig-page { fill: var(--page); }
.fig-box { fill: var(--panel); }
.fig-track { fill: var(--line); }
.fig-fill, .fig-fill--plain { fill: var(--accent); }
.fig-fill--problem { fill: var(--problem); }
.fig-fill--good { fill: var(--good); }
.fig-ink { fill: var(--ink); }
.fig-muted { fill: var(--muted); }
.fig-problem { fill: var(--problem); }
.fig-good { fill: var(--good); }
.fig-marker { fill: var(--good); }
.fig-swatch { stroke: var(--line); stroke-width: 1; }`;

/** The figure in high contrast: the palette dropped, the boxes' outlines and the numbers (text) still meaning it. */
export const FIGURE_FORCED = `  .fig-page, .fig-track { fill: Canvas; }
  .fig-box, .fig-swatch { fill: Canvas; stroke: CanvasText; stroke-width: 1; }
  .fig-fill, .fig-fill--plain, .fig-fill--problem, .fig-fill--good, .fig-marker { fill: Highlight; }
  .fig-ink, .fig-muted, .fig-problem, .fig-good, .fig-title, .fig-specimen { fill: CanvasText; }`;

const STYLE = `:root {
  color-scheme: dark light;
${paletteVars(DARK)}
}
@media (prefers-color-scheme: light) {
  :root {
${paletteVars(LIGHT)}
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background: var(--page);
  color: var(--ink);
  font-family: Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
main { max-width: 960px; margin: 0 auto; padding: 32px 16px 40px; }
h1 { margin: 0 0 8px; font-size: 20px; line-height: 1.3; font-weight: 500; }
.intent { margin: 0 0 24px; max-width: 72ch; color: var(--muted); }
figure { margin: 0; }
svg { display: block; max-width: 100%; height: auto; }
figcaption { margin-top: 12px; color: var(--muted); font-size: 12px; }
figcaption .focus { color: var(--ink); }
figcaption .source { display: block; margin-top: 2px; }
/* The roles: the inline SVG follows the page's palette; the file's own literals are the standalone fallback. */
${FIGURE_ROLES}
@media print {
  :root {
    color-scheme: light;
${paletteVars(LIGHT)}
  }
  body { background: #fff; }
  main { max-width: none; padding: 0; }
  figure { break-inside: avoid; }
  .fig-swatch { stroke: #000; }
}
/* High contrast: the palette is dropped, the numbers (text) and the boxes' outlines keep the meaning. */
@media (forced-colors: active) {
${FIGURE_FORCED}
}`;

/**
 * One spec as a self-contained HTML page: the SVG inline, the document's `<title>` and description, the title and
 * intent above it, the focus line and the source as the caption. No script, no external stylesheet, no font file.
 */
export function html(spec: Spec): string {
  const figure = svg(spec);
  const l = layoutOf(spec);
  const title = spec.title ?? "A figure";
  const description = spec.intent ?? spec.source ?? title;
  const focus = l.focus ? `${FOCUS_MARK} ${l.focus.say ?? l.focus.on.join(", ")}` : undefined;
  const caption = [
    focus ? `<span class="focus">${escapeXml(focus)}</span>` : "",
    spec.source ? `<span class="source">${escapeXml(spec.source)}</span>` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `<!doctype html>
<html lang="${escapeXml(l.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeXml(title)}</title>
<meta name="description" content="${escapeXml(description)}">
<meta name="color-scheme" content="dark light">
<style>
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
${figure}${caption ? `<figcaption>\n${caption}\n</figcaption>` : ""}</figure>
</main>
</body>
</html>
`;
}
