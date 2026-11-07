// The metrics area, one file for its kinds — their layout and their own refusals side by side, because that is what the
// next kind of this area costs: a layout function, a check, one `register` at the bottom, and nothing else.
//
//   barChart     one track a row, the fill value/max of it, at least one cell for a positive value and "+" past `max`
//   compare      two tracks a row, each row scaled by its own pair's maximum
//   contrast     a pair a row: its label, a track of ratio/21, the ratio and its verdict against the pair's floor
//   funnel       one track a step, value/first of it, so a step's width is its share of the first
//
// The sentences are glyph-kit's own where the kit has one: `guard.mjs`'s numbers-and-source rule, its funnel `neverGrows`
// ("… is more than …; a funnel never grows", spoken with the labels and numbers it compares), and the palette's direction
// sentence. A bar's negative value and the contrast pair's ratio (which must be the one its own colours make) are ours in
// the kit's voice, because its published scripts check neither.
import { contrastOf, HEX, shown } from "../contrast.ts";
import {
  barLine,
  exactFill,
  fillOf,
  finish,
  focusOf,
  formatValue,
  isObject,
  labelOf,
  longest,
  number,
  numberText,
  paintOf,
  rowsOf,
  say,
  textItem,
} from "./shared.ts";
import type { Bar, Item, Layout, LayoutLine, Paint, Pair } from "../registry.ts";
import { register } from "../registry.ts";
import type { BarChartSpec, CompareSpec, ContrastSpec, FunnelSpec } from "../spec.ts";

function barChart(spec: BarChartSpec): Layout {
  const focus = focusOf(spec);
  const rows = spec.data;
  const max = spec.options?.max ?? Math.max(...rows.map((r) => r.value));
  const track = spec.options?.width ?? 24;
  const labelWidth = longest(rows.map((r) => r.label)) + 1;
  const texts = rows.map((r) => numberText(r, max));
  const textWidth = longest(texts) + 1;
  const width = labelWidth + track + textWidth;
  const bars: Bar[] = [];
  const labels: Layout["labels"] = [];
  const lines = rows.map((row, i) => {
    const paint = paintOf(focus, row.label);
    const fill = fillOf(row.value, max, track);
    bars.push({
      fillId: `fig-fill-${i}`,
      trackId: `fig-track-${i}`,
      textId: `fig-num-${i}`,
      label: row.label,
      value: row.value,
      max,
      fill,
      track,
      text: texts[i]!,
    });
    labels.push({ textId: `fig-label-${i}`, text: row.label });
    return barLine(i, row.label, fill, track, texts[i]!, textWidth, labelWidth, paint);
  });
  return finish(spec, "barChart", width, lines, bars, labels);
}

function funnel(spec: FunnelSpec): Layout {
  const focus = focusOf(spec);
  const rows = spec.data;
  const first = rows[0]!.value;
  const track = spec.options?.width ?? 30;
  const labelWidth = longest(rows.map((r) => r.label)) + 1;
  const texts = rows.map((r) => `${formatValue(r.value)}  ${Math.round((100 * r.value) / first)}%`);
  const textWidth = longest(texts) + 1;
  const width = labelWidth + track + textWidth;
  const bars: Bar[] = [];
  const labels: Layout["labels"] = [];
  const lines = rows.map((row, i) => {
    const paint = paintOf(focus, row.label);
    const fill = fillOf(row.value, first, track);
    bars.push({
      fillId: `fig-fill-${i}`,
      trackId: `fig-track-${i}`,
      textId: `fig-num-${i}`,
      label: row.label,
      value: row.value,
      max: first,
      fill,
      track,
      text: texts[i]!,
    });
    labels.push({ textId: `fig-label-${i}`, text: row.label });
    return barLine(i, row.label, fill, track, texts[i]!, textWidth, labelWidth, paint);
  });
  return finish(spec, "funnel", width, lines, bars, labels);
}

