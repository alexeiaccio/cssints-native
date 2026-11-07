// A figure as one standalone SVG: the same layout `./kinds.ts` gives the desktop, the terminal and the browser, drawn
// once and with no host under it — no external font, no script, no build step. It reads the **layout** and no kind's
// data, exactly as `../text.ts` does, so a new kind draws here the moment `layout` returns its rows: a box is a
// `<rect>`, a bar its track and fill, a text a `<text>` at its baseline, a swatch its own `#rrggbb`, a marker a small
// triangle, and a space nothing.
//
// The unit is the cell: the `viewBox` is cells × 8 across and 16 down (the padding included), and every `x` and `width`
// is `cells * CELL_WIDTH` or `fill * CELL_WIDTH` with no rounding. `scale` multiplies the page's rendered size (2 for a
// 2× export); `width` sets it in pixels and wins over `scale`. Either way the viewBox stays the layout's pixels, so a
// viewer can scale the file without moving a bar.
//
// Every role gets a CSS class as well as a literal dark `fill`: standalone, the literal is the page's dark palette
// (`app/Figure.styles.ts`' tokens); inline, the HTML page's `.fig-*` rules re-colour it for light, dark, print and
// forced-colors. The one colour a figure carries as itself is a palette's swatch, and it is never themed.
//
// Text is XML-escaped (`&` → `&amp;`, `<` → `&lt;`, `“` is fine), so a label may hold any character a spec's JSON can.
// `font-family` names Roboto with a Helvetica/Arial/sans-serif fallback: the file ships no font, so a viewer without
// Roboto measures `Aa` with its own fallback — the geometry (the cells, the bars, the boxes) does not move.
import {
  CELL_HEIGHT,
  CELL_WIDTH,
  PADDING_X,
  PADDING_Y,
  layoutOf,
  sizeOf,
  type Layout,
  type Paint,
} from "../kinds.ts";
import type { Spec } from "../spec.ts";

/** The page's palette, `rgb()` channels as hex: the dark theme `app/Figure.styles.ts` opens with. */
const PAGE = "#101316";
const PANEL = "#1b2026";
const INK = "#e6e9ec";
const MUTED = "#8b98a5";
const ACCENT = "#3b9cf0";
const LINE = "#2d333d";
const PROBLEM = "#e63c3c";
const GOOD = "#5abe78";

/** One role's class, literal fill and type size: what a `<text>` is drawn with, and what the page may re-colour. */
const ROLE: Record<Paint, { cls: string; fill: string; size: number }> = {
  title: { cls: "fig-ink fig-title", fill: INK, size: 16 },
  muted: { cls: "fig-muted", fill: MUTED, size: 12 },
  ink: { cls: "fig-ink", fill: INK, size: 13 },
  problem: { cls: "fig-problem", fill: PROBLEM, size: 13 },
  good: { cls: "fig-good", fill: GOOD, size: 13 },
};

const FONT = "Roboto, Helvetica, Arial, sans-serif";

export interface SvgOptions {
  /** The rendered width in pixels; the height follows the layout's aspect. Wins over `scale`. */
  readonly width?: number;
  /** The rendered size as a multiple of the layout's pixels: 2 for a 2× export. */
  readonly scale?: number;
}

/** XML text: the five characters that would break the file, and nothing else. */
export const escapeXml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** A number as an SVG attribute: the layout's own value, unrounded, so a fill's edge is not a decimal place short. */
const px = (value: number): string => String(value);

/** A line's baseline in its own height, for a text of `size`: the cell centres the type, as the page's cell does. */
const baseline = (top: number, height: number, size: number): number => top + (height + size) / 2 - 2;

/** One text item, at `x`, inside a line of `height`. */
function textAt(
  item: { textId: string; text: string; paint: Paint; size?: number },
  x: number,
  top: number,
  height: number,
): string {
  const role = ROLE[item.paint];
  const size = item.size ?? role.size;
  const cls = item.size === undefined ? role.cls : "fig-ink fig-specimen";
  const y = item.size === undefined ? baseline(top, height, size) : top + size * 0.8;
  return (
    `<text id="${escapeXml(item.textId)}" class="fig-text ${cls}" x="${px(x)}" y="${px(y)}" ` +
    `font-family="${FONT}" font-size="${px(size)}" fill="${role.fill}" xml:space="preserve">${escapeXml(item.text)}</text>`
  );
}

