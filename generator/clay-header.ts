// styles.ts -> styles.h: a module of cssints/clay styles, compiled by the cssints plugin, printed as C initializers.
// Run: node --conditions=development generator/clay-header.ts <styles.ts> <styles.h>
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { header } from "cssints/clay";
import cssints from "cssints/vite";
import { createServer } from "vite";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node generator/clay-header.ts <styles.ts> <styles.h>");
  process.exit(1);
}
const file = resolve(input);
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
  const { code } = (await server.environments.client.transformRequest(`/${basename(file)}`))!;
  const styles = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(output, header({ ...styles }));
} finally {
  await server.close();
}
