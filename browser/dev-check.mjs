// The Dev page and the Text sheet in the browser, checked against the desktop's own frames and against the one thing a
// frame cannot show: the panel's readout, which is the page.
//
//   (a) the Dev page's frame (660x760) against solid/frames/dev.png, the way browser/check.mjs holds this browser to
//       ThorVG's: the mean colour of every command's box (at least 16x16 px), each text line's ink box, and the frame's
//       mean colour (20/255, 4 px, 3/255, 12% of the pixels). There is no command golden for this page on purpose: the
//       panel prints the frame's milliseconds, so its own text is different on every run — the panel's rows are
//       asserted from the frame's text commands instead (b, c, d).
//   (b) the a11y tree is the page's: window.__page.a11y() (solid/a11y.ts's snapshot over the whole dev tree) has the
//       Widgets page's 28 nodes, in its order, and no box of the panel is one of them — every node with bounds is inside
//       the page's 360px column (solid/dev.test.ts's own rows).
//   (c) a hover: the pointer onto the Widgets button, and the panel's "hovered box" line names it (`press  button
//       "Presses: 0"`), with the box's `x,y w×h` under it.
//   (d) the keys: a press on the canvas gives it the DOM's focus, Tab twice puts the switch's focus in the panel's tree
//       row (`[checked=false focused=true]`), Space checks it — the row changes, the frame's hash changes, and 30 frames
//       at rest draw nothing (the drawer's `ui.draws`, the panel's own `presents`).
//   (e) the Text sheet (440x564): its frame's commands against solid/goldens/sheet.json (every field, the boxes within
//       4 px, as the desktop's `solid/dump.ts sheet` stores it) and its raster against solid/frames/text-sheet.png with
//       the same numbers (a).
//
//   node browser/dev-check.mjs            the check (build first: sh browser/build.sh && bun browser/solid/build.ts)
//   node browser/dev-check.mjs --serve    serve the pages and print their URLs, for looking at them by hand
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// the goldens' formatter (solid/dump.ts stores them with it), for a field's message
import { format } from "../solid/src/format.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BROWSER = join(ROOT, "browser");
const WASM_DIR = process.env.WASM_DIR || join(process.env.TMPDIR || "/tmp", "cssints-native-web");
const DEV_BUNDLE = join(WASM_DIR, "solid/dev.js");
const SHEET_BUNDLE = join(WASM_DIR, "solid/sheet.js");
const DEV = { width: 660, height: 760 };
const SHEET = { width: 440, height: 564 };
// the design's frames: the two pages on the desktop, ThorVG's software canvas
const DEV_FRAME = "/solid/frames/dev.png";
const SHEET_FRAME = "/solid/frames/text-sheet.png";
const SHEET_GOLDEN = JSON.parse(readFileSync(join(ROOT, "solid/goldens/sheet.json"), "utf8"));

const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".ttf": "font/ttf",
    ".png": "image/png", ".json": "application/json" };
let failures = 0;
const ok = (name, extra = "") => console.log(`ok   ${name}${extra ? " — " + extra : ""}`);
const bad = (name, why) => { failures++; console.log(`FAIL ${name}: ${why}`); };

function serve() {
    return new Promise(done => {
        const server = createServer(async (req, res) => {
            const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
            const built = path === "/browser/solid/ui.wasm" ? join(WASM_DIR, "ui.wasm")
                : path === "/browser/solid/dev.js" ? DEV_BUNDLE
                : path === "/browser/solid/sheet.js" ? SHEET_BUNDLE
                : join(ROOT, path);
            try {
                const body = await readFile(built);
                res.writeHead(200, { "content-type": MIME[extname(built)] || "text/plain" });
                res.end(body);
            } catch {
                res.writeHead(404).end("not found");
            }
        });
        server.listen(0, "127.0.0.1", () => done({ server, port: server.address().port }));
    });
}

/** The page's window loop is the check's: requestAnimationFrame never calls back, so no frame runs unasked (and
 *  Playwright would wait on that same callback: every wait here polls on a timer instead). */
const HOLD = () => {
    window.requestAnimationFrame = () => 0;
};

/** (a)/(e) a frame against the desktop's, done in the page: per command box a mean colour, per text an ink box.
 *  `crop` limits the comparison to a column of the canvas (the Dev panel is not compared pixel-wise: it prints the
 *  frame's milliseconds, and Canvas2D's metrics re-wrap one of its 10px rows, so its own text is different every run). */
