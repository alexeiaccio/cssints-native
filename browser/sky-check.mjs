// The Sky page in the browser, checked against the desktop's own frame — and against the effects the browser's drawing
// has to add to a command array: a card's gradient, an avatar's picture, the cards' entry (a group: alpha and translate).
//
//   (a) the frame at rest (`warm`: the cards' entry is over), against solid/frames/sky.png, the desktop's frame of the
//       same page through ThorVG. Not per pixel — another rasteriser's glyphs, and Canvas2D measures text by its own
//       advances, so the cards' boxes move by a pixel or two — but per command box (the mean colour of every box, and
//       each text line's ink box, as browser/check.mjs compares against ThorVG's Sensors frame) and as the whole frame's
//       mean colour. The tolerances are check.mjs's: a box's mean within 20/255, a text's ink box within 4px, the frame's
//       mean within 3/255, and 12% of the pixels may differ at all.
//   (b) the gradient: two points of a card's own box, in its right padding where no text or avatar is — the top is the
//       panel token, the bottom the deep one, as sky.test.ts asserts for the desktop, and a row across it does not vary
//       (the gradient is vertical). A gradient drawn as a flat fill fails this and nothing else.
//   (c) the avatars: the picture in the image command's box, its centre the head's lighter tint of the author's hue and
//       its body the hue (michaelwarburton is 99,178,255 and 74,132,214), which no command array carries.
//   (d) the entry: eight frames in, the first card is a group — its alpha a fade, its translate 3.6px down: the pixels
//       below its resting bottom edge are the card's, faintly, and inside it the fill is between the page and its tone. A
//       group ignored (an alpha of 255 and no offset) fails both; the feed's clip, which the group sits in, must still
//       close where it does, or the status line under it is lost.
//   (f) the notifications (the page's fourth screen, `n` on the feed, app/Notify.tsx): the header and the five rows in
//       the frame's own texts, and a click on a row opening its post's thread — the page's loader never settles here, so
//       that thread is its loading row — with Escape back to the list.
//
// The page's own window loop is held (`requestAnimationFrame` never calls back), so every frame here is the one the check
// asks for: `warm(n)` is n frames at 1/60, the timeline a headless desktop run's `--settle`.
//
//   node browser/sky-check.mjs            the check (build first: sh browser/build.sh && bun browser/solid/build.ts)
//   node browser/sky-check.mjs --serve    serve the page and print its URL, for looking at it by hand
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BROWSER = join(ROOT, "browser");
const WASM_DIR = process.env.WASM_DIR || join(process.env.TMPDIR || "/tmp", "cssints-native-web");
const BUNDLE = join(WASM_DIR, "solid/sky.js");
const SIZE = { width: 360, height: 760 };
// the design's frame: the Sky page on the desktop, ThorVG's software canvas
const DESKTOP = "/solid/frames/sky.png";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".ttf": "font/ttf",
    ".png": "image/png", ".json": "application/json" };
let failures = 0;
const ok = (name, extra = "") => console.log(`ok   ${name}${extra ? " — " + extra : ""}`);
const bad = (name, why) => { failures++; console.log(`FAIL ${name}: ${why}`); };

