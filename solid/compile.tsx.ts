// Node: a .tsx module compiled for Bun, in two stages: Solid's JSX compiler makes plain JS (types gone, JSX calls),
// then the cssints Vite plugin compiles the `with { type: "cssints" }` import and the style sites on that JS.
// Run: node --conditions=development solid/compile.tsx.ts <InlineDemo.tsx>   (plugin.ts does it for Bun)
//
// Two stages because neither tool can absorb the other: Bun's onLoad cannot run a Vite plugin, and Vite's
// import-analysis rejects JSX while its esbuild pass would compile JSX with the wrong runtime. So stage 1 here, stage 2
// in the cssints server below. The cssints transform is called directly, not through `transformRequest`: Vite's
// import-analysis would rewrite the renderer path (and prebundle solid-js into a second copy) for a browser, while
// Bun gets plain JS.
import { readFile } from "node:fs/promises";
import { SourceMap } from "node:module";
import { basename, dirname, resolve } from "node:path";

import { transform } from "@solidjs/compiler";
import cssints from "cssints/vite";
import { createServer } from "vite";

const file = resolve(process.argv[2] ?? "");
const renderer = new URL("./src/renderer.ts", import.meta.url).pathname;
const compiled = transform(await readFile(file, "utf8"), {
  filename: file,
  moduleName: renderer,
  generate: "universal",
  sourceMap: true,
});
const stage1 = compiled.code;
const map = compiled.map ? new SourceMap(JSON.parse(compiled.map)) : undefined;

const plugins = cssints();
const server = await createServer({
  root: dirname(file),
  configFile: false,
  logLevel: "silent",
  // cssints/clay is not in a release yet: its sources are the `development` condition
  resolve: {
    conditions: ["development", "module", "browser", "default"],
    // a page's own imports are evaluated here too (tokens), and the FFI has no meaning in Node: see stub-bun.mjs
    alias: { "bun:ffi": new URL("./stub-bun.mjs", import.meta.url).pathname },
  },
  server: { middlewareMode: true, watch: null, ws: false },
  plugins: [
    {
      // the module keeps the .tsx name, so cssints reports a MacroError against the source the user wrote; the load
      // serves the stage-1 JS to cssints' evaluation server, which would otherwise read the .tsx from disk
      name: "cssints-inline-tsx",
      enforce: "pre",
      load: (id) => (id === file ? stage1 : undefined),
    },
    ...plugins,
  ],
});
try {
  const main = plugins[0]!;
  const hook = typeof main.transform === "function" ? main.transform : main.transform?.handler;
  const code = await hook!.call(
    { environment: server.environments.client, addWatchFile() {}, warn() {} } as never,
    stage1,
    file,
  );
  process.stdout.write(typeof code === "string" ? code : (code?.code ?? stage1));
} catch (e) {
  // cssints has already pointed the error at this file, but at a line of the stage-1 JS. The JSX compiler's map turns
  // that back into the line and column the user wrote; without it the frame would name the wrong line.
  const error = e as { message?: string; loc?: { file: string; line: number; column: number } };
  let at = error.loc;
  if (at?.file === file && map) {
    const entry = map.findEntry(at.line - 1, at.column);
    if (entry.originalLine !== undefined)
      at = { file, line: entry.originalLine + 1, column: entry.originalColumn! };
  }
  console.error(at ? `${at.file}:${at.line}:${at.column + 1}: ${error.message ?? e}` : String(e));
  process.exitCode = 1;
} finally {
  await server.close();
}
