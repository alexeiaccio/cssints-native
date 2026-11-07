// The charts area, one file for its kinds — their layout and their own refusals side by side, because that is what the
// next kind of this area costs: a layout function, a check, one `register` at the bottom, and nothing else.
//
//   sparkline  a series in a row: a point is an eighth-height bar (`▁`..`█`), its min and max under it, the last point
//              printed after the row
//   meter      one value against its range (0..max, a cell a point) and a floor: the track, the fill `value/max`, the
//              value, and its verdict (the engine's ratio against the floor)
//   heatmap    a matrix of ratios: a row an ink, a column a page, a cell one of four shades by the value's WCAG band
//   forecast   a dated series as columns (`#`), then the days ahead (`=`) inside the band the window's spread puts
//              around them (`:`), with the window and the fit under it — one cell a count, a column a day
//   cohort     a grid of shares: a row the accounts of one minute, a column a lag later, a cell the whole percent of them
//              that posted again — the firehose's own retention, from a recorded sample
//
// The kit has all three (`areas/metrics.md`): a sparkline's "print the first and last values; a sparkline has no axis", a
// meter's "over 100%, the bar stays full and the word over says the rest", a heatmap's "five levels is the limit people
// can tell apart" (we use four). Its published `check`s refuse a heatmap cell outside 0..1 and a meter's negative value
// or cap; ours are the repository's own, in its voice: a sparkline with fewer than two points or a point that is not a
// number, a meter whose value is outside its range or is not the ratio its colours make, a heatmap with ragged rows, a
// cell outside 1..21, a ratio its pair does not make, or a colour that is not `#rrggbb`.
//
// `forecast` is the fourth and the one whose data no kit has: a dated series and a projection of it, drawn as a column
// chart on the cell grid. Its samples are this repository's own `CHANGELOG.md` by way of `specs/from-releases.ts`, and the
// figure draws the generator's fit — it never computes the model itself, so what is printed under the drawing is the
// number the spec was written with. `check` refuses a forecast that cannot be drawn or argued with: no samples, dates
// that do not run forward, a horizon that is not a whole number above zero, a band below zero or upside down, and a model
// with no sentence.
//
// The two item kinds these needed are additions to the *format*, beside a palette's `swatch` and `marker`: `spark` (a
// point's `eighth`, a bar on a pixel target and a `▁`..`█` in text) and `shade` (one of four levels, `░▒▓█` in text and a
// step of `Figure.styles.ts`'s ramp on a pixel target). `text.ts` draws both in two branches and knows no kind.
import { contrastOf, HEX, shown } from "../contrast.ts";
import type { Bar, Item, Layout, LayoutLine, Paint, Pair } from "../registry.ts";
import { register } from "../registry.ts";
import type { CohortSpec, ForecastSpec, HeatmapSpec, MeterSpec, SparklineSpec } from "../spec.ts";
import {
  cells,
  exactFill,
  finish,
  focusOf,
  formatValue,
  isObject,
  labelOf,
  longest,
  number,
  paintOf,
  rowsOf,
  say,
  textItem,
} from "./shared.ts";

/** One point's eighth of a cell: 0 is `▁` and 7 is `█`, the same step glyph-kit's sparkline rounds a value to. */
export function sparkEighth(value: number, lo: number, hi: number): number {
  const span = hi - lo || 1;
  return Math.max(0, Math.min(7, Math.round(((value - lo) / span) * 7)));
}

/** WCAG's floors: a heatmap's four bands are under 3, 3 to 4.5, 4.5 to 7, and 7 and over. */
export const HEATMAP_BANDS = [3, 4.5, 7] as const;

/** A ratio's band as a shade: 0 under 3:1, 1 to 4.5, 2 to 7, 3 from 7:1 up (the floors themselves are the next band). */
export function shadeOf(value: number): 0 | 1 | 2 | 3 {
  if (value < HEATMAP_BANDS[0]) return 0;
  if (value < HEATMAP_BANDS[1]) return 1;
  if (value < HEATMAP_BANDS[2]) return 2;
  return 3;
}

const pad = (text: string, width: number): string => text + " ".repeat(Math.max(0, width - cells(text)));
/** The same, flush right: a number's column. */
const padLeft = (text: string, width: number): string => " ".repeat(Math.max(0, width - cells(text))) + text;