function compare(spec: CompareSpec): Layout {
  const focus = focusOf(spec);
  const rows = spec.data;
  const track = spec.options?.width ?? 10;
  const labelWidth = longest(rows.map((r) => r.label)) + 1;
  const aTexts = rows.map((r) => r.aText ?? formatValue(r.a));
  const bTexts = rows.map((r) => r.bText ?? formatValue(r.b));
  const aWidth = longest(aTexts) + 1;
  const bWidth = longest(bTexts) + 1;
  // a cell between the two columns, so the before pair and the after pair read apart
  const width = labelWidth + track + aWidth + 1 + track + bWidth;
  const bars: Bar[] = [];
  const labels: Layout["labels"] = [];
  const lines: LayoutLine[] = [];
  const headers = spec.options?.headers;
  if (headers)
    lines.push({
      items: [
        textItem("fig-head-label", headers[0] ?? "", labelWidth, "muted"),
        textItem("fig-head-a", headers[1] ?? "", track + aWidth + 1, "muted"),
        textItem("fig-head-b", headers[2] ?? "", track + bWidth, "muted"),
      ],
    });
  rows.forEach((row, i) => {
    const paint = paintOf(focus, row.label);
    // a row's two bars share one scale, as glyph-kit's do: the row is the comparison (2.7 s against 7.7 s is a row's
    // own pair, not the column's), so a before and an after can be read against each other
    const max = Math.max(Math.abs(row.a), Math.abs(row.b), 0);
    const fillA = fillOf(Math.abs(row.a), max, track);
    const fillB = fillOf(Math.abs(row.b), max, track);
    // the two columns' bars are bars[2i] and bars[2i+1]: a row's own order is the data's
    bars.push(
      {
        fillId: `fig-fill-a-${i}`,
        trackId: `fig-track-a-${i}`,
        textId: `fig-num-a-${i}`,
        label: row.label,
        value: Math.abs(row.a),
        max,
        fill: fillA,
        track,
        text: aTexts[i]!,
      },
      {
        fillId: `fig-fill-b-${i}`,
        trackId: `fig-track-b-${i}`,
        textId: `fig-num-b-${i}`,
        label: row.label,
        value: Math.abs(row.b),
        max,
        fill: fillB,
        track,
        text: bTexts[i]!,
      },
    );
    labels.push({ textId: `fig-label-${i}`, text: row.label });
    lines.push({
      items: [
        textItem(`fig-label-${i}`, row.label, labelWidth, paint),
        { kind: "bar", id: `fig-track-a-${i}`, fillId: `fig-fill-a-${i}`, cells: track, fill: fillA, paint },
        textItem(`fig-num-a-${i}`, aTexts[i]!, aWidth, paint),
        { kind: "space", id: `fig-gap-${i}`, cells: 1, paint: "ink" },
        { kind: "bar", id: `fig-track-b-${i}`, fillId: `fig-fill-b-${i}`, cells: track, fill: fillB, paint },
        textItem(`fig-num-b-${i}`, bTexts[i]!, bWidth, paint),
      ],
    });
  });
  return finish(spec, "compare", width, lines, bars, labels);
}

/**
 * A contrast check: a pair a row — its label, a track of the ratio against 21:1 (one cell a point), the ratio and its
 * verdict against the pair's floor. A passing pair's row is the `good` role and a failing one the `problem` role, so the
 * verdict reads without reading the numbers; the ratio itself is the engine's, and `check` refuses a pair whose ratio is
 * not the one its colours make.
 */
