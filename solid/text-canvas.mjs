// The second text oracle: the same sheet drawn by Chrome's Canvas2D, the browser target's rasteriser. `solid/text-oracle.ts
// --canvas` runs it with the same spec it gives the CoreText tool, so the two references are drawn from one list of lines.
//
//   node text-canvas.mjs spec.json        (Playwright's Chromium; the spec's font as a data URL, so no server)
//
// spec.json: { "width", "height", "scale", "bg": [r, g, b], "fg": [r, g, b], "font": "<ttf>", "out": "<png>",
//              "rows": [{ "text", "size", "x", "y" }] } — the same shape text-oracle.swift reads.
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";

const spec = JSON.parse(await readFile(process.argv[2], "utf8"));
const scale = spec.scale ?? 1;
const font = await readFile(spec.font);
const rgb = (c) => `rgb(${c[0]} ${c[1]} ${c[2]})`;

const browser = await chromium.launch({ args: ["--force-color-profile=srgb"] });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setContent(
    `<style>@font-face{font-family:Roboto;src:url(data:font/ttf;base64,${font.toString("base64")})}</style>`,
  );
  const data = await page.evaluate(
    async ({ spec, scale, rows }) => {
      await document.fonts.load(`400 32px Roboto`);
      await document.fonts.ready;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(spec.width * scale);
      canvas.height = Math.round(spec.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = `rgb(${spec.bg[0]} ${spec.bg[1]} ${spec.bg[2]})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // the layout's units: the same coordinates, the same sizes as Clay gave the text
      ctx.scale(scale, scale);
      ctx.fillStyle = `rgb(${spec.fg[0]} ${spec.fg[1]} ${spec.fg[2]})`;
      for (const r of rows) {
        ctx.font = `400 ${r.size}px Roboto`;
        const ascent = ctx.measureText(r.text).fontBoundingBoxAscent ?? r.size * 0.8;
        ctx.fillText(r.text, r.x, r.y + ascent);
      }
      return canvas.toDataURL("image/png");
    },
    { spec, scale, rows: spec.rows },
  );
  writeFileSync(spec.out, Buffer.from(data.split(",")[1], "base64"));
  console.log(`text-canvas: ${spec.rows.length} lines into ${spec.out}`);
} finally {
  await browser.close();
}
