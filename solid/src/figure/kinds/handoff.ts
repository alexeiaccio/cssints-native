// The handoff and QA area, one file for its kinds — their layout and their own refusals side by side, because that is what
// the next kind of this area costs: a layout function, a check, one `register` at the bottom, and nothing else.
//
//   redline     the component's box, and the parts inside it as a leader row and the numbers the page's style gives
//   beforeAfter two states of one component side by side (or above/below when narrow), the numbers that changed under them
//   qaChecklist a comparison a row (its area, its check, its verdict), the key, and the summary its rows count
//
// The kit's `areas/handoff.md` has four kinds: `redline`, `qaChecklist`, `anatomy` and `compare`. `anatomy` is not here (a
// numbered component drawing is not a cell figure), and its before/after is `compare`, which this repository already draws
// as two bars a row; our `beforeAfter` is another shape of the same idea, so the three fields we took from it are the two
// states and their captions. What changed from the kit's data, kind by kind:
//
//   redline      the kit's `[{ label, size }]` is one row of proportional segments; ours is `{ box, parts }`, each part a
//                rectangle (x, y, width, height) inside the box, an `inset: true` part being a padding or a gap. The kit's
//                "widths are proportional, labels carry the real numbers" is the drawing rule: a leader is cells rounded
//                from the pixels (8px a cell), and the numbers row is the page's own pixels, so a redline cannot disagree
//                with the style it documents — `figure-handoff.test.ts` holds the numbers to the packed styles.
//   beforeAfter  the kit's `compare` rows are `{ label, a, b, aText, bText }` under `options.headers`. Ours is one
//                component twice: `{ before, after }`, each `{ caption, box, measures }`, and **no third column of typed
//                text**: the numbers that changed are computed from the two states, so a caption cannot claim a change the
//                states do not make. `specs/from-frames.ts` writes the demo's from two frames of the Widgets page.
//   qaChecklist  the kit's rows are `{ text, status, note }` with `done`/`progress`/`todo`/`blocked`, and its figure draws
//                "2 of 5 done" with a bar. Ours is `{ check, area, verdict, source }` (the check is the suite's own name,
//                the area is where it ran, the source is the script) with three verdicts — `pass`, `fail`, `n/a` — and the
//                summary is a field the check holds to the rows: a summary that disagrees with its rows is refused.
//
// These are the half of the kit whose data is **this repository's own**: a component's spacing from the page's style
// (Widgets.tsx's row/track/thumb), a component's two frames (the Widgets page's switch, off and on), and the suite's own
// comparisons (`solid/test.sh`, `terminal/test.sh`). So a figure cannot drift from what is drawn or from what passes.
import type { Bar, Item, Layout, LayoutLine, Paint, TextItem, TextRole } from "../registry.ts";
import { CELL_HEIGHT, CELL_WIDTH, register } from "../registry.ts";
import type { BeforeAfterData, BeforeAfterSpec, BeforeAfterState, QaChecklistSpec, RedlineSpec, Verdict } from "../spec.ts";
import { VERDICTS } from "../spec.ts";
import { cells, finish, focusOf, isObject, longest, number, paintOf, rowsOf, say, textItem } from "./shared.ts";

/** A text padded to a cell width with the one character a leader is made of: `·` a gap, `-` a part. */
const pad = (text: string, width: number, fill: string) => text + fill.repeat(Math.max(0, width - cells(text)));

/** A line's width in cells: what the figure's own width has to cover. */
const lineCells = (line: LayoutLine) => line.items.reduce((n, item) => n + item.cells, 0);

// ---- redline -----------------------------------------------------------------------------------------------------------

/**
 * A component's box with its parts redlined: the box's outline, one leader row where each part is a run of cells
 * proportional to its x and width, and a numbers row of the real pixels. A cell is 8px across, so a leader is the box's
 * width to the nearest cell (`280 / 8 = 35` exactly) and a number is never rounded: the page's own 10, 44, 24, 12. The
 * vertical half is numbers only (a cell is 16px tall, so a leader row cannot draw a 4px inset): the box's height and each
 * part's y and height are in the numbers row, and the check holds them inside the box.
 */