/**
 * A sparkline: the series in one row, a point an eighth of a cell (`▁`..`█`), and the last value printed after it. The
 * min and max are labelled under the row: a sparkline has no axis, so those two numbers are the scale it is read on.
 */
function sparkline(spec: SparklineSpec): Layout {
  const focus = focusOf(spec);
  const { label, values } = spec.data;
  const unit = spec.data.unit ? ` ${spec.data.unit}` : "";
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const paint = paintOf(focus, label);
  const labelWidth = cells(label) + 1;
  const last = `${formatValue(values[values.length - 1]!)}${unit}`;
  const lastWidth = cells(last) + 1;
  const note = `min ${formatValue(lo)}${unit}  max ${formatValue(hi)}${unit}`;
  const width = Math.max(labelWidth + values.length + 1 + lastWidth, cells(note));
  const points: Item[] = values.map((value, i) => ({
    kind: "spark",
    id: `fig-spark-${i}`,
    fillId: `fig-spark-fill-${i}`,
    textId: `fig-spark-text-${i}`,
    cells: 1,
    paint,
    eighth: sparkEighth(value, lo, hi),
  }));
  const lines: LayoutLine[] = [
    {
      items: [
        textItem("fig-label-0", label, labelWidth, paint),
        ...points,
        { kind: "space", id: "fig-last-gap", cells: 1, paint: "ink" },
        textItem("fig-last", last, lastWidth, "ink", "value"),
      ],
    },
    { items: [textItem("fig-spark-note", note, cells(note), "muted", "note")] },
  ];
  return finish(spec, "sparkline", width, lines, [], [{ textId: "fig-label-0", text: label }]);
}

/**
 * A meter: one value against its range and a floor — the track of 21 cells (a cell a point of a contrast ratio), the
 * fill `value/max` of it, the value and its verdict. The value is the engine's ratio of its two colours (the generated
 * `meter.json` writes it), and the verdict is the comparison `value >= min`, painted by the `good` or `problem` role.
 */
function meter(spec: MeterSpec): Layout {
  const focus = focusOf(spec);
  const { label, value, min } = spec.data;
  const max = spec.data.max ?? 21;
  const track = 21;
  const fill = exactFill(value, max, track);
  const pass = value >= min;
  const paint: Paint = pass ? "good" : "problem";
  const valueText = `${shown(value)}:1`;
  const verdict = `${pass ? "pass" : "fails"} ${min}:1`;
  const labelWidth = cells(label) + 1;
  const valueWidth = cells(valueText) + 1;
  const verdictWidth = cells(verdict) + 1;
  const width = labelWidth + track + valueWidth + 1 + verdictWidth;
  const bar: Bar = {
    fillId: "fig-fill-0",
    trackId: "fig-track-0",
    textId: "fig-num-0",
    label,
    value,
    max,
    fill,
    track,
    text: valueText,
  };
  const pair: Pair = { textId: "fig-num-0", label, ratio: value, min, pass, verdictId: "fig-verdict-0" };
  const lines: LayoutLine[] = [
    {
      items: [
        textItem("fig-label-0", label, labelWidth, paintOf(focus, label)),
        { kind: "bar", id: "fig-track-0", fillId: "fig-fill-0", cells: track, fill, paint },
        textItem("fig-num-0", valueText, valueWidth, paint, "ratio"),
        { kind: "space", id: "fig-gap-0", cells: 1, paint: "ink" },
        textItem("fig-verdict-0", verdict, verdictWidth, paint, "verdict"),
      ] satisfies Item[],
    },
  ];
  return finish(spec, "meter", width, lines, [bar], [{ textId: "fig-label-0", text: label }], [], [], [], [pair]);
}

/**
 * A heatmap: a row an ink, a column a page, and a cell the contrast ratio the two make as one of four shades (the band
 * table `shadeOf`). The value is written by `specs/from-charts.ts` from the engine's own ratio, and `check` refuses a
 * cell that is not the ratio its pair makes — so a shade is a number and a number is the engine's.
 */
