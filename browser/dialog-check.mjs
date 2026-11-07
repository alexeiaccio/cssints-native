// The Dialog page in the browser, checked against the desktop's own frames and against the two things a command array
// cannot show: the floats' entry through the value channel and the menu's glass.
//
//   (a) the closed frame against solid/frames/dialog-closed.png, the way browser/check.mjs holds this browser to ThorVG's:
//       the mean colour of every command's box (at least 16x16 px), each text line's ink box, and the frame's mean
//       colour (20/255, 4 px, 3/255, 12% of the pixels).
//   (b) Enter opens the modal (Tab to its trigger first, as the desktop's `--keys Tab,Enter`): the open frame against
//       frames/dialog-open.png with the same tolerances, a pixel of the panel's shadow (darker than the dimmed page
//       beside it) and a pixel of the backdrop's dim (the page at 0.55 of black: 16,18,24 -> 7,8,11).
//   (c) the entry three frames in, against frames/dialog-entry-mid.png, and against the value channel itself: the panel
//       is above its rest by the float's offset y, and the group's alpha and scale make it translucent and 3 px inside
//       its box. `keyboard.down` and three `warm` frames put the motion clock on exactly 3/60, the stored frame's.
//   (d) the menu two frames into its slide against solid/goldens/dialog.json — the one golden with a backdrop, a group
//       and a shadow in the same frame, so the browser surface's tables are compared field for field (the boxes within
//       4 px); then the settled menu against frames/dialog-menu.png (the glass), and the blur itself as an A/B against
//       the same page with `?glass=0` (the app's `glass` prop): the trigger's border under the menu is softened, no
//       pixel outside the menu moves, and the two pages' frame ms isolate the blur's cost.
//   (e) Escape closes it and the frame comes back to the closed page (pixel for pixel, after a press on empty space
//       releases the trigger's focus), and the trap: Tab cycles Cancel and OK, never the page's own controls.
//
//   node browser/dialog-check.mjs            the check (build first: sh browser/build.sh && bun browser/solid/build.ts)
//   node browser/dialog-check.mjs --serve    serve the page and print its URL, for looking at it by hand
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
const BUNDLE = join(WASM_DIR, "solid/dialog.js");
const SIZE = { width: 360, height: 480 };
// the design's frames: the Dialog page on the desktop, ThorVG's software canvas
const CLOSED = "/solid/frames/dialog-closed.png";
const OPEN = "/solid/frames/dialog-open.png";
const ENTRY = "/solid/frames/dialog-entry-mid.png";
const MENU = "/solid/frames/dialog-menu.png";
const GOLDEN = JSON.parse(readFileSync(join(ROOT, "solid/goldens/dialog.json"), "utf8"));

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
                : path === "/browser/solid/dialog.js" ? BUNDLE
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

/** (a)/(b)/(c)/(d) a frame against the desktop's, done in the page: per command box a mean colour, per text an ink box. */
const REGIONS = async ({ refURL, boxes, width, height }) => {
    const a = document.getElementById("frame").getContext("2d").getImageData(0, 0, width, height);
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
                if (dd > 120) { x0 = Math.min(x0, x), x1 = Math.max(x1, x), y0 = Math.min(y0, y), y1 = Math.max(y1, y); }
            }
        return x1 < 0 ? null : [x0, x1, y0, y1];
    };
    let differing = 0;
    const meanA = [0, 0, 0], meanB = [0, 0, 0];
    for (let i = 0; i < a.data.length; i += 4) {
        if (a.data[i] !== b[i] || a.data[i + 1] !== b[i + 1] || a.data[i + 2] !== b[i + 2]) differing++;
        for (let k = 0; k < 3; k++) meanA[k] += a.data[i + k], meanB[k] += b[i + k];
    }
    const n = a.width * a.height;
    const frameMean = Math.max(...meanA.map((v, k) => Math.abs(v / n - meanB[k] / n)));
    const regionDelta = [], inkDelta = [];
    let fill = "#000000"; // the last rectangle's colour: a text box's background
    for (const box of boxes) {
        if (box.type === 1) fill = box.color;
        const r = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) };
        r.x = Math.max(0, r.x), r.y = Math.max(0, r.y);
        r.w = Math.min(a.width - r.x, r.w), r.h = Math.min(a.height - r.y, r.h);
        // a region thinner than `min` is not compared: the boxes may differ by up to 4 px
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

