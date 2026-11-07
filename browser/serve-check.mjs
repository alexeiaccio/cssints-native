// native/browser/serve-check.mjs — browser/serve.ts, the browser target's dev server, driven: a save rebuilds, the page
// reloads, a broken save keeps the last good artefact.
//
// The check never touches this tree: it copies the repo into a temp directory (every node_modules is symlinked back here,
// and native/build is left out), so Sky.tsx's imports of apps/csssky's api and model and the apps' tsconfigs resolve as
// they do here, and starts the server with `--root` on the copy, so every save below is a write into the copy. It asserts:
//
//   (a) the first build served the page: /browser/solid/index.html mounts, and its frame is the Sensors page's (10
//       commands and the "switch to g" text, dumped through the wasm as solid-check.mjs does).
//   (b) a `.ts` save rebuilds the bundles, not the wasm: the server prints `build bundles N ms` (not `wasm`), the live
//       ui.wasm's mtime does not move while page.js's does, and the page's timeOrigin changes within BOUND ms — a full
//       reload — and its frame is the same page again. The save-to-first-frame ms is printed.
//   (c) a broken `.c` save (`#error serve-check-typo` at the top of browser/ui.c) fails the wasm build, prints the error,
//       and pushes an `error` event that the injected client shows in a bar: the page is NOT reloaded, the bar names
//       serve-check-typo, and a manual reload still serves the last good ui.wasm (the page mounts).
//   (d) a fixed `.c` save rebuilds the wasm and reloads the page; its frame is the one from before the break, and the
//       save-to-first-frame ms is printed.
//
// `BOUND` is the longest a save may take to reach the page's first frame; the printed ms are this machine's. Run from
// solid/test.sh with the other browser checks (needs bun, zig and Playwright's chromium).
//
//   node browser/serve-check.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import {
    cpSync,
    existsSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NATIVE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(NATIVE, "..");
// a save's reload must arrive inside this; the bundle build dominates it and this machine can be under a load of 50
const BOUND = 300_000;

let failures = 0;
const ok = (name, extra = "") => console.log(`ok   ${name}${extra ? " — " + extra : ""}`);
const bad = (name, why) => {
    failures++;
    console.log(`FAIL ${name}: ${why}`);
};

// --- the tree the server builds, a temp copy of native/ -----------------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), "cssints-serve-check-"));
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
// every node_modules of this tree, back where the copy expects it: Bun's workspaces keep a package's own deps in its own
// node_modules (@atcute is apps/csssky's, solid-js and playwright are native's)
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