function redline(spec: RedlineSpec): Layout {
  const focus = focusOf(spec);
  const { box, parts } = spec.data;
  const boxCells = Math.max(1, Math.round(box.width / CELL_WIDTH));
  /** A pixel x as a cell boundary: the rounded fraction of the box the part's left edge is. */
  const at = (px: number) => Math.round((px / box.width) * boxCells);
  const heading = `${box.label} ${box.width}x${box.height}`;
  const legend = parts.map((part) => `${part.x},${part.y} ${part.width}x${part.height}`).join(" · ");
  const lines: LayoutLine[] = [
    { items: [textItem("fig-redline-heading", heading, cells(heading), "muted", "label")] },
    { items: [textItem("fig-redline-box", `+${"-".repeat(Math.max(0, boxCells - 2))}+`, boxCells, "ink")] },
  ];
  const leaders: Item[] = parts.map((part, i) => {
    const width = Math.max(1, at(part.x + part.width) - at(part.x));
    const size = `${part.width}x${part.height}`;
    const name = part.inset ? "" : cells(part.label) <= width ? part.label : cells(size) <= width ? size : "";
    const text = part.inset ? "·".repeat(width) : pad(name, width, "-");
    return textItem(`fig-redline-part-${i}`, text, width, paintOf(focus, part.label), part.inset ? "label" : "value");
  });
  lines.push({ items: leaders });
  lines.push({ items: [textItem("fig-redline-numbers", legend, cells(legend), "ink", "value")] });
  const labels = parts.map((part, i) => ({ textId: `fig-redline-part-${i}`, text: part.label }));
  return finish(spec, "redline", Math.max(...lines.map(lineCells)), lines, [], labels);
}

/** A redline's parts: a box with a size, and rectangles that tile it from the left, one a padding, a gap or a part. */
function redlineProblems(data: unknown): string[] {
  const redline = isObject(data) ? data : {};
  const box = isObject(redline.box) ? redline.box : undefined;
  const width = box ? number(box.width) : undefined;
  const height = box ? number(box.height) : undefined;
  if (!box || typeof box.label !== "string" || !box.label || width === undefined || height === undefined || !(width > 0) || !(height > 0))
    return [
      'A redline needs its box: { "label": "row", "width": 280, "height": 32 }, in pixels, and the parts inside it.',
    ];
  const parts = rowsOf(redline.parts);
  if (!parts.length)
    return [
      'A redline needs its parts: [{ "label": "track", "x": 10, "y": 4, "width": 44, "height": 24 }, ...], in pixels from the box\'s corner.',
    ];
  const out: string[] = [];
  const clean: { label: string; x: number; y: number; width: number; height: number }[] = [];
  for (const [i, part] of parts.entries()) {
    const x = isObject(part) ? number(part.x) : undefined;
    const y = isObject(part) ? number(part.y) : undefined;
    const w = isObject(part) ? number(part.width) : undefined;
    const h = isObject(part) ? number(part.height) : undefined;
    const named = isObject(part) && typeof part.label === "string" && part.label ? part.label : undefined;
    const label = named ?? `Part ${i + 1}`;
    if (x === undefined || y === undefined || w === undefined || h === undefined || named === undefined) {
      out.push(`${label} needs a label and a box: x, y, width and height in pixels.`);
      continue;
    }
    if (!(w > 0) || !(h > 0)) out.push(`${label} is ${w}x${h}: a part has a size.`);
    else if (w < CELL_WIDTH / 2)
      out.push(`${label} is ${w}px wide: a part at least half a cell (${CELL_WIDTH / 2}px) wide can be drawn.`);
    else clean.push({ label, x, y, width: w, height: h });
  }
  // the parts tile the box from its left edge, and each is inside it: the leader row is the box's width to a cell
  let end = 0;
  for (const part of clean) {
    if (part.x !== end)
      out.push(
        part.x < end
          ? `${part.label} starts at ${part.x}px, inside the part before it (${end}px): a redline's parts tile its width.`
          : `${part.label} starts at ${part.x}px, but the part before it ends at ${end}px: a redline's parts tile its width.`,
      );
    end = part.x + part.width;
    if (part.x >= width || part.y >= height)
      out.push(
        part.x >= width
          ? `${part.label} starts at ${part.x}px, but ${box.label} is ${width}px wide: an inset is inside its box.`
          : `${part.label} starts at ${part.y}px, but ${box.label} is ${height}px tall: an inset is inside its box.`,
      );
    else if (part.x + part.width > width)
      out.push(`${part.label} ends at ${part.x + part.width}px, past ${box.label}'s ${width}px: a part is inside its box.`);
    else if (part.y + part.height > height)
      out.push(`${part.label} ends at ${part.y + part.height}px, past ${box.label}'s ${height}px: a part is inside its box.`);
  }
  if (clean.length && end !== width)
    out.push(`the parts end at ${end}px, but ${box.label} is ${width}px wide: a redline's parts tile its width.`);
  return out;
}

