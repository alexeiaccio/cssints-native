// The browser target under a finger: the touch the shell had not carried, and the two drags a finger makes on the two
// scrolling pages — the List's rows and its thumb, the Sky's feed.
//
//   (a) the flag. A touchscreen's pointer events (`pointerdown`/`pointermove`/`pointerup`, `pointerType === "touch"`) reach
//       src/frame.ts's `onPointer(x, y, down, touch)` with `touch = true`, and the mouse's still reach it with `false`:
//       `window.__page.touch` is what the last frame got. The flag is not cosmetic — a finger's drag has no 4px click
//       threshold (src/vscroll.ts), so the same 2px travel lifts a card off the feed as a click with the mouse and does
//       not with a finger (the desktop's sky.test.ts has the two).
//   (b) the List: a press and a 40px drag up moves the offset 40px (the rows with it, 1:1 from the press point), a
//       release with the finger at rest ends there (no throw), and a press that does not travel still selects the row
//       under it. A drag leaves the selection alone.
//   (c) the List's thumb: a visible thumb takes the press and 20px of drag on it moves the offset by the thumb's own
//       scale, `20·(content − view)/(view − thumb)` (74.83px for 30 rows in the 240px viewport), and the release ends it.
//   (d) the Sky's feed: a 120px drag is 1:1 to the feed's end (78px of content) and then the same rubber band's f(x) past
//       it, and the release lets the band go; a throw released while the feed is still moving hands its last frames' speed
//       to the decay, whose projection is where it rests (the desktop's own 54.95px); a 5px drag does not open the
//       thread a tap does.
//   (e) the mouse. Both pages still take it (`touch` false), it still drags 1:1, and a touch drag and a mouse drag that
//       end in the same place leave byte-identical frames (the List's dump, element for element) — and the mouse's own
//       checks, browser/solid-check.mjs, sky-check.mjs, input-check.mjs and dialog-check.mjs, are the rasters at rest.
//
// The input: Chromium's own touch, through the DevTools protocol's `Input.dispatchTouchEvent` (start/move/end), because
// Playwright's `touchscreen.tap` only taps — a drag is a sequence of moves and there is no API for one. The context has
// `hasTouch: true`, so the page reports a touchscreen and the events arrive as pointer events with `pointerType: "touch"`
// (a synthetic PointerEvent in the page would not run the browser's own compatibility-mouse and pointer-capture paths,
// which is half of what the shell's listeners are for). A CDP call resolves in the browser process, before the renderer's
// listener runs, so the check waits until the canvas has taken the event it sent (`window.__page.touches`, the listeners'
// own count); the frames are the check's (`warm`, 1/60: the window loop is held, as in sky-check.mjs), plus the one frame
// a press, a release and a key run on their own event, as the desktop's poll does.
//
//   node browser/touch-check.mjs            the check (build first: sh browser/build.sh && bun browser/solid/build.ts)
//   node browser/touch-check.mjs --serve    serve the two pages and print their URLs, for trying a finger by hand
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { rubber } from "../solid/src/motion.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WASM_DIR = process.env.WASM_DIR || join(process.env.TMPDIR || "/tmp", "cssints-native-web");
const BUNDLE = { list: join(WASM_DIR, "solid/list.js"), sky: join(WASM_DIR, "solid/sky.js") };
const SIZE = { list: [360, 400], sky: [360, 760] };
// the List's rows: 30 of 28px and 29 gaps of 2 (app/List.tsx's `ROW`, `GAP`, `count`)
const LIST_CONTENT = 30 * 28 + 29 * 2;
// where the Sky's feed rests after a throw: the desktop's own number for the same drag (solid/sky.test.ts, a 10px drag
// in five 1/60 frames, the decay's projection of its last frames' speed)
const THROW_REST = 54.95;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".ttf": "font/ttf",
    ".png": "image/png", ".json": "application/json" };
