// The export half's checks: the same layout as an SVG and as an HTML page, and no host under either.
//
// For every spec in solid/specs (the invalid ones are (d)'s):
//   (a) the SVG is well-formed XML by a hand-check (Bun ships no DOMParser; a tag-stack and an entity scan are enough
//       for the subset this file writes) and its <text> elements are the layout's texts, in order, once each;
//   (b) every rect's x/width is the layout's own number — cells * 8 for a box or a track, fill * 8 for a bar's fill —
//       with no rounding; the worst error over the twelve kinds is printed;
//   (c) the HTML contains the SVG verbatim, exactly once, has no <script>, and its bytes are the file the CLI wrote;
//   (d) an invalid spec prints its sentences, exits non-zero and writes no file;
//   (e) Chromium renders the exported page's boxes at the SVG's numbers, within 1 px (skipped when Playwright's Chromium
//       is not installed, with the same message solid/test.sh uses);
//   (f) two runs of the CLI are byte-identical (`cmp`).
//
//   bun solid/figure-export.test.ts
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";

import {
  CELL_HEIGHT,
  CELL_WIDTH,
  PADDING_X,
  layoutOf,
  sizeOf,
  type Layout,
} from "./src/figure/kinds.ts";
import { html } from "./src/figure/export/html.ts";
import { svg } from "./src/figure/export/svg.ts";
import { parse, type Spec } from "./src/figure/spec.ts";

const NATIVE = new URL("..", import.meta.url).pathname;
const CLI = join(NATIVE, "solid/figure.ts");
const SPECS = readdirSync(new URL("./specs/", import.meta.url))
  .filter((name) => name.endsWith(".json") && !name.startsWith("invalid-"))
  .sort();
const work = mkdtempSync(join(tmpdir(), "cssints-figure-export-"));
const TOLERANCE = 1;

let failed = 0;
let checks = 0;
const ok = (what: string, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what: string, why: string) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));

const spec = (name: string): Spec => {
  const parsed = parse(readFileSync(new URL(`./specs/${name}`, import.meta.url), "utf8"), {
    dir: new URL("./specs/", import.meta.url).pathname,
  });
  if (!parsed.spec) throw new Error(`solid/specs/${name}: ${parsed.problems.join(" ")}`);
  return parsed.spec;
};

const decode = (text: string): string =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/**
 * A hand XML check (Bun has no DOMParser): every `&` is an entity, every tag is closed in order, there is one root, and
 * a `<text>` is parsed. A raw `&` in a label is the message this is here for: `an unescaped & at 123: "& Ward"`.
 */
function xmlProblems(xml: string): string[] {
  const out: string[] = [];
  const amp = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.exec(xml);
  if (amp) out.push(`an unescaped & at ${amp.index}: ${JSON.stringify(xml.slice(amp.index, amp.index + 24))}`);
  const stack: string[] = [];
  let roots = 0;
  for (const match of xml.matchAll(/<[^>]*>/g)) {
    const tag = match[0];
    if (tag.startsWith("</")) {
      const name = tag.slice(2, -1).trim();
      const top = stack.pop();
      if (top !== name) out.push(`</${name}> closes ${top ?? "nothing"}`);
    } else if (tag.endsWith("/>")) {
      if (stack.length === 0) roots++;
    } else {
      const name = /^<([^\s/>]+)/.exec(tag)?.[1];
      if (!name) {
        out.push(`a tag with no name: ${tag}`);
        continue;
      }
      if (stack.length === 0) roots++;
      stack.push(name);
    }
  }
  if (stack.length) out.push(`unclosed ${stack.join(", ")}`);
  if (roots !== 1) out.push(`${roots} root elements, not one`);
  if (/<script\b/i.test(xml)) out.push("a script in a standalone SVG");
  return out;
}

