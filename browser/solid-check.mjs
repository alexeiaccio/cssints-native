// The Solid pages in the browser, checked against the two things that make them the same pages as the desktop's:
//
//   (a) their command arrays. browser/ui.c dumps the frame through desktop/clay_dump.c — the emitter every host writes —
//       and each page's base frame is compared with its golden (solid/goldens/sensors.json, solid/goldens/widgets.json),
//       the goldens the Solid pages on the desktop and the generated C page are held to: every field exactly, the boxes
//       within 4 px (the goldens' are ThorVG's metrics; Canvas2D does not hint a font, so a 20 px line comes out a few px
//       wider and a centred box moves by half, and each line's rounded-up height pushes the rows below it down a little).
//   (b) a click on the Units pill (Sensors). The real one: Playwright puts the mouse on the pill, the page's DOM listeners
//       set the pointer src/frame.ts's View reads, and the release runs the element's onClick. The frame it makes must be
//       the no-JS page's use_g frame — the same wasm layout, the same Canvas2D measure — field for field, box for box; the
//       no-JS page (browser/index.html) is opened beside this one for it, so the comparison is between two runs of the
//       same Clay and the same font, and a difference is this page's alone.
//   (c) their rasters. Each canvas against the browser's own stored frame — browser/expected.png for Sensors,
//       browser/expected-widgets.png for Widgets (this run's, rewritten with --update): every 8x8 block's mean colour
//       within 3/255 and 2% of the pixels, check.mjs's tolerance for this browser's own frames. And against the desktop's
//       own frame (solid/frames/widgets-initial.png), the way check.mjs holds this browser to ThorVG's: the mean colour of
//       every command's box (the ones at least 8x8 px: a thin band cannot survive the 4 px the boxes may differ by), each
//       text line's ink box, and the frame's mean colour, with check.mjs's numbers (region 20/255, ink 4 px, frame mean
//       3/255, 12% of pixels).
//   (d) the keyboard (Widgets), the one thing no stored frame can show: Playwright's keys into the page's DOM listeners,
//       browser/solid/keys.ts's names, the page's own Input. Tab twice focuses the Wi-Fi switch — in the page's
//       accessibility tree (solid/a11y.ts's snapshot of the same Solid tree) and in the pixels (the 2 px ring's colour at
//       the switch's edge); Space checks it (the tree's `checked`, the track's fill from #3c404e to #f08c32, and a pixel
//       of it); Tab on to the settings tree and ArrowDown move the roving node (the tree item's `focused` state).
//
//   node browser/solid-check.mjs            the check (build first: sh browser/build.sh && bun browser/solid/build.ts)
//   node browser/solid-check.mjs --update   rewrite browser/expected-widgets.png from this run
//   node browser/solid-check.mjs --serve    serve the pages and print their URLs, for looking at them by hand
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// the goldens' formatter (solid/dump.ts stores them with it), for a field's message
import { format } from "../solid/src/format.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BROWSER = join(ROOT, "browser");
const WASM_DIR = process.env.WASM_DIR || join(process.env.TMPDIR || "/tmp", "cssints-native-web");
const BUNDLE = join(WASM_DIR, "solid/page.js");
const WIDGETS_BUNDLE = join(WASM_DIR, "solid/widgets.js");
const SIZE = 360;
const WIDGETS_SIZE = 760;
const update = process.argv.includes("--update");

// the goldens the pages are held to: each page's last frame on the desktop, the same trees as the generated C
const GOLDEN = JSON.parse(readFileSync(join(ROOT, "solid/goldens/sensors.json"), "utf8"));
const WIDGETS_GOLDEN = JSON.parse(readFileSync(join(ROOT, "solid/goldens/widgets.json"), "utf8"));

const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".ttf": "font/ttf",
    ".png": "image/png", ".json": "application/json" };
let failures = 0;
const ok = (name, extra = "") => console.log(`ok   ${name}${extra ? " — " + extra : ""}`);
const bad = (name, why) => { failures++; console.log(`FAIL ${name}: ${why}`); };

