// The text oracle's driver: render the sheet page (app/Sheet.tsx) with ThorVG, draw the same strings at the same places
// with CoreText (text-oracle.swift), and print the metric of textmetric.ts line by line — the ink weight against
// CoreText's and the structural similarity at the best whole-pixel shift.
//
//   bun solid/text-oracle.ts                  measure the frame as it is drawn (the numbers the suite checks)
//   bun solid/text-oracle.ts --density 2      the same page at the window's pixel density (a Retina screen's 2x)
//   bun solid/text-oracle.ts --canvas         the reference is Chrome's Canvas2D (text-canvas.mjs, the web target's
//                                             rasteriser) instead of CoreText
//   bun solid/text-oracle.ts --weight 0.5     the same with the renderer's text weight at 0.5 Clay units
//   bun solid/text-oracle.ts --sweep          a table of weights against the one reference raster (at 1x)
//   bun solid/text-oracle.ts --update         re-store the sheet and oracle frames from this run
//
// CoreText is the platform's rasteriser: the reference is what the same Roboto at the same sizes looks like when macOS
// draws it (font smoothing off; antialiasing and subpixel positioning on). The stored oracle is what text.test.ts
// compares against, so the suite needs neither Swift nor Chrome.
import "./plugin.ts";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const ROOT = new URL(".", import.meta.url).pathname;
const FRAMES = `${ROOT}frames/`;
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};

const { ui } = await import("./src/ffi.ts");
const { createFrame } = await import("./src/frame.ts");
const { El, render } = await import("./src/renderer.ts");
const { Sheet, ROWS, size } = await import("./app/Sheet.tsx");
const { scoreLines } = await import("./src/textmetric.ts");
import type { Bitmap, Line, LineScore } from "./src/textmetric.ts";

if (ui.init(size.width, size.height) || ui.font(new URL("../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname) < 0) {
  console.error("ui_init or ui_font failed (is thorvg installed, and build/solid/libui.dylib built?)");
  process.exit(1);
}
const root = new El("root");
render(() => Sheet(), root);
const frame = createFrame(root, {});
const weight = Number(arg("--weight") ?? 0);
const density = Number(arg("--density") ?? 1);
const update = process.argv.includes("--update");
// the reference: CoreText (the platform's) or Chrome's Canvas2D (the browser target's)
const canvas = process.argv.includes("--canvas");
const sweep = process.argv.includes("--sweep");

// the sheet's own colours: the page's and the ink's, as the page declares them
const BG = [16, 18, 24];
const FG = [235, 235, 240];

// the tool: CoreText, built once
const tool = new URL("../build/solid/text-oracle", import.meta.url).pathname;
if (!existsSync(tool)) {
  console.log(`text-oracle: building ${tool}`);
  execFileSync("swiftc", ["-O", `${ROOT}text-oracle.swift`, "-o", tool], { stdio: "inherit" });
}

/** The sheet's rows: the layout's boxes (Clay units) and the crops the metric reads (device pixels). */
const rows = (scale: number): Line[] => {
  const boxes = ROWS.map((r) => {
    const box = ui.bounds(Buffer.from(r.id));
    if (!box) throw new Error(`no bounds for ${r.id}`);
    return { id: r.id, text: r.text, size: r.size, box: { x: box[0]!, y: box[1]!, w: box[2]!, h: box[3]! } };
  });
  return boxes.map((b) => ({
    id: b.id,
    text: b.text,
    size: b.size,
    box: { x: b.box.x * scale, y: b.box.y * scale, w: b.box.w * scale, h: b.box.h * scale },
  }));
};

/** Draws the page at `density` and `weight`, and runs the oracle over it: the frame, its rows and the line scores. */
function measure(
  density: number,
  weight: number,
): { scale: number; pixels: Uint8Array; rows: Line[]; scores: LineScore[] } {
  if (!ui.density(density)) throw new Error(`cannot set the density to ${density}`);
  ui.textWeight(weight);
  frame(0, 0, false, 1 / 60, true);
  const lines = rows(density);
  // the oracle: the same lines through CoreText, into the stored PNG (the layout's coordinates; it scales them)
  const out = `${FRAMES}text-${canvas ? "canvas" : "oracle"}${density === 1 ? "" : `-${density}x`}.png`;
  const spec = {
    width: size.width,
    height: size.height,
    scale: density,
    bg: BG,
    fg: FG,
    font: new URL("../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname,
    out,
    rows: lines.map((l) => ({ text: l.text, size: l.size, x: l.box.x / density, y: l.box.y / density })),
  };
  const specPath = `${process.env.TMPDIR ?? "/tmp"}/cssints-text-oracle.json`;
  writeFileSync(specPath, JSON.stringify(spec));
  if (canvas) execFileSync("node", [`${ROOT}text-canvas.mjs`, specPath], { stdio: "inherit" });
  else execFileSync(tool, [specPath], { stdio: "inherit" });
  const png = ui.png(out);
  if (!png) throw new Error(`cannot read ${out}`);
  const reference: Bitmap = { width: png.width, height: png.height, pixels: png.pixels };
  const pixels = ui.pixels(size.width * density, size.height * density);
  return {
    scale: density,
    pixels,
    rows: lines,
    scores: scoreLines(lines, { width: reference.width, height: reference.height, pixels }, reference, BG, FG),
  };
}

const show = (label: string, scores: LineScore[]) => {
  console.log(`\n${label}`);
  console.log("  line                    size     ink   coretext  weight   ssim  shift   width");
  for (const s of scores)
    console.log(
      `  ${s.text.padEnd(22)} ${String(s.size).padStart(3)} ${s.ink.toFixed(0).padStart(8)} ${s.reference
        .toFixed(0)
        .padStart(9)} ${s.weight.toFixed(3).padStart(8)} ${s.ssim.toFixed(3).padStart(6)}  ${s.dx},${s.dy}  ${String(
        s.width,
      ).padStart(3)}/${s.referenceWidth}`,
    );
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(
    `  mean weight ${mean(scores.map((s) => s.weight)).toFixed(3)}, mean ssim ${mean(scores.map((s) => s.ssim)).toFixed(3)},` +
      ` thinnest ${Math.min(...scores.map((s) => s.weight)).toFixed(3)}, fattest ${Math.max(...scores.map((s) => s.weight)).toFixed(3)}`,
  );
};

if (sweep) {
  for (const w of [0, 0.25, 0.5, 0.75, 1, 1.5]) show(`text weight ${w}`, measure(1, w).scores);
} else {
  const run = measure(density, weight);
  show(`text weight ${weight}, density ${density}`, run.scores);
  if (update) {
    // the frame as the metric measured it: the last draw
    if (!ui.savePng(`${FRAMES}text-sheet${density === 1 ? "" : `-${density}x`}.png`))
      throw new Error("cannot write the sheet frame");
    console.log(`\ntext-oracle: stored frames/text-sheet${density === 1 ? "" : `-${density}x`}.png and its oracle`);
  }
}
