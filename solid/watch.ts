// native/solid/watch.ts — the desktop's dev loop: `bun solid/main.ts <page>` in a child, its inputs watched, and the
// window restarted when a save changed one. The browser's loop (browser/serve.ts) is the same idea with a page: a save
// picks what to build, a build is a child, and what fails keeps the last good thing running.
//
//   bun solid/watch.ts sky                    # the Sky page, restarted on a save
//   bun solid/watch.ts list --frames 2        # the flags go to main.ts as written (--frames, --png, --warm, --bench)
//   bun solid/watch.ts --png out.png --hold   # headless, and stay up for saves (watch-check.mjs)
//   bun solid/watch.ts --root DIR ...         # watch and run DIR/native instead of this tree (a temp copy)
//
// What a save needs, by what it touched:
//   solid/native/*.c, *.h, *.sh, vendor/clay/*.h   `sh solid/native/build.sh` (build/solid/libui.dylib), then a restart
//   packages/cssints/src/*.ts                     the engine's own build (`bun run build` in packages/cssints), then a restart
//   packages/cssints/dist/*                       a restart: that *is* the engine's build product
//   a .ts/.tsx/.js under solid/, examples/, apps/, focus/, headless/   nothing but the restart
//   anything else (a stored frame, a golden, a scene, this file)       ignored
//
// The page's modules are read once per process (Bun's loader, the cssints plugin, dlopen of libui.dylib), so there is
// no reload in place: a restart is a new process and a new window. The old window is kept until the new process has
// opened *its* window (main.ts prints `window: pixel density N` once SDL has one); a save that fails to load — a broken
// .tsx, a style the cssints plugin rejects — exits first, so the old window keeps drawing and the compiler's error is
// printed here. A `.c` save that fails keeps the old window for the same reason: the running process holds the loaded
// image, whatever cc did to the file.
//
// A headless run (`--png`, `--expect`, `--scene`, `--idle`, `--touch`) is one shot: the child writes its frame and exits,
// so the watcher exits with its status — a suite runs `bun solid/main.ts` itself and never this file. `--hold` keeps it
// up for a headless save loop, where the "last good" thing is the frame already written.
import { existsSync, watch } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";

const PAGES = ["sensors", "widgets", "dialog", "form", "list", "sky", "sheet", "dev"];

const argv = process.argv.slice(2);
let root = resolve(import.meta.dir, "..");
let hold = false;
const rest: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!;
  if (arg === "--root") root = resolve(argv[++i] ?? ".");
  else if (arg === "--hold") hold = true;
  else rest.push(arg);
}
if (!existsSync(join(root, "solid/main.ts"))) {
  console.error(`watch: ${root} is not a native/ tree (no solid/main.ts)`);
  process.exit(1);
}
const page = PAGES.includes(rest[0] ?? "") ? rest.shift()! : "sensors";
const flags = rest;
const oneShot = ["--png", "--expect", "--scene", "--idle", "--touch"].some((name) => flags.includes(name));
const png = flags.includes("--png") ? flags[flags.indexOf("--png") + 1] : undefined;

const log = (line: string) => console.log(`[watch] ${line}`);
const logError = (line: string) => console.error(`[watch] ${line}`);

// --- a child: the page, its lines, and whether it got as far as a window ---------------------------------------------

interface Child {
  readonly proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  /** Resolves true once the page is up (a window, or a headless run that exited 0); false when it failed first. */
  readonly ready: Promise<boolean>;
  readonly out: string[];
  readonly err: string[];
  code?: number;
  stopping: boolean;
}

