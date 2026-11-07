// A deck: one spec a slide, one self-contained HTML page. Each slide carries the **same** `svg(spec)` `./svg.ts`
// writes for that spec — inline, verbatim, once — so a slide and the figure's own `.svg` cannot disagree, and the deck
// adds no drawing of its own. The page around it is the one `./html.ts` makes of a single figure: the title and intent
// above, the `►` focus line and the source under it, the palette over roles (`--page`, `--ink`, ...), `prefers-color-
// scheme`, print and `forced-colors`. What a deck adds is the sequence: a slide number, `:target` navigation, and a
// `@page` rule that puts a slide a page.
//
// **Navigation is CSS only, and `:target` is how.** A slide is `display: none` until it is the URL's fragment
// (`#s2`); the first slide is the default when no fragment names a slide (`:has()` on the deck, every browser since
// 2023). Each slide has a Previous and a Next anchor, and the first and last point back to the deck's top, which is
// the no-fragment state. What that cannot do: arrow keys, a swipe, an overview of all slides, or any state the URL
// does not name — a page with no script cannot hear the keyboard, and the browser's back button is the way back. It
// also needs `:has()`: an older browser shows nothing until a slide's link is followed.
//
// **Print is one page a slide.** `@page { size: A4 landscape; margin: 12mm }` is the sheet, and every slide is
// `break-after: page` (the last one `auto`, so there is no blank sheet) with `break-inside: avoid`, so `page.pdf()` —
// `./pdf.ts` — gives one page a spec. The slides are `display: block` in print even though the screen shows one: the
// deck is *not* the slide you were looking at. A figure taller or wider than the printable box is scaled into it by
// CSS (`max-width`, `max-height`) with its viewBox unchanged, so the SVG is never re-cut and no bar moves.
//
// Every spec is validated by the caller before this function is reached (`solid/figure.ts`), so an invalid deck is a
// message and no file. Text is XML-escaped and HTML-escaped; the file has no `<script>`, no external stylesheet, no
// font and no image: its bytes are the deck and nothing else.
import { FOCUS_MARK, layoutOf } from "../kinds.ts";
import type { Spec } from "../spec.ts";
import { DARK, FIGURE_FORCED, FIGURE_ROLES, LIGHT, paletteVars } from "./html.ts";
import { escapeXml, svg } from "./svg.ts";

/** The sheet the deck prints on: A4 landscape with a 12 mm margin, the `@page` rule and `./pdf.ts`'s page in one place. */
export const PAGE = { paper: "A4", margin: 12 } as const;

export interface DeckOptions {
  /** The deck's title, on the first slide and as the document's: the first spec's title unless given. */
  readonly title?: string;
}

