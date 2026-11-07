// The console sink, read back: the terminal's cells as a browser console.log call.
//
//   (a) the JSON is a call's arguments: a format with one %c a run and a style a run ("color:#rrggbb;background:#rrggbb");
//   (b) the format parses back to the frame's cells, glyph for glyph, and every cell's two colours are the ANSI dump's
//       SGR values (the truecolour the terminal path already prints);
//   (c) the text dump agrees: the same rows, with the dump's '.' (a fill with no glyph) read as the blank the console has;
//   (d) the diff: a frame at rest writes [] and nothing else; a key's frame writes exactly the rows it changed, whole
//       (a console line starts at column 1), each row's cells the new frame's;
//   (e) the mutation: the same run with the sink taking the new frame as the old one (`--mutate console`) makes the idle
//       frames write full ones, and the idle check fails with its count.
//
//   node terminal/console.mjs          (needs bun for the host)
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ansiRows, consoleCells, rowDiff, sameCell } from "./sink.mjs";

const NATIVE = new URL("..", import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), "cssints-console-"));
const COLS = 80;
const ROWS = 20;

let failed = 0;
let checks = 0;
const ok = (what, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what, why) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));

/** The host once, its outputs in `dir`: `--console` full, or `--console-frames` over a run. The host's cwd stays
 *  native/ (its imports); every output is an absolute path in the temp directory. */