function heatmap(spec: HeatmapSpec): Layout {
  const focus = focusOf(spec);
  const { rows, columns, values } = spec.data;
  const labelWidth = longest(rows.map((row) => row.label)) + 1;
  const cellWidth = Math.max(2, longest(columns.map((column) => column.label)));
  const columnWidth = cellWidth + 1;
  const header = " ".repeat(labelWidth) + columns.map((column) => pad(column.label, columnWidth)).join("");
  const [graphics, body, aaa] = HEATMAP_BANDS;
  const legend = `shades 0 under ${graphics}:1  1 ${graphics}-${body}  2 ${body}-${aaa}  3 ${aaa}:1+`;
  const width = Math.max(cells(header), cells(legend), labelWidth + columnWidth * columns.length);
  const lines: LayoutLine[] = [{ items: [textItem("fig-cols", header, cells(header), "muted", "label")] }];
  const labels: Layout["labels"] = [];
  rows.forEach((row, r) => {
    const items: Item[] = [textItem(`fig-label-${r}`, row.label, labelWidth, paintOf(focus, row.label), "label")];
    labels.push({ textId: `fig-label-${r}`, text: row.label });
    columns.forEach((column, c) => {
      const value = values[r]![c]!;
      items.push(
        { kind: "shade", id: `fig-shade-${r}-${c}`, cells: cellWidth, paint: "ink", level: shadeOf(value) },
        { kind: "space", id: `fig-shade-gap-${r}-${c}`, cells: 1, paint: "ink" },
      );
    });
    lines.push({ items });
  });
  lines.push({ items: [textItem("fig-legend", legend, cells(legend), "muted", "note")] });
  return finish(spec, "heatmap", width, lines, [], labels);
}

/**
 * A forecast: the days that happened as a column each (`#`), then the days ahead to the right of a one-cell gap — the
 * band's extent as `:` cells and the model's own count as an `=` inside it — with the days' max at the top, `0` on the
 * baseline, a few dates under it, the legend, and the window and the fit. The chart is a grid of characters, so the
 * terminal, the text half and the pixel targets draw the same cells: a run of `#` is the word `actual` without colour.
 */
function forecast(spec: ForecastSpec): Layout {
  const focus = focusOf(spec);
  const { samples, projection, mean, sd, horizon, window } = spec.data;
  const max = Math.max(1, ...samples.map((day) => day.value));
  // the three roles the legend names, and the one a focus may paint: a focus on "projection" recolours the days ahead
  const tone = (role: string, base: Paint): Paint => {
    const painted = paintOf(focus, role);
    return painted === "ink" ? base : painted;
  };
  const paint = {
    actual: tone("actual", "ink"),
    projection: tone("projection", "good"),
    band: tone("band", "muted"),
  };
  /** A count as the cells it fills, clamped to the chart's own scale. */
  const levelOf = (value: number): number => Math.max(0, Math.min(max, Math.round(value)));
  const gutter = cells(formatValue(max)) + 1;
  const days = samples.length;
  const gap = 1;
  const span = days + gap + projection.length;
  const width = gutter + span;
  const rows: Cell[][] = Array.from({ length: max }, () =>
    Array.from({ length: width }, () => ({ text: " ", paint: "ink" as Paint })),
  );
  const put = (row: number, col: number, text: string, painted: Paint): void => {
    const cellsOfRow = rows[row];
    if (cellsOfRow?.[col]) cellsOfRow[col] = { text, paint: painted };
  };
  samples.forEach((day, i) => {
    for (let n = 1; n <= levelOf(day.value); n++) put(max - n, gutter + i, "#", paint.actual);
  });
  projection.forEach((day, j) => {
    const low = Math.max(1, levelOf(day.low));
    const high = Math.max(low, levelOf(day.high));
    const col = gutter + days + gap + j;
    for (let n = low; n <= high; n++) put(max - n, col, ":", paint.band);
    put(max - Math.max(1, levelOf(day.value)), col, "=", paint.projection);
  });
  // the top row's gutter is the scale's top: the series' own maximum, a cell a count
  const top = rows[0];
  if (top) for (const [i, ch] of [...formatValue(max)].entries()) top[i] = { text: ch, paint: "muted" };
  const lines: LayoutLine[] = rows.map((cellsOfRow, r) => cellLine(`fig-plot-${r}`, cellsOfRow));
  lines.push({
    items: [
      textItem("fig-zero", "0", gutter, "muted", "note"),
      textItem("fig-axis", `+${"-".repeat(span - 1)}`, span, "muted", "connector"),
    ],
  });
  // a few dates under the axis: the first day, the middle one, the last that happened
  const at = [0, Math.floor((days - 1) / 2), days - 1];
  const dates: Item[] = [{ kind: "space", id: "fig-dates-gutter", cells: gutter, paint: "ink" }];
  let cursor = 0;
  for (const index of at) {
    const label = samples[index]!.date.slice(5);
    if (index > cursor)
      dates.push({ kind: "space", id: `fig-dates-gap-${index}`, cells: index - cursor, paint: "ink" });
    dates.push(textItem(`fig-date-${index}`, label, cells(label), "muted", "note"));
    cursor = index + cells(label);
  }
  lines.push({ items: dates });
  const legend: Item[] = [
    textItem("fig-legend-actual", "#", 1, paint.actual, "value"),
    textItem("fig-legend-actual-word", " actual", 7, "muted", "label"),
    { kind: "space", id: "fig-legend-gap-1", cells: 2, paint: "ink" },
    textItem("fig-legend-projection", "=", 1, paint.projection, "value"),
    textItem("fig-legend-projection-word", " projected", 10, "muted", "label"),
    { kind: "space", id: "fig-legend-gap-2", cells: 2, paint: "ink" },
    textItem("fig-legend-band", ":", 1, paint.band, "value"),
    textItem("fig-legend-band-word", " the band", 9, "muted", "label"),
  ];
  const fit = `mean ${shown(mean)} a day, sd ${shown(sd)}: the last ${window}, the next ${horizon}`;
  lines.push({ items: [{ kind: "space", id: "fig-legend-gutter", cells: gutter, paint: "ink" }, ...legend] });
  lines.push({
    items: [
      { kind: "space", id: "fig-fit-gutter", cells: gutter, paint: "ink" },
      textItem("fig-fit", fit, cells(fit), "muted", "note"),
    ],
  });
  const drawn = gutter + Math.max(span, cells(legendText(legend)), cells(fit));
  return finish(spec, "forecast", drawn, lines, [], []);
}

