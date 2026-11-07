// native/browser/hot-check.mjs — the dev server's hot re-mount (browser/serve.ts's `hot` event, browser/solid/shell.ts's
// `options.hot`), measured next to the full reload it replaces, and against the two mutations that would fake it.
//
// The check never touches this tree: it copies the repo into a temp directory (every node_modules is symlinked back
// here, and native/build is left out) and starts the server with `--root` on the copy, so every save below is a write
// into the copy, exactly as browser/serve-check.mjs does. On the Widgets page (browser/solid/widgets.ts, which opts in)
// it asserts:
//
//   (a) the shell's state survives a `.tsx` save. The switch is clicked checked (Tab Tab, Space), the pointer is parked
//       on its row, the document is scrolled; then a colour of the page's own style (the switch's `off` token) is
//       changed. After the `hot` event: no navigation (`performance.timeOrigin`), the track's fill is the new colour —
//       the new module is on screen —, the pointer still hovers the same row, `document.activeElement` is still the
//       canvas, the scroll is where it was, and the wasm's `presents`/`draws` counters carry on. The page's own state
//       does NOT survive, and is measured: the switch reads `checked: false` (its signal is the component's, and a
//       re-render is a new component), and its `:focus` ring is gone (the page's `Input` is new). Three re-mounts: the
//       canvas's listener count is the same, `performance.memory`'s delta is printed, and the host's frame rate is one
//       rAF (~60/s), not two.
//   (b) the same save with the full reload (`?hot=0` makes the page decline the opt-in, so the client reloads): the new
//       colour again, and the difference is the shell — the switch unchecked (as on hot), but `presents` starts over, the
//       pointer is unknown (the row is `surface`, not `hover`), the document is back at 0 and the focus is on the body.
//       The two save-to-frame times, hot and reload, are printed (medians of three).
//   (c) a `.c` save still reloads: ui.wasm is rebuilt and a `WebAssembly.Instance` is a new page — the navigation, the
//       counters at 0, the state gone.
//   (d) a broken `.tsx` save: the bundles do not build, the last good page keeps drawing (the same frame hash, no
//       navigation) and the injected bar has the compiler's text; the fixed save is hot again.
//   (e) the arrow: after three re-mounts the shell runs one frame loop — the host's frame counter advances at ~60/s
//       while the page is idle, and `draws` does not move (a page at rest draws nothing; a second loop's tree would).
//
// `--mutate=dispose` skips the old session's dispose in the copy's shell.ts, and `--mutate=state` makes the check claim
// the switch survives: both must be killed (the run exits 0 when the mutation was caught, 1 when it survived).
//
//   node browser/hot-check.mjs
//   node browser/hot-check.mjs --mutate=dispose
//   node browser/hot-check.mjs --mutate=state
//
// Run from solid/test.sh with the other browser checks (needs bun, zig and Playwright's chromium).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import {
    cpSync,
    existsSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NATIVE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(NATIVE, "..");
// a save's new frame must arrive inside this; the whole bundle build dominates it and this machine can be under a load
const BOUND = 300_000;
// a mutation is a run expecting to be caught: `--mutate=dispose` patches the copy's shell, `--mutate=state` flips the
// check's own claim about the page's state
const MUTATE = (process.argv.find((arg) => arg.startsWith("--mutate=")) ?? "").slice("--mutate=".length);

let failures = 0;
const ok = (name, extra = "") => console.log(`ok   ${name}${extra ? " — " + extra : ""}`);
const bad = (name, why) => {
    failures++;
    console.log(`FAIL ${name}: ${why}`);
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const hex = ([r, g, b]) => "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");

// --- the tree the server builds, a temp copy of native/ -----------------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), "cssints-hot-check-"));
const repo = join(dir, "repo");
const root = join(repo, "native");
const skip = (src) =>
    !src.split(/[\\/]/).includes("node_modules") &&
    !src.split(/[\\/]/).includes(".git") &&
    !src.endsWith(".DS_Store");
