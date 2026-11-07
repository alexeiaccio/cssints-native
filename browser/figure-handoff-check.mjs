// The handoff and QA figures in the browser, by name: `browser/solid/figure.ts` fetches `solid/specs/<name>.json` with
// `?spec=`, `app/Figure.tsx` declares it over Clay in ui.wasm, and browser/draw.js draws the commands on a canvas. The
// page has no code for a kind, so these three need no bundle of their own — only their files.
//
//   node browser/figure-handoff-check.mjs            the check (build first: sh browser/build.sh && bun browser/solid/build.ts)
//   node browser/figure-handoff-check.mjs --serve    serve the page and print its URL
//
// What it holds, for `redline`, `before-after` and `qa-checklist`:
//   (a) the frame's commands against solid/goldens/figure-<name>.json — the desktop's last frame, the same golden
//       solid/dump.ts stores — with the boxes within **4 px** (Canvas2D's advance against ThorVG's metrics);
//   (b) no Clay error, and the spec's title in the frame: `?spec=` is the file, not bars.json.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "../solid/src/format.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WASM_DIR = process.env.WASM_DIR || join(process.env.TMPDIR || "/tmp", "cssints-native-web");
const bundles = [join(WASM_DIR, "solid/figure.js"), join(WASM_DIR, "solid/browser/solid/figure.js")].filter(existsSync);
const BUNDLE = bundles.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? join(WASM_DIR, "solid/figure.js");
/** The boxes' tolerance, in px: figure-check.mjs's number, and the reason in its header. */
const BOX_TOLERANCE = 4;
/** The three specs, and the title each file draws: the file is the figure, so the title is its own `title`. */
const SPECS = [
  ["redline", "The Wi-Fi switch's row, redlined"],
  ["before-after", "The Wi-Fi switch, off and on"],
  ["qa-checklist", "Twelve comparisons the suite makes"],
];

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".ttf": "font/ttf",
  ".json": "application/json",
  ".png": "image/png",
};
let failures = 0;
let comparisons = 0;
const ok = (name, extra = "") => (comparisons++, console.log(`ok   ${name}${extra ? " — " + extra : ""}`));
const bad = (name, why) => (comparisons++, failures++, console.log(`FAIL ${name}: ${why}`));

function serve() {
  return new Promise((done) => {
    const server = createServer(async (req, res) => {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const built =
        path === "/browser/solid/ui.wasm"
          ? join(WASM_DIR, "ui.wasm")
          : path === "/browser/solid/figure.js"
            ? BUNDLE
            : join(ROOT, path);
      try {
        const body = await readFile(built);
        res.writeHead(200, { "content-type": MIME[extname(built)] || "text/plain" }).end(body);
      } catch {
        res.writeHead(404).end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => done({ server, port: server.address().port }));
  });
}

/** (a) a frame against the desktop's golden: every field exactly but the boxes (within `max` px). */
function compareGolden(name, want, got) {
  if (got.commands.length !== want.commands.length)
    return bad(name, `${got.commands.length} commands, the golden's ${want.commands.length}`);
  let worst = 0;
  let worstAt = 0;
  for (let i = 0; i < want.commands.length; i++) {
    const a = want.commands[i];
    const b = got.commands[i];
    const text = typeof b.text === "string" && b.text ? ` ${JSON.stringify(b.text)}` : "";
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key === "box") {
        for (let k = 0; k < 4; k++) {
          const d = Math.abs(a.box[k] - b.box[k]);
          if (d > worst) (worst = d), (worstAt = i);
        }
        continue;
      }
      if (format(a[key]) !== format(b[key]))
        return bad(`${name} #${i} (${b.type}${text})`, `${key === "color" ? "colour" : key} ${format(b[key])}, the golden's ${format(a[key])}`);
    }
  }
  if (worst > BOX_TOLERANCE)
    return bad(name, `command ${worstAt}'s box is ${worst.toFixed(2)}px off the golden's, over ${BOX_TOLERANCE}`);
  if (format(want.effects) !== format(got.effects)) return bad(`${name} effects`, format(got.effects));
  ok(name, `${want.commands.length} commands, every field and table the golden's; worst box ${worst.toFixed(2)}px (tolerance ${BOX_TOLERANCE})`);
}

async function main() {
  const missing = [join(WASM_DIR, "ui.wasm"), BUNDLE].filter((f) => !existsSync(f));
  if (missing.length) {
    console.log(`missing build product(s): ${missing.join(", ")}`);
    console.log('run "sh browser/build.sh && bun browser/solid/build.ts" first');
    process.exit(1);
  }
  const { server, port } = await serve();
  if (process.argv.includes("--serve")) {
    console.log(`http://127.0.0.1:${port}/browser/solid/figure.html?spec=redline   (Ctrl-C to stop)`);
    return;
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 720, height: 420 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on("console", (m) => logs.push(m.text()));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  try {
    for (const [name, title] of SPECS) {
      await page.goto(`http://127.0.0.1:${port}/browser/solid/figure.html?spec=${name}`);
      await page.waitForFunction(() => window.__page, null, { timeout: 20000 });
      await page.evaluate(() => window.__page.warm(2));
      const errors = await page.evaluate(() => window.__page.errors());
      if (errors) bad(`?spec=${name}`, `${errors} Clay errors`);
      const dump = JSON.parse(await page.evaluate(() => window.__page.dump()));
      compareGolden(`?spec=${name}`, JSON.parse(readFileSync(join(ROOT, "solid/goldens", `figure-${name}.json`), "utf8")), dump);
      if (!dump.commands.some((c) => c.text === title)) bad(`?spec=${name}`, `the frame has no "${title}"`);
      else ok(`?spec=${name}`, `the file's figure ("${title}"), no page code for the kind`);
    }
    if (logs.some((l) => l.startsWith("pageerror"))) bad("page errors", logs.filter((l) => l.startsWith("pageerror")).join("; "));
    else ok("no page errors", `${logs.length} console line(s)`);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) {
    console.log(`${failures} failure(s) of ${comparisons} comparisons`);
    process.exit(1);
  }
  console.log(`browser/figure-handoff-check: ok, ${comparisons} comparisons`);
}

await main();
