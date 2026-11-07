// The wireframe area: a page's own last frame, cut into the cell grid. Seven kinds, one file, their layouts and their
// refusals side by side, because that is what a kind costs here (a layout, a check, one `register` at the bottom):
//
//   screen          one page (its name and its size) as boxes and text runs, at 1/8 of a cell across and 1/16 down
//   anatomy         one region of that page with numbered callouts and their legend — a component drawing, in cells
//   appShell        a page's own shell bands, each the element the frame drew, labelled with that element's name
//   cardGrid        a page's repeated cards, each at its own box with its index, and the grid its boxes make
//   listDetail      a page's list pane and its detail pane, each the element the frame drew, tiling the page
//   modal           the Dialog's frame with its modal open: the scrim, the panel and the page under them
//   responsivePair  the same page captured at two widths, side by side when they fit, above/below when they do not
//
// The data is **not a drawing**: `solid/specs/from-page.ts` and `solid/specs/from-frames.ts` capture each page with
// `solid/dump.ts`'s `capture` — the same call the goldens are stored with — and write the frame's own boxes and texts into
// the spec. `solid/test.sh` regenerates those specs into a temp dir and `cmp`s them, so a page's layout change changes the
// wireframe in the same commit. A spec's `source` names the page and the size it was captured at.
//
// What counts as a box, and what is skipped:
//   — `rectangle` and `border` commands are the boxes. A rectangle is a filled panel, a border is a line, and either way
//     the page drew a rectangle there; the wireframe outlines it. A box the page draws twice (a filled row and its ring,
//     the same box) is two commands and two boxes here: the capture's count is the count.
//   — a box whose cells round below 2 across or 1 down is skipped: `round(width/8)` of a 1px rule is 0, and there is no
//     outline to draw in no cells. A 20x20 control is 3x1 cells and is drawn as one `+--+` row: a panel one cell tall.
//   — `text` commands are the page's own runs, in the page's order (top-down, then left-to-right as Clay laid them out).
//   — `image`, `scissor-start`/`-end`, `overlay-color-start`/`-end` and `custom` are skipped: an image is not a rectangle
//     (its box is the picture, not a panel), a scissor is a clip, an overlay is a blend, and a custom command is the host's.
//
// The reconciliation is the whole honesty of the kind: a cell is the terminal's 8x16px (registry.ts, terminal/cells.h),
// so a box's cell rect is `round(x/8)`, `round(y/16)`, `round(w/8)`, `round(h/16)` of the page's own box. One cell across
// is 8px, one down is 16px, so a wireframe at 1/8 scale is **not pixel-accurate**: an edge is up to half a cell out (4px
// across, 8px down), a 4px inset does not exist, and a 1px rule rounds away. The text half says the same thing about
// runs: one cell holds one character, a wide (CJK) character two, and a run with less room than its cells ends in `…`.
//
// A wireframe is drawn with ASCII (`+ - |`) because Roboto has no box-drawing glyph and ThorVG has no fallback (the same
// reason flows.ts's connectors are ASCII). A border run is a `connector` role (muted) and the page's own run a `label`
// (ink), so the pixel targets paint a line drawing and its words, not one grey rectangle.
import type { BoxRecord, Item, Layout, LayoutLine, Paint, TextRole } from "../registry.ts";
import { register } from "../registry.ts";
import type {
  AnatomyCrop,
  AnatomySpec,
  AppShellSpec,
  CardGridSpec,
  ListDetailSpec,
  ListPane,
  ModalSpec,
  ResponsivePairSpec,
  ScreenSpec,
  WireBox,
  WireSide,
  WireText,
} from "../spec.ts";
import { cells, finish, isObject, number, rowsOf, say, textItem, type Json } from "./shared.ts";

/** The pages `solid/dump.ts` captures: a static page at rest, with no loader and no argument of its own. `figure` is
 *  not one: a wireframe of the wireframe's own page would recurse through a spec the frame has not drawn yet. */
export const KNOWN_PAGES = ["dialog", "list", "sensors", "sheet", "sky", "widgets"] as const;

/** One command of a captured frame, as much of it as a wireframe reads. */
export interface WireCommand {
  type: string;
  box: readonly number[];
  text?: string;
}

/** The most a wireframe may be drawn at, when a spec does not say: a README's fence. */
const DEFAULT_WIDTH = 80;
/** The cells between the two halves of a pair drawn side by side. */
const PAIR_GAP = 2;

/** One cell's width and height, in the page's pixels (registry.ts's constants, restated so this file has no other
 *  dependency on the cell grid than the numbers a reader can check). */
const CELL_X = 8;
const CELL_Y = 16;

/** The east Asian ranges `text.ts` gives two cells: a run's width must be that width, not its `length`. */
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

/** One code point's width: 2 in the wide ranges, 1 otherwise (text.ts's `cellWidth`, copied here so this file imports
 *  no renderer; `figure-wireframe.test.ts` holds the copy to it on every page run). */
function codeWidth(code: number): number {
  for (const [from, to] of WIDE) if (code >= from && code <= to) return 2;
  return 1;
}

/** A string's width in display cells. */
export function wireCells(text: string): number {
  let width = 0;
  for (const ch of text) width += codeWidth(ch.codePointAt(0) ?? 0);
  return width;
}

/** A box's cell rect: the layout's unit, and the reconciliation the kind documents. */
export interface CellBox extends WireBox {
  col: number;
  row: number;
  cols: number;
  rows: number;
}
export const cellBox = (box: WireBox): CellBox => ({
  ...box,
  col: Math.round(box.x / CELL_X),
  row: Math.round(box.y / CELL_Y),
  cols: Math.max(1, Math.round(box.width / CELL_X)),
  rows: Math.max(1, Math.round(box.height / CELL_Y)),
});

/**
 * A captured frame as the data a wireframe draws: its boxes and its texts, with the commands this kind does not draw
 * left out (see the header). `from-page.ts` writes it and the test reads it back from another capture, so the spec's
 * stream is the page's, not a transcription of it.
 */
export function frameOf(commands: readonly WireCommand[]): { boxes: WireBox[]; texts: WireText[] } {
  const boxes: WireBox[] = [];
  const texts: WireText[] = [];
  for (const command of commands) {
    if (!Array.isArray(command.box) || command.box.length < 4) continue;
    const [x, y, width, height] = command.box.map(Number) as [number, number, number, number];
    if (![x, y, width, height].every(Number.isFinite)) continue;
    if (command.type === "rectangle" || command.type === "border") {
      // a rule under a cell rounds to no outline: a 1px line is 0 rows, and 4px across is half a cell
      if (width > 0 && height > 0 && Math.round(width / CELL_X) >= 2 && Math.round(height / CELL_Y) >= 1)
        boxes.push({ x, y, width, height });
    } else if (command.type === "text" && typeof command.text === "string" && command.text.trim())
      texts.push({ x, y, text: command.text });
  }
  return { boxes, texts };
}

/** One text run the wireframe draws, and the page's own string it came from. */
export interface DrawnText {
  /** The page's string, as its command carries it. */
  text: string;
  /** The cells the wireframe draws: the page's string, or its prefix in `…`. */
  drawn: string;
  /** Did the run have less room than its cells? The `…` is the mark. */
  shortened: boolean;
  col: number;
  row: number;
  /** The drawn run's width in cells. */
  cols: number;
}

/** A wireframe as a grid: the page's cell size, its boxes' rects, and the texts it could place. */
export interface Wireframe {
  width: number;
  height: number;
  boxes: CellBox[];
  texts: DrawnText[];
  /** The border characters, a cell at a time: what each row draws before the text runs are put on it. */
  edges: string[][];
}

