// The List and the Text field pages in the browser — the two whose input the shell had not carried yet: a page's own
// scroll machine behind the wheel, and typed text behind the DOM's characters.
//
//   (a) the List's base frame, its commands against solid/goldens/list.json: every field exactly and every box within
//       4 px (ThorVG's metrics; Canvas2D does not hint, so a line's rounded-up height pushes the rows below it a little).
//   (b) the List's raster against the desktop's solid/frames/list-top.png, the way check.mjs holds this browser to
//       ThorVG's: the mean colour of every command's box (the ones at least 16 px), each text line's ink box, the
//       frame's mean, and 12% of the pixels.
//   (c) the wheel, over the real viewport: one wheel event is one notch of the page's own track (10px), so three of
//       them, a rest frame apart (a run at 60Hz is a flick and flings), are 30px of offset — the rows' bounds move by
//       it, and the scrollbar's thumb sits where `src/vscroll.ts`'s `barOf` puts it.
//   (d) the keys: Tab into the list (which brings the selected row into view: the offset back to 0), then ArrowDown
//       moves the selection a row — the header's readout, and the selected row's fill in the commands.
//   (e) the Text field: Tab twice to the field, type "Ada" from the DOM's keydowns into `Input.textInput`, the page's
//       own state (the a11y snapshot's value) and the frame's commands carry it, the caret's box is after the last
//       glyph, its raster is the desktop's solid/frames/field-typed.png; then Backspace (one character, the caret one
//       advance left) and Shift+ArrowLeft twice (a selection: the box, and its pixels over the field's surface).
//
//   node browser/input-check.mjs            the check (build first: sh browser/build.sh && bun browser/solid/build.ts)
//   node browser/input-check.mjs --serve    serve the two pages and print their URLs, for looking at them by hand
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
const BUNDLE = { list: join(WASM_DIR, "solid/list.js"), field: join(WASM_DIR, "solid/field.js") };
const DESKTOP = { list: "/solid/frames/list-top.png", field: "/solid/frames/field-typed.png" };
const SIZE = { list: [360, 400], field: [360, 450] };

const GOLDEN = JSON.parse(readFileSync(join(ROOT, "solid/goldens/list.json"), "utf8"));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".ttf": "font/ttf",
    ".png": "image/png", ".json": "application/json" };
let failures = 0;
const ok = (name, extra = "") => console.log(`ok   ${name}${extra ? " — " + extra : ""}`);
const bad = (name, why) => { failures++; console.log(`FAIL ${name}: ${why}`); };

