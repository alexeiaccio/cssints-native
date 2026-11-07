// The console page in a browser, checked against the terminal's own frames: browser/solid/console.ts runs the Sensors
// page at 80x20 cells and prints the terminal's cells with console.log instead of drawing them.
//
//   node browser/console-check.mjs            the check (build first: sh browser/build.sh && bun browser/solid/build.ts)
//   node browser/console-check.mjs --serve    serve the page and print its URL
//
// What it holds:
//   (a) the page's frame is the terminal's frame, cell for cell — glyph and both truecolours — at rest, after Tab (the
//       pill's ring) and after a press on the pill (the terminal's --click at the same cell);
//   (b) the console's rule: a page at rest writes nothing (no console line for twenty frames), a changed frame writes one;
//   (c) the canvas stays dark: the display is the console, not the grid drawn on a canvas;
//   (d) the numbers: the bundle's bytes, a frame's ms and the sink's bytes a frame;
//   (e) the vitals: `v` prints @cssints/devtools/vitals' group (and `?vitals` once after the first frames) — a canvas page
//       has no elements and no stylesheet of the app's, so the console is its only devtools.
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { consoleCells, rowDiff } from "../terminal/sink.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WASM_DIR = process.env.WASM_DIR || join(process.env.TMPDIR || "/tmp", "cssints-native-web");
const BUNDLE = join(WASM_DIR, "solid/console.js");
const CELL_W = 8;
const CELL_H = 16;
const COLS = 80;
const ROWS = 20;
const work = mkdtempSync(join(tmpdir(), "cssints-console-page-"));

let failures = 0;
let comparisons = 0;
const ok = (name, extra = "") => (
  comparisons++, console.log(`ok   ${name}${extra ? " — " + extra : ""}`)
);
const bad = (name, why) => (comparisons++, failures++, console.log(`FAIL ${name}: ${why}`));

/** The terminal's frame for one input, as the sink's JSON and the text dump of it. */
function terminal(name, args) {
  const json = join(work, `${name}.json`);
  const dump = join(work, `${name}.txt`);
  const run = spawnSync(
    "bun",
    [
      "terminal/solid.ts",
      "--page",
      "sensors",
      "--cols",
      String(COLS),
      "--rows",
      String(ROWS),
      "--console",
      json,
      "--dump",
      dump,
      ...args,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`terminal/solid.ts ${args.join(" ")}: ${run.stderr}`);
  return {
    cells: consoleCells(readFileSync(json, "utf8")),
    rows: readFileSync(dump, "utf8").split("\n"),
  };
}

/** Two frames of cells: the same rows, each cell's glyph and both colours. */
function sameFrame(a, b) {
  if (a.rows.length !== b.rows.length)
    return `the terminal's ${a.rows.length} rows, the page's ${b.rows.length}`;
  for (let y = 0; y < a.rows.length; y++) {
    const at = rowDiff(a.rows[y], b.rows[y]);
    if (at >= 0)
      return `row ${y + 1} cell ${at}: ${JSON.stringify(b.rows[y][at])} is not the terminal's ${JSON.stringify(a.rows[y][at])}`;
  }
  return undefined;
}

const base = terminal("base", []);
// the pill's cell, from the terminal's own text dump: the "switch to g" row, a cell or two into its label (the box is
// 25 cells wide and the word is centred, so the label's own start is inside it)
const PILL = "switch to g";
const row = base.rows.findIndex((line) => line.includes(PILL));
const col = row < 0 ? -1 : base.rows[row].indexOf(PILL);
if (row < 0 || col < 0) {
  console.log(`FAIL the pill: the terminal's frame has no "${PILL}" row`);
  process.exit(1);
}
const click = [col + 2, row];
const tab = terminal("tab", ["--keys", "Tab"]);
const pressed = terminal("pressed", ["--click", click.join(",")]);
ok(
  "the terminal's three frames",
  `at rest, after Tab and after a press at cell ${click.join(",")} (the pill)`,
);

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".png": "image/png",
};