let failures = 0;
let comparisons = 0;
const ok = (name, extra = "") => (comparisons++, console.log(`ok   ${name}${extra ? " — " + extra : ""}`));
const bad = (name, why) => (comparisons++, failures++, console.log(`FAIL ${name}: ${why}`));
/** A number against a want, within `tol` (the layout's pixels are exact here; the tolerance is the mapping's rounding). */
function near(name, got, want, tol, extra = "") {
    if (typeof got !== "number" || !Number.isFinite(got) || !(Math.abs(got - want) <= tol))
        return bad(name, `${got}, want ${want.toFixed(3)} (±${tol})`);
    ok(name, `${got.toFixed(3)} (want ${want.toFixed(3)}${extra ? ", " + extra : ""})`);
}
const r2 = (x) => Math.round(x * 100) / 100;

function serve() {
    return new Promise(done => {
        const server = createServer(async (req, res) => {
            const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
            // the build products, outside the repo: the wasm and the two bundles
            const built = path === "/browser/solid/ui.wasm" ? join(WASM_DIR, "ui.wasm")
                : path === "/browser/solid/list.js" ? BUNDLE.list
                : path === "/browser/solid/sky.js" ? BUNDLE.sky
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

/** The page's window loop is the check's: requestAnimationFrame never calls back, so a frame is one asked for (`warm`)
 *  or one an event runs (a press, a release), as the desktop's loop runs one after every poll. */
const HOLD = () => {
    window.requestAnimationFrame = () => 0;
};

async function main() {
    const missing = [join(WASM_DIR, "ui.wasm"), BUNDLE.list, BUNDLE.sky].filter(f => !existsSync(f));
    if (missing.length) {
        console.log(`missing build product(s): ${missing.join(", ")}`);
        console.log(`run "sh browser/build.sh && bun browser/solid/build.ts" first`);
        process.exit(1);
    }
    const { server, port } = await serve();
    if (process.argv.includes("--serve")) {
        console.log(`http://127.0.0.1:${port}/browser/solid/list.html   (the List, Ctrl-C to stop)`);
        console.log(`http://127.0.0.1:${port}/browser/solid/sky.html    (the Sky)`);
        return; // no browser to drive: serve the pages for a finger by hand (a devtools device toolbar works)
    }
    const browser = await chromium.launch();
    // `hasTouch` is the page's touchscreen: without it Chromium drops the protocol's touch points
    const context = await browser.newContext({ viewport: { width: 560, height: 980 }, deviceScaleFactor: 1, hasTouch: true });
    const logs = [];
    const page = await context.newPage();
    await page.addInitScript(HOLD);
    page.on("console", m => logs.push(m.text()));
    page.on("pageerror", e => logs.push(`pageerror: ${e.message}`));
    const cdp = await context.newCDPSession(page);

    /** One finger event at a point of the viewport's CSS pixels, waited for: the CDP call resolves in the browser process
     *  before the renderer's listener runs, so the check waits until the canvas has taken the event (`__page.touches`). */
    async function finger(type, x, y) {
        const touchPoints = type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y, id: 1 }];
        const want = (await page.evaluate(() => window.__page.touches())) + 1;
        await cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
        // a timer poll, not rAF: the page's window loop is held
        await page.waitForFunction((n) => window.__page.touches() >= n, want, { polling: 4, timeout: 10000 });
    }
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const warm = (n = 1) => page.evaluate((k) => window.__page.warm(k), n);
    /** A page of the two, its loop held, its entry (0.25s) over: the canvas's box and the page's size. */
    async function open(which) {
        await page.goto(`http://127.0.0.1:${port}/browser/solid/${which}.html?bench=0`);
        await page.waitForFunction(() => window.__page, null, { polling: 100, timeout: 20000 });
        await warm(31);
        const box = await page.locator("#frame").boundingBox();
        const [w, h] = SIZE[which];
        return { box, x: (x) => box.x + (x * box.width) / w, y: (y) => box.y + (y * box.height) / h };
    }

    try {
        // ---------------------------------------------------------------- the List
        let at = await open("list");
        const box = (id) => ev((i) => window.__page.bounds(i), id);
        const offset = () => ev(() => window.__page.offset("list"));
        const readout = () => ev(() => window.__page.commands()
            .filter((c) => typeof c.text === "string" && c.text.includes(" of 30")).map((c) => c.text));
        const view = await box("list");
        const px = 140, py = 120; // inside the viewport, over a row
        const sx = at.x(view[0] + px), sy = at.y(view[1] + py);
        if (await ev(() => window.__page.touch())) bad("List: the flag at rest", "the first frame's pointer is a finger's");
        else ok("List: the flag at rest", "the pointer's flag is false before any input");

        // (b) 40px of drag, four moves of 10, a frame each: the offset is the pointer's travel from the press point
        await finger("touchStart", sx, sy);
        const flag = await ev(() => window.__page.touch());
        if (flag !== true) bad("List: a finger's press", `the frame's \`touch\` is ${flag}, not true`);
        else ok("List: a finger's press", "the frame's `touch` is true (src/frame.ts's flag, from `pointerType: \"touch\"`)");
        for (let i = 1; i <= 4; i++) {
            await finger("touchMove", sx, at.y(view[1] + py - 10 * i));
            await warm();
        }
        near("List: a 40px drag moves the offset 40px", await offset(), 40, 0.5, "1:1 from the press point");
        const row0 = await box("row-0");
        near("List: ... and the rows with it", view[1] - row0[1], 40, 0.5, "row 0's top, the viewport's less the offset");
        if ((await readout()).join() !== "Room A1 — 1 of 30")
            bad("List: the drag does not select", `the header reads ${(await readout()).join()} (want "Room A1 — 1 of 30")`);
        else ok("List: the drag does not select", "the drag left the selection on row 0: the press that travels is the scroll's");
        // the release with the finger at rest: the last frames carry no speed, so nothing is thrown (`vscroll`'s release
        // is the desktop's fling; a finger that stops before it lifts throws nothing)
        await warm(12);
        await finger("touchEnd", sx, at.y(view[1] + py - 40));
        await warm(12);
        near("List: the release ends the drag where it is", await offset(), 40, 0.5, "12 frames of rest first: no throw");

        // (c) the thumb: its box, then 20px down on it
        const thumb = await box("list-thumb");
        const travel = view[3] - thumb[3];
        const scale = (LIST_CONTENT - view[3]) / travel;
        const grabbed = await offset();
        await finger("touchStart", at.x(thumb[0] + 2), at.y(thumb[1] + thumb[3] / 2));
        await warm();
        near("List: the thumb takes the press where it is", await offset(), grabbed, 0.01, "the thumb does not jump under the finger");
        for (let i = 1; i <= 4; i++) {
            await finger("touchMove", at.x(thumb[0] + 2), at.y(thumb[1] + thumb[3] / 2 + 5 * i));
            await warm();
        }
        const scaled = await offset();
        near("List: 20px on the thumb is the thumb's own scale", scaled - grabbed, 20 * scale, 0.5,
            `20·(898−240)/(240−${r2(thumb[3])}) = ${r2(20 * scale)}`);
        const movedThumb = await box("list-thumb");
        near("List: ... and the thumb moved 20px", movedThumb[1] - thumb[1], 20, 0.5, "1:1 on the bar");
        await warm(12);
        await finger("touchEnd", at.x(thumb[0] + 2), at.y(thumb[1] + thumb[3] / 2 + 20));
        await warm(60);
        near("List: the thumb's release ends it", await offset(), scaled, 0.5, "a scrollbar is not a throw");

        // (b) a press with no movement selects the row under it; a second one selects another
        at = await open("list");
        const tapRows = async (i) => {
            const v = await box("list");
            const y = at.y(v[1] + i * 30 + 14);
            await finger("touchStart", at.x(v[0] + 140), y);
            await finger("touchEnd", at.x(v[0] + 140), y);
            await warm(2);
        };
        await tapRows(2);
        if ((await readout()).join() !== "Room C1 — 3 of 30")
            bad("List: a press with no movement selects", `the header reads ${(await readout()).join()}, want "Room C1 — 3 of 30"`);
        else ok("List: a press with no movement selects", "a tap on the third row selected it: the release runs its onClick");
        await tapRows(0);
        if ((await readout()).join() !== "Room A1 — 1 of 30")
            bad("List: ... and another", `the header reads ${(await readout()).join()}, want "Room A1 — 1 of 30"`);
        else ok("List: ... and another", "a tap on the first row selected it again (the touch that does not travel is a click)");

        // (e) the same round trip with the mouse, and the same frame at the end: the two pointers leave one page
        const roundTrip = async (touch) => {
            const v = await box("list");
            const x = at.x(v[0] + 140), from = at.y(v[1] + 120);
            const to = (i) => (touch ? at.y(v[1] + 120 - 10 * i) : null);
            if (touch) {
                await finger("touchStart", x, from);
                for (let i = 1; i <= 4; i++) { await finger("touchMove", x, to(i)); await warm(); }
                await warm(12);
                await finger("touchEnd", x, to(4));
            } else {
                await page.mouse.move(x, from);
                await page.mouse.down();
                for (let i = 1; i <= 4; i++) { await page.mouse.move(x, from - 10 * i); await warm(); }
                await warm(12);
                await page.mouse.up();
            }
            await warm(20);
            if (touch) {
                await finger("touchStart", x, to(4));
                for (let i = 1; i <= 4; i++) { await finger("touchMove", x, to(4 - i)); await warm(); }
                await warm(12);
                await finger("touchEnd", x, from);
            } else {
                await page.mouse.move(x, from - 40);
                await page.mouse.down();
                for (let i = 1; i <= 4; i++) { await page.mouse.move(x, from - 40 + 10 * i); await warm(); }
                await warm(12);
                await page.mouse.up();
            }
            await warm(150); // the thumb fades out 0.6s after the last frame that moved, and the track settles
            return ev(() => window.__page.dump());
        };
        at = await open("list");
        const touchDump = await roundTrip(true);
        near("List: the round trip is back at the top", await offset(), 0, 0.01);
        at = await open("list");
        const mouseDump = await roundTrip(false);
        near("List: the mouse's round trip is back at the top", await offset(), 0, 0.01);
        if (touchDump !== mouseDump) bad("List: the two pointers leave the same frame", "the dumps differ");
        else ok("List: the two pointers leave the same frame", "the same drag and back, by finger and by mouse: one dump, " +
            "element for element (the raster at rest is the mouse's)");
        // ... and the mouse is still the mouse: a press, a 45px drag, `touch` false
        at = await open("list");
        const vm = await box("list");
        await page.mouse.move(at.x(vm[0] + 140), at.y(vm[1] + 120));
        await page.mouse.down();
        for (let i = 1; i <= 3; i++) { await page.mouse.move(at.x(vm[0] + 140), at.y(vm[1] + 120 - 15 * i)); await warm(); }
        await warm(12);
        if (await ev(() => window.__page.touch())) bad("List: the mouse's flag", "a mouse drag set `touch` to true");
        else ok("List: the mouse's flag", "a mouse drag's frames carry `touch` false");
        near("List: the mouse drags 1:1", await offset(), 45, 0.5);
        await page.mouse.up();

        // ------------------------------------------------------------------ the Sky
        at = await open("sky");
        const dump = async () => JSON.parse(await ev(() => window.__page.dump()));
        const named = async (name) => (await dump()).commands.filter((c) => c.element === name).map((c) => [c.type, ...c.box]);
        const feedOffset = () => ev(() => window.__page.offset());
        // the Science feed (three posts, 742px of content in the 664px feed: 78px of it scrolls)
        await finger("touchStart", at.x(185), at.y(32));
        await finger("touchEnd", at.x(185), at.y(32));
        await warm(40);
        const feed = (await named("sky-feed"))[0];
        const viewH = feed[4];
        if ((await feedOffset()) !== 0) bad("Sky: the feed starts at its top", `the offset is ${await feedOffset()}`);
        else ok("Sky: the feed starts at its top", `the Science feed, ${viewH}px of it, is at 0`);
        const fxx = at.x(feed[1] + 180), fyy = at.y(feed[2] + 300);
        // (d) 120px of drag: 1:1 to the feed's end, then the rubber band
        await finger("touchStart", fxx, fyy);
        for (let i = 1; i <= 4; i++) { await finger("touchMove", fxx, at.y(feed[2] + 300 - 15 * i)); await warm(); }
        const inside = await feedOffset();
        near("Sky: 60px of drag are 60px of offset (1:1)", inside, 60, 0.5, "the feed's content is longer than that");
        for (let i = 5; i <= 8; i++) { await finger("touchMove", fxx, at.y(feed[2] + 300 - 15 * i)); await warm(); }
        const held = await feedOffset();
        const flagSky = await ev(() => window.__page.touch());
        if (flagSky !== true) bad("Sky: a finger's flag", `the frame's \`touch\` is ${flagSky}, not true`);
        else ok("Sky: a finger's flag", "the feed's drag frames carry `touch` true too (the Sky has its own loop, the same flag)");
        await warm(12);
        await finger("touchEnd", fxx, at.y(feed[2] + 300 - 120));
        await warm(80);
        const end = await feedOffset();
        if (!(end < 120 && end > 60)) bad("Sky: the feed's end", `${end.toFixed(2)}px of content does not bound a 120px drag`);
        else ok("Sky: the 120px drag crosses the end", `the feed's content ends at ${r2(end)}px, so 120px of travel is past it`);
        near("Sky: past the end the drag is the rubber band's", held, end + rubber(120 - end, viewH), 0.5,
            `f(${r2(120 - end)}) in a ${viewH}px feed, as the wheel's pull is`);
        await warm(60);
        near("Sky: the release lets the band go", await feedOffset(), end, 0.5, "no fling: the band springs back to the clamp");

        // (d) the throw: the desktop's own drag, 10px in five 1/60 frames (solid/sky.test.ts), so the rest is its number
        at = await open("sky");
        await finger("touchStart", at.x(185), at.y(32));
        await finger("touchEnd", at.x(185), at.y(32));
        await warm(40);
        const point = (dy, down) => page.evaluate(([y, d]) => window.__page.pointer(180, 300 - y, d), [dy, down]);
        await point(0, false); await warm();
        await point(0, true); await warm();
        for (let i = 1; i <= 5; i++) { await point(2 * i, true); await warm(); }
        await point(10, false); await warm();
        const released = await feedOffset();
        await warm();
        const next = await feedOffset();
        if (!(next > released)) bad("Sky: the throw's velocity", `the frame after the release is ${next.toFixed(2)}, not past ${released.toFixed(2)}`);
        else ok("Sky: the throw's velocity is positive", `released at ${r2(released)}, the frame after it ${r2(next)}: the decay runs on`);
        await warm(150);
        near("Sky: the throw rests where the decay projects", await feedOffset(), THROW_REST, 0.5,
            "the desktop's own number for the same drag (sky.test.ts)");
        // (d) a drag that travelled is not a click on the card under it; a tap is
        const card = (await named("sky-card-0"))[0];
        const cx = at.x(card[1] + 100), cy = at.y(Math.max(card[2], feed[2]) + 120);
        const thread = async () => (await named("sky-thread")).length > 0;
        await finger("touchStart", cx, cy);
        await finger("touchMove", cx, at.y(Math.max(card[2], feed[2]) + 115));
        await warm(2);
        await finger("touchEnd", cx, at.y(Math.max(card[2], feed[2]) + 115));
        await warm(40);
        if (await thread()) bad("Sky: a 5px drag is not a click", "the thread opened from a drag on the card");
        else ok("Sky: a 5px drag is not a click", "the drag scrolled the feed and the card's press was dropped (vscroll's `dragged`)");
        // the card has moved with the feed: its own point again
        const card2 = (await named("sky-card-0"))[0];
        const cy2 = at.y(Math.max(card2[2], feed[2]) + 120);
        await finger("touchStart", cx, cy2);
        await finger("touchEnd", cx, cy2);
        await warm(40);
        const tapped = await thread();
        if (!tapped) bad("Sky: a tap opens the thread", "the thread did not open from a tap on the card");
        else ok("Sky: a tap opens the thread", "the same press with no travel ran the card's onClick");
        const back = (await named("sky-back"))[0];
        if (back) {
            await finger("touchStart", at.x(back[1] + 10), at.y(back[2] + 10));
            await finger("touchEnd", at.x(back[1] + 10), at.y(back[2] + 10));
            await warm(40);
        }
        if (await thread()) bad("Sky: Back returns to the feed", "the thread is still open");
        else ok("Sky: Back returns to the feed", "a tap on the Back control closed the thread");
        // (a) the flag does the work: the same 2px travel is a drag for a finger (no threshold) and a click for the mouse
        const card3 = (await named("sky-card-0"))[0];
        const cy3 = at.y(Math.max(card3[2], feed[2]) + 120);
        await finger("touchStart", cx, cy3);
        await finger("touchMove", cx, at.y(Math.max(card3[2], feed[2]) + 118));
        await warm(2);
        await finger("touchEnd", cx, at.y(Math.max(card3[2], feed[2]) + 118));
        await warm(40);
        const fingerThread = await thread();
        const fingerFlag = await ev(() => window.__page.touch());
        if (fingerThread || fingerFlag !== true)
            bad("Sky: a finger's 2px travel", `thread ${fingerThread} (want false), \`touch\` ${fingerFlag} (want true): ` +
                "a finger has no click threshold");
        else ok("Sky: a finger's 2px travel is already a drag", "the thread stayed shut and the frame's `touch` is true");
        const card4 = (await named("sky-card-0"))[0];
        const cy4 = at.y(Math.max(card4[2], feed[2]) + 120);
        await page.mouse.move(cx, cy4);
        await page.mouse.down();
        await page.mouse.move(cx, cy4 - 2);
        await warm(2);
        await page.mouse.up();
        await warm(40);
        const mouseThread = await thread();
        const mouseFlag = await ev(() => window.__page.touch());
        if (!mouseThread || mouseFlag !== false)
            bad("Sky: the mouse's 2px travel", `thread ${mouseThread} (want true), \`touch\` ${mouseFlag} (want false): ` +
                "the mouse keeps its 4px threshold");
        else ok("Sky: the mouse's 2px travel clicks", "the card's thread opened and the frame's `touch` is false: " +
            "the same 2px, the flag's one rule");

        // ---------------------------------------------------------------- the cost
        at = await open("list");
        let v = await box("list");
        await page.mouse.move(at.x(v[0] + 140), at.y(v[1] + 120));
        await page.mouse.down();
        const listMs = await ev(() => window.__page.bench(100));
        await page.mouse.up();
        const listBundle = (await stat(BUNDLE.list)).size;
        at = await open("sky");
        await finger("touchStart", at.x(185), at.y(32));
        await finger("touchEnd", at.x(185), at.y(32));
        await warm(40);
        const feed2 = (await named("sky-feed"))[0];
        await finger("touchStart", at.x(feed2[1] + 180), at.y(feed2[2] + 300));
        await warm(2);
        const skyMs = await ev(() => window.__page.bench(100));
        await finger("touchEnd", at.x(feed2[1] + 180), at.y(feed2[2] + 300));
        const skyBundle = (await stat(BUNDLE.sky)).size;
        console.log(`info ${listBundle} B of bundle (list.js), ${skyBundle} B (sky.js), ` +
            `${(await stat(join(WASM_DIR, "ui.wasm"))).size} B of ui.wasm`);
        console.log(`info ${listMs.toFixed(2)} ms a frame on the List with a drag in flight (100 frames), ` +
            `${skyMs.toFixed(2)} ms on the Sky (declare, Clay's layout, the commands, Canvas2D's raster, one readback)`);

        const errors = logs.filter(l => l.startsWith("pageerror"));
        if (errors.length) bad("the pages", errors.join("; "));
        else ok("the pages", "no page error through the whole check");
    } finally {
        await browser.close();
        server.close();
    }
    if (failures) { console.log(`${failures} failure(s) of ${comparisons} comparisons`); process.exit(1); }
    console.log(`browser/touch-check: ok, ${comparisons} comparisons`);
}

main();