function redlineNames(data: unknown): string[] {
  if (!isObject(data)) return [];
  const names: string[] = [];
  if (isObject(data.box) && typeof data.box.label === "string") names.push(data.box.label);
  for (const part of rowsOf(data.parts)) if (isObject(part) && typeof part.label === "string") names.push(part.label);
  return names;
}

// ---- beforeAfter -------------------------------------------------------------------------------------------------------

/** One number that changed, between the two states: computed, never typed. */
interface Change {
  label: string;
  before: string;
  after: string;
}

/** The numbers the two states do not share: the box's size first, then the measures in the before state's order. */
export function changesOf(data: BeforeAfterData): Change[] {
  const { before, after } = data;
  const out: Change[] = [];
  if (before.box.width !== after.box.width || before.box.height !== after.box.height)
    out.push({
      label: "the box",
      before: `${before.box.width}x${before.box.height}`,
      after: `${after.box.width}x${after.box.height}`,
    });
  for (const measure of before.measures) {
    const other = after.measures.find((row) => row.label === measure.label);
    if (other && other.value !== measure.value)
      out.push({ label: measure.label, before: measure.value, after: other.value });
  }
  return out;
}

/** One state's rows: its caption, its box as a rectangle in cells, and its measures. */
interface Panel {
  caption: TextItem;
  /** The box's rows: each in its own cells (the rectangle's width), so a box's drawn width is its `cells`. */
  box: { id: string; text: string; cells: number }[];
  measures: TextItem[];
}

/**
 * Two states of one component: each a caption, its box drawn as a rectangle of cells (`44x24` is `6x2` cells), and its
 * measures under it; then the numbers that changed, computed from the two states. Side by side when two columns fit the
 * 80-cell fence, above/below when they do not, so a narrow target stacks the same rows.
 */
