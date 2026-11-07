// tsx/queries/highlights.scm -> highlights.h: the query as a C string, because the terminal has no file system to read
// it from (a board has none at all). Run: node generator/highlights-header.ts <highlights.scm> <highlights.h>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node generator/highlights-header.ts <highlights.scm> <highlights.h>");
  process.exit(1);
}
// one string literal a line: a literal has a length limit that the whole query is past. Every '?' is escaped: the
// query's tokens include `??=`, and a C trigraph is `#` before the string is read.
const lines = readFileSync(resolve(input), "utf8").split("\n");
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(
  resolve(output),
  `// generated from ${input} by generator/highlights-header.ts; do not edit
static const char TSX_HIGHLIGHTS[] =
${lines.map((line) => `    ${JSON.stringify(`${line}\n`).replaceAll("?", "\\?")}`).join("\n")};
`,
);