function serve() {
  return new Promise((done) => {
    const server = createServer(async (req, res) => {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file =
        path === "/browser/solid/ui.wasm"
          ? join(WASM_DIR, "ui.wasm")
          : path === "/browser/solid/console.js"
            ? BUNDLE
            : join(ROOT, path);
      try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": MIME[extname(file)] || "text/plain" }).end(body);
      } catch {
        res.writeHead(404).end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => done({ server, port: server.address().port }));
  });
}

if (!existsSync(BUNDLE)) {
  console.log(`FAIL the bundle: ${BUNDLE} is not built (bun browser/solid/build.ts)`);
  process.exit(1);
}

const { server, port } = await serve();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const messages = [];
  page.on("console", (message) => messages.push(message));
  await page.goto(`http://127.0.0.1:${port}/browser/solid/console.html`);
  await page.waitForFunction(() => window.__page, null, { timeout: 20000 });
  // the cell measure is installed when the page module runs: one frame after the mount, the frames are the terminal's
  await page.evaluate(() => window.__page.warm(1));

  const cells = async () => consoleCells(await page.evaluate(() => window.__page.cells()));

  // (a) the three frames, cell for cell
  for (const [name, want] of [
    ["at rest", base.cells],
    ["after Tab", tab.cells],
  ]) {
    const got = await cells();
    const diff = sameFrame(want, got);
    if (!diff)
      ok(`the page ${name}`, `${got.rows.length} rows of ${COLS} cells, the terminal's frame`);
    else bad(`the page ${name}`, diff);
    if (name === "at rest") {
      await page.keyboard.press("Tab");
      await page.evaluate(() => window.__page.warm(1));
    }
  }
  // ... and the press: the terminal at the same cell, the page at that cell's centre in CSS pixels
  const box = await page.locator("#frame").boundingBox();
  await page.mouse.click(
    box.x + click[0] * CELL_W + CELL_W / 2,
    box.y + click[1] * CELL_H + CELL_H / 2,
  );
  await page.evaluate(() => window.__page.warm(1));
  const afterPress = await cells();
  const pressDiff = sameFrame(pressed.cells, afterPress);
  if (!pressDiff)
    ok("the page after a press on the pill", `the terminal's frame at --click ${click.join(",")}`);
  else bad("the page after a press on the pill", pressDiff);

  // ... and the page's Space, which is the terminal's host pressing the pill: the pointer leaves first (the terminal's
  // base frame has no hover), so two presses are the base frame again
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.__page.warm(1));
  await page.keyboard.press("Space");
  await page.evaluate(() => window.__page.warm(1));
  const afterSpace = await cells();
  const spaceDiff = sameFrame(base.cells, afterSpace);
  if (!spaceDiff)
    ok(
      "the page after Space",
      "the pill pressed again: the terminal's base frame (the switch back)",
    );
  else bad("the page after Space", spaceDiff);

  // (b) the console's rule: at rest no line at all, and a press wrote one
  const before = messages.length;
  await page.evaluate(() => window.__page.warm(20));
  const idle = messages.length - before;
  if (idle === 0)
    ok(
      "the idle rule",
      `twenty frames at rest wrote no console line (${before} so far, ${messages.length})`,
    );
  else bad("the idle rule", `${idle} line(s) at rest`);
  const wrote = messages.filter((message) => message.args().length > 1).length;
  if (wrote >= 1)
    ok("the changed frames", `${wrote} line(s) with %c styles: the base frame and the press`);
  else bad("the changed frames", "no styled console line");

  // (c) the canvas is the shell's, and dark
  const alpha = await page.evaluate(() => {
    const canvas = document.getElementById("frame");
    const data = canvas.getContext("2d").getImageData(0, 0, 1, 1).data;
    return [data[3], canvas.width, canvas.height];
  });
  if (alpha[0] === 0)
    ok(
      "the canvas",
      `dark (alpha ${alpha[0]}), the display is the console; ${alpha[1]}x${alpha[2]} px`,
    );
  else bad("the canvas", `painted: alpha ${alpha[0]}`);

  // (e) the vitals: a canvas page has no elements to inspect and no stylesheets, so the console is its devtools
  const beforeVitals = messages.length;
  await page.keyboard.press("v");
  await new Promise((done) => setTimeout(done, 250));
  const group = messages
    .slice(beforeVitals)
    .map((message) => message.text())
    .join("\n");
  const hasAll = (text, needles) => needles.every((needle) => text.includes(needle));
  // the sheet the report finds is the page's own chrome (console.html's <style>), never the app's: the page draws to a canvas
  if (hasAll(group, ["cssints vitals", "vitals   FCP", "CSS      ", "specificity 0,", "coverage "]))
    ok(
      "the page's vitals on `v`",
      "one group: vitals and the sheet's numbers, on a page with no DOM of its own",
    );
  else bad("the page's vitals on `v`", group.slice(0, 400) || "no console line");
  if ((await page.evaluate(() => typeof window.vitals)) === "function")
    ok("the console's way in", "window.vitals, as on any page");
  else bad("the console's way in", "window.vitals is not a function");

  // ... and `?vitals` prints the same group once, without a key
  const auto = await browser.newPage();
  const autoMessages = [];
  auto.on("console", (message) => autoMessages.push(message));
  await auto.goto(`http://127.0.0.1:${port}/browser/solid/console.html?vitals`);
  await auto.waitForFunction(() => window.__page, null, { timeout: 20000 });
  await new Promise((done) => setTimeout(done, 1200));
  const autoText = autoMessages.map((message) => message.text()).join("\n");
  if (autoText.includes("cssints vitals"))
    ok("`?vitals`", "the group printed once after the first frames");
  else bad("`?vitals`", autoText.slice(0, 300) || "no console line");
  await auto.close();

  // (d) the numbers
  const ms = await page.evaluate(() => window.__page.bench(30));
  const frame = await page.evaluate(() => window.__page.cells());
  ok(
    "the numbers",
    `${statSync(BUNDLE).size} B the console.js bundle; ${ms.toFixed(2)} ms a frame; ${frame.length} B the sink's JSON a ` +
      `full frame (one console call, ${messages.length} line(s) in the run)`,
  );
  if (messages.some((message) => message.type() === "error"))
    bad("page errors", "an error in the console");
  else ok("no page errors", `${messages.length} console line(s)`);
} finally {
  await browser.close();
  server.close();
}

console.log(`\nbrowser/console-check.mjs: ${comparisons} comparisons, ${failures} failed`);
process.exit(failures ? 1 : 0);
