// The dev page (the map's item 7): the Widgets page with a panel beside it — the page's accessibility tree, the box
// under the pointer, the frame's phases, and the live values of the box the pointer picked. The page on the left is the
// Widgets component itself, not a copy (`Widgets` below), in a 360px column, so its keys, focus and mouse are the ones
// `bun solid/main.ts widgets` has; the panel is 300px of plain rows on the right. The whole page is 660x760.
//
// The panel reads the page's own tree (`a11y.ts`'s `snapshot`, whose bounds are `ui.bounds` of the last layout), the
// innermost box with a role under the pointer (`ui.over` + `ui.bounds`) and the frame's numbers (`stats`, which the
// host's `createFrame` pushes, and `ui.draws`/`ui.presents`) every frame — and it *prints* them when they change. That
// is the whole point of the page: the panel is in the same Clay frame as the page, so reprinting a frame's phases
// every frame would change the frame's hash every frame and the page could never rest, which is what its counters are
// here to show. The numbers are therefore those of the frame that last changed the page.
//
// The fourth section is the live values (`tuneRows`): the picked box's style numbers that the value channel (`ui.value`,
// `FIELDS` in src/pack.ts) can move, edited with the panel's own keys. A write is one number of the renderer's per-frame
// table, not a page's state: the style's literal is what the declare falls back to, so a field that is reset is byte
// identical to the frame before the edit. The panel's three sections are Tab stops of the page's focus manager (the
// `stop` parts below), added after the page's own, so Tab walks the page and then the panel.
//
// The Widgets page's first-mount entry is off (it is given no motion hook): the entry draws ~21 frames over a page that
// does not change, and this page is about the frames after that.
import * as css from "cssints/clay" with { type: "cssints" };
import { readFileSync, writeFileSync } from "node:fs";
import { createSignal, flush, For } from "solid-js";

import { snapshot, type A11yNode, type States } from "../a11y.ts";
import type { Motion } from "../src/entry.ts";
import { ui } from "../src/ffi.ts";
import type { Input } from "../src/input.ts";
import { FIELDS, variant, type State, type Variant } from "../src/pack.ts";
import { El } from "../src/renderer.ts";
import { Widgets, size as pageSize, type Drag } from "./Widgets.tsx";

// the Widgets page's palette, a shade darker for the panel, so the two sit side by side in either theme
const t = css.createTokens({
  color: {
    $type: "color",
    page: { $value: "rgb(16 18 24)" },
    panel: { $value: "rgb(24 26 33)" },
    ink: { $value: "rgb(235 235 240)" },
    muted: { $value: "rgb(150 155 170)" },
    // the panel's own marks: the header of the part the keyboard is on, and the selected value row
    accent: { $value: "rgb(240 140 50)" },
  },
});
css.createGlobalTheme(t, "light", {
  color: {
    page: "rgb(244 245 248)",
    panel: "rgb(232 234 240)",
    ink: "rgb(25 27 34)",
    muted: "rgb(95 100 115)",
    accent: "rgb(190 90 10)",
  },
});
const font = css.fonts("Roboto");

const root = css.cn(css.width("stretch"), css.height("stretch"), css.bg(t.color.page));
// the page's column: the Widgets page's own 360, and the page's root is `stretch` inside it
const left = css.cn(css.width(pageSize.width), css.height("stretch"), css.flexDirection("column"));
const panel = css.cn(
  css.width(300),
  css.height("stretch"),
  css.p(10, 12),
  // 2, not 3: the fourth section needs the height (a row is 12px of text, and the panel cannot scroll: Clay squeezes a
  // fitted column into its box, so what is declared has to fit)
  css.gap(2),
  css.flexDirection("column"),
  css.bg(t.color.panel),
);
const head = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(10), css.pt(6));
// the header of the panel's own focused part, and the selected row of the live values: the accent, as the page's marks
const headOn = css.cn(head, css.color(t.color.accent));
const row = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(10));
const rowSel = css.cn(row, css.color(t.color.accent));
const rowBox = css.cn(css.width("stretch"));
// a line of the live values: two rows side by side, so a box's ten-or-so numbers fit the panel it has (the column cannot
// scroll: Clay squeezes a fitted column into its box, so what is declared has to fit)
const pair = css.cn(css.width("stretch"), css.gap(6));
const cell = css.cn(css.width("stretch"));

/** The window of the dev page: the Widgets page at its own size, and a 300px panel beside it. */
export const size = { width: pageSize.width + 300, height: pageSize.height };

/**
 * The frames' phases, which the host's `createFrame` pushes into `View.stats` (main.ts hands the dev page this array):
 * the panel reads it, so the numbers it prints are the frame loop's own.
 */
