// generator/clay-header.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { header } from "cssints/clay";
import cssints from "cssints/vite";
import { createServer } from "vite";
var [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node generator/clay-header.ts <styles.ts> <styles.h>");
  process.exit(1);
}
var file = resolve(input);
var server = await createServer({
  root: dirname(file),
  configFile: false,
  logLevel: "silent",
  resolve: { conditions: ["development", "module", "browser", "default"] },
  server: { middlewareMode: true, watch: null, ws: false },
  plugins: cssints()
});
try {
  const { code } = await server.environments.client.transformRequest(`/${basename(file)}`);
  const styles = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(output, header({ ...styles }));
} finally {
  await server.close();
}
