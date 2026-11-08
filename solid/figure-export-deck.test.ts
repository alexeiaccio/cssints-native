// The export half's three review forms: a deck, a raster and a PDF. What it holds, for the three specs the shipped
// deck is made of (`palette`, `bars`, `timeline`):
//   (a) the deck has one `<svg>` a spec and one slide a spec, in the specs' order — both counted, and each slide's
//       figure is `svg(spec)` verbatim, so a slide cannot draw a second copy;
//   (b) the deck's HTML has no `<script>`: the navigation is `:target` and the print sheet is CSS;
//   (c) Chromium opens the file, exactly one slide is visible at a time (the first without a fragment, `#s2` with it),
//       every slide and its figure fit the printable box of the PDF's own page size, and `page.pdf()` gives one page a
//       slide (its page count is the specs' count);
//   (d) the PDF's text, read back out of the glyph streams through each font's `ToUnicode` map (`pdfText`), holds every
//       spec's title — the deck's text is text and not an image;
//   (e) `--png` at 1x and 2x is the layout's size (cells * 8 by cells * 16, and twice that) and the 2x frame is the 1x
//       one at twice the pixels: every flat shape pixel is the same colour at 2x its position, and the widest bar's
//       fill is 2x as long at 2x its x;
//   (f) two runs are `cmp`-identical (the deck and the PNG; the PDF's two differ only in its two dates, which are
//       masked and compared);
//   (g) an invalid spec writes no file, for all three forms;
//   and the three mutations that would make those checks pass a wrong deck: a slide that repeats its figure (a), the
//   print CSS dropped (c's page count is one), and a 2x PNG that is the 1x size (e).
//
//   bun solid/figure-export-deck.test.ts
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

import { deck } from "./src/figure/export/deck.ts";
import { pdfMediaBox, pdfPageCount, pdfText } from "./src/figure/export/pdf.ts";
import { svg } from "./src/figure/export/svg.ts";
import { CELL_HEIGHT, CELL_WIDTH, sizeOf } from "./src/figure/kinds.ts";
import { parse, type Spec } from "./src/figure/spec.ts";

const NATIVE = new URL("..", import.meta.url).pathname;
const CLI = join(NATIVE, "solid/figure.ts");
const DECK = ["palette.json", "bars.json", "timeline.json"];
const TITLE = "The review";
const work = mkdtempSync(join(tmpdir(), "cssints-figure-deck-"));
/** The PDF's page, in CSS pixels: 96 to the inch against its points (A4 landscape is 842x595 pt). */
const PX = 96 / 72;
/** 12 mm of margin, the deck's `@page` rule. */
const MARGIN = Math.round((12 / 25.4) * 96);

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
/** Text with its whitespace dropped: a PDF line breaks where the layout broke it, a title checked does not. */
const squash = (text: string): string => text.replace(/\s+/g, "");

const specs = DECK.map(spec);
const titles = specs.map((one) => one.title ?? "A figure");
const run = (args: string[], cwd = NATIVE) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
const noFile = (path: string) => !existsSync(path);

/** (a) and (b): the deck's counts, its order, and what it is not allowed to contain. */
function slideProblems(page: string): string[] {
  const out: string[] = [];
  const svgs = page.match(/<svg\b/g)?.length ?? 0;
  const slides = page.match(/<section class="slide"/g)?.length ?? 0;
  if (svgs !== specs.length) out.push(`${svgs} <svg> elements for ${specs.length} specs`);
  if (slides !== specs.length) out.push(`${slides} slides for ${specs.length} specs`);
  const drawn = [...page.matchAll(/<figure role="img" aria-label="([^"]*)">/g)].map((one) => decode(one[1]!));
  const at = drawn.findIndex((one, index) => one !== titles[index]);
  if (drawn.length !== titles.length) out.push(`${drawn.length} figures, the specs' ${titles.length}`);
  else if (at >= 0) out.push(`figure #${at + 1} is ${JSON.stringify(drawn[at])}, the specs' ${JSON.stringify(titles[at])}`);
  for (const one of specs) if (!page.includes(svg(one))) out.push(`a slide is not svg(${JSON.stringify(one.title)}) verbatim`);
  if (/<script\b/i.test(page)) out.push("a <script> in a deck that is meant to need none");
  if (!page.includes("@page")) out.push("no @page rule");
  if (!page.includes("break-after: page")) out.push("no break-after: page");
  if (!page.includes("prefers-color-scheme: light")) out.push("no light palette");
  if (!page.includes("@media print")) out.push("no print stylesheet");
  if (!page.includes("forced-colors: active")) out.push("no forced-colors rules");
  return out;
}