/** A frame against its golden: every field exactly but the boxes (ThorVG's metrics; `boxMax` px). */
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
        `(${where}); the effects tables (a shadow, a backdrop, a group) the same`);
}

/** A node of the page's accessibility snapshot, by role and name. */
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
        if (node.states.focused) out.push({ role: node.role, name: node.name });
        for (const child of node.children) walk(child);
    };
    walk(window.__page.a11y());
    return out;
}

/** The page's canvas at a layout pixel, as [r, g, b, a]. */
const pixelAt = ([x, y]) => Array.from(document.getElementById("frame").getContext("2d")
    .getImageData(Math.round(x), Math.round(y), 1, 1).data);

/** A copy of the canvas's pixels, for the frame a later one has to come back to. */
const SNAP = () => {
    const c = document.getElementById("frame");
    window.__snap = c.getContext("2d").getImageData(0, 0, c.width, c.height).data.slice();
    return window.__snap.length;
};
/** How far the canvas is from the snapshot: the differing pixels and the worst channel. */
const SNAP_DIFF = () => {
    const c = document.getElementById("frame");
    const a = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0, worst = 0;
    for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - window.__snap[i]);
        if (d) n++, (worst = Math.max(worst, d));
    }
    return { n, worst, total: a.length };
};

/** The element's box (the panel, the backdrop, a trigger) out of the frame's dump. */
const boxOf = (dump, element) => {
    const c = dump.commands.find((c) => c.element === element);
    return c ? c.box : undefined;
};
const effectOf = (dump, kind, element) => dump.effects[kind].find((e) => e.element === element);

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const apart = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const between = (c, a, b, slack = 0) => c.every((v, i) => v >= Math.min(a[i], b[i]) + slack && v <= Math.max(a[i], b[i]) - slack);