function serve() {
    return new Promise(done => {
        const server = createServer(async (req, res) => {
            const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
            // the build products, outside the repo: the wasm and the two bundles
            const built = path === "/browser/solid/ui.wasm" ? join(WASM_DIR, "ui.wasm")
                : path === "/browser/solid/list.js" ? BUNDLE.list
                : path === "/browser/solid/field.js" ? BUNDLE.field
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

/** The page's window loop is the check's: requestAnimationFrame never calls back, so every frame here is one that was
 *  asked for (a wheel, a key and a press run their own); the pages' twenty-frame auto bench at load is one too. */
const HOLD = () => {
    window.requestAnimationFrame = () => 0;
};

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

/** (b) another rasteriser's frame, done in the page: per command box a mean colour, per text command an ink box.
 *  `clip` is the page's own clip (the List's viewport): a box it cuts away entirely is drawn nowhere, and its region's
 *  ink would be whatever is under it — the footer's line, whose glyphs the two measures put a few px apart. */
const REGIONS = async ({ refURL, boxes, min, clip }) => {
    const canvas = document.getElementById("frame");
    const a = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
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
                if (dd > 120) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
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
        // what the page's clip keeps of it (a box it cuts away is drawn nowhere: it is not a region of this frame)
        if (clip) {
            const [cx, cy, cw, ch] = clip.map(Math.round);
            const x0 = Math.max(r.x, cx), y0 = Math.max(r.y, cy);
            const x1 = Math.min(r.x + r.w, cx + cw), y1 = Math.min(r.y + r.h, cy + ch);
            r.x = x0, r.y = y0, r.w = x1 - x0, r.h = y1 - y0;
        }
        // a region thinner than `min` is not compared: the boxes may differ by up to 4 px, so a 4 px band is all offset
        if (r.w < min || r.h < min) continue;        const ma = mean(a.data, r.x, r.y, r.x + r.w, r.y + r.h);
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
    ok(name, `${pct.toFixed(2)}% of pixels differ; region means within ${diff.region.delta.toFixed(1)}/255 ` +
        `(${JSON.stringify(diff.region.box.text || diff.region.box.type)}), text ink within ${diff.ink.delta.toFixed(2)}px ` +
        `("${diff.ink.box?.text}"), the frame's mean colour within ${diff.frameMean.toFixed(2)}/255`);
}

/** The List's viewport, its rows' own content end and its scrollbar's thumb, from the last frame. Row 0's place is the
 *  viewport's top less the offset (it stays declared while the window's overscan holds it). Per the page: no helpers of
 *  this module are there. */
const STATE = () => {
    const view = window.__page.bounds("list");
    const below = window.__page.bounds("list-below");
    const row0 = window.__page.bounds("row-0");
    const thumb = window.__page.bounds("list-thumb");
    const readout = JSON.parse(window.__page.dump()).commands.find((c) => / of 30$/.test(c.text ?? ""));
    return {
        view, row0, thumb, readout: readout?.text,
        content: below ? below[1] + below[3] - view[1] + (row0 ? view[1] - row0[1] : 0) : 0,
        offset: row0 ? view[1] - row0[1] : Number.NaN,
    };
};

/** The scrollbar's thumb as src/vscroll.ts's `barOf` puts it, from the viewport and the content's end. */
function thumbOf(content, view, offset) {
    if (!(content > view)) return null;
    const size = Math.max(24, (view * view) / content);
    const max = content - view;
    const travel = Math.max(0, view - size);
    return { top: (Math.min(Math.max(offset, 0), max) / max) * travel, height: size };
}

/** The Text field's own state, from the page: the a11y snapshot's textbox, the caret's box and the selection's command. */
const FIELD = () => {
    const find = (node) => {
        if (node.role === "textbox" && node.name === "Name") return node;
        for (const child of node.children) {
            const hit = find(child);
            if (hit) return hit;
        }
        return undefined;
    };
    const commands = JSON.parse(window.__page.dump()).commands;
    const field = find(window.__page.a11y());
    return {
        value: field?.value,
        focused: field?.states.focused === true,
        caret: window.__page.bounds("name-line-caret"),
        selection: commands.find((c) => c.element === "name-line-selection"),
        line: window.__page.bounds("name-line"),
        readout: commands.find((c) => c.type === "text" && c.text.startsWith("Value: "))?.text,
        texts: commands.filter((c) => c.type === "text").map((c) => c.text),
    };
};

/** The pixel at a layout point of the page's canvas. */
const pixelAt = ([x, y]) => Array.from(document.getElementById("frame").getContext("2d").getImageData(x, y, 1, 1).data);

/** The Name field's line as ink, the page's and the desktop's raster in the line's own box: the glyphs of the value and
 *  the caret after them. A region mean cannot show a run that is missing (an empty field declares no text command at
 *  all, so its own frame's boxes are not the reference's), and this is the one place the typed text is pixels. */
const FIELD_INK = async ({ refURL, box, bg }) => {
    const canvas = document.getElementById("frame");
    const w = canvas.width, h = canvas.height;
    const a = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    const img = new Image();
    img.src = refURL;
    await img.decode();
    const rc = document.createElement("canvas");
    rc.width = w;
    rc.height = h;
    rc.getContext("2d").drawImage(img, 0, 0, w, h);
    const b = rc.getContext("2d").getImageData(0, 0, w, h).data;
    const [x, y, bw, bh] = box.map(Math.round);
    const ink = (d) => {
        let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, n = 0;
        for (let j = y; j < y + bh; j++) for (let i = x; i < x + bw; i++) {
            const o = (j * w + i) * 4;
            const dd = Math.abs(d[o] - bg[0]) + Math.abs(d[o + 1] - bg[1]) + Math.abs(d[o + 2] - bg[2]);
            if (dd > 120) n++, x0 = Math.min(x0, i), x1 = Math.max(x1, i), y0 = Math.min(y0, j), y1 = Math.max(y1, j);
        }
        return { n, box: x1 < 0 ? null : [x0, x1, y0, y1] };
    };
    return { page: ink(a), desk: ink(b) };
};

async function main() {
    const missing = [join(WASM_DIR, "ui.wasm"), BUNDLE.list, BUNDLE.field,
        join(BROWSER, "solid/list.html"), join(BROWSER, "solid/field.html")].filter(f => !existsSync(f));
    if (missing.length) {
        console.log(`missing build product(s): ${missing.join(", ")}`);
        console.log(`run "sh browser/build.sh && bun browser/solid/build.ts" first`);
        process.exit(1);
    }
    const { server, port } = await serve();
    if (process.argv.includes("--serve")) {
        console.log(`http://127.0.0.1:${port}/browser/solid/list.html   (the List, Ctrl-C to stop)`);
        console.log(`http://127.0.0.1:${port}/browser/solid/field.html  (the Text field: Tab twice to the field, then type)`);
        return; // no browser to drive: serve the pages for a person to open
    }
    const browser = await chromium.launch();
    const logs = [];
    /** A page of the app, its errors on `logs`. */
    async function open(which) {
        const page = await browser.newPage({ viewport: { width: SIZE[which][0] + 80, height: SIZE[which][1] + 160 },
            deviceScaleFactor: 1 });
        await page.addInitScript(HOLD);
        page.on("console", m => logs.push(m.text()));
        page.on("pageerror", e => logs.push(`pageerror: ${e.message}`));
        await page.goto(`http://127.0.0.1:${port}/browser/solid/${which}.html`);
        await page.waitForFunction(() => window.__page, null, { polling: 100, timeout: 20000 });
        return page;
    }

    try {
        // --- the List: the page's own scroll machine
        const list = await open("list");
        const box = await list.locator("#frame").boundingBox();
        // a press on the page's own padding: empty space, so nothing is focused, and the canvas takes the DOM's focus
        await list.mouse.click(box.x + 6, box.y + 6);
        // the entry (the root's 8px rise and fade over 0.25s) writes the value channel, which the commands do not carry;
        // 31 frames at 1/60 is solid/dump.ts's `--warm 30`, the frame the golden is taken at
        await list.evaluate(() => window.__page.warm(31));
        const errors = await list.evaluate(() => window.__page.errors());
        if (errors) bad("clay, list", `${errors} Clay errors`); else ok("clay, list", "no errors");

        const base = JSON.parse(await list.evaluate(() => window.__page.dump()));
        compareGolden("commands, List base frame vs solid/goldens/list.json", GOLDEN, base, 4);

        const boxes = await list.evaluate(() => window.__page.commands());
        const clip = await list.evaluate(() => window.__page.bounds("list"));
        const regions = await list.evaluate(REGIONS, { refURL: DESKTOP.list, boxes, min: 16, clip });
        assertRegions("raster, List base frame vs the desktop's solid/frames/list-top.png", regions,
            { regionMax: 20, inkMax: 4, meanMax: 3, pixelPct: 12 });

        // the wheel: the pointer over the viewport (a frame first, so `ui.over` knows), then one event a notch and a
        // rest frame between them (a run at 60Hz is a flick, which the track flings)
        const view = await list.evaluate(() => window.__page.bounds("list"));
        await list.mouse.move(box.x + view[0] + 140, box.y + view[1] + 120);
        await list.evaluate(() => window.__page.warm(1));
        const before = await list.evaluate(STATE);
        for (let i = 0; i < 3; i++) {
            await list.mouse.wheel(0, 100);
            await list.evaluate(() => window.__page.warm(2));
        }
        await list.evaluate(() => window.__page.warm(60));
        const after = await list.evaluate(STATE);
        if (after.offset !== 30) bad("wheel, three notches", `the offset is ${after.offset}, want 30 (10px a notch)`);
        else ok("wheel, three notches", `the offset is 30px (10px a notch, a rest frame between them)`);
        // the rows move with it: row 0's top is 30px above the viewport's (it is declared still: the window's overscan)
        const moved = after.row0[1] - before.row0[1];
        if (Math.abs(moved + 30) > 0.01) bad("wheel, the rows", `row 0's top moved ${moved}px, want -30`);
        else ok("wheel, the rows", `row 0's top moved ${moved.toFixed(2)}px, and the window is still declared`);
        // the thumb: 4px wide, 2px in from the viewport's right edge, max(24, view²/content) tall, at the offset's
        // place of its travel (src/vscroll.ts's barOf)
        const want = thumbOf(after.content, after.view[3], after.offset);
        const got = { top: after.thumb[1] - after.view[1], height: after.thumb[3] };
        const edge = after.view[0] + after.view[2] - after.thumb[0] - after.thumb[2];
        if (Math.abs(got.top - want.top) > 0.01 || Math.abs(got.height - want.height) > 0.01 || edge !== 2 ||
            after.thumb[2] !== 4) {
            bad("wheel, the thumb", `the thumb is ${JSON.stringify(got)} at ${edge}px in, want ` +
                `${JSON.stringify({ top: +want.top.toFixed(2), height: +want.height.toFixed(2) })} at 2px in`);
        } else {
            ok("wheel, the thumb", `the thumb's top is ${got.top.toFixed(2)}px of the viewport and it is ` +
                `${got.height.toFixed(2)}px tall (max(24, 240²/${after.content})), 4px wide 2px in: barOf's geometry ` +
                `for a 30px offset`);
        }
        if (after.readout !== "Room A1 — 1 of 30")
            bad("wheel, the selection", `the readout is ${JSON.stringify(after.readout)}: the wheel moved the selection`);

        // the keys: Tab into the list, which brings the selected row back into view (the reveal), then ArrowDown
        await list.keyboard.press("Tab");
        await list.evaluate(() => window.__page.warm(60));
        const tabbed = await list.evaluate(STATE);
        if (tabbed.offset !== 0) bad("Tab, the reveal", `the offset is ${tabbed.offset}, want 0: Tab did not bring row 1 into view`);
        else ok("Tab, the reveal", `the offset eases back to 0: the selected row is in view (${JSON.stringify(tabbed.readout)})`);
        await list.keyboard.press("ArrowDown");
        await list.evaluate(() => window.__page.warm(4));
        const down = await list.evaluate(STATE);
        if (down.readout !== "Room B1 — 2 of 30")
            bad("ArrowDown", `the readout is ${JSON.stringify(down.readout)}, want "Room B1 — 2 of 30"`);
        else ok("ArrowDown", `the readout is "Room B1 — 2 of 30", and the offset stays ${down.offset}`);
        // the selected row is the surface, the one it left is not: the fill is the page's own state in the commands
        const rows = await list.evaluate(() => JSON.parse(window.__page.dump()).commands
            .filter((c) => c.type === "rectangle" && (c.element === "row-0" || c.element === "row-1"))
            .map((c) => [c.element, c.color.join()]));
        if (rows.length !== 1 || rows[0][0] !== "row-1" || rows[0][1] !== "36,40,52,255")
            bad("ArrowDown, the fill", `the rows' rectangles are ${JSON.stringify(rows)}, want [["row-1","36,40,52,255"]]`);
        else ok("ArrowDown, the fill", "row 1's fill is 36,40,52,255 (t.color.surface) and row 0 has none");

        const listMs = await list.evaluate(() => window.__page.bench(100));
        const listBundle = (await stat(BUNDLE.list)).size;
        const wasm = (await stat(join(WASM_DIR, "ui.wasm"))).size;
        console.log(`info ${listBundle} B of bundle (list.js) on the same ui.wasm (${wasm} B), ` +
            `${(await stat(join(BROWSER, "solid/list.html"))).size} B of list.html`);
        console.log(`info ${listMs.toFixed(2)} ms a frame on the List (100 frames: declare, Clay's layout, the commands, ` +
            `Canvas2D's raster, one readback)`);

        // --- the Text field: the DOM's characters into Input.textInput
        const field = await open("field");
        const fbox = await field.locator("#frame").boundingBox();
        await field.mouse.click(fbox.x + 6, fbox.y + 6);
        await field.evaluate(() => window.__page.warm(31));
        const fErrors = await field.evaluate(() => window.__page.errors());
        if (fErrors) bad("clay, field", `${fErrors} Clay errors`); else ok("clay, field", "no errors");

        // Tab twice: the command button, then the field (the page's Tab order is the creation order)
        await field.keyboard.press("Tab");
        await field.keyboard.press("Tab");
        const empty = await field.evaluate(FIELD);
        if (!empty.focused) bad("Tab Tab, the field", `the snapshot's textbox "Name" is ${JSON.stringify(empty)}, not focused`);
        else ok("Tab Tab, the field", `the a11y snapshot has role textbox, name "Name", focused (value ${JSON.stringify(empty.value)}), ` +
            `the caret at ${JSON.stringify(empty.caret.map((v) => +v.toFixed(2)))}`);

        // typed text: Playwright's keydowns, the page's listener, Input.textInput — one frame each
        await field.keyboard.type("Ada");
        await field.evaluate(() => window.__page.warm(2));
        const typed = await field.evaluate(FIELD);
        if (typed.value !== "Ada") bad("typed text", `the field's own value is ${JSON.stringify(typed.value)}, want "Ada"`);
        else ok("typed text", `the field's value is "Ada" (the a11y snapshot, the page's state), the caret after it at ` +
            `x ${typed.caret[0].toFixed(2)}`);
        if (typed.readout !== 'Value: "Ada" (3)')
            bad("typed text, the readout", `the frame's readout is ${JSON.stringify(typed.readout)}, want 'Value: "Ada" (3)'`);
        else ok("typed text, the commands", `the frame carries "Ada" (the run, the caret and the readout ` +
            `${JSON.stringify(typed.readout)})`);

        const fboxes = await field.evaluate(() => window.__page.commands());
        const fregions = await field.evaluate(REGIONS, { refURL: DESKTOP.field, boxes: fboxes, min: 16 });
        assertRegions("raster, the typed field vs the desktop's solid/frames/field-typed.png", fregions,
            { regionMax: 20, inkMax: 4, meanMax: 3, pixelPct: 12 });
        // ... and the run itself: the same glyphs in the same box as the desktop's frame, the caret after them. The row
        // (id "name") is the frame's own, so its box is the value's box plus the field's padding and does not depend on
        // what is typed — a field with no run would have shrunk its line box. Its border is left out: the padding's
        // 12px and 10px are the surface the run sits on
        const row = await field.evaluate(() => window.__page.bounds("name"));
        const inner = [row[0] + 12, row[1] + 10, row[2] - 24, row[3] - 20];
        const ink = await field.evaluate(FIELD_INK, { refURL: DESKTOP.field, box: inner, bg: [36, 40, 52] });
        const [pi, di] = [ink.page, ink.desk];
        if (!pi.box || !di.box || Math.abs(pi.box[0] - di.box[0]) > 4 || Math.abs(pi.box[1] - di.box[1]) > 4 ||
            Math.abs(pi.n - di.n) > di.n * 0.25) {
            bad("the typed run's ink", `the field's row has ${JSON.stringify(pi)}, the desktop's ${JSON.stringify(di)}`);
        } else {
            ok("the typed run's ink", `the field's row is ink at ${JSON.stringify(pi.box)} (${pi.n} px), the desktop's ` +
                `${JSON.stringify(di.box)} (${di.n} px): the run "Ada" and the caret after it, in the same box`);
        }

        // Backspace: one character, and the caret one advance to the left
        await field.keyboard.press("Backspace");
        await field.evaluate(() => window.__page.warm(2));
        const back = await field.evaluate(FIELD);
        if (back.value !== "Ad") bad("Backspace", `the field's value is ${JSON.stringify(back.value)}, want "Ad"`);
        else ok("Backspace", `"Ada" -> "Ad", the caret ${typed.caret[0].toFixed(2)} -> ${back.caret[0].toFixed(2)}px ` +
            `(${(back.caret[0] - typed.caret[0]).toFixed(2)}px: one advance)`);
        if (!(back.caret[0] < typed.caret[0])) bad("Backspace, the caret", "the caret did not move left");

        // Shift+ArrowLeft twice: a selection of the two characters, drawn as the tinted box, the caret before it
        for (let i = 0; i < 2; i++) {
            await field.keyboard.down("Shift");
            await field.keyboard.press("ArrowLeft");
            await field.keyboard.up("Shift");
        }
        await field.evaluate(() => window.__page.warm(2));
        const selectedField = await field.evaluate(FIELD);
        const run = selectedField.selection;
        if (!run) bad("Shift+ArrowLeft, the selection", `no command for the selection: ${JSON.stringify(selectedField.texts)}`);        else {
            // the tint is the accent at 30% over the field's surface, and the pixel is the desktop's own probe (the
            // middle of the run, 2px down: above the glyphs)
            const [r, g, b, a] = run.color;
            const alpha = a / 255;
            const over = [36, 40, 52]; // t.color.surface
            const want = [r, g, b].map((c, k) => Math.round(over[k] + (c - over[k]) * alpha));
            const [x, y, w, h] = run.box;
            const tint = await field.evaluate(pixelAt, [Math.round(x + w / 2), Math.round(y + 2)]);
            const plain = await field.evaluate(pixelAt, [Math.round(selectedField.line[0] + 150), Math.round(y + 2)]);
            const tinted = tint[0] - tint[2] > 20;
            const surface = plain.slice(0, 3).join() === over.join();
            if (!tinted || !surface || Math.abs(tint[0] - want[0]) > 8)
                bad("Shift+ArrowLeft, the pixels", `the selection's middle is ${tint.join()} (want ~${want.join()}: ` +
                    `${run.color.join()} at 30% over the surface) and the field beyond the text is ${plain.slice(0, 3).join()}`);
            else ok("Shift+ArrowLeft, the pixels", `a run of ${w.toFixed(3)}px (two advances, ${x.toFixed(2)} to ` +
                `${(x + w).toFixed(2)}) whose middle is ${tint.join()} — ${want.join()} (the accent at 30% over the ` +
                `field's 36,40,52) over surface ${plain.slice(0, 3).join()}; the caret is before it at x ` +
                `${selectedField.caret[0].toFixed(2)}`);
        }
        if (!run || selectedField.caret[0] !== run.box[0] - 1)
            bad("Shift+ArrowLeft, the caret", `the caret is at ${selectedField.caret?.[0]}, not 1px before the run's ` +
                `${run?.box[0]}: the 1px caret box is between the runs, as the desktop's field.test.ts has it`);

        const fieldMs = await field.evaluate(() => window.__page.bench(100));
        const fieldBundle = (await stat(BUNDLE.field)).size;
        console.log(`info ${fieldBundle} B of bundle (field.js), ` +
            `${(await stat(join(BROWSER, "solid/field.html"))).size} B of field.html`);
        console.log(`info ${fieldMs.toFixed(2)} ms a frame on the Text field (100 frames: declare, Clay's layout, the ` +
            `commands, Canvas2D's raster, one readback)`);
        if (logs.some(l => l.startsWith("pageerror"))) bad("page", logs.filter(l => l.startsWith("pageerror")).join("; "));
    } finally {
        await browser.close();
        server.close();
    }
    if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
    console.log("browser/input-check: ok");
}

main();
