// The planning area, one file for its kinds — their layout and their own refusals side by side, because that is what the
// next kind of this area costs: a layout function, a check, one `register` at the bottom, and nothing else.
//
//   timeline      a row a step: its label, its span as a bar on one shared axis, the span's numbers, and the axis's ends
//   statusKey     the legend: a mark, the status's word, and what it means here
//   nowNextLater  three columns of cards — now, next, later — each card wrapped in its column
//
// The data is glyph-kit's `areas/planning.md` (MIT): a `gantt` row's `label`/`start`/`end` and its `options.width`,
// `.unit` and `.scale`; a `statusKey` row's `label`; a `board`'s `data.now`/`.next`/`.later`. What changed: a span's
// `start` and `end` are read on the axis's own unit and `scale` is gone, because this repository's plan has an order and
// dates, not hours — the axis's two ends say what a cell is. A `statusKey` row gained `sentence` (the kit's rows are a
// word only), and a `timeline` row gained `status`, `date` and `note`. The kit checks no planning figure's data, so
// every sentence here is ours in its voice.
import type { Bar, Item, Layout, LayoutLine, Paint } from "../registry.ts";
import { register } from "../registry.ts";
import type { NowNextLaterSpec, StatusKeySpec, TimelineSpec } from "../spec.ts";
import {
  cells,
  finish,
  focusOf,
  isObject,
  labelOf,
  longest,
  number,
  paintOf,
  rowsOf,
  say,
  textItem,
  type Json,
} from "./shared.ts";

/** The three columns of a board, in the order they are drawn and read. */
const COLUMNS = ["now", "next", "later"] as const;
/** A card's box: its words, and the two cells `[` `]` the text renderer puts around them. */
const CARD = 22;
const GAP = 2;
/** A status's word into the role a pixel target paints it by: done is good, blocked is the problem, left is the ink. */
const statusPaint = (status: string): Paint =>
  status === "Done" ? "good" : status === "Blocked" ? "problem" : "ink";

/** The axis's span in a whole number of cells, rounding a unit to its nearest cell. */
const cellOf = (value: number, from: number, to: number, width: number): number =>
  to > from ? Math.round(((value - from) * width) / (to - from)) : 0;

/**
 * A timeline: a step a row, its label, its span as a bar across one shared axis, the span's numbers and the date the
 * source records, and the axis's ends under the rows. A span is drawn where it starts: the cells before it are a space,
 * so the bar's left edge is the span's own cell and not the row's.
 */
function timeline(spec: TimelineSpec): Layout {
  const focus = focusOf(spec);
  const rows = spec.data;
  if (!rows.length) return finish(spec, "timeline", 0, [], [], []);
  const width = spec.options?.width ?? 40;
  const from = spec.options?.start ?? Math.min(0, ...rows.map((row) => row.start));
  const to = spec.options?.end ?? Math.max(...rows.map((row) => row.end), from + 1);
  const unit = spec.options?.unit ?? "";
  const labelWidth = longest(rows.map((row) => row.label)) + 1;
  const texts = rows.map((row) => {
    const span = `${row.start}–${row.end}${unit}`;
    return row.note ? `${span}  ${row.note}` : span;
  });
  const textWidth = longest(texts) + 1;
  const bars: Bar[] = [];
  const labels: Layout["labels"] = [];
  const lines: LayoutLine[] = [];
  rows.forEach((row, i) => {
    const paint = row.status ? statusPaint(row.status) : paintOf(focus, row.label);
    const start = Math.max(0, Math.min(width, cellOf(row.start, from, to, width)));
    const end = Math.max(start, Math.min(width, cellOf(row.end, from, to, width)));
    const span = end - start;
    const items: Item[] = [textItem(`fig-label-${i}`, row.label, labelWidth, paintOf(focus, row.label))];
    if (start > 0) items.push({ kind: "space", id: `fig-gap-${i}`, cells: start, paint });
    items.push({ kind: "bar", id: `fig-track-${i}`, fillId: `fig-fill-${i}`, cells: span, fill: span, paint });
    if (width > end) items.push({ kind: "space", id: `fig-rest-${i}`, cells: width - end, paint });
    items.push(textItem(`fig-num-${i}`, texts[i]!, textWidth, paint));
    lines.push({ items });
    bars.push({
      fillId: `fig-fill-${i}`,
      trackId: `fig-track-${i}`,
      textId: `fig-num-${i}`,
      label: row.label,
      value: span,
      max: width,
      fill: span,
      track: width,
      text: texts[i]!,
    });
    labels.push({ textId: `fig-label-${i}`, text: row.label });
  });
  // the axis's two ends, under the rows: the start's word at the axis's left cell, the end's right-aligned to its last,
  // so the numbers a row prints are read against the same cells the bar sits in. Spaces are items, not characters: a
  // space's advance is a cell here and a proportion of the type on the pixel target, where a string of them would drift.
  const startWord = `${from}${unit}`;
  const endWord = `${to}${unit}`;
  const gap = Math.max(1, width - cells(startWord) - cells(endWord));
  lines.push({
    items: [
      { kind: "space", id: "fig-axis-lead", cells: labelWidth, paint: "ink" },
      textItem("fig-axis-start", startWord, cells(startWord), "muted", "note"),
      { kind: "space", id: "fig-axis-mid", cells: gap, paint: "ink" },
      textItem("fig-axis-end", endWord, cells(endWord), "muted", "note"),
    ],
  });
  return finish(spec, "timeline", Math.max(labelWidth + width + textWidth, labelWidth + cells(startWord) + gap + cells(endWord)), lines, bars, labels);
}

