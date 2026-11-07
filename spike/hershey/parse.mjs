// A .jhf file into the spike's table: the bytes a renderer would ship. Header "HSY1", the glyph count, then per glyph
// left/right (the .jhf advance), its stroke count, its point count and a u16 offset into the body; the body is, per
// stroke, a u8 point count and that many int8 (x, y) pairs. Coordinates are int8 because a .jhf is an int8 grid by
// construction ('R' is 0); y runs down, as the font has it, with the baseline at 9 (caps start at -12, a descender
// reaches 16).
//
// The glyph number column of the futural distribution is the placeholder "12345" on every line (kamalmostafa's copy of
// the original Hurt conversion), so a glyph is identified by the line's position: 96 lines, space (32) to delete (127).
//
//   node parse.mjs ../../vendor/hershey/futural.jhf out/futural.bin
import { readFileSync, writeFileSync } from "node:fs";

/**
 * The strokes of one .jhf line: pairs after the left and right columns, " R" a pen up (a new stroke). The count in
 * columns 5..8 is one more than the line's pairs in this distribution (it counts a terminator), so the line's length is
 * what says how many there are — the same answer for both.
 */
function glyphOf(line) {
  const pairs = (line.length - 10) / 2;
  if (!Number.isInteger(pairs)) throw new Error(`a ragged .jhf line: ${JSON.stringify(line)}`);
  const left = line.charCodeAt(8) - 82;
  const right = line.charCodeAt(9) - 82;
  const strokes = [];
  let run = null;
  for (let i = 0; i < pairs; i++) {
    const c = line[10 + 2 * i];
    const x = c.charCodeAt(0) - 82;
    const y = line[11 + 2 * i].charCodeAt(0) - 82;
    if (c === " ") {
      run = null; // pen up: the next point starts a stroke
      continue;
    }
    if (!run) strokes.push((run = []));
    run.push([x, y]);
  }
  return { left, right, strokes };
}

const [input, output = "futural.bin"] = process.argv.slice(2);
if (!input) {
  console.error("usage: node parse.mjs <font.jhf> [out.bin]");
  process.exit(2);
}
const lines = readFileSync(input, "utf8")
  .split("\n")
  .map((l) => l.replace(/[\r ]+$/, ""))
  .filter((l) => l.length >= 10);
const glyphs = lines.map(glyphOf);

// the body first, so a glyph's offset is known before the header is written
const body = [];
let off = 0;
for (const g of glyphs) {
  g.offset = off;
  g.points = g.strokes.reduce((n, s) => n + s.length, 0);
  for (const s of g.strokes) {
    body.push(s.length);
    off += 1;
    for (const [x, y] of s) {
      if (x < -128 || x > 127 || y < -128 || y > 127) throw new Error(`(${x}, ${y}) does not fit an int8`);
      body.push(x & 0xff, y & 0xff);
      off += 2;
    }
  }
}

const head = [0x48, 0x53, 0x59, 0x31, glyphs.length, 32];
for (const g of glyphs) {
  if (g.strokes.length > 255) throw new Error("more than 255 strokes");
  head.push(g.left & 0xff, g.right & 0xff, g.strokes.length, g.points & 0xff, g.points >> 8, g.offset & 0xff, g.offset >> 8);
}
const table = Uint8Array.from([...head, ...body]);
writeFileSync(output, table);

const strokes = glyphs.reduce((n, g) => n + g.strokes.length, 0);
const points = glyphs.reduce((n, g) => n + g.points, 0);
// the .jhf's y runs down with the baseline at 9: caps start at -12, a descender reaches 16
const ys = glyphs.flatMap((g) => g.strokes.flatMap((s) => s.map(([, y]) => y)));
console.log(
  `${input}: ${glyphs.length} glyphs (32..${31 + glyphs.length}), ${strokes} strokes, ${points} points, ` +
    `y ${Math.min(...ys)}..${Math.max(...ys)}, ${table.length} bytes into ${output} ` +
    `(${(table.length / points).toFixed(2)} a point)`,
);