/** A run cut to `room` cells: its own string when it fits, else a prefix and the `…` marker (one cell). */
function shorten(text: string, room: number): { drawn: string; shortened: boolean } {
  if (room < 1) return { drawn: "", shortened: true };
  if (wireCells(text) <= room) return { drawn: text, shortened: false };
  let drawn = "";
  let used = 0;
  for (const ch of text) {
    const width = codeWidth(ch.codePointAt(0) ?? 0);
    if (used + width > room - 1) break;
    drawn += ch;
    used += width;
  }
  return { drawn: `${drawn}…`, shortened: true };
}

/** The clip a box's rect gets on a grid: a box that ends at the page's edge keeps its last cell. */
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Draw one box's outline in ASCII: `+` the corners, `-` across, `|` down, and a one-cell-tall panel as `+--+`. */
function outline(edges: string[][], box: CellBox, width: number, height: number): void {
  const left = clamp(box.col, 0, width - 1);
  const right = clamp(box.col + box.cols - 1, left, width - 1);
  const top = clamp(box.row, 0, height - 1);
  const bottom = clamp(box.row + box.rows - 1, top, height - 1);
  if (box.rows === 1) {
    for (let x = left; x <= right; x++) edges[top]![x] = x === left || x === right ? "+" : "-";
    return;
  }
  for (let x = left; x <= right; x++) {
    const corner = x === left || x === right;
    edges[top]![x] = corner ? "+" : "-";
    edges[bottom]![x] = corner ? "+" : "-";
  }
  for (let y = top + 1; y < bottom; y++) {
    edges[y]![left] = "|";
    edges[y]![right] = "|";
  }
}

/**
 * One side of a wireframe: its grid, its outlines, and the page's texts placed by their commands. A text's room is the
 * grid's edge, the next border to its right, or the next text on its row, whichever comes first — a cell holds one
 * character, so a run that does not fit is cut with `…` and never overwrites a panel's edge or the run beside it.
 */
export function wireframeOf(side: WireSide): Wireframe {
  const width = Math.max(1, Math.round(side.width / CELL_X));
  const height = Math.max(1, Math.round(side.height / CELL_Y));
  const edges: string[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => " "));
  const boxes = side.boxes.map(cellBox);
  for (const box of boxes) outline(edges, box, width, height);
  const rows: DrawnText[][] = Array.from({ length: height }, () => []);
  const texts: DrawnText[] = [];
  for (const text of side.texts) {
    const row = Math.round(text.y / CELL_Y);
    const col = Math.round(text.x / CELL_X);
    if (row < 0 || row >= height || col < 0 || col >= width) continue;
    let end = width;
    // a run is stopped by a panel's *vertical* edge, not by the dashes of a horizontal one: a page's content row can
    // land on a box's rounded bottom edge, and there the run is what should be read
    for (let x = col + 1; x < width; x++)
      if (edges[row]![x] === "|" || edges[row]![x] === "+") {
        end = x;
        break;
      }
    for (const other of rows[row]!) if (other.col > col) end = Math.min(end, other.col);
    // two runs rounding to the same cell is the page's later one on top: the earlier is covered, not drawn twice
    for (const other of rows[row]!)
      if (other.col === col) {
        other.drawn = "";
        other.cols = 0;
        other.shortened = true;
      }
    const drawn = shorten(text.text, end - col);
    const entry: DrawnText = { text: text.text, ...drawn, col, row, cols: wireCells(drawn.drawn) };
    rows[row]!.push(entry);
    texts.push(entry);
  }
  return { width, height, boxes, texts, edges };
}

/**
 * One grid row as items: the border runs as `connector` (a line, muted), the page's runs as `label` (its words, ink),
 * and a gap of nothing but blanks as a space. A pair of two pages is past ThorVG's 1,024-node tree with an item a cell,
 * so the row is split by role rather than by cell: a border segment is one item, however long.
 */
function lineOf(wire: Wireframe, row: number, prefix: string): LayoutLine {
  const starts = new Map(wire.texts.filter((text) => text.row === row && text.cols > 0).map((text) => [text.col, text]));
  const items: Item[] = [];
  let col = 0;
  while (col < wire.width) {
    const run = starts.get(col);
    if (run) {
      items.push({
        kind: "text",
        id: `${prefix}-${row}-${col}-label-cell`,
        textId: `${prefix}-${row}-${col}-label`,
        text: run.drawn,
        cells: run.cols,
        paint: "ink",
        role: "label",
      });
      col += run.cols;
      continue;
    }
    let end = col + 1;
    while (end < wire.width && !starts.has(end)) end++;
    const segment = wire.edges[row]!.slice(col, end).join("");
    if (segment.trim() === "")
      items.push({ kind: "space", id: `${prefix}-${row}-${col}-gap`, cells: end - col, paint: "ink" });
    else
      items.push({
        kind: "text",
        id: `${prefix}-${row}-${col}-edge-cell`,
        textId: `${prefix}-${row}-${col}-edge`,
        text: segment,
        cells: end - col,
        paint: "muted",
        role: "connector",
      });
    col = end;
  }
  return { items };
}

/** The boxes as the layout's records: one a page rectangle, in the drawing order. */
const boxRecords = (wire: Wireframe, prefix = "fig-wire-box"): BoxRecord[] =>
  wire.boxes.map((box, i) => ({
    id: `${prefix}-${i}`,
    textId: `${prefix}-text-${i}`,
    text: "",
    role: "step",
  }));

/** The page's runs in its order, for the focus: a wireframe's names are the words it draws. */
const labelsOf = (side: WireSide, prefix: string): Layout["labels"] =>
  side.texts.map((text, i) => ({ textId: `${prefix}-label-${i}`, text: text.text }));

/** A page's width in cells, the number a spec's `options.width` is held against. */
const cellsAcross = (width: number) => Math.round(width / CELL_X);

/** The width a spec may be drawn at: its `options.width`, or a README's 80 cells. */
function limitOf(options: unknown): number {
  const width = isObject(options) ? number(options.width) : undefined;
  return width ?? DEFAULT_WIDTH;
}

/**
 * A screen: one page's own frame as a wireframe. The page's name and size are the data's identity, and the boxes and
 * texts beside them are the frame `from-page.ts` captured, so this function is a cut of what the page drew and never a
 * list of what a wireframe should hold.
 */
function screen(spec: ScreenSpec): Layout {
  const wire = wireframeOf(spec.data);
  const lines = Array.from({ length: wire.height }, (_, row) => lineOf(wire, row, "fig-wire"));
  return finish(spec, "screen", wire.width, lines, [], labelsOf(spec.data, "fig-wire"), boxRecords(wire));
}

/** A captioned side's rows, each padded to the side's own width. */
function sideLines(side: WireSide, caption: string, prefix: string): { caption: LayoutLine; rows: LayoutLine[]; wire: Wireframe } {
  const wire = wireframeOf(side);
  const rows = Array.from({ length: wire.height }, (_, row) => {
    const line = lineOf(wire, row, prefix);
    const used = line.items.reduce((n, item) => n + item.cells, 0);
    if (used < wire.width) line.items.push({ kind: "space", id: `${prefix}-pad-${row}`, cells: wire.width - used, paint: "ink" });
    return line;
  });
  return {
    caption: {
      items: [{ kind: "text", id: `${prefix}-caption-cell`, textId: `${prefix}-caption`, text: caption, cells: cells(caption), paint: "muted", role: "label" }],
    },
    rows,
    wire,
  };
}

/**
 * A modal: the Dialog's frame with its modal open, cut to cells exactly as a screen is — the scrim is the page's full
 * rectangle, the panel and its buttons are inside it — with the panel's own box under the drawing. The data carries the
 * keys and the settle the frame was taken with, so the figure is the overlay the page opens, not a drawing of one.
 */