/**
 * A status key: glyph-kit's `░░` ladder without the colour densities — a mark, the status's word, and its sentence.
 * The mark is one cell of the status's role on a pixel target (`▲` in the text half), and the word carries the same
 * role, so the key reads without colour and still says which status is the problem one.
 */
function statusKey(spec: StatusKeySpec): Layout {
  const focus = focusOf(spec);
  const rows = spec.data;
  const nameWidth = longest(rows.map((row) => row.label)) + 1;
  const width = 4 + nameWidth + longest(rows.map((row) => row.sentence));
  const labels: Layout["labels"] = [];
  const lines = rows.map((row, i) => {
    const paint = row.tone ?? statusPaint(row.label);
    labels.push({ textId: `fig-label-${i}`, text: row.label });
    return {
      items: [
        { kind: "marker", id: `fig-mark-${i}`, cells: 1, paint },
        { kind: "space", id: `fig-mark-gap-${i}`, cells: 1, paint: "ink" },
        textItem(`fig-label-${i}`, row.label, nameWidth, paintOf(focus, row.label)),
        { kind: "space", id: `fig-say-gap-${i}`, cells: 2, paint: "ink" },
        textItem(`fig-say-${i}`, row.sentence, cells(row.sentence) + 1, "muted"),
      ] satisfies Item[],
    };
  });
  return finish(spec, "statusKey", width, lines, [], labels);
}

/** One card's words as the lines that fit a column: a word that does not fit is cut, and no word is dropped. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (cells(candidate) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line), (line = "");
    let rest = word;
    while (cells(rest) > width) {
      // a code path (`tree`/`toolbar`/`tablist`) is one word with no space: break it at a slash, then cut
      const head = [...rest].slice(0, width).join("");
      const slash = head.lastIndexOf("/");
      const at = slash > 0 ? head.slice(0, slash + 1) : head;
      lines.push(at);
      rest = rest.slice(at.length);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

interface Segment {
  card: number;
  line: number;
  text: string;
}

/**
 * A board: `now`, `next`, `later` as three columns of boxes, a card wrapped inside its column. The rows are the card
 * lines, so a card of three lines pushes the other columns' next cards down: the columns are read across, as a board is.
 * A column with no card at a row is a space of the column's own cells, so the three columns stay the same width.
 */
function nowNextLater(spec: NowNextLaterSpec): Layout {
  const columns = COLUMNS.map((name) => {
    const cards = spec.data[name].map((card) => wrap(card, CARD - 2));
    const segments: Segment[] = cards.flatMap((lines, card) => lines.map((text, line) => ({ card, line, text })));
    return { name, cards, segments };
  });
  const rows = Math.max(...columns.map((column) => column.segments.length));
  const labelWidth = CARD;
  const width = columns.length * CARD + (columns.length - 1) * GAP;
  const labels: Layout["labels"] = [];
  const boxes: Layout["boxes"] = [];
  const head: Item[] = [];
  columns.forEach((column, c) => {
    if (c > 0) head.push({ kind: "space", id: `fig-col-gap-${c}`, cells: GAP, paint: "ink" });
    head.push(textItem(`fig-col-${c}`, column.name.toUpperCase(), CARD, "muted"));
  });
  const lines: LayoutLine[] = [{ items: head }];
  for (let row = 0; row < rows; row++) {
    const items: Item[] = [];
    columns.forEach((column, c) => {
      if (c > 0) items.push({ kind: "space", id: `fig-row-gap-${c}-${row}`, cells: GAP, paint: "ink" });
      const segment = column.segments[row];
      if (!segment) {
        items.push({ kind: "space", id: `fig-col-empty-${c}-${row}`, cells: CARD, paint: "ink" });
        return;
      }
      const id = `fig-card-${c}-${segment.card}-${segment.line}`;
      items.push({
        kind: "box",
        id,
        textId: `${id}-text`,
        text: segment.text,
        cells: CARD,
        paint: "ink",
        role: "step",
      });
      boxes.push({ id, textId: `${id}-text`, text: segment.text, role: "step" });
    });
    lines.push({ items });
  }
  columns.forEach((column) =>
    column.cards.forEach((card, i) =>
      labels.push({ textId: `fig-card-${columns.indexOf(column)}-${i}-0-text`, text: card[0] ?? "" }),
    ),
  );
  return finish(spec, "nowNextLater", Math.max(width, labelWidth), lines, [], labels, boxes);
}

