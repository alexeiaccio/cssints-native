// The text renderer's CLI: one glyph-kit spec as characters, the same drawing the desktop, the terminal and the browser
// make of it. It reads the layout (`src/figure/text.ts`), so a new kind draws here the moment `layout` returns its rows.
//
//   bun solid/figure.ts solid/specs/bars.json                 the figure, 80 cells wide
//   bun solid/figure.ts solid/specs/pipeline.json --width 60  cut at 60 display cells (a line that is longer says …)
//   bun solid/figure.ts solid/specs/funnel.json --compact      plain ASCII: # a cell, = a partial one, > the focus mark
//   bun solid/figure.ts solid/specs/funnel.json --markdown     ## title, the intent, the fence, _source_
//   bun solid/figure.ts solid/specs/pipeline.json --svg out.svg   the figure as one standalone SVG
//   bun solid/figure.ts solid/specs/palette.json --html page.html  the figure as one self-contained page
//   bun solid/figure.ts bars.json funnel.json --deck -o deck.html  a deck: one self-contained page, a slide a spec
//   bun solid/figure.ts solid/specs/bars.json --png out.png --scale 2   the figure as a raster, through the desktop host
//   bun solid/figure.ts bars.json funnel.json --pdf -o deck.pdf   the deck printed, one page a slide (Playwright's Chromium)
//   bun solid/figure.ts bars.json --deck -o -                  any export to stdout with -
//   bun solid/figure.ts --redraw native/README.md             the document with every marked figure drawn again (stdout)
//
// An invalid spec is refused with every sentence `check` has, on stderr, exit 1, and no figure on stdout and no export
// file — as the desktop and terminal hosts refuse before a frame, and as a deck refuses the whole deck (it writes
// nothing when one of its specs is invalid). `--redraw` throws the same way, naming the document and the line.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parse, type Spec } from "./src/figure/spec.ts";
import { deck } from "./src/figure/export/deck.ts";
import { html } from "./src/figure/export/html.ts";
import { png } from "./src/figure/export/png.ts";
import { svg } from "./src/figure/export/svg.ts";
import { markdown, redrawDoc, render } from "./src/figure/text.ts";

const fail = (message: string, code = 1): never => {
  console.error(`figure: ${message}`);
  process.exit(code);
};

const args = process.argv.slice(2);
let specPaths: string[] = [];
let docPath: string | undefined;
let mode: "text" | "markdown" = "text";
let compact = false;
let width = 80;
/** An export: what it is, and where it goes (`-` is stdout, for the SVG, the HTML and the deck). */
let exportAs: { mode: "svg" | "html" | "deck" | "png" | "pdf"; path: string } | undefined;
/** The deck's title (`--title`): the first spec's unless given. */
let title: string | undefined;
/** A PNG's density: 2 is the Retina raster, 1 the layout's own pixels. */
let scale = 2;
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--width") {
    width = Number(args[++i]);
    if (!Number.isInteger(width) || width < 1) fail(`--width needs a whole number of cells above zero: it is ${arg} ${args[i]}`, 2);
  } else if (arg === "--redraw") {
    docPath = args[++i];
    if (!docPath) fail("--redraw needs a Markdown file", 2);
  } else if (arg === "--svg" || arg === "--html") {
    const path = args[++i];
    if (!path) fail(`${arg} needs a file, or - for stdout`, 2);
    if (exportAs) fail(`one export at a time: --${exportAs.mode} and ${arg}`, 2);
    exportAs = { mode: arg === "--svg" ? "svg" : "html", path };
  } else if (arg === "--deck" || arg === "--pdf" || arg === "--png") {
    if (exportAs) fail(`one export at a time: --${exportAs.mode} and ${arg}`, 2);
    exportAs = { mode: arg.slice(2) as "deck" | "pdf" | "png", path: "" };
  } else if (arg === "-o" || arg === "--out") {
    const path = args[++i];
    if (!path) fail(`${arg} needs a file, or - for stdout`, 2);
    if (!exportAs) fail(`${arg} needs an export to write: --deck, --pdf or --png`, 2);
    if (exportAs.path) fail(`two destinations: ${exportAs.path} and ${path}`, 2);
    exportAs.path = path;
  } else if (arg === "--title") {
    title = args[++i];
    if (!title) fail("--title needs a deck's title", 2);
  } else if (arg === "--scale") {
    scale = Number(args[++i]);
    if (!Number.isInteger(scale) || scale < 1) fail(`--scale needs a whole number of pixels a pixel (2 is Retina): it is ${arg} ${args[i]}`, 2);
  } else if (arg === "--compact") compact = true;
  else if (arg === "--markdown") mode = "markdown";
  else if (arg === "--text") mode = "text";
  else if (arg.startsWith("--")) fail(`unknown flag ${arg}`, 2);
  else specPaths.push(arg);
}

