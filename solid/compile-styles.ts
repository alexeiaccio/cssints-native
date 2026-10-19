// Node: a module of cssints/clay styles, compiled by the cssints plugin through Vite, printed as plain JS.
// Run: node --conditions=development solid/compile-styles.ts <styles.ts>   (plugin.ts does it for Bun)
import { basename, dirname, resolve } from "node:path";

import cssints from "cssints/vite";
import { createServer } from "vite";

const file = resolve(process.argv[2] ?? "");
const server = await createServer({
  root: dirname(file),
  configFile: false,
  logLevel: "silent",
  // cssints/clay is not in a release yet: its sources are the `development` condition
  resolve: { conditions: ["development", "module", "browser", "default"] },
  server: { middlewareMode: true, watch: null, ws: false },
  plugins: cssints(),
});
try {
  process.stdout.write((await server.environments.client.transformRequest(`/${basename(file)}`))!.code);
} finally {
  await server.close();
}