cpSync(REPO, repo, {
    recursive: true,
    filter: (src) => skip(src) && !src.startsWith(join(NATIVE, "build")),
});
const linkModules = (rel) => {
    const from = join(REPO, rel, "node_modules");
    if (!existsSync(from)) return;
    symlinkSync(from, join(repo, rel, "node_modules"), "dir");
};
const walk = (rel, depth) => {
    linkModules(rel);
    if (depth === 2) return;
    for (const entry of readdirSync(join(REPO, rel), { withFileTypes: true }))
        if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git")
            walk(rel ? `${rel}/${entry.name}` : entry.name, depth + 1);
};
walk("", 0);

const SHELL = join(root, "browser/solid/shell.ts");
if (MUTATE === "dispose") {
    const text = readFileSync(SHELL, "utf8");
    const patched = text.replace("  host.session?.stop();", "  // mutation: the old page's session is not stopped");
    if (patched === text) {
        console.log("FAIL --mutate=dispose: the shell's dispose line moved");
        process.exit(1);
    }
    writeFileSync(SHELL, patched);
}

// --- the server, its lines, and a line's arrival -----------------------------------------------------------------------

const server = spawn("bun", [join(root, "browser/serve.ts"), "--root", root, "--port", "0"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
});
const lines = [];
const waiters = new Set();
function feed(line) {
    lines.push(line);
    console.log(`  | ${line}`);
    for (const waiter of [...waiters]) waiter(line);
}
for (const stream of [server.stdout, server.stderr]) {
    stream.setEncoding("utf8");
    let pending = "";
    stream.on("data", (chunk) => {
        pending += chunk;
        let at;
        while ((at = pending.indexOf("\n")) >= 0) {
            feed(pending.slice(0, at));
            pending = pending.slice(at + 1);
        }
    });
}
const exited = new Promise((done) => server.on("exit", (code) => done(code)));

/** A line matching `re` that arrives from `from` on (a save's build line, not the first build's). */
function waitLine(re, ms = BOUND, from = lines.length) {
    return new Promise((done, fail) => {
        for (const line of lines.slice(from)) {
            const match = re.exec(line);
            if (match) return done(match);
        }
        const waiter = (line) => {
            const match = re.exec(line);
            if (match) {
                clearTimeout(timer);
                waiters.delete(waiter);
                done(match);
            }
        };
        const timer = setTimeout(() => {
            waiters.delete(waiter);
            fail(new Error(`no line /${re.source}/ within ${ms} ms`));
        }, ms);
        waiters.add(waiter);
    });
}

// --- the page's state, as one object: what a save may keep -------------------------------------------------------------

/** The probe: the frame, the Wi-Fi switch, the pixels that say what the page is, and the host's numbers. */
const probeIn = () => {
    window.__page.warm(2); // the hover a mouse move and the layout it changed, before the pixels are read
    const cmds = window.__page.commands();
    const track = cmds.find((c) => c.type === 1 && c.w === 44 && c.h === 24);
    const ctx = document.getElementById("frame").getContext("2d");
    const px = (x, y) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data);
    const walk = (node, out) => {
        if (node.role === "switch" && node.name === "Wi-Fi") out.push(node);
        for (const child of node.children ?? []) walk(child, out);
        return out;
    };
    const sw = walk(window.__page.a11y(), [])[0];
    const row = sw?.bounds;
    return {
        origin: performance.timeOrigin,
        texts: cmds.filter((c) => c.type === 3).map((c) => c.text),
        commands: cmds.length,
        checked: sw?.states.checked ?? null,
        focused: sw?.states.focused ?? null,
        row,
        track: track ? { x: track.x, y: track.y, w: track.w, h: track.h, color: track.color } : null,
        // the track's two halves: the thumb is the white circle, on the left when unchecked and the right when checked
        trackLeft: track ? px(track.x + 5, track.y + track.h / 2) : null,
        trackRight: track ? px(track.x + track.w - 5, track.y + track.h / 2) : null,
        // the row's far end, away from the track and the label: the row's own background (surface, or hover)
        rowPixel: row ? px(row[0] + row[2] - 8, row[1] + row[3] / 2) : null,
        presents: window.__page.presents(),
        draws: window.__page.draws(),
        frames: window.__page.frames(),
        hash: window.__page.hash(),
        scroll: window.scrollY,
        active: document.activeElement?.id ?? null,
        bar: document.getElementById("__serve-error")?.textContent ?? null,
    };
};

