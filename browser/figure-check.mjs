// The Figure page in the browser, checked against the desktop's own frame: browser/solid/figure.ts fetches a spec
// (solid/specs/<name>.json, `?spec=`), app/Figure.tsx declares it over Clay in ui.wasm, and browser/draw.js draws the
// commands on a canvas. The page is static and takes no input.
//
//   node browser/figure-check.mjs            the check (build first: sh browser/build.sh && bun browser/solid/build.ts)
//   node browser/figure-check.mjs --serve    serve the page and print its URL
//
// What it holds:
//   (a) the frame's commands against solid/goldens/figure.json — the desktop's last frame, the same golden
//       solid/dump.ts stores — with the boxes within **4 px**, the measure's tolerance: the golden's metrics are
//       ThorVG's, Canvas2D's a glyph advance wider, and a figure's columns are fixed cells so only a text's own box moves.
//   (b) a click does nothing: a press and a release on the canvas leave the frame's commands and tables byte-identical.
//   (c) the spec is the URL's: ?spec=funnel draws the funnel's focus line, which bars.json has not.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "../solid/src/format.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WASM_DIR = process.env.WASM_DIR || join(process.env.TMPDIR || "/tmp", "cssints-native-web");
// Bun.build writes one entry's [dir] relative to the directory it ran from: `bun browser/solid/build.ts` (native/) nests
// the bundles under solid/browser/solid, `cd browser/solid && bun build.ts` writes them flat. The newest of the two is
// this run's bundle, so either way the check looks at what was just built.
const bundles = [join(WASM_DIR, "solid/figure.js"), join(WASM_DIR, "solid/browser/solid/figure.js")].filter(existsSync);
const BUNDLE = bundles.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? join(WASM_DIR, "solid/figure.js");
const GOLDEN = JSON.parse(readFileSync(join(ROOT, "solid/goldens/figure.json"), "utf8"));
/** The boxes' tolerance, in px: solid-check.mjs's number, and the reason in its header (ThorVG's metrics). */
const BOX_TOLERANCE = 4;

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