const STYLE = `@page {
  size: ${PAGE.paper} landscape;
  margin: ${PAGE.margin}mm;
}
:root {
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
.deck { max-width: 1120px; margin: 0 auto; padding: 32px 16px 48px; }
/* One slide at a time: the URL's fragment picks it, and no fragment is the first. */
.slide { display: none; min-height: calc(100vh - 80px); }
.slide:target { display: block; }
.deck:not(:has(.slide:target)) > .slide:first-of-type { display: block; }
.deck-title {
  margin: 0 0 20px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.count { margin: 0 0 4px; color: var(--muted); font-size: 12px; }
h2 { margin: 0 0 8px; font-size: 22px; line-height: 1.25; font-weight: 500; }
.intent { margin: 0 0 20px; max-width: 72ch; color: var(--muted); }
figure { margin: 0; }
svg { display: block; width: auto; height: auto; max-width: 100%; max-height: 78vh; }
figcaption { margin-top: 12px; color: var(--muted); font-size: 12px; }
figcaption .focus { color: var(--ink); }
figcaption .source { display: block; margin-top: 2px; }
.slide-nav { display: flex; gap: 8px; margin-top: 24px; font-size: 12px; }
.slide-nav a {
  color: var(--accent);
  text-decoration: none;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 14px;
}
.slide-nav a:hover, .slide-nav a:focus-visible { border-color: var(--accent); }
/* The roles: the inline SVG follows the page's palette; the file's own literals are the standalone fallback. */
${FIGURE_ROLES}
@media print {
  :root {
    color-scheme: light;
${paletteVars(LIGHT)}
  }
  body { background: #fff; }
  .deck { max-width: none; padding: 0; }
  /* every slide, a page each: what was on screen was one slide of many */
  .slide, .slide:target { display: block; min-height: 0; break-after: page; break-inside: avoid; }
  .deck > .slide:last-of-type { break-after: auto; }
  .deck-title { margin-bottom: 12px; }
  h2 { font-size: 20px; }
  .intent { margin-bottom: 12px; }
  /* the printable box is 273x186mm: a figure larger than that is scaled into it, its viewBox unchanged */
  svg { max-height: 150mm; }
  .slide-nav { display: none; }
  .fig-swatch { stroke: #000; }
}
/* High contrast: the palette is dropped, the numbers (text) and the boxes' outlines keep the meaning. */
@media (forced-colors: active) {
${FIGURE_FORCED}
  .slide-nav a { color: LinkText; border-color: LinkText; }
}`;

const caption = (spec: Spec): string => {
  const l = layoutOf(spec);
  const focus = l.focus ? `${FOCUS_MARK} ${l.focus.say ?? l.focus.on.join(", ")}` : undefined;
  return [
    focus ? `<span class="focus">${escapeXml(focus)}</span>` : "",
    spec.source ? `<span class="source">${escapeXml(spec.source)}</span>` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

/** One slide: its number, title, intent, the inline SVG, the caption and the two links, with `id` as its target. */
function slide(spec: Spec, index: number, count: number, deckTitle: string): string {
  const id = `s${index + 1}`;
  const title = spec.title ?? "A figure";
  const previous = index === 0 ? "top" : `s${index}`;
  const next = index === count - 1 ? "top" : `s${index + 2}`;
  const captionHtml = caption(spec);
  return `<section class="slide" id="${id}" aria-labelledby="${id}-title">
<header class="slide-head">
${index === 0 && deckTitle !== title ? `<h1 class="deck-title">${escapeXml(deckTitle)}</h1>\n` : ""}<p class="count">Slide ${index + 1} of ${count}</p>
<h2 id="${id}-title">${escapeXml(title)}</h2>
${spec.intent ? `<p class="intent">${escapeXml(spec.intent)}</p>` : ""}</header>
<figure role="img" aria-label="${escapeXml(layoutOf(spec).label)}">
${svg(spec)}${captionHtml ? `<figcaption>\n${captionHtml}\n</figcaption>` : ""}</figure>
<nav class="slide-nav" aria-label="Slides">
<a class="prev" href="#${previous}" rel="prev">‹ Previous</a>
<a class="next" href="#${next}" rel="next">Next ›</a>
</nav>
</section>`;
}

/**
 * One deck: every spec a slide, in the order given. The deck's title is `options.title` (the first spec's otherwise),
 * on the first slide and as the document's `<title>`; the description is the specs' titles, in order.
 */
export function deck(specs: readonly Spec[], options: DeckOptions = {}): string {
  const first = specs[0];
  const title = options.title ?? first?.title ?? "A figure deck";
  const lang = first ? layoutOf(first).lang : "en";
  const description = `${specs.length} figure${specs.length === 1 ? "" : "s"}: ${specs
    .map((spec) => spec.title ?? spec.source ?? "A figure")
    .join("; ")}`;
  return `<!doctype html>
<html lang="${escapeXml(lang)}">
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
<body id="top">
<main class="deck">
${specs.map((spec, index) => slide(spec, index, specs.length, title)).join("\n")}
</main>
</body>
</html>
`;
}
