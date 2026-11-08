// The cohort grid, read back from the recording and from its own frame: Bluesky's Jetstream sample, twenty minutes of
// app.bsky.feed.post, drawn as a row a minute. The test is the kind's honesty:
//
//   (a) every cohort, size and share is recomputed here from `solid/samples/jetstream.json` — independently of
//       `specs/from-cohort.ts`, so a generator that counted authors or minutes wrongly fails here and not only in its
//       own `cmp`;
//   (b) the drawing: the heading is the lags, a row's first cell is its label, a cell is its share in whole percent, and
//       the paint is the band the share falls in (20 and up bright, 10–19 ink, under 10 muted);
//   (c) the refusals, in their sentences, and the mutation a share over all accounts would pass (a different number);
//   (d) the command golden, the terminal's rows and the text half.
//
//   bun solid/figure-cohort.test.ts
import "./plugin.ts";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { capture } = await import("./dump.ts");
const { CELL_HEIGHT, CELL_WIDTH, PADDING_X, PADDING_Y, layoutOf } = await import("./src/figure/kinds.ts");
const { check, parse } = await import("./src/figure/spec.ts");
const { cellWidth, render } = await import("./src/figure/text.ts");
const { format } = await import("./src/format.ts");

import type { Layout, LayoutLine } from "./src/figure/kinds.ts";
import type { CohortSpec } from "./src/figure/spec.ts";

interface Cmd {
  type: string;
  element: string | null;
  box: number[];
  text?: string;
}
interface Dump {
  commands: Cmd[];
  effects: unknown;
  size: [number, number];
}
interface Sample {
  url: string;
  minutes: number;
  taken: string;
  events: number;
  posts: number;
  accounts: number;
  authors: number[][];
}

let failed = 0;
let checks = 0;
const ok = (what: string, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what: string, why: string) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));

const spec = (() => {
  const parsed = parse(readFileSync(new URL("./specs/cohort.json", import.meta.url), "utf8"), {
    dir: new URL("./specs/", import.meta.url).pathname,
  });
  if (!parsed.spec) throw new Error(`solid/specs/cohort.json: ${parsed.problems.join(" ")}`);
  return parsed.spec as CohortSpec;
})();

// ---- (a) the recording's own grid, recomputed here and not by specs/from-cohort.ts ------------------------------------

const sample = JSON.parse(readFileSync(new URL("./samples/jetstream.json", import.meta.url), "utf8"), {
  dir: new URL("./specs/", import.meta.url).pathname,
}) as Sample;

/** The minute a cohort's label names, or `undefined` for a label that is not one. */
const minuteOf = (label: string): number | undefined => {
  const match = /^(\d+)m$/.exec(label);
  return match ? Number(match[1]) : undefined;
};

/** The grid the sample makes: a cohort a minute, a share per lag, in whole percent — this file's own arithmetic. */
function gridOf(recording: Sample): { label: string; size: number; values: number[] }[] {
  const byMinute = new Map<number, number[]>();
  recording.authors.forEach((minutes, account) => {
    for (const minute of minutes) {
      if (minute < 0 || minute >= recording.minutes) continue;
      byMinute.set(minute, [...(byMinute.get(minute) ?? []), account]);
    }
  });
  const lags = spec.data.lags;
  return [...byMinute.keys()]
    .sort((a, b) => a - b)
    .filter((minute) => minute + Math.max(...lags) < recording.minutes)
    .map((minute) => {
      const members = byMinute.get(minute)!;
      return {
        label: `${minute}m`,
        size: members.length,
        values: lags.map((lag) =>
          Math.round((100 * members.filter((account) => recording.authors[account]!.includes(minute + lag)).length) / members.length),
        ),
      };
    });
}

const grid = gridOf(sample);
if (JSON.stringify(grid) === JSON.stringify(spec.data.cohorts))
  ok(
    "the data is the sample",
    `${grid.length} cohorts of ${sample.minutes} minutes, recomputed from ${sample.accounts} accounts; the first is ` +
      `${grid[0]!.label} ${grid[0]!.size} at ${grid[0]!.values.join("/")}%`,
  );
else {
  const at = grid.findIndex((row, i) => JSON.stringify(row) !== JSON.stringify(spec.data.cohorts[i]));
  bad("the data is the sample", `row ${at < 0 ? grid.length : at + 1} differs from the recording (regenerate with specs/from-cohort.ts)`);
}