if (docPath) {
  const file = resolve(docPath);
  try {
    process.stdout.write(redrawDoc(readFileSync(file, "utf8"), file, { width, compact }));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  process.exit(0);
}

const USAGE =
  "a spec: bun solid/figure.ts solid/specs/bars.json [--text|--markdown|--compact] [--width N] [--svg|--html FILE], " +
  "or specs and --deck|--pdf -o FILE [--title T], or a spec and --png -o FILE [--scale N]";
if (specPaths.length === 0) fail(USAGE, 2);
if (!exportAs && specPaths.length > 1) fail(`one spec at a time: ${specPaths[0]} and ${specPaths[1]}`, 2);
if (exportAs) {
  const one = exportAs.mode === "svg" || exportAs.mode === "html" || exportAs.mode === "png";
  if (one && specPaths.length !== 1)
    fail(`--${exportAs.mode} is one spec, not ${specPaths.length}: ${specPaths.slice(1).join(", ")}`, 2);
  if (!exportAs.path) fail(`--${exportAs.mode} needs a file: -o <file>`, 2);
  if (exportAs.path === "-" && (exportAs.mode === "png" || exportAs.mode === "pdf"))
    fail(`--${exportAs.mode} writes a file, not stdout`, 2);
}

// every spec, before anything is drawn or written: an invalid one is every sentence `check` has, named by its file, and
// no export at all — a deck with a bad slide is not written
const specs: Spec[] = [];
for (const path of specPaths) {
  let text: string;
  try {
    text = readFileSync(resolve(path), "utf8");
  } catch (error) {
    fail(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const { spec, problems } = parse(text, { dir: dirname(resolve(path)) });
  if (!spec) fail(`${path}: ${problems.join("\n")}`);
  specs.push(spec);
}
const spec = specs[0]!;

/** An export's bytes: a file, or `-` for stdout. Nothing is opened until every spec above is valid. */
const write = (path: string, output: string): void => {
  if (path === "-") {
    process.stdout.write(output);
    return;
  }
  try {
    writeFileSync(resolve(path), output);
  } catch (error) {
    fail(`cannot write ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

if (!exportAs) process.stdout.write(mode === "markdown" ? markdown(spec, { width, compact }) : `${render(spec, { width, compact })}\n`);
else if (exportAs.mode === "svg" || exportAs.mode === "html")
  write(exportAs.path, exportAs.mode === "svg" ? svg(spec) : html(spec));
else if (exportAs.mode === "deck") write(exportAs.path, deck(specs, { title }));
else if (exportAs.mode === "png") {
  const written = png(specPaths[0]!, exportAs.path, { scale });
  if (!written.ok) fail(written.message || `cannot write ${exportAs.path}`);
} else {
  const { pdf } = await import("./src/figure/export/pdf.ts");
  try {
    await pdf(deck(specs, { title }), { path: resolve(exportAs.path) });
  } catch (error) {
    fail(
      `cannot print ${exportAs.path}: ${error instanceof Error ? error.message : String(error)} ` +
        `(--pdf needs Playwright's Chromium: bunx playwright install chromium)`,
    );
  }
}