function serve() {
    return new Promise(done => {
        const server = createServer(async (req, res) => {
            const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
            // the build products, outside the repo: the wasm, the bundle, and the page
            const built = path === "/browser/solid/ui.wasm" ? join(WASM_DIR, "ui.wasm")
                : path === "/browser/solid/sky.js" ? BUNDLE
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

/** The page's window loop is the check's: requestAnimationFrame never calls back, so no frame runs unasked (and Playwright
 *  would wait on that same callback: every wait here polls on a timer instead). */
const HOLD = () => {
    window.requestAnimationFrame = () => 0;
};

/** (a) the frame against the desktop's, done in the page: per command box a mean colour, per text command an ink box. */
const REGIONS = async ({ refURL, boxes }) => {
    const a = document.getElementById("frame").getContext("2d").getImageData(0, 0, 360, 760);
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
    let differing = 0, differing1 = 0, differing2 = 0;
    const meanA = [0, 0, 0], meanB = [0, 0, 0];
    for (let i = 0; i < a.data.length; i += 4) {
        let d = 0;
        for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(a.data[i + k] - b[i + k]));
        if (d > 0) differing++;
        if (d > 1) differing1++;
        if (d > 2) differing2++;
        for (let k = 0; k < 3; k++) meanA[k] += a.data[i + k], meanB[k] += b[i + k];
    }
    const n = a.width * a.height;
    const frameMean = Math.max(...meanA.map((v, k) => Math.abs(v / n - meanB[k] / n)));
    const regions = [], inks = [];
    let fill = "#000000"; // the last rectangle's colour: a text box's background
    for (const box of boxes) {
        if (box.type === 1) fill = box.color;
        const r = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) };
        r.x = Math.max(0, r.x), r.y = Math.max(0, r.y);
        r.w = Math.min(a.width - r.x, r.w), r.h = Math.min(a.height - r.y, r.h);
        if (r.w <= 0 || r.h <= 0) continue;
        const ma = mean(a.data, r.x, r.y, r.x + r.w, r.y + r.h);
        const mb = mean(b, r.x, r.y, r.x + r.w, r.y + r.h);
        regions.push({ box, text: box.text, delta: Math.max(...ma.map((v, k) => Math.abs(v - mb[k]))), a: ma, b: mb });
        if (box.type === 3) {
            const bg = rgb(fill), ia = inkBox(a.data, r, bg), ib = inkBox(b, r, bg);
            if (ia && ib) inks.push({ box, ia, ib, delta: Math.max(...ia.map((v, k) => Math.abs(v - ib[k]))) });
            else if (!ia && !ib) inks.push({ box, delta: 0 });
            else inks.push({ box, delta: 99 });
        }
    }
    const worst = list => list.reduce((m, e) => (e.delta > m.delta ? e : m), { delta: 0 });
    return { differing, differing1, differing2, total: n, frameMean, region: worst(regions), ink: worst(inks) };
};

function assertRegions(name, diff, { regionMax, inkMax, meanMax, pixelPct }) {
    // The desktop dithers a gradient by +-1 (a 4x4 Bayer pattern; this target's is smooth) and rounds its ends one level
    // the other way, so nearly every pixel of a card differs by one or two and the count of *any* difference says nothing.
    // What is counted is a difference past that: a third of a level out is this rasteriser's (glyphs — Canvas2D's hinting
    // and ThorVG's advances — and the anti-aliased edges of the avatars and the rounded corners).
    const pct = (100 * diff.differing2) / diff.total;
    const any = (100 * diff.differing) / diff.total, dither = (100 * diff.differing1) / diff.total;
    const who = `${diff.region.box.x.toFixed(0)},${diff.region.box.y.toFixed(0)}` +
        `${diff.region.text ? ` "${diff.region.text}"` : ""}`;
    if (diff.region.delta > regionMax)
        return bad(name, `the box at (${who}) is ${diff.region.a.map(v => v.toFixed(1))} here and ` +
            `${diff.region.b.map(v => v.toFixed(1))} on the desktop, ${diff.region.delta.toFixed(1)}/255 apart in the mean, over ${regionMax}`);
    if (diff.ink.delta > inkMax)
        return bad(name, `the ink of "${diff.ink.box.text}" is ${diff.ink.delta.toFixed(0)}px off (${diff.ink.ia} vs ${diff.ink.ib}), over ${inkMax}`);
    if (diff.frameMean > meanMax) return bad(name, `the frame's mean colour is ${diff.frameMean.toFixed(2)}/255 off, over ${meanMax}`);
    if (pct > pixelPct) return bad(name, `${pct.toFixed(1)}% of pixels differ by more than 2/255, over ${pixelPct}%`);
    ok(name, `${any.toFixed(2)}% of pixels differ at all (${dither.toFixed(2)}% by the dither's one level or two, ` +
        `${pct.toFixed(2)}% by more); the worst box's mean within ${diff.region.delta.toFixed(1)}/255 (at ${who}); ` +
        `text ink within ${diff.ink.delta.toFixed(0)}px ("${diff.ink.box?.text}"); the frame's mean within ` +
        `${diff.frameMean.toFixed(2)}/255`);
}

/** (b) a card's gradient: the column in its right padding, and one row across its top padding. */
const GRADIENT = () => {
    const effects = window.__page.effects();
    const commands = window.__page.commands();
    const at = commands.findIndex(c => c.type === 1 && effects.gradients.has(c.id));
    const box = commands[at];
    const x = box.x + box.w - 8, top = box.y + 4, bottom = box.y + box.h - 6;
    const across = [];
    for (let i = box.x + 8; i < box.x + box.w - 8; i++) across.push(window.__page.pixel(i, top).slice(0, 3));
    const spread = across.reduce((m, c) => Math.max(m, Math.abs(c[0] - across[0][0])), 0);
    return {
        box: [box.x, box.y, box.w, box.h], gradient: effects.gradients.get(box.id),
        top: window.__page.pixel(x, top).slice(0, 3), bottom: window.__page.pixel(x, bottom).slice(0, 3),
        middle: window.__page.pixel(x, Math.round(box.y + box.h / 2)).slice(0, 3), spread,
    };
};

/** (c) the avatars: each image command's box and the two points sky.test.ts checks on the desktop. */
const AVATARS = () => window.__page.commands()
    .filter(c => c.type === 4)
    .map(c => ({
        path: c.text.split("/").pop(), box: [c.x, c.y, c.w, c.h],
        centre: window.__page.pixel(c.x + 20, c.y + 20).slice(0, 3),
        body: window.__page.pixel(c.x + 10, c.y + 10).slice(0, 3),
        corner: window.__page.pixel(c.x + 1, c.y + 1).slice(0, 3),
    }));

/** (d) a frame of the entry, at the first card's resting box: the fill inside it, and the rows below its bottom edge. */
const ENTRY = ({ box, page }) => {
    const [x, y, w, h] = box;
    const effects = window.__page.effects();
    const px = (x, y) => window.__page.pixel(x, y).slice(0, 3);
    let below = 0; // how many rows under the resting bottom edge are not the page: the group's translate
    for (let k = 1; k <= 6; k++) if (px(x + 100, y + h + k).join() !== page.join()) below++;
    return {
        groups: effects.groups.map(g => ({ alpha: g.alpha, ty: +g.ty.toFixed(2), rotate: g.rotate, scale: g.scale })),
        inside: px(x + 100, y + 60), below,
    };
};

const apart = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const between = (c, a, b) => c.join() !== a.join() && c.join() !== b.join() &&
    c.every((v, i) => v >= Math.min(a[i], b[i]) && v <= Math.max(a[i], b[i]));

async function main() {
    const missing = [join(WASM_DIR, "ui.wasm"), BUNDLE, join(BROWSER, "solid/sky.html")].filter(f => !existsSync(f));
    if (missing.length) {
        console.log(`missing build product(s): ${missing.join(", ")}`);
        console.log(`run "sh browser/build.sh && bun browser/solid/build.ts" first`);
        process.exit(1);
    }
    const { server, port } = await serve();
    if (process.argv.includes("--serve")) {
        console.log(`http://127.0.0.1:${port}/browser/solid/sky.html   (Ctrl-C to stop)`);
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

    const page = await open("/browser/solid/sky.html?bench=0");
    try {
        // the entry, on its own page: two frames lay the tree out and draw its first instant, eight are mid-fade
        const first = await open("/browser/solid/sky.html?bench=0");
        await first.evaluate(() => window.__page.warm(1));
        // the avatars are decoded asynchronously: the page draws them the frame after they arrive
        await first.waitForFunction(() => window.__page.images().length > 0 &&
            window.__page.images().every(i => i.complete && i.width > 0), null, { polling: 100, timeout: 10000 });

        // the settled frame: 40 frames at 1/60 is past the last card's 0.3s entry (six 50ms delays plus 0.3s)
        await page.evaluate(() => window.__page.warm(1));
        await page.waitForFunction(() => window.__page.images().length > 0 &&
            window.__page.images().every(i => i.complete && i.width > 0), null, { polling: 100, timeout: 10000 });
        await page.evaluate(() => window.__page.warm(45));
        const errors = await page.evaluate(() => window.__page.errors());
        if (errors) bad("clay", `${errors} Clay errors`); else ok("clay", "no errors");

        const commands = await page.evaluate(() => window.__page.commands());
        const effects = await page.evaluate(() => {
            const e = window.__page.effects();
            return { shadows: e.shadows.size, gradients: e.gradients.size, groups: e.groups.length };
        });
        const images = commands.filter(c => c.type === 4).length;
        ok("effects", `${commands.length} commands, ${effects.gradients} gradients, ${images} images, ` +
            `${effects.groups} groups, ${effects.shadows} shadows a frame at rest`);

        // (a) the frame against the desktop's
        const regions = await page.evaluate(REGIONS, { refURL: DESKTOP, boxes: commands });
        assertRegions("raster, the Sky page vs the desktop's solid/frames/sky.png", regions,
            { regionMax: 20, inkMax: 4, meanMax: 3, pixelPct: 12 });

        // (b) the card's gradient
        const gradient = await page.evaluate(GRADIENT);
        const near = (got, want, d) => want.every((v, i) => Math.abs(got[i] - v) <= d);
        const PANEL = [27, 32, 38], PANEL_DEEP = [21, 25, 30];
        if (!near(gradient.top, PANEL, 2)) bad("gradient, the card's top", `${gradient.top}, the panel token ${PANEL}`);
        else if (!near(gradient.bottom, PANEL_DEEP, 2)) bad("gradient, the card's bottom", `${gradient.bottom}, the panel's deep end ${PANEL_DEEP}`);
        else if (!(gradient.top[0] >= gradient.bottom[0] + 3)) bad("gradient, top to bottom", `${gradient.top} over ${gradient.bottom}: not a gradient`);
        else if (gradient.spread > 2) bad("gradient, across", `a row varies by ${gradient.spread}/255: not vertical`);
        else ok("gradient, a card's box", `top ${gradient.top} (the panel), middle ${gradient.middle}, bottom ${gradient.bottom} ` +
            `(the deep end); a row across it varies by ${gradient.spread}/255; ${gradient.gradient.stops.length} stops, ` +
            `${gradient.gradient.angle}deg`);

        // (c) the avatars
        const avatars = await page.evaluate(AVATARS);
        // the two points sky.test.ts checks on the desktop, for the first card's author; the others need a picture (their
        // centre is not the card's panel) and nothing more
        const HEAD = [99, 178, 255], BODY = [74, 132, 214]; // michaelwarburton's hue, drawn
        const michael = avatars[0];
        const off = michael
            ? Math.max(...HEAD.map((v, i) => Math.abs(michael.centre[i] - v)), ...BODY.map((v, i) => Math.abs(michael.body[i] - v)))
            : 99;
        const sized = avatars.every(a => Math.round(a.box[2]) === 40 && Math.round(a.box[3]) === 40);
        const painted = avatars.every(a => a.centre.join() !== a.corner.join());
        if (!avatars.length) bad("avatars", "no image command in the frame");
        else if (!sized) bad("avatars", `a box is ${avatars.map(a => a.box.slice(2).join("x")).join(", ")}, not 40x40`);
        else if (!painted) bad("avatars", `a picture is not drawn: ${avatars.map(a => `${a.path} centre ${a.centre}, corner ${a.corner}`).join("; ")}`);
        else if (off > 3) bad("avatars", `${avatars.length} drawn, but michaelwarburton's is ${off}/255 off sky.test.ts's ` +
            `${HEAD} (centre ${michael.centre}) and ${BODY} (body ${michael.body})`);
        else ok("avatars", `${avatars.length} pictures 40x40; michaelwarburton's centre ${michael.centre} and body ` +
            `${michael.body} (sky.test.ts's colours, ${off}/255 off); ${avatars.map(a => a.path).join(", ")}`);

        // (d) a shadow, which the Sky page has none of: the drawing's own blur, on a scratch canvas
        const shadow = await page.evaluate(() => window.__page.shadow());
        const alpha = shadow.near[3];
        if (!(alpha > 20 && alpha < 250)) bad("shadow, a box's blur", `4px outside the shadow's box the pixel is ` +
            `${shadow.near} (alpha ${alpha} of 255): the blur is not drawn, or the box is`);
        else if (shadow.far[3] !== 0) bad("shadow, the blur's edge", `40px out the shadow still covers the pixel: ${shadow.far}`);
        else ok("shadow, a box's blur", `10px to the right of a white box a black shadow's blur fades out: ` +
            `${alpha}/255 of it at 4px out, nothing at 44px (${shadow.far})`);

        // (e) the entry's group, at the first card's box (its gradient's rectangle) from the settled frame
        const PAGE = [16, 19, 22];
        const box = await page.evaluate(() => {
            const e = window.__page.effects();
            const c = window.__page.commands().find(c => c.type === 1 && e.gradients.has(c.id));
            return [c.x, c.y, c.w, c.h];
        });
        const rest = await page.evaluate(ENTRY, { box, page: PAGE });
        await first.evaluate(() => window.__page.warm(7));
        const entry = await first.evaluate(ENTRY, { box, page: PAGE });
        const shifted = entry.groups.find(g => g.ty > 1 && g.alpha > 0 && g.alpha < 255);
        if (!entry.groups.length) bad("entry, the cards' group", "eight frames in no group is drawn: the entry is the literal");
        else if (!shifted) bad("entry, the cards' group", `no group is fading and offset: ${JSON.stringify(entry.groups)}`);
        else if (entry.below < 1) bad("entry, the group's translate", `${entry.below} rows below the card's resting edge are ` +
            `the card: the ${shifted.ty}px offset is not drawn`);
        else if (!between(entry.inside, PAGE, rest.inside)) bad("entry, the group's alpha", `inside the card 8 frames in ` +
            `is ${entry.inside}, at rest ${rest.inside}, the page ${PAGE}: not a fade`);
        else if (rest.below !== 0) bad("entry, at rest", `${rest.below} rows below the card are not the page`);
        else if (rest.groups.length) bad("entry, at rest", `${rest.groups.length} groups are still drawn`);
        else ok("entry, the cards' group", `8 frames in: ${entry.groups.length} groups, the first at alpha ` +
            `${shifted.alpha}/255 and ${shifted.ty}px down; inside the card ${entry.inside} between the page ${PAGE} and ` +
            `its resting ${rest.inside}, and ${entry.below} rows below its resting edge are the card. At rest: no groups, ` +
            `nothing below the edge`);

        // the frame's ms and the sizes
        await page.evaluate(() => window.__page.warm(3));
        // ... and a page at rest draws nothing: the hash folds the effects in (a group's alpha moves no box), and a
        // settled frame's is the one before it
        const idle = await page.evaluate(() => {
            const before = window.__page.draws();
            window.__page.warm(30);
            return window.__page.draws() - before;
        });
        if (idle) bad("idle", `${idle} of 30 frames at rest drew`);
        else ok("idle", "30 frames at rest drew nothing: the frame hash is still");

        // ... and the feed's own scroll machine (src/vscroll.ts) under the wheel: Discover's three posts fit the feed, so
        // a tab click switches to Science, whose cards are taller than the viewport
        const rect = await page.locator("#frame").boundingBox();
        await page.mouse.click(rect.x + 185, rect.y + 32); // the Science tab
        await page.evaluate(() => window.__page.warm(40));
        const switched = await page.evaluate(() => window.__page.commands().some(c => c.text === "Erik Strub"));
        const scrolled = await page.evaluate(() => {
            const first = () => window.__page.commands().find(c => c.type === 4).y;
            const before = first();
            window.__page.wheel(3);
            window.__page.warm(40);
            return [before, first()];
        });
        if (!switched) bad("a click on the Science tab", "the feed is still Discover's");
        else if (!(scrolled[0] - scrolled[1] > 10))
            bad("wheel over the feed", `the first card's avatar is at ${scrolled[1]} after three notches, ${scrolled[0]} ` +
                `before: it did not scroll`);
        else ok("the bar and the wheel", `a click on the Science tab switches the feed, and three notches glide its cards ` +
            `${(scrolled[0] - scrolled[1]).toFixed(1)}px up (${scrolled[0]} -> ${scrolled[1]})`);

        // (f) the notifications (the page's fourth screen, `n` on the feed, app/Notify.tsx): the five rows out of the
        // app's recordings under the app's verbs, and a click on a row opening its post's thread — the page's loader
        // never settles here, so the thread is its loading state, and Escape is the list again
        await page.keyboard.press("n");
        await page.evaluate(() => window.__page.warm(30));
        const texts = () => page.evaluate(() => window.__page.commands().filter(c => c.type === 3).map(c => c.text.trim()));
        const want = ["Erik Strub mentioned you", "Titania reposted", "Michael Warburton liked your post",
            "jlp2024.bsky.social replied", "Mina Kimes followed you"];
        const rows = await texts();
        const missing = want.filter(w => !rows.some(t => t.startsWith(w)));
        await page.mouse.click(rect.x + 180, rect.y + 150); // the first row's line
        await page.evaluate(() => window.__page.warm(2));
        const opened = await texts();
        await page.keyboard.press("Escape");
        await page.evaluate(() => window.__page.warm(40));
        const back = await texts();
        const listed = (list, prefix) => list.some(t => t.startsWith(prefix));
        if (missing.length) bad("notifications, the rows", `no row for ${missing.join(", ")}: ${rows.join(" | ")}`);
        else if (!listed(rows, "Notifications")) bad("notifications, the header", `no "Notifications": ${rows.join(" | ")}`);
        else if (!listed(opened, "Loading the thread")) bad("notifications, a row's press",
            `a click on the first row opened no thread: ${opened.join(" | ")}`);
        else if (!listed(back, want[0])) bad("notifications, Escape", `the list is not back: ${back.join(" | ")}`);
        else ok("notifications", `n on the feed: the header and the five rows ("${want[0]}", ...); a click on the ` +
            `first row opened the thread's loading row (the page's loader has no answer here), and Escape is the list again`);

        const ms = await page.evaluate(() => window.__page.bench(100));
        const bundle = (await stat(BUNDLE)).size;
        const wasm = (await stat(join(WASM_DIR, "ui.wasm"))).size;
        const html = (await stat(join(BROWSER, "solid/sky.html"))).size;
        const draw = (await stat(join(BROWSER, "draw.js"))).size;
        console.log(`info ${bundle} B of bundle (sky.js), ${wasm} B of wasm (ui.wasm), ${html} B of sky.html, ${draw} B of draw.js`);
        console.log(`info ${ms.toFixed(2)} ms a frame (100 frames: the tree declared, Clay's layout, the commands and the ` +
            `effect tables read out, Canvas2D's raster, one readback)`);
        if (logs.some(l => l.startsWith("pageerror"))) bad("page", logs.join("; "));
        await first.close();
    } finally {
        await browser.close();
        server.close();
    }
    if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
    console.log("browser/solid/sky: ok");
}

main();
