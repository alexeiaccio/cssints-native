// Bun's module loading for the Solid app: JSX compiled for the universal renderer, cssints/clay style modules
// compiled by the cssints plugin, and the client build of solid-js. Import this before the app.
import { plugin } from "bun";
import { dirname } from "node:path";

import { transform } from "@solidjs/compiler";

const renderer = new URL("./src/renderer.ts", import.meta.url).pathname;
const compileStyles = new URL("./compile-styles.ts", import.meta.url).pathname;
const compileTsx = new URL("./compile.tsx.ts", import.meta.url).pathname;
// solid-js's package map gives Bun the server build (the `node` condition), where signals do not update, and Bun
// does not run onResolve for a bare package name: the server build's file is loaded as a re-export of the client one
const solid = `${dirname(Bun.resolveSync("solid-js/package.json", import.meta.dir))}/dist/solid.js`;

plugin({
  name: "cssints-native-solid",
  setup(build) {
    build.onLoad({ filter: /solid-js\/dist\/server(\.dev)?\.js$/ }, () => ({
      contents: `export * from ${JSON.stringify(solid)};`,
      loader: "js",
    }));
    // A page may declare its styles in the same .tsx (the point of cssints: next to the markup). That needs two
    // stages, so the page goes through a child process: Solid's JSX compiler first (Bun cannot run a Vite plugin), then
    // cssints on the plain JS. A page without cssints keeps the one stage: JSX only.
    //
    // This and the `styles.ts` filter below both exist because a Bun onLoad cannot decline a file: with styles in a
    // separate module the name says which modules are styles, and old pages (and examples/sensors/styles.ts, shared with
    // the C page) keep that path; a .tsx that mentions cssints goes through the child, and one that does not never pays
    // for it.
    build.onLoad({ filter: /\.tsx$/ }, async ({ path }) => {
      const code = await Bun.file(path).text();
      if (!code.includes("cssints"))
        return { contents: transform(code, { filename: path, moduleName: renderer, generate: "universal" }).code, loader: "ts" };
      const run = Bun.spawnSync(["node", "--conditions=development", compileTsx, path]);
      if (!run.success) throw new Error(`cssints: ${path}\n${run.stderr}`);
      // `ts`, not `js`: Solid's compiler compiles JSX but leaves the types for the loader to strip
      return { contents: run.stdout.toString(), loader: "ts" };
    });
    // the cssints plugin runs on Vite, which runs on Node here: a `styles.ts` (or `x.styles.ts`) is compiled by a child
    // process. (A Bun onLoad cannot decline a file, so the name says which modules are styles.)
    build.onLoad({ filter: /(^|[/.])styles\.ts$/ }, ({ path }) => {
      const run = Bun.spawnSync(["node", "--conditions=development", compileStyles, path]);
      if (!run.success) throw new Error(`cssints: ${path}\n${run.stderr}`);
      return { contents: run.stdout.toString(), loader: "js" };
    });
  },
});