/** A PNG as { width, height, pixels }, through the host's own loader (`ui.png`: SDL_image, RGBA32). */
interface Raster {
  width: number;
  height: number;
  pixels: Uint8Array;
}
const load = (ui: { png: (path: string) => Raster | undefined }, path: string): Raster => {
  const png = ui.png(path);
  if (!png) throw new Error(`${path} is not a PNG this host can read`);
  return png;
};
const rgbOf = (image: Raster, x: number, y: number): string => {
  const at = 4 * (y * image.width + x);
  return `${image.pixels[at]},${image.pixels[at + 1]},${image.pixels[at + 2]}`;
};
/** The colour of a pixel when its (2r+1)^2 neighbourhood is that one colour, and nothing otherwise. */
const flatAt = (image: Raster, x: number, y: number, r: number): string | undefined => {
  const want = rgbOf(image, x, y);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (x + dx < 0 || y + dy < 0 || x + dx >= image.width || y + dy >= image.height) return undefined;
      else if (rgbOf(image, x + dx, y + dy) !== want) return undefined;
  return want;
};

/** The longest horizontal run of one colour that is not the page's, and where it starts. */
function widestRun(image: Raster, page: string): { y: number; x: number; length: number; colour: string } {
  let best = { y: 0, x: 0, length: 0, colour: "" };
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      const colour = rgbOf(image, x, y);
      if (colour === page) continue;
      let run = 0;
      while (x + run < image.width && rgbOf(image, x + run, y) === colour) run++;
      if (run > best.length) best = { y, x, length: run, colour };
    }
  return best;
}

/** (e): the sizes the layout says, and the 2x frame as the 1x one at twice the pixels. */
function pngProblems(one: Raster, two: Raster, oneSpec: Spec, scale = 2): string[] {
  const out: string[] = [];
  const size = sizeOf(oneSpec);
  const want = { width: size.width * scale, height: size.height * scale };
  for (const [what, image, expected] of [
    ["1x", one, size],
    [`${scale}x`, two, want],
  ] as const) {
    if (image.width !== expected.width || image.height !== expected.height)
      out.push(
        `${what} is ${image.width}x${image.height}, the layout says ${expected.width}x${expected.height} ` +
          `(${expected.width / CELL_WIDTH}x${expected.height / CELL_HEIGHT} cells)`,
      );
  }
  if (out.length) return out;
  // a flat shape pixel (page, panel, track, fill): its 5x5 block is one colour, and so is its 2x2 block at 2x
  const page = rgbOf(one, 0, 0);
  let shapes = 0;
  let moved = 0;
  for (let y = 2; y < one.height - 2; y++)
    for (let x = 2; x < one.width - 2; x++) {
      const mine = flatAt(one, x, y, 2);
      if (mine === undefined) continue;
      const theirs = flatAt(two, 2 * x + 1, 2 * y + 1, 2);
      if (theirs === undefined) continue;
      shapes++;
      if (mine !== theirs) moved++;
    }
  if (shapes < 1000) out.push(`only ${shapes} flat shape pixels: the probe found no drawing`);
  else if (moved) out.push(`${moved} of ${shapes} flat shape pixels are another colour at ${scale}x their place`);
  const barOne = widestRun(one, page);
  const barTwo = widestRun(two, page);
  if (barOne.colour !== barTwo.colour) out.push(`the widest shape is ${barOne.colour} at 1x and ${barTwo.colour} at ${scale}x`);
  else if (barTwo.x !== scale * barOne.x) out.push(`the widest shape starts at x ${barTwo.x} at ${scale}x, not ${scale} x ${barOne.x}`);
  else if (barTwo.length !== scale * barOne.length)
    out.push(`the widest shape is ${barTwo.length} px at ${scale}x, not ${scale} x ${barOne.length}`);
  return out;
}