/** The command array and the renderer's tables as one string: what a frame is. */
const frameOf = (dump) => format({ commands: dump.commands, effects: dump.effects });

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
    const who = `#${i} (${b.type}${text})`;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key === "box") {
        for (let k = 0; k < 4; k++) {
          const d = Math.abs(a.box[k] - b.box[k]);
          if (d > worst) (worst = d), (worstAt = i);
        }
        continue;
      }
      if (format(a[key]) !== format(b[key]))
        return bad(`${name} ${who}`, `${key === "color" ? "colour" : key} ${format(b[key])}, the golden's ${format(a[key])}`);
    }
  }
  if (worst > BOX_TOLERANCE)
    return bad(name, `command ${worstAt}'s box is ${worst.toFixed(2)}px off the golden's, over ${BOX_TOLERANCE}`);
  if (format(want.effects) !== format(got.effects)) return bad(`${name} effects`, format(got.effects));
  ok(name, `${want.commands.length} commands, every field and table the golden's; worst box ${worst.toFixed(2)}px ` +
    `(tolerance ${BOX_TOLERANCE}: Canvas2D's advance against ThorVG's metrics)`);
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
    console.log(`http://127.0.0.1:${port}/browser/solid/figure.html?spec=bars   (Ctrl-C to stop)`);
    return;
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 720, height: 420 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on("console", (m) => logs.push(m.text()));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  try {
    await page.goto(`http://127.0.0.1:${port}/browser/solid/figure.html?spec=bars`);
    await page.waitForFunction(() => window.__page, null, { timeout: 20000 });
    // no entry to settle: two frames are the page at rest
    await page.evaluate(() => window.__page.warm(2));
    const errors = await page.evaluate(() => window.__page.errors());
    if (errors) bad("clay", `${errors} Clay errors`);
    else ok("clay", "no errors");

    const base = JSON.parse(await page.evaluate(() => window.__page.dump()));
    compareGolden("commands, bars vs solid/goldens/figure.json", GOLDEN, base);
    if (!base.commands.some((c) => c.text === "A frame, by target"))
      bad("the spec", "the frame has no bars.json title");
    else ok("the spec", "?spec=bars is the file's figure (\"A frame, by target\")");

    // (b) a press and a release on the canvas: the page declares no control, so its frame cannot move
    const rect = await page.locator("#frame").boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.evaluate(() => window.__page.warm(1));
    const clicked = JSON.parse(await page.evaluate(() => window.__page.dump()));
    if (frameOf(clicked) !== frameOf(base)) bad("a click", "the frame moved");
    else ok("a click", "the commands and the tables are the base frame's: a figure takes no input");

    // (c) the URL picks the spec: the funnel's focus line is the figure's, and bars.json's is not in it
    await page.goto(`http://127.0.0.1:${port}/browser/solid/figure.html?spec=funnel`);
    await page.waitForFunction(() => window.__page, null, { timeout: 20000 });
    await page.evaluate(() => window.__page.warm(2));
    const funnel = JSON.parse(await page.evaluate(() => window.__page.dump()));
    const focus = funnel.commands.find((c) => c.text?.startsWith("► "));
    if (focus?.text !== "► One in twenty visitors pays.")
      bad("?spec=funnel", `the focus line is ${JSON.stringify(focus?.text)}`);
    else ok("?spec=funnel", `the figure is the spec's ("${focus.text}"), not bars.json's`);

    // (d) the kinds are specs by name too: the page needs no code for them, only the file
    for (const [name, title] of [
      ["branch-flow", "One spec, from its file to a frame"],
      ["state-machine", "A dialog's presence, one open"],
      ["tree", "The targets and their pages"],
      ["journey-map", "The first week, in three stages"],
      ["palette", "The blue and grey scales, on the page"],
      ["contrast", "The docs' colour roles, on their pages"],
      ["colour-roles", "The docs' roles, in both modes"],
      ["layer-stack", "The Dialog's layers, back to front"],
      ["state-matrix", "The pages' states, a style a row"],
      ["token-table", "The docs' tokens, in one table"],
      ["spacing", "The docs' spacing scale"],
      ["type-scale", "The docs' type scale"],
      ["sparkline", "The desktop frame, twelve runs"],
      ["meter", "The link, against the floor it is held to"],
      ["heatmap", "The grey inks, on the three pages"],
      ["forecast", "A release a day, and the next week projected"],
      ["timeline", "The plan's order, one step a row"],
      ["statusKey", "What the map's statuses mean"],
      ["nowNextLater", "What the map has left, now, next, later"],
      ["screen", "The Widgets page, as a wireframe"],
      ["anatomy", "The Widgets switch, part by part"],
      ["modal", "The Dialog, open"],
      ["responsive-pair", "The Sky page, at two widths"],
      ["app-shell", "The Sky page's shell"],
      ["card-grid", "The Sky feed's cards"],
      ["list-detail", "The Sky page's thread, beside its feed"],
      ["table", "The map's targets, one a row"],
      ["cohort", "The firehose's minute cohorts"],
      ["intent-card", "The feed's third card, in"],
      ["transition-spec", "The Dialog's menu, in"],
      ["easing-table", "The app's easing curves"],
    ]) {
      await page.goto(`http://127.0.0.1:${port}/browser/solid/figure.html?spec=${name}`);
      await page.waitForFunction(() => window.__page, null, { timeout: 20000 });
      await page.evaluate(() => window.__page.warm(2));
      const dump = JSON.parse(await page.evaluate(() => window.__page.dump()));
      const errors = await page.evaluate(() => window.__page.errors());
      if (errors) bad(`?spec=${name}`, `${errors} Clay errors`);
      else if (!dump.commands.some((c) => c.text === title)) bad(`?spec=${name}`, `the frame has no "${title}"`);
      else ok(`?spec=${name}`, `the file's figure ("${title}"), no page code for the kind`);
    }

    const ms = await page.evaluate(() => window.__page.bench(100));
    const bundle = (await stat(BUNDLE)).size;
    const html = (await stat(join(ROOT, "browser/solid/figure.html"))).size;
    const wasm = (await stat(join(WASM_DIR, "ui.wasm"))).size;
    console.log(`info figure.js ${bundle} B, figure.html ${html} B, ui.wasm ${wasm} B`);
    console.log(`info ${ms.toFixed(2)} ms a frame (100 frames: the spec's tree declared, Clay's layout, the commands, ` +
      `Canvas2D's raster, one readback)`);
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
  console.log(`browser/figure-check: ok, ${comparisons} comparisons`);
}

await main();
