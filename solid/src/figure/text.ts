// The text half of a figure: one spec, one layout (`./kinds.ts`), and the characters a README, a pull request or a model
// can read. It reads the **layout** and never a kind's data, so a new kind is drawn the moment `layout` returns its rows:
// an item's `cells` is its width, a bar's track and fill are its length, and a box is `[its label]` in exactly its cell.
//
// The shape is glyph-kit's (`render/text.mjs`, `render/focus.mjs`): the title above, one line a row, the number as text
// on the right, the `►` line with the focus's own sentence, the source under it. A bar is `█` and an **eighth block**
// (`▏▎▍▌▋▊▉`) for the fraction of a cell its value leaves, so 3.5 cells of a track reads `███▌` here and fills three and
// a half cells on the pixel targets. `compact` is the same drawing in plain ASCII (`#` full, `=` a partial cell, `>` the
// focus mark), for a model's context. A line is cut at the width it is given, counted in display cells, and says so with
// `…`; labels wider than a cell (CJK) are counted two — see `cellWidth`.
//
// `markdown` is one figure as a page: `## title`, the intent, the fence with the rows, then `_source_`. `redrawDoc` is the
// discipline the docs keep: a `<!-- glyph-kit: path/to/spec.json -->` line, a ```text fence under it, and the fence is
// always what `render` makes of that spec — so a doc's figure cannot drift from its spec (test.sh cmps the redraw).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { layoutOf, type Bar, type Item, type Layout, type LayoutLine } from "./kinds.ts";
import { cellWidth, truncate } from "./kinds/shared.ts";
import { parse, type Spec } from "./spec.ts";

/** The eighth blocks, 1/8 of a cell wide to 7/8: a bar's fractional cell, as glyph-kit draws it. */
export const EIGHTHS = "▏▎▍▌▋▊▉";
/** The eighth blocks standing up, 1/8 of a cell high to the whole cell: a sparkline's point. */
export const SPARK = "▁▂▃▄▅▆▇█";
/** A heatmap's four shades, the lightest to the darkest. */
export const SHADES = "░▒▓█";
/** glyph-kit's mark for the focus line (re-exported from kinds.ts, which the pixel page also uses). */
export { FOCUS_MARK } from "./kinds.ts";

/** The plain-ASCII form of every glyph the renderer draws (`compact`). One character a cell, as glyph-kit's own. */
export const COMPACT: Readonly<Record<string, string>> = {
  "█": "#",
  "▏": "=",
  "▎": "=",
  "▍": "=",
  "▌": "=",
  "▋": "=",
  "▊": "=",
  "▉": "=",
  "►": ">",
  "▲": "*",
  "▁": "_",
  "▂": "_",
  "▃": "_",
  "▄": "_",
  "▅": "_",
  "▆": "_",
  "▇": "_",
  "░": ".",
  "▒": ":",
  "▓": "+",
  "…": ".",
};

/** A string's width in display cells, `kinds/shared.ts`'s (a table's column and the text half count the same cells). */
export { cellWidth };

/**
 * A bar's drawn length: whole cells, the eighth its fraction rounds to, and the cells that left. `bar.value / bar.max`
 * of `bar.track` is the exact length; the layout stores the rounded whole (`bar.fill`), so the remainder is the ratio's
 * here. An eighth that rounds to a whole cell is that cell (no block). The layout's whole cell is the terminal's count:
 * where the two would be more than half a cell apart — only the "a positive value draws one cell" floor, below half a
 * cell — the layout wins, so a text bar and the terminal's cells are never further than the pixel figure's own half cell.
 */
export function fillBlocks(bar: Bar): { full: number; eighths: number; cells: number } {
  if (!(bar.value > 0) || !(bar.max > 0) || !(bar.track > 0)) return { full: 0, eighths: 0, cells: 0 };
  const exact = Math.min(bar.track, (bar.track * bar.value) / bar.max);
  let full = Math.floor(exact);
  let eighths = Math.round((exact - full) * 8);
  if (eighths === 8) {
    full += 1;
    eighths = 0;
  }
  if (Math.abs(full + eighths / 8 - bar.fill) > 0.5) {
    full = bar.fill;
    eighths = 0;
  }
  return { full, eighths, cells: full + eighths / 8 };
}

const padEnd = (text: string, cells: number) => text + " ".repeat(Math.max(0, cells - cellWidth(text)));
const padStart = (text: string, cells: number) => " ".repeat(Math.max(0, cells - cellWidth(text))) + text;

/** A bar as characters: its whole cells, its eighth, spaces to the end of its track. */
function barText(bar: Bar, cells: number): string {
  const { full, eighths } = fillBlocks(bar);
  const art = "█".repeat(full) + (eighths ? (EIGHTHS[eighths - 1] ?? "") : "");
  return art + " ".repeat(Math.max(0, cells - full - (eighths ? 1 : 0)));
}