/** A timeline: each row has a label, a start and an end, its end is after its start, and its span fits the width. */
function timelineProblems(data: unknown, options: unknown): string[] {
  const rows = rowsOf(data);
  if (!rows.length)
    return ['A timeline needs its rows: [{ "label": "research", "start": 0, "end": 2 }, ...], each with its span.'];
  const out: string[] = [];
  const o: Json = isObject(options) ? options : {};
  const width = number(o.width) ?? 40;
  const starts: number[] = [];
  const ends: number[] = [];
  const labels: string[] = [];
  const dates: (string | undefined)[] = [];
  rows.forEach((row, i) => {
    const label = isObject(row) && typeof row.label === "string" ? row.label.trim() : "";
    if (!label) out.push(`Row ${i + 1} needs a label: a step is a word, not ${say(isObject(row) ? row.label : row)}.`);
    labels.push(label || labelOf(row, i));
    const start = isObject(row) ? number(row.start) : undefined;
    const end = isObject(row) ? number(row.end) : undefined;
    if (start === undefined || end === undefined) {
      out.push(
        `${labels[i]} needs a start and an end: numbers on the axis, not ` +
          `${say(isObject(row) ? row.start : start)} to ${say(isObject(row) ? row.end : end)}.`,
      );
      return;
    }
    starts.push(start);
    ends.push(end);
    if (end < start) out.push(`${labels[i]} ends at ${end} before it starts at ${start}.`);
    else if (end === start) out.push(`${labels[i]} starts and ends at ${start}: a span needs an end after its start.`);
    const date = isObject(row) && typeof row.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : undefined;
    dates.push(date);
  });
  const from = number(o.start) ?? Math.min(0, ...starts);
  const to = number(o.end) ?? Math.max(...ends, from + 1);
  if (to <= from) out.push(`The timeline's axis runs ${from} to ${to}: its end must be after its start.`);
  for (let i = 1; i < dates.length; i++) {
    const date = dates[i];
    const before = dates[i - 1];
    if (date && before && date < before)
      out.push(`${labels[i]}'s date ${date} is before ${labels[i - 1]}'s ${before}: dates run down the rows.`);
  }
  rows.forEach((row, i) => {
    const end = isObject(row) ? number(row.end) : undefined;
    if (end === undefined) return;
    const cell = cellOf(end, from, to, width);
    if (cell > width)
      out.push(`${labels[i]} ends at cell ${cell}, past the timeline's ${width} cells (options.width).`);
  });
  return out;
}

/** A status key: a word and a sentence a row, one row a status, and every status the figures declare they use. */
function statusKeyProblems(data: unknown, options: unknown): string[] {
  const rows = rowsOf(data);
  if (!rows.length)
    return ['A status key needs its statuses: [{ "label": "Done", "sentence": "…" }, ...], each with what it means.'];
  const out: string[] = [];
  const o: Json = isObject(options) ? options : {};
  const used = Array.isArray(o.used) ? o.used.filter((name): name is string => typeof name === "string") : undefined;
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const label = isObject(row) && typeof row.label === "string" ? row.label.trim() : "";
    if (!label) out.push(`Row ${i + 1} needs a name: a status is a word, not ${say(isObject(row) ? row.label : row)}.`);
    else if (seen.has(label)) out.push(`${label} appears twice: one row a status.`);
    else seen.add(label);
    const sentence = isObject(row) && typeof row.sentence === "string" ? row.sentence.trim() : "";
    if (!sentence) out.push(`${label || `Row ${i + 1}`} needs a sentence: what the status means here.`);
  });
  if (used)
    for (const label of seen)
      if (!used.includes(label))
        out.push(`${label} is not a status any figure here uses: the declared ones are ${used.join(", ")}.`);
  return out;
}

/** A board: three columns, each with at least one card, and every card a piece of words. */
function nowNextLaterProblems(data: unknown): string[] {
  if (!isObject(data))
    return ['A board needs its three columns: { "now": [...], "next": [...], "later": [...] }.'];
  const out: string[] = [];
  for (const column of COLUMNS) {
    const cards = data[column];
    if (!Array.isArray(cards)) {
      out.push(`The ${column} column needs a list of cards: it is ${say(cards)}.`);
      continue;
    }
    if (!cards.length) out.push(`The ${column} column has no card: every column needs one.`);
    cards.forEach((card, i) => {
      if (typeof card !== "string" || !card.trim())
        out.push(`The ${column} column's card ${i + 1} is blank: a card is a step's words.`);
    });
  }
  return out;
}

register("timeline", { layout: timeline, check: timelineProblems });
register("statusKey", { layout: statusKey, check: statusKeyProblems });
register("nowNextLater", { layout: nowNextLater, check: nowNextLaterProblems });