function modal(spec: ModalSpec): Layout {
  const wire = wireframeOf(spec.data);
  const lines = Array.from({ length: wire.height }, (_, row) => lineOf(wire, row, "fig-modal"));
  const panel = spec.data.panel;
  const note = `the panel ${Math.round(panel.width)}x${Math.round(panel.height)} at ${Math.round(panel.x)},${Math.round(panel.y)}`;
  lines.push({ items: [textItem("fig-modal-note", note, cells(note), "muted", "note")] });
  return finish(spec, "modal", wire.width, lines, [], labelsOf(spec.data, "fig-modal"), [
    ...boxRecords(wire, "fig-modal-box"),
    { id: "fig-modal-panel", textId: "fig-modal-note", text: "", role: "step" },
  ]);
}

/** A modal: the Dialog's frame, the keys it was taken with, and a panel the frame itself drew. */
function modalProblems(data: unknown, options: unknown): string[] {
  if (!isObject(data))
    return [
      'A modal needs its page, the keys its frame is taken with and its panel: { "page": "dialog", "keys": ["Tab", ' +
        '"Enter"], "settle": 40, "panel": { "x": 40, "y": 164, "width": 280, "height": 152 }, "width": 360, ' +
        '"height": 480, "boxes": [...], "texts": [...] }.',
    ];
  const out: string[] = [];
  if (data.page !== "dialog") out.push(`A modal is the Dialog's open frame: "page" is "dialog", not ${say(data.page)}.`);
  const keys = rowsOf(data.keys);
  if (!keys.length || keys.some((key) => typeof key !== "string" || !key.trim()))
    out.push('A modal needs the keys its frame is taken with: ["Tab", "Enter"].');
  const settle = number(data.settle);
  if (settle === undefined || settle < 0 || !Number.isInteger(settle))
    out.push(`A modal needs its settle: whole frames at rest after the keys, 0 or more, not ${say(data.settle)}.`);
  const panel = data.panel;
  const panelBox =
    isObject(panel) &&
    [panel.x, panel.y, panel.width, panel.height].every((value) => number(value) !== undefined) &&
    number(panel.width)! > 0 &&
    number(panel.height)! > 0
      ? (panel as unknown as WireBox)
      : undefined;
  if (!panelBox)
    out.push(`A modal needs its panel: { "x": 40, "y": 164, "width": 280, "height": 152 }, in the page's pixels.`);
  else if (
    !rowsOf(data.boxes).some(
      (box) =>
        isObject(box) &&
        number(box.x) === panelBox.x &&
        number(box.y) === panelBox.y &&
        number(box.width) === panelBox.width &&
        number(box.height) === panelBox.height,
    )
  )
    out.push(
      `The modal's panel ${panelBox.x},${panelBox.y} ${panelBox.width}x${panelBox.height} is not one of its frame's ` +
        `boxes: a modal's panel is what the frame drew.`,
    );
  const side = sideProblems(data, "dialog page");
  out.push(...side.problems, ...widthProblem(side, "dialog page", options));
  return out;
}

/**
 * The same page at two widths, each side its own captured frame and its own caption. Side by side when the two grids
 * and their gap fit `options.width`, above/below when they do not — a narrow README stacks the same two panels.
 */
function responsivePair(spec: ResponsivePairSpec): Layout {
  const { narrow, wide } = spec.data;
  const n = sideLines(narrow, `narrow ${narrow.width}x${narrow.height}`, "fig-wire-narrow");
  const w = sideLines(wide, `wide ${wide.width}x${wide.height}`, "fig-wire-wide");
  const sideBySide = n.wire.width + PAIR_GAP + w.wire.width <= limitOf(spec.options);
  const lines: LayoutLine[] = [];
  const boxes: BoxRecord[] = [...boxRecords(n.wire, "fig-wire-narrow-box"), ...boxRecords(w.wire, "fig-wire-wide-box")];
  const labels = [...labelsOf(narrow, "fig-wire-narrow"), ...labelsOf(wide, "fig-wire-wide")];
  if (sideBySide) {
    lines.push({ items: [...n.caption.items, { kind: "space", id: "fig-wire-pair-gap", cells: PAIR_GAP, paint: "ink" }, ...w.caption.items] });
    const rows = Math.max(n.rows.length, w.rows.length);
    for (let row = 0; row < rows; row++) {
      const items: Item[] = [];
      const a = n.rows[row];
      const b = w.rows[row];
      if (a) items.push(...a.items);
      else items.push({ kind: "space", id: `fig-wire-narrow-blank-${row}`, cells: n.wire.width, paint: "ink" });
      items.push({ kind: "space", id: `fig-wire-pair-gap-${row}`, cells: PAIR_GAP, paint: "ink" });
      if (b) items.push(...b.items);
      else items.push({ kind: "space", id: `fig-wire-wide-blank-${row}`, cells: w.wire.width, paint: "ink" });
      lines.push({ items });
    }
  } else {
    lines.push(n.caption, ...n.rows);
    lines.push({ items: [{ kind: "space", id: "fig-wire-pair-space", cells: 1, paint: "ink" }] });
    lines.push(w.caption, ...w.rows);
  }
  const width = Math.max(
    n.wire.width,
    w.wire.width,
    ...lines.map((line) => line.items.reduce((sum, item) => sum + item.cells, 0)),
  );
  return finish(spec, "responsivePair", width, lines, [], labels, boxes);
}

/** A page this repository has, or the sentence that names the ones it does. */
function pageProblem(page: unknown): string | undefined {
  if (typeof page === "string" && (KNOWN_PAGES as readonly string[]).includes(page)) return undefined;
  return `A wireframe's page is one this repository draws — ${KNOWN_PAGES.join(", ")} — not ${say(page)}.`;
}

/** One side's size and frame, as `check` reads it before it is a `WireSide`. */
interface RawSide {
  width?: number;
  height?: number;
  boxes: unknown[];
  texts: unknown[];
  problems: string[];
}

/** A side's width, height and two lists, with the sentences for whatever is not one. */
function sideProblems(raw: unknown, label: string): RawSide {
  if (!isObject(raw))
    return {
      boxes: [],
      texts: [],
      problems: [`The ${label} needs its size and its frame: { "width": 360, "height": 400, "boxes": [...], "texts": [...] }.`],
    };
  const problems: string[] = [];
  const width = number(raw.width);
  const height = number(raw.height);
  if (width === undefined || !(width > 0) || height === undefined || !(height > 0))
    problems.push(`The ${label} needs its size: 360x400, in pixels, not ${say(raw.width)}x${say(raw.height)}.`);
  const boxes = rowsOf(raw.boxes);
  const texts = rowsOf(raw.texts);
  for (const [i, box] of boxes.entries()) {
    const values = isObject(box) ? [box.x, box.y, box.width, box.height].map(number) : [];
    if (values.length !== 4 || values.some((value) => value === undefined))
      problems.push(`Box ${i + 1} of the ${label} needs x, y, width and height in pixels.`);
  }
  for (const [i, text] of texts.entries()) {
    const ok =
      isObject(text) &&
      typeof text.text === "string" &&
      text.text.trim() !== "" &&
      number(text.x) !== undefined &&
      number(text.y) !== undefined;
    if (!ok) problems.push(`Text ${i + 1} of the ${label} needs x, y and a run.`);
  }
  if (!boxes.length && !texts.length)
    problems.push(`The ${label}'s frame is empty: no command drew a box or a text.`);
  else if (!boxes.length)
    problems.push(`The ${label} has no rectangles or borders, so its wireframe has no box to draw.`);
  return { width, height, boxes, texts, problems };
}

/** A side's cells against `options.width`: a page wider than the figure is refused, with both numbers. */
function widthProblem(side: { width?: number }, label: string, options: unknown): string[] {
  if (side.width === undefined) return [];
  const across = cellsAcross(side.width);
  const limit = limitOf(options);
  return across > limit
    ? [`The ${label} is ${side.width}px wide, ${across} cells, but options.width is ${limit}: draw it in a narrower figure or raise options.width.`]
    : [];
}

