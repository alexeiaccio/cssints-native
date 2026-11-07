// The half every kind builds its rows with: the cell helpers, the item builders, and the raw-JSON readers a check reads
// a spec's data with before it is a spec. A kind's area file imports this and nothing else that draws, so two kinds that
// genuinely share a helper share this file's one copy of it (a copy per area is what this file exists to prevent).
//
// `finish` is the frame: the SAMPLE DATA band above (when the spec says `sample`), the title, the rows a kind made, the
// source and the `►` focus line below, each widening the figure, and every line numbered `fig-line-<n>`. A kind's layout
// function therefore writes only its own rows.
import type { Bar, BoxRecord, Connector, Layout, LayoutLine, Paint, Pair, Swatch, TextItem, TextRole } from "../registry.ts";
import { FOCUS_MARK } from "../registry.ts";
import type { Spec, TreeNode } from "../spec.ts";

// ---- the raw data of a spec, read before the check has made it a Spec -------------------------------------------------

export type Json = Record<string, unknown>;
export const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
export const rowsOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const labelOf = (row: unknown, i: number): string => {
  const label = isObject(row) ? row.label : undefined;
  return typeof label === "string" && label ? label : `row ${i + 1}`;
};
export const number = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
export const say = (v: unknown) => (typeof v === "string" ? `"${v}"` : v === undefined ? "nothing" : JSON.stringify(v));

// ---- cells -------------------------------------------------------------------------------------------------------------

export const cells = (text: string): number => [...text].length;
export const longest = (values: readonly string[]): number => Math.max(0, ...values.map(cells));

/** The east Asian ranges whose glyphs take two cells: the simple test this file uses, not a Unicode table. */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
];

/** One code point's width: 2 in the wide ranges, 1 otherwise. A combining mark is one cell here (labels are prose, not a
 *  typesetter; the kit's own `text.mjs` segments graphemes, which this file does not need to). */
function codeWidth(code: number): number {
  for (const [from, to] of WIDE) if (code >= from && code <= to) return 2;
  return 1;
}

/** A string's width in display cells: what the terminal and a monospace fence count, not JS characters. A layout's
 *  `cells` is this width (`text.ts` re-exports it), so a CJK table cell is two cells wide and its column is too. */
export function cellWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += codeWidth(ch.codePointAt(0) ?? 0);
  return width;
}

/** `text` cut to `width` display cells, `…` (one cell) at the cut — a table's cell is cells wide, not bytes. `width`
 *  below one gives `…` alone. */
export function truncate(text: string, width: number): string {
  if (cellWidth(text) <= width) return text;
  let out = "";
  let used = 0;
  for (const ch of text) {
    const w = codeWidth(ch.codePointAt(0) ?? 0);
    if (used + w > width - 1) break;
    out += ch;
    used += w;
  }
  return `${out}…`;
}

