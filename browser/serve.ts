// native/browser/serve.ts — the browser target's dev server: build both artefacts, serve browser/ and them at one origin,
// rebuild what a save changed, and reload the open pages.
//
//   bun browser/serve.ts                  # http://127.0.0.1:4173/browser/solid/index.html (Sensors)
//   bun browser/serve.ts --port 0 --open  # a free port, and the browser opened on the page
//   bun browser/serve.ts --root DIR       # build and serve DIR instead of native/ (serve-check's temp copy)
//
// The two builds are the scripts beside this one, run as children rather than restated here: `sh browser/build.sh <out>`
// (zig cc: page.wasm, ui.wasm, and the generated styles.h) and `bun browser/solid/build.ts <out>/solid` (Bun.build: one
// bundle a page). A save's path and extension say which one it is: a `.c`/`.h`/`.sh` is the wasm, a `.ts`/`.tsx`/`.jsx`
// is the bundles, a change under packages/cssints/dist is both (the plugin compiles styles in both), and a `.js`/`.html`
// is no build at all, only a reload. Each build writes into a staging directory and is copied over the served one — by
// rename, so a fetch never sees half a file — only when the child exits 0: a broken save leaves the last good artefact
// in place, the running page keeps it (it is not reloaded), and the failure goes out as an `error` event, which the
// injected client shows in a bar at the bottom of the page and logs to the console.
//
// A successful build pushes one of two events. `hot` — the bundles only, so a page a save can keep — asks a page that
// opted in (browser/solid/shell.ts's `options.hot`, i.e. `window.__hotSwap`) to import its bundle again at a new version
// and take the page's place without navigating: the shell's host (canvas, wasm, pointer, DOM listeners) stays and the
// page's tree is replaced, so the shell's state survives and the page's does not. `reload` is `location.reload()`: the
// wasm was rebuilt (a new `WebAssembly.Instance`, which cannot be hot), both were (styles are compiled into both), or the
// html moved. Nothing here knows a module graph: a style change is a new bundle module, not a patchable string, so real
// style patching and true state-preserving HMR (a component's signals kept) still need the engine's own cssints/vite
// plugin and Vite's client in this path, as apps/docs has them; the desktop (`bun solid/main.ts`) has no watcher at all
// and is restarted by hand.
//
// The page-side client is injected into every text/html response, so browser/solid/*.html stay untouched. The event
// stream is one `text/event-stream` per page at /__events, no dependency: `retry: 500`, a `hot` or a `reload` with the
// kind and ms, an `error` with the compiler's own text, and a ping every 20 s so a proxy does not close it.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, watch } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

const argv = process.argv.slice(2);
const option = (name: string, fallback?: string): string | undefined => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : fallback;
};
const root = resolve(option("--root", join(import.meta.dir, ".."))!);
if (!existsSync(join(root, "browser/build.sh"))) {
  console.error(`serve: ${root} is not a native/ tree (no browser/build.sh)`);
  process.exit(1);
}
const port = Number(option("--port", "4173"));
const open = argv.includes("--open");

// The staging directory a build writes into and the live one the server reads: one mkdtemp each run, so a dev server
// never leaves a build product in the repo and a second one cannot stamp on it.
const base = mkdtempSync(join(tmpdir(), "cssints-serve-"));
const live = join(base, "live");
const next = join(base, "next");
mkdirSync(join(live, "solid"), { recursive: true });
mkdirSync(join(next, "solid"), { recursive: true });

const log = (line: string) => console.log(`[serve] ${line}`);
const logError = (line: string) => console.error(`[serve] ${line}`);

/** One child, its output, and how long it took. A build's stdout is quiet; its stderr is what a failure says. */
async function run(cmd: string[]): Promise<{ ok: boolean; ms: number; error: string }> {
  const t0 = performance.now();
  const child = Bun.spawn(cmd, { cwd: root, stdout: "pipe", stderr: "pipe" });
  // both pipes at once: a child that fills the one we are not reading blocks, and so would we
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const code = await child.exited;
  return {
    ok: code === 0,
    ms: Math.round(performance.now() - t0),
    error: (stderr.trim() || stdout.trim() || `exit ${code}`).trim(),
  };
}