/** One cell of the plot: a character and the role it is painted by. */
interface Cell {
  text: string;
  paint: Paint;
}

/** A row of the plot as items: equal paints merge into one run, and blanks are a `space` (never a text of spaces). */
function cellLine(id: string, cellsOfRow: readonly Cell[]): LayoutLine {
  const items: Item[] = [];
  for (let at = 0; at < cellsOfRow.length; ) {
    const paint = cellsOfRow[at]!.paint;
    const blank = cellsOfRow[at]!.text === " ";
    let end = at + 1;
    while (
      end < cellsOfRow.length &&
      cellsOfRow[end]!.paint === paint &&
      (cellsOfRow[end]!.text === " ") === blank
    )
      end++;
    if (blank) items.push({ kind: "space", id: `${id}-${at}-gap`, cells: end - at, paint });
    else
      items.push({
        kind: "text",
        id: `${id}-${at}-cell`,
        textId: `${id}-${at}`,
        text: cellsOfRow.slice(at, end).map((cell) => cell.text).join(""),
        cells: end - at,
        paint,
      });
    at = end;
  }
  return { items };
}

/** A row of items as the characters it draws: what the legend's width is, and what a test reads the words back from. */
function legendText(items: readonly Item[]): string {
  return items
    .map((item) =>
      item.kind === "text"
        ? item.text + " ".repeat(Math.max(0, item.cells - cells(item.text)))
        : " ".repeat(item.cells),
    )
    .join("");
}

/** A sparkline: a label and two or more points, every one a number. */
function sparklineProblems(data: unknown): string[] {
  if (!isObject(data) || typeof data.label !== "string" || !data.label.trim())
    return ['A sparkline needs a label and its values: { "label": "draw", "values": [0.33, 0.31], "unit": "ms" }.'];
  const values = rowsOf(data.values);
  if (values.length < 2)
    return [`A sparkline needs at least two points: ${say(data.label)} has ${values.length}.`];
  const out: string[] = [];
  for (const [i, value] of values.entries())
    if (number(value) === undefined)
      out.push(`${say(data.label)} point ${i + 1} is ${say(value)}: a sparkline's points are numbers.`);
  return out;
}