/** A screen: a page this repository draws, its size, and a frame with at least one box. */
function screenProblems(data: unknown, options: unknown): string[] {
  if (!isObject(data))
    return ['A screen needs its page: { "page": "widgets", "width": 360, "height": 760 } and the frame\'s boxes and texts.'];
  const out: string[] = [];
  const page = pageProblem(data.page);
  if (page) out.push(page);
  const label = typeof data.page === "string" ? `${data.page} page` : "page";
  const side = sideProblems(data, label);
  out.push(...side.problems, ...widthProblem(side, label, options));
  return out;
}

/** A pair: two sides of one page, the narrow no wider than the wide, each a frame with a box. */
function pairProblems(data: unknown, options: unknown): string[] {
  if (!isObject(data))
    return ['A responsive pair needs its page and its two sides: { "page": "widgets", "narrow": { ... }, "wide": { ... } }.'];
  const out: string[] = [];
  const page = pageProblem(data.page);
  if (page) out.push(page);
  const narrow = sideProblems(data.narrow, "narrow side");
  const wide = sideProblems(data.wide, "wide side");
  out.push(...narrow.problems, ...wide.problems);
  out.push(...widthProblem(narrow, "narrow side", options), ...widthProblem(wide, "wide side", options));
  if (narrow.width !== undefined && wide.width !== undefined && narrow.width > wide.width)
    out.push(
      `The narrow side is ${narrow.width}px wide and the wide side ${wide.width}px: a responsive pair's narrow is the ` +
        `narrower of the two.`,
    );
  return out;
}

/** A screen's names are its page's runs; a pair's are both sides', in the drawing order. */
function screenNames(data: unknown): string[] {
  return isObject(data) ? rowsOf(data.texts).flatMap((text) => (isObject(text) && typeof text.text === "string" ? [text.text] : [])) : [];
}

function pairNames(data: unknown): string[] {
  if (!isObject(data)) return [];
  const names: string[] = [];
  for (const side of [data.narrow, data.wide])
    if (isObject(side))
      for (const text of rowsOf(side.texts))
        if (isObject(text) && typeof text.text === "string") names.push(text.text);
  return names;
}

// ---- a page's shell and its cards ----------------------------------------------------------------------------------

/** One box of a spec's data, when it has four finite numbers: the raw-JSON reader the two kinds' checks share. */
function boxOf(raw: unknown): WireBox | undefined {
  if (!isObject(raw)) return undefined;
  const x = number(raw.x);
  const y = number(raw.y);
  const width = number(raw.width);
  const height = number(raw.height);
  return x === undefined || y === undefined || width === undefined || height === undefined
    ? undefined
    : { x, y, width, height };
}

/** Two boxes are the same rectangle: a region's box is the frame's, not a rounding of it. */
const sameBox = (a: WireBox, b: WireBox): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** Do two boxes share a pixel? A band that overlaps another is not a band of the page. */
const overlaps = (a: WireBox, b: WireBox): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The grid a page's card boxes make, in pixels: all three numbers are the boxes', never the spec's to choose. */
export interface GridLayout {
  columns: number;
  gap: number;
  columnGap: number;
  /** Every gap down every column, so a check can refuse a card that is not where the column's rhythm says. */
  gaps: number[];
  /** Every gap across two columns. */
  columnGaps: number[];
}

/**
 * A card grid's numbers from its cards' real boxes: a column is a distinct `x`, the row gap is the distance between one
 * card's bottom and the next card's top in the same column, and the column gap is the space between two columns' right
 * and left edges. Nine cards that happen to be one column are one column, and a gap is a pixel count, not a cell.
 */
export function gridOf(cards: readonly WireBox[]): GridLayout {
  const xs = [...new Set(cards.map((card) => card.x))].sort((a, b) => a - b);
  const columns = Math.max(1, xs.length);
  const gaps: number[] = [];
  const columnGaps: number[] = [];
  for (const [i, x] of xs.entries()) {
    const column = cards.filter((card) => card.x === x).sort((a, b) => a.y - b.y);
    for (let at = 1; at < column.length; at++)
      gaps.push(column[at]!.y - (column[at - 1]!.y + column[at - 1]!.height));
    if (i > 0) {
      const right = Math.max(...cards.filter((card) => card.x === xs[i - 1]!).map((card) => card.x + card.width));
      columnGaps.push(x - right);
    }
  }
  return { columns, gap: gaps[0] ?? 0, columnGap: columnGaps[0] ?? 0, gaps, columnGaps };
}

/** One label run of a band: its words, the role's paint, and the text role a target reads it by. */
interface LabelRun {
  text: string;
  paint: Paint;
  role: TextRole;
}

/** A blank grid of cells: the page's size, every cell a blank the kind's own characters go on. */
function blankGrid(width: number, height: number): DrawingCell[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => ({ text: " ", cells: 1, paint: "ink" as Paint })));
}

/** One character on the grid, in its paint and role. */
function mark(grid: DrawingCell[][], row: number, col: number, text: string, paint: Paint, role: TextRole): void {
  const cell = grid[row]?.[col];
  if (cell) grid[row]![col] = { text, cells: 1, paint, role };
}

/** One run on the grid from `col`, cut to `limit` cells with `…`; its width in cells, as written. */
function writeRun(
  grid: DrawingCell[][],
  row: number,
  col: number,
  text: string,
  limit: number,
  paint: Paint,
  role: TextRole,
): number {
  const { drawn } = shorten(text, limit);
  let at = col;
  for (const ch of drawn) {
    const width = codeWidth(ch.codePointAt(0) ?? 0);
    if (at + width > col + limit) break;
    mark(grid, row, at, ch, paint, role);
    for (let k = 1; k < width; k++) if (grid[row]?.[at + k]) grid[row]![at + k] = { text: "", cells: 0, paint, role };
    at += width;
  }
  return at - col;
}

/** A band's label from `col`, one cell between its runs, cut to the cell its band leaves: the band's word, then the
 *  element the frame drew. A label that does not fit ends in `…` and its next run is not drawn. */
function writeLabel(grid: DrawingCell[][], row: number, col: number, limit: number, runs: readonly LabelRun[]): void {
  let at = col;
  let left = limit;
  for (const [i, run] of runs.entries()) {
    if (left < 1) return;
    const width = writeRun(grid, row, at, run.text, left, run.paint, run.role);
    const shortened = width < wireCells(run.text);
    at += width;
    left -= width;
    if (shortened || i === runs.length - 1) return;
    // the one cell between two runs
    at += 1;
    left -= 1;
  }
}

/** A rule of the page's own width: `+` the band's two corners, `-` its span. */
function bandRule(grid: DrawingCell[][], row: number, left: number, right: number): void {
  for (let x = left; x <= right; x++) mark(grid, row, x, x === left || x === right ? "+" : "-", "muted", "connector");
}

/**
 * One region of the cell grid: the page's own box as a border, with the region's label inside it. A band of three cells
 * or more has a rule above, a rule below and its label on the first row between them; a band of two (the Sky page's
 * 32px status line) has no row to spare, so its label is the band's first row and the rule its last. Every character is
 * at the region's own cell rect, so a band cannot show a box the frame did not give it.
 */
function bandOf(grid: DrawingCell[][], box: CellBox, runs: readonly LabelRun[]): void {
  const width = grid[0]!.length;
  const height = grid.length;
  const left = clamp(box.col, 0, width - 1);
  const right = clamp(box.col + box.cols - 1, left, width - 1);
  const top = clamp(box.row, 0, height - 1);
  const bottom = clamp(box.row + box.rows - 1, top, height - 1);
  if (bottom === top) {
    writeLabel(grid, top, left + 1, right - left - 1, runs);
    return;
  }
  if (bottom - top >= 2) {
    bandRule(grid, top, left, right);
    writeLabel(grid, top + 1, left + 2, right - left - 2, runs);
  } else {
    mark(grid, top, left, "|", "muted", "connector");
    mark(grid, top, right, "|", "muted", "connector");
    writeLabel(grid, top, left + 2, right - left - 2, runs);
  }
  for (let y = top + 1; y < bottom; y++) {
    mark(grid, y, left, "|", "muted", "connector");
    mark(grid, y, right, "|", "muted", "connector");
  }
  bandRule(grid, bottom, left, right);
}

