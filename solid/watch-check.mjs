// native/solid/watch-check.mjs — solid/watch.ts, the desktop's dev loop, driven: the first frame, a style save that
// restarts it, a broken save that keeps the last good frame, and what each kind of save does and does not rebuild.
//
// The check never touches this tree: it copies the repo into a temp directory (every node_modules is symlinked back here,
// so solid-js, @solidjs/compiler and the apps' deps resolve as they do here) and starts the watcher with `--root` on the
// copy, so every save below is a write into the copy. The watcher runs headless (`--png out.png --warm 30`, the settled
// frame the stored ones are taken at) and stays up for saves (`--hold`). It asserts:
//
//   (a) the first frame is the Sensors page's: 360x360, the page's background at 0,0 and the pill's surface at 100,247
//       (36,40,52), the two pixels `solid/test.ts` holds.
//   (b) a style save (examples/sensors/styles.ts, the pill's surface colour) is a restart and no build: the lines say
//       `save -> the frame N ms` and no `build dylib`/`build engine`, the png is written again, and 100,247 is the new
//       colour.
//   (c) a broken style save prints the compiler's error and keeps the last good frame: the png's mtime does not move and
//       100,247 is still (b)'s colour; the fixed save is a frame again.
//   (d) a `.c` save rebuilds build/solid/libui.dylib (its mtime moves) and then restarts; the frame is still the page's.
//   (e) a `.tsx`-only save rebuilds neither the dylib nor the engine (both mtimes stand, no build line) — only the page.
//
// How a PNG is read: through the tree's own libui.dylib (`ui_load_png`/`ui_png_copy`, SDL_image), so the check needs no
// decoder of its own and no window. Run from solid/test.sh, after `sh solid/native/build.sh`; skips (with a message) when
// bun, the dylib or a graphics stack is missing. It is `bun solid/watch-check.mjs`, not node: bun:ffi.
//
//   bun solid/watch-check.mjs
import { dlopen, FFIType as T, ptr } from "bun:ffi";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NATIVE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(NATIVE, "..");
const DYLIB = join(NATIVE, "build/solid/libui.dylib");
// a restart loads a page (and its cssints child) in this; the machine can be under a load of 100
const BOUND = 300_000;

if (!existsSync(DYLIB)) {
  console.log(`solid/watch: no ${DYLIB}, skipped (sh solid/native/build.sh)`);
  process.exit(0);
}

let failures = 0;
const ok = (name, extra = "") => console.log(`ok   ${name}${extra ? " — " + extra : ""}`);
const bad = (name, why) => {
  failures++;
  console.log(`FAIL ${name}: ${why}`);
};

// --- pixels of a PNG, through this tree's own SDL_image ------------------------------------------------

const png = dlopen(DYLIB, {
  ui_load_png: { args: [T.cstring], returns: T.i32 },
  ui_png_size: { args: [T.ptr], returns: T.i32 },
  ui_png_copy: { args: [T.ptr, T.i32], returns: T.i32 },
}).symbols;
function frame(file) {
  if (png.ui_load_png(Buffer.from(`${file}\0`)) !== 0) throw new Error(`${file} did not load as a PNG`);
  const size = new Int32Array(2);
  if (!png.ui_png_size(size)) throw new Error(`${file}: no size`);
  const [w, h] = size;
  const bytes = new Uint8Array(w * h * 4);
  if (png.ui_png_copy(ptr(bytes), bytes.length) !== bytes.length) throw new Error(`${file}: ${w}x${h}, copied short`);
  return {
    w,
    h,
    at: (x, y) => Array.from(bytes.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)),
  };
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// --- the tree the watcher runs, a temp copy of the repo --------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), "cssints-watch-check-"));
const repo = join(dir, "repo");
const root = join(repo, "native");
const skip = (src) =>
  !src.split(/[\\/]/).includes("node_modules") &&
  !src.split(/[\\/]/).includes(".git") &&
  !src.endsWith(".DS_Store");
cpSync(REPO, repo, { recursive: true, filter: skip });
// every node_modules of this tree, back where the copy expects it (native's solid-js and @solidjs/compiler, the apps'
// @atcute): a copy of the sources, and the dependencies of the machine
const linkModules = (rel) => {
  const from = join(REPO, rel, "node_modules");
  if (!existsSync(from)) return;
  symlinkSync(from, join(repo, rel, "node_modules"), "dir");
};
const walk = (rel, depth) => {
  linkModules(rel);
  if (depth === 2) return;
  for (const entry of readdirSync(join(REPO, rel), { withFileTypes: true }))
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git")
      walk(rel ? `${rel}/${entry.name}` : entry.name, depth + 1);
};
walk("", 0);