/** WCAG's three floors: a meter held to any other number is not a check anyone can pass. */
const FLOORS = [3, 4.5, 7] as const;

/**
 * A meter: a label, two colours, the floor their ratio is held to, the ratio itself and the range's top. The value must
 * be the ratio the colours make (as a contrast pair's) and must sit in `0..max`; the floor is one of WCAG's three.
 */
function meterProblems(data: unknown): string[] {
  if (!isObject(data))
    return [
      'A meter needs its value: { "label": "link on bgSubtle", "fg": "#1971c2", "bg": "#f1f3f5", "min": 4.5, "value": 4.51, "max": 21 }.',
    ];
  const label = typeof data.label === "string" && data.label.trim() ? data.label : "This meter";
  const out: string[] = [];
  for (const [field, value] of [
    ["fg", data.fg],
    ["bg", data.bg],
  ] as const)
    if (!HEX.test(String(value))) out.push(`${label}'s ${field} is a hex value like #080808, not ${say(value)}.`);
  const min = number(data.min);
  if (min === undefined) out.push(`${label} needs a min: 3, 4.5 or 7, WCAG's three floors.`);
  else if (!(FLOORS as readonly number[]).includes(min))
    out.push(`${label}'s min is ${min}: a minimum is 3, 4.5 or 7, WCAG's three floors.`);
  const max = data.max === undefined ? 21 : number(data.max);
  if (max === undefined || !(max > 0)) out.push(`${label}'s max is ${say(data.max)}: a meter's range ends above zero.`);
  const value = number(data.value);
  if (value === undefined) {
    out.push(`${label} needs its value: the number of ${say(data.fg)} on ${say(data.bg)}, to two places.`);
    return out;
  }
  if (max !== undefined && (value < 0 || value > max))
    out.push(`${label} is ${value}, outside 0 to ${max}: a meter's value sits in its range.`);
  const own = contrastOf(data.fg, data.bg);
  if (own !== undefined && Math.abs(own - value) > 0.005)
    out.push(`${label} says ${shown(value)}:1, but ${data.fg} on ${data.bg} makes ${shown(own)}:1.`);
  return out;
}

/** A heatmap: rows of inks, columns of pages, and one value a cell, every ratio the engine's and in 1..21. */
function heatmapProblems(data: unknown): string[] {
  if (!isObject(data))
    return [
      'A heatmap needs its rows, columns and values: { "rows": [{ "label": "grey.7", "fg": "#495057" }], "columns": [{ "label": "bg", "bg": "#f8f9fa" }], "values": [[7.75]] }.',
    ];
  const rows = rowsOf(data.rows);
  const columns = rowsOf(data.columns);
  const grid = rowsOf(data.values);
  if (!rows.length || !columns.length)
    return ['A heatmap needs a row an ink and a column a page: [{ "label": "grey.7", "fg": "#495057" }] and [{ "label": "bg", "bg": "#f8f9fa" }].'];
  const out: string[] = [];
  const rowLabels: string[] = [];
  for (const [i, row] of rows.entries()) {
    if (!isObject(row) || typeof row.label !== "string" || !row.label.trim()) {
      out.push(`Heatmap row ${i + 1} needs a label: the ink's name, like "grey.7".`);
      rowLabels.push(`row ${i + 1}`);
      continue;
    }
    rowLabels.push(row.label);
    if (!HEX.test(String(row.fg))) out.push(`${row.label}'s fg is a hex value like #495057, not ${say(row.fg)}.`);
  }
  const columnLabels: string[] = [];
  for (const [i, column] of columns.entries()) {
    if (!isObject(column) || typeof column.label !== "string" || !column.label.trim()) {
      out.push(`Heatmap column ${i + 1} needs a label: the page's name, like "bg".`);
      columnLabels.push(`column ${i + 1}`);
      continue;
    }
    columnLabels.push(column.label);
    if (!HEX.test(String(column.bg))) out.push(`${column.label}'s bg is a hex value like #f8f9fa, not ${say(column.bg)}.`);
  }
  if (grid.length !== rows.length)
    out.push(`The heatmap has ${grid.length} value row${grid.length === 1 ? "" : "s"} for ${rows.length} ink${rows.length === 1 ? "" : "s"}: a row a foreground.`);
  for (const [r, row] of grid.entries()) {
    const values = rowsOf(row);
    if (values.length !== columns.length) {
      out.push(
        `${rowLabels[r] ?? `row ${r + 1}`} has ${values.length} value${values.length === 1 ? "" : "s"} for ` +
          `${columns.length} background${columns.length === 1 ? "" : "s"}; a heatmap is one value a cell.`,
      );
      continue;
    }
    const ink = rows[r];
    for (const [c, value] of values.entries()) {
      const where = `${rowLabels[r] ?? `row ${r + 1}`} on ${columnLabels[c] ?? `column ${c + 1}`}`;
      const ratio = number(value);
      if (ratio === undefined) {
        out.push(`${where} is ${say(value)}: a heatmap's cell is a ratio, 1 to 21.`);
        continue;
      }
      if (ratio < 1 || ratio > 21) out.push(`${where} is ${ratio}: a ratio runs from 1 to 21.`);
      const page = columns[c];
      if (!isObject(ink) || !isObject(page)) continue;
      const own = contrastOf(ink.fg, page.bg);
      if (own !== undefined && Math.abs(own - ratio) > 0.005)
        out.push(`${where} says ${shown(ratio)}:1, but ${ink.fg} on ${page.bg} makes ${shown(own)}:1.`);
    }
  }
  return out;
}