/** The files a build made, from staging over the served copy, each one renamed into place (`next/x` -> `live/x`). */
function publish(kind: "wasm" | "bundles"): void {
  const files =
    kind === "wasm"
      ? ["page.wasm", "ui.wasm"]
      : readdirSync(join(next, "solid"))
          .filter((name) => name.endsWith(".js"))
          .map((name) => `solid/${name}`);
  for (const file of files) {
    const to = join(live, file);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(next, file), `${to}.tmp`);
    renameSync(`${to}.tmp`, to);
  }
}

// The build's version, bumped when new files are published: a hot re-mount imports the bundle at `?v=<version>`, so the
// browser's module cache never hands back the copy it has.
let version = 0;

async function build(kind: "wasm" | "bundles"): Promise<{ ok: boolean; ms: number }> {
  const result =
    kind === "wasm"
      ? await run(["sh", "browser/build.sh", next])
      : await run(["bun", "browser/solid/build.ts", join(next, "solid")]);
  if (!result.ok) {
    log(`build failed: ${kind} after ${result.ms} ms`);
    for (const line of result.error.split("\n").slice(0, 60)) logError(`  ${line}`);
    send("error", `build failed (${kind}): ${result.error.slice(0, 6000)}`);
    return { ok: false, ms: result.ms };
  }
  publish(kind);
  version++;
  log(`build ${kind} ${result.ms} ms`);
  return { ok: true, ms: result.ms };
}

// --- the event stream -----------------------------------------------------------------------------------------------

interface Client {
  readonly push: (event: string, data: string) => void;
  readonly close: () => void;
}
const clients = new Set<Client>();

function send(event: string, data: string): void {
  for (const client of clients) client.push(event, data);
}

