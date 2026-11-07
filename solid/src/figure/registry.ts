// One spec as a layout: rows of items whose lengths are in **cells**, the unit glyph-kit's figures are authored in and
// the terminal's own (terminal/cells.h: 8x16 px). A pixel target multiplies a cell by 8 across and 16 down — the desktop
// and the browser draw exactly the rectangle a cell would cover on the terminal, so one figure is the same shape at
// 360px and at 80 columns, and a fill's edge lands on a cell boundary rather than between two. That is why the layout
// speaks cells and not pixels: a page that asked for pixels could not be re-cut by a factor without moving a bar.
//
// Every drawn thing has an id: `fig-fill-<n>` and `fig-track-<n>` for a bar (the invariant test reads their boxes), the
// text ids for the numbers and the labels, `fig-box-<n>` for a flow's boxes, `fig-state-<n>` for a path's states, and
// `fig-swatch-<hue>-<step>` and `fig-marker-<hue>-<step>` for a palette's cells. A box and a text also carry a `role` —
// step, decision, branch, state, connector, label, note, value, ratio, marker, swatch — so a target or a text renderer
// draws what an item is, not only its cells. The page writes every item's width through the value channel each frame (a
// layout length is data, and a style is a literal): `cells * 8` for a box, `fill * 8` for a bar's fill, a line's own
// height, and a swatch's `#rrggbb` as the box's background — the one colour a figure carries, because a palette documents
// the colours themselves.
//
// This file is the **registry**: the types above, the cell constants, and one table from a kind's name to the two things
// a kind has — its layout and its own checks. It knows no kind by name. A kind registers itself from its area file
// (`kinds/metrics.ts`, `kinds/flows.ts`, `kinds/structure.ts`, `kinds/systems.ts`), which `kinds.ts` loads; the shared
// half a kind builds its rows with is `kinds/shared.ts`. So a kind that has never been heard of by this file, by a
// target or by the text renderer still draws: `layoutOf` looks it up, and `Figure.tsx`, `text.ts` and the terminal
// declare whatever comes back.
//
// The type-level list of the kinds is `KINDS` in spec.ts (a union cannot be built by a call, and a spec's `kind` is a
// literal there); `kinds()` is the runtime one, and `figure-registry.test.ts` holds the two together, holds the
// `unknown kind` sentence to it, and holds a throwaway kind's registration to the draw.
import type { Kind, Spec, Tone } from "./spec.ts";

/** A cell: the terminal's unit, and what the pixel targets multiply by (terminal/cells.h). */
export const CELL_WIDTH = 8;
export const CELL_HEIGHT = 16;
/** The figure's own padding, in cells: two either side, one above and below. */
export const PADDING_X = 2;
export const PADDING_Y = 1;
/** glyph-kit's mark for the focus line, so the figure reads without colour. */
export const FOCUS_MARK = "►";

/** What a figure's text is painted by: a role of the tokens, never a colour. */
export type Paint = "title" | "muted" | "ink" | Tone;

/** What a box is, for a target that draws more than its cells: a step, a decision, the end, a branch, a state. */
export type BoxRole = "step" | "decision" | "end" | "branch" | "state" | "start";
/** What a text is: a label, a connector's glyph, a connector's word, the note under a state machine, a palette's value
 *  or contrast, or a contrast pair's verdict. */
export type TextRole = "label" | "connector" | "connector-label" | "note" | "value" | "ratio" | "verdict";

interface BaseItem {
  /** The id of the box whose width the page writes (the item's cell). */
  id: string;
  /** The item's width, in cells. */
  cells: number;
  paint: Paint;
}
export interface TextItem extends BaseItem {
  kind: "text";
  /** The id of the `text` itself, which is what a focus's colour moves. */
  textId: string;
  text: string;
  role?: TextRole;
  /** The text's own type size in px, on a target that has type: a type scale's specimen. The cells stay the box's. */
  size?: number;
}
export interface BoxItem extends BaseItem {
  kind: "box";
  textId: string;
  text: string;
  role: BoxRole;
}
export interface BarItem extends BaseItem {
  kind: "bar";
  fillId: string;
  fill: number;
}
export interface SpaceItem extends BaseItem {
  kind: "space";
}
/** A palette's step: a `#rrggbb` swatch, the one colour a figure draws as itself (the palette documents the colours). */
export interface SwatchItem extends BaseItem {
  kind: "swatch";
  value: string;
}
/** glyph-kit's `▲`: the first step of a hue that reads as words, a mark a pixel target paints by the `good` role. */
export interface MarkerItem extends BaseItem {
  kind: "marker";
}
/** One point of a sparkline: its eighth of a cell as a `▁`..`█` in text, and a bar of that height on a pixel target. */
export interface SparkItem extends BaseItem {
  kind: "spark";
  /** The bar's id, whose height the page writes: `(eighth + 1) * 2` px of a 16px cell. */
  fillId: string;
  /** The glyph's text id, so the terminal draws the same point the pixel target's bar is. */
  textId: string;
  /** 0 is `▁` (an eighth) and 7 is `█` (the whole cell). */
  eighth: number;
}
/** One cell of a heatmap: one of four shades, `░▒▓█` in text and a step of the shade ramp on a pixel target. */
export interface ShadeItem extends BaseItem {
  kind: "shade";
  /** 0 is the lightest, 3 the darkest; what a value's band is (see kinds/charts.ts). */
  level: 0 | 1 | 2 | 3;
}
export type Item = TextItem | BoxItem | BarItem | SpaceItem | SwatchItem | MarkerItem | SparkItem | ShadeItem;
export interface LayoutLine {
  /** The box's id, so a line's own height can travel the value channel (a type scale's rows are not all one cell).
   *  `finish` numbers them `fig-line-<n>`, the title and the source included. */
  id?: string;
  items: Item[];
  /** The line's height in cells: one unless a kind needs more (a 40px type row is three). */
  height?: number;
}