/** A grid's rows as the layout's lines, each row's runs grouped by paint and role. */
const gridLines = (grid: DrawingCell[][], prefix: string): LayoutLine[] =>
  grid.map((row, index) => drawingLine(row, prefix, index));

/**
 * An app shell: a page's own bands, each the element the frame drew, its box at the page's own cell rect and its band's
 * word beside the element's name inside it. The page is the regions' union (the check says so); nothing else is drawn, so
 * a shell cannot show a band the page does not have.
 */
function appShell(spec: AppShellSpec): Layout {
  const data = spec.data;
  const grid = blankGrid(Math.max(1, cellsAcross(data.width)), Math.max(1, Math.round(data.height / CELL_Y)));
  for (const region of data.regions)
    bandOf(grid, cellBox(region), [
      { text: region.band, paint: "ink", role: "label" },
      { text: region.element, paint: "muted", role: "note" },
    ]);
  const labels = data.regions.map((region, i) => ({ textId: `fig-shell-label-${i}`, text: `${region.band} ${region.element}` }));
  const boxes: BoxRecord[] = data.regions.map((region, i) => ({
    id: `fig-shell-box-${i}`,
    textId: `fig-shell-box-${i}-text`,
    text: "",
    role: "step",
  }));
  return finish(spec, "appShell", grid[0]!.length, gridLines(grid, "fig-shell"), [], labels, boxes);
}

/** A card grid: the page's repeated cards, each at its own box with its index and its element's name, and the grid's
 *  columns and gaps under the drawing — the three numbers the cards' boxes make, not a layout the spec chose. */
function cardGrid(spec: CardGridSpec): Layout {
  const data = spec.data;
  const grid = blankGrid(Math.max(1, cellsAcross(data.width)), Math.max(1, Math.round(data.height / CELL_Y)));
  for (const card of data.cards)
    bandOf(grid, cellBox(card), [
      { text: `#${card.index}`, paint: "good", role: "value" },
      { text: card.element, paint: "muted", role: "note" },
    ]);
  const lines = gridLines(grid, "fig-grid");
  const note =
    `${data.cards.length} cards in ${data.columns} column${data.columns === 1 ? "" : "s"}, ${data.gap}px between rows` +
    (data.columns > 1 ? `, ${data.columnGap}px between columns` : "");
  lines.push({ items: [textItem("fig-grid-note", note, cells(note), "muted", "note")] });
  const labels = data.cards.map((card, i) => ({ textId: `fig-grid-label-${i}`, text: `#${card.index} ${card.element}` }));
  const boxes: BoxRecord[] = data.cards.map((card, i) => ({
    id: `fig-grid-box-${i}`,
    textId: `fig-grid-box-${i}-text`,
    text: "",
    role: "step",
  }));
  return finish(spec, "cardGrid", grid[0]!.length, lines, [], labels, boxes);
}

/** One band's sentences: its words, its element's name and that element's box in the frame. */
function shellBandProblems(raw: unknown, at: number, boxes: readonly WireBox[], side: RawSide): string[] {
  if (!isObject(raw))
    return [`Band ${at + 1} of the shell is not an object: it needs a band, an element and a box.`];
  const out: string[] = [];
  const band = typeof raw.band === "string" ? raw.band.trim() : "";
  const element = typeof raw.element === "string" ? raw.element.trim() : "";
  const name = element || `band ${at + 1}`;
  if (!band) out.push(`Band ${at + 1} of the shell needs its role: "nav", "content" or "status".`);
  if (!element) out.push(`Band ${at + 1} of the shell needs the element it came from: "sky-bar".`);
  const box = boxOf(raw);
  if (!box || !(box.width > 0) || !(box.height > 0)) {
    out.push(`Band ${name} of the shell needs its box: x, y, width and height in the page's pixels.`);
    return out;
  }
  if (side.width !== undefined && side.height !== undefined) {
    const inside = box.x >= 0 && box.y >= 0 && box.x + box.width <= side.width && box.y + box.height <= side.height;
    if (!inside)
      out.push(
        `The shell's band ${name} ${box.x},${box.y} ${box.width}x${box.height} is outside the ${side.width}x${side.height} ` +
          `page: a band is a part of the page.`,
      );
  }
  if (!boxes.some((other) => sameBox(other, box)))
    out.push(
      `The shell's band ${name} ${box.x},${box.y} ${box.width}x${box.height} is not one of its frame's boxes: a band is ` +
        `an element the frame drew.`,
    );
  return out;
}

/** An app shell: a page this repository draws, and bands that are the frame's own elements, tile the page and do not
 *  overlap. The union is counted in pixels from the boxes, not from their cells: the cell grid rounds each band's edge. */
function appShellProblems(data: unknown, options: unknown): string[] {
  if (!isObject(data))
    return [
      'An app shell needs its page and its bands: { "page": "sky", "regions": [ { "band": "nav", "element": "sky-bar", ' +
        '"x": 0, "y": 0, "width": 360, "height": 64 } ] } and the frame\'s boxes and texts.',
    ];
  const out: string[] = [];
  const page = pageProblem(data.page);
  if (page) out.push(page);
  const label = typeof data.page === "string" ? `${data.page} page` : "page";
  const side = sideProblems(data, label);
  out.push(...side.problems, ...widthProblem(side, label, options));
  const regions = rowsOf(data.regions);
  if (!regions.length)
    out.push(
      'An app shell needs the page\'s bands: [ { "band": "nav", "element": "sky-bar", "x": 0, "y": 0, "width": 360, ' +
        '"height": 64 } ].',
    );
  const boxes = rowsOf(data.boxes).map(boxOf).filter((box): box is WireBox => box !== undefined);
  const placed: { name: string; box: WireBox }[] = [];
  let tiled = regions.length > 0;
  for (const [at, raw] of regions.entries()) {
    out.push(...shellBandProblems(raw, at, boxes, side));
    const box = boxOf(raw);
    if (!box || !(box.width > 0) || !(box.height > 0)) {
      tiled = false;
      continue;
    }
    const name = isObject(raw) && typeof raw.element === "string" ? raw.element.trim() : `band ${at + 1}`;
    for (const other of placed)
      if (overlaps(other.box, box)) {
        out.push(`The shell's bands ${other.name} and ${name} overlap: a page's bands do not.`);
        tiled = false;
      }
    placed.push({ name, box });
  }
  if (tiled && side.width !== undefined && side.height !== undefined) {
    const area = placed.reduce((sum, region) => sum + region.box.width * region.box.height, 0);
    const pageArea = side.width * side.height;
    if (area !== pageArea)
      out.push(`The shell's bands cover ${area} of the page's ${pageArea} pixels: a shell's bands tile the page.`);
  }
  return out;
}

/** One card's sentences: its index, the element its name says and that element's box in the frame. */
function cardProblems(
  raw: unknown,
  at: number,
  prefix: string,
  boxes: readonly WireBox[],
  indices: Set<number>,
  elements: Set<string>,
): string[] {
  if (!isObject(raw)) return [`Card ${at + 1} is not an object: it needs an index, an element and a box.`];
  const out: string[] = [];
  const index = number(raw.index);
  const element = typeof raw.element === "string" ? raw.element.trim() : "";
  const name = element || `card ${index ?? at + 1}`;
  if (index === undefined || !Number.isInteger(index) || index < 0)
    out.push(`Card ${at + 1} needs its index: a whole number from zero, not ${say(raw.index)}.`);
  else if (indices.has(index)) out.push(`Card ${index} is numbered twice: one index, one card.`);
  else indices.add(index);
  if (!element) out.push(`Card ${index ?? at + 1} needs the element it came from: "sky-card-0".`);
  else if (prefix && !element.startsWith(prefix))
    out.push(`Card ${element} is not one of the page's cards: every card's element starts with ${say(prefix)}.`);
  else if (elements.has(element)) out.push(`Card ${element} is listed twice: one element, one card.`);
  else elements.add(element);
  const box = boxOf(raw);
  if (!box || !(box.width > 0) || !(box.height > 0))
    out.push(`Card ${name} needs its box: x, y, width and height in the page's pixels.`);
  else if (!boxes.some((other) => sameBox(other, box)))
    out.push(
      `Card ${name} ${box.x},${box.y} ${box.width}x${box.height} is not one of its frame's boxes: a card is an element ` +
        `the frame drew.`,
    );
  return out;
}

