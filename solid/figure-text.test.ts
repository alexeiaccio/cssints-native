// The text half's checks, read from the text and from the terminal's cells — not from a kind's data. For every spec in
// solid/specs: (a) every line is inside the width, and each bar's length in cells is the terminal host's own count for
// that bar (the same cross-target invariant the pixel figure has, within its half cell); (b) a bar's fraction is the
// eighth block its remainder rounds to, and a remainder that rounds to a whole cell has none; (c) `compact` is ASCII
// (one byte a cell); (d) `--markdown` is the title, the fence, the `►` line and `_source_`; (e) the docs' redraw is
// byte-identical; (f) an invalid spec prints its sentences, exits non-zero, and prints no figure.
//
//   bun solid/figure-text.test.ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { layoutOf, PADDING_X, PADDING_Y, type Bar } from "./src/figure/kinds.ts";
import { parse, type Spec } from "./src/figure/spec.ts";
import { cellWidth, fillBlocks, FOCUS_MARK, markdown, redrawDoc, render } from "./src/figure/text.ts";

const SPECS = [
  "bars",
  "funnel",
  "compare",
  "pipeline",
  "tree",
  "journey-map",
  "palette",
  "contrast",
  "spacing",
  "type-scale",
] as const;
const WIDTH = 80;
/** A text bar may sit half a cell from the terminal's whole cells: the pixel figure's own tolerance. */
const HALF_CELL = 0.5;
let failed = 0;
let checks = 0;
const ok = (what: string, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what: string, why: string) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));
const spec = (name: string): Spec => {
  const parsed = parse(readFileSync(new URL(`./specs/${name}.json`, import.meta.url), "utf8"), {
    dir: new URL("./specs/", import.meta.url).pathname,
  });
  if (!parsed.spec) throw new Error(`solid/specs/${name}.json: ${parsed.problems.join(" ")}`);
  return parsed.spec;
};
const specPath = (name: string) => new URL(`./specs/${name}.json`, import.meta.url).pathname;
const native = new URL("..", import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), "cssints-figure-text-"));

/** The terminal's dump as rows: everything above the colour table, trailing blanks dropped. */
function rowsOfCells(text: string): string[] {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith("# colours"));
  return lines
    .slice(0, at < 0 ? lines.length : at)
    .map((line) => line.replace(/ +$/, ""))
    .filter(Boolean);
}

/**
 * The terminal's frame as cells with the background each was drawn on, from its ANSI dump. The plain `--dump` writes `.`
 * for the track and for the fill alike (both are a background), so the fill's own cells are the run of the fill's colour
 * — the layout's accent — at the track's column: that is the host's cell count the text bar is held to.
 */