function contrast(spec: ContrastSpec): Layout {
  const focus = focusOf(spec);
  const pairs = spec.data;
  // the scale runs to 21:1, one cell a point: WCAG's end, which is the same track for every pair
  const track = 21;
  const labelWidth = longest(pairs.map((pair) => pair.label)) + 1;
  const texts = pairs.map((pair) => `${shown(pair.ratio)}:1`);
  const textWidth = longest(texts) + 1;
  const verdicts = pairs.map((pair) => `${pair.ratio >= pair.min ? "pass" : "fails"} ${pair.min}:1`);
  const verdictWidth = longest(verdicts) + 1;
  const width = labelWidth + track + textWidth + verdictWidth;
  const bars: Bar[] = [];
  const records: Pair[] = [];
  const labels: Layout["labels"] = [];
  const lines = pairs.map((pair, i) => {
    const fill = exactFill(pair.ratio, 21, track);
    const pass = pair.ratio >= pair.min;
    const paint: Paint = pass ? "good" : "problem";
    bars.push({
      fillId: `fig-fill-${i}`,
      trackId: `fig-track-${i}`,
      textId: `fig-num-${i}`,
      label: pair.label,
      value: pair.ratio,
      max: 21,
      fill,
      track,
      text: texts[i]!,
    });
    records.push({ textId: `fig-num-${i}`, label: pair.label, ratio: pair.ratio, min: pair.min, pass, verdictId: `fig-verdict-${i}` });
    labels.push({ textId: `fig-label-${i}`, text: pair.label });
    return {
      items: [
        textItem(`fig-label-${i}`, pair.label, labelWidth, paintOf(focus, pair.label)),
        { kind: "bar", id: `fig-track-${i}`, fillId: `fig-fill-${i}`, cells: track, fill, paint },
        textItem(`fig-num-${i}`, texts[i]!, textWidth, paint, "ratio"),
        { kind: "space", id: `fig-verdict-gap-${i}`, cells: 1, paint: "ink" },
        textItem(`fig-verdict-${i}`, verdicts[i]!, verdictWidth, paint, "verdict"),
      ] satisfies Item[],
    };
  });
  return finish(spec, "contrast", width, lines, bars, labels, [], [], [], records);
}

/** Bar-chart data: labels and values, no negative bar, one value above zero to scale against. */
function barProblems(data: unknown): string[] {
  const rows = rowsOf(data);
  if (!rows.length) return ['A bar chart needs its rows: [{ "label": "Design QA", "value": 42 }, ...].'];
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!isObject(row) || typeof row.label !== "string" || number(row.value) === undefined)
      out.push(`${labelOf(row, i)} needs a label and a value: a number.`);
  }
  for (const row of rows) {
    if (!isObject(row)) continue;
    const value = number(row.value);
    if (value !== undefined && value < 0) out.push(`${labelOf(row, rows.indexOf(row))} has a negative value (${value}).`);
  }
  const values = rows.map((row) => (isObject(row) ? number(row.value) : undefined));
  if (values.every((v) => v === undefined || v <= 0))
    out.push("A bar chart needs a value above zero: every row is 0 or less.");
  return out;
}

/** A bar chart's own data rule and its `options.max`. */
function barChartProblems(data: unknown, options: unknown): string[] {
  const problems = barProblems(data);
  const max = isObject(options) ? number(options.max) : undefined;
  if (max !== undefined && max <= 0) problems.push(`options.max must be above zero: it is ${max}.`);
  return problems;
}

/** Funnel steps: each a label and a number, none negative, none larger than the step before it. */
function funnelProblems(data: unknown): string[] {
  const rows = rowsOf(data);
  if (!rows.length)
    return ['A funnel needs its steps: [{ "label": "visited", "value": 12400 }, ...], with the numbers going down.'];
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!isObject(row) || typeof row.label !== "string" || number(row.value) === undefined)
      out.push(`${labelOf(row, i)} needs a label and a value: a number.`);
  }
  const clean = rows.filter(isObject);
  for (let i = 0; i < clean.length; i++) {
    const value = number(clean[i]!.value);
    if (value !== undefined && value < 0)
      out.push(`${labelOf(clean[i], i)} has a negative value (${value}).`);
  }
  const first = clean.length ? number(clean[0]!.value) : undefined;
  if (first !== undefined && first <= 0)
    out.push(`A funnel needs its first step above zero: it is ${first}.`);
  for (let i = 1; i < clean.length; i++) {
    const row = clean[i]!;
    const before = clean[i - 1]!;
    const value = number(row.value);
    const prev = number(before.value);
    if (value !== undefined && prev !== undefined && value > prev)
      out.push(`${labelOf(row, i)} ${value} is more than ${labelOf(before, i - 1)} ${prev}; a funnel never grows`);
  }
  return out;
}