/** (f): `cmp` of two files, with the PDF's dates masked (Chromium stamps the wall clock into every page). */
const masked = (path: string): string =>
  readFileSync(path, "latin1").replace(/\(D:\d{14}[^)]*\)/g, "(D:0+00'00')");

/** The deck's own sheet cut out: the mutation that makes the print CSS's page count one. */
function withoutPrintCss(page: string): string {
  const at = page.indexOf("@media print {");
  if (at < 0) return page;
  let depth = 0;
  for (let i = at + "@media print {".length - 1; i < page.length; i++) {
    if (page[i] === "{") depth++;
    else if (page[i] === "}" && --depth === 0) return page.slice(0, at) + page.slice(i + 1);
  }
  return page;
}

/** The deck on disk, for Chromium and for the PDF; written once, by the CLI, so what is checked is what ships. */
function writeDeck(): string {
  const path = join(work, "review.html");
  const result = run([...DECK.map((name) => `solid/specs/${name}`), "--deck", "-o", path, "--title", TITLE]);
  if (result.status !== 0) throw new Error(`--deck: exit ${result.status}: ${result.stderr}`);
  return path;
}
const deckPath = writeDeck();
const deckHtml = deck(specs, { title: TITLE });
const pageProblems = slideProblems(deckHtml);

// (a) and (b): the three-slide deck itself.
if (pageProblems.length) bad("the deck", pageProblems.join("; "));
else
  ok(
    "the deck",
    `${specs.length} slides, ${specs.length} <svg> (each svg(spec) verbatim), in the specs' order; no <script>; ` +
      `${statSync(deckPath).size} B`,
  );

if (readFileSync(deckPath, "utf8") !== deckHtml) bad("the CLI's deck", "the file is not deck(specs)");
else ok("the CLI's deck", `${statSync(deckPath).size} B on disk, byte for byte`);

// (g): an invalid spec writes no file, in all three forms.
for (const [what, args] of [
  ["--deck", ["solid/specs/bars.json", "solid/specs/invalid-funnel.json", "--deck", "-o", join(work, "invalid.html")]],
  ["--png", ["--png", "solid/specs/invalid-funnel.json", "-o", join(work, "invalid.png")]],
  ["--pdf", ["solid/specs/invalid-funnel.json", "--pdf", "-o", join(work, "invalid.pdf")]],
] as const) {
  const target = args[args.length - 1]!;
  const result = run([...args]);
  if (result.status === 0) bad(`invalid spec ${what}`, "the CLI exited 0");
  else if (!/a funnel never grows/.test(result.stderr)) bad(`invalid spec ${what}`, `stderr has no sentence: ${result.stderr}`);
  else if (!noFile(target)) bad(`invalid spec ${what}`, `it wrote ${target}`);
  else ok(`invalid spec ${what}`, "its sentence, exit non-zero, no file");
}

// (e): the raster, through the host, at both densities.
const { ui } = await import("./src/ffi.ts");
const bars = spec("bars.json");
const pngOne = join(work, "bars.png");
const pngTwo = join(work, "bars@2x.png");
for (const [path, scale] of [
  [pngOne, 1],
  [pngTwo, 2],
] as const) {
  const result = run(["--png", "solid/specs/bars.json", "-o", path, "--scale", String(scale)]);
  if (result.status !== 0) bad(`--png ${scale}x`, `exit ${result.status}: ${result.stderr}`);
}
const rasterOne = load(ui, pngOne);
const rasterTwo = load(ui, pngTwo);
const raster = pngProblems(rasterOne, rasterTwo, bars);
if (raster.length) bad("the raster", raster.join("; "));
else
  ok(
    "the raster",
    `1x ${rasterOne.width}x${rasterOne.height} = ${rasterOne.width / CELL_WIDTH}x${rasterOne.height / CELL_HEIGHT} cells, ` +
      `2x ${rasterTwo.width}x${rasterTwo.height} = twice the pixels, the same layout (${statSync(pngOne).size} B, ` +
      `${statSync(pngTwo).size} B)`,
  );

