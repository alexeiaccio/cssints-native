// A pixel diff that says where: the count of differing pixels and the box they are in. The count alone tells a failing
// frame that something moved, not what; the box names the element. Taken from gpucanvas's `diffImages` (MIT, berkantay),
// which answers exactly "what moved, and where".
//
// The cases are a planted patch of known size and place in a synthetic raster, the edges, a diff of another size, and
// two stored frames of the same page in two states — the Widgets page with its switch off and on, whose one change is a
// measured box. Run: bun solid/diff.test.ts (the stored frames need the built libui.dylib; without it they are skipped,
// and the rule above still runs — CI's case).
import assert from "node:assert/strict";

import { diffImages, type Raster } from "./src/diff.ts";
import { ui } from "./src/ffi.ts";

let checks = 0;
let failed = 0;
const ok = (what: string, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what: string, why: string) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));

/** A raster of one colour, with a patch of another: the plant, at a known box. */
const planted = (width: number, height: number, box?: { x: number; y: number; width: number; height: number }) => {
  const pixels = new Uint8Array(width * height * 4).fill(0x10);
  if (box)
    for (let y = box.y; y < box.y + box.height; y++)
      for (let x = box.x; x < box.x + box.width; x++) pixels.fill(0xff, (y * width + x) * 4, (y * width + x) * 4 + 4);
  return { width, height, pixels } satisfies Raster;
};

// ---- the rule ---------------------------------------------------------------------------------------------------------

const same = diffImages(planted(8, 6), planted(8, 6));
if (same?.changed === 0 && !same.bounds) ok("the same image", "0 pixels, no box");
else bad("the same image", JSON.stringify(same));

const patch = diffImages(planted(8, 6), planted(8, 6, { x: 2, y: 1, width: 3, height: 2 }));
const wanted = { changed: 6, bounds: { x: 2, y: 1, width: 3, height: 2 } };
if (JSON.stringify(patch) === JSON.stringify(wanted)) ok("a 3x2 patch at 2,1", `${patch!.changed} pixels, the box is the patch`);
else bad("a 3x2 patch at 2,1", JSON.stringify(patch));

// one pixel in each corner: the box is the whole raster, not the first corner
const corners = planted(4, 4);
for (const [x, y] of [[0, 0], [3, 0], [0, 3], [3, 3]] as const)
  corners.pixels.fill(0xff, (y * 4 + x) * 4, (y * 4 + x) * 4 + 4);
const both = diffImages(planted(4, 4), corners);
if (both?.changed === 4 && JSON.stringify(both.bounds) === JSON.stringify({ x: 0, y: 0, width: 4, height: 4 }))
  ok("four corners", "4 pixels, the box spans them");
else bad("four corners", JSON.stringify(both));

// one pixel in the last column and row: the box is one pixel at the far edge
const edge = planted(5, 5);
edge.pixels.fill(0xff, (4 * 5 + 4) * 4, (4 * 5 + 4) * 4 + 4);
const far = diffImages(planted(5, 5), edge);
if (JSON.stringify(far) === JSON.stringify({ changed: 1, bounds: { x: 4, y: 4, width: 1, height: 1 } }))
  ok("the far edge", "1 pixel at 4,4");
else bad("the far edge", JSON.stringify(far));

// another size is not a diff
if (diffImages(planted(8, 6), planted(8, 5)) === undefined) ok("another size", "refused, undefined");
else bad("another size", "a box came back");

// the alpha channel counts too: the same RGB at another opacity is a difference
const opaque = planted(2, 2);
const faded: Raster = { ...opaque, pixels: opaque.pixels.slice() };
faded.pixels.fill(0x80, 3, 4);
if (diffImages(opaque, faded)?.changed === 1) ok("alpha counts", "one pixel, one difference");
else bad("alpha counts", JSON.stringify(diffImages(opaque, faded)));

// ---- two stored frames of one page in two states ----------------------------------------------------------------

/** The Widgets page with its switch off and on: the same frame size, one changed control. The frames need the built
 *  libui.dylib (SDL3 and ThorVG); a machine without it still checks the rule above. */
let frames: Raster[] | undefined;
try {
  frames = ["widgets-initial.png", "widgets-switch-on.png"].map((name) => {
    const frame = ui.png(new URL(`./frames/${name}`, import.meta.url).pathname);
    if (!frame) throw new Error(`solid/frames/${name} is not a PNG this host can read`);
    return frame;
  });
} catch (e) {
  // a tree without the dylib skips these; a frame that cannot be read is a failure, not a skip
  if (!/libui|dlopen|dynamic library|shared object/i.test((e as Error).message)) throw e;
  console.log(`skip the stored frames: ${(e as Error).message}`);
}
if (frames) {
  const [off, on] = frames as [Raster, Raster];
  if (diffImages(off, off)?.changed === 0) ok("a stored frame against itself", "0 pixels, the decode is the decode");
  else bad("a stored frame against itself", "a file differs from itself");

  const flipped = diffImages(off, on);
  // measured on the two stored frames; a change to either is a deliberate new number here
  const measured = { changed: 2220, bounds: { x: 40, y: 117, width: 280, height: 32 } };
  if (JSON.stringify(flipped) === JSON.stringify(measured))
    ok(
      "the switch off against on",
      `${flipped!.changed} pixels in a ${measured.bounds.width}x${measured.bounds.height} box at ` +
        `${measured.bounds.x},${measured.bounds.y} of a ${off.width}x${off.height} frame`,
    );
  else bad("the switch off against on", JSON.stringify(flipped));
}

console.log(`\nsolid/diff.test.ts: ${checks} checks, ${failed} failed`);
if (failed) process.exit(1);