const REGIONS = async ({ refURL, boxes, width, height, crop }) => {
    const a = document.getElementById("frame").getContext("2d").getImageData(0, 0, width, height);
    const [x0, x1] = crop === undefined ? [0, a.width] : [crop.x, crop.x + crop.w];
    const img = new Image();
    img.src = refURL;
    await img.decode();
    const rc = document.createElement("canvas");
    rc.width = a.width;
    rc.height = a.height;
    const rcx = rc.getContext("2d");
    rcx.drawImage(img, 0, 0, a.width, a.height);
    const b = rcx.getImageData(0, 0, a.width, a.height).data;
    const mean = (d, x0, y0, x1, y1) => {
        const s = [0, 0, 0], n = Math.max(1, (x1 - x0) * (y1 - y0));
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const i = (y * a.width + x) * 4;
            for (let k = 0; k < 3; k++) s[k] += d[i + k];
        }
        return s.map(v => v / n);
    };
    // a text box's background is the fill of the last rectangle drawn before it; ink is what is far from that colour
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const inkBox = (d, box, bg) => {
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        for (let y = Math.max(0, box.y); y < Math.min(a.height, box.y + box.h); y++)
            for (let x = Math.max(0, box.x); x < Math.min(a.width, box.x + box.w); x++) {
                const i = (y * a.width + x) * 4;
                const dd = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
                if (dd > 120) { x0 = Math.min(x0, x), x1 = Math.max(x1, x); y0 = Math.min(y0, y), y1 = Math.max(y1, y); }
            }
        return x1 < 0 ? null : [x0, x1, y0, y1];
    };
    let differing = 0;
    const meanA = [0, 0, 0], meanB = [0, 0, 0];
    for (let y = 0; y < a.height; y++) for (let x = x0; x < x1; x++) {
        const i = (y * a.width + x) * 4;
        if (a.data[i] !== b[i] || a.data[i + 1] !== b[i + 1] || a.data[i + 2] !== b[i + 2]) differing++;
        for (let k = 0; k < 3; k++) meanA[k] += a.data[i + k], meanB[k] += b[i + k];
    }
    const n = a.width * (x1 - x0);
    const frameMean = Math.max(...meanA.map((v, k) => Math.abs(v / n - meanB[k] / n)));
    const regionDelta = [], inkDelta = [];
    let fill = "#000000"; // the last rectangle's colour: a text box's background
    for (const box of boxes) {
        if (box.type === 1) fill = box.color;
        const r = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) };
        r.x = Math.max(x0, r.x), r.y = Math.max(0, r.y);
        r.w = Math.min(x1, r.x + r.w) - r.x, r.h = Math.min(a.height - r.y, r.h);
        // a region thinner than 16 px is not compared: the boxes may differ by up to 4 px
        if (r.w < 16 || r.h < 16) continue;
        const ma = mean(a.data, r.x, r.y, r.x + r.w, r.y + r.h);
        const mb = mean(b, r.x, r.y, r.x + r.w, r.y + r.h);
        regionDelta.push({ box, delta: Math.max(...ma.map((v, k) => Math.abs(v - mb[k]))) });
        if (box.type === 3) {
            const bg = rgb(fill), ia = inkBox(a.data, r, bg), ib = inkBox(b, r, bg);
            if (ia && ib) inkDelta.push({ box, ia, ib, delta: Math.max(...ia.map((v, k) => Math.abs(v - ib[k]))) });
            else if (!ia && !ib) inkDelta.push({ box, delta: 0 });
            else inkDelta.push({ box, delta: 99 });
        }
    }
    const worst = list => list.reduce((m, e) => (e.delta > m.delta ? e : m), { delta: 0 });
    return { differing, total: n, frameMean, region: worst(regionDelta), ink: worst(inkDelta), boxes: regionDelta.length };
};

/** Text lines whose ink is not compared: the fallback glyph in "Wm ¼ ⅓ — “quotes”" is another font in each rasteriser
 *  (ThorVG sets one face and draws the ⅓ as its empty box, CoreText and Canvas2D fall back), so its ink box moves. */
const INK_SKIP = new Set(["Wm ¼ ⅓ — “quotes”"]);