function beforeAfter(spec: BeforeAfterSpec): Layout {
  const focus = focusOf(spec);
  const panelOf = (state: BeforeAfterState, prefix: "before" | "after"): Panel => {
    const width = Math.max(2, Math.round(state.box.width / CELL_WIDTH));
    const height = Math.max(2, Math.round(state.box.height / CELL_HEIGHT));
    const box: { id: string; text: string; cells: number }[] = [];
    for (let row = 0; row < height; row++) {
      const id = row === 0 ? `fig-${prefix}-box` : row === height - 1 ? `fig-${prefix}-box-end` : `fig-${prefix}-box-${row}`;
      const edge = row === 0 || row === height - 1;
      box.push({ id, text: edge ? `+${"-".repeat(width - 2)}+` : `|${" ".repeat(width - 2)}|`, cells: width });
    }
    return {
      caption: textItem(`fig-${prefix}-caption`, state.caption, cells(state.caption), paintOf(focus, state.caption), "label"),
      box,
      measures: state.measures.map((measure, i) =>
        textItem(`fig-${prefix}-measure-${i}`, `${measure.label} ${measure.value}`, cells(`${measure.label} ${measure.value}`), paintOf(focus, measure.label)),
      ),
    };
  };
  const before = panelOf(spec.data.before, "before");
  const after = panelOf(spec.data.after, "after");
  // a column is as wide as its widest row, and the two columns keep two cells between them
  const column = (panel: Panel, width: number) =>
    [panel.caption.text, ...panel.box.map((row) => row.text), ...panel.measures.map((measure) => measure.text)].reduce(
      (n, text) => Math.max(n, cells(text)),
      width,
    );
  const beforeWidth = column(before, before.caption.cells);
  const afterWidth = column(after, after.caption.cells);
  const lines: LayoutLine[] = [];
  /** One panel's row, padded to its column: the item's id is the row's, and the pads are spaces with no name. */
  const cellOf = (id: string, text: string, width: number, paint: Paint, role?: TextRole) =>
    textItem(id, pad(text, width, " "), width, paint, role);
  const blank = (id: string, width: number) => textItem(id, " ".repeat(width), width, "ink");
  const sideBySide = beforeWidth + afterWidth + 2 <= 76;
  if (sideBySide) {
    lines.push({
      items: [
        cellOf(before.caption.textId, before.caption.text, beforeWidth, before.caption.paint, before.caption.role),
        { kind: "space", id: "fig-beforeAfter-gap", cells: 2, paint: "ink" },
        cellOf(after.caption.textId, after.caption.text, afterWidth, after.caption.paint, after.caption.role),
      ],
    });
    const rows = Math.max(before.box.length, after.box.length);
    for (let row = 0; row < rows; row++) {
      const a = before.box[row];
      const b = after.box[row];
      const items: Item[] = [];
      // a box's row is its own cells (the rectangle's width), and the rest of the column is a space: a box's drawn width
      // is the box's, not the column's
      if (a) {
        items.push(cellOf(a.id, a.text, a.cells, "ink"));
        if (a.cells < beforeWidth) items.push({ kind: "space", id: `fig-before-box-pad-${row}`, cells: beforeWidth - a.cells, paint: "ink" });
      } else items.push(blank(`fig-before-box-blank-${row}`, beforeWidth));
      items.push({ kind: "space", id: `fig-beforeAfter-gap-${row}`, cells: 2, paint: "ink" });
      if (b) {
        items.push(cellOf(b.id, b.text, b.cells, "ink"));
        if (b.cells < afterWidth) items.push({ kind: "space", id: `fig-after-box-pad-${row}`, cells: afterWidth - b.cells, paint: "ink" });
      } else items.push(blank(`fig-after-box-blank-${row}`, afterWidth));
      lines.push({ items });
    }
    const measures = Math.max(before.measures.length, after.measures.length);
    for (let i = 0; i < measures; i++) {
      const a = before.measures[i];
      const b = after.measures[i];
      lines.push({
        items: [
          a ? cellOf(a.textId, a.text, beforeWidth, a.paint, a.role) : blank(`fig-before-measure-pad-${i}`, beforeWidth),
          { kind: "space", id: `fig-beforeAfter-measure-gap-${i}`, cells: 2, paint: "ink" },
          b ? cellOf(b.textId, b.text, afterWidth, b.paint, b.role) : blank(`fig-after-measure-pad-${i}`, afterWidth),
        ],
      });
    }
  } else {
    for (const [panel, width] of [
      [before, beforeWidth],
      [after, afterWidth],
    ] as const) {
      lines.push({ items: [cellOf(panel.caption.textId, panel.caption.text, width, panel.caption.paint, panel.caption.role)] });
      for (const row of panel.box) {
        const items: Item[] = [cellOf(row.id, row.text, row.cells, "ink")];
        if (row.cells < width) items.push({ kind: "space", id: `${row.id}-pad`, cells: width - row.cells, paint: "ink" });
        lines.push({ items });
      }
      for (const measure of panel.measures)
        lines.push({ items: [cellOf(measure.textId, measure.text, width, measure.paint, measure.role)] });
    }
  }
  // the number that changed, one a row: `the track 60,64,78 -> 240,140,50`
  const changes = changesOf(spec.data);
  changes.forEach((change, i) => {
    const text = `${change.label} ${change.before} -> ${change.after}`;
    const items: Item[] = [
      textItem(`fig-changed-label-${i}`, change.label, cells(change.label) + 1, paintOf(focus, change.label)),
      textItem(`fig-changed-${i}`, `${change.before} -> ${change.after}`, cells(`${change.before} -> ${change.after}`), "ink", "value"),
    ];
    lines.push({ items });
  });
  const labels = [
    ...spec.data.before.measures.map((measure, i) => ({ textId: `fig-before-measure-${i}`, text: measure.label })),
    ...spec.data.after.measures.map((measure, i) => ({ textId: `fig-after-measure-${i}`, text: measure.label })),
    ...changes.map((change, i) => ({ textId: `fig-changed-${i}`, text: change.label })),
  ];
  return finish(spec, "beforeAfter", Math.max(...lines.map(lineCells)), lines, [], labels);
}