// a row is one minute's posters: its size is the number of accounts whose minutes include it, so the first row's size is
// that count, and the sum over rows is larger than the sample's accounts (an account can be in three rows)
const firstMinute = minuteOf(spec.data.cohorts[0]!.label)!;
const firstPosters = sample.authors.filter((minutes) => minutes.includes(firstMinute)).length;
const distinct = new Set(
  spec.data.cohorts.flatMap((row) =>
    sample.authors.flatMap((minutes, account) => (minutes.includes(minuteOf(row.label)!) ? [account] : [])),
  ),
).size;
if (spec.data.cohorts[0]!.size === firstPosters && spec.data.cohorts[0]!.size > 0 && distinct <= sample.accounts)
  ok(
    "the cohorts are minutes",
    `${spec.data.cohorts[0]!.label} is the ${firstPosters} accounts whose minutes include it; the ${spec.data.cohorts.length} ` +
      `rows are ${spec.data.cohorts.reduce((sum, row) => sum + row.size, 0)} posters over ${distinct} distinct accounts`,
  );
else
  bad(
    "the cohorts are minutes",
    `${spec.data.cohorts[0]!.label} has ${spec.data.cohorts[0]!.size} accounts, the sample ${firstPosters}; ${distinct} distinct of ${sample.accounts}`,
  );

// ---- (b) the drawing ------------------------------------------------------------------------------------------------

const layout = layoutOf(spec);
const rows = layout.lines.slice(spec.title ? 1 : 0, (spec.title ? 1 : 0) + 1 + spec.data.cohorts.length);
const rowText = (line: LayoutLine) =>
  line.items.map((item) => (item.kind === "text" ? item.text : " ".repeat(item.cells))).join("");

const header = rowText(rows[0]!);
const headings = spec.data.lags.map((lag) => `+${lag}m`);
if (headings.every((heading) => header.includes(heading)) && header.trimStart().startsWith("cohort"))
  ok("the heading", `"${header.trim()}" — the lags, one a column`);
else bad("the heading", `${JSON.stringify(header)} is not the lags ${JSON.stringify(headings)}`);

let wrongCell = 0;
spec.data.cohorts.forEach((cohort, r) => {
  const drawn = rowText(rows[r + 1]!);
  if (!drawn.trimStart().startsWith(cohort.label)) {
    if (!wrongCell) bad(`row ${cohort.label}`, `${JSON.stringify(drawn)} does not start with its label`);
    wrongCell++;
    return;
  }
  for (const [c, value] of cohort.values.entries()) {
    if (!drawn.includes(`${value}%`)) {
      if (!wrongCell) bad(`row ${cohort.label}`, `${JSON.stringify(drawn)} has no ${value}% for +${spec.data.lags[c]}m`);
      wrongCell++;
    }
  }
});
if (!wrongCell) ok("the cells", `${spec.data.cohorts.length} rows, each share in its column as a whole percent`);
else bad("the cells", `${wrongCell} of ${spec.data.cohorts.length} rows differ`);

const shareItems = layout.lines
  .slice(1 + (spec.title ? 1 : 0))
  .flatMap((line) => line.items)
  .filter((item) => item.kind === "text" && /^fig-share-\d+-\d+$/.test(item.textId ?? ""));
const painted = shareItems.every((item) => {
  const value = Number(item.text.replace("%", "").trim());
  return item.paint === (value >= 20 ? "title" : value >= 10 ? "ink" : "muted");
});
if (shareItems.length === spec.data.cohorts.length * spec.data.lags.length && painted)
  ok("the bands", `${shareItems.length} cells painted by their share: 20 and up title, 10–19 ink, under 10 muted`);
else bad("the bands", `${shareItems.length} share cells, and ${painted ? "every" : "not every"} paint matches its band`);

// the mutation a share over the whole sample would pass: the figure would be the same drawing with other numbers
const overAll = spec.data.cohorts.map((row) => {
  const minute = minuteOf(row.label)!;
  return spec.data.lags.map((lag) =>
    Math.round((100 * sample.authors.filter((minutes) => minutes.includes(minute + lag)).length) / sample.accounts),
  );
});
if (JSON.stringify(overAll) !== JSON.stringify(spec.data.cohorts.map((row) => row.values)))
  ok("mutation: a share over every account", `${overAll[0]!.join("/")}% against the cohort's ${spec.data.cohorts[0]!.values.join("/")}% — the denominator is the row`);

// ---- (c) the refusals ----------------------------------------------------------------------------------------------