/** A card grid: a page this repository draws, at least two cards under one element prefix, and the grid its boxes make. */
function cardGridProblems(data: unknown, options: unknown): string[] {
  if (!isObject(data))
    return [
      'A card grid needs its page, the cards\' element prefix and the grid: { "page": "sky", "prefix": "sky-card-", ' +
        '"cards": [ { "index": 0, "element": "sky-card-0", "x": 12, "y": 76, "width": 336, "height": 190 } ], ' +
        '"columns": 1, "gap": 8, "columnGap": 0 } and the frame\'s boxes and texts.',
    ];
  const out: string[] = [];
  const page = pageProblem(data.page);
  if (page) out.push(page);
  const label = typeof data.page === "string" ? `${data.page} page` : "page";
  const side = sideProblems(data, label);
  out.push(...side.problems, ...widthProblem(side, label, options));
  const prefix = typeof data.prefix === "string" ? data.prefix.trim() : "";
  if (!prefix) out.push('A card grid needs the prefix its cards\' elements share: "sky-card-".');
  const cards = rowsOf(data.cards);
  if (cards.length < 2)
    out.push(`A card grid needs at least two cards — the page's repeated elements — not ${cards.length}.`);
  const boxes = rowsOf(data.boxes).map(boxOf).filter((box): box is WireBox => box !== undefined);
  const indices = new Set<number>();
  const elements = new Set<string>();
  const placed: WireBox[] = [];
  for (const [at, raw] of cards.entries()) {
    out.push(...cardProblems(raw, at, prefix, boxes, indices, elements));
    const box = boxOf(raw);
    if (box && box.width > 0 && box.height > 0) placed.push(box);
  }
  if (placed.length !== cards.length || placed.length < 2) return out;
  const grid = gridOf(placed);
  const columns = number(data.columns);
  if (columns === undefined || !Number.isInteger(columns) || columns < 1)
    out.push(`A card grid's columns are a whole number above zero, not ${say(data.columns)}.`);
  else if (columns !== grid.columns)
    out.push(
      `The card grid says ${columns} column${columns === 1 ? "" : "s"}, but its cards' boxes make ${grid.columns}: ` +
        `the columns are the boxes'.`,
    );
  const gap = number(data.gap);
  if (gap === undefined || gap < 0)
    out.push(`A card grid's row gap is a number of pixels from zero, not ${say(data.gap)}.`);
  else if (grid.gaps.some((one) => one !== gap))
    out.push(
      `The card grid says a ${gap}px gap, but its cards' boxes are ${[...new Set(grid.gaps)].join("px, ")}px apart: ` +
        `the gap is the boxes'.`,
    );
  const columnGap = number(data.columnGap);
  if (columnGap === undefined || columnGap < 0)
    out.push(`A card grid's column gap is a number of pixels from zero, not ${say(data.columnGap)}.`);
  else if (grid.columns > 1 && grid.columnGaps.some((one) => one !== columnGap))
    out.push(
      `The card grid says a ${columnGap}px column gap, but its cards' boxes are ` +
        `${[...new Set(grid.columnGaps)].join("px, ")}px apart: the gap is the boxes'.`,
    );
  return out;
}

/** A shell's names are its bands as they are drawn: the band's word and the element's name. */
function shellNames(data: unknown): string[] {
  if (!isObject(data)) return [];
  return rowsOf(data.regions).flatMap((region) =>
    isObject(region) && typeof region.band === "string" && typeof region.element === "string"
      ? [`${region.band.trim()} ${region.element.trim()}`]
      : [],
  );
}

/** A grid's names are its cards as they are drawn: their index and the element's name. */
function gridNames(data: unknown): string[] {
  if (!isObject(data)) return [];
  return rowsOf(data.cards).flatMap((card) => {
    const index = isObject(card) ? number(card.index) : undefined;
    return index !== undefined && isObject(card) && typeof card.element === "string"
      ? [`#${index} ${card.element.trim()}`]
      : [];
  });
}

// ---- a list pane and a detail pane -----------------------------------------------------------------------------------

/** The two panes of a list/detail page, in the drawing's order: the role's word, and the field of the data it is. */
const PANES = ["list", "detail"] as const;

/** A pane's line for the note under the drawing: its element, its box and where the box sits in the page. */
const paneText = (pane: ListPane) => `${pane.element} ${pane.width}x${pane.height} at ${pane.x},${pane.y}`;

/**
 * A list/detail page: the page's own cell grid with each pane's box drawn on it — its rule on the pane's top and bottom
 * rows, its sides down the others — and the pane's word and its element's name inside it, as `appShell` labels a band.
 * The panes tile the page (the check counts their union in pixels), so nothing else is drawn: a pane is not a rectangle
 * the author placed, and a third region would be a lie about the page. The two boxes are under the drawing.
 */
function listDetail(spec: ListDetailSpec): Layout {
  const data = spec.data;
  const grid = blankGrid(Math.max(1, cellsAcross(data.width)), Math.max(1, Math.round(data.height / CELL_Y)));
  const panes = [data.list, data.detail];
  for (const [i, pane] of panes.entries())
    bandOf(grid, cellBox(pane), [
      { text: PANES[i]!, paint: "ink", role: "label" },
      { text: pane.element, paint: "muted", role: "note" },
    ]);
  const lines = gridLines(grid, "fig-list");
  const note = `${paneText(data.list)}, ${paneText(data.detail)}`;
  lines.push({ items: [textItem("fig-list-note", note, cells(note), "muted", "note")] });
  const labels: Layout["labels"] = panes.map((pane, i) => ({
    textId: `fig-list-caption-${i}`,
    text: `${PANES[i]} ${pane.element}`,
  }));
  const boxes: BoxRecord[] = panes.map((_pane, i) => ({
    id: `fig-list-box-${i}`,
    textId: `fig-list-box-${i}-text`,
    text: "",
    role: "step",
  }));
  return finish(spec, "listDetail", grid[0]!.length, lines, [], labels, boxes);
}

/** One pane's sentences: its element's name, that element's box in the frame, and the page it is a part of. */
function paneProblems(raw: unknown, role: string, boxes: readonly WireBox[], side: RawSide): string[] {
  if (!isObject(raw)) return [`The ${role} pane is not an object: it needs an element and a box.`];
  const element = typeof raw.element === "string" ? raw.element.trim() : "";
  const name = element ? `${role} pane ${element}` : `the ${role} pane`;
  const out: string[] = [];
  if (!element)
    out.push(
      `The ${role} pane needs the page's element for it, like "sky-feed-pane": a pane is an element the frame drew.`,
    );
  const box = boxOf(raw);
  if (!box || !(box.width > 0) || !(box.height > 0)) {
    out.push(`The ${name} needs its box: x, y, width and height in the page's pixels.`);
    return out;
  }
  if (side.width !== undefined && side.height !== undefined) {
    const inside = box.x >= 0 && box.y >= 0 && box.x + box.width <= side.width && box.y + box.height <= side.height;
    if (!inside)
      out.push(
        `The ${name} ${box.x},${box.y} ${box.width}x${box.height} is outside the ${side.width}x${side.height} page: ` +
          `a pane is a part of the page.`,
      );
  }
  if (!boxes.some((other) => sameBox(other, box)))
    out.push(
      `The ${name} ${box.x},${box.y} ${box.width}x${box.height} is not one of its frame's boxes: a pane is an ` +
        `element the frame drew.`,
    );
  return out;
}