/** Two states of one component: captions, two boxes, the same measures twice, and at least one number that changed. */
function beforeAfterProblems(data: unknown): string[] {
  if (!isObject(data))
    return [
      'A before/after needs its two states: { "before": { "caption": "off", "box": { "width": 44, "height": 24 }, "measures": [...] }, "after": { ... } }.',
    ];
  const out: string[] = [];
  const states: { caption: string; width?: number; height?: number; measures: { label: string; value: string }[] }[] = [];
  for (const name of ["before", "after"] as const) {
    const raw = data[name];
    if (!isObject(raw)) {
      out.push(`The ${name} state needs its caption, its box and its measures.`);
      states.push({ caption: "", measures: [] });
      continue;
    }
    const caption = typeof raw.caption === "string" ? raw.caption.trim() : "";
    if (!caption) out.push(`The ${name} state needs a caption: what it is, like "off".`);
    const box = isObject(raw.box) ? raw.box : undefined;
    const width = box ? number(box.width) : undefined;
    const height = box ? number(box.height) : undefined;
    if (width === undefined || height === undefined || !(width > 0) || !(height > 0))
      out.push(`The ${name} box needs a width and a height: 44x24, in pixels.`);
    const measures: { label: string; value: string }[] = [];
    const rows = rowsOf(raw.measures);
    if (!rows.length)
      out.push(`The ${name} state needs its measures: [{ "label": "the track", "value": "60,64,78" }], the same ones twice.`);
    for (const [i, row] of rows.entries()) {
      const label = isObject(row) && typeof row.label === "string" && row.label ? row.label : `Measure ${i + 1}`;
      if (!isObject(row) || typeof row.value !== "string" || !row.value.trim()) {
        out.push(`${name} ${label} needs a value: how the measure reads, like "60,64,78" or "2px".`);
        continue;
      }
      measures.push({ label, value: row.value.trim() });
    }
    states.push({ caption, width, height, measures });
  }
  const [before, after] = states as [
    { caption: string; width?: number; height?: number; measures: { label: string; value: string }[] },
    { caption: string; width?: number; height?: number; measures: { label: string; value: string }[] },
  ];
  // a caption is the state's name: two states captioned the same are the same state, and their boxes cannot differ
  if (before.caption && before.caption === after.caption && (before.width !== after.width || before.height !== after.height))
    out.push(
      `Both states are captioned ${say(before.caption)}, but their boxes differ (${before.width}x${before.height} against ` +
        `${after.width}x${after.height}): a caption names the state.`,
    );
  for (const measure of before.measures)
    if (!after.measures.some((row) => row.label === measure.label))
      out.push(`The before measures ${say(measure.label)} and the after does not: a before/after measures the same things twice.`);
  // a before/after with nothing different is two copies of one state
  const sameBox = before.width === after.width && before.height === after.height;
  const sameMeasures =
    before.measures.length > 0 &&
    before.measures.every((row) => after.measures.find((other) => other.label === row.label)?.value === row.value);
  if (sameBox && sameMeasures && before.caption && after.caption && before.caption !== after.caption)
    out.push(
      `Nothing changes between ${say(before.caption)} and ${say(after.caption)}: a before/after needs a number that ` +
        `changed, like the track's colour or the box's width.`,
    );
  return out;
}

function beforeAfterNames(data: unknown): string[] {
  const after = isObject(data) ? data : {};
  const names: string[] = [];
  for (const state of [after.before, after.after])
    if (isObject(state)) {
      if (typeof state.caption === "string") names.push(state.caption);
      for (const measure of rowsOf(state.measures))
        if (isObject(measure) && typeof measure.label === "string") names.push(measure.label);
    }
  return names;
}

// ---- qaChecklist -------------------------------------------------------------------------------------------------------

/** The three verdicts as the key draws them: a mark and the role its word is painted by. */
const KEY: ReadonlyArray<{ verdict: Verdict; mark: string; paint: Paint }> = [
  { verdict: "pass", mark: "+", paint: "good" },
  { verdict: "fail", mark: "x", paint: "problem" },
  { verdict: "n/a", mark: "-", paint: "muted" },
];

const verdictPaint = (verdict: Verdict): Paint => KEY.find((entry) => entry.verdict === verdict)?.paint ?? "ink";

/** `<pass> of <rows> pass`: the summary a checklist's rows make, which its own summary field must equal. */
export const summaryOf = (rows: readonly { verdict: Verdict }[]): string =>
  `${rows.filter((row) => row.verdict === "pass").length} of ${rows.length} pass`;

/**
 * A QA checklist: a row a comparison — its area, the check as the suite names it, its verdict — then the bar of the
 * passes over the rows with the summary's own words, and the key: `+ pass`, `x fail`, `- n/a` in the three roles. The
 * summary is the data's, and `check` refuses one that disagrees with the rows, so the figure cannot claim a pass count its
 * own rows do not hold.
 */