function assertRegions(name, diff, { regionMax, inkMax, meanMax, pixelPct }) {
    const pct = (100 * diff.differing) / diff.total;
    if (diff.region.delta > regionMax)
        return bad(name, `the region of ${JSON.stringify(diff.region.box.text || diff.region.box.type)} at ` +
            `(${diff.region.box.x},${diff.region.box.y}) ${diff.region.box.w}x${diff.region.box.h} differs by ` +
            `${diff.region.delta.toFixed(1)}/255 in the mean, over ${regionMax}`);
    const ink = INK_SKIP.has(diff.ink.box?.text) ? { delta: 0, box: { text: "(the fallback line, not compared)" } } : diff.ink;
    if (ink.delta > inkMax)
        return bad(name, `the ink of "${ink.box.text}" is ${ink.delta.toFixed(0)}px off (${ink.ia} vs ${ink.ib}), over ${inkMax}`);
    if (diff.frameMean > meanMax) return bad(name, `the frame's mean colour is ${diff.frameMean.toFixed(2)}/255 off, over ${meanMax}`);
    if (pct > pixelPct) return bad(name, `${pct.toFixed(1)}% of pixels differ, over ${pixelPct}%`);
    ok(name, `${pct.toFixed(2)}% of pixels differ; ${diff.boxes} boxes' means within ${diff.region.delta.toFixed(1)}/255, ` +
        `text ink within ${ink.delta.toFixed(2)}px ("${ink.box?.text}"), the frame's mean colour within ${diff.frameMean.toFixed(2)}/255`);
}

/** (e) a frame against its golden: every field exactly but the boxes (ThorVG's metrics; `boxMax` px). */
function compareGolden(name, golden, dump, boxMax) {
    const want = golden.commands;
    if (dump.commands.length !== want.length) return bad(name, `${dump.commands.length} commands, want ${want.length}`);
    let worst = 0, worstAt = 0;
    for (let i = 0; i < want.length; i++) {
        const a = want[i], b = dump.commands[i];
        const text = typeof b.text === "string" && b.text ? ` ${JSON.stringify(b.text)}` : "";
        const who = `${name} #${i} (${b.type}${text})`;
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
            if (key === "box") {
                for (let k = 0; k < 4; k++) {
                    const d = Math.abs(a.box[k] - b.box[k]);
                    if (d > worst) worst = d, worstAt = i;
                }
                continue;
            }
            if (format(a[key]) !== format(b[key]))
                return bad(who, `${key === "color" ? "colour" : key} ${format(b[key])}, want ${format(a[key])}`);
        }
    }
    const at = want[worstAt];
    const where = at?.text ? `command #${worstAt} (${JSON.stringify(at.text)})` : `command #${worstAt}`;
    if (worst > boxMax) return bad(name, `${where}'s box is ${worst.toFixed(2)}px off the golden's, over ${boxMax}`);
    if (format(golden.effects) !== format(dump.effects)) return bad(`${name} effects`, format(dump.effects));
    ok(name, `${want.length} commands, same order and fields as the golden; worst box ${worst.toFixed(2)}px (${where})`);
}

/** The nodes of the page's accessibility snapshot as roles, names and boxes, in document order. */
const A11Y = () => {
    const out = [];
    const walk = (node) => {
        for (const child of node.children) {
            const states = Object.entries(child.states).map(([k, v]) => `${k}=${v}`).join(" ");
            out.push({ role: child.role, name: child.name, states: child.states, bounds: child.bounds, line:
                `${child.role}${child.name === undefined ? "" : ` "${child.name}"`}${states ? ` [${states}]` : ""}` });
            walk(child);
        }
    };
    walk(window.__page.a11y());
    return out;
};

/** The panel's printed lines: every text command of the frame, the panel's rows among them. */
const TEXTS = () => window.__page.commands().filter((c) => c.type === 3 && typeof c.text === "string").map((c) => c.text);