// (f): two runs, `cmp` — the deck and the PNG byte for byte; the PDF once its two dates are masked.
{
  const again = join(work, "review-again.html");
  const second = run([...DECK.map((name) => `solid/specs/${name}`), "--deck", "-o", again, "--title", TITLE]);
  if (second.status !== 0) bad("the deck is deterministic", `exit ${second.status}: ${second.stderr}`);
  else if (readFileSync(again, "utf8") !== readFileSync(deckPath, "utf8")) bad("the deck is deterministic", "two runs differ");
  else ok("the deck is deterministic", "two runs, the same bytes");
  const againPng = join(work, "bars-again.png");
  const pngAgain = run(["--png", "solid/specs/bars.json", "-o", againPng, "--scale", "1"]);
  const cmp = pngAgain.status === 0 ? spawnSync("cmp", ["-s", pngOne, againPng]) : { status: -1 };
  if (pngAgain.status !== 0 || cmp.status !== 0) bad("the PNG is deterministic", `exit ${pngAgain.status}: ${pngAgain.stderr}`);
  else ok("the PNG is deterministic", `two runs, cmp on ${statSync(pngOne).size} B`);
}

// the PDF: the CLI's own file, twice, then the page count, the titles as text and the browser for the print size. Skips
// (with a message) when Playwright's Chromium is not installed, as the browser checks in `solid/test.sh` do.
const executable = chromium.executablePath();
/** The PDF's page count, for the summary line: 0 when there is no Chromium to print with. */
let printedPages = 0;
if (!existsSync(executable)) {
  console.log("skip the PDF and the browser: Playwright's chromium is not installed (bunx playwright install chromium)");
} else {
  const pdfA = join(work, "review.pdf");
  const pdfB = join(work, "review-again.pdf");
  for (const path of [pdfA, pdfB]) {
    const result = run([...DECK.map((name) => `solid/specs/${name}`), "--pdf", "-o", path, "--title", TITLE]);
    if (result.status !== 0) bad("--pdf", `exit ${result.status}: ${result.stderr}`);
  }
  if (existsSync(pdfA) && existsSync(pdfB)) {
    if (masked(pdfA) !== masked(pdfB)) bad("the PDF is deterministic", "two runs differ past the dates");
    else ok("the PDF is deterministic", `two runs, cmp with the two dates masked (${statSync(pdfA).size} B)`);
  }
  // (c) and (d): the page count and each slide's title, as text
  if (existsSync(pdfA)) {
    const pdfBytes = readFileSync(pdfA);
    printedPages = pdfPageCount(pdfBytes);
    const box = pdfMediaBox(pdfBytes);
    if (printedPages !== specs.length) bad("one page a slide", `${printedPages} pages for ${specs.length} slides`);
    else ok("one page a slide", `${printedPages} pages = ${specs.length} slides; A4 landscape, ${box.width}x${box.height} pt`);
    const textPages = pdfText(pdfBytes);
    const missing = titles.filter((title, index) => !squash(textPages[index] ?? "").includes(squash(title)));
    if (textPages.length !== specs.length) bad("the PDF's text", `${textPages.length} text pages for ${printedPages} pages`);
    else if (missing.length) bad("the PDF's text", `page text without ${missing.join(", ")}`);
    else
      ok(
        "the PDF's text",
        `each title is text, read back through each font's ToUnicode map (${textPages[1]!.length} chars on page 2, ` +
          `${squash(textPages[1]!).length} without spaces)`,
      );

    const browser = await chromium.launch();
    try {
      // the print size from the PDF itself: its sheet minus the deck's 12 mm margin, in CSS pixels
      const printBox = {
        width: Math.round(box.width * PX) - 2 * MARGIN,
        height: Math.round(box.height * PX) - 2 * MARGIN,
      };
      const page = await browser.newPage({ viewport: { width: printBox.width, height: printBox.height } });
      await page.goto(pathToFileURL(deckPath).href, { waitUntil: "load" });
      // (c) the navigation: one slide, the first without a fragment and the named one with it
      const visible = () =>
        page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>(".slide")]
            .filter((one) => getComputedStyle(one).display !== "none")
            .map((one) => one.id),
        );
      const first = await visible();
      await page.evaluate(() => (location.hash = "#s2"));
      const second = await visible();
      await page.evaluate(() => (location.hash = "#top"));
      const back = await visible();
      const same = (got: string[], want: string[]) => got.length === 1 && got[0] === want;
      if (!same(first, "s1") || !same(second, "s2") || !same(back, "s1"))
        bad("the navigation", `no fragment shows ${first}, #s2 shows ${second}, #top shows ${back}`);
      else ok("the navigation", ":target: one slide a time, the first without a fragment, #s2 with it");
      // (c) the print size: every slide, and its figure, inside the printable box
      await page.emulateMedia({ media: "print" });
      await page.setViewportSize(printBox);
      const boxes = await page.evaluate(() => {
        const scroll = { x: window.scrollX, y: window.scrollY };
        return [...document.querySelectorAll<HTMLElement>(".slide")].map((one) => {
          const slide = one.getBoundingClientRect();
          const figure = one.querySelector("svg")!.getBoundingClientRect();
          return {
            id: one.id,
            slide: [slide.left + scroll.x, slide.top + scroll.y, slide.width, slide.height],
            figure: [figure.left - slide.left, figure.top - slide.top, figure.width, figure.height],
          };
        });
      });
      const over = boxes.filter(
        (one) =>
          one.slide[2]! > printBox.width + 0.5 ||
          one.slide[3]! > printBox.height + 0.5 ||
          one.figure[0]! < -0.5 ||
          one.figure[1]! < -0.5 ||
          one.figure[0]! + one.figure[2]! > printBox.width + 0.5 ||
          one.figure[1]! + one.figure[3]! > printBox.height + 0.5,
      );
      if (boxes.length !== specs.length) bad("the print size", `${boxes.length} slides in print, not ${specs.length}`);
      else if (over.length)
        bad(
          "the print size",
          over.map((one) => `${one.id} is ${one.slide[2]}x${one.slide[3]} with its figure at ${one.figure.join(",")}`).join("; ") +
            ` in ${printBox.width}x${printBox.height}`,
        );
      else
        ok(
          "the print size",
          `${boxes.length} slides and their figures inside ${printBox.width}x${printBox.height} px ` +
            `(${Math.round(box.width)}x${Math.round(box.height)} pt less 2 x 12 mm)`,
        );
      // (c) the pages: the same `page.pdf()` the CLI makes
      const printed = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      const pdfPages = pdfPageCount(printed);
      if (pdfPages !== specs.length) bad("the print CSS", `page.pdf() gives ${pdfPages} pages for ${specs.length} slides`);
      else ok("the print CSS", `page.pdf() gives ${pdfPages} pages, one a slide`);

      // the mutations: each makes its own check fail, and says how
      const mutation = (what: string, broken: string[]) => {
        if (broken.length) ok(`mutation: ${what}`, broken[0]!);
        else bad(`mutation: ${what}`, "the check passed a deck that should fail");
      };
      const repeated = deckHtml.replace(svg(specs[0]!), `${svg(specs[0]!)}\n${svg(specs[0]!)}`);
      if (repeated === deckHtml) bad("mutation: a repeated figure", "the deck did not change");
      else mutation("a slide repeats its figure", slideProblems(repeated));

      const unbroken = await browser.newPage({ viewport: printBox });
      await unbroken.setContent(withoutPrintCss(deckHtml), { waitUntil: "load" });
      const loosePages = pdfPageCount(await unbroken.pdf({ preferCSSPageSize: true, printBackground: true }));
      await unbroken.close();
      if (loosePages === specs.length) bad("mutation: no print CSS", `page.pdf() still gives ${loosePages} pages`);
      else
        mutation("the print CSS dropped", [
          `page.pdf() gives ${loosePages} page${loosePages === 1 ? "" : "s"} for ${specs.length} slides`,
        ]);

      mutation("a 2x PNG at the 1x size", pngProblems(rasterOne, rasterOne, bars));
      await page.close();
    } finally {
      await browser.close();
    }
  }
}

console.log(
  `figure-export-deck: ${checks - failed} of ${checks} ok; ${specs.length} slides, ${printedPages} PDF pages, ` +
    `a ${rasterTwo.width}x${rasterTwo.height} 2x raster`,
);
if (failed) {
  console.error(`${failed} failure(s) of ${checks}`);
  process.exit(1);
}