export const stats: [number, number, number, number][] = [];

/** The frames the mean and the max are taken over. */
const WINDOW = 30;

/** One row of the tree: the a11y node's fields, and how deep it is (the panel indents by 8px a level). */
export interface Row {
  depth: number;
  text: string;
}

const round = (n: number) => String(Math.round(n));
const two = (n: number) => n.toFixed(2);

/** `x,y w×h` of a node's bounds, or that it has none (a container the page never drew a box for). */
const boxText = (bounds: A11yNode["bounds"]): string =>
  bounds === undefined
    ? "no bounds"
    : `${round(bounds[0])},${round(bounds[1])} ${round(bounds[2])}×${round(bounds[3])}`;

const statesText = (states: States): string => {
  const on = Object.entries(states).map(([k, v]) => `${k}=${v}`);
  return on.length ? ` [${on.join(" ")}]` : "";
};

/** `role "name" [states] x,y w×h`, the row the panel prints for one node. */
export function rowOf(node: A11yNode, depth = 0): Row {
  const name = node.name === undefined ? "" : ` "${node.name}"`;
  return { depth, text: `${node.role}${name}${statesText(node.states)} ${boxText(node.bounds)}` };
}

/** The whole tree as rows in document order, the snapshot's `document` node itself left out. `mark` is the node the
 *  panel's cursor is on (the box a click pinned): its row starts with `> `, the tree's own selection. */
export function rowsOf(node: A11yNode, depth = 0, mark?: A11yNode): Row[] {
  return node.children.flatMap((child) => {
    const row = rowOf(child, depth);
    if (child === mark) row.text = `> ${row.text}`;
    return [row, ...rowsOf(child, depth + 1, mark)];
  });
}

/** The indented row's box: the one style the page makes at run time, kept per depth. */
const indent = new Map<number, unknown>();
const indentOf = (depth: number): unknown => {
  let style = indent.get(depth);
  if (!style) {
    const base = rowBox as any;
    const padding = { left: depth * 8 };
    indent.set(depth, (style = { ...base, layout: { ...base.layout, padding } }));
  }
  return style;
};

const ids = new Map<string, Uint8Array>();
const idBytes = (id: string): Uint8Array =>
  ids.get(id) ?? (ids.set(id, Buffer.from(id)), ids.get(id)!);

/**
 * The deepest box with an id and a role under the pointer: Clay's `over` is true for a box and for its ancestors, and
 * a box without a role is not a node of the tree, so the innermost a11y node is the one reported.
 */
function deepest(el: El): El | undefined {
  let best: El | undefined;
  for (const c of el.children) {
    if (!(c instanceof El)) continue;
    const inside = deepest(c);
    if (inside) best = inside;
    else if (isNode(c) && ui.over(idBytes(c.props.id))) best = c;
  }
  return best;
}

/** Is this box a node of the tree: an `id` and a `role` (a box with neither has nothing to report)? */
const isNode = (el: El): boolean =>
  typeof el.props.id === "string" && typeof el.props.role === "string";

/** Every id the page's tree carries: the elements a session file may name. */
function idsOf(el: El, out = new Set<string>()): Set<string> {
  if (typeof el.props.id === "string") out.add(el.props.id);
  for (const c of el.children) if (c instanceof El) idsOf(c, out);
  return out;
}

/**
 * The node of the snapshot the box drew: the same role at the same bounds (`ui.bounds` both ways), so the hovered box
 * reads the tree's own name for it.
 */
function nodeOf(node: A11yNode, role: string, bounds: Float32Array): A11yNode | undefined {
  const b = node.bounds;
  if (node.role === role && b !== undefined && b.every((v, i) => v === bounds[i])) return node;
  for (const child of node.children) {
    const hit = nodeOf(child, role, bounds);
    if (hit) return hit;
  }
  return undefined;
}

/** The tree's node for a box, by its role and the bounds the last layout gave it (undefined without a box). */
function nodeFor(el: El, snap: A11yNode): A11yNode | undefined {
  const id = el.props.id as string;
  const at = ui.bounds(idBytes(id));
  return at === undefined ? undefined : nodeOf(snap, el.props.role as string, at);
}

// --- the live values: the picked box's style numbers, which the value channel can move (the panel's fourth section)

/** Clay's sizing types, as pack.ts's `SIZING` and ui.c's `axis` read them: a size's row pins its axis to `FIXED`. */
const FIXED = 3;