/**
 * One spec as a standalone `<svg>`. The root carries the layout's viewBox, the title as its accessible name and a
 * `<title>`/`<desc>`, and one element a drawn item: a box a `<rect>` and its `<text>`, a bar a track and a fill, a text
 * a `<text>`, a swatch a `<rect>` in its own colour, a marker a triangle, a space nothing.
 */
export function svg(spec: Spec, options: SvgOptions = {}): string {
  const l: Layout = layoutOf(spec);
  const size = sizeOf(spec);
  const scale = options.scale ?? 1;
  const width = options.width ?? size.width * scale;
  const height = (width / size.width) * size.height;
  const label = spec.title ?? spec.source ?? "A figure";
  const desc = [spec.intent, spec.source].filter((line): line is string => Boolean(line)).join(" — ");
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px(width)}" height="${px(height)}" ` +
      `viewBox="0 0 ${px(size.width)} ${px(size.height)}" role="img" aria-label="${escapeXml(label)}">`,
    `<title>${escapeXml(label)}</title>`,
  ];
  if (desc) out.push(`<desc>${escapeXml(desc)}</desc>`);
  out.push(
    `<rect class="fig-page" x="0" y="0" width="${px(size.width)}" height="${px(size.height)}" fill="${PAGE}"/>`,
  );

  const bars = new Map(l.bars.map((bar) => [bar.fillId, bar]));
  let top = PADDING_Y * CELL_HEIGHT;
  for (const line of l.lines) {
    const height = (line.height ?? 1) * CELL_HEIGHT;
    let cells = PADDING_X;
    for (const item of line.items) {
      const x = cells * CELL_WIDTH;
      const w = item.cells * CELL_WIDTH;
      if (item.kind === "text") out.push(textAt(item, x, top, height));
      else if (item.kind === "box") {
        out.push(
          `<rect id="${escapeXml(item.id)}" class="fig-box fig-box--${escapeXml(item.role)}" x="${px(x)}" y="${px(top)}" ` +
            `width="${px(w)}" height="${px(CELL_HEIGHT)}" fill="${PANEL}"/>`,
        );
        // the page's box has one cell of left padding, so the label starts a cell in
        out.push(textAt({ textId: item.textId, text: item.text, paint: item.paint }, x + CELL_WIDTH, top, height));
      } else if (item.kind === "bar") {
        const bar = bars.get(item.fillId);
        const fill = item.paint === "problem" ? "fig-fill--problem" : item.paint === "good" ? "fig-fill--good" : "fig-fill--plain";
        out.push(
          `<rect id="${escapeXml(item.id)}" class="fig-track" x="${px(x)}" y="${px(top)}" width="${px(w)}" ` +
            `height="${px(CELL_HEIGHT)}" fill="${LINE}"/>`,
        );
        out.push(
          `<rect id="${escapeXml(item.fillId)}" class="fig-fill ${fill}" x="${px(x)}" y="${px(top)}" ` +
            `width="${px((bar?.fill ?? 0) * CELL_WIDTH)}" height="${px(CELL_HEIGHT)}" ` +
            `fill="${item.paint === "problem" ? PROBLEM : item.paint === "good" ? GOOD : ACCENT}"/>`,
        );
      } else if (item.kind === "swatch") {
        out.push(
          `<rect id="${escapeXml(item.id)}" class="fig-swatch" x="${px(x)}" y="${px(top)}" width="${px(w)}" ` +
            `height="${px(CELL_HEIGHT)}" fill="${escapeXml(item.value)}" stroke="none"/>`,
        );
      } else if (item.kind === "marker") {
        const cx = x + w / 2;
        const cy = top + CELL_HEIGHT / 2;
        out.push(
          `<polygon id="${escapeXml(item.id)}" class="fig-marker" ` +
            `points="${px(cx)},${px(cy - 4)} ${px(cx - 4)},${px(cy + 4)} ${px(cx + 4)},${px(cy + 4)}" fill="${GOOD}"/>`,
        );
      }
      cells += item.cells;
    }
    top += height;
  }
  out.push("</svg>");
  return `${out.join("\n")}\n`;
}