const refuses = (what: string, input: unknown, sentence: string) => {
  const problems = check(input);
  if (problems.some((problem) => problem === sentence || problem.includes(sentence))) ok(`check: ${what}`, sentence);
  else bad(`check: ${what}`, `no refusal with ${JSON.stringify(sentence)}: ${JSON.stringify(problems)}`);
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const source = "Sample: the firehose's minute cohorts";
const base = () => clone(spec.data);
refuses(
  "no cohorts",
  { kind: "cohort", source, data: { ...base(), cohorts: [] } },
  'A cohort grid needs its cohorts: [{ "label": "0m", "size": 1983, "values": [12, 8, 6] }].',
);
refuses(
  "a lag of zero",
  { kind: "cohort", source, data: { ...base(), lags: [0] } },
  "Lag 1 is whole minutes above zero, not 0.",
);
refuses(
  "a lag past the window",
  { kind: "cohort", source, data: { ...base(), cohorts: [{ label: "18m", size: 10, values: [1, 1, 1, 1, 1] }] } },
  "Cohort 18m's +2m is past the window's 20 minutes: a lag is inside the recording.",
);
refuses(
  "a share over 100",
  { kind: "cohort", source, data: { ...base(), cohorts: [{ label: "0m", size: 10, values: [101, 1, 1, 1, 1] }] } },
  "Cohort 0m's +1 is a whole percent from 0 to 100, not 101.",
);
refuses(
  "a row of the wrong width",
  { kind: "cohort", source, data: { ...base(), cohorts: [{ label: "0m", size: 10, values: [1, 1] }] } },
  "Cohort 0m has 2 shares for 5 lags: a column a lag.",
);
refuses(
  "a cohort with no accounts",
  { kind: "cohort", source, data: { ...base(), cohorts: [{ label: "0m", size: 0, values: [1, 1, 1, 1, 1] }] } },
  "Cohort 0m needs its size: whole accounts above zero, not 0.",
);

// ---- (d) the golden, the terminal and the text half -----------------------------------------------------------------

const frame = (await capture("figure", undefined, { spec, warm: 2 })) as Dump;
const golden = readFileSync(new URL("./goldens/figure-cohort.json", import.meta.url), "utf8").trim();
const got = format({ commands: frame.commands, effects: frame.effects });
if (got === golden) ok("the golden", "solid/goldens/figure-cohort.json, every command field identical");
else {
  const at = got.split("\n").findIndex((text, i) => text !== golden.split("\n")[i]);
  bad("the golden", `solid/goldens/figure-cohort.json differs at line ${at + 1}: ${JSON.stringify(got.split("\n")[at])}`);
}

/** The terminal's dump as rows: above the colour table, dots and runs of blanks dropped (figure.test.ts's reading). */
function rowsOfCells(text: string): string[] {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith("# colours"));
  return lines
    .slice(0, at < 0 ? lines.length : at)
    .map((line) => line.replace(/\./g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
/** The frame's rows as characters, each text command at its own cell column. */
function rowsOfFrame(dump: Dump): string[] {
  const rows = new Map<number, Cmd[]>();
  for (const command of dump.commands)
    if (command.type === "text" && command.text !== undefined) {
      const row = Math.round(command.box[1]! / CELL_HEIGHT);
      rows.set(row, [...(rows.get(row) ?? []), command]);
    }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, parts]) => {
      let line = "";
      for (const part of parts.sort((a, b) => a.box[0]! - b.box[0]!)) {
        const col = Math.round((part.box[0]! - PADDING_X * CELL_WIDTH) / CELL_WIDTH);
        line += " ".repeat(Math.max(0, col - cellWidth(line))) + (part.text ?? "");
      }
      return line;
    });
}
const normalise = (line: string) => line.replace(/\./g, " ").replace(/\s+/g, " ").trim();
const height = layout.lines.reduce((n, line) => n + (line.height ?? 1), 0) + 2 * PADDING_Y;
const cols = Math.max(80, layout.width + 2 * PADDING_X);
const out = join(mkdtempSync(join(tmpdir(), "cssints-figure-cohort-")), "cohort.txt");
const run = spawnSync(
  "bun",
  [
    "terminal/solid.ts",
    "--page",
    "figure",
    "--spec",
    new URL("./specs/cohort.json", import.meta.url).pathname,
    "--cols",
    String(cols),
    "--rows",
    String(height),
    "--dump",
    out,
  ],
  { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" },
);
if (run.status !== 0) bad("the terminal", `exit ${run.status}: ${run.stderr.trim()}`);
else {
  const cells = rowsOfCells(readFileSync(out, "utf8"));
  const pixel = rowsOfFrame(frame).map(normalise).filter(Boolean);
  const at = cells.findIndex((cell, i) => cell !== pixel[i]);
  if (cells.length !== pixel.length) bad("the terminal's rows", `${cells.length} rows, the pixel figure's ${pixel.length}`);
  else if (at >= 0)
    bad("the terminal's rows", `row ${at + 1}: ${JSON.stringify(cells[at])} is not ${JSON.stringify(pixel[at])}`);
  else ok("the terminal's rows", `${cells.length} rows, the pixel figure's words; ${cols} columns`);
}

const fence = Math.max(80, layout.width + 2 * PADDING_X);
const text = render(spec, { width: fence }).split("\n");
if (text[0] === spec.title && text.every((line) => cellWidth(line) <= fence))
  ok("the text half", `${text.length} lines, the title first, the widest ${Math.max(...text.map(cellWidth))} cells`);
else bad("the text half", `the first line is ${JSON.stringify(text[0])}`);

console.log(`\n${checks} checks, ${failed} failed`);
if (failed) process.exit(1);