function qaChecklist(spec: QaChecklistSpec): Layout {
  const focus = focusOf(spec);
  const { summary, rows } = spec.data;
  const areaWidth = longest(rows.map((row) => row.area)) + 1;
  const checkWidth = longest(rows.map((row) => row.check)) + 1;
  const verdictWidth = longest([...VERDICTS]) + 1;
  const width = areaWidth + checkWidth + verdictWidth;
  const labels: Layout["labels"] = [];
  const lines: LayoutLine[] = rows.map((row, i) => {
    labels.push({ textId: `fig-qa-check-${i}`, text: row.check });
    return {
      items: [
        textItem(`fig-qa-area-${i}`, row.area, areaWidth, "muted", "label"),
        textItem(`fig-qa-check-${i}`, row.check, checkWidth, paintOf(focus, row.check)),
        textItem(`fig-qa-verdict-${i}`, row.verdict, verdictWidth, verdictPaint(row.verdict), "verdict"),
      ],
    };
  });
  // the summary: a cell a row, the passes as the fill, and the summary's words beside it
  const pass = rows.filter((row) => row.verdict === "pass").length;
  const track = Math.max(1, rows.length);
  const fill = rows.length ? Math.min(track, Math.round((track * pass) / rows.length)) : 0;
  const bars: Bar[] = [
    {
      fillId: "fig-qa-fill",
      trackId: "fig-qa-track",
      textId: "fig-qa-summary",
      label: "pass",
      value: pass,
      max: track,
      fill,
      track,
      text: summary,
    },
  ];
  lines.push({
    items: [
      { kind: "bar", id: "fig-qa-track", fillId: "fig-qa-fill", cells: track, fill, paint: "ink" },
      textItem("fig-qa-summary", summary, cells(summary) + 1, "ink", "value"),
    ],
  });
  // the key: each verdict's mark and its word, in the role its rows are painted by
  const key: Item[] = [];
  KEY.forEach((entry, i) => {
    if (i) key.push({ kind: "space", id: `fig-qa-key-gap-${i}`, cells: 1, paint: "ink" });
    const text = `${entry.mark} ${entry.verdict}`;
    key.push(textItem(`fig-qa-key-${entry.verdict.replace("/", "")}`, text, cells(text) + 1, entry.paint, "verdict"));
  });
  lines.push({ items: key });
  return finish(spec, "qaChecklist", Math.max(width, ...lines.map(lineCells)), lines, bars, labels);
}

/** A checklist: rows of a check, its area, its verdict and its source, and a summary its rows count. */
function qaChecklistProblems(data: unknown): string[] {
  const checklist = isObject(data) ? data : undefined;
  const rows = checklist ? rowsOf(checklist.rows) : [];
  if (!rows.length)
    return [
      'A checklist needs its rows: [{ "check": "solid/frames/sky.png", "area": "frames", "verdict": "pass", "source": "native/solid/test.sh" }].',
    ];
  const out: string[] = [];
  for (const [i, row] of rows.entries()) {
    const label = isObject(row) && typeof row.check === "string" && row.check ? row.check : `Row ${i + 1}`;
    if (
      !isObject(row) ||
      typeof row.check !== "string" ||
      !row.check ||
      typeof row.area !== "string" ||
      !row.area ||
      typeof row.source !== "string" ||
      !row.source
    ) {
      out.push(`${label} needs a check, an area and a source: what it compares, where, and the script that prints it.`);
      continue;
    }
    if (typeof row.verdict !== "string" || !(VERDICTS as readonly string[]).includes(row.verdict))
      out.push(`${label} has a verdict of ${say(row.verdict)}: the key is pass, fail or n/a.`);
  }
  const summary = checklist && typeof checklist.summary === "string" ? checklist.summary.trim() : "";
  if (!summary) {
    out.push('A checklist needs its summary: "12 of 12 pass", the rows counted.');
    return out;
  }
  const verdicts = rows.filter(isObject).map((row) => ({ verdict: row.verdict as Verdict }));
  const want = summaryOf(verdicts);
  if (summary !== want) out.push(`The summary says ${say(summary)}, but the rows count ${want}: a checklist's summary is its rows'.`);
  return out;
}

function qaChecklistNames(data: unknown): string[] {
  const checklist = isObject(data) ? data : undefined;
  const names: string[] = [];
  for (const row of rowsOf(checklist?.rows))
    if (isObject(row)) {
      if (typeof row.check === "string") names.push(row.check);
      if (typeof row.area === "string") names.push(row.area);
    }
  return names;
}

register("redline", { layout: redline, check: redlineProblems, names: redlineNames });
register("beforeAfter", { layout: beforeAfter, check: beforeAfterProblems, names: beforeAfterNames });
register("qaChecklist", { layout: qaChecklist, check: qaChecklistProblems, names: qaChecklistNames });