/**
 * One row of the live values: a number of the resolved style, the `ui.value` fields it writes, the step the arrows take
 * and the range they keep to. `at` is the style's own value (never an override): the packed float, or — for a size whose
 * axis is `stretch` or `fit` and so has no pixel of its own in the 45 — the box's laid-out bounds. `put` is what a value
 * writes: a size writes its axis' type, min and max at once, so a change pins it to a pixel.
 */
export interface TuneRow {
  readonly name: string;
  readonly fields: readonly number[];
  readonly step: number;
  readonly min: number;
  readonly max: number;
  readonly at: (f: Float32Array, box?: Float32Array) => number;
  readonly put: (value: number) => number[];
}

/** A px row: one float, 1 a step. */
const pixels = (name: string, field: number, max = 4096, min = 0, at?: TuneRow["at"]): TuneRow => ({
  name,
  fields: [field],
  step: 1,
  min,
  max,
  at: at ?? ((f) => f[field]!),
  put: (v) => [v],
});
/** A colour channel: 4 a step, 0..255 (the step a 0..255 channel still reads as a colour). */
const channel = (name: string, field: number): TuneRow => ({
  name,
  fields: [field],
  step: 4,
  min: 0,
  max: 255,
  at: (f) => f[field]!,
  put: (v) => [v],
});
/** One of the renderer's group numbers (alpha, scale, translate, rotate): not one of the 45, `rest` when no override is
 *  written at all (a group at 255/1/0/0 is no scene, which is why the packed style holds no literal for it). */
const group = (name: string, field: number, rest: number, step: number, max: number, min = 0): TuneRow => ({
  name,
  fields: [field],
  step,
  min,
  max,
  at: () => rest,
  put: (v) => [v],
});
/** A size: `side` is 2 for a width and 3 for a height, its index in `ui.bounds`. */
const sized = (name: string, base: number, side: 2 | 3): TuneRow => ({
  name,
  fields: [base, base + 1, base + 2],
  step: 1,
  min: 0,
  max: 8192,
  at: (f, box) => (f[base] === FIXED ? f[base + 1]! : box?.[side] ?? f[base + 1]!),
  put: (v) => [FIXED, v, v],
});

const clampTo = (v: number, row: TuneRow) => Math.min(row.max, Math.max(row.min, v));
/** A number as a row prints it: at most two decimals (`scale`'s 0.96), and no trailing zero on an integer. */
const fmt = (n: number) => String(Math.round(n * 100) / 100);

const SIDES = ["l", "r", "t", "b"] as const;
const CORNERS = ["tl", "tr", "br", "bl"] as const;
const CHANNELS = ["r", "g", "b", "a"] as const;
// the four border widths (22..25), which say whether a border colour is visible at all; FIELDS names the colour, at 26
const BORDER_WIDTHS = [22, 23, 24, 25] as const;
// the floating block is read only for an element that declares one: pack.ts's 32 is the flag ui.c tests
const FLOATING = 32;

/**
 * The rows of one box: the `FIELDS` of `pack.ts` that `ui.c` reads and a value can move. A row is listed when the
 * number is part of this style's declaration and the change can be seen: the floating block only for a float, a border
 * colour only where a border is drawn, a shadow's blur only for a shadow, a gradient's alpha only for a gradient. The
 * group's numbers (alpha, scale, translate, rotate) are the renderer's for any element with an id, so they are always
 * there. Not listed: a text's colour (fields 51..54, which a text has instead of a box: the picked element is a box, and
 * a text's colour is only reachable through a text with an id) and the modes (`capture`, `clip`) and enums (the sizing
 * type, the alignments, a float's attach and parent) of the 45, which a step does not read as a value.
 */