function launch(): Child {
  const proc = Bun.spawn([process.execPath, join(root, "solid/main.ts"), page, ...flags], {
    cwd: root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const out: string[] = [];
  const err: string[] = [];
  let settle = (_: boolean): void => {};
  const ready = new Promise<boolean>((done) => (settle = done));
  let settled = false;
  const finish = (ok: boolean) => {
    if (!settled) (settled = true), settle(ok);
  };
  const child: Child = { proc, ready, out, err, stopping: false };

  const pump = async (stream: ReadableStream<Uint8Array>, lines: string[], onLine: (line: string) => void) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, at);
        pending = pending.slice(at + 1);
        lines.push(line);
        onLine(line);
      }
    }
    if (pending) lines.push(pending), onLine(pending);
  };
  const streams = [
    pump(proc.stdout, out, (line) => {
      // the window's own line, printed once SDL has a window and before the first frame
      if (/^window: pixel density/.test(line)) finish(true);
    }),
    pump(proc.stderr, err, () => {}),
  ];
  void (async () => {
    await Promise.all(streams);
    child.code = await proc.exited;
    // a headless run is ready when it exits 0; a window that exits before opening one failed
    finish(child.code === 0);
    if (settled && !oneShot && child === current && !child.stopping)
      log(`page exited ${child.code}${child.code ? " (a crash: the next save starts a new one)" : ""}`);
  })();
  return child;
}

/** The lines that say why a child failed: its stderr (a compiler's message is at the top), or its stdout. */
function why(child: Child): string[] {
  const lines = child.err.length ? child.err : child.out;
  return lines.filter((line) => line.trim()).slice(0, 40);
}

function stop(child: Child): void {
  child.stopping = true;
  try {
    child.proc.kill();
  } catch {
    // already gone
  }
  // a window that does not take SIGTERM would stay on screen over the new one
  setTimeout(() => {
    try {
      child.proc.kill(9);
    } catch {
      // already gone
    }
  }, 1_000).unref?.();
}

// --- what a save means -----------------------------------------------------------------------------------------------

type Kind = "dylib" | "engine" | "restart";

const TS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const C = new Set([".c", ".h", ".sh"]);

/** The build a changed file needs, or `null` when it is not a page's input. */
function kindOf(file: string): Kind | null {
  const rel = relative(root, file).split(sep).join("/");
  const ext = extname(file);
  if (rel.startsWith("..")) {
    // the engine, and the app the Sky page imports: both are outside native/, beside it
    if (file.includes("/packages/cssints/src/")) return ext === ".ts" || ext === ".json" ? "engine" : null;
    if (file.includes("/packages/cssints/dist/")) return "restart"; // already the engine's build
    return null;
  }
  if (rel === "solid/watch.ts" || rel === "solid/watch-check.mjs") return null; // the loop itself
  if (rel.startsWith("solid/native/")) return C.has(ext) ? "dylib" : null;
  if (rel.startsWith("solid/")) {
    // the page's sources; the stored frames, goldens, scenes and the tests are not (a save of one is not a page edit)
    if (ext === ".png" || ext === ".json") return null;
    if (/\.test\.ts$|-check\.mjs$|^solid\/test\.sh$/.test(rel)) return null;
    return TS.has(ext) ? "restart" : null;
  }
  if (rel.startsWith("vendor/clay/")) return C.has(ext) ? "dylib" : null;
  // the pages' own imports: examples/sensors/styles.ts, examples/sky's pictures, apps/csssky's api and models, focus/,
  // headless/
  if (/^(examples|apps|focus|headless)\//.test(rel)) return TS.has(ext) || ext === ".png" ? "restart" : null;
  return null;
}

const pending = new Set<Kind>();
const changed = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let busy = false;
let savedAt = 0;
/** The status a one-shot watcher exits with: its last page's, or 1 when the last save failed. */
let status = 0;

function queue(file: string): void {
  const kind = kindOf(file);
  if (!kind) return;
  pending.add(kind);
  changed.add(relative(root, file) || file);
  savedAt ||= performance.now();
  schedule();
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, 80);
}

// --- a build ----------------------------------------------------------------------------------------------------------

async function run(cmd: string[], cwd: string): Promise<{ ok: boolean; ms: number; error: string }> {
  const start = performance.now();
  const child = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  // both pipes at once: a child that fills the one nobody reads blocks, and so would this watcher
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const code = await child.exited;
  return {
    ok: code === 0,
    ms: Math.round(performance.now() - start),
    error: (stderr.trim() || stdout.trim() || `exit ${code}`).trim(),
  };
}