async function main() {
    const listening = await waitLine(/listening (http:\/\/127\.0\.0\.1:\d+)/, 300_000, 0);
    const origin = listening[1];
    for (const line of lines) if (/build failed:/.test(line)) {
        bad("the first build", "the server's first build failed; its lines are above");
        throw new Error("the server's first build failed");
    }

    const browser = await chromium.launch({ args: ["--enable-precise-memory-info"] });
    const context = await browser.newContext({ viewport: { width: 440, height: 520 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    const watch = (page) => {
        page.on("pageerror", (error) => pageErrors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") pageErrors.push(message.text());
        });
    };

    /** A page on the server, mounted and settled (the first-mount entry is over). */
    async function open(url) {
        const page = await context.newPage();
        watch(page);
        await page.goto(url);
        await mount(page);
        return page;
    }
    async function mount(page) {
        await page.waitForFunction(() => window.__page, null, { timeout: 120_000 });
        await page.evaluate(() => window.__page.warm(31));
    }
    const probe = (page) => page.evaluate(probeIn);

    /** The canvas's DOM listeners, through CDP: the host's, and only the host's, however many pages have been on it. */
    async function listeners(page) {
        const cdp = await context.newCDPSession(page);
        try {
            const { result } = await cdp.send("Runtime.evaluate", { expression: `document.getElementById("frame")` });
            const { listeners: found } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId });
            return found.length;
        } finally {
            await cdp.detach().catch(() => {});
        }
    }

    /** The switch's track has a colour in the last frame's commands: the new module's style is on screen. */
    async function waitTrack(page, colour, ms = BOUND) {
        for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
            try {
                const got = await page.evaluate(
                    () => window.__page?.commands()?.find((c) => c.type === 1 && c.w === 44 && c.h === 24)?.color ?? null,
                );
                if (got === colour) return true;
            } catch {
                // the execution context is being replaced: the navigation of a full reload
            }
            await sleep(10);
        }
        return false;
    }

    /** A layout pixel of the Widgets page (360x760), as a viewport point of the canvas as it is now: the canvas's focus
     *  scrolls the document, so a box read earlier would be off by the scroll. */
    async function pointTo(page, x, y) {
        const rect = await page.evaluate(() => {
            const r = document.getElementById("frame").getBoundingClientRect();
            return { left: r.left, top: r.top, width: r.width, height: r.height };
        });
        await page.mouse.move(rect.left + (x * rect.width) / 360, rect.top + (y * rect.height) / 760);
    }

    /** The Widgets page driven: the canvas focused, Tab Tab to the Wi-Fi switch, Space checks it, the pointer on its row. */
    async function drive(page) {
        await pointTo(page, 6, 6); // the page's own padding: a click on empty space, and the canvas takes the focus
        await page.mouse.down();
        await page.mouse.up();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        await page.keyboard.press("Space");
        // the document scrolled before the pointer is placed: Chrome sends the canvas a mouseleave when it scrolls out from
        // under the cursor, and a pointer that left is not the one this check is about
        await page.evaluate(() => window.scrollTo(0, 40));
        const before = await probe(page);
        if (!before.row) return before;
        // the row's far end: the pointer there, so the row's background is the hover look and not its own (none)
        await pointTo(page, before.row[0] + before.row[2] - 8, before.row[1] + before.row[3] / 2);
        return probe(page);
    }

    const WIDGETS = join(root, "solid/app/Widgets.tsx");
    const WIDGETS_ORIGINAL = readFileSync(WIDGETS, "utf8");
    const OFF = `off: { $value: "rgb(60 64 78)" }`;
    /** The Widgets page's style saved: the switch's unchecked token, a colour only this page's bundle declares. */
    const setOff = (colour) => writeFileSync(WIDGETS, WIDGETS_ORIGINAL.replace(OFF, `off: { $value: "rgb(${colour.join(" ")})" }`));

    const UI_C = join(root, "browser/ui.c");
    const UI_C_ORIGINAL = readFileSync(UI_C, "utf8");

    /** The page after a full reload: a new document (its `performance.timeOrigin`) that mounts. */
    async function waitReload(page, before) {
        for (const deadline = Date.now() + BOUND; Date.now() < deadline; ) {
            try {
                if ((await page.evaluate(() => performance.timeOrigin)) !== before) break;
            } catch {
                // the execution context is being replaced: the navigation itself
            }
            await sleep(20);
        }
        await mount(page);
    }

    /** A `.tsx` save and its frame on screen: the save-to-frame ms (the build included), the build, and the colour. */
    async function saveStyle(page, colour) {
        const at = lines.length;
        const t0 = Date.now();
        setOff(colour);
        const build = await waitLine(/build (wasm|bundles) (\d+) ms/, BOUND, at);
        const built = Date.now();
        const seen = await waitTrack(page, hex(colour));
        return { ms: Date.now() - t0, seen, kind: build[1], buildMs: Number(build[2]), afterBuild: Date.now() - built };
    }

    try {
        // (a) the hot re-mount, on the page that opted in
        const page = await open(`${origin}/browser/solid/widgets.html`);
        let before = await drive(page);
        if (!before.track || !before.texts.includes("Wi-Fi"))
            throw new Error(`the Widgets page did not mount (${before.commands} commands)`);
        if (before.checked !== true) bad("(a) the switch before the save", `it reads checked ${before.checked}, not true`);
        else ok("(a) the switch before the save", "Space checked it (checked: true, and it has the focus)");
        if (before.trackLeft.join(",") !== "240,140,50,255") bad("(a) the checked track", `the track's left half is ${before.trackLeft}`);
        else ok("(a) the checked track", "the track's left half is the accent 240,140,50,255 (the thumb is at its right end)");
        if (!before.rowPixel || before.rowPixel.join(",") !== "48,53,68,255")
            bad("(a) the hover before the save", `the row's background is ${before.rowPixel}, not the hover look 48,53,68,255`);
        else ok("(a) the hover before the save", "the pointer is on the row: its background is the hover token 48,53,68,255");
        if (before.scroll !== 40) bad("(a) the scroll before the save", `window.scrollY is ${before.scroll}`);
        else ok("(a) the scroll before the save", "the document is scrolled to 40");
        const listenersBefore = await listeners(page);
        const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);

        // three saves: the first one asserted in full, the three timed (and the heap, listeners and loop after them)
        const colours = [
            [20, 100, 120],
            [20, 100, 121],
            [20, 100, 122],
        ];
        const hot = [];
        const afterBuilds = [];
        let after = null;
        const reloadsBefore = lines.filter((line) => /\[serve\] reload /.test(line)).length;
        for (const [n, colour] of colours.entries()) {
            const beforeOrigin = await page.evaluate(() => performance.timeOrigin);
            const save = await saveStyle(page, colour);
            afterBuilds.push(save.afterBuild);
            if (!save.seen) bad(`(a) the save ${n + 1}`, `the track's fill never became ${hex(colour)}`);
            if (save.kind !== "bundles") bad(`(a) the save ${n + 1} is the bundles only`, `the server rebuilt the ${save.kind}`);
            if (!hot.length) {
                after = await probe(page);
                const origin = await page.evaluate(() => performance.timeOrigin);
                if (origin !== beforeOrigin) bad("(a) hot is not a reload", `the page navigated (timeOrigin ${beforeOrigin} -> ${origin})`);
                else ok("(a) hot is not a reload", "performance.timeOrigin did not move");
                if (after.track?.color !== hex(colour)) bad("(a) the new module is on screen", `the track is ${after.track?.color}`);
                else ok("(a) the new module is on screen", `the track's style is the saved ${hex(colour)}`);
                if (after.trackRight.join(",") !== `${colour.join(",")},255`)
                    bad("(a) the new colour's pixels", `the track's right half is ${after.trackRight}, not ${colour.join(",")},255`);
                else ok("(a) the new colour's pixels", `the track's right half is the new off token ${colour.join(",")},255`);
                // the page's own state, measured: it does not survive, and a new module is a new component
                const claim = MUTATE === "state" ? true : false;
                if (after.checked !== claim)
                    bad(
                        "(a) the page's state after a hot re-mount",
                        `the switch reads checked: ${after.checked}, not ${claim} — the switch's signal is the page's (a new ` +
                            `module is a new component), so a re-mount loses it; the shell's state is what survives`,
                    );
                else ok("(a) the page's state after a hot re-mount", `the switch reads checked: ${after.checked}, as claimed`);
                if (after.focused === true) bad("(a) the focus manager after a hot re-mount", `the switch still has the focus: ${after.focused}`);
                else ok("(a) the focus manager after a hot re-mount", "the page's Input is new, so the switch is not the focused part (focused: false)");
                if (!after.rowPixel || after.rowPixel.join(",") !== "48,53,68,255")
                    bad("(a) the pointer after a hot re-mount", `the row's background is ${after.rowPixel}, not the hover look`);
                else ok("(a) the pointer after a hot re-mount", "the same row is still hovered: the host's pointer survived");
                if (after.active !== "frame") bad("(a) the DOM focus after a hot re-mount", `document.activeElement is ${after.active}`);
                else ok("(a) the DOM focus after a hot re-mount", "the canvas still has the document's focus");
                if (after.scroll !== 40) bad("(a) the scroll after a hot re-mount", `window.scrollY is ${after.scroll}, not 40`);
                else ok("(a) the scroll after a hot re-mount", "the document is still scrolled to 40: nothing navigated");
                if (after.presents < before.presents)
                    bad("(a) the wasm after a hot re-mount", `ui.presents went back to ${after.presents} from ${before.presents}`);
                else ok("(a) the wasm after a hot re-mount", `one WebAssembly.Instance: presents ${before.presents} -> ${after.presents}`);
                if (after.bar !== null) bad("(a) no error bar", `the bar says ${JSON.stringify(after.bar.slice(0, 200))}`);
                else ok("(a) no error bar", "the hot re-mount left no error in the page");
            }
            hot.push(save.ms);
        }
        const reloadsAfter = lines.filter((line) => /\[serve\] reload /.test(line)).length;
        if (reloadsAfter !== reloadsBefore) bad("(a) the server pushed no reload", `${reloadsAfter - reloadsBefore} reload(s) among the saves`);
        else ok("(a) the server pushed no reload", `${hot.length} hot events, no reload`);

        // (e) the arrow: three re-mounts, one loop. The page is given a moment to quiesce first: a frame queued by the
        // last re-mount (and the hover fade it settles) is a draw the page owes, and measuring across it would count
        // motion as a leak. `settle` waits, bounded, for the draw counter to stand still for three samples; a page that
        // never stops drawing fails here, which is the thing this check is for.
        const settle = async (quiet = 3, bound = 4000) => {
            const start = Date.now();
            let last = await page.evaluate(() => window.__page.draws());
            let still = 0;
            while (Date.now() - start < bound) {
                await sleep(100);
                const now = await page.evaluate(() => window.__page.draws());
                still = now === last ? still + 1 : 0;
                last = now;
                if (still >= quiet) return { draws: last, still: true, ms: Date.now() - start };
            }
            return { draws: last, still: false, ms: Date.now() - start };
        };
        const rest = await settle();
        if (!rest.still) bad("(e) the page at rest", `draws were still moving after ${rest.ms} ms: the page never stopped`);
        const frames0 = await page.evaluate(() => window.__page.frames());
        const draws0 = await page.evaluate(() => window.__page.draws());
        await sleep(600);
        const frames1 = await page.evaluate(() => window.__page.frames());
        const draws1 = await page.evaluate(() => window.__page.draws());
        const rate = Math.round((frames1 - frames0) / 0.6);
        // one rAF loop is this machine's ~60 a second; two (the mutation) run both callbacks on every frame
        if (rate < 30 || rate > 90) bad("(e) one frame loop", `${rate} frames/s on an idle page: not one rAF (~60)`);
        else ok("(e) one frame loop", `${rate} frames/s on an idle page: one rAF, so no loop leaked`);
        if (draws1 !== draws0) bad("(e) a page at rest draws nothing", `draws moved ${draws0} -> ${draws1} while idle`);
        else ok("(e) a page at rest draws nothing", `draws held at ${draws1} over 600 ms at rest`);

        const listenersAfter = await listeners(page);
        const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
        if (listenersAfter !== listenersBefore)
            bad("(a) three re-mounts' listeners", `the canvas has ${listenersAfter}, not the ${listenersBefore} it started with`);
        else ok("(a) three re-mounts' listeners", `the canvas still has ${listenersBefore} listeners (the host's)`);
        const delta = heapBefore === null || heapAfter === null ? null : heapAfter - heapBefore;
        if (delta !== null && delta > 8 * 1024 * 1024)
            bad("(a) three re-mounts' heap", `usedJSHeapSize grew by ${(delta / 1024 / 1024).toFixed(2)} MB`);
        else
            ok(
                "(a) three re-mounts' heap",
                delta === null
                    ? "performance.memory is not exposed here"
                    : `usedJSHeapSize ${(heapBefore / 1024 / 1024).toFixed(1)} -> ${(heapAfter / 1024 / 1024).toFixed(1)} MB (${(delta / 1024).toFixed(0)} KB over three re-mounts)`,
            );

        // (c) a `.c` save is a reload: a new WebAssembly.Instance is a new page
        const presentsBefore = await page.evaluate(() => window.__page.presents());
        const originBefore = await page.evaluate(() => performance.timeOrigin);
        const c0 = Date.now();
        writeFileSync(UI_C, `${UI_C_ORIGINAL}\n/* hot-check: a .c save */\n`);
        await waitLine(/\[serve\] reload /, BOUND, lines.length);
        await waitReload(page, originBefore);
        const cSeen = await waitTrack(page, hex(colours[2]));
        const cms = Date.now() - c0;
        const cAfter = await probe(page);
        const cOrigin = await page.evaluate(() => performance.timeOrigin);
        if (cOrigin === originBefore) bad("(c) a .c save reloads", "the page did not navigate");
        else ok("(c) a .c save reloads", `the page navigated (timeOrigin moved), its frame in ${cms} ms`);
        if (!cSeen) bad("(c) the frame after a .c save", `the track's fill is not ${hex(colours[2])}`);
        else ok("(c) the frame after a .c save", `the wasm's page draws the same style, the track ${hex(colours[2])}`);
        if (cAfter.presents >= presentsBefore)
            bad("(c) a .c save is a new instance", `ui.presents is ${cAfter.presents}, not below the ${presentsBefore} before it`);
        else ok("(c) a .c save is a new instance", `ui.presents restarted: ${presentsBefore} -> ${cAfter.presents} (a new WebAssembly.Instance)`);
        if (cAfter.checked !== false) bad("(c) a .c save drops the page's state", `the switch reads checked ${cAfter.checked}`);
        else ok("(c) a .c save drops the page's state", "the switch is unchecked: the page is new");

        // (d) a broken `.tsx` save: the last good frame keeps drawing and the bar says why
        const hashBefore = (await probe(page)).hash;
        const originBeforeBreak = await page.evaluate(() => performance.timeOrigin);
        writeFileSync(WIDGETS, `const broken = ;\n${WIDGETS_ORIGINAL}`);
        const failure = await waitLine(/build failed: (wasm|bundles) after (\d+) ms/, BOUND, lines.length);
        if (failure[1] !== "bundles") bad("(d) a broken .tsx save", `it failed the ${failure[1]}, not the bundles`);
        const bar = await page
            .waitForFunction(() => document.getElementById("__serve-error")?.textContent, null, { timeout: 60_000 })
            .then(() => true)
            .catch(() => false);
        if (!bar) bad("(d) a broken .tsx save says why", "the page has no error bar");
        else {
            const text = await page.evaluate(() => document.getElementById("__serve-error").textContent);
            const plain = text.replace(/\u001b\[[0-9;]*m/g, "");
            if (!/Widgets\.tsx/.test(plain) || !/Unexpected token/.test(plain))
                bad("(d) a broken .tsx save says why", `the bar does not have the compiler's words: ${JSON.stringify(plain.slice(0, 220))}`);
            else ok("(d) a broken .tsx save says why", `the page's bar has the compiler's own text: ${JSON.stringify(plain.match(/Unexpected token/)[0])} in ${JSON.stringify(plain.match(/[\w/]*Widgets\.tsx/)[0])}`);
        }
        if ((await page.evaluate(() => performance.timeOrigin)) !== originBeforeBreak) bad("(d) a broken save does not reload", "the page navigated");
        else ok("(d) a broken save does not reload", "the page kept running");
        const hashAfterBreak = (await probe(page)).hash;
        if (hashAfterBreak !== hashBefore) bad("(d) the last good frame keeps drawing", `the frame's hash moved ${hashBefore} -> ${hashAfterBreak}`);
        else ok("(d) the last good frame keeps drawing", `the frame is the one from before the break (hash ${hashBefore})`);

        // ... and the fixed save: hot again
        const fixed = await saveStyle(page, [20, 100, 123]);
        const afterFix = await probe(page);
        if (!fixed.seen) bad("(d) the fixed save", "the new frame never arrived");
        else ok("(d) the fixed save", `the bundles built again and the page re-mounted in ${fixed.ms} ms`);
        if (afterFix.bar !== null) bad("(d) the bar after the fixed save", `the bar is still ${JSON.stringify(afterFix.bar.slice(0, 120))}`);
        else ok("(d) the bar after the fixed save", "the error bar is gone");

        // (b) the same save with the full reload, on a page that declines the opt-in — and the hot page closed first, so
        // its own re-mounts are not work the reload is timed against
        await page.close();
        const cold = await open(`${origin}/browser/solid/widgets.html?hot=0`);
        if (await cold.evaluate(() => typeof window.__hotSwap === "function")) bad("(b) the reload page declines the opt-in", "`?hot=0` still set window.__hotSwap");
        else ok("(b) the reload page declines the opt-in", "`?hot=0` leaves window.__hotSwap unset, so the client reloads");
        const coldBefore = await drive(cold);
        const warmOrigin = await cold.evaluate(() => performance.timeOrigin);
        const coldTimes = [];
        const coldAfterBuilds = [];
        let coldAfter = null;
        for (const [n, colour] of colours.entries()) {
            const beforeOrigin = await cold.evaluate(() => performance.timeOrigin);
            const at = lines.length;
            const t0 = Date.now();
            setOff(colour);
            await waitLine(/build (wasm|bundles) (\d+) ms/, BOUND, at);
            const built = Date.now();
            await waitReload(cold, beforeOrigin);
            const seen = await waitTrack(cold, hex(colour));
            coldTimes.push(Date.now() - t0);
            coldAfterBuilds.push(Date.now() - built);
            if (!seen) bad(`(b) the reload ${n + 1}`, `the track's fill never became ${hex(colour)}`);
            if (!coldAfter) coldAfter = await probe(cold);
        }
        const coldOrigin = await cold.evaluate(() => performance.timeOrigin);
        if (coldOrigin === warmOrigin) bad("(b) the reload is a navigation", "timeOrigin did not move");
        else ok("(b) the reload is a navigation", "performance.timeOrigin moved on every save");
        if (coldAfter.track?.color !== hex(colours[0])) bad("(b) the new module on the reload page", `the track is ${coldAfter.track?.color}`);
        else ok("(b) the new module on the reload page", `the track's style is ${hex(colours[0])}`);
        if (coldAfter.checked !== false) bad("(b) the switch after a reload", `it reads checked ${coldAfter.checked}`);
        else ok("(b) the switch after a reload", "unchecked, as after a hot re-mount: the page's state is the page's");
        // the switch's row has no background of its own (hover is its only fill): not hovered, the page's 16,18,24 shows
        if (!coldAfter.rowPixel || coldAfter.rowPixel.join(",") !== "16,18,24,255")
            bad("(b) the pointer after a reload", `the row's background is ${coldAfter.rowPixel}, not the page's 16,18,24,255`);
        else ok("(b) the pointer after a reload", "the row is not hovered (the page's 16,18,24 shows through): a reload has no pointer");
        // Chrome restores the scroll across a reload (`history.scrollRestoration` is "auto"), so the document's scroll is
        // not what a re-mount buys — and it is not what a reload loses either
        if (coldAfter.scroll === 40) ok("(b) the scroll after a reload", "still 40: Chrome restored it, so the document's scroll survives both");
        else bad("(b) the scroll after a reload", `window.scrollY is ${coldAfter.scroll}, not the 40 that was restored or 0`);
        if (coldAfter.active === "frame") bad("(b) the focus after a reload", "the canvas still has the document's focus");
        else ok("(b) the focus after a reload", `the focus is on ${coldAfter.active ?? "nothing"}: a reload starts unfocused`);
        if (coldAfter.presents >= coldBefore.presents)
            bad("(b) the wasm after a reload", `presents is ${coldAfter.presents}, not below the ${coldBefore.presents} before the save`);
        else ok("(b) the wasm after a reload", `presents restarted: ${coldBefore.presents} -> ${coldAfter.presents}`);

        const medians = (times) => [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
        console.log(`info a .tsx save to its new frame: hot ${hot.join(", ")} ms (median ${medians(hot)}), reload ${coldTimes.join(", ")} ms (median ${medians(coldTimes)})`);
        console.log(`info ... of that, after the build: hot ${afterBuilds.join(", ")} ms (median ${medians(afterBuilds)}): the new module's import, its render and the frame; reload ${coldAfterBuilds.join(", ")} ms (median ${medians(coldAfterBuilds)}): the navigation, the wasm, the font and the mount`);
        console.log(`info a .c save to its new frame: ${cms} ms`);
        const load = (await import("node:os")).loadavg();
        console.log(`info load average: ${load.map((n) => n.toFixed(2)).join(" ")} (1, 5, 15 min)`);

        const errors = pageErrors.filter((text) => !/build failed|broken/i.test(text));
        if (errors.length) bad("the pages", errors.join("; "));
        else ok("the pages", "no page errors but the broken save's own");
    } finally {
        await browser.close();
        server.kill();
        await exited;
        rmSync(dir, { recursive: true, force: true });
    }
}

main().then(
    () => {
        // a mutation run's exit code is the mutation's: 0 when it was caught
        if (MUTATE) {
            if (failures) {
                console.log(`mutant killed (--mutate=${MUTATE}): ${failures} failure(s)`);
                process.exit(0);
            }
            console.log(`MUTANT SURVIVED (--mutate=${MUTATE}): the check passed on a broken shell`);
            process.exit(1);
        }
        if (failures) {
            console.log(`${failures} failure(s)`);
            process.exit(1);
        }
        console.log("browser/hot: ok");
        process.exit(0);
    },
    (error) => {
        console.log(`FAIL hot-check: ${error.message}`);
        server.kill();
        rmSync(dir, { recursive: true, force: true });
        process.exit(1);
    },
);