async function main() {
    const missing = [join(WASM_DIR, "ui.wasm"), DEV_BUNDLE, SHEET_BUNDLE,
        join(BROWSER, "solid/dev.html"), join(BROWSER, "solid/sheet.html")].filter(f => !existsSync(f));
    if (missing.length) {
        console.log(`missing build product(s): ${missing.join(", ")}`);
        console.log(`run "sh browser/build.sh && bun browser/solid/build.ts" first`);
        process.exit(1);
    }
    const { server, port } = await serve();
    if (process.argv.includes("--serve")) {
        console.log(`http://127.0.0.1:${port}/browser/solid/dev.html     (Dev: click the frame, then the pointer; Ctrl-C to stop)`);
        console.log(`http://127.0.0.1:${port}/browser/solid/sheet.html   (the Text sheet)`);
        return; // no browser to drive: serve the pages for a person to open
    }
    const browser = await chromium.launch();
    const logs = [];
    /** A page of the app at `?bench=0` (no auto bench: every frame is the check's), its errors on `logs`. */
    async function open(url, size) {
        const page = await browser.newPage({ viewport: { width: size.width + 80, height: size.height + 160 }, deviceScaleFactor: 1 });
        await page.addInitScript(HOLD);
        page.on("console", m => logs.push(m.text()));
        page.on("pageerror", e => logs.push(`pageerror: ${e.message}`));
        await page.goto(`http://127.0.0.1:${port}${url}`);
        await page.waitForFunction(() => window.__page, null, { polling: 100 });
        return page;
    }
    const dump = async (page) => JSON.parse(await page.evaluate(() => window.__page.dump()));
    const commands = async (page) => page.evaluate(() => window.__page.commands());
    const texts = async (page) => page.evaluate(TEXTS);
    const boxOf = (dump, element) => dump.commands.find((c) => c.element === element)?.box;

    const dev = await open("/browser/solid/dev.html?bench=0", DEV);
    try {
        await dev.evaluate(() => window.__page.warm(31));
        const errors = await dev.evaluate(() => window.__page.errors());
        if (errors) bad("clay, dev", `${errors} Clay errors`); else ok("clay, dev", "no errors");

        // --- the page's two halves: the Widgets page's 360 and the panel's 300
        const devDump = await dump(dev);
        const [left, panel] = [boxOf(devDump, "Root"), boxOf(devDump, "dev-panel")];
        if (!left || !panel) bad("the page", "the Widgets page or the panel has no box in the frame");
        else if (Math.round(left[2]) !== 360 || Math.round(panel[0]) !== 360 || Math.round(panel[2]) !== 300 ||
            Math.round(panel[3]) !== 760)
            bad("the page", `the page is ${left.map(Math.round)}, the panel ${panel.map(Math.round)}, not 360 + 300 x 760`);
        else ok("the page", `the Widgets page at ${left.slice(0, 2).map(Math.round).join(",")} 360x760, the panel at ` +
            `${panel[0]},0 300x760: solid/app/Dev.tsx's own size`);

        // --- (a) the frame against the desktop's stored one
        const devCommands = await commands(dev);
        // the page's 360px column: the Widgets page's frame against ThorVG's, as solid-check.mjs holds widgets-initial
        const devRegions = await dev.evaluate(REGIONS, { refURL: DEV_FRAME, boxes: devCommands, width: DEV.width,
            height: DEV.height, crop: { x: 0, w: 360 } });
        assertRegions("raster, the Dev page's column vs the desktop's solid/frames/dev.png", devRegions,
            { regionMax: 20, inkMax: 4, meanMax: 3, pixelPct: 12 });

        // --- (b) the a11y tree: the page's 28 nodes, the panel's boxes none of them
        const a11y = await dev.evaluate(A11Y);
        const roles = a11y.map((n) => n.line);
        if (a11y.length !== 28) bad("a11y, the node count", `${a11y.length} nodes, want 28 (solid/dev.test.ts's rows)`);
        else ok("a11y, the node count", `28 nodes, the Widgets page's: ${a11y.slice(0, 3).map((n) => n.role).join(", ")}, ...`);
        if (roles[0] !== 'button "Presses: 0"' || roles[1] !== 'switch "Wi-Fi" [checked=false]' ||
            roles[2] !== "group" || roles[9] !== 'radio "1x" [checked=true]' || roles[27] !== 'treeitem "Storage" [selected=false]')
            bad("a11y, the rows", `the tree reads ${roles.slice(0, 3).join(" | ")} ... ${roles[27]}`);
        else ok("a11y, the rows", `the button, the switch, the unnamed group, ..., the radios and the tree's last item, ` +
            `as the desktop's panel prints them`);
        // the panel is not the page: no node is inside its 300px, and the page's own boxes are
        const outside = a11y.filter((n) => n.bounds && n.bounds[0] + n.bounds[2] > 360.5);
        const wifi = a11y.find((n) => n.role === "switch");
        if (outside.length) bad("a11y, the panel", `${outside.length} node(s) are in the panel's column: ${outside.map((n) => n.line).join("; ")}`);
        else if (!wifi?.bounds || wifi.bounds[0] !== 40 || wifi.bounds[2] !== 280)
            bad("a11y, the page's boxes", `the switch's bounds are ${format(wifi?.bounds ?? null)}, not 40,y 280xh`);
        else ok("a11y, the panel", `no node of the tree is in the panel's column (every box ends at x <= 360); ` +
            `the page's switch is ${wifi.bounds.map(Math.round).join(",")}`);

        // --- (c) the hover: the pointer onto the Widgets button, and the panel's line names it
        const press = await dev.evaluate(() => window.__page.bounds("press"));
        await dev.evaluate(([x, y]) => {
            window.__page.pointer(x, y, false);
            window.__page.warm(2);
        }, [press[0] + 12, press[1] + press[3] / 2]);
        const hovered = (await texts(dev)).filter((t) => t.startsWith("press  "));
        const boxLine = `${Math.round(press[0])},${Math.round(press[1])} ${Math.round(press[2])}×${Math.round(press[3])}`;
        if (hovered.length !== 2)
            bad("hover, the panel's readout", `the panel has ${hovered.length} lines naming the button: ${hovered.join(" | ")}`);
        else if (hovered[0] !== 'press  button "Presses: 0"' || hovered[1] !== `press  button "Presses: 0"  ${boxLine}`)
            bad("hover, the panel's readout", `the panel's lines are ${hovered.map((t) => JSON.stringify(t)).join(" and ")}, ` +
                `not the button's id, role, name and box`);
        else ok("hover, the panel's readout", `the panel prints ${JSON.stringify(hovered[0])} and, in the live values, ` +
            `${JSON.stringify(hovered[1])} with the pointer on the button: ui.over is the pointer the shell fed the frame`);
        // the panel is not the page: the pointer over a panel row reports nothing (and the pin keeps the last box)
        await dev.evaluate(() => {
            window.__page.pointer(600, 300, false);
            window.__page.warm(2);
        });
        const overPanel = (await texts(dev)).find((t) => t === "nothing");
        if (overPanel === undefined) bad("hover, the panel's own boxes", "the pointer over the panel's rows reports a box of the page");
        else ok("hover, the panel's own boxes", 'the pointer over the panel prints "nothing" (and the values keep the last box)');

        // --- (d) the keys: the DOM focus, Tab twice, Space; the panel's row, the hash, and 30 frames at rest
        const rect = await dev.locator("#frame").boundingBox();
        await dev.mouse.click(rect.x + 6, rect.y + 6); // the page's padding: empty space, so nothing is pinned or toggled
        const focused = await dev.evaluate(() => document.activeElement?.id ?? null);
        if (focused !== "frame") bad("DOM focus", `a press on the canvas leaves the focus on ${focused ?? "nothing"}, not the frame`);
        else ok("DOM focus", "a press on the canvas focuses it (tabindex=0), so its keydown is the page's");
        await dev.keyboard.press("Tab");
        await dev.evaluate(() => window.__page.warm(2));
        const oneTab = (await texts(dev)).find((t) => t.startsWith('button "Presses: 0" [focused'));
        await dev.keyboard.press("Tab");
        await dev.evaluate(() => window.__page.warm(2));
        const twoTab = (await texts(dev)).find((t) => t.startsWith('switch "Wi-Fi"'));
        if (oneTab === undefined) bad("Tab: the first stop", "the panel's first row does not say the button is focused");
        else if (!twoTab?.startsWith('switch "Wi-Fi" [checked=false focused=true] '))
            bad("Tab Tab: the switch", `the panel's switch row is ${JSON.stringify(twoTab)}, not focused`);
        else ok("Tab Tab: the switch", `the panel's row is ${JSON.stringify(twoTab)}: the focus is the page's own Input's`);
        const before = await dev.evaluate(() => ({
            hash: window.__page.hash(), draws: window.__page.draws(), presents: window.__page.presents() }));
        await dev.keyboard.press("Space");
        await dev.evaluate(() => window.__page.warm(3));
        const after = await dev.evaluate(() => ({
            hash: window.__page.hash(), draws: window.__page.draws(), presents: window.__page.presents() }));
        const checked = (await texts(dev)).find((t) => t.startsWith('switch "Wi-Fi"'));
        if (!checked?.startsWith('switch "Wi-Fi" [checked=true focused=true] '))
            bad("Space: the panel's row", `the panel's switch row is ${JSON.stringify(checked)}, not checked`);
        else ok("Space: the panel's row", `the panel's row is ${JSON.stringify(checked)}`);
        if (after.hash === before.hash) bad("Space: the frame's hash", `the hash is ${after.hash} before and after the key`);
        else ok("Space: the frame's hash", `the frame's hash ${before.hash.slice(0, 8)}... -> ${after.hash.slice(0, 8)}...`);
        if (!(after.draws > before.draws && after.presents > before.presents))
            bad("Space: the counters", `draws ${before.draws} -> ${after.draws}, presents ${before.presents} -> ${after.presents}: ` +
                "the key's frame did not draw");
        else ok("Space: the counters", `the key's frame drew: draws ${before.draws} -> ${after.draws}, ` +
            `presents ${before.presents} -> ${after.presents}`);
        // the panel's own counter line, then 30 frames with no input
        const counter = (await texts(dev)).find((t) => /^draws \d+ {2}presents \d+$/.test(t));
        if (counter === undefined) bad("the panel's counters", "no `draws N presents M` line in the panel");
        else ok("the panel's counters", `the panel prints ${JSON.stringify(counter)} from solid/app/Dev.tsx's frameOf`);
        const idleBefore = await dev.evaluate(() => [window.__page.draws(), window.__page.presents()]);
        await dev.evaluate(() => window.__page.warm(30));
        const idleAfter = await dev.evaluate(() => [window.__page.draws(), window.__page.presents()]);
        if (idleAfter[0] !== idleBefore[0] || idleAfter[1] !== idleBefore[1])
            bad("30 frames at rest", `draws ${idleBefore[0]} -> ${idleAfter[0]}, presents ${idleBefore[1]} -> ${idleAfter[1]}`);
        else ok("30 frames at rest", `0 draws and 0 presents in 30 frames (draws ${idleAfter[0]}, presents ${idleAfter[1]} ` +
            `stand still)`);
        const devMs = await dev.evaluate(() => window.__page.bench(100));

        // --- (e) the Text sheet: its golden and its raster
        const sheet = await open("/browser/solid/sheet.html?bench=0", SHEET);
        try {
            await sheet.evaluate(() => window.__page.warm(2));
            const sheetErrors = await sheet.evaluate(() => window.__page.errors());
            if (sheetErrors) bad("clay, sheet", `${sheetErrors} Clay errors`); else ok("clay, sheet", "no errors");
            // the fallback line of "Wm ¼ ⅓ — “quotes”" is 7.24 px wider in Canvas2D than in ThorVG's one face: the ⅓ is
            // another font's glyph here, and the box carries its advance, so this page's golden is held to 8 px
            compareGolden("commands, the Text sheet vs solid/goldens/sheet.json", SHEET_GOLDEN, await dump(sheet), 8);
            const sheetCommands = await commands(sheet);
            const sheetRegions = await sheet.evaluate(REGIONS, { refURL: SHEET_FRAME, boxes: sheetCommands, width: SHEET.width, height: SHEET.height });
            assertRegions("raster, the Text sheet vs the desktop's solid/frames/text-sheet.png", sheetRegions,
                { regionMax: 20, inkMax: 4, meanMax: 3, pixelPct: 12 });
            const idle = await sheet.evaluate(() => [window.__page.draws(), window.__page.warm(30), window.__page.draws()]);
            if (idle[2] !== idle[0]) bad("the sheet at rest", `${idle[2] - idle[0]} draws in 30 frames`);
            else ok("the sheet at rest", "the static page draws nothing after its first frame (30 frames)");
            const sheetMs = await sheet.evaluate(() => window.__page.bench(100));
            const [devBundle, sheetBundle] = await Promise.all([stat(DEV_BUNDLE), stat(SHEET_BUNDLE)]);
            const wasm = (await stat(join(WASM_DIR, "ui.wasm"))).size;
            const [devHtml, sheetHtml] = await Promise.all([stat(join(BROWSER, "solid/dev.html")), stat(join(BROWSER, "solid/sheet.html"))]);
            console.log(`info ${devBundle.size} B of bundle (dev.js), ${devHtml.size} B of dev.html, ${sheetBundle.size} B ` +
                `(sheet.js), ${sheetHtml.size} B of sheet.html, on the same ui.wasm (${wasm} B)`);
            console.log(`info ${devMs.toFixed(2)} ms a frame on the Dev page (the page and the panel: 28 a11y nodes, the ` +
                `hover walk, the panel sampled), ${sheetMs.toFixed(2)} on the sheet (100 frames: declare, Clay's layout, ` +
                `the commands, Canvas2D's raster, one readback)`);
        } finally {
            await sheet.close();
        }
        if (logs.some(l => l.startsWith("pageerror"))) bad("page", logs.filter(l => l.startsWith("pageerror")).join("; "));
    } finally {
        await dev.close();
        await browser.close();
        server.close();
    }
    if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
    console.log("browser/solid/dev: ok");
}

main();
