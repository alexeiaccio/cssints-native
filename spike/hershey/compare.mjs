// The metric of the spike: each row of a page drawn by Hershey strokes against CoreText's raster of the same row. The
// TTF drawn through ThorVG's text path is the control — it must reproduce solid/text.test.ts's ~1.0 weight and ~0.99
// SSIM, which is how we know the spike's places are the renderer's. The strokes are measured twice: as the face sets
// them (its own advances, which is what a page would get) and at Roboto's advances (the shapes alone, without the
// metrics drift). solid/src/textmetric.ts, unchanged.
//
//   node compare.mjs out 14 40 96
import { readFileSync, existsSync } from "node:fs";
import { scoreLines } from "../../solid/src/textmetric.ts";
import { readPng } from "./png.mjs";

const [dir = "out", ...sizes] = process.argv.slice(2);
// the sheet's page and ink, as the pages were drawn
const BG = [16, 18, 24];
const FG = [235, 235, 240];

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pad = (s, n) => String(s).padStart(n);
let missing = 0;
const all = { hersley: [], same: [], text: [] };

for (const size of sizes) {
  const page = JSON.parse(readFileSync(`${dir}/page-${size}.json`, "utf8"));
  const files = {
    hershey: `${dir}/page-${size}-hershey.png`,
    same: `${dir}/page-${size}-hershey-adv.png`,
    text: `${dir}/page-${size}-text.png`,
    oracle: `${dir}/page-${size}-oracle.png`,
  };
  for (const [what, path] of Object.entries(files))
    if (!existsSync(path)) console.error(`compare: no ${what} raster at ${path}`), missing++;
  if (missing) continue;

  const raster = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, readPng(readFileSync(f))]));
  const oracle = raster.oracle;
  for (const [what, bm] of Object.entries(raster))
    if (bm.width !== oracle.width || bm.height !== oracle.height)
      console.error(`compare: ${size}: the ${what} raster is not the page's size`), missing++;

  const lines = page.crops.map((c) => ({ id: c.id, text: c.text, size: c.size, box: { x: c.x, y: c.y, w: c.w, h: c.h } }));
  const h = scoreLines(lines, raster.hershey, oracle, BG, FG);
  const s = scoreLines(lines, raster.same, oracle, BG, FG);
  const t = scoreLines(lines, raster.text, oracle, BG, FG);
  console.log(`\nmetric ${size}: ink in pixels of the text's colour, against CoreText; the TTF is the control`);
  console.log("  line                  ink  coretext  weight   ssim   width | same advances  weight   ssim | ttf weight   ssim");
  for (let i = 0; i < h.length; i++) {
    console.log(
      `  ${h[i].text.padEnd(20)} ${pad(h[i].ink.toFixed(0), 5)} ${pad(h[i].reference.toFixed(0), 9)} ` +
        `${pad(h[i].weight.toFixed(3), 7)} ${pad(h[i].ssim.toFixed(3), 6)} ${pad(`${h[i].width}/${h[i].referenceWidth}`, 8)} |` +
        ` ${pad(s[i].weight.toFixed(3), 14)} ${pad(s[i].ssim.toFixed(3), 6)} |` +
        ` ${pad(t[i].weight.toFixed(3), 10)} ${pad(t[i].ssim.toFixed(3), 6)}`,
    );
    if (![h[i].weight, h[i].ssim, s[i].weight, s[i].ssim, t[i].weight, t[i].ssim].every(Number.isFinite)) missing++;
  }
  all.hersley.push(...h.map((x) => x.weight));
  all.same.push(...s.map((x) => x.ssim));
  all.text.push(...t.map((x) => x.weight));
  console.log(
    `  mean: strokes weight ${mean(h.map((x) => x.weight)).toFixed(3)}, ssim ${mean(h.map((x) => x.ssim)).toFixed(3)};` +
      ` same advances ssim ${mean(s.map((x) => x.ssim)).toFixed(3)};` +
      ` ttf weight ${mean(t.map((x) => x.weight)).toFixed(3)}, ssim ${mean(t.map((x) => x.ssim)).toFixed(3)}`,
  );
}

if (sizes.length && !missing) {
  console.log(
    `\nmetric: strokes weight ${mean(all.hersley).toFixed(3)} and ssim ${mean(all.same).toFixed(3)} (same advances)` +
      ` over ${all.hersley.length} rows; the TTF control weights ${mean(all.text).toFixed(3)}`,
  );
}
process.exit(missing ? 1 : 0);