/** A list/detail page: a page this repository draws, two panes that are the frame's own elements, apart and tiling it. */
function listDetailProblems(data: unknown, options: unknown): string[] {
  if (!isObject(data))
    return [
      'A list/detail figure needs its page and its two panes: { "page": "sky", "list": { "element": "sky-feed-pane", ' +
        '"x": 0, "y": 0, "width": 360, "height": 760 }, "detail": { "element": "sky-thread", "x": 360, "y": 0, ' +
        '"width": 360, "height": 760 } } and the frame\'s boxes and texts.',
    ];
  const out: string[] = [];
  const page = pageProblem(data.page);
  if (page) out.push(page);
  const label = typeof data.page === "string" ? `${data.page} page` : "page";
  const side = sideProblems(data, label);
  out.push(...side.problems, ...widthProblem(side, label, options));
  const boxes = rowsOf(data.boxes).map(boxOf).filter((box): box is WireBox => box !== undefined);
  out.push(...paneProblems(data.list, "list", boxes, side), ...paneProblems(data.detail, "detail", boxes, side));
  const list = boxOf(data.list);
  const detail = boxOf(data.detail);
  const listElement = isObject(data.list) && typeof data.list.element === "string" ? data.list.element.trim() : "";
  const detailElement = isObject(data.detail) && typeof data.detail.element === "string" ? data.detail.element.trim() : "";
  if (listElement && listElement === detailElement)
    out.push(`A page's list and detail panes are two elements, not ${say(listElement)} twice.`);
  if (!list || !detail || !(list.width > 0 && list.height > 0 && detail.width > 0 && detail.height > 0)) return out;
  const listName = listElement || "the list pane";
  const detailName = detailElement || "the detail pane";
  if (overlaps(list, detail)) {
    out.push(`The list pane ${listName} and the detail pane ${detailName} overlap: two panes of one page do not.`);
    return out;
  }
  if (side.width === undefined || side.height === undefined) return out;
  // a pane outside the page is that sentence's, not the union's: its area is not the page's to count
  const insidePage = (box: WireBox) =>
    box.x >= 0 && box.y >= 0 && box.x + box.width <= side.width! && box.y + box.height <= side.height!;
  if (!insidePage(list) || !insidePage(detail)) return out;
  const area = list.width * list.height + detail.width * detail.height;
  const pageArea = side.width * side.height;
  if (area !== pageArea)
    out.push(`The panes cover ${area} of the page's ${pageArea} pixels: a list and a detail pane tile the page.`);
  return out;
}

/** A list/detail page's names are its panes as they are drawn: the role's word and the element's name. */
function listDetailNames(data: unknown): string[] {
  if (!isObject(data)) return [];
  return PANES.flatMap((role) => {
    const pane = data[role];
    return isObject(pane) && typeof pane.element === "string" ? [`${role} ${pane.element.trim()}`] : [];
  });
}

// ---- anatomy --------------------------------------------------------------------------------------------------------

/** The page's background: the window, not a component. A cut of it would ring the crop with an outline the page never drew
 *  around the part, so an anatomy drops the one rectangle that covers the page. */
const isBackground = (box: WireBox, side: WireSide): boolean =>
  box.x <= 0 && box.y <= 0 && box.width >= side.width && box.height >= side.height;

/**
 * The region an anatomy draws: the page's boxes and texts, cut to `crop` and moved to its corner. A box that crosses the
 * crop's edge is clipped to it (the drawing shows the part inside); a box under 2x1 cells, or one fully outside, is not
 * drawn, the same rule `frameOf` states for a wireframe. The page's own background is dropped (see `isBackground`).
 */
function cropOf(side: WireSide, crop: AnatomyCrop): WireSide {
  const right = crop.x + crop.width;
  const bottom = crop.y + crop.height;
  const boxes: WireBox[] = [];
  for (const box of side.boxes) {
    if (isBackground(box, side)) continue;
    const x = Math.max(box.x, crop.x);
    const y = Math.max(box.y, crop.y);
    const width = Math.min(box.x + box.width, right) - x;
    const height = Math.min(box.y + box.height, bottom) - y;
    if (width <= 0 || height <= 0) continue;
    if (Math.round(width / CELL_X) < 2 || Math.round(height / CELL_Y) < 1) continue;
    boxes.push({ x: x - crop.x, y: y - crop.y, width, height });
  }
  const across = Math.max(1, Math.round(crop.width / CELL_X));
  const down = Math.max(1, Math.round(crop.height / CELL_Y));
  const texts = side.texts
    .filter((text) => {
      const col = Math.round((text.x - crop.x) / CELL_X);
      const row = Math.round((text.y - crop.y) / CELL_Y);
      return col >= 0 && col < across && row >= 0 && row < down;
    })
    .map((text) => ({ x: text.x - crop.x, y: text.y - crop.y, text: text.text }));
  return { width: crop.width, height: crop.height, boxes, texts };
}

/** One cell of a drawing row: what it draws, how many cells it takes (2 for a wide glyph), and its paint. A wide glyph's
 *  second cell is a continuation (`cells` 0, text ""). */
interface DrawingCell {
  text: string;
  cells: number;
  paint: Paint;
  role?: TextRole;
}

/** The wireframe's grid as cells: the edges first, the page's own runs laid over them. */
function drawingRows(wire: Wireframe): DrawingCell[][] {
  return wire.edges.map((edges, row) => {
    const slots: DrawingCell[] = edges.map((edge) =>
      edge === " "
        ? { text: edge, cells: 1, paint: "ink" }
        : { text: edge, cells: 1, paint: "muted", role: "connector" },
    );
    for (const text of wire.texts) {
      if (text.row !== row || text.cols <= 0) continue;
      let col = text.col;
      for (const ch of text.drawn) {
        const width = codeWidth(ch.codePointAt(0) ?? 0);
        slots[col] = { text: ch, cells: width, paint: "ink", role: "label" };
        for (let k = 1; k < width; k++) slots[col + k] = { text: "", cells: 0, paint: "ink", role: "label" };
        col += width;
      }
    }
    return slots;
  });
}

/**
 * One callout's digit on its row, replacing the cell it lands on. A digit over a wide glyph takes the whole glyph: the
 * digit and the space its second cell becomes, so a run's cells stay the drawing's.
 */
function stamp(row: DrawingCell[], col: number, digit: string): void {
  const hit = row[col];
  if (!hit) return;
  let start = col;
  while (start > 0 && row[start]!.cells === 0) start--;
  const span = Math.max(1, row[start]!.cells);
  row[start] = { text: digit.padEnd(span, " "), cells: span, paint: "good", role: "value" };
  for (let k = 1; k < span; k++) row[start + k] = { text: "", cells: 0, paint: "good", role: "value" };
}

/** One drawing row as items: runs of one paint and role, blanks as a space, in the row's order. */
function drawingLine(row: DrawingCell[], prefix: string, index: number): LayoutLine {
  const items: Item[] = [];
  let at = 0;
  while (at < row.length) {
    const paint = row[at]!.paint;
    const role = row[at]!.role;
    let end = at + 1;
    while (end < row.length && row[end]!.paint === paint && row[end]!.role === role) end++;
    const text = row
      .slice(at, end)
      .map((cell) => cell.text)
      .join("");
    const width = end - at;
    if (text.trim() === "") items.push({ kind: "space", id: `${prefix}-${index}-${at}-gap`, cells: width, paint: "ink" });
    else
      items.push({
        kind: "text",
        id: `${prefix}-${index}-${at}-cell`,
        textId: `${prefix}-${index}-${at}`,
        text,
        cells: width,
        paint,
        role,
      });
    at = end;
  }
  return { items };
}

