// A figure as a raster, through the **desktop host**: not a second drawer. `solid/main.ts` already writes a figure's
// frame headless (`figure --spec … --warm 30 --png out.png`), and its `--density` is the window's pixel density — the
// same layout drawn into that many more pixels — so a 2× PNG is that flag and nothing else. This file is the wrapper:
// one child process of `bun solid/main.ts`, the spec and the destination passed through, and its exit status and
// stderr handed back as this call's failure.
//
// Why a child and not the `capture` the tests use (`solid/dump.ts`): `capture` returns the frame as commands, not as
// pixels — it never draws — so a PNG needs the draw and the encode, which is `main.ts`'s headless path. The two share
// the page, the layout and the size (`sizeOf`), so the raster is the same figure the tests' frames are.
//
// The layout is in cells: a figure's width is `cells * 8` and its height `cells * 16`. At density 2 the file is
// exactly twice that in each direction (the same layout, twice the pixels), and `--warm 30` is the page at rest — the
// still, not the entry animation's first frame.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/** The native tree: `solid/main.ts` is the host, and a run from anywhere resolves it here. */
const NATIVE = new URL("../../../../", import.meta.url).pathname;

export interface PngOptions {
  /** The raster's density: 1 is the layout's pixels, 2 is the Retina one (`capture`'s density), and it is the size. */
  readonly scale?: number;
}

/** The Bun that runs this process: the host needs Bun's FFI, and a `bun solid/figure.ts` run is the one that has it. */
const bun = (): string => process.env.BUN ?? process.execPath;

/**
 * Writes one spec's frame to `out` at `scale` and returns the host's stderr (empty on success). A spec that is invalid
 * is refused by the host with `check`'s sentences; the caller has already validated it, so that is a real failure here.
 */
export function png(specPath: string, out: string, options: PngOptions = {}): { ok: boolean; message: string } {
  const scale = options.scale ?? 2;
  const run = spawnSync(
    bun(),
    [
      resolve(NATIVE, "solid/main.ts"),
      "figure",
      "--spec",
      resolve(specPath),
      "--warm",
      "30",
      "--density",
      String(scale),
      "--png",
      resolve(out),
    ],
    { cwd: NATIVE, encoding: "utf8" },
  );
  if (run.error) return { ok: false, message: `cannot run ${bun()}: ${run.error.message}` };
  const message = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
  return run.status === 0 ? { ok: true, message } : { ok: false, message: message || `exit ${run.status}` };
}