/** A date as a forecast writes it: `YYYY-MM-DD`, which sorts as it reads. */
const DAY_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The three roles the legend names, which is what a focus may point at: a date is a drawn note, not a heading. */
const FORECAST_ROLES = ["actual", "projection", "band"] as const;

/**
 * A forecast: the days that happened, in date order with their counts; the days ahead with a band each; a horizon and a
 * window that are whole days; the fit's mean and sd; and the model in a sentence. A count is never negative, so a band
 * that starts below zero or upside down is refused before it can be drawn as a cell.
 */
function forecastProblems(data: unknown): string[] {
  if (!isObject(data))
    return [
      'A forecast needs its samples: { "samples": [{ "date": "2026-10-10", "value": 1 }], "projection": [{ "date": "2026-11-05", "value": 2.5, "low": 0.21, "high": 4.79 }], "horizon": 7, "window": 14, "mean": 2.5, "sd": 2.29, "model": "…" }.',
    ];
  const out: string[] = [];
  const samples = rowsOf(data.samples);
  if (!samples.length)
    out.push("A forecast needs its samples: the days that happened, one a date and a count, a quiet day a zero.");
  let before: string | undefined;
  samples.forEach((row, i) => {
    const date = isObject(row) && typeof row.date === "string" ? row.date : "";
    const value = isObject(row) ? number(row.value) : undefined;
    if (!DAY_DATE.test(date))
      out.push(`Sample ${i + 1}'s date is ${say(isObject(row) ? row.date : row)}: a day, as 2026-10-10 is one.`);
    if (value === undefined || value < 0)
      out.push(
        `${date || `Sample ${i + 1}`} is ${say(isObject(row) ? row.value : undefined)}: a forecast counts releases, ` +
          "a whole number from zero up.",
      );
    if (date && before !== undefined && !(date > before))
      out.push(`Sample ${i + 1}'s date ${date} is not after ${before}: a forecast's days run forward.`);
    if (date) before = date;
  });
  const mean = number(data.mean);
  const sd = number(data.sd);
  const projection = rowsOf(data.projection);
  if (!projection.length)
    out.push("A forecast needs its projection: the days ahead, one a date, the model's count and its band.");
  projection.forEach((row, i) => {
    const date = isObject(row) && typeof row.date === "string" ? row.date : `Projection ${i + 1}`;
    const value = isObject(row) ? number(row.value) : undefined;
    const low = isObject(row) ? number(row.low) : undefined;
    const high = isObject(row) ? number(row.high) : undefined;
    if (value === undefined || low === undefined || high === undefined) {
      out.push(
        `${date} needs a count and its band: { "date": "2026-11-05", "value": 2.5, "low": 0.21, "high": 4.79 }.`,
      );
      return;
    }
    if (low < 0) out.push(`${date}'s band starts at ${low}: a count is not negative.`);
    else if (low > high) out.push(`${date}'s band runs ${low} to ${high}: its low is above its high.`);
  });
  const horizon = number(data.horizon);
  if (horizon === undefined || !Number.isInteger(horizon) || horizon <= 0)
    out.push(`A forecast's horizon is ${say(data.horizon)}: a whole number of days above zero.`);
  const window = number(data.window);
  if (window === undefined || !Number.isInteger(window) || window <= 0)
    out.push(`A forecast's window is ${say(data.window)}: the whole days the fit is taken over.`);
  if (mean === undefined) out.push("A forecast needs the fit's mean: the count a day the projection is drawn at.");
  if (sd === undefined || sd < 0) out.push(`A forecast's sd is ${say(data.sd)}: a spread from zero up.`);
  if (typeof data.model !== "string" || !data.model.trim())
    out.push("A forecast needs its model: which window and which fit, in a sentence, so the projection can be argued with.");
  return out;
}