/** Where the last good thing is, for a failure's line: the window that is still up, or the frame already written. */
const keeping = (): string =>
  oneShot
    ? `; keeping the last good frame${png ? ` ${png}` : ""}`
    : current && current.code === undefined
      ? `; keeping the last good window (pid ${current.proc.pid})`
      : "; no window yet: a fixed save starts one";

// --- the restart ------------------------------------------------------------------------------------------------------

let current: Child | undefined;
let starting: Child | undefined;

async function restart(): Promise<boolean> {
  const start = performance.now();
  const next = launch();
  starting = next;
  const ok = await next.ready;
  starting = undefined;
  if (!ok) {
    log(`restart failed after ${Math.round(performance.now() - start)} ms${keeping()}`);
    for (const line of why(next)) logError(`  ${line}`);
    return false;
  }
  // only now: until the new page has a window of its own, the old one is what the screen shows
  if (current) stop(current);
  current = next;
  const ms = Math.round(performance.now() - start);
  if (oneShot) log(`page ${ms} ms (headless${png ? `: ${png}` : ""})`);
  else log(`restart ${ms} ms (a new window)`);
  // the loop's own number: the save's timestamp to here (a start is not a save)
  if (savedAt) log(`save -> ${oneShot ? "the frame" : "the first frame"} ${Math.round(performance.now() - savedAt)} ms`);
  savedAt = 0;
  return true;
}

async function flush(): Promise<void> {
  if (busy) return; // the running flush calls back when it is done
  const kinds = [...pending];
  pending.clear();
  const whyChanged = [...changed].join(", ");
  changed.clear();
  if (!kinds.length) return;
  busy = true;
  try {
    log(`save ${whyChanged}`);
    if (kinds.includes("dylib")) {
      const built = await run(["sh", "solid/native/build.sh"], root);
      if (!built.ok) {
        log(`build dylib failed after ${built.ms} ms${keeping()}`);
        for (const line of built.error.split("\n").slice(0, 24)) logError(`  ${line}`);
        savedAt = 0;
        status = 1;
        return;
      }
      log(`build dylib ${built.ms} ms`);
    }
    if (kinds.includes("engine")) {
      const engine = join(root, "..", "packages/cssints");
      if (!existsSync(join(engine, "package.json"))) log("build engine: no packages/cssints beside this tree, skipped");
      else {
        const built = await run([process.execPath, "run", "build"], engine);
        if (!built.ok) {
          log(`build engine failed after ${built.ms} ms${keeping()}`);
          for (const line of built.error.split("\n").slice(0, 24)) logError(`  ${line}`);
          savedAt = 0;
          status = 1;
          return;
        }
        log(`build engine ${built.ms} ms`);
      }
    }
    status = (await restart()) ? (current?.code ?? 0) : 1;
  } finally {
    busy = false;
    if (pending.size) schedule();
    else if (oneShot && !hold) process.exit(status);
  }
}

// --- the watch --------------------------------------------------------------------------------------------------------

const watched: string[] = [
  join(root, "solid"),
  join(root, "examples"),
  join(root, "apps"),
  join(root, "focus"),
  join(root, "headless"),
  join(root, "vendor/clay"),
  join(root, "..", "packages/cssints/src"),
  join(root, "..", "packages/cssints/dist"),
];
for (const dir of watched) {
  if (!existsSync(dir)) continue; // a --root copy may have no packages/ or apps/ beside it
  try {
    watch(dir, { recursive: true }, (_event, file) => {
      if (file) queue(join(dir, file));
    });
  } catch (error) {
    logError(`watch ${dir}: ${error}`);
  }
}

const bye = (): void => {
  for (const child of [starting, current]) if (child) try {
    child.proc.kill();
  } catch {
    // already gone
  }
  process.exit(0);
};
process.on("SIGINT", bye);
process.on("SIGTERM", bye);

log(`watching solid/, examples/, apps/, focus/, headless/, vendor/clay/, packages/cssints/{src,dist}`);
log(`page ${page}: ${[process.execPath, join(root, "solid/main.ts"), page, ...flags].join(" ")}`);

if (!(await restart()) && oneShot && !hold) process.exit(1);
else if (oneShot && !hold) process.exit(current?.code ?? 0);

