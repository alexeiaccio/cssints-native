// Bun's module loading for the Solid app: JSX compiled for the universal renderer, cssints/clay style modules
// compiled by the cssints plugin, and the client build of solid-js. Import this before the app.
import { plugin } from "bun";
import { dirname } from "node:path";

import { transform } from "@solidjs/compiler";

const renderer = new URL("./src/renderer.ts", import.meta.url).pathname;
const compileStyles = new URL("./compile-styles.ts", import.meta.url).pathname;
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
    build.onLoad({ filter: /\.tsx$/ }, async ({ path }) => ({
      contents: transform(await Bun.file(path).text(), { filename: path, moduleName: renderer, generate: "universal" })
        .code,
      loader: "ts",
    }));
    // the cssints plugin runs on Vite, which runs on Node here: a `styles.ts` (or `x.styles.ts`) is compiled by a child
    // process. (A Bun onLoad cannot decline a file, so the name says which modules are styles.)
    build.onLoad({ filter: /(^|[/.])styles\.ts$/ }, ({ path }) => {
      const run = Bun.spawnSync(["node", "--conditions=development", compileStyles, path]);
      if (!run.success) throw new Error(`cssints: ${path}\n${run.stderr}`);
      return { contents: run.stdout.toString(), loader: "js" };
    });
  },
});