// --- the server, its lines, and a line's arrival ----------------------------------------------------------------

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
for (const [stream, label] of [
    [server.stdout, ""],
    [server.stderr, ""],
]) {
    stream.setEncoding("utf8");
    let pending = "";
    stream.on("data", (chunk) => {
        pending += chunk;
        let at;
        while ((at = pending.indexOf("\n")) >= 0) {
            feed(pending.slice(0, at) + label);
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

async function main() {
    const listening = await waitLine(/listening (http:\/\/127\.0\.0\.1:\d+)/, 300_000, 0);
    const origin = listening[1];
    const artefacts = (await waitLine(/artefacts (.+)$/, 0, 0))[1];
    const first = { wasm: 0, bundles: 0 };
    for (const line of lines) {
        const match = /build (wasm|bundles) (\d+) ms/.exec(line);
        if (match) first[match[1]] = Number(match[2]);
    }
    const firstTotal = Number((/first build (\d+) ms/.exec(lines.find((l) => l.startsWith("[serve] first build")) ?? "") ?? [])[1]);
    console.log(`info first build ${firstTotal} ms (wasm ${first.wasm} ms, bundles ${first.bundles} ms)`);
    if (lines.some((line) => /build failed:/.test(line))) {
        bad("the first build", "the server's first build failed; its lines are above");
        throw new Error("the server's first build failed");
    }

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 440, height: 520 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") pageErrors.push(message.text());
    });

    /** The page mounted and settled: `__page` is there, and the first-mount entry (0.25 s) is over. */
    const mount = async () => {
        await page.waitForFunction(() => window.__page, null, { timeout: 60_000 });
        await page.evaluate(() => window.__page.warm(31));
    };
    /** The frame, and the fields that say it is the Sensors page's: 10 commands, its pill's label. */
    const frame = () =>
        page.evaluate(() => ({
            hash: window.__page.hash(),
            commands: window.__page.commands().length,
            texts: window.__page
                .commands()
                .filter((command) => command.type === 3)
                .map((command) => command.text),
        }));
    const assertPage = async (name) => {
        const got = await frame();
        if (got.commands !== 10 || !got.texts.includes("switch to g")) {
            bad(name, `${got.commands} commands, texts ${JSON.stringify(got.texts.slice(0, 3))}: not the Sensors page's frame`);
            return null;
        }
        ok(name, `${got.commands} commands, the pill's label, hash ${got.hash}`);
        return got;
    };

    /** A save, its build, its reload and the page's first frame after it: the build's ms and the save-to-frame ms. */
    async function save(file, text, kind) {
        const timeOrigin = await page.evaluate(() => performance.timeOrigin);
        const at = lines.length;
        const t0 = Date.now();
        writeFileSync(file, text);
        const build = await waitLine(/build (wasm|bundles) (\d+) ms/, BOUND, at);
        if (build[1] !== kind) bad(`a ${file.split("/").pop()} save`, `it rebuilt the ${build[1]}, not the ${kind}`);
        // the page's timeOrigin moves on a full reload; a poll, so a reload that starts before we look is still seen
        let reloaded = false;
        for (const deadline = Date.now() + BOUND; Date.now() < deadline && !reloaded; ) {
            try {
                reloaded = (await page.evaluate(() => performance.timeOrigin)) !== timeOrigin;
            } catch {
                // the execution context is being replaced: the navigation
            }
            if (!reloaded) await new Promise((done) => setTimeout(done, 20));
        }
        if (!reloaded) bad(`the reload after a ${file.split("/").pop()} save`, `no reload within ${BOUND} ms`);
        await mount();
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        return { buildMs: Number(build[2]), saveToFrame: Date.now() - t0 };
    }

    try {
        await page.goto(`${origin}/browser/solid/index.html`);
        await mount();
        const base = await assertPage("the first build's page");

        // (b) a .ts save: the bundles, not the wasm
        const renderer = join(root, "solid/src/renderer.ts");
        const rendererGood = readFileSync(renderer, "utf8");
        const wasm = join(artefacts, "ui.wasm");
        const bundle = join(artefacts, "solid/page.js");
        const wasmBefore = statSync(wasm).mtimeMs;
        const bundleBefore = statSync(bundle).mtimeMs;
        const ts = await save(renderer, `${rendererGood}\n// serve-check: a .ts save\n`, "bundles");
        const wasmAfter = statSync(wasm).mtimeMs;
        const bundleAfter = statSync(bundle).mtimeMs;
        if (wasmAfter !== wasmBefore) bad("a .ts save is incremental", "it replaced ui.wasm: zig ran");
        else ok("a .ts save is incremental", `ui.wasm's mtime did not move; page.js's did (${bundleBefore} -> ${bundleAfter})`);
        if (bundleAfter === bundleBefore) bad("a .ts save rebuilt the bundles", "page.js's mtime did not move");
        await assertPage("the page after a .ts save");
        console.log(`info a .ts save: bundles built in ${ts.buildMs} ms, the page's first frame ${ts.saveToFrame} ms after the save`);

        // (c) a broken .c save: the last good wasm stays, the page says why, and it is not reloaded
        const uiC = join(root, "browser/ui.c");
        const uiGood = readFileSync(uiC, "utf8");
        const beforeBreak = await page.evaluate(() => performance.timeOrigin);
        const wasmBeforeBreak = statSync(wasm).mtimeMs;
        const at = lines.length;
        writeFileSync(uiC, `#error serve-check-typo\n${uiGood}`);
        const failure = await waitLine(/build failed: (wasm|bundles) after (\d+) ms/, BOUND, at);
        if (failure[1] !== "wasm") bad("a .c save's failure", `it failed the ${failure[1]}, not the wasm`);
        const bar = await page
            .waitForFunction(
                () => {
                    const el = document.getElementById("__serve-error");
                    return !!el && el.textContent.includes("serve-check-typo");
                },
                null,
                { timeout: 60_000 },
            )
            .then(() => true)
            .catch(() => false);
        if (!bar) {
            const text = await page.evaluate(() => document.getElementById("__serve-error")?.textContent ?? null);
            bad("a broken save says why", `the page's bar is ${text === null ? "absent" : JSON.stringify(text.slice(0, 200))}`);
        } else {
            ok("a broken save says why", "the page's bar has the compiler's `serve-check-typo`");
        }
        if ((await page.evaluate(() => performance.timeOrigin)) !== beforeBreak)
            bad("a broken save does not reload", "the page reloaded on a failed build");
        else ok("a broken save does not reload", "the page kept running");
        if (statSync(wasm).mtimeMs !== wasmBeforeBreak) bad("a broken save keeps the wasm", "ui.wasm was replaced by a failed build");
        else ok("a broken save keeps the wasm", `ui.wasm is the last good one (mtime ${wasmBeforeBreak})`);
        await page.reload();
        await mount();
        await assertPage("the last good artefact, after a manual reload");

        // (d) the fixed save: the wasm rebuilds, the page reloads, the frame is the one from before the break
        const fixed = await save(uiC, `${uiGood}\n/* serve-check: a .c save */\n`, "wasm");
        const recovered = await assertPage("the page after the fixed save");
        if (base && recovered && recovered.hash !== base.hash) bad("the fixed save's frame", `hash ${recovered.hash}, not ${base.hash}`);
        if (statSync(wasm).mtimeMs === wasmBeforeBreak) bad("the fixed save rebuilt the wasm", "ui.wasm's mtime did not move");
        console.log(`info a .c save: the wasm built in ${fixed.buildMs} ms, the page's first frame ${fixed.saveToFrame} ms after the save`);

        const errors = pageErrors.filter((text) => !text.includes("serve-check-typo"));
        if (errors.length) bad("the pages", errors.join("; "));
        else ok("the pages", "no page errors (the broken save's console.error is the one expected)");
    } finally {
        await browser.close();
        server.kill();
        await exited;
        rmSync(dir, { recursive: true, force: true });
    }
}

main().then(
    () => {
        if (failures) {
            console.log(`${failures} failure(s)`);
            process.exit(1);
        }
        console.log("browser/serve: ok");
        process.exit(0);
    },
    (error) => {
        console.log(`FAIL serve-check: ${error.message}`);
        server.kill();
        rmSync(dir, { recursive: true, force: true });
        process.exit(1);
    },
);