/** A number as the figure prints it: 12400 is "12,400", 0.077 stays "0.077". */
export function formatValue(value: number): string {
  if (!Number.isInteger(value)) return String(value);
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A tree's data as one nested root. A flat parent/child list is resolved to children by name; the check has already
 *  refused a list with no root, a missing parent or a loop, so a caller draws only a tree that can be drawn. */
export function treeRoot(data: unknown): TreeNode | undefined {
  if (isObject(data) && !Array.isArray(data)) return data as unknown as TreeNode;
  if (!Array.isArray(data)) return undefined;
  const nodes = data.filter(isObject) as unknown as TreeNode[];
  const root = nodes.find((node) => !node.parent);
  if (!root) return undefined;
  const children = new Map<string, TreeNode[]>();
  for (const node of nodes) {
    if (!node.parent) continue;
    const list = children.get(node.parent);
    if (list) list.push(node);
    else children.set(node.parent, [node]);
  }
  const build = (node: TreeNode): TreeNode => {
    const kids = children.get(node.name) ?? [];
    return kids.length ? { name: node.name, children: kids.map(build) } : { name: node.name };
  };
  return build(root);
}

// ---- the bar's geometry ------------------------------------------------------------------------------------------------

/** The text a row's number prints: its own, or the value formatted (with "+" when it runs past the scale). */
export const numberText = (row: { value: number; text?: string }, max: number): string =>
  row.text ?? `${formatValue(row.value)}${row.value > max ? "+" : ""}`;

/** A bar's fill, in whole cells: value/max of the track, at least one cell for a positive value. */
export function fillOf(value: number, max: number, track: number): number {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.max(1, Math.min(track, Math.round((track * value) / max)));
}

/** An exact fill, in cells: no "at least one cell" floor, because a spacing scale's 4px step *is* half a cell. */
export const exactFill = (value: number, max: number, track: number): number =>
  value > 0 && max > 0 && track > 0 ? Math.min(track, (track * value) / max) : 0;

// ---- the connectors ----------------------------------------------------------------------------------------------------

/** The glyphs our cells and pixels both have: Roboto has no │ ─ ► ▼ → (ThorVG has no fallback), so the connectors are
 *  ASCII and the same figure reads on all three targets. */
export const GLYPH = { down: "v", right: ">", vertical: "|", line: "-" } as const;
/** A branch's run to its box: one cell of label either side, so "no" reads inside the line. */
export const arrowOf = (label: string): string => `${GLYPH.line}${GLYPH.line} ${label} ${GLYPH.line}${GLYPH.line}${GLYPH.right}`;

// ---- the focus and the items -------------------------------------------------------------------------------------------

export const focusOf = (spec: Spec): Layout["focus"] => {
  const focus = spec.focus;
  if (!focus) return undefined;
  const on = typeof focus.on === "string" ? [focus.on] : [...focus.on];
  return { on, tone: focus.tone ?? "plain", say: focus.say };
};

/** The paint a row's label takes: its focus's role, or the ink every other row is. */
export const paintOf = (focus: Layout["focus"], label: string): Paint => {
  if (!focus || !focus.on.includes(label)) return "ink";
  return focus.tone === "plain" ? "ink" : focus.tone;
};

export const textItem = (id: string, text: string, width: number, paint: Paint, role?: TextRole): TextItem => ({
  kind: "text",
  id: `${id}-cell`,
  textId: id,
  text,
  cells: width,
  paint,
  ...(role === undefined ? {} : { role }),
});

/**
 * The SAMPLE DATA stamp: a band of `=` between `+` caps across the figure's own width, a cell of air either side of the
 * words, in the muted role. It is the layout's, so the text half, the terminal, the pixel frame and the SVG all draw it
 * from these cells and none of them knows about `sample`.
 */
function stampLine(width: number): LayoutLine {
  const words = " SAMPLE DATA ";
  let band = "SAMPLE DATA";
  if (width >= words.length + 2) {
    const fill = width - words.length - 2;
    const left = Math.floor(fill / 2);
    band = `+${"=".repeat(left)}${words}${"=".repeat(fill - left)}+`;
  }
  return { items: [textItem("fig-sample", band, width, "muted")] };
}

/** The cells every kind shares: the SAMPLE DATA band (when the spec says `sample`), the title, the source and the focus
 *  line, each widening the figure. */
export function finish(
  spec: Spec,
  kind: Layout["kind"],
  width: number,
  lines: LayoutLine[],
  bars: Bar[],
  labels: Layout["labels"],
  boxes: BoxRecord[] = [],
  connectors: Connector[] = [],
  swatches: Swatch[] = [],
  pairs: Pair[] = [],
): Layout {
  const focus = focusOf(spec);
  const focusLine = focus ? `${FOCUS_MARK} ${focus.say ?? focus.on.join(", ")}` : undefined;
  const w = Math.max(
    width,
    longest([spec.title ?? "", spec.source ?? "", focusLine ?? ""]),
    spec.sample ? " SAMPLE DATA ".length + 2 : 0,
  );
  const out: LayoutLine[] = [];
  if (spec.sample) out.push(stampLine(w));
  if (spec.title) out.push({ items: [textItem("fig-title", spec.title, w, "title")] });
  out.push(...lines);
  if (spec.source) out.push({ items: [textItem("fig-source", spec.source, w, "muted")] });
  if (focus && focusLine)
    out.push({ items: [textItem("fig-focus", focusLine, w, focus.tone === "plain" ? "ink" : focus.tone)] });
  const numbered = out.map((line, i) => (line.id === undefined ? { ...line, id: `fig-line-${i}` } : line));
  // the two fields a screen reader reads, not a row: the label is the name the title gives when absent, and the page is
  // English unless the spec says otherwise
  const label = spec.label ?? spec.title ?? "A figure";
  const lang = spec.lang ?? "en";
  return { kind, width: w, lines: numbered, bars, labels, boxes, connectors, swatches, pairs, focus, label, lang };
}

/** A bar row: the label's cell, the track (with its fill), and the number's cell. */
export function barLine(
  i: number,
  label: string,
  fill: number,
  track: number,
  text: string,
  textWidth: number,
  labelWidth: number,
  paint: Paint,
): LayoutLine {
  return {
    items: [
      textItem(`fig-label-${i}`, label, labelWidth, paint),
      { kind: "bar", id: `fig-track-${i}`, fillId: `fig-fill-${i}`, cells: track, fill, paint },
      textItem(`fig-num-${i}`, text, textWidth, paint),
    ],
  };
}