export function tuneRows(
  f: Float32Array | undefined,
  box: Float32Array | undefined,
  v: Variant | undefined,
): TuneRow[] {
  if (f === undefined) return [];
  // a size first: the two numbers a box is tuned by most
  const rows: TuneRow[] = [sized("width", FIELDS.WIDTH, 2), sized("height", FIELDS.HEIGHT, 3)];
  for (const [i, side] of SIDES.entries()) rows.push(pixels(`padding.${side}`, FIELDS.PADDING + i));
  rows.push(pixels("gap", FIELDS.GAP));
  // the radius: one row when the four corners are one number (a pill), a row a corner when they are not (a tab's 8 8 0 0)
  const corners = [0, 1, 2, 3].map((i) => FIELDS.RADIUS + i);
  if (corners.every((c) => f[c] === f[FIELDS.RADIUS]))
    rows.push({
      name: "radius",
      fields: corners,
      step: 1,
      min: 0,
      max: 4096,
      at: (f) => f[FIELDS.RADIUS]!,
      put: (x) => [x, x, x, x],
    });
  else for (const [i, corner] of CORNERS.entries()) rows.push(pixels(`radius.${corner}`, FIELDS.RADIUS + i));
  for (const [i, chan] of CHANNELS.entries()) rows.push(channel(`bg.${chan}`, FIELDS.BACKGROUND + i));
  if (BORDER_WIDTHS.some((w) => f[w] !== 0))
    for (const [i, chan] of CHANNELS.entries()) rows.push(channel(`border.${chan}`, FIELDS.BORDER + i));
  if (f[FLOATING] !== 0) {
    rows.push(pixels("offsetX", FIELDS.OFFSET_X, 4096, -4096));
    rows.push(pixels("offsetY", FIELDS.OFFSET_Y, 4096, -4096));
    rows.push(pixels("expandW", FIELDS.EXPAND_W));
    rows.push(pixels("expandH", FIELDS.EXPAND_H));
    rows.push(pixels("zIndex", FIELDS.Z_INDEX, 32767, -32768));
  }
  const shadow = v?.shadow;
  if (shadow) rows.push(pixels("shadowBlur", FIELDS.SHADOW_BLUR, 1024, 0, () => shadow.blur));
  if (v?.backgroundImage) rows.push(group("gradientAlpha", FIELDS.GRADIENT_ALPHA, 255, 0.1, 255));
  rows.push(group("alpha", FIELDS.ALPHA, 255, 0.1, 255));
  rows.push(group("scale", FIELDS.SCALE, 1, 0.01, 8));
  rows.push(group("translateX", FIELDS.TRANSLATE_X, 0, 1, 4096, -4096));
  rows.push(group("translateY", FIELDS.TRANSLATE_Y, 0, 1, 4096, -4096));
  rows.push(group("rotate", FIELDS.ROTATE, 0, 1, 360, -360));
  return rows;
}

/**
 * Every field name the panel can show, with the row a session's entry is checked and written against: the union over
 * styles, so a name is known even on a box that does not list it this frame (writing it waits until the row exists).
 */
export const TUNE_FIELDS: ReadonlyMap<string, TuneRow> = new Map(
  (
    [
      sized("width", FIELDS.WIDTH, 2),
      sized("height", FIELDS.HEIGHT, 3),
      ...SIDES.map((side, i) => pixels(`padding.${side}`, FIELDS.PADDING + i)),
      pixels("gap", FIELDS.GAP),
      {
        name: "radius",
        fields: [FIELDS.RADIUS, FIELDS.RADIUS + 1, FIELDS.RADIUS + 2, FIELDS.RADIUS + 3],
        step: 1,
        min: 0,
        max: 4096,
        at: (f) => f[FIELDS.RADIUS]!,
        put: (x) => [x, x, x, x],
      },
      ...CORNERS.map((corner, i) => pixels(`radius.${corner}`, FIELDS.RADIUS + i)),
      ...CHANNELS.map((chan, i) => channel(`bg.${chan}`, FIELDS.BACKGROUND + i)),
      ...CHANNELS.map((chan, i) => channel(`border.${chan}`, FIELDS.BORDER + i)),
      pixels("offsetX", FIELDS.OFFSET_X, 4096, -4096),
      pixels("offsetY", FIELDS.OFFSET_Y, 4096, -4096),
      pixels("expandW", FIELDS.EXPAND_W),
      pixels("expandH", FIELDS.EXPAND_H),
      pixels("zIndex", FIELDS.Z_INDEX, 32767, -32768),
      pixels("shadowBlur", FIELDS.SHADOW_BLUR, 1024, 0),
      group("gradientAlpha", FIELDS.GRADIENT_ALPHA, 255, 0.1, 255),
      group("alpha", FIELDS.ALPHA, 255, 0.1, 255),
      group("scale", FIELDS.SCALE, 1, 0.01, 8),
      group("translateX", FIELDS.TRANSLATE_X, 0, 1, 4096, -4096),
      group("translateY", FIELDS.TRANSLATE_Y, 0, 1, 4096, -4096),
      group("rotate", FIELDS.ROTATE, 0, 1, 360, -360),
    ] as TuneRow[]
  ).map((row) => [row.name, row] as const),
);

/** A session's one override: the element's id, the panel's name for the field, and the number. */
export interface SessionEntry {
  readonly id: string;
  readonly field: string;
  readonly value: number;
}

/** A tuning session: the panel's overrides, data only (`{ "values": [ { "id", "field", "value" } ] }`). */
export interface Session {
  readonly values: SessionEntry[];
}

/** The panel's overrides as a session: ids sorted, each element's entries in the panel's row order, so the same
 *  session is the same bytes. */