/** One drawn box, in the layout's own record: the invariant test's count and a target's role. */
export interface BoxRecord {
  id: string;
  textId: string;
  text: string;
  role: BoxRole;
}

/** One connector the data asked for: a decision's branch, or a transition the path walks. */
export interface Connector {
  /** The text id of the drawn connector run: its glyph and its word, in one item. */
  textId: string;
  text: string;
  from: string;
  to: string;
  role: "branch" | "transition";
}

/** One drawn bar, in cells: the invariant test's own record of what the frame should hold. */
export interface Bar {
  fillId: string;
  trackId: string;
  textId: string;
  label: string;
  value: number;
  /** The ratio's denominator: `options.max` for a bar chart, the first step for a funnel, the column's max for compare. */
  max: number;
  fill: number;
  track: number;
  text: string;
}

/** One swatch of a palette: the step's colour, its contrast on the page, and whether the row marks it. */
export interface Swatch {
  id: string;
  /** The value text's id, so the frame's own number is what a check reads. */
  textId: string;
  hue: string;
  step: string;
  value: string;
  /** The step's contrast on the page, computed: `contrastOf(value, page)`. */
  contrast: number;
  marked: boolean;
}

/** One pair of a contrast figure: its ratio, the floor it is held to and the verdict the row draws. */
export interface Pair {
  textId: string;
  label: string;
  ratio: number;
  min: number;
  pass: boolean;
  verdictId: string;
}

export interface Layout {
  kind: Kind;
  /** The content's width in cells; the root adds the padding. */
  width: number;
  lines: LayoutLine[];
  bars: Bar[];
  /** The label texts in the data's order, for the order invariant. */
  labels: { textId: string; text: string }[];
  /** The spine's boxes — a flow's steps, a state machine's path — in drawing order. */
  boxes: BoxRecord[];
  /** A decision's branch and a path's transitions: one a branch or transition the data names. */
  connectors: Connector[];
  /** A palette's steps, one a swatch, in the figure's order. */
  swatches: Swatch[];
  /** A contrast figure's pairs, one a row. */
  pairs: Pair[];
  focus?: { on: string[]; tone: Tone; say?: string };
}

/**
 * What a kind is, in one place: its layout, its own refusals, and (when they are not the data's own row labels) the
 * names a focus may point at. `check` and `names` read the raw `data` and `options` of a spec that did not pass the
 * check, so a refusal can name the field that is wrong instead of a type that never existed.
 */
export interface KindEntry<S extends Spec = Spec> {
  /** One checked spec as rows of items, in cells. */
  readonly layout: (spec: S) => Layout;
  /** Every problem with this kind's data, in sentences. */
  readonly check: (data: unknown, options: unknown) => string[];
  /** The names a focus may point at, when the data's row labels are not them. */
  readonly names?: (data: unknown, options: unknown) => string[];
}

const entries = new Map<string, KindEntry>();

/**
 * A kind joins the table. The area file that holds it calls this once, with the load of its module, and the `kind` is
 * checked against the spec's own `kind` so a typo is a type error and a second registration a failure at load.
 */
export function register<S extends Spec>(kind: S["kind"], entry: KindEntry<S>): void {
  if (entries.has(kind)) throw new Error(`the figure registry already has a ${kind}`);
  // the entry is keyed by the spec's own `kind`, so the erased signature is this lookup's contract (see `layoutOf`)
  entries.set(kind, entry as KindEntry);
}

/** Every kind registered, by name: the list the `unknown kind` sentence and the docs print. */
export const kinds = (): string[] => [...entries.keys()].sort();

/** One kind's entry, or nothing: `check` refuses an unknown kind before it looks one up. */
export const entryOf = (kind: string): KindEntry | undefined => entries.get(kind);

const entryOfKind = (kind: string): KindEntry => {
  const entry = entries.get(kind);
  if (!entry) throw new Error(`no figure kind ${JSON.stringify(kind)} is registered: is its area file in kinds.ts?`);
  return entry;
};

/** The layout of a checked spec: the one lookup a target and the text renderer make. */
export const layoutOf = (spec: Spec): Layout => entryOfKind(spec.kind).layout(spec);

/** A kind's own refusals, over the raw data of a spec that is not a `Spec` yet. */
export const checkOf = (kind: string, data: unknown, options: unknown): string[] =>
  entryOfKind(kind).check(data, options);

/** The names a focus may point at, when the kind has its own (the data's row labels otherwise). */
export const namesOf = (kind: string, data: unknown, options: unknown): string[] | undefined =>
  entryOfKind(kind).names?.(data, options);

/** The page's size in pixels: the cells times the cell, the padding, and each line's own height (a type scale's rows). */
export function sizeOf(spec: Spec): { width: number; height: number } {
  const l = layoutOf(spec);
  const rows = l.lines.reduce((n, line) => n + (line.height ?? 1), 0);
  return {
    width: (l.width + 2 * PADDING_X) * CELL_WIDTH,
    height: (rows + 2 * PADDING_Y) * CELL_HEIGHT,
  };
}