function ansiRows(data: string): Map<number, { ch: string; bg: string }[]> {
  const rows = new Map<number, { ch: string; bg: string }[]>();
  const starts = [...data.matchAll(/\x1b\[(\d+);1H/g)].map((m) => ({
    row: Number(m[1]),
    at: m.index,
    from: m.index + m[0].length,
  }));
  starts.forEach((start, i) => {
    const body = data.slice(start.from, starts[i + 1]?.at ?? data.length);
    const cells: { ch: string; bg: string }[] = [];
    let bg = "";
    for (let j = 0; j < body.length; j++) {
      if (body[j] === "\x1b") {
        const sgr = /^\x1b\[([0-9;]*)m/.exec(body.slice(j));
        if (sgr) {
          const parts = sgr[1]!.split(";").map(Number);
          if (parts[0] === 0) bg = "";
          else if (parts[0] === 48 && parts[1] === 2) bg = `${parts[2]},${parts[3]},${parts[4]}`;
          j += sgr[0].length - 1;
          continue;
        }
      }
      cells.push({ ch: body[j]!, bg });
    }
    rows.set(start.row, cells);
  });
  return rows;
}

/** The exact bar length in cells: what the layout rounded to `bar.fill`, before rounding. */
const exactCells = (bar: Bar) => Math.min(bar.track, (bar.track * bar.value) / bar.max);

let worstCells = 0;
let worstWhere = "";

for (const name of SPECS) {
  const s = spec(name);
  const l = layoutOf(s);
  const text = render(s, { width: WIDTH });
  const lines = text.split("\n");

  // (a) the width, in display cells: a wide label is two cells, not two JS characters
  const over = lines.find((line) => cellWidth(line) > WIDTH);
  if (over) bad(`${name}: the width`, `${cellWidth(over)} cells: ${JSON.stringify(over)}`);
  else ok(`${name}: the width`, `${Math.max(...lines.map(cellWidth))} of ${WIDTH} cells at the widest`);

  // (a) the same bars in the terminal's cells: the dump's row holds the track, the ANSI's background run the fill
  if (l.bars.length) {
    const out = join(work, `${name}.txt`);
    const ansi = join(work, `${name}.ansi`);
    // a line may be taller than a cell (a type scale's 40px row is three), so the grid's rows are the layout's heights
    const gridRows = l.lines.reduce((n, line) => n + (line.height ?? 1), 0) + 2;
    const args = ["terminal/solid.ts", "--page", "figure", "--spec", specPath(name), "--cols", "80",
      "--rows", String(gridRows)];
    const run = spawnSync("bun", [...args, "--dump", out, "--ansi", ansi], { cwd: native, encoding: "utf8" });
    const rows = run.status === 0 ? rowsOfCells(readFileSync(out, "utf8")) : [];
    const cells = run.status === 0 ? ansiRows(readFileSync(ansi, "utf8")) : new Map();
    if (rows.length !== l.lines.length || run.status !== 0)
      bad(`${name}: the terminal's rows`, `exit ${run.status}, ${rows.length} rows for ${l.lines.length} lines: ${run.stderr.trim()}`);
    let compared = 0;
    // a line's first cell row: the rows above it, each in its own cells (a type scale's 40px row is three)
    const rowOf = (index: number) =>
      1 + PADDING_Y + l.lines.slice(0, index).reduce((n, line) => n + (line.height ?? 1), 0);
    l.lines.forEach((line, lineIndex) => {
      let x = 0;
      for (const item of line.items) {
        if (item.kind === "bar") {
          const bar = l.bars.find((b) => b.fillId === item.fillId)!;
          const row = rows[lineIndex] ?? "";
          const slice = row.slice(PADDING_X + x, PADDING_X + x + item.cells);
          // the dump draws the track and the fill as dots alike: this says the track is where the layout put it
          const dots = [...slice].filter((ch) => ch === ".").length;
          const frame = cells.get(rowOf(lineIndex)) ?? [];
          const start = PADDING_X + x;
          const fillBg = frame[start]?.bg ?? "";
          let drawn = 0;
          while (drawn < item.cells && frame[start + drawn]?.bg === fillBg) drawn++;
          const textCells = fillBlocks(bar).cells;
          const error = Math.abs(textCells - drawn);
          // a fill of whole cells lands on the grid; a fractional one (a spacing step's half cell, a contrast ratio
          // between two cells) is quantised by the terminal to the cell it covers, so it may be a cell out
          const slack = Math.abs(bar.fill - Math.round(bar.fill)) < 1e-9 ? HALF_CELL : 1;
          if (error > worstCells) (worstCells = error), (worstWhere = `${name} ${bar.label}`);
          if (dots !== item.cells)
            bad(`${name}: ${bar.label}'s track`, `the terminal drew ${dots} of ${item.cells} cells`);
          if (Math.abs(drawn - bar.fill) > slack)
            bad(`${name}: ${bar.label}'s cells`, `the terminal filled ${drawn}, the layout says ${bar.fill} (${slack} allowed)`);
          if (error > slack)
            bad(`${name}: ${bar.label}'s length`, `${textCells.toFixed(3)} text cells against the terminal's ${drawn}: ${error.toFixed(2)} apart (${slack} allowed; ${bar.value}/${bar.max} of ${bar.track})`);
          compared++;
        }
        x += item.cells;
      }
    });
    if (compared === l.bars.length)
      ok(`${name}: ${compared} bar(s) in cells`, `each within a cell of the terminal's count (value/max of the track)`);
    else bad(`${name}: the bars`, `${compared} of ${l.bars.length} bars found in the rows`);
  }
}

// (b) the eighth block is the remainder: 3.5 cells is ███▌, 3.96 has none (its eighth is a whole cell)
const fraction = (bar: Bar): { full: number; eighths: number } => {
  const exact = exactCells(bar);
  const full = Math.floor(exact);
  let eighths = Math.round((exact - full) * 8);
  return eighths === 8 ? { full: full + 1, eighths: 0 } : { full, eighths };
};
let fractions = 0;
let blockWhere = "";
for (const name of SPECS) {
  const s = spec(name);
  const l = layoutOf(s);
  const lines = render(s, { width: WIDTH }).split("\n");
  l.bars.forEach((bar) => {
    const want = fraction(bar);
    const got = fillBlocks(bar);
    if (got.full === want.full && got.eighths === want.eighths) fractions++;
    else
      bad(`${name}: ${bar.label}'s eighth`, `${got.full} cells and ${got.eighths}/8, the remainder says ${want.full} and ${want.eighths}/8 (${exactCells(bar).toFixed(3)} of ${bar.track})`);
    // the drawn characters, where the bar's line is: full blocks, then the block
    const lineIndex = l.lines.findIndex((line) => line.items.some((item) => item.kind === "bar" && item.fillId === bar.fillId));
    const art = "█".repeat(got.full) + (got.eighths ? "▏▎▍▌▋▊▉"[got.eighths - 1]! : "");
    if (!(lines[lineIndex] ?? "").includes(art))
      bad(`${name}: ${bar.label}'s drawing`, `${JSON.stringify(art)} is not in ${JSON.stringify(lines[lineIndex])}`);
    if (!blockWhere && got.eighths) blockWhere = `${name} ${bar.label} ${exactCells(bar).toFixed(3)} → ${art}`;
  });
}
if (fractions) ok("the eighth blocks", `${fractions} bar(s) draw the remainder they have (e.g. ${blockWhere})`);

const synthetic = (value: number, track = 10) =>
  layoutOf({ kind: "barChart", source: "Sample", data: [{ label: "x", value }], options: { width: track, max: 10 } }).bars[0]!;
const half = fillBlocks(synthetic(3.5));
const whole = fillBlocks(synthetic(4));
const nearly = fillBlocks(synthetic(3.96));
if (half.full === 3 && half.eighths === 4)
  ok("3.5 cells of a 10-cell track", `is 3 blocks and ▌ (${half.cells} cells)`);
else bad("3.5 cells", `is ${half.full} and ${half.eighths}/8`);
if (whole.eighths === 0 && nearly.eighths === 0 && nearly.full === 4)
  ok("a whole cell", `4.00 is 4 blocks and no eighth; 3.96 rounds to 4 blocks and no eighth`);
else bad("a whole cell", `4.00 → ${whole.full}+${whole.eighths}/8, 3.96 → ${nearly.full}+${nearly.eighths}/8`);

// (c) compact is ASCII: one byte a cell, no block and no ► left
for (const name of SPECS) {
  const compact = render(spec(name), { width: WIDTH, compact: true });
  const chars = [...compact];
  const offender = chars.find((ch) => ch.charCodeAt(0) > 0x7f);
  const bytes = Buffer.from(compact, "utf8").length;
  if (offender !== undefined)
    bad(`${name}: --compact`, `a non-ASCII ${JSON.stringify(offender)} at cell ${chars.indexOf(offender)}`);
  else if (bytes !== compact.length)
    bad(`${name}: --compact`, `${bytes} bytes for ${compact.length} characters`);
  else ok(`${name}: --compact`, `${bytes} bytes, one a cell, ASCII`);
}
if (render(spec("funnel"), { compact: true }).includes("█"))
  bad("--compact", "a █ survived the ASCII map");
else ok("--compact", "no █ (full '#' and partial '='), no ► ('>')");

// (d) markdown: the heading, the intent, the fence, the ► line, the source
for (const name of SPECS) {
  const s = spec(name);
  const md = markdown(s);
  const missing = [
    s.title ? !md.includes(`## ${s.title}`) : false,
    s.intent ? !md.includes(s.intent) : false,
    !md.includes("```text") || !md.includes("\n```"),
    s.source ? !md.includes(`_${s.source}_`) : false,
  ].filter(Boolean).length;
  if (missing) bad(`${name}: --markdown`, `${missing} part(s) missing: ${JSON.stringify(md.slice(0, 80))}…`);
  else ok(`${name}: --markdown`, `"## ${s.title}", the fence, the source as _…_`);
}
const focused = markdown(spec("funnel"));
if (focused.includes(`${FOCUS_MARK} One in twenty visitors pays.`)) ok("--markdown: the ► line", `"${FOCUS_MARK} One in twenty visitors pays." is in the fence`);
else bad("--markdown: the ► line", "no ► line with the focus's say");

// (g) the two row kinds print as their layout: a tree's boxes, level by level in order, with a connector row between
// them; a journey's feeling word and its notes under the bar. The text half reads items, so neither needed a branch here.
{
  const s = spec("tree");
  const l = layoutOf(s);
  const rows = render(s, { width: WIDTH }).split("\n");
  const wanted = l.lines.map((line) => line.items.flatMap((item) => (item.kind === "box" ? [item.text] : [])));
  const got = rows.map((line) => [...line.matchAll(/\[([^\]]*)\]/g)].map((match) => match[1]!));
  const same = wanted.length === got.length && wanted.every((names, i) => names.join("|") === got[i]!.join("|"));
  const levels = wanted.filter((names) => names.length);
  const connectors = l.lines.filter((line) => line.items.some((item) => item.role === "connector")).length;
  if (same && levels.length >= 3 && connectors >= 3)
    ok(
      "tree: the rows",
      `${l.boxes.length} boxes on ${levels.length} levels (${levels.map((names) => names.join(", ")).join(" / ")}), ` +
        `${connectors} connector rows between them`,
    );
  else bad("tree: the rows", `${got.length} rows, ${levels.length} with boxes, ${connectors} connector rows; same ${same}`);
}
{
  const s = spec("journey-map");
  const l = layoutOf(s);
  const text = render(s, { width: WIDTH });
  const words = l.bars.filter((bar) => text.includes(bar.text));
  const notes = s.data.filter(
    (stage) => (!stage.doing || text.includes(stage.doing)) && (!stage.thinking || text.includes(stage.thinking)),
  );
  if (words.length === l.bars.length && notes.length === s.data.length)
    ok(
      "journeyMap: the stages",
      `${words.length} feelings (${l.bars.map((bar) => bar.text).join(", ")}) and ${notes.length} stages' doing and thinking`,
    );
  else bad("journeyMap: the stages", `${words.length} of ${l.bars.length} feelings, ${notes.length} of ${s.data.length} notes`);
}

// (h) the palette's two new items: the text draws a swatch as glyph-kit's `██` in its two cells and the mark as `▲`,
// and the terminal's cells are the step's own colour for those two cells and a filled cell at the mark — the same
// agreement the bars have, a swatch at a time.
{
  const s = spec("palette");
  const l = layoutOf(s);
  const lines = render(s, { width: WIDTH }).split("\n");
  const ansi = join(work, "palette-swatch.ansi");
  const gridRows = l.lines.reduce((n, line) => n + (line.height ?? 1), 0) + 2;
  const run = spawnSync(
    "bun",
    ["terminal/solid.ts", "--page", "figure", "--spec", specPath("palette"), "--cols", "80", "--rows", String(gridRows), "--ansi", ansi],
    { cwd: native, encoding: "utf8" },
  );
  const cells = run.status === 0 ? ansiRows(readFileSync(ansi, "utf8")) : new Map();
  const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(",");
  let swatches = 0;
  let marks = 0;
  l.lines.forEach((line, lineIndex) => {
    let x = 0;
    for (const item of line.items) {
      const slice = (lines[lineIndex] ?? "").slice(x, x + item.cells);
      if (item.kind === "swatch") {
        const frame = cells.get(1 + PADDING_Y + lineIndex) ?? [];
        const fg = frame[PADDING_X + x]?.bg ?? "";
        const neighbour = frame[PADDING_X + x + 1]?.bg ?? "";
        if (slice !== "██" || fg !== rgb(item.value) || neighbour !== rgb(item.value))
          bad("palette: a swatch", `${JSON.stringify(slice)} and ${fg}/${neighbour} in the cells for ${item.value}`);
        swatches++;
      }
      if (item.kind === "marker") {
        const frame = cells.get(1 + PADDING_Y + lineIndex) ?? [];
        if (slice !== "▲ " || !frame[PADDING_X + x]?.bg)
          bad("palette: the mark", `${JSON.stringify(slice)} and bg ${JSON.stringify(frame[PADDING_X + x]?.bg)}`);
        marks++;
      }
      x += item.cells;
    }
  });
  if (swatches === l.swatches.length && marks)
    ok("palette: the swatches and the mark", `${swatches} swatches print ██ and are their colours' cells, ${marks} mark(s) print ▲ and a fill`);
  else bad("palette: the swatches and the mark", `${swatches} of ${l.swatches.length} swatches, ${marks} marks`);
}

// (e) the docs draw themselves: the redraw of native/README.md is byte-identical
const doc = new URL("../README.md", import.meta.url).pathname;
const docText = readFileSync(doc, "utf8");
const redrawn = redrawDoc(docText, doc);
if (redrawn === docText) ok("native/README.md", "the figures are the renderer's, byte for byte");
else {
  const a = docText.split("\n");
  const b = redrawn.split("\n");
  const at = a.findIndex((line, i) => line !== b[i]);
  bad("native/README.md", `line ${at + 1} is ${JSON.stringify(a[at])}, the spec draws ${JSON.stringify(b[at])}`);
}

// (f) an invalid spec: the sentences, exit 1, and no figure on stdout
const cli = (...args: string[]) => spawnSync("bun", [args[0]!, ...args.slice(1)], { cwd: native, encoding: "utf8" });
const invalid = cli("solid/figure.ts", specPath("invalid-funnel"));
if (invalid.status === 1 && invalid.stdout === "" && invalid.stderr.includes("a funnel never grows"))
  ok("an invalid spec", `exit 1, no figure, "${invalid.stderr.trim()}"`);
else bad("an invalid spec", `exit ${invalid.status}, stdout ${JSON.stringify(invalid.stdout)}, stderr ${JSON.stringify(invalid.stderr)}`);
const invalidHost = cli("terminal/solid.ts", "--page", "figure", "--spec", specPath("invalid-funnel"), "--text");
if (invalidHost.status === 1 && invalidHost.stdout === "" && invalidHost.stderr.includes("a funnel never grows"))
  ok("an invalid spec on the terminal host", "exit 1, no figure, the same sentence");
else bad("an invalid spec on the terminal host", `exit ${invalidHost.status}, stdout ${JSON.stringify(invalidHost.stdout)}, stderr ${JSON.stringify(invalidHost.stderr)}`);

// (a) the width is honoured when it is narrow: the pipeline is 72 cells, cut with …
const narrow = render(spec("pipeline"), { width: 40 }).split("\n");
const longest = Math.max(...narrow.map(cellWidth));
if (longest <= 40 && narrow.some((line) => line.endsWith("…")))
  ok("--width 40", `the widest line is ${longest} cells and the cut says …`);
else bad("--width 40", `widest ${longest}: ${JSON.stringify(narrow)}`);

// the cost: each spec's bytes and the ms to render one (a build/CLI path; nothing runs this per frame)
for (const name of SPECS) {
  const s = spec(name);
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) render(s, { width: WIDTH });
  const ms = (performance.now() - t0) / 200;
  console.log(`the text half: ${Buffer.byteLength(render(s, { width: WIDTH }), "utf8")} bytes for ${name}.json, ${ms.toFixed(3)} ms a render (200 runs)`);
}
ok("the worst bar", `${worstCells.toFixed(2)} of a cell from the terminal (${worstWhere})`);

if (failed) {
  console.error(`solid/figure-text.test.ts: ${failed} failure(s) of ${checks} checks`);
  process.exit(1);
}
console.log(`solid/figure-text.test.ts: ${SPECS.length} specs, ${checks} checks, the terminal's cells among them`);