/** One callout's legend row: the number in the accent, then its label. */
const legendLine = (part: { n: number; label: string }, prefix: string): LayoutLine => ({
  items: [
    textItem(`${prefix}-legend-${part.n}`, String(part.n), 1, "good", "value"),
    textItem(`${prefix}-legend-${part.n}-label`, ` ${part.label}`, wireCells(part.label) + 1, "ink", "label"),
  ],
});

/** Where a callout's digit lands, in the drawing's cells: its point rounded to the nearest cell of the crop. */
const calloutCell = (part: { x: number; y: number }, crop: AnatomyCrop) => ({
  col: Math.round((part.x - crop.x) / CELL_X),
  row: Math.round((part.y - crop.y) / CELL_Y),
});

/**
 * A component drawing: one region of a page's own frame, cut to cells, with numbered callouts on it and a legend below.
 * The drawing is the page's (it cannot drift); the numbers and their words are the spec's annotation, which is why this
 * kind reads the frame *and* the author's parts, where a wireframe reads only the frame.
 */
function anatomy(spec: AnatomySpec): Layout {
  const crop = spec.data.crop ?? { x: 0, y: 0, width: spec.data.width, height: spec.data.height };
  const wire = wireframeOf(cropOf(spec.data, crop));
  const rows = drawingRows(wire);
  for (const part of spec.data.parts) {
    const cell = calloutCell(part, crop);
    if (cell.row < 0 || cell.row >= rows.length || cell.col < 0 || cell.col >= wire.width) continue;
    stamp(rows[cell.row]!, cell.col, String(part.n));
  }
  const lines: LayoutLine[] = rows.map((row, index) => drawingLine(row, "fig-anatomy", index));
  lines.push({ items: [{ kind: "space", id: "fig-anatomy-space", cells: 1, paint: "ink" }] });
  for (const part of spec.data.parts) lines.push(legendLine(part, "fig-anatomy"));
  const labels: Layout["labels"] = [
    ...spec.data.parts.map((part) => ({ textId: `fig-anatomy-legend-${part.n}-label`, text: part.label })),
    ...wire.texts.map((text, i) => ({ textId: `fig-anatomy-run-${i}`, text: text.text })),
  ];
  return finish(spec, "anatomy", wire.width, lines, [], labels, boxRecords(wire, "fig-anatomy-box"));
}

/** The crop a spec's data names, or the whole page's, with the sentences for whatever is not one. */
function cropProblems(data: Json, side: RawSide): { crop?: AnatomyCrop; problems: string[] } {
  if (side.width === undefined || side.height === undefined) return { problems: [] };
  const whole: AnatomyCrop = { x: 0, y: 0, width: side.width, height: side.height };
  if (data.crop === undefined) return { crop: whole, problems: [] };
  if (!isObject(data.crop))
    return {
      crop: whole,
      problems: [`The crop needs its region: { "x": 32, "y": 56, "width": 296, "height": 120 }, in the page's pixels.`],
    };
  const x = number(data.crop.x);
  const y = number(data.crop.y);
  const width = number(data.crop.width);
  const height = number(data.crop.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined)
    return {
      crop: whole,
      problems: [`The crop needs x, y, width and height, in the page's pixels: ${say(data.crop)} is not one.`],
    };
  const pinned: AnatomyCrop = { x, y, width, height };
  const inside = x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= side.width && y + height <= side.height;
  if (!inside)
    return {
      crop: whole,
      problems: [
        `The crop ${x},${y} ${width}x${height} is not a region of the ${side.width}x${side.height} page: ` +
          `a crop starts inside the page and ends inside it.`,
      ],
    };
  return { crop: pinned, problems: [] };
}

/** A callout's number, point and label, and the two callouts that cannot share a cell. */
function partProblems(raw: unknown, crop: AnatomyCrop, across: number, down: number): string[] {
  const parts = rowsOf(raw);
  if (!parts.length)
    return ['An anatomy needs its numbered parts: [ { "n": 1, "x": 40, "y": 76, "label": "the button" } ].'];
  const out: string[] = [];
  const numbers = new Set<number>();
  const places = new Map<string, number>();
  for (const [i, part] of parts.entries()) {
    if (!isObject(part)) {
      out.push(`Part ${i + 1} of the anatomy is not an object: it needs n, x, y and a label.`);
      continue;
    }
    const n = number(part.n);
    const label = typeof part.label === "string" && part.label.trim() ? part.label : undefined;
    const x = number(part.x);
    const y = number(part.y);
    if (n === undefined || !Number.isInteger(n) || n < 1 || n > 9) {
      out.push(`Callout ${say(part.n)} needs a number from 1 to 9: one cell holds one digit.`);
      continue;
    }
    if (!label) out.push(`Callout ${n} needs its label: what the part is, in words.`);
    if (x === undefined || y === undefined) {
      out.push(`Callout ${n} needs its point x and y, in the page's pixels: ${say(part.x)},${say(part.y)} is not a point.`);
      continue;
    }
    if (numbers.has(n)) out.push(`Callout ${n} is numbered twice: one number, one part.`);
    numbers.add(n);
    const col = Math.round((x - crop.x) / CELL_X);
    const row = Math.round((y - crop.y) / CELL_Y);
    if (col < 0 || col >= across || row < 0 || row >= down) {
      out.push(
        `Callout ${n} is at ${x},${y}, outside the crop ${crop.x},${crop.y} ${crop.width}x${crop.height}: ` +
          `a number is drawn on the drawing.`,
      );
      continue;
    }
    const cell = `${col},${row}`;
    const other = places.get(cell);
    if (other !== undefined) out.push(`Callout ${other} and callout ${n} share the drawing's cell ${cell}: move one of them.`);
    else places.set(cell, n);
  }
  return out;
}

/** An anatomy: a page this repository draws, a crop of it, and at least one callout with a number, a point and a label. */
function anatomyProblems(data: unknown, options: unknown): string[] {
  if (!isObject(data))
    return [
      'An anatomy needs its page, its crop and its numbered parts: { "page": "widgets", "crop": { ... }, "parts": [...] } ' +
        "and the frame's boxes and texts.",
    ];
  const out: string[] = [];
  const page = pageProblem(data.page);
  if (page) out.push(page);
  const label = typeof data.page === "string" ? `${data.page} page` : "page";
  const side = sideProblems(data, label);
  out.push(...side.problems);
  const crop = cropProblems(data, side);
  out.push(...crop.problems);
  if (!crop.crop) return out;
  out.push(...widthProblem({ width: crop.crop.width }, "crop", options));
  const across = Math.max(1, Math.round(crop.crop.width / CELL_X));
  const down = Math.max(1, Math.round(crop.crop.height / CELL_Y));
  out.push(...partProblems(data.parts, crop.crop, across, down));
  return out;
}

/** An anatomy's names are its callouts' labels and the page runs it draws. */
function anatomyNames(data: unknown): string[] {
  if (!isObject(data)) return [];
  const names = rowsOf(data.parts).flatMap((part) => (isObject(part) && typeof part.label === "string" ? [part.label] : []));
  for (const text of rowsOf(data.texts)) if (isObject(text) && typeof text.text === "string") names.push(text.text);
  return names;
}

register("anatomy", { layout: anatomy, check: anatomyProblems, names: anatomyNames });
register("appShell", { layout: appShell, check: appShellProblems, names: shellNames });
register("cardGrid", { layout: cardGrid, check: cardGridProblems, names: gridNames });
register("listDetail", { layout: listDetail, check: listDetailProblems, names: listDetailNames });
register("modal", { layout: modal, check: modalProblems, names: screenNames });
register("screen", { layout: screen, check: screenProblems, names: screenNames });
register("responsivePair", { layout: responsivePair, check: pairProblems, names: pairNames });