function run(args, dir = work) {
  execFileSync("bun", ["terminal/solid.ts", "--page", "sensors", "--cols", String(COLS), "--rows", String(ROWS), ...args], {
    cwd: NATIVE,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return dir;
}

/** The cells two rows of the same frame should be: the glyph and both colours. */


// (a)-(c) the whole frame: the sink against the ANSI dump and the text dump of the same frame
run(["--console", join(work, "full.json"), "--dump", join(work, "full.txt"), "--ansi", join(work, "full.ansi")]);
const json = readFileSync(join(work, "full.json"), "utf8");
const ansi = ansiRows(readFileSync(join(work, "full.ansi"), "utf8"));
const dump = readFileSync(join(work, "full.txt"), "utf8").split("\n").slice(0, ROWS);
const cons = consoleCells(json);
if (cons.rows.length === ROWS) ok("the frame's rows", `${ROWS} rows of ${COLS} cells, from one console.log call`);
else bad("the frame's rows", `${cons.rows.length} rows, the frame's ${ROWS}`);
if (ansi.length === ROWS) ok("the ANSI frame", `${ROWS} rows, the same frame's SGR dump`);
else bad("the ANSI frame", `${ansi.length} rows, the frame's ${ROWS}`);

let cellsBad = 0;
let worst = "";
let runs = 0;
for (let y = 0; y < Math.min(cons.rows.length, ansi.length); y++) {
  const row = cons.rows[y];
  runs += row.filter((cell, x) => x === 0 || !sameCell(cell, row[x - 1])).length;
  if (row.length !== COLS) {
    cellsBad++;
    if (!worst) worst = `row ${y + 1} has ${row.length} cells, the grid's ${COLS}`;
    continue;
  }
  const at = rowDiff(row, ansi[y]);
  if (at >= 0) {
    cellsBad++;
    if (!worst)
      worst = `row ${y + 1} cell ${at}: ${JSON.stringify(row[at])} is not the ANSI frame's ${JSON.stringify(ansi[y][at])}`;
  }
}
if (!cellsBad)
  ok(
    "the cells under the spans",
    `${ROWS * COLS} cells, glyph and both truecolours equal to the ANSI dump's SGR runs (${runs} runs a frame)`,
  );
else bad("the cells under the spans", `${cellsBad} row(s): ${worst}`);

// the text dump: a cell for a cell. Its '.' is a fill with no glyph *or* a full stop, so a '.' on either side is not a
// comparison (the ANSI pass above is the exact one, colours and all); everything else must be the same glyph.
let dumpBad = 0;
let ambiguous = 0;
for (let y = 0; y < Math.min(cons.rows.length, dump.length); y++) {
  const row = cons.rows[y].map((cell) => cell.ch);
  const want = [...dump[y]];
  for (let x = 0; x < Math.max(row.length, want.length); x++) {
    const cell = row[x] ?? " ";
    const glyph = want[x] ?? " ";
    if (cell === "." || glyph === ".") {
      ambiguous++;
      continue;
    }
    if (cell !== glyph) {
      dumpBad++;
      if (dumpBad === 1) bad(`dump row ${y + 1} cell ${x}`, `${JSON.stringify(cell)} is not the dump's ${JSON.stringify(glyph)}`);
      break;
    }
  }
}
if (!dumpBad)
  ok(
    "the text dump",
    `${ROWS} rows, the same glyphs a cell for a cell; ${ambiguous} cell(s) a '.' on either side not compared (a fill vs a ` +
      `full stop — the ANSI pass above is the exact one)`,
  );
else bad("the text dump", `${dumpBad} of ${ROWS} rows differ`);

// (d) the diff: a key's frame, then thirty at rest
run(["--keys", "Tab", "--settle", "30", "--console-frames", join(work, "frames.jsonl"), "--frames-out", join(work, "fr")]);
const lines = readFileSync(join(work, "frames.jsonl"), "utf8").split("\n").filter((line) => line.length);
const base = ansiRows(readFileSync(join(work, "fr.0.ansi"), "utf8"));
const keyed = ansiRows(readFileSync(join(work, "fr.1.ansi"), "utf8"));
const changed = [];
for (let y = 0; y < ROWS; y++) if (rowDiff(base[y], keyed[y]) >= 0) changed.push(y);
if (lines.length === 2 + 30) ok("the run's frames", `a base frame, the key's, and ${30} at rest`);
else bad("the run's frames", `${lines.length} lines, the run's ${2 + 30}`);
const first = consoleCells(lines[0]);
const firstBad = first.rows.findIndex((row, y) => rowDiff(row, base[y]) >= 0);
if (firstBad < 0) ok("the base frame", `${first.rows.length} rows, the ANSI frame's cells; the diff's first frame is whole`);
else bad("the base frame", `row ${firstBad + 1} is not the frame's`);
const after = consoleCells(lines[1] ?? "[]");
if (after.rows.length === changed.length && after.rows.every((row, k) => rowDiff(row, keyed[changed[k]]) < 0))
  ok(
    "the key's frame",
    `${changed.length} row(s) written (${changed.map((y) => y + 1).join(", ")}), each the new frame's, whole`,
  );
else
  bad(
    "the key's frame",
    `${after.rows.length} rows written for the ${changed.length} the key changed (${changed.map((y) => y + 1).join(", ")})`,
  );
const idle = lines.slice(2);
const wrote = idle.filter((line) => line !== "[]");
if (!wrote.length)
  ok("the idle frames", `${idle.length} at rest wrote "[]": ${idle.length * 3} bytes, no console line, no scroll`);
else bad("the idle frames", `${wrote.length} of ${idle.length} wrote cells, the first ${JSON.stringify(wrote[0]).slice(0, 80)}`);

// (e) the mutation: a sink that never diffs (whole frames appended, the run's first column above)
mkdirSync(join(work, "mut"), { recursive: true });
run(["--keys", "Tab", "--settle", "3", "--mutate", "console", "--console-frames", join(work, "mut", "mut.jsonl")], join(work, "mut"));
const mutLines = readFileSync(join(work, "mut", "mut.jsonl"), "utf8").split("\n").filter((line) => line.length);
const mutWrote = mutLines.slice(2).filter((line) => line !== "[]");
if (mutWrote.length)
  ok(
    "mutation: a sink with no diff",
    `${mutWrote.length} idle frame(s) wrote ${consoleCells(mutWrote[0]).rows.length} rows: the idle check's count would fail`,
  );
else bad("mutation: a sink with no diff", "the idle frames still wrote nothing");

// the numbers: the full frame's bytes (Sensors, and the busier Sky page), and the sink's own cost against the ANSI
// dump's (both include the file write)
const bench = execFileSync(
  "bun",
  ["terminal/solid.ts", "--page", "sensors", "--cols", String(COLS), "--rows", String(ROWS), "--bench", "100", "--console", join(work, "bench.json")],
  { cwd: NATIVE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const frameMs = /(\d+\.\d+) ms a frame \(([^)]*)\)/.exec(bench)?.[1];
const ansiMs = /as ANSI: (\d+\.\d+) ms .*?(\d+) bytes/.exec(bench);
const consoleMs = /as a console\.log call: (\d+\.\d+) ms .*?(\d+) bytes/.exec(bench);
if (ansiMs && consoleMs)
  ok(
    "the numbers",
    `${consoleMs[2]} B a console call against ${ansiMs[2]} B of ANSI (${(Number(consoleMs[2]) / Number(ansiMs[2])).toFixed(2)}x); ` +
      `${consoleMs[1]} ms against ${ansiMs[1]} ms a frame (cells -> runs, file write included); the frame ${frameMs} ms`,
  );
else bad("the numbers", `no bench line: ${JSON.stringify(bench.slice(0, 200))}`);
const skyJson = join(work, "sky.json");
execFileSync(
  "bun",
  ["terminal/solid.ts", "--page", "sky", "--cols", String(COLS), "--rows", String(ROWS), "--warm", "60", "--console", skyJson],
  { cwd: NATIVE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const skyText = readFileSync(skyJson, "utf8");
const sky = consoleCells(skyText);
const percents = sky.rows.flat().filter((cell) => cell.ch === "%").length;
// every "%" in the format is a directive ("%c") or a doubled literal; the walk is the console's own
const format = JSON.parse(skyText)[0];
let directives = true;
for (let i = 0; i < format.length; i++) {
  if (format[i] !== "%") continue;
  if (format[i + 1] === "%" || format[i + 1] === "c") i++;
  else directives = false;
}
if (percents && skyText.includes("%%") && directives)
  ok(
    "a literal percent",
    `${percents} cell(s): "%%" in the format (console.log would read a single "%" as a directive) and the parser's undo ` +
      `is a "%" again`,
  );
else bad("a literal percent", `${percents} cells, "%%" in the format: ${skyText.includes("%%")}`);
ok("the busy page", `Sky: ${skyText.length} B a console call, ${sky.runs} runs, ${sky.rows.length} rows`);

console.log(`\nterminal/console.mjs: ${checks} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
