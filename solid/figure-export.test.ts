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
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
import { OG, ogCard } from "./src/figure/export/og.ts";
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

// (g): the OG card, 1200x630 — the CLI's card is the **host's** now (`app/FigureCard.tsx`), and the HTML document in
// `export/og.ts` is the reference it is held to: Chromium rasterises the reference, and the host's PNG is compared with it
// band by band (the header, the figure, the caption) once the library is built.
{
  const pngSize = (path: string): [number, number] | undefined => {
    const bytes = readFileSync(path).subarray(0, 33);
    return bytes.subarray(1, 4).toString("latin1") === "PNG" ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : undefined;
  };
  const one = join(work, "og-one.png");
  const two = join(work, "og-two.png");
  const first = spawnSync(process.execPath, [CLI, "solid/specs/table.json", "--og", "-o", one], { cwd: NATIVE });
  const second = spawnSync(process.execPath, [CLI, "solid/specs/table.json", "--og", "-o", two], { cwd: NATIVE });
  const size = existsSync(one) ? pngSize(one) : undefined;
  if (first.status === 0 && size && size[0] === OG.width && size[1] === OG.height)
    ok("og: 1200x630", `the CLI wrote a ${size[0]}x${size[1]} PNG, ${(statSync(one).size / 1024).toFixed(0)} KB`);
  else bad("og: 1200x630", `exit ${first.status}, ${size ? `${size[0]}x${size[1]}` : first.stderr?.toString().trim()}`);

  if (first.status === 0 && second.status === 0 && readFileSync(one).equals(readFileSync(two)))
    ok("og: two runs, the same bytes", "cmp");
  else bad("og: two runs, the same bytes", `exit ${first.status}/${second.status}, or the files differ`);

  // the two refusals a one-spec export owes: a second spec, and stdout
  const many = spawnSync(process.execPath, [CLI, "solid/specs/bars.json", "solid/specs/funnel.json", "--og", "-o", join(work, "x.png")], { cwd: NATIVE });
  const stdout = spawnSync(process.execPath, [CLI, "solid/specs/bars.json", "--og", "-o", "-"], { cwd: NATIVE });
  if (many.status === 2 && /--og is one spec, not 2/.test(many.stderr.toString()) && stdout.status === 2 && /writes a file, not stdout/.test(stdout.stderr.toString()))
    ok("og: one spec, and a file", "--og is one spec, not 2; --og writes a file, not stdout");
  else bad("og: one spec, and a file", `exit ${many.status}/${stdout.status}: ${many.stderr.toString().trim()} ${stdout.stderr.toString().trim()}`);

  // the card itself, in Chromium: the title is text, the figure grew to the card's room and kept its aspect, and nothing
  // overflows the 630 px. A figure that overflowed would be cropped by the screenshot, which is what this is for.
  const executable = chromium.executablePath();
  if (!existsSync(executable)) console.log("skip the og card: Playwright's chromium is not installed (bunx playwright install chromium)");
  else {
    const browser = await chromium.launch();
    try {
      const s = spec("table.json");
      const page = await browser.newPage({ viewport: { width: OG.width, height: OG.height }, deviceScaleFactor: 1 });
      await page.setContent(ogCard(s), { waitUntil: "load" });
      const card = await page.evaluate(() => {
        const svg = document.querySelector(".fig svg") as SVGSVGElement | null;
        const box = svg?.getBoundingClientRect();
        return {
          title: document.querySelector("h1")?.textContent ?? "",
          caption: document.querySelector("figcaption")?.textContent ?? "",
          scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
          // the element is the room it was given; its content keeps its aspect inside (the attribute is the default
          // xMidYMid meet, which is what "not stretched" is), so the drawn figure is `width` by `width / aspect`
          stretch: svg?.getAttribute("preserveAspectRatio") ?? "xMidYMid meet",
          figure: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : undefined,
          viewBox: svg ? { width: svg.viewBox.baseVal.width, height: svg.viewBox.baseVal.height } : undefined,
        };
      });
      const layout = sizeOf(s);
      const f = card.figure;
      // the drawn height: the element's width carried through the layout's aspect, which must fit the element's box
      const drawn = f ? (f.width * layout.height) / layout.width : 0;
      if (card.title === s.title && card.caption === (s.source ?? ""))
        ok("og: the card's words", `"${card.title}", its source as the caption`);
      else bad("og: the card's words", `${JSON.stringify(card.title)} / ${JSON.stringify(card.caption)}`);
      if (f && card.viewBox && f.width === OG.width - 128 && drawn <= f.height + 0.5 && !/none/.test(card.stretch))
        ok(
          "og: the figure fills the card",
          `${card.viewBox.width}x${card.viewBox.height} in ${f.width.toFixed(0)}x${f.height.toFixed(0)} of room, ` +
            `drawn ${f.width.toFixed(0)}x${drawn.toFixed(0)} (${(f.width / layout.width).toFixed(2)}x), ${card.stretch}`,
        );
      else bad("og: the figure fills the card", JSON.stringify(card));
      if (card.scrollHeight === OG.height) ok("og: nothing overflows", `the card is ${OG.width}x${OG.height}, no scroll`);
      else bad("og: nothing overflows", `the document is ${card.scrollHeight} px tall`);

      // the reference as pixels, for the comparison below: the same viewport, the same clip
      writeFileSync(join(work, "og-ref.png"), await page.screenshot({ clip: { x: 0, y: 0, width: OG.width, height: OG.height } }));
    } finally {
      await browser.close();
    }

    // the host's card against the reference's: the ink of each band (the header, the figure, the caption) has to sit in the
    // same box, and the two rasters have to agree about the pixels — the text is rasterised differently and the intent may
    // wrap a word earlier (ThorVG's measure against the browser's), so the bar is a mean, not equality.
    const lib = join(NATIVE, "build/solid/libui.dylib");
    if (!existsSync(lib)) console.log("skip the host's card: build/solid/libui.dylib is not built (sh desktop/build.sh solid)");
    else {
      const { ui } = await import("./src/ffi.ts");
      const ref = ui.png(join(work, "og-ref.png"));
      const host = ui.png(one);
      const ink = (r: { width: number; height: number; pixels: Uint8Array }, y0: number, y1: number) => {
        let left = r.width, right = -1, top = y1, bottom = -1;
        for (let y = y0; y < y1; y++)
          for (let x = 0; x < r.width; x++) {
            const i = (y * r.width + x) * 4;
            if (r.pixels[i]! + r.pixels[i + 1]! + r.pixels[i + 2]! > 120) {
              if (x < left) left = x;
              if (x > right) right = x;
              if (y < top) top = y;
              if (y > bottom) bottom = y;
            }
          }
        return { left, right, top, bottom };
      };
      if (ref && host) {
        const bands: [string, number, number][] = [
          ["header", 0, 175],
          ["figure", 175, 545],
          ["caption", 545, 630],
        ];
        const off = bands.map(([name, y0, y1]) => {
          const [a, b] = [ink(ref, y0, y1), ink(host, y0, y1)];
          return { name, dy: Math.max(Math.abs(a.top - b.top), Math.abs(a.bottom - b.bottom)), dx: Math.abs(a.left - b.left) };
        });
        const worst = off.reduce((w, o) => (Math.max(o.dx, o.dy) > Math.max(w.dx, w.dy) ? o : w), off[0]!);
        if (Math.max(worst.dx, worst.dy) <= 2)
          ok("og: the host's bands are the reference's", off.map((o) => `${o.name} ±${Math.max(o.dx, o.dy)}`).join(", "));
        else bad("og: the host's bands are the reference's", JSON.stringify(off));
        let sum = 0;
        for (let i = 0; i < ref.pixels.length; i += 4) {
          const d = Math.max(
            Math.abs(ref.pixels[i]! - host.pixels[i]!),
            Math.abs(ref.pixels[i + 1]! - host.pixels[i + 1]!),
            Math.abs(ref.pixels[i + 2]! - host.pixels[i + 2]!),
          );
          sum += d;
        }
        const mean = sum / (ref.pixels.length / 4);
        if (mean < 12) ok("og: the host's card is close to the reference", `mean ${mean.toFixed(2)}/255`);
        else bad("og: the host's card is close to the reference", `mean ${mean.toFixed(2)}/255`);
      }
    }
  }
}

console.log(`figure-export: ${checks - failed} of ${checks} ok; worst rect error ${worstRect.toFixed(3)} px`);
if (failed) {
  console.error(`${failed} failure(s) of ${checks}`);
  process.exit(1);
}
