// The Solid pages' bundles, for the browser: browser/solid/page.ts (Sensors), browser/solid/widgets.ts (the Widgets page,
// which takes keys), browser/solid/console.ts (the Sensors page printed as cells) and the desktop's own modules, compiled
// by Bun. A bundle an entry point: each has its own copy of the firmware it shares (the shell, the renderer, Clay's
// binding), because a page loaded alone should need nothing from another's; the shared code is one source, not one chunk.
//
//   bun browser/solid/build.ts [out.directory]   -> <out>/page.js and <out>/widgets.js (default ${TMPDIR:-/tmp}/cssints-native-web/solid)
//
// The loaders are the desktop's (solid/plugin.ts): a `.tsx` through @solidjs/compiler's universal transform, a
// `styles.ts` through the cssints plugin in a Node child (compile-styles.ts), and a `.tsx` that declares its own styles
// through compile.tsx.ts. They are restated here rather than imported because `plugin()` from "bun" registers a
// *runtime* loader and Bun.build does not take a registered plugin; the children are the same files. On top, one
// resolution: src/frame.ts's `./ffi.ts` (bun:ffi) is browser/solid/ffi-browser.ts, the wasm's binding.
import { transform } from "@solidjs/compiler";
import { dirname, join, resolve } from "node:path";

const here = import.meta.dir;
const root = resolve(here, "../.."); // native/
const outdir = process.argv[2] ?? join(process.env.TMPDIR ?? "/tmp", "cssints-native-web/solid");

const renderer = join(root, "solid/src/renderer.ts");
const compileStyles = join(root, "solid/compile-styles.ts");
const compileTsx = join(root, "solid/compile.tsx.ts");
// solid-js's package map gives Bun's runtime the server build (its `node` condition), which the desktop's plugin then
// redirects to the client one; the bundler's `browser` condition already picks dist/solid.js, so no redirect is needed.

const ffi = join(here, "ffi-browser.ts");
// solid-js's package map gives a bundler's `development` condition dist/solid.dev.js, whose diagnostics refuse the writes
// a page makes in its component body (Sky.tsx's cells) — the desktop runs dist/solid.js (the desktop plugin's redirect of
// the server build), so the page is the same one here
const solid = join(dirname(Bun.resolveSync("solid-js/package.json", import.meta.dir)), "dist/solid.js");
// ... and the same for @solidjs/signals (solid-js's own dependency), whose dev build is the bundler's `development`
// condition; it is resolved from solid-js's folder, where it is installed
const signals = join(dirname(Bun.resolveSync("@solidjs/signals/package.json", dirname(solid))), "dist/prod/index.js");

const solidPlugin = {
  name: "cssints-native-browser",
  setup(build: {
    onResolve: (opts: { filter: RegExp }, fn: (args: { path: string; importer: string }) => unknown) => void;
    onLoad: (opts: { filter: RegExp }, fn: (args: { path: string }) => unknown) => void;
  }) {
    build.onResolve({ filter: /^solid-js$/ }, () => ({ path: solid }));
    build.onResolve({ filter: /^@solidjs\/signals$/ }, () => ({ path: signals }));
    // solid/src/frame.ts and every page's `../src/ffi.ts` import the desktop's bun:ffi binding; in the page it is the
    // wasm's
    build.onResolve({ filter: /(^|\/)ffi\.ts$/ }, (args) => {
      if (!args.path.endsWith("ffi.ts") || !args.importer.startsWith(join(root, "solid") + "/")) return undefined;
      return { path: ffi };
    });
    build.onLoad({ filter: /\.tsx$/ }, async ({ path }) => {
      const code = await Bun.file(path).text();
      if (!code.includes("cssints"))
        return { contents: transform(code, { filename: path, moduleName: renderer, generate: "universal" }).code, loader: "ts" };
      const run = Bun.spawnSync(["node", "--conditions=development", compileTsx, path]);
      if (!run.success) throw new Error(`cssints: ${path}\n${run.stderr}`);
      return { contents: run.stdout.toString(), loader: "ts" };
    });
    build.onLoad({ filter: /(^|[/.])styles\.ts$/ }, ({ path }) => {
      const run = Bun.spawnSync(["node", "--conditions=development", compileStyles, path]);
      if (!run.success) throw new Error(`cssints: ${path}\n${run.stderr}`);
      return { contents: run.stdout.toString(), loader: "js" };
    });
  },
};

const result = await Bun.build({
  entrypoints: [
    join(here, "page.ts"),
    join(here, "widgets.ts"),
    join(here, "sky.ts"),
    join(here, "list.ts"),
    join(here, "field.ts"),
    join(here, "dialog.ts"),
    join(here, "dev.ts"),
    join(here, "sheet.ts"),
    join(here, "figure.ts"),
    join(here, "console.ts"),
  ],
  target: "browser",
  root: here, // [dir] names nothing, so the bundles are flat in outdir whatever directory the build started in
  // the bundler's `development` condition would pick @solidjs/signals/dist/dev.js, whose diagnostics refuse the writes a
  // page makes in its component body (Sky.tsx's cells); the desktop runs the production signals, so the page is the same
  conditions: ["browser"],
  outdir,
  plugins: [solidPlugin as never],
  sourcemap: "none",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
for (const out of result.outputs) console.log(`${out.path} (${out.size} bytes)`);