/** A forecast's focus names one of the legend's three roles: actual, projection or band. */
const forecastNames = (): string[] => [...FORECAST_ROLES];

/** A sparkline's or a meter's focus names its label; a heatmap's names an ink or a page. */
function labelNames(data: unknown): string[] {
  return isObject(data) && typeof data.label === "string" ? [data.label] : [];
}

function heatmapNames(data: unknown): string[] {
  const heatmap = isObject(data) ? data : {};
  return [
    ...rowsOf(heatmap.rows).flatMap((row, i) => (isObject(row) ? [labelOf(row, i)] : [])),
    ...rowsOf(heatmap.columns).flatMap((column, i) => (isObject(column) ? [labelOf(column, i)] : [])),
  ];
}


/** The paint a share takes: 20% and up is the figure's brightest, 10–19 its ink, under 10 its muted step. */
const sharePaint = (value: number): Paint => (value >= 20 ? "title" : value >= 10 ? "ink" : "muted");

/**
 * A cohort grid: a row a minute's accounts, a column a lag later, a cell the share of that row's accounts that posted
 * again in it (a whole percent, the generator's rounding). The heading row is the lags, the first column the cohort and
 * its size — because a share of 3 accounts and a share of 3,000 read the same as a percentage. The figure draws the
 * sample; it never computes the retention itself.
 */
function cohort(spec: CohortSpec): Layout {
  const focus = focusOf(spec);
  const { lags, cohorts } = spec.data;
  const headings = lags.map((lag) => `+${lag}m`);
  const labelWidth = Math.max(6, longest(["cohort", ...cohorts.map((row) => row.label)])) + 1;
  const sizeWidth = Math.max(1, longest(["n", ...cohorts.map((row) => String(row.size))])) + 1;
  const cellWidth = Math.max(longest([...headings, "100%"])) + 1;
  const header =
    pad("cohort", labelWidth) + padLeft("n", sizeWidth) + headings.map((heading) => padLeft(heading, cellWidth)).join("");
  const lines: LayoutLine[] = [{ items: [textItem("fig-cols", header, cells(header), "muted", "label")] }];
  const labels: Layout["labels"] = [];
  cohorts.forEach((row, r) => {
    const items: Item[] = [
      textItem(`fig-label-${r}`, pad(row.label, labelWidth), labelWidth, paintOf(focus, row.label), "label"),
      textItem(`fig-size-${r}`, padLeft(String(row.size), sizeWidth), sizeWidth, "muted", "note"),
    ];
    labels.push({ textId: `fig-label-${r}`, text: row.label });
    row.values.forEach((value, c) => {
      const text = padLeft(`${value}%`, cellWidth);
      items.push(textItem(`fig-share-${r}-${c}`, text, cellWidth, sharePaint(value), "value"));
    });
    lines.push({ items });
  });
  const share = "a cell: the share of that minute's accounts that posted again L minutes later";
  const paintNote = "paint: 20%+ bright, 10–19 ink, under 10 muted; n is the cohort's accounts";
  lines.push({ items: [textItem("fig-share-note", share, cells(share), "muted", "note")] });
  lines.push({ items: [textItem("fig-paint-note", paintNote, cells(paintNote), "muted", "note")] });
  const width = Math.max(cells(header), cells(share), cells(paintNote));
  return finish(spec, "cohort", width, lines, [], labels);
}