async function main() {
    const missing = [join(WASM_DIR, "ui.wasm"), BUNDLE, join(BROWSER, "solid/dialog.html")].filter(f => !existsSync(f));
    if (missing.length) {
        console.log(`missing build product(s): ${missing.join(", ")}`);
        console.log(`run "sh browser/build.sh && bun browser/solid/build.ts" first`);
        process.exit(1);
    }
    const { server, port } = await serve();
    if (process.argv.includes("--serve")) {
        console.log(`http://127.0.0.1:${port}/browser/solid/dialog.html   (Ctrl-C to stop)`);
        return; // no browser to drive: serve the page for a person to open
    }
    const browser = await chromium.launch();
    const viewport = { width: SIZE.width + 80, height: SIZE.height + 120 };
    const logs = [];
    /** A page of the app at `?bench=0` (no auto bench: every frame is the check's), its errors on `logs`. */
    async function open(url) {
        const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
        await page.addInitScript(HOLD);
        page.on("console", m => logs.push(m.text()));
        page.on("pageerror", e => logs.push(`pageerror: ${e.message}`));
        await page.goto(`http://127.0.0.1:${port}${url}`);
        await page.waitForFunction(() => window.__page, null, { polling: 100 });
        return page;
    }
    const dump = async (page) => JSON.parse(await page.evaluate(() => window.__page.dump()));
    const commands = async (page) => page.evaluate(() => window.__page.commands());
    const regions = async (page, refURL, boxes) =>
        page.evaluate(REGIONS, { refURL, boxes, width: SIZE.width, height: SIZE.height });
    const pixel = async (page, x, y) => page.evaluate(pixelAt, [x, y]);

    /** A page with the keyboard focused: a press on the page's top padding (empty space, nothing toggles). */
    async function focused(page) {
        const rect = await page.locator("#frame").boundingBox();
        await page.mouse.click(rect.x + 6, rect.y + 6);
        const active = await page.evaluate(() => document.activeElement?.id ?? null);
        if (active !== "frame") bad("DOM focus", `a press on the canvas leaves the focus on ${active ?? "nothing"}, not the frame`);
        return rect;
    }

    const page = await open("/browser/solid/dialog.html?bench=0");
    try {
        // --- (a) the page at rest
        await page.evaluate(() => window.__page.warm(31));
        const errors = await page.evaluate(() => window.__page.errors());
        if (errors) bad("clay", `${errors} Clay errors`); else ok("clay", "no errors");

        const closedDump = await dump(page);
        if (closedDump.commands.some((c) => c.element === "settings-dialog" || c.element === "settings-backdrop"))
            bad("closed", "the dialog or its backdrop is in the closed frame");
        else ok("closed", `${closedDump.commands.length} commands, the dialog and its backdrop not in the tree`);
        const closedCommands = await commands(page);
        const closedRegions = await regions(page, CLOSED, closedCommands);
        assertRegions("raster, closed frame vs the desktop's solid/frames/dialog-closed.png", closedRegions,
            { regionMax: 20, inkMax: 4, meanMax: 3, pixelPct: 12 });
        const pageSpot = await pixel(page, 10, 460);
        const msClosed = await page.evaluate(() => window.__page.bench(100));

        // --- (b) Enter opens the modal: Tab puts the focus on its trigger, Enter opens it and moves the focus inside
        await focused(page);
        await page.evaluate(SNAP); // the closed frame with no focus: what Escape has to come back to
        await page.keyboard.press("Tab");
        await page.evaluate(() => window.__page.warm(2));
        await page.keyboard.press("Enter");
        await page.evaluate(() => window.__page.warm(30));

        const openDump = await dump(page);
        const panel = boxOf(openDump, "settings-dialog");
        const dim = boxOf(openDump, "settings-backdrop");
        const shadow = effectOf(openDump, "shadows", "settings-dialog");
        if (!panel) bad("open", "the panel is not in the layout after Enter");
        else if (!dim) bad("open", "the backdrop is not in the layout after Enter");
        else if (!shadow) bad("open", "the panel's shadow is not in the effects table");
        else if (Math.round(panel[1] + panel[3] / 2) !== SIZE.height / 2)
            bad("open", `the panel's centre is y ${panel[1] + panel[3] / 2}, not the page's ${SIZE.height / 2}`);
        else ok("open", `the panel ${panel.map((v) => v.toFixed(1)).join(",")} is centred, the backdrop ` +
            `${dim.map((v) => v.toFixed(0)).join(",")} covers the page, its shadow's blur ${shadow.blur}`);
        const openCommands = await commands(page);
        const openRegions = await regions(page, OPEN, openCommands);
        // 30%, not check.mjs's 12: Canvas2D's filter and ThorVG's gaussian shadow are two rasterisers' blur of a
        // 280x154 box, so nearly every pixel of its soft falloff moves by a level or two, while the means do not
        assertRegions("raster, open frame vs the desktop's solid/frames/dialog-open.png", openRegions,
            { regionMax: 20, inkMax: 4, meanMax: 3, pixelPct: 30 });

        // the backdrop's dim: the page token 16,18,24 at 0.55 of black, 16*0.45 = 7.2
        const dimmed = await pixel(page, 10, 460);
        if (apart(dimmed, [7, 8, 11, 255]) > 3)
            bad("backdrop, the dim", `the page under the backdrop is ${dimmed.slice(0, 3)}, not 16,18,24 at 0.55 of black (7,8,11)`);
        else ok("backdrop, the dim", `the page reads ${dimmed.slice(0, 3)} where it was ${pageSpot.slice(0, 3)}: rgb(0 0 0 / 0.55)`);
        // the panel's shadow: 4 px to its left is darker than the dimmed page away from it
        const beside = await pixel(page, panel ? panel[0] - 4 : 0, panel ? panel[1] + panel[3] / 2 : 0);
        if (!(lum(beside) < lum(dimmed) - 1.5))
            bad("panel's shadow", `4 px left of the panel is ${beside.slice(0, 3)} (luma ${lum(beside).toFixed(1)}), ` +
                `not darker than the dimmed page ${dimmed.slice(0, 3)} (${lum(dimmed).toFixed(1)})`);
        else ok("panel's shadow", `4 px left of the panel ${beside.slice(0, 3)} (luma ${lum(beside).toFixed(1)}) against the dimmed page ` +
            `${dimmed.slice(0, 3)} (${lum(dimmed).toFixed(1)})`);

        // --- (e1) the trap: Tab cycles the dialog's two controls, never the page's own
        const first = await page.evaluate(focusedNodes);
        const lap = [first.map((n) => n.name).join(",")];
        for (let n = 0; n < 4; n++) {
            await page.keyboard.press("Tab");
            lap.push((await page.evaluate(focusedNodes)).map((n) => n.name).join(","));
        }
        await page.keyboard.press("Shift+Tab");
        const back = (await page.evaluate(focusedNodes)).map((n) => n.name).join(",");
        const inside = lap.every((name) => name === "Cancel" || name === "OK");
        if (!inside || back !== "OK")
            bad("the trap", `the focused nodes are ${lap.join(" | ")} then Shift+Tab ${back}, not a Cancel/OK cycle`);
        else ok("the trap", `Enter focuses ${first[0]?.name}; Tab cycles ${lap.slice(1).join(" -> ")}, ` +
            `Shift+Tab back to ${back}; the page's own Open settings is never a stop`);

        // --- (e2) Escape closes it, and the frame is the page it was before (the same page, not a second run)
        await page.keyboard.press("Escape");
        await page.evaluate(() => window.__page.warm(30));
        const escapeDump = await dump(page);
        await focused(page); // a press on empty space releases the trigger's focus, as the reader's click does
        await page.evaluate(() => window.__page.warm(2));
        const same = await page.evaluate(SNAP_DIFF);
        const afterDump = await dump(page);
        if (escapeDump.commands.some((c) => c.element === "settings-dialog" || c.element === "settings-backdrop"))
            bad("Escape", "the dialog or its backdrop is still in the tree after the exit");
        else if (JSON.stringify(afterDump.commands) !== JSON.stringify(closedDump.commands) ||
            JSON.stringify(afterDump.effects) !== JSON.stringify(closedDump.effects))
            bad("Escape", "the frame after Escape is not the closed frame's commands and effects");
        else if (same.n) bad("Escape", `${same.n} pixels differ from the closed frame (worst ${same.worst}/255)`);
        else ok("Escape", `the closed frame again, pixel for pixel (0 of ${same.total} differ) and the same ` +
            `${afterDump.commands.length} commands and effects`);

        // --- (c) the entry, three frames in: the deskop's frame, and the value channel's offset and group
        const entryPage = await open("/browser/solid/dialog.html?bench=0");
        try {
            await entryPage.evaluate(() => window.__page.warm(31));
            await focused(entryPage);
            await entryPage.keyboard.press("Tab");
            await entryPage.evaluate(() => window.__page.warm(2));
            await entryPage.keyboard.down("Enter"); // one frame: the entry's clock starts at 0
            await entryPage.evaluate(() => window.__page.warm(3)); // the motion clock is exactly 3/60: the stored frame's
            const midDump = await dump(entryPage);
            const midBox = boxOf(midDump, "settings-dialog");
            const midGroup = effectOf(midDump, "groups", "settings-dialog");
            const dimPage = await pixel(entryPage, 10, 460);
            const midSpot = await pixel(entryPage, midBox ? midBox[0] + 60 : 0, midBox ? midBox[1] + 46 : 0);
            const midCommands = await commands(entryPage);
            const midRegions = await regions(entryPage, ENTRY, midCommands);
            // the ink is not compared here: the panel covers the page's own "100%" row mid-entry, and the two
            // rasterisers' panel edges put that row's bottom a few pixels apart
            assertRegions("raster, the entry 3 frames in vs the desktop's solid/frames/dialog-entry-mid.png", midRegions,
                { regionMax: 20, inkMax: Infinity, meanMax: 3, pixelPct: 35 });
            await entryPage.keyboard.up("Enter");
            await entryPage.evaluate(() => window.__page.warm(30));
            const restBox = boxOf(await dump(entryPage), "settings-dialog");
            const restSpot = await pixel(entryPage, restBox ? restBox[0] + 60 : 0, restBox ? restBox[1] + 46 : 0);
            if (!midBox || !restBox) bad("the entry", "the panel is not in the layout mid-entry or at rest");
            else if (!(midBox[1] < restBox[1] - 1))
                bad("the entry, the float's offset", `the panel is at y ${midBox[1].toFixed(2)} mid-entry, not above its ` +
                    `rest ${restBox[1].toFixed(2)} (the offset y track)`);
            else if (!midGroup || !(midGroup.alpha > 0 && midGroup.alpha < 255) || !(midGroup.scale < 1))
                bad("the entry, the group", `the group is ${format(midGroup ?? null)}, not translucent and small`);
            else if (!between(midSpot.slice(0, 3), dimPage.slice(0, 3), restSpot.slice(0, 3), 0))
                bad("the entry, the pixels", `inside the panel ${midSpot.slice(0, 3)} is not between the dimmed page ` +
                    `${dimPage.slice(0, 3)} and the settled panel ${restSpot.slice(0, 3)}`);
            else ok("the entry", `3 frames in the panel is ${(restBox[1] - midBox[1]).toFixed(2)}px above its rest, ` +
                `the group at alpha ${midGroup.alpha}/255 and scale ${midGroup.scale.toFixed(3)}; inside it ` +
                `${midSpot.slice(0, 3)} between the dimmed page ${dimPage.slice(0, 3)} and the settled ${restSpot.slice(0, 3)}`);
        } finally {
            await entryPage.close();
        }

        // --- (d) the menu: the golden's mid-slide frame, then the settled glass and its blur
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        await page.evaluate(() => window.__page.warm(2));
        await page.keyboard.down("Enter"); // the slide's clock starts at 0 ...
        await page.evaluate(() => window.__page.warm(2)); // ... and two frames in is solid/goldens/dialog.json's frame
        const menuMid = await dump(page);
        compareGolden("commands, the menu 2 frames in vs solid/goldens/dialog.json", GOLDEN, menuMid, 4);
        await page.keyboard.up("Enter");
        await page.evaluate(() => window.__page.warm(30));

        const menuDump = await dump(page);
        const menu = boxOf(menuDump, "zoom-menu");
        const trigger = boxOf(menuDump, "zoom-trigger");
        const backdrop = effectOf(menuDump, "backdrops", "zoom-menu");
        const menuCommands = await commands(page);
        const menuRegions = await regions(page, MENU, menuCommands);
        // the menu's shadow and the blurred glass move most pixels by a level or two, as the modal's shadow does
        assertRegions("raster, the glass menu vs the desktop's solid/frames/dialog-menu.png", menuRegions,
            { regionMax: 20, inkMax: 4, meanMax: 3, pixelPct: 30 });
        if (!menu || !trigger || !backdrop) bad("the glass", "the menu, its trigger or its backdrop is not in the tree");
        else ok("the glass", `the menu ${menu.map((v) => Math.round(v)).join(",")} floats off its trigger, ` +
            `effects.backdrops says blur ${backdrop.blur}`);

        // the A/B: the same page without `css.backdrop` (the app's `glass` prop)
        const plainPage = await open("/browser/solid/dialog.html?bench=0&glass=0");
        try {
            await plainPage.evaluate(() => window.__page.warm(31));
            await focused(plainPage);
            await plainPage.keyboard.press("Tab");
            await plainPage.keyboard.press("Tab");
            await plainPage.keyboard.press("Enter");
            await plainPage.evaluate(() => window.__page.warm(30));
            const plainDump = await dump(plainPage);
            const pMenu = boxOf(plainDump, "zoom-menu");
            const pTrigger = boxOf(plainDump, "zoom-trigger");
            const edge = Math.round(trigger[1] + trigger[3]) - 1; // the trigger's bottom border
            const col = Math.round(menu[0] + 120); // inside the menu, over the border alone
            const glassUnder = await pixel(page, col, edge);
            const plainUnder = await pixel(plainPage, col, edge);
            // the max step down a 1px column across the border, inside the menu: crisp without the glass, soft under it
            const scan = async (p, from, to) => {
                const lines = [];
                for (let y = from; y <= to; y++) lines.push(await pixel(p, col, y));
                return lines.reduce((m, v, i) => (i ? Math.max(m, apart(v, lines[i - 1])) : m), 0);
            };
            // the desktop test's rows: past the menu's top border and the first item's ring, over the trigger's border
            const glassScan = await scan(page, Math.round(menu[1]) + 10, Math.round(menu[1]) + 26);
            const plainScan = await scan(plainPage, Math.round(pMenu[1]) + 10, Math.round(pMenu[1]) + 26);
            let leaked = 0, worstLeak = 0;
            const outside = [
                [menu[0] - 4, menu[1] + menu[3] / 2], [menu[0] + menu[2] + 4, menu[1] + menu[3] / 2],
                [menu[0] + menu[2] / 2, menu[1] + menu[3] + 4],
            ];
            for (const [x, y] of outside) {
                const [a, b] = [await pixel(page, x, y), await pixel(plainPage, x, y)];
                if (apart(a, b)) leaked++, (worstLeak = Math.max(worstLeak, apart(a, b)));
            }
            const msGlass = await page.evaluate(() => window.__page.bench(100));
            const msPlain = await plainPage.evaluate(() => window.__page.bench(100));
            if (apart(glassUnder, plainUnder) < 8)
                bad("the blur", `over the trigger's border the glass reads ${glassUnder.slice(0, 3)}, the same page ` +
                    `without a backdrop ${plainUnder.slice(0, 3)}: the page under the glass is not blurred`);
            else if (!(glassScan <= 8 && glassScan <= Math.max(2, plainScan / 2)))
                bad("the blur", `the border's step under the glass is ${glassScan}/255 against ${plainScan} without it: not soft`);
            else if (leaked)
                bad("the blur, outside the box", `${leaked} pixels outside the menu differ (worst ${worstLeak}/255)`);
            else ok("the blur", `over the trigger's border ${glassUnder.slice(0, 3)} under the glass against ` +
                `${plainUnder.slice(0, 3)} without it (${apart(glassUnder, plainUnder)}/255); the scan's worst step ` +
                `${glassScan} against ${plainScan}; nothing outside the menu's box moved`);
            console.log(`info ${(msGlass - msPlain).toFixed(2)} ms a backdrop: ${msGlass.toFixed(2)} ms a frame with the ` +
                `menu's glass against ${msPlain.toFixed(2)} on the same page with \`glass: false\` (100 frames each, ` +
                `headless Chromium)`);
        } finally {
            await plainPage.close();
        }

        // --- (e3) the costs
        const msOpen = await page.evaluate(() => window.__page.bench(100));
        await page.keyboard.press("Escape");
        await page.evaluate(() => window.__page.warm(30));
        const msClosedAgain = await page.evaluate(() => window.__page.bench(100));
        const bundle = (await stat(BUNDLE)).size;
        const wasm = (await stat(join(WASM_DIR, "ui.wasm"))).size;
        const html = (await stat(join(BROWSER, "solid/dialog.html"))).size;
        console.log(`info ${bundle} B of bundle (dialog.js), ${wasm} B of wasm (ui.wasm), ${html} B of dialog.html`);
        console.log(`info ${msClosed.toFixed(2)} ms a frame with the modal closed, ${msOpen.toFixed(2)} with it open, ` +
            `${msClosedAgain.toFixed(2)} closed again (100 frames: declare, Clay's layout, the commands and the effect ` +
            `tables, Canvas2D's raster, one readback)`);

        if (logs.some(l => l.startsWith("pageerror"))) bad("page", logs.filter(l => l.startsWith("pageerror")).join("; "));
    } finally {
        await page.close();
        await browser.close();
        server.close();
    }
    if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
    console.log("browser/solid/dialog: ok");
}

main();