export function sessionOf(overrides: ReadonlyMap<string, ReadonlyMap<string, number>>): Session {
  const order = new Map([...TUNE_FIELDS.keys()].map((name, i) => [name, i] as const));
  return {
    values: [...overrides.keys()].sort().flatMap((id) =>
      [...overrides.get(id)!]
        .sort(([a], [b]) => order.get(a)! - order.get(b)! || a.localeCompare(b))
        .map(([field, value]) => ({ id, field, value })),
    ),
  };
}

/** A session as the file `s` writes: two spaces a level and a newline at the end. */
export const sessionText = (session: Session): string => `${JSON.stringify(session, null, 2)}\n`;

/**
 * A session file's entries, checked before the first frame: a `values` array of `{ id, field, value }`, an element the
 * page has, a name the panel has a row for, and a number in that row's range. The error names the entry and why.
 */
export function parseSession(text: string, ids: ReadonlySet<string>): Session {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`tune: not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const values = (data as { values?: unknown } | null)?.values;
  if (!Array.isArray(values)) throw new Error('tune: no "values" array');
  return {
    values: values.map((entry: unknown, index) => {
      const n = index + 1;
      const { id, field, value } = (entry ?? {}) as { id?: unknown; field?: unknown; value?: unknown };
      if (typeof id !== "string") throw new Error(`tune: entry ${n}: no "id"`);
      if (!ids.has(id)) throw new Error(`tune: entry ${n}: no element "${id}" on the page`);
      if (typeof field !== "string") throw new Error(`tune: entry ${n}: no "field"`);
      const row = TUNE_FIELDS.get(field);
      if (row === undefined) throw new Error(`tune: entry ${n}: "${field}" is not a panel field`);
      if (typeof value !== "number" || !Number.isFinite(value) || value < row.min || value > row.max)
        throw new Error(
          `tune: entry ${n}: ${field} ${String(value)} is out of range ${row.min}..${row.max}`,
        );
      return { id, field, value };
    }),
  };
}

/** What the values section says before the pointer has been over a box. */
const NO_PICK = "nothing yet: the pointer over the page picks a box";
/** The keys, in the section's one footer line (`r` resets a row, Shift+R all of them; `*` is a live value). */
const KEYS = "Up/Down  Left/Right  r/Shift+R  * = live";
/** How many rows the section shows at once: two a line, and nine lines is the room left under the tree, the hovered box
 *  and the frame. A longer list keeps the selected row inside the window, and the footer says which rows are shown. */
const ROWS = 18;

/** The rows two a line: what the panel is laid out from, and what its footer's `3-12 of 17` counts. */
const pairs = (rows: readonly string[]): string[][] => {
  const out: string[][] = [];
  for (let i = 0; i < rows.length; i += 2) out.push(rows.slice(i, i + 2));
  return out;
};

/** The live values section: the box it is tuning, the rows in the window it has, and the keys' line under them. */
export interface Values {
  /** `id  role "name"  x,y w×h` of the picked box, or why there is none. */
  readonly target: string;
  /** The rows, in this box's order, as they read: `>` the selected one, `*` a live one. */
  readonly rows: string[];
  /** The keys and the window (`3-12 of 17`), and what a `*` is. */
  readonly footer: string;
}

/** What the panel shows: the tree's rows, the hovered box's two lines, the live values, and the frame's four lines. */
interface Shown {
  rows: Row[];
  hover: string[];
  values: Values;
  frame: string[];
}

export interface DevProps {
  readonly input: Input;
  /** The host's hook: the page samples the panel at its tick, before the tree is declared. */
  readonly motion?: Motion;
  /** The Widgets page's slider drag, as `main.ts` hands it to the page on its own. */
  readonly drag?: Drag;
  /** The theme the page's styles resolve under (the host's `View.theme`): the live values print the numbers the declare
   *  makes, so the panel resolves its styles under the same theme. */
  readonly theme?: () => string | undefined;
  /** A tuning session (`main.ts --tune`): read and checked before the first frame, and where `s` writes the current one
   *  (`dev-tune.json` when the flag is absent). */
  readonly tune?: string;
}

/**
 * The dev page: `size` (660x760), the Widgets page on the left and the panel on the right. The panel is four sections,
 * read every frame and printed when they change: the a11y tree, the hovered box, the frame's phases plus the draw and
 * present counters, and the live values of the box the pointer picked. The panel's sections are the page's last three
 * Tab stops, so its keys reach it the way the page's own controls get theirs.
 */
export function Dev(props: DevProps) {
  const [shown, setShown] = createSignal<Shown>({
    rows: [],
    hover: ["nothing"],
    values: { target: NO_PICK, rows: [], footer: KEYS },
    frame: [],
  });
  // which of the panel's parts has the page's focus (the panel's own Tab stops, `stop` below): the accent on its header
  const [focusPart, setFocusPart] = createSignal<string>();
  // the page is the Widgets component with no motion hook: its entry is off, and it writes no value of its own
  const pageEl = Widgets({ input: props.input, drag: props.drag }) as unknown as El;

  // the live values' state: the box the pointer picked (it stays picked while the pointer is elsewhere — the panel is not
  // the page, and the keyboard needs the numbers to stay), the box a click pinned (the tree's cursor, the hovered line
  // and the values, until Escape or a press on empty space), the rows the last reading made, and this panel's overrides:
  // an element's id, a row's name and the number written for it every frame — a session is the page's, so a box keeps
  // its numbers when the pointer picks another.
  let picked: El | undefined;
  let pickedId = "";
  let pinned: El | undefined;
  let pinnedId = "";
  let tune: TuneRow[] = [];
  let floats: Float32Array | undefined;
  let bounds: Float32Array | undefined;
  let sel = 0;
  const overrides = new Map<string, Map<string, number>>();
  const mine = (id: string): Map<string, number> => {
    let fields = overrides.get(id);
    if (fields === undefined) overrides.set(id, (fields = new Map()));
    return fields;
  };

  // `--tune`: the session, read and checked before the first frame. A bad entry throws with its number and why, so a
  // host that loads it fails on its message rather than on a frame without it.
  if (props.tune !== undefined) {
    for (const { id, field, value } of parseSession(readFileSync(props.tune, "utf8"), idsOf(pageEl)).values)
      mine(id).set(field, value);
  }

  let lastKey = "";
  let again = false;

  /** The box the pointer picked: the innermost node under it, kept while the pointer is off the page. */
  const pick = (box: El | undefined) => {
    if (box === undefined) return;
    const id = box.props.id as string;
    if (id === pickedId) return;
    picked = box;
    pickedId = id;
    sel = 0;
  };

  /** The box a click pins (`undefined`: empty space clears it). */
  const pin = (box: El | undefined) => {
    pinned = box;
    pinnedId = box === undefined ? "" : (box.props.id as string);
    if (box !== undefined) sel = 0;
  };

  /** `id  role "name"` of a box, the name from the tree at the same role and bounds (as the hovered line reads it). */
  const describe = (box: El, snap: A11yNode): string => {
    const id = box.props.id as string;
    const at = ui.bounds(idBytes(id));
    const node = at === undefined ? undefined : nodeOf(snap, box.props.role as string, at);
    return `${id}  ${box.props.role}${node?.name === undefined ? "" : ` "${node.name}"`}`;
  };

  /** The frame's four lines: the last frame's phases, the mean and the max of the last 30, and the counters. */
  const frameOf = (): string[] => {
    const last = stats[stats.length - 1];
    if (!last) return ["no frame yet"];
    const ms = last.map((n) => n / 1e6);
    const window = stats.slice(-WINDOW).map((s) => s[0]! + s[1]! + s[2]! + s[3]!);
    const mean = window.reduce((sum, s) => sum + s, 0) / window.length / 1e6;
    return [
      `events+flush ${two(ms[0]!)}   declare ${two(ms[1]!)}`,
      `layout ${two(ms[2]!)}   draw ${two(ms[3]!)}`,
      `last ${window.length}: mean ${two(mean)}  max ${two(Math.max(...window) / 1e6)} ms`,
      `draws ${ui.draws()}  presents ${ui.presents()}`,
    ];
  };

  /** The hovered box's two lines: its id, role and name, and its bounds. */
  const hoverOf = (snap: A11yNode, box: El | undefined): string[] => {
    if (box === undefined) return ["nothing", "the pointer is over the page's background"];
    const at = ui.bounds(idBytes(box.props.id as string));
    return [
      describe(box, snap),
      at === undefined ? "no bounds" : boxText([at[0]!, at[1]!, at[2]!, at[3]!]),
    ];
  };

  /**
   * The fourth section: the picked box's rows, and the number each one holds — the override when there is one, the
   * style's own otherwise (`*` marks an override, `>` the row the arrows act on). The box's style is resolved as the
   * declare resolves it: the host's theme and the states that hold for the box (the pointer is on it while it is picked,
   * and `:focus` where the page's focus is). A style that declares no box fields has no rows.
   */
  const valuesOf = (snap: A11yNode, el: El | undefined): Values => {
    if (el === undefined) return { target: NO_PICK, rows: [], footer: KEYS };
    const id = el.props.id as string;
    const style = el.props.style;
    const states: State[] = [];
    if (ui.over(idBytes(id))) states.push(":hover");
    if (el.props.focused) states.push(":focus");
    const v = style === undefined ? undefined : variant(style, props.theme?.(), states);
    floats = v?.box;
    bounds = ui.bounds(idBytes(id));
    tune = tuneRows(floats, bounds, v);
    sel = Math.min(sel, Math.max(0, tune.length - 1));
    const at =
      bounds === undefined ? "no bounds" : boxText([bounds[0]!, bounds[1]!, bounds[2]!, bounds[3]!]);
    const target = `${describe(el, snap)}  ${at}`;
    if (tune.length === 0) return { target, rows: [], footer: "no box fields: this style declares none" };
    // the window: as many rows as the panel has lines for, and it follows the selection, so a row being edited is on
    // screen; the footer says which rows of how many it is showing
    const start = Math.max(0, Math.min(sel - Math.floor(ROWS / 2), tune.length - ROWS));
    const fields = overrides.get(id);
    const rows = tune.slice(start, start + ROWS).map((row, i) => {
      const live = fields?.get(row.name);
      const caret = start + i === sel ? ">" : " ";
      return `${caret}${live === undefined ? " " : "*"} ${row.name} ${fmt(live ?? row.at(floats!, bounds))}`;
    });
    const range = tune.length > ROWS ? `  ${start + 1}-${start + rows.length} of ${tune.length}` : "";
    return { target, rows, footer: `${KEYS}${range}` };
  };

  /**
   * This frame's writes: one `ui.value` a field of every overridden row, called at the tick and so before the tree is
   * declared (the channel is a frame's: `ui_begin` clears it). A row's `put` is what a value writes — a size pins its
   * axis, the radius all four corners — and nothing is written while no row is overridden, so a panel that is not tuning
   * a frame leaves it the frame it was.
   */
  const write = () => {
    for (const [id, fields] of overrides) {
      if (fields.size === 0) continue;
      const bytes = idBytes(id);
      // a session file names a row whether or not the box lists it this frame; a write it cannot use (a text's field on
      // a box) waits in the table with no element to land on, which is ui.value's own business
      for (const [name, value] of fields) {
        const row = TUNE_FIELDS.get(name);
        if (row === undefined) continue;
        const values = row.put(value);
        row.fields.forEach((field, i) => ui.value(bytes, field, values[i]!));
      }
    }
  };

  /** The element the values act on: the pinned box, else the box under the pointer. */
  const target = (): El | undefined => pinned ?? picked;
  const targetId = (): string => pinnedId || pickedId;

  /** The row the arrows act on: the last reading's, by the selection the keys keep. */
  const row = (): TuneRow | undefined => tune[Math.min(sel, Math.max(0, tune.length - 1))];

  /** The change of one step: from the override, else the style's own, clamped to the row's range. */
  const step = (dir: 1 | -1) => {
    const r = row();
    const id = targetId();
    if (r === undefined || id === "") return;
    const now = overrides.get(id)?.get(r.name) ?? r.at(floats!, bounds);
    // two decimals: a 0.1 step of an alpha would otherwise read 254.90000000000003
    mine(id).set(r.name, clampTo(Math.round((now + dir * r.step) * 100) / 100, r));
  };

  /**
   * The values section's keys: Up/Down (Home/End) pick a row, Left/Right (and -/+) step it, r resets it, Shift+R all,
   * Escape clears the click's pin and s writes the session to the flag's path.
   */
  const valuesKey = (name: string): boolean => {
    if (name === "ArrowUp" || name === "ArrowDown" || name === "Home" || name === "End") {
      if (tune.length === 0) return false;
      const to =
        name === "Home" ? 0 : name === "End" ? tune.length - 1 : sel + (name === "ArrowDown" ? 1 : -1);
      sel = Math.max(0, Math.min(tune.length - 1, to));
      return true;
    }
    if (name === "ArrowRight" || name === "+") return step(1), row() !== undefined;
    if (name === "ArrowLeft" || name === "-") return step(-1), row() !== undefined;
    if (name === "r" || name === "R") {
      const r = row();
      return r !== undefined && (overrides.get(targetId())?.delete(r.name) ?? false);
    }
    if (name === "Shift+R") {
      const fields = overrides.get(targetId());
      const had = (fields?.size ?? 0) > 0;
      fields?.clear();
      return had;
    }
    if (name === "Escape") {
      const had = pinned !== undefined;
      pin(undefined);
      return had;
    }
    if (name === "s") {
      writeFileSync(props.tune ?? "dev-tune.json", sessionText(sessionOf(overrides)));
      return true;
    }
    return false;
  };

  /**
   * The panel's own Tab stops, in the page's focus manager and after the page's (`input.add` registers in call order, so
   * the panel's are the last three): Tab walks the page's controls, then the tree, the hover and the values; Shift+Tab
   * back. A key reaches a part only while it has the focus, as a key reaches a page's control.
   */
  const stop = (id: string, key?: (name: string) => boolean) => ({
    id,
    disabled: false,
    get focused() {
      return focusPart() === id;
    },
    focus: () => setFocusPart(id),
    blur: () => {
      if (focusPart() === id) setFocusPart(undefined);
    },
    keyDown: (name: string) => focusPart() === id && (key?.(name) ?? false),
    keyUp: () => false,
  });
  // Escape clears the click's pin wherever the panel's focus is; the values part has its own keys as well
  const unpin = (name: string): boolean => {
    if (name !== "Escape" || pinned === undefined) return false;
    pin(undefined);
    return true;
  };
  for (const part of [stop("dev-tree", unpin), stop("dev-hover", unpin), stop("dev-values", valuesKey)])
    props.input.add(part);

  /**
   * One reading of the panel: the page's tree, the box under the pointer, the picked box's values, and the frame's
   * numbers. The tree is rebuilt every frame and printed only when it changed; `ponytail:` nothing is cached between
   * frames, which at 28 nodes (0.09 ms with the hover walk) is cheaper than a diff — a page of hundreds of nodes wants a
   * window of rows (the List's `virtual.ts`) and rows as a golden instead of a panel.
   */
  const sample = () => {
    // the page's own props for this frame: a key's focus lands at the flush, which is after the host's tick
    flush();
    const snap = snapshot(pageEl);
    const box = deepest(pageEl);
    // a pin holds the tree's cursor, the hovered line and the values; without one the pointer picks (the values follow
    // it, and keep their box when it leaves the page)
    const rows = rowsOf(snap, 0, pinned === undefined ? undefined : nodeFor(pinned, snap));
    if (pinned === undefined) pick(box);
    const hover = hoverOf(snap, pinned ?? box);
    const values = valuesOf(snap, target());
    write();
    const key = `${rows.map((r) => `${r.depth}|${r.text}`).join("\n")}\n${hover.join("\n")}\n${values.target}\n${values.rows.join("\n")}\n${values.footer}`;
    // a change prints at once, and its frame's phases on the next reading: the phases of the frame the change was in
    // are only pushed by the host after this tick
    if (key !== lastKey) {
      lastKey = key;
      again = true;
      setShown({ rows, hover, values, frame: frameOf() });
      return;
    }
    if (!again) return;
    // the same tree, hover and values: the panel keeps the numbers it printed, so the frame is one a page at rest has
    again = false;
    setShown({ ...shown(), frame: frameOf() });
  };

  if (props.motion) {
    // a press on the page (not on the panel) pins the innermost node under it; empty space clears the pin
    let wasDown = false;
    props.motion.onPointer = (x, _y, down) => {
      if (down && !wasDown && x < pageSize.width) pin(deepest(pageEl));
      wasDown = down;
    };
    props.motion.tick = () => sample();
  }

  return (
    <box id="dev-root" style={s.root}>
      <box id="dev-left" style={s.left}>
        {pageEl}
      </box>
      <box id="dev-panel" style={s.panel}>
        <text style={focusPart() === "dev-tree" ? s.headOn : s.head}>a11y tree</text>
        <For each={shown().rows}>
          {(line) => (
            <box style={indentOf(line.depth)}>
              <text style={s.row}>{line.text}</text>
            </box>
          )}
        </For>
        <text style={focusPart() === "dev-hover" ? s.headOn : s.head}>hovered box</text>
        <For each={shown().hover}>{(line) => <text style={s.row}>{line}</text>}</For>
        <text style={focusPart() === "dev-values" ? s.headOn : s.head}>live values</text>
        <box style={rowBox}>
          <text style={s.row}>{shown().values.target}</text>
        </box>
        <For each={pairs(shown().values.rows)}>
          {(line) => (
            <box style={s.pair}>
              <For each={line}>
                {(text) => (
                  <box style={s.cell}>
                    <text style={text.startsWith(">") ? s.rowSel : s.row}>{text}</text>
                  </box>
                )}
              </For>
            </box>
          )}
        </For>
        <box style={rowBox}>
          <text style={s.row}>{shown().values.footer}</text>
        </box>
        <text style={s.head}>frame</text>
        <For each={shown().frame}>{(line) => <text style={s.row}>{line}</text>}</For>
      </box>
    </box>
  );
}

const s = { root, left, panel, head, headOn, row, rowSel, pair, cell };