/** One item as characters: a text padded to its cell, a box `[so]`, a bar, a swatch, a marker, or a space. */
function itemText(item: Item, bars: ReadonlyMap<string, Bar>, afterMeasure: boolean): string {
  if (item.kind === "bar") {
    const bar = bars.get(item.fillId);
    return bar ? barText(bar, item.cells) : " ".repeat(item.cells);
  }
  if (item.kind === "space") return " ".repeat(item.cells);
  if (item.kind === "box") return padEnd(`[${item.text}]`, item.cells);
  // a palette's two: a swatch is glyph-kit's `██` in its cells (the colour is the data, and a cell has none), and the
  // mark of the first step that reads as words is its `▲` — a pixel target paints the same cell by the `good` role
  if (item.kind === "swatch") return padEnd("██".repeat(Math.ceil(item.cells / 2)).slice(0, item.cells), item.cells);
  if (item.kind === "marker") return padEnd("▲", item.cells);
  // a sparkline's point stands up in its cell, and a heatmap's cell is its band's shade repeated across it
  if (item.kind === "spark") return padEnd(SPARK[item.eighth] ?? "", item.cells);
  if (item.kind === "shade") return padEnd((SHADES[item.level] ?? "").repeat(item.cells), item.cells);
  // a number's own cell is right-aligned (glyph-kit's numbers on the right); a label and a heading read from the left
  return afterMeasure ? padStart(item.text, item.cells) : padEnd(item.text, item.cells);
}

/** A layout line as characters, with its trailing blanks dropped (a fence does not need them). */
function lineText(line: LayoutLine, bars: ReadonlyMap<string, Bar>): string {
  let out = "";
  let afterMeasure = false;
  for (const item of line.items) {
    out += itemText(item, bars, afterMeasure);
    // a number reads against the bar it measures: the cell after a bar is right-aligned, and only a bar does that
    afterMeasure = item.kind === "bar";
  }
  return out.replace(/ +$/, "");
}

const compactText = (text: string): string =>
  [...text].map((ch) => COMPACT[ch] ?? ch).join("");

export interface TextOptions {
  /** The line at most this many display cells wide; 80 by default (a README's fence). */
  readonly width?: number;
  /** Plain ASCII: `#` a full cell, `=` a partial one, `>` the focus mark. */
  readonly compact?: boolean;
}

/** The layout's lines as text. `drop` names text ids a form leaves out (markdown's heading and source). */
function linesOf(spec: Spec, options: TextOptions, drop: ReadonlySet<string> = new Set()): string[] {
  const width = options.width ?? 80;
  const l: Layout = layoutOf(spec);
  const bars = new Map(l.bars.map((bar) => [bar.fillId, bar]));
  return l.lines
    .filter((line) => !drop.has(line.items[0]?.textId ?? ""))
    .map((line) => truncate(lineText(line, bars), width));
}

/** One spec as text: the title, a line a row, the source, the `►` line. */
export function render(spec: Spec, options: TextOptions = {}): string {
  const text = linesOf(spec, options).join("\n");
  return options.compact ? compactText(text) : text;
}

/**
 * One spec as Markdown: `## title`, the intent, a ```text fence with the rows and the `►` line, `_source_` under it. The
 * title is the heading and the source is the italic line, so neither is repeated inside the fence.
 */
export function markdown(spec: Spec, options: TextOptions = {}): string {
  const body = linesOf(spec, options, new Set(["fig-title", "fig-source"])).join("\n");
  const fence = options.compact ? compactText(body) : body;
  const out: string[] = [];
  if (spec.title) out.push(`## ${spec.title}`, "");
  if (spec.intent) out.push(spec.intent, "");
  out.push("```text", fence, "```");
  if (spec.source) out.push("", `_${spec.source}_`);
  return `${out.join("\n")}\n`;
}

const REF = /^<!--\s*glyph-kit:\s*(\S+)\s*-->$/;

/**
 * A Markdown file with every figure drawn again from the spec on the line above its fence. A fence is ```text and runs to
 * the next ``` alone; the spec path is relative to the document, as glyph-kit resolves it. A spec that `parse` refuses
 * throws with the file and the sentences, so a doc's figure cannot be left at a spec that would not draw.
 */
export function redrawDoc(source: string, file: string, options: TextOptions = {}): string {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const ref = lines[i]?.match(REF);
    if (!ref || lines[i + 1] !== "```text") continue;
    const end = lines.indexOf("```", i + 2);
    if (end < 0) throw new Error(`${file}:${i + 1}: the figure's fence is not closed`);
    const path = resolve(dirname(file), ref[1]!);
    const parsed = parse(readFileSync(path, "utf8"), { dir: dirname(path) });
    if (!parsed.spec) throw new Error(`${file}:${i + 1}: ${parsed.problems.join(" ")}`);
    const body = render(parsed.spec, options).split("\n");
    lines.splice(i + 2, end - (i + 2), ...body);
    i = i + 2 + body.length;
  }
  return lines.join("\n");
}