const nativeText = (rel) => readFileSync(join(NATIVE, rel), "utf8");
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const styles = join(root, "examples/sensors/styles.ts");
const sensors = join(root, "solid/app/Sensors.tsx");
const uiC = join(root, "solid/native/ui.c");
const dylib = join(root, "build/solid/libui.dylib");
const out = join(dir, "out.png");
// the two pixels solid/test.ts reads: the page's background, and the Units pill's surface with the pointer away
const PAGE = [16, 18, 24, 255];
const SURFACE = [36, 40, 52, 255];
const NEW = [200, 30, 200, 255];
const styleGood = nativeText("examples/sensors/styles.ts");
const styleNew = styleGood.replace('surface: { $value: "rgb(36 40 52)" }', 'surface: { $value: "rgb(200 30 200)" }');
const sensorGood = nativeText("solid/app/Sensors.tsx");
const uiGood = nativeText("solid/native/ui.c");
const hashBefore = hash(join(NATIVE, "examples/sensors/styles.ts"));

// --- the watcher, its lines, and a line's arrival --------------------------------------------------------

const watcher = spawn(
  "bun",
  [
    join(root, "solid/watch.ts"),
    "--root",
    root,
    "sensors",
    "--warm",
    "30",
    "--png",
    out,
    "--hold",
  ],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
const lines = [];
const waiters = new Set();
const exitWaiters = new Set();
function feed(line) {
  lines.push(line);
  console.log(`  | ${line}`);
  for (const waiter of [...waiters]) waiter(line);
}
for (const stream of [watcher.stdout, watcher.stderr]) {
  stream.setEncoding("utf8");
  let pending = "";
  stream.on("data", (chunk) => {
    pending += chunk;
    let at;
    while ((at = pending.indexOf("\n")) >= 0) {
      feed(pending.slice(0, at));
      pending = pending.slice(at + 1);
    }
  });
}
const exited = new Promise((done) => watcher.on("exit", (code) => done(code)));
// a watcher that dies while a line is awaited (a crash, a kill) fails the wait now, not at the bound
watcher.on("exit", (code) => {
  for (const fail of [...exitWaiters]) fail(new Error(`the watcher exited (${code}) before the line`));
});

/** A line matching `re` that arrives from `from` on. */
function waitLine(re, ms = BOUND, from = lines.length) {
  return new Promise((done, fail) => {
    for (const line of lines.slice(from)) {
      const match = re.exec(line);
      if (match) return done(match);
    }
    const waiter = (line) => {
      const match = re.exec(line);
      if (match) {
        clearTimeout(timer);
        waiters.delete(waiter);
        exitWaiters.delete(onExit);
        done(match);
      }
    };
    const onExit = (error) => {
      clearTimeout(timer);
      waiters.delete(waiter);
      fail(error);
    };
    const timer = setTimeout(() => {
      waiters.delete(waiter);
      exitWaiters.delete(onExit);
      fail(new Error(`no line /${re.source}/ within ${ms} ms`));
    }, ms);
    waiters.add(waiter);
    exitWaiters.add(onExit);
  });
}

/** A save, and the lines from it to its `expect` line: what the loop built, and how long the frame took. */
async function save(file, text, expect) {
  const at = lines.length;
  const t0 = performance.now();
  writeFileSync(file, text);
  const line = await waitLine(expect, BOUND, at);
  const built = lines.slice(at).filter((l) => l.includes("[watch] build ") || l.includes("keeping"));
  return { line, built, at, ms: Math.round(performance.now() - t0) };
}

async function main() {
  const start = await waitLine(/page (\d+) ms \(headless/, BOUND, 0);
  console.log(`info first frame ${start[1]} ms`);
  const first = frame(out);
  if (first.w !== 360 || first.h !== 360) bad("the first frame's size", `${first.w}x${first.h}, not 360x360`);
  if (!same(first.at(0, 0), PAGE)) bad("the first frame's page", `0,0 is ${first.at(0, 0)}, not ${PAGE}`);
  if (!same(first.at(100, 247), SURFACE))
    bad("the first frame's pill", `100,247 is ${first.at(100, 247)}, not ${SURFACE}`);
  else ok("the first frame is the Sensors page's", `360x360, page ${PAGE}, the pill ${SURFACE}`);

  // (a) a style save: a restart, no build, the new colour on the page
  const mtime0 = statSync(out).mtimeMs;
  const styled = await save(styles, styleNew, /save -> the frame (\d+) ms/);
  if (statSync(out).mtimeMs === mtime0) bad("a style save writes a new frame", "out.png was not written again");
  const built = styled.built.filter((l) => l.includes("[watch] build "));
  if (built.length) bad("a style save is a restart only", `it built: ${built.join("; ")}`);
  else ok("a style save is a restart only", "no dylib and no engine build");
  if (!same(frame(out).at(100, 247), NEW))
    bad("a style save's frame", `100,247 is ${frame(out).at(100, 247)}, not the new ${NEW}`);
  else ok("a style save's frame", `100,247 is ${NEW}, the new surface`);
  console.log(`info a style save: the frame ${styled.ms} ms after the save (the loop's own ${styled.line[1]} ms)`);

  // (b) a broken style save: the compiler's error, and the last good frame stands
  const goodMtime = statSync(out).mtimeMs;
  const brokenSave = await save(
    styles,
    `${styleNew}\nexport const broken = css.width("watch-check-broken");\n`,
    /restart failed after (\d+) ms; keeping the last good frame/,
  );
  // the failure line comes first and the compiler's text after it
  const reported = await waitLine(/watch-check-broken/, 20_000, brokenSave.at).catch(() => null);
  if (!reported) bad("a broken save says why", "no line names watch-check-broken");
  else if (!lines.some((l) => l.includes("styles.ts"))) bad("a broken save says why", "no line names styles.ts");
  else ok("a broken save says why", reported[0].replace(/^\[watch\]\s*/, "").slice(0, 120));
  if (statSync(out).mtimeMs !== goodMtime || !same(frame(out).at(100, 247), NEW))
    bad("a broken save keeps the last good frame", "out.png moved or changed");
  else ok("a broken save keeps the last good frame", "out.png is the last good one");

  // the fixed save: a frame again, and the colour is (a)'s
  const fixed = await save(styles, styleNew, /save -> the frame (\d+) ms/);
  if (statSync(out).mtimeMs === goodMtime) bad("the fixed save's frame", "out.png was not written");
  else if (!same(frame(out).at(100, 247), NEW))
    bad("the fixed save's colour", `${frame(out).at(100, 247)}, not ${NEW}`);
  else ok("the fixed save's frame", `100,247 is ${NEW} again`);
  console.log(`info the fixed save: the frame ${fixed.ms} ms after the save`);

  // (c) a .c save: the dylib is rebuilt (its mtime), then the page restarts
  const dylibBefore = statSync(dylib).mtimeMs;
  const c = await save(uiC, `${uiGood}\n/* watch-check: a .c save */\n`, /save -> the frame (\d+) ms/);
  if (!c.built.some((l) => /\[watch\] build dylib \d+ ms/.test(l)))
    bad("a .c save rebuilds the dylib", `its lines are ${JSON.stringify(c.built)}`);
  if (statSync(dylib).mtimeMs === dylibBefore)
    bad("a .c save rebuilds the dylib", "libui.dylib's mtime did not move");
  else ok("a .c save rebuilds the dylib", `libui.dylib ${dylibBefore} -> ${statSync(dylib).mtimeMs}`);
  if (!same(frame(out).at(0, 0), PAGE)) bad("a .c save's frame", `0,0 is ${frame(out).at(0, 0)}`);
  else ok("a .c save's frame", "the page is drawn again after the rebuild");
  console.log(`info a .c save: the frame ${c.ms} ms after the save`);

  // (d) a .tsx-only save: neither build, only the page
  const dylibStand = statSync(dylib).mtimeMs;
  const engineDist = join(repo, "packages/cssints/dist");
  const distStand = existsSync(engineDist) ? statSync(engineDist).mtimeMs : 0;
  const tsx = await save(sensors, `${sensorGood}\n// watch-check: a .tsx save\n`, /save -> the frame (\d+) ms/);
  if (tsx.built.some((l) => l.includes("[watch] build "))) bad("a .tsx save builds nothing", tsx.built.join("; "));
  else ok("a .tsx save builds nothing", "no dylib, no engine");
  if (statSync(dylib).mtimeMs !== dylibStand) bad("a .tsx save leaves the dylib", "libui.dylib's mtime moved");
  if (distStand && statSync(engineDist).mtimeMs !== distStand) bad("a .tsx save leaves the engine", "dist's mtime moved");
  if (!same(frame(out).at(100, 247), NEW)) bad("a .tsx save's frame", `100,247 is ${frame(out).at(100, 247)}`);
  else ok("a .tsx save's frame", "the page is the one before it");
  console.log(`info a .tsx save: the frame ${tsx.ms} ms after the save`);
}

main().then(
  async () => {
    watcher.kill("SIGTERM");
    const code = await exited;
    // the watcher's own children go with it: nothing of the copy may be left running
    await new Promise((done) => setTimeout(done, 400));
    for (const name of ["solid/main.ts", "solid/watch.ts"]) {
      const found = Bun.spawnSync(["/usr/bin/pgrep", "-fl", join(root, name)]).stdout.toString().trim();
      if (found) bad("no stray process", `${name}: ${found.split("\n")[0]}`);
    }
    if (code !== 0 && code !== null) bad("the watcher's exit", `it exited ${code} on SIGTERM`);
    if (hash(join(NATIVE, "examples/sensors/styles.ts")) !== hashBefore)
      bad("the check touches no tracked file", "the worktree's styles.ts changed");
    else ok("the check touches no tracked file", "every save was a write into the copy");
    rmSync(dir, { recursive: true, force: true });
    if (failures) {
      console.log(`${failures} failure(s)`);
      process.exit(1);
    }
    console.log("solid/watch: ok");
    process.exit(0);
  },
  async (error) => {
    console.log(`FAIL watch-check: ${error.message}`);
    watcher.kill("SIGTERM");
    await exited;
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  },
);