/** A cohort grid: a window in whole minutes, lags above zero, a row a minute inside the window, a share 0..100. */
function cohortProblems(data: unknown): string[] {
  if (!isObject(data))
    return [
      'A cohort grid needs its window, lags and cohorts: { "window": 20, "lags": [1, 2, 3], "cohorts": [{ "label": "0m", "size": 1983, "values": [12, 8, 6] }] }.',
    ];
  const out: string[] = [];
  const window = number(data.window);
  if (window === undefined || window <= 0 || !Number.isInteger(window))
    out.push(`A cohort grid needs its window: whole minutes above zero, not ${say(data.window)}.`);
  const lags = rowsOf(data.lags);
  const lagsOk: number[] = [];
  if (!lags.length) out.push("A cohort grid needs its lags: [1, 2, 3, 4, 5].");
  for (const [i, lag] of lags.entries()) {
    const minutes = number(lag);
    if (minutes === undefined || minutes <= 0 || !Number.isInteger(minutes))
      out.push(`Lag ${i + 1} is whole minutes above zero, not ${say(lag)}.`);
    else lagsOk.push(minutes);
  }
  const cohorts = rowsOf(data.cohorts);
  if (!cohorts.length)
    out.push('A cohort grid needs its cohorts: [{ "label": "0m", "size": 1983, "values": [12, 8, 6] }].');
  const seen = new Set<string>();
  let lastMinute = -1;
  for (const [r, raw] of cohorts.entries()) {
    if (!isObject(raw)) {
      out.push(`Cohort ${r + 1} is not a cohort: { "label": "0m", "size": 1983, "values": [...] } is.`);
      continue;
    }
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    if (!label) out.push(`Cohort ${r + 1} needs its label: the minute it is, like "0m".`);
    else if (!/^\d+m$/.test(label))
      out.push(`Cohort ${r + 1}'s label is a minute of the window, like "0m", not ${say(raw.label)}.`);
    else {
      if (seen.has(label)) out.push(`"${label}" is two cohorts: one minute, one row.`);
      seen.add(label);
      const minute = Number.parseInt(label, 10);
      if (minute < lastMinute) out.push(`Cohort ${label} comes after ${lastMinute}m: a grid's minutes run forward.`);
      lastMinute = Math.max(lastMinute, minute);
      if (window !== undefined && lagsOk.length)
        for (const lag of lagsOk)
          if (minute + lag >= window)
            out.push(`Cohort ${label}'s +${lag}m is past the window's ${window} minutes: a lag is inside the recording.`);
    }
    const size = number(raw.size);
    if (size === undefined || size <= 0 || !Number.isInteger(size))
      out.push(`Cohort ${label || r + 1} needs its size: whole accounts above zero, not ${say(raw.size)}.`);
    const values = rowsOf(raw.values);
    if (values.length !== lags.length)
      out.push(`Cohort ${label || r + 1} has ${values.length} share${values.length === 1 ? "" : "s"} for ${lags.length} lag${lags.length === 1 ? "" : "s"}: a column a lag.`);
    for (const [c, value] of values.entries()) {
      const share = number(value);
      if (share === undefined || share < 0 || share > 100)
        out.push(`Cohort ${label || r + 1}'s +${c + 1} is a whole percent from 0 to 100, not ${say(value)}.`);
    }
  }
  return out;
}

/** The names a cohort grid draws: each cohort's label (a focus names a row) and each lag's heading. */
function cohortNames(data: unknown): string[] {
  const grid = isObject(data) ? data : {};
  return [
    ...rowsOf(grid.cohorts).flatMap((row, i) => (isObject(row) ? [labelOf(row, i)] : [])),
    ...rowsOf(grid.lags).map((lag) => `+${String(lag)}m`),
  ];
}

register("forecast", { layout: forecast, check: forecastProblems, names: forecastNames });
register("cohort", { layout: cohort, check: cohortProblems, names: cohortNames });
register("heatmap", { layout: heatmap, check: heatmapProblems, names: heatmapNames });
register("meter", { layout: meter, check: meterProblems, names: labelNames });
register("sparkline", { layout: sparkline, check: sparklineProblems, names: labelNames });