const textsOf = (xml: string): string[] =>
  [...xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((match) => decode(match[1] ?? ""));
const layoutTexts = (l: Layout): string[] =>
  l.lines.flatMap((line) =>
    line.items.flatMap((item) => (item.kind === "text" || item.kind === "box" ? [item.text] : [])),
  );

interface Expected {
  x: number;
  width: number;
  what: string;
}

/** The rects the layout asks for, by id: a box's cells, a bar's track and fill. */
function expectedRects(l: Layout): Map<string, Expected> {
  const bars = new Map(l.bars.map((bar) => [bar.fillId, bar]));
  const out = new Map<string, Expected>();
  for (const line of l.lines) {
    let cells = PADDING_X;
    for (const item of line.items) {
      const x = cells * CELL_WIDTH;
      if (item.kind === "box") out.set(item.id, { x, width: item.cells * CELL_WIDTH, what: "a box" });
      if (item.kind === "bar") {
        const fill = bars.get(item.fillId)?.fill ?? item.fill;
        out.set(item.id, { x, width: item.cells * CELL_WIDTH, what: "a track" });
        out.set(item.fillId, { x, width: fill * CELL_WIDTH, what: "a fill" });
      }
      cells += item.cells;
    }
  }
  return out;
}

/** (b) the exported rects against the layout, and the worst error in pixels. */
function rectProblems(l: Layout, xml: string): { problems: string[]; worst: number } {
  const problems: string[] = [];
  const wanted = expectedRects(l);
  const found = new Map<string, string>();
  let worst = 0;
  for (const match of xml.matchAll(/<rect\b([^>]*)\/?>/g)) {
    const tag = match[1] ?? "";
    const id = attr(tag, "id");
    if (!id || !wanted.has(id)) continue;
    found.set(id, tag);
    const want = wanted.get(id)!;
    const x = Number(attr(tag, "x"));
    const width = Number(attr(tag, "width"));
    const dx = Math.abs(x - want.x);
    const dw = Math.abs(width - want.width);
    worst = Math.max(worst, dx, dw);
    if (dx > 0.000001 || dw > 0.000001)
      problems.push(
        `${id} (${want.what}) is x ${x}, width ${width}; the layout says x ${want.x}, width ${want.width} ` +
          `(${dx}px, ${dw}px off)`,
      );
  }
  for (const id of wanted.keys()) if (!found.has(id)) problems.push(`no rect for ${id}`);
  return { problems, worst };
}

/** (c) the HTML's own invariants: one figure, no script. */
function htmlProblems(spec: Spec): string[] {
  const page = html(spec);
  const figure = svg(spec);
  const out: string[] = [];
  const copies = page.split(figure).length - 1;
  if (copies !== 1) out.push(`the SVG appears ${copies} times, not once`);
  const figures = page.match(/<svg\b/g)?.length ?? 0;
  if (figures !== 1) out.push(`${figures} <svg> elements, not one figure`);
  if (/<script\b/i.test(page)) out.push("a <script> in a page that is meant to need none");
  if (!page.includes("prefers-color-scheme: light")) out.push("no light palette");
  if (!page.includes("@media print")) out.push("no print stylesheet");
  return out;
}

/** (f) `cmp` of two runs, as the suite does for every generated file. */
function deterministic(args: string[], first: string, second: string): string | undefined {
  for (const file of [first, second]) {
    const run = spawnSync(process.execPath, [CLI, ...args, file], { cwd: NATIVE, encoding: "utf8" });
    if (run.status !== 0) return `exit ${run.status}: ${run.stderr}`;
  }
  const cmp = spawnSync("cmp", ["-s", first, second], { encoding: "utf8" });
  return cmp.status === 0 ? undefined : `cmp says the two runs differ: ${cmp.stderr}`;
}

// (a) and (b): every spec.
let worstRect = 0;
for (const name of SPECS) {
  const s = spec(name);
  const xml = svg(s);
  const xmlBad = xmlProblems(xml);
  if (xmlBad.length) bad(`${name}: well-formed XML`, xmlBad.join("; "));
  else ok(`${name}: well-formed XML`, `${xml.length} B`);

  const want = layoutTexts(layoutOf(s));
  const got = textsOf(xml);
  if (got.length !== want.length) bad(`${name}: texts`, `${got.length} <text> elements, the layout's ${want.length}`);
  else {
    const at = got.findIndex((text, i) => text !== want[i]);
    if (at < 0) ok(`${name}: texts`, `${want.length} in the layout's order`);
    else bad(`${name}: texts`, `#${at} is ${JSON.stringify(got[at])}, the layout's ${JSON.stringify(want[at])}`);
  }

  const { problems, worst } = rectProblems(layoutOf(s), xml);
  worstRect = Math.max(worstRect, worst);
  if (problems.length) bad(`${name}: rects`, problems.slice(0, 3).join("; "));
  else ok(`${name}: rects`, `${expectedRects(layoutOf(s)).size} rects at the layout's x/width, worst ${worst.toFixed(3)} px`);
}

// a label with the five characters that break XML: the parse and the round trip
const escaped: Spec = {
  kind: "flow",
  title: "A & B <C>",
  intent: 'Quotes " and \'',
  source: "&amp;",
  data: ["a & b", "<c>"],
  options: { width: 40 },
};
const escapedXml = svg(escaped);
const escapedBad = xmlProblems(escapedXml);
if (escapedBad.length) bad("escaped labels", escapedBad.join("; "));
else if (textsOf(escapedXml).join("|") !== "A & B <C>|a & b| ► |<c>|&amp;")
  bad("escaped labels", `the texts came back as ${JSON.stringify(textsOf(escapedXml))}`);
else ok("escaped labels", "&, <, > and quotes round-trip, and the file still parses");

// (c): the page, verbatim, and the CLI writing exactly those bytes.
const pageSpec = spec("palette.json");
const pageProblems = htmlProblems(pageSpec);
if (pageProblems.length) bad("palette.html", pageProblems.join("; "));
else ok("palette.html", `${svg(pageSpec).length} B of inline SVG, once; no script; light, print and forced-colors rules`);
const pagePath = join(work, "palette.html");
const pageRun = spawnSync(process.execPath, [CLI, "solid/specs/palette.json", "--html", pagePath], {
  cwd: NATIVE,
  encoding: "utf8",
});
if (pageRun.status !== 0) bad("the CLI's HTML", `exit ${pageRun.status}: ${pageRun.stderr}`);
else if (readFileSync(pagePath, "utf8") !== html(pageSpec)) bad("the CLI's HTML", "the file is not html(spec)");
else ok("the CLI's HTML", `${statSync(pagePath).size} B on disk, byte for byte`);

const svgPath = join(work, "pipeline.svg");
const svgRun = spawnSync(process.execPath, [CLI, "solid/specs/pipeline.json", "--svg", svgPath], {
  cwd: NATIVE,
  encoding: "utf8",
});
if (svgRun.status !== 0) bad("the CLI's SVG", `exit ${svgRun.status}: ${svgRun.stderr}`);
else if (readFileSync(svgPath, "utf8") !== svg(spec("pipeline.json"))) bad("the CLI's SVG", "the file is not svg(spec)");
else ok("the CLI's SVG", `${statSync(svgPath).size} B on disk, byte for byte`);

// (d): an invalid spec writes nothing at all.
for (const mode of ["--svg", "--html"] as const) {
  const target = join(work, `invalid${mode}.out`);
  const run = spawnSync(process.execPath, [CLI, "solid/specs/invalid-funnel.json", mode, target], {
    cwd: NATIVE,
    encoding: "utf8",
  });
  if (run.status === 0) bad(`invalid spec ${mode}`, "the CLI exited 0");
  else if (!/a funnel never grows/.test(run.stderr)) bad(`invalid spec ${mode}`, `stderr has no sentence: ${run.stderr}`);
  else if (existsSync(target)) bad(`invalid spec ${mode}`, `it wrote ${target}`);
  else ok(`invalid spec ${mode}`, "its sentence, exit non-zero, no file");
}

// (f): two runs, `cmp`.
for (const [name, flag] of [
  ["palette.html", "--html"],
  ["pipeline.svg", "--svg"],
] as const) {
  const first = join(work, `one-${name}`);
  const second = join(work, `two-${name}`);
  const problem = deterministic(["solid/specs/" + name.replace(/\.(html|svg)$/, ".json"), flag], first, second);
  if (problem) bad(`${name} is deterministic`, problem);
  else ok(`${name} is deterministic`, "two runs, cmp");
}

// (e): Chromium against the SVG's numbers.
const bars = spec("bars.json");
const barsPath = join(work, "bars.html");
spawnSync(process.execPath, [CLI, "solid/specs/bars.json", "--html", barsPath], { cwd: NATIVE });
const executable = chromium.executablePath();
if (!existsSync(executable)) {
  console.log("skip the browser: Playwright's chromium is not installed (bunx playwright install chromium)");
} else {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
    await page.setContent(readFileSync(barsPath, "utf8"), { waitUntil: "load" });
    const measured = await page.evaluate(() => {
      const root = document.querySelector("svg");
      if (!root) return { error: "no <svg>" };
      const viewBox = root.viewBox.baseVal;
      const box = root.getBoundingClientRect();
      const scale = box.width / viewBox.width;
      const rows = [...document.querySelectorAll("rect.fig-box, rect.fig-track, rect.fig-fill")].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          id: element.id,
          x: Number(element.getAttribute("x")),
          width: Number(element.getAttribute("width")),
          drawnX: (rect.left - box.left) / scale,
          drawnWidth: rect.width / scale,
        };
      });
      return { scale, rows, svgs: document.querySelectorAll("svg").length };
    });
    if ("error" in measured) bad("the browser", measured.error);
    else if (measured.svgs !== 1) bad("the browser", `${measured.svgs} <svg> elements`);
    else {
      let worst = 0;
      let at = "";
      for (const row of measured.rows) {
        const d = Math.max(Math.abs(row.drawnX - row.x), Math.abs(row.drawnWidth - row.width));
        if (d > worst) (worst = d), (at = row.id);
      }
      if (worst > TOLERANCE) bad("the browser", `${at || "a rect"} is ${worst.toFixed(3)} px off the SVG's numbers, over ${TOLERANCE}`);
      else
        ok(
          "the browser",
          `${measured.rows.length} boxes at the SVG's numbers, worst ${worst.toFixed(3)} px (tolerance ${TOLERANCE}; ` +
            `scale ${measured.scale.toFixed(3)})`,
        );
    }
  } finally {
    await browser.close();
  }
}

// the viewBox itself: cells * 8 across, rows * 16 down, padding included
for (const name of SPECS) {
  const s = spec(name);
  const size = sizeOf(s);
  const xml = svg(s);
  const box = /viewBox="0 0 ([0-9.]+) ([0-9.]+)"/.exec(xml);
  if (!box) bad(`${name}: viewBox`, "no viewBox");
  else if (Number(box[1]) !== size.width || Number(box[2]) !== size.height)
    bad(`${name}: viewBox`, `${box[1]}x${box[2]}, sizeOf says ${size.width}x${size.height}`);
  else
    ok(
      `${name}: viewBox`,
      `${size.width}x${size.height} px = ${size.width / CELL_WIDTH}x${size.height / CELL_HEIGHT} cells`,
    );
}

console.log(`figure-export: ${checks - failed} of ${checks} ok; worst rect error ${worstRect.toFixed(3)} px`);
if (failed) {
  console.error(`${failed} failure(s) of ${checks}`);
  process.exit(1);
}