/** One page's stream: `retry: 500`, then the server's events. A closed page's stream is dropped on `cancel`. */
function stream(): Response {
  const encoder = new TextEncoder();
  let stop = (): void => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const client: Client = {
        push: (event, data) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data.replaceAll("\n", "\ndata: ")}\n\n`));
          } catch {
            clients.delete(client);
          }
        },
        close: () => clients.delete(client),
      };
      clients.add(client);
      stop = client.close;
      controller.enqueue(encoder.encode("retry: 500\n\n"));
    },
    cancel() {
      stop();
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" },
  });
}

setInterval(() => {
  for (const client of clients) client.push("ping", "");
}, 20_000).unref?.();

// --- the watch ------------------------------------------------------------------------------------------------------

type Kind = "wasm" | "bundles" | "both" | "reload";

/** What a changed file means, by the build that reads it; `null` is not an input of either build. */
function kindOf(file: string): Kind | null {
  const rel = relative(root, file).split(sep).join("/");
  // outside this tree: packages/cssints/dist (both builds read it through the cssints plugin) and apps/ (the Sky page
  // imports apps/csssky's api and models)
  if (rel.startsWith("..")) {
    const ext = extname(file);
    if (file.includes("/packages/cssints/dist/")) return "both";
    if (file.includes("/apps/") && (ext === ".ts" || ext === ".tsx" || ext === ".jsx")) return "bundles";
    return null;
  }
  if (rel === "browser/serve.ts") return null; // the server itself: restart, not rebuild
  if (rel.startsWith("desktop/")) return rel === "desktop/clay_dump.c" ? "wasm" : null;
  const ext = extname(file);
  if (rel.startsWith("solid/")) return ext === ".ts" || ext === ".tsx" || ext === ".jsx" ? "bundles" : null;
  if (rel.startsWith("browser/")) {
    if (ext === ".c" || ext === ".h" || ext === ".sh") return "wasm";
    if (ext === ".ts" || ext === ".tsx") return "bundles";
    if (ext === ".mjs" || ext === ".map") return null; // the checks and a bundle's map, not a page's input
    return "reload";
  }
  // styles.h's generator, Clay's headers, and the Sensors page's styles (the C page's styles.h and the Solid page's
  // styles in one file) are the wasm's inputs; styles.ts is also a bundle's
  if (rel === "examples/sensors/styles.ts") return "both";
  if (rel.startsWith("generator/") || rel.startsWith("vendor/clay/") || rel.startsWith("examples/sensors/"))
    return ext === ".c" || ext === ".h" || ext === ".ts" ? "wasm" : null;
  return null;
}

// ponytail: any .ts save rebuilds all eight bundles; map a source to its entry point when a single page's save must be
// under a second (today a save is the whole Bun.build, ~0.4 s a bundle with the cssints children in it).
const pending = new Set<Kind>();
const changed = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let building = false;

function queue(file: string): void {
  const kind = kindOf(file);
  if (!kind) return;
  pending.add(kind);
  changed.add(relative(root, file));
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, 80);
}

async function flush(): Promise<void> {
  if (building) return; // the running build's `finally` calls back
  const kinds = [...pending];
  pending.clear();
  const why = [...changed].join(", ");
  changed.clear();
  if (!kinds.length) return;
  building = true;
  try {
    if (kinds.every((kind) => kind === "reload")) {
      log(`reload ${why}`);
      send("reload", `reload ${why}`);
      return;
    }
    let ok = true;
    let ms = 0;
    if (kinds.includes("both")) {
      const w = await build("wasm");
      const b = w.ok ? await build("bundles") : { ok: false, ms: 0 };
      ok = w.ok && b.ok;
      ms = w.ms + b.ms;
    } else {
      // the wasm first, and the bundles only if it did not fail: a page reloaded onto half a build is worse than none
      for (const kind of ["wasm", "bundles"] as const) {
        if (!kinds.includes(kind)) continue;
        const built = await build(kind);
        ok = built.ok;
        ms += built.ms;
        if (!ok) break;
      }
    }
    if (!ok) return;
    // the bundles alone can be a hot re-mount; anything the wasm is in is a reload (a new instance is a new page)
    if (kinds.length === 1 && kinds[0] === "bundles") {
      log(`hot ${why} (v${version})`);
      send("hot", JSON.stringify({ v: version, why, ms }));
    } else {
      log(`reload ${why}`);
      send("reload", `${kinds.join("+")} ${why}`);
    }
  } finally {
    building = false;
    if (pending.size) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void flush();
      }, 80);
    }
  }
}

const watched: Array<[string, boolean]> = [
  [join(root, "browser"), true],
  [join(root, "solid"), true],
  [join(root, "desktop"), false],
  [join(root, "vendor/clay"), true],
  [join(root, "generator"), true],
  [join(root, "examples/sensors"), true],
  [join(root, "..", "apps"), true],
  [join(root, "..", "packages/cssints/dist"), true],
];
for (const [dir, recursive] of watched) {
  if (!existsSync(dir)) continue; // a --root copy has no packages/ beside it
  try {
    watch(dir, { recursive }, (_event, file) => {
      if (file) queue(join(dir, file));
    });
  } catch (error) {
    logError(`watch ${dir}: ${error}`);
  }
}

// --- the server -----------------------------------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".json": "application/json",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
};

/** The page-side client: the hot re-mount or the reload, and a build's failure as a bar (and the console), in one stream. */
const CLIENT = `<script>
(() => {
  const bar = (text) => {
    let el = document.getElementById("__serve-error");
    if (!el) {
      el = document.createElement("pre");
      el.id = "__serve-error";
      el.style.cssText = "position:fixed;inset:auto 0 0 0;margin:0;padding:10px 14px;background:#5b1212;" +
        "color:#ffd7d7;font:12px/1.45 ui-monospace,monospace;white-space:pre-wrap;max-height:40vh;overflow:auto;" +
        "z-index:2147483647";
      document.body.appendChild(el);
    }
    el.textContent = text;
  };
  const clear = () => document.getElementById("__serve-error")?.remove();
  const events = new EventSource("/__events");
  events.addEventListener("reload", () => location.reload());
  // A bundle-only save: a page that opted in (browser/solid/shell.ts sets window.__hotSwap) imports its bundle again at
  // the new version and the shell swaps the page's tree without navigating — the canvas, the wasm, the pointer and the
  // document stay. A page that did not (Field's own listeners, Sky's own loop) reloads, as before.
  events.addEventListener("hot", async (event) => {
    clear();
    let data;
    try { data = JSON.parse(event.data); } catch { location.reload(); return; }
    if (typeof window.__hotSwap !== "function") { location.reload(); return; }
    try {
      await window.__hotSwap(data.v);
      console.info("hot: " + data.why + " in " + data.ms + " ms");
    } catch (error) {
      // the old page is still on the canvas: the new module's tree threw before the shell took it
      const text = "hot failed: " + (error && error.message ? error.message : String(error));
      console.error(text);
      bar(text);
    }
  });
  // a lost connection is an Event with no data; the server's failure is a MessageEvent that carries the compiler's text
  events.addEventListener("error", (event) => {
    const text = event.data;
    if (typeof text === "string" && text) {
      console.error(text);
      bar(text);
    }
  });
})();
</script>`;

/** A URL path to the file it serves: the build products first, then the tree itself. */
function mapped(pathname: string): string {
  const path = pathname === "/" ? "/browser/solid/index.html" : decodeURIComponent(pathname);
  if (path === "/browser/page.wasm") return join(live, "page.wasm");
  if (path === "/browser/solid/ui.wasm") return join(live, "ui.wasm");
  const bundle = /^\/browser\/solid\/([\w.-]+\.js)$/.exec(path);
  if (bundle) return join(live, "solid", bundle[1]!);
  const file = resolve(root, "." + path);
  // the tree, and nothing above it
  return file.startsWith(root + sep) ? file : "";
}

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  // the event stream is idle between builds; Bun's 10 s default would close it
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__events") return stream();
    const file = mapped(url.pathname);
    if (!file || !existsSync(file)) return new Response(`serve: not found: ${url.pathname}\n`, { status: 404 });
    const type = MIME[extname(file)] ?? "application/octet-stream";
    const headers = { "content-type": type, "cache-control": "no-store" };
    if (type.startsWith("text/html")) {
      const html = await Bun.file(file).text();
      const at = html.lastIndexOf("</body>");
      const body = at < 0 ? html + CLIENT : html.slice(0, at) + CLIENT + "\n" + html.slice(at);
      return new Response(body, { headers });
    }
    return new Response(Bun.file(file), { headers });
  },
});

log(`artefacts ${live}`);
log(`watched browser/, solid/, desktop/clay_dump.c, vendor/clay/, generator/, examples/sensors/, apps/, packages/cssints/dist`);

const first = performance.now();
const builtWasm = await build("wasm");
const builtBundles = builtWasm.ok ? await build("bundles") : { ok: false, ms: 0 };
const ok = builtWasm.ok && builtBundles.ok;
log(`first build ${Math.round(performance.now() - first)} ms${ok ? "" : " (failed; serving what is there, and a fixed save rebuilds)"}`);

const url = `http://127.0.0.1:${server.port}/browser/solid/index.html`;
log(`listening ${url}`);
log(`pages: index.html (Sensors), widgets.html, sky.html, dialog.html, list.html, field.html, dev.html, sheet.html`);
if (open) {
  const command = process.platform === "darwin" ? ["open", url] : ["xdg-open", url];
  Bun.spawn(command, { stdio: ["ignore", "ignore", "ignore"] });
}