function serve() {
    return new Promise(done => {
        const server = createServer(async (req, res) => {
            const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
            // the build products, outside the repo: the two wasms and the two bundles
            const built = path === "/browser/page.wasm" ? join(WASM_DIR, "page.wasm")
                : path === "/browser/solid/ui.wasm" ? join(WASM_DIR, "ui.wasm")
                : path === "/browser/solid/page.js" ? BUNDLE
                : path === "/browser/solid/widgets.js" ? WIDGETS_BUNDLE
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

/** The no-JS page has no id strings: its dump names nothing, and the Solid page's names fill a command's `element`. */
function named(dump, names) {
    for (const command of dump.commands)
        if (command.element == null && names.has(command.id)) command.element = names.get(command.id);
}

/** (a) a base frame against its golden: every field exactly but the boxes (ThorVG's metrics; `boxMax` px). */
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
    ok(name, `${want.length} commands, same order and fields as the golden; worst box ${worst.toFixed(2)}px ` +
        `(${where}: the line heights Canvas2D's measure rounds up)`);
}

/** (b) a frame against the no-JS page's: the same Clay, the same font — every field and every box, exactly. */
function compareSamePage(name, want, got) {
    if (got.commands.length !== want.commands.length)
        return bad(name, `${got.commands.length} commands, the no-JS page's ${want.commands.length}`);
    let worst = 0, worstAt = 0;
    for (let i = 0; i < want.commands.length; i++) {
        const a = want.commands[i], b = got.commands[i];
        const text = typeof b.text === "string" ? ` ${JSON.stringify(b.text)}` : "";
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
                return bad(who, `${key === "color" ? "colour" : key} ${format(b[key])}, the no-JS page's ${format(a[key])}`);
        }
    }
    // both measured by the same Canvas2D call on the same bytes: anything but rounding is a different frame
    if (worst > 1e-3) return bad(name, `command ${worstAt}'s box is ${worst.toFixed(3)}px off the no-JS page's`);
    if (format(want.effects) !== format(got.effects))
        return bad(`${name} effects`, `${format(got.effects)}, the no-JS page's ${format(want.effects)}`);
    ok(name, `${want.commands.length} commands, every field and box the same; worst box ${worst.toExponential(1)}px`);
}

/** (c1) a raster as 8x8 block means, done in the page: the canvas and a reference image, both on a 2D canvas. */
const DIFF = async (refURL) => {
    const canvas = document.getElementById('frame');
    const a = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const img = new Image();
    img.src = refURL;
    await img.decode();
    const rc = document.createElement('canvas');
    rc.width = a.width;
    rc.height = a.height;
    const rcx = rc.getContext('2d');
    rcx.drawImage(img, 0, 0, a.width, a.height);
    const b = rcx.getImageData(0, 0, a.width, a.height).data;
    const B = 8, cols = Math.ceil(a.width / B), rows = Math.ceil(a.height / B);
    const blocks = new Float32Array(cols * rows);
    let differing = 0;
    for (let y = 0; y < a.height; y++) {
        for (let x = 0; x < a.width; x++) {
            const i = (y * a.width + x) * 4;
            let d = 0;
            for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(a.data[i + k] - b[i + k]));
            if (d > 0) differing++;
            blocks[Math.floor(y / B) * cols + Math.floor(x / B)] += d / (B * B);
        }
    }
    let worstBlock = 0, worstAt = 0;
    for (let i = 0; i < blocks.length; i++) if (blocks[i] > worstBlock) worstBlock = blocks[i], worstAt = i;
    return { differing, total: a.width * a.height, worstBlock, worstAt: [worstAt % cols, Math.floor(worstAt / cols)] };
};

function assertBlocks(name, diff, { blockMax, pixelPct }) {
    const pct = (100 * diff.differing) / diff.total;
    if (diff.worstBlock > blockMax) return bad(name, `block ${diff.worstAt} differs by ${diff.worstBlock.toFixed(1)}/255, over ${blockMax}`);
    if (pct > pixelPct) return bad(name, `${pct.toFixed(1)}% of pixels differ, over ${pixelPct}%`);
    ok(name, `${pct.toFixed(2)}% of pixels differ, worst 8x8 block ${diff.worstBlock.toFixed(1)}/255 at (${diff.worstAt})`);
}

/** (c2) another rasteriser's frame: per command box, the mean colour of the region and, for text, its ink box. */
const REGIONS = async ({ refURL, boxes, min }) => {
    const canvas = document.getElementById('frame');
    const a = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const img = new Image();
    img.src = refURL;
    await img.decode();
    const rc = document.createElement('canvas');
    rc.width = a.width;
    rc.height = a.height;
    const rcx = rc.getContext('2d');
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
    // a text box's background is the fill of the last rectangle drawn before it (the root's, or the row's); ink is what
    // is far from that colour, so anti-aliased edge pixels do not count as glyph
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const inkBox = (d, box, bg) => {
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        for (let y = Math.max(0, box.y); y < Math.min(a.height, box.y + box.h); y++)
            for (let x = Math.max(0, box.x); x < Math.min(a.width, box.x + box.w); x++) {
                const i = (y * a.width + x) * 4;
                const dd = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
                if (dd > 120) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
            }
        return x1 < 0 ? null : [x0, x1, y0, y1];
    };
    // the whole frame's mean colour: moved ink cancels out, a wrong palette does not
    let differing = 0;
    const meanA = [0, 0, 0], meanB = [0, 0, 0];
    for (let i = 0; i < a.data.length; i += 4) {
        if (a.data[i] !== b[i] || a.data[i + 1] !== b[i + 1] || a.data[i + 2] !== b[i + 2]) differing++;
        for (let k = 0; k < 3; k++) meanA[k] += a.data[i + k], meanB[k] += b[i + k];
    }
    const n = a.width * a.height;
    const frameMean = Math.max(...meanA.map((v, k) => Math.abs(v / n - meanB[k] / n)));
    const regionDelta = [], inkDelta = [];
    let fill = '#000000'; // the last rectangle's colour: a text box's background
    for (const box of boxes) {
        if (box.type === 1) fill = box.color;
        const r = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) };
        r.x = Math.max(0, r.x), r.y = Math.max(0, r.y);
        r.w = Math.min(a.width - r.x, r.w), r.h = Math.min(a.height - r.y, r.h);
        // a region thinner than `min` is not compared: the boxes may differ by up to 4 px, so a 4 px band is all offset
        if (r.w < min || r.h < min) continue;
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
    return { differing, total: n, frameMean, region: worst(regionDelta), ink: worst(inkDelta) };
};

function assertRegions(name, diff, { regionMax, inkMax, meanMax, pixelPct }) {
    const pct = (100 * diff.differing) / diff.total;
    if (diff.region.delta > regionMax)
        return bad(name, `the region of ${JSON.stringify(diff.region.box.text || diff.region.box.type)} at ` +
            `(${diff.region.box.x},${diff.region.box.y}) ${diff.region.box.w}x${diff.region.box.h} differs by ` +
            `${diff.region.delta.toFixed(1)}/255 in the mean, over ${regionMax}`);
    if (diff.ink.delta > inkMax)
        return bad(name, `the ink of "${diff.ink.box.text}" is ${diff.ink.delta.toFixed(0)}px off (${diff.ink.ia} vs ${diff.ink.ib}), over ${inkMax}`);
    if (diff.frameMean > meanMax) return bad(name, `the frame's mean colour is ${diff.frameMean.toFixed(2)}/255 off, over ${meanMax}`);
    if (pct > pixelPct) return bad(name, `${pct.toFixed(1)}% of pixels differ, over ${pixelPct}%`);
    ok(name, `${pct.toFixed(2)}% of pixels differ; region means within ${diff.region.delta.toFixed(1)}/255, ` +
        `text ink within ${diff.ink.delta.toFixed(2)}px ("${diff.ink.box?.text}"), the frame's mean colour within ${diff.frameMean.toFixed(2)}/255`);
}

/** A node of the page's accessibility snapshot, by role and name (solid/a11y.ts's `snapshot`, run in the page). */
function findNode([role, name]) {
    const find = (node) => {
        if (node.role === role && (name === undefined || node.name === name)) return node;
        for (const child of node.children) {
            const hit = find(child);
            if (hit) return hit;
        }
        return undefined;
    };
    return find(window.__page.a11y());
}

/** The focused nodes of the snapshot: the states a key changes. */
function focusedNodes() {
    const out = [];
    const walk = (node) => {
        if (node.states.focused) out.push({ role: node.role, name: node.name, states: node.states });
        for (const child of node.children) walk(child);
    };
    walk(window.__page.a11y());
    return out;
}

/** The RGBA of one pixel of the page's canvas, in layout pixels. */
const pixelAt = ([x, y]) => Array.from(document.getElementById("frame").getContext("2d").getImageData(x, y, 1, 1).data);

/** The switch's track: the only 44x24 rectangle of the frame (the page's s.track). */
const trackOf = () => window.__page.commands().find((c) => c.type === 1 && c.w === 44 && c.h === 24);

const RING = "90,170,255,255"; // the focus ring's token: Widgets' t.color.ring
const TRACK = { off: "#3c404e", on: "#f08c32" }; // the switch's track: t.color.off, t.color.on

/** The Widgets page: the keys no stored frame can drive, and the switch and tree they move through. */
async function checkKeyboard(page) {
    const box = await page.locator("#frame").boundingBox();
    // a press on the page's own padding (28px of it at the top): empty space, so nothing is focused or toggled, and the
    // canvas takes the DOM's focus, which is what a keydown needs
    await page.mouse.click(box.x + 6, box.y + 6);
    const focused = await page.evaluate(() => document.activeElement?.id ?? null);
    if (focused !== "frame") bad("DOM focus", `a press on the canvas leaves the focus on ${focused ?? "nothing"}, not the frame`);
    else ok("DOM focus", "a press on the canvas focuses it (tabindex=0), so its keydown is the page's");

    // Tab twice: the button, then the switch
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const wifi = await page.evaluate(findNode, ["switch", "Wi-Fi"]);
    if (wifi?.states.focused !== true) return bad("Tab Tab: the switch", `the snapshot's switch is ${format(wifi?.states ?? null)}, not focused`);
    ok("Tab Tab: the switch", `the snapshot has role switch, name "Wi-Fi", focused (bounds ${format(wifi.bounds)})`);
    // ... and the ring is the pixels: the 2px border's colour one px inside the row's left edge
    const [wx, wy, , wh] = wifi.bounds;
    const ring = await page.evaluate(pixelAt, [wx + 1, wy + wh / 2]);
    if (ring.join(",") !== RING) bad("Tab Tab: the ring", `the switch's edge is ${ring.join(",")}, not the ring's ${RING}`);
    else ok("Tab Tab: the ring", `the switch's edge is ${RING} (t.color.ring), as the desktop's stored frame draws it`);

    // Space: checked in the tree, and the track's fill from the off token to the accent
    const before = await page.evaluate(trackOf);
    if (before?.color !== TRACK.off) bad("Space: the track before", `the track is ${before?.color}, not ${TRACK.off}`);
    await page.keyboard.press("Space");
    const after = await page.evaluate(trackOf);
    const checked = await page.evaluate(findNode, ["switch", "Wi-Fi"]);
    if (checked?.states.checked !== true) bad("Space: checked", `the snapshot's switch is ${format(checked?.states ?? null)}, not checked`);
    else ok("Space: checked", "the snapshot's switch has checked: true");
    if (after?.color !== TRACK.on) return bad("Space: the fill", `the track is ${after?.color}, not the accent ${TRACK.on} (it was ${before?.color})`);
    ok("Space: the fill", `the track's fill ${before?.color} -> ${after?.color} (t.color.off -> t.color.accent)`);
    // the thumb has moved to the right end, so the accent is what the left half of the track now shows
    const [tx, ty, , th] = [after.x, after.y, after.w, after.h];
    const fillPixel = await page.evaluate(pixelAt, [tx + 10, ty + th / 2]);
    if (fillPixel.join(",") !== "240,140,50,255") bad("Space: the pixel", `the track's left half is ${fillPixel.join(",")}, not the accent 240,140,50,255`);
    else ok("Space: the pixel", "the track's left half is the accent 240,140,50,255: the thumb is at its right end");

    // the settings tree: ten more Tabs reach it, and ArrowDown moves the roving node
    for (let n = 0; n < 10; n++) await page.keyboard.press("Tab");
    const network = await page.evaluate(findNode, ["treeitem", "Network"]);
    if (network?.states.focused !== true) bad("Tab to the tree", `the snapshot's "Network" is ${format(network?.states ?? null)}, not focused`);
    else ok("Tab to the tree", "the snapshot's first tree item, \"Network\", is focused (the tree is one stop)");
    await page.keyboard.press("ArrowDown");
    const afterDown = await page.evaluate(focusedNodes);
    const roving = afterDown.find((n) => n.role === "treeitem" && n.name === "Wi-Fi");
    if (roving?.states.focused !== true) bad("ArrowDown in the tree", `the snapshot's tree items are ${format(afterDown)}, "Wi-Fi" is not focused`);
    else ok("ArrowDown in the tree", `the roving node is "${roving.name}" (${format(afterDown.length)} node focused, "Network" left)`);
}

async function main() {
    const missing = [join(WASM_DIR, "page.wasm"), join(WASM_DIR, "ui.wasm"), BUNDLE, WIDGETS_BUNDLE].filter(f => !existsSync(f));
    if (missing.length) {
        console.log(`missing build product(s): ${missing.join(", ")}`);
        console.log(`run "sh browser/build.sh && bun browser/solid/build.ts" first`);
        process.exit(1);
    }
    const { server, port } = await serve();
    if (process.argv.includes("--serve")) {
        console.log(`http://127.0.0.1:${port}/browser/solid/index.html     (Sensors, Ctrl-C to stop)`);
        console.log(`http://127.0.0.1:${port}/browser/solid/widgets.html   (Widgets, the keys: click the frame first)`);
        console.log(`http://127.0.0.1:${port}/browser/index.html           (the no-JS page)`);
        return; // no browser to drive: serve the pages for a person to open
    }
    const browser = await chromium.launch();
    const viewport = { width: SIZE + 80, height: SIZE + 160 };
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const cPage = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const wPage = await browser.newPage({ viewport: { width: SIZE + 80, height: WIDGETS_SIZE + 160 }, deviceScaleFactor: 1 });
    const logs = [];
    for (const p of [page, cPage, wPage]) {
        p.on("console", m => logs.push(m.text()));
        p.on("pageerror", e => logs.push(`pageerror: ${e.message}`));
    }

    try {
        // the no-JS page: the frame its own state machine reaches through the same click at the same point, the reference
        // this page's click is compared with (its table is the generated one: press, release on the pill)
        await cPage.goto(`http://127.0.0.1:${port}/browser/index.html`);
        await cPage.waitForFunction(() => window.__page, null, { timeout: 15000 });
        await cPage.evaluate(() => (window.__page.press(180, 248), window.__page.release(180, 248)));
        const cState = await cPage.evaluate(() => [window.__page.state(), window.__page.stateName(window.__page.state())]);
        const cDump = JSON.parse(await cPage.evaluate(() => window.__page.dump()));

        await page.goto(`http://127.0.0.1:${port}/browser/solid/index.html`);
        await page.waitForFunction(() => window.__page, null, { timeout: 20000 });
        // the page's first-mount entry (the root's 8px rise and fade over 0.25s) writes the value channel, which this
        // target's commands do not carry; 31 frames at 1/60 is solid/dump.ts's `--warm 30`, past the settle
        await page.evaluate(() => window.__page.warm(31));

        const errors = await page.evaluate(() => window.__page.errors());
        if (errors) bad("clay", `${errors} Clay errors`); else ok("clay", "no errors");

        // (a) the base frame
        const base = JSON.parse(await page.evaluate(() => window.__page.dump()));
        compareGolden("commands, Sensors base frame vs solid/goldens/sensors.json", GOLDEN, base, 4);

        // (c) the raster, before any click moves the page
        const diff = await page.evaluate(DIFF, "/browser/expected.png");
        assertBlocks("raster, Sensors base frame vs browser/expected.png", diff, { blockMax: 3, pixelPct: 2 });

        // (b) the click: the real input path — Playwright's mouse, the page's DOM listeners, src/frame.ts's events, the
        // Units element's onClick. The pill is at x 80..280, y 228.6..266.6 (the golden's box), so its centre is (180, 250)
        const rect = await page.locator("#frame").boundingBox();
        await page.mouse.move(rect.x + 180, rect.y + 250);
        await page.mouse.down();
        await page.mouse.up();
        await page.waitForFunction(() => window.__page.commands().some(c => c.text === "switch to m/s²"), null, { timeout: 5000 });
        ok("click on the Units pill", "the frame is the use_g one");

        // the pointer is still on the pill, so the frame carries its :hover (the value channel's states are the page's,
        // and the no-JS page has no events at all): 48,53,68 is the hover token, 36,40,52 the surface it rests on
        const hovered = await page.evaluate(() => window.__page.commands().find(c => c.type === 1 && c.w === 200));
        if (hovered?.color !== "#303544") bad("hover after the click", `the pill is ${hovered?.color}, not its hover #303544`);
        else ok("hover after the click", "the pill is on its hover token #303544");

        // ... and with the pointer still on the pill the frame is the no-JS page's clicked frame (its state machine's
        // "use_g + hover Units"), field for field and box for box: the two is the same Clay tree, laid out by Clay in
        // each and measured by the same Canvas2D
        await page.evaluate(() => window.__page.warm(2));
        const clicked = JSON.parse(await page.evaluate(() => window.__page.dump()));
        const names = new Map();
        for (const command of clicked.commands) if (command.element) names.set(command.id, command.element);
        named(cDump, names);
        compareSamePage(`commands, after the click vs the no-JS page's state ${cState[0]} "${cState[1]}"`, cDump, clicked);

        // the release is the click: a second one goes back, and its frame is the base frame again, field for field
        await page.mouse.move(rect.x + 180, rect.y + 250);
        await page.mouse.down();
        await page.mouse.up();
        await page.waitForFunction(() => window.__page.commands().some(c => c.text === "switch to g"), null, { timeout: 5000 });
        await page.evaluate(() => window.__page.pointer(10, 10));
        await page.evaluate(() => window.__page.warm(2));
        const back = JSON.parse(await page.evaluate(() => window.__page.dump()));
        compareSamePage("commands, after the second click vs the base frame", base, back);

        await page.evaluate(() => window.__page.warm(3));
        const ms = await page.evaluate(() => window.__page.bench(100));
        const bundle = (await stat(BUNDLE)).size;
        const wasm = (await stat(join(WASM_DIR, "ui.wasm"))).size;
        const html = (await stat(join(BROWSER, "solid/index.html"))).size;
        console.log(`info ${bundle} B of bundle (page.js), ${wasm} B of wasm (ui.wasm), ${html} B of index.html`);
        console.log(`info ${ms.toFixed(2)} ms a frame (100 frames: the tree declared, Clay's layout, the commands, ` +
            `Canvas2D's raster, one readback)`);

        // --- the Widgets page: the same tree and shell, a page that takes keys
        await wPage.goto(`http://127.0.0.1:${port}/browser/solid/widgets.html`);
        await wPage.waitForFunction(() => window.__page, null, { timeout: 20000 });
        await wPage.evaluate(() => window.__page.warm(31));
        const wErrors = await wPage.evaluate(() => window.__page.errors());
        if (wErrors) bad("clay, widgets", `${wErrors} Clay errors`); else ok("clay, widgets", "no errors");

        // (a) the base frame against the page's golden
        const wBase = JSON.parse(await wPage.evaluate(() => window.__page.dump()));
        compareGolden("commands, Widgets base frame vs solid/goldens/widgets.json", WIDGETS_GOLDEN, wBase, 4);

        // (c) the raster: the browser's own stored frame, then the desktop's. The page's own frame is the canvas's own
        // pixels (toDataURL), not a screenshot: the element's CSS box rounds to 761 px at 760, and an element screenshot
        // would be a scaled copy of it
        const shot = Buffer.from((await wPage.evaluate(() => document.getElementById("frame").toDataURL("image/png")))
            .slice("data:image/png;base64,".length), "base64");
        const own = join(BROWSER, "expected-widgets.png");
        if (update || !existsSync(own)) {
            await writeFile(own, shot);
            console.log(`wrote browser/expected-widgets.png (${shot.length} bytes)`);
        } else {
            const ownDiff = await wPage.evaluate(DIFF, "/browser/expected-widgets.png");
            assertBlocks("raster, Widgets base frame vs browser/expected-widgets.png", ownDiff, { blockMax: 3, pixelPct: 2 });
        }
        // the design's frame: ThorVG's raster of the same page on the desktop, per command box (check.mjs's numbers)
        const wBoxes = await wPage.evaluate(() => window.__page.commands());
        const regions = await wPage.evaluate(REGIONS, { refURL: "/solid/frames/widgets-initial.png", boxes: wBoxes, min: 16 });
        assertRegions("raster, Widgets base frame vs the desktop's solid/frames/widgets-initial.png", regions,
            { regionMax: 20, inkMax: 4, meanMax: 3, pixelPct: 12 });

        // (d) the keys: the one thing a stored frame cannot show
        await checkKeyboard(wPage);

        const wMs = await wPage.evaluate(() => window.__page.bench(100));
        const wBundle = (await stat(WIDGETS_BUNDLE)).size;
        const wHtml = (await stat(join(BROWSER, "solid/widgets.html"))).size;
        console.log(`info ${wBundle} B of bundle (widgets.js) and ${wHtml} B of widgets.html, on the same ui.wasm ` +
            `(${wasm} B)`);
        console.log(`info ${wMs.toFixed(2)} ms a frame on Widgets (100 frames: declare, Clay's layout, the commands, ` +
            `Canvas2D's raster, one readback)`);
        if (logs.some(l => l.startsWith("pageerror"))) bad("page", logs.filter(l => l.startsWith("pageerror")).join("; "));
    } finally {
        await browser.close();
        server.close();
    }
    if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
    console.log("browser/solid: ok");
}

main();