/** A comparison: two numbers a row, and a column that is not all zero. */
function compareProblems(data: unknown): string[] {
  const rows = rowsOf(data);
  if (!rows.length)
    return ['A comparison needs its rows: [{ "label": "build time", "a": 2.7, "b": 7.7, "aText": "2.7 s", "bText": "7.7 s" }].'];
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!isObject(row) || number(row.a) === undefined || number(row.b) === undefined)
      out.push(`${labelOf(row, i)} needs a and b: two numbers, and their texts when the unit is not the number.`);
  }
  const a = rows.map((row) => (isObject(row) ? number(row.a) : undefined));
  const b = rows.map((row) => (isObject(row) ? number(row.b) : undefined));
  if (a.every((v) => v === undefined || v <= 0)) out.push("A comparison needs a value above zero: the before column is 0 or less.");
  if (b.every((v) => v === undefined || v <= 0)) out.push("A comparison needs a value above zero: the after column is 0 or less.");
  return out;
}

/** The kit's `within` for WCAG's own three floors: a pair held to any other number is not a check anyone can pass. */
const FLOORS = [3, 4.5, 7] as const;

/**
 * A contrast check: pairs of a text colour and its page, each with WCAG's floor and the ratio of the two. The ratio must
 * be the ratio the colours make — that is the one thing this kind exists to keep honest: a pair typed with another colour
 * keeps its old number, and is refused here ("link on bgSubtle says 4.51:1, but #1971c2 on #f8f9fa makes 4.12:1.").
 */
function contrastProblems(data: unknown): string[] {
  const pairs = rowsOf(data);
  if (!pairs.length)
    return ['A contrast check needs its pairs: [{ "label": "ink on paper", "fg": "#080808", "bg": "#fbfbf8", "min": 4.5, "ratio": 19.36 }].'];
  const out: string[] = [];
  for (const [i, pair] of pairs.entries()) {
    if (!isObject(pair) || typeof pair.label !== "string" || !pair.label.trim()) {
      out.push(`Pair ${i + 1} needs a label: what the pair is for, like "ink on paper".`);
      continue;
    }
    const label = pair.label;
    for (const [field, value] of [["fg", pair.fg], ["bg", pair.bg]] as const)
      if (!HEX.test(String(value)))
        out.push(`${label}'s ${field} is a hex value like #080808, not ${say(value)}.`);
    const min = number(pair.min);
    if (min === undefined) out.push(`${label} needs a min: 3, 4.5 or 7, WCAG's three floors.`);
    else if (!(FLOORS as readonly number[]).includes(min))
      out.push(`${label}'s min is ${min}: a minimum is 3, 4.5 or 7, WCAG's three floors.`);
    const ratio = number(pair.ratio);
    if (ratio === undefined) {
      out.push(`${label} needs its ratio: the number of ${say(pair.fg)} on ${say(pair.bg)}, to two places.`);
      continue;
    }
    const own = contrastOf(pair.fg, pair.bg);
    if (own !== undefined && Math.abs(own - ratio) > 0.005)
      out.push(`${label} says ${shown(ratio)}:1, but ${pair.fg} on ${pair.bg} makes ${shown(own)}:1.`);
  }
  return out;
}

register("barChart", { layout: barChart, check: barChartProblems });
register("compare", { layout: compare, check: compareProblems });
register("contrast", { layout: contrast, check: contrastProblems });
register("funnel", { layout: funnel, check: funnelProblems });
