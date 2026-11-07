// The Text field page's text path in the browser: the input method, its mirror of the field, and the clipboard —
// browser/ime-check.mjs, its own file beside input-check.mjs (which holds the typed characters, Backspace, the selection
// and the rasters).
//
//   (a) the path the browser chose: Chromium's `EditContext`, attached to the canvas (`canvas.editContext`), and — with
//       `?ime=input` — the hidden textarea the browsers without one take. Playwright cannot drive a real IME, so what is
//       dispatched is the sequence a composition produces: `compositionstart`, the `textupdate`s of the draft, and
//       `compositionend` with the committed string. (No candidate window, no key the IME itself would send, no dead key:
//       those are the browser's, not this page's, and none of them is driven here.)
//   (b) the mirror: the context carries the field's own string, caret and selection before a composition starts ("Ada"
//       typed, then the draft "na" at the caret: the context reads "Adana" while the model is still "Ada"), the model
//       takes the committed string in one insertion at its caret (the value "Adana", the caret 5, the ink the typed
//       path's 305 px), a composition over a selection replaces it ("Ada" with "da" selected, "ne" composed: "Ane", the
//       caret 3), and the mirror follows Backspace/Home/End/arrows and a backwards Shift+Home (the context's selection
//       start/end against the model's caret and selection: two numbers each). The draft's boxes are answered from the
//       row: `characterboundsupdate` lands the composition's characters at the drawn caret, not at the canvas's corner.
//   (c) a cancelled composition (`compositionend` with no string) leaves the field as it was, and the mirror is the
//       model's again.
//   (d) the fallback, the same page with `?ime=input`: the textarea has the DOM's focus and *is* its own mirror (its
//       `value` and `selectionStart`/`selectionEnd` are the field's), so its keys, its composition, its composition over a
//       selection and its cancel behave as the EditContext's — one code path in `browser/solid/text.ts`.
//   (e) the clipboard over a real `navigator.clipboard` (the context's permission granted): Shift+Home then Ctrl+C is
//       "Adana", Backspace empties the field, Ctrl+V inserts it again, Ctrl+X empties it and keeps it, and Ctrl+A then a
//       key replaces the whole value.
//   (f) the draft never reaches the page's value, its commands or its pixels while it is being composed: the frame's
//       command count and the readout stand still until `compositionend`.
//
//   node browser/ime-check.mjs            the check (build first: sh browser/build.sh && bun browser/solid/build.ts)
//   node browser/ime-check.mjs --serve    serve the page and print its URLs, for looking at it by hand
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WASM_DIR = process.env.WASM_DIR || join(process.env.TMPDIR || "/tmp", "cssints-native-web");
const BUNDLE = join(WASM_DIR, "solid/field.js");
const SIZE = [360, 450];
const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".ttf": "font/ttf",
    ".png": "image/png", ".json": "application/json" };
let failures = 0;
const ok = (name, extra = "") => console.log(`ok   ${name}${extra ? " — " + extra : ""}`);
const bad = (name, why) => { failures++; console.log(`FAIL ${name}: ${why}`); };

/** The page's window loop is the check's: requestAnimationFrame never calls back, so every frame is one asked for. */
const HOLD = () => {
    window.requestAnimationFrame = () => 0;
};

function serve() {
    return new Promise(done => {
        const server = createServer(async (req, res) => {
            const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
            const built = path === "/browser/solid/ui.wasm" ? join(WASM_DIR, "ui.wasm")
                : path === "/browser/solid/field.js" ? BUNDLE
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

/** The field's own state, from the page: the a11y snapshot's textbox "Name", the caret's box, the readout, the mirror
 *  (the context's own string and selection, or the textarea's) and the model the mirror is a view of. */
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
    const edit = document.getElementById("frame").editContext;
    const hidden = document.querySelector("textarea");
    return {
        value: field?.value,
        focused: field?.states.focused === true,
        caret: window.__page.bounds("name-line-caret"),
        selection: commands.find((c) => c.element === "name-line-selection"),
        readout: commands.find((c) => c.type === "text" && c.text.startsWith("Value: "))?.text,
        texts: commands.map((c) => c.text).filter((t) => typeof t === "string"),
        count: commands.length,
        frames: window.__page.frames(),
        // the mirror: the EditContext's text state, or the textarea's own (and the pixel its 1px box sits at)
        context: edit ? { text: edit.text, start: edit.selectionStart, end: edit.selectionEnd } : null,
        textarea: hidden
            ? { value: hidden.value, start: hidden.selectionStart, end: hidden.selectionEnd,
                left: parseFloat(hidden.style.left), top: parseFloat(hidden.style.top) }
            : null,
        // the field's model (Input.field): the text and caret the mirror is brought up to date from
        model: window.__page.field ? window.__page.field() : null,
    };
};

/** The Name field's row as ink: how many pixels are not the surface, and their box. A run that is missing reads 0. */
const INK = ({ row, bg }) => {
    const canvas = document.getElementById("frame");
    const w = canvas.width;
    const d = canvas.getContext("2d").getImageData(0, 0, w, canvas.height).data;
    const [x, y, bw, bh] = row.map(Math.round);
    let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    for (let j = y; j < y + bh; j++) for (let i = x; i < x + bw; i++) {
        const o = (j * w + i) * 4;
        if (Math.abs(d[o] - bg[0]) + Math.abs(d[o + 1] - bg[1]) + Math.abs(d[o + 2] - bg[2]) > 120) {
            n++, x0 = Math.min(x0, i), x1 = Math.max(x1, i), y0 = Math.min(y0, j), y1 = Math.max(y1, j);
        }
    }
    return { n, box: x1 < 0 ? null : [x0, x1, y0, y1] };
};

/** The draft of a composition, as an IME presents it: the start, then one `textupdate` a character of it. The range is
 *  the context's selection when the composition starts (the field's caret, or the run it replaces), and each update
 *  replaces the draft so far — the sequence Chromium's IME produces. No commit. */
const COMPOSE_DRAFT = (draft) => {
    const edit = document.getElementById("frame").editContext;
    if (!edit) throw new Error("no editContext on the canvas");
    const start = edit.selectionStart, end = edit.selectionEnd;
    edit.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
    for (let i = 1; i <= draft.length; i++) {
        edit.dispatchEvent(new TextUpdateEvent("textupdate", {
            text: draft.slice(0, i), updateRangeStart: start, updateRangeEnd: i === 1 ? end : start + i - 1,
            selectionStart: start + i, selectionEnd: start + i,
        }));
    }
};

/** The end of that composition: the string the IME committed ("" when it was cancelled). */
const COMPOSE_END = (text) => {
    document.getElementById("frame").editContext.dispatchEvent(new CompositionEvent("compositionend", { data: text }));
};

/** The IME asking where the composition's characters are, and the context's answer, as client rects. */
const CHARACTER_BOUNDS = ([start, end]) => {
    const edit = document.getElementById("frame").editContext;
    edit.dispatchEvent(new CharacterBoundsUpdateEvent("characterboundsupdate", { rangeStart: start, rangeEnd: end }));
    return edit.characterBounds().map((r) => [r.x, r.y, r.width, r.height]);
};

/** The same composition on the fallback's textarea, whose value the browser itself moves as the IME composes: the
 *  helper makes that insertion (the value and the caret), then dispatches the update. */
const FALLBACK_DRAFT = (draft) => {
    const hidden = document.querySelector("textarea");
    if (!hidden) throw new Error("no textarea for the fallback");
    const start = hidden.selectionStart, end = hidden.selectionEnd;
    const before = hidden.value.slice(0, start), after = hidden.value.slice(end);
    hidden.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
    for (let i = 1; i <= draft.length; i++) {
        hidden.value = before + draft.slice(0, i) + after;
        hidden.selectionStart = hidden.selectionEnd = start + i;
        hidden.dispatchEvent(new CompositionEvent("compositionupdate", { data: draft.slice(0, i) }));
    }
};
const FALLBACK_END = (text) => {
    document.querySelector("textarea").dispatchEvent(new CompositionEvent("compositionend", { data: text }));
};

/** One frame on a typed character and one on Backspace, from the page's own listeners: the mirror is rewritten in the
 *  first (the text moved) and in the second (the text and the caret moved). Returns ms a frame. */
const EDIT_MS = (n) => {
    const canvas = document.getElementById("frame");
    const key = (k, code) => canvas.dispatchEvent(new KeyboardEvent("keydown", { key: k, code, bubbles: true, cancelable: true }));
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { key("a", "KeyA"); key("Backspace", "Backspace"); }
    return (performance.now() - t0) / (2 * n);
};

async function main() {
    const missing = [join(WASM_DIR, "ui.wasm"), BUNDLE, join(ROOT, "browser/solid/field.html")].filter(f => !existsSync(f));
    if (missing.length) {
        console.log(`missing build product(s): ${missing.join(", ")}`);
        console.log(`run "sh browser/build.sh && bun browser/solid/build.ts" first`);
        process.exit(1);
    }
    const { server, port } = await serve();
    if (process.argv.includes("--serve")) {
        console.log(`http://127.0.0.1:${port}/browser/solid/field.html               (the EditContext path)`);
        console.log(`http://127.0.0.1:${port}/browser/solid/field.html?ime=input    (the hidden textarea)`);
        return;
    }
    const browser = await chromium.launch();
    // the clipboard's permission is the context's: without it `readText`/`writeText` reject
    const context = await browser.newContext({
        viewport: { width: SIZE[0] + 80, height: SIZE[1] + 160 },
        deviceScaleFactor: 1,
        permissions: ["clipboard-read", "clipboard-write"],
    });
    const logs = [];
    async function open(query = "") {
        const page = await context.newPage();
        await page.addInitScript(HOLD);
        page.on("console", m => logs.push(m.text()));
        page.on("pageerror", e => logs.push(`pageerror: ${e.message}`));
        await page.goto(`http://127.0.0.1:${port}/browser/solid/field.html${query}`);
        await page.waitForFunction(() => window.__page, null, { polling: 100, timeout: 20000 });
        const box = await page.locator("#frame").boundingBox();
        // the press: empty space, so nothing is focused, and the canvas takes the DOM's focus (the fallback, its textarea)
        await page.mouse.click(box.x + 6, box.y + 6);
        await page.evaluate(() => window.__page.warm(31));
        return page;
    }
    /** The run's ink in the field's row: the row's box less its 12px/10px padding, over the field's 36,40,52. */
    const inkOf = async (page) => {
        const row = await page.evaluate(() => window.__page.bounds("name"));
        const inner = [row[0] + 12, row[1] + 10, row[2] - 24, row[3] - 20];
        return page.evaluate(INK, { row: inner, bg: [36, 40, 52] });
    };
    /** The canvas's place in the viewport: the client origin the mirror's boxes are in. */
    const origin = async (page) => {
        const box = await page.locator("#frame").boundingBox();
        return [box.x, box.y];
    };

    try {
        // --- the typed path's numbers, for the compositions to be held to: pages typed key by key, no IME
        const typedPage = await open();
        await typedPage.keyboard.press("Tab");
        await typedPage.keyboard.press("Tab");
        await typedPage.keyboard.type("Ada");
        await typedPage.evaluate(() => window.__page.warm(2));
        const typed = await typedPage.evaluate(FIELD);
        const typedInk = await inkOf(typedPage);
        if (typed.value !== "Ada") bad("typed, for the comparison", `the value is ${JSON.stringify(typed.value)}, want "Ada"`);
        else ok("typed, for the comparison", `"Ada" the browser's own way: the caret at x ${typed.caret[0].toFixed(2)}, ` +
            `ink ${typedInk.n} px in ${JSON.stringify(typedInk.box)}`);
        await typedPage.close();
        const typedMore = await open();
        await typedMore.keyboard.press("Tab");
        await typedMore.keyboard.press("Tab");
        await typedMore.keyboard.type("Adana");
        await typedMore.evaluate(() => window.__page.warm(2));
        const typedAdana = await typedMore.evaluate(FIELD);
        const typedAdanaInk = await inkOf(typedMore);
        await typedMore.keyboard.press("Control+a");
        await typedMore.keyboard.press("Backspace");
        await typedMore.evaluate(() => window.__page.warm(2));
        await typedMore.keyboard.type("Ane");
        await typedMore.evaluate(() => window.__page.warm(2));
        const typedAne = await typedMore.evaluate(FIELD);
        const typedAneInk = await inkOf(typedMore);
        if (typedAdana.value !== "Adana" || typedAne.value !== "Ane")
            bad("typed, for the compositions", `the values are ${JSON.stringify([typedAdana.value, typedAne.value])}, ` +
                `want "Adana" and "Ane"`);
        else ok("typed, for the compositions", `"Adana" (ink ${typedAdanaInk.n} px in ${JSON.stringify(typedAdanaInk.box)}, ` +
            `the caret at ${typedAdana.caret[0].toFixed(2)}) and "Ane" (${typedAneInk.n} px, ` +
            `${typedAne.caret[0].toFixed(2)}) typed key by key, for the compositions below`);
        await typedMore.close();

        // --- (a) the path the browser chose
        const page = await open();
        const chosen = await page.evaluate(() => ({
            editContext: typeof EditContext,
            attached: document.getElementById("frame").editContext instanceof EditContext,
            textarea: document.querySelector("textarea") !== null,
        }));
        if (chosen.editContext !== "function" || !chosen.attached || chosen.textarea)
            bad("(a) the path", `the browser chose ${JSON.stringify(chosen)}, want an EditContext attached and no textarea`);
        else ok("(a) the path", "Chromium has EditContext and the canvas carries it (canvas.editContext instanceof " +
            `EditContext), so this page takes the standard's path; the hidden textarea is \`?ime=input\`'s`);

        // --- (b) the mirror: "Ada" typed, then "na" composed at the end
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        await page.keyboard.type("Ada");
        await page.evaluate(() => window.__page.warm(2));
        const before = await page.evaluate(FIELD);
        if (before.context?.text !== "Ada" || before.context?.start !== 3 || before.context?.end !== 3 ||
            before.model?.caret !== 3)
            bad("(b) the mirror after typing", `the context is ${JSON.stringify(before.context)} and the model ` +
                `${JSON.stringify(before.model)}, want "Ada" with the caret 3 in both`);
        else ok("(b) the mirror after typing", `the context carries the field's own "Ada" and its caret: text ` +
            `${JSON.stringify(before.context.text)}, selection ${before.context.start}..${before.context.end} = the ` +
            `model's caret ${before.model.caret}`);
        const framesBeforeDraft = before.frames;
        await page.evaluate(COMPOSE_DRAFT, "na");
        const drafting = await page.evaluate(FIELD);
        if (drafting.context?.text !== "Adana" || drafting.context?.start !== 5 || drafting.context?.end !== 5)
            bad("(b) the mirror under the draft", `the context is ${JSON.stringify(drafting.context)}, want "Adana" with ` +
                `the caret at 5 (the field's "Ada" with the IME's "na" at its caret 3)`);
        else if (drafting.value !== "Ada" || drafting.model?.caret !== 3 || drafting.readout !== before.readout ||
            drafting.count !== before.count)
            bad("(b) the draft", `the page's value is ${JSON.stringify(drafting.value)} and the frame ${drafting.count} ` +
                `commands (${JSON.stringify(drafting.readout)}), want "Ada" and the frame untouched`);
        else ok("(b) the mirror under the draft", `the context reads the field's "Ada" with the IME's "na" at its ` +
            `caret: "Adana", 5..5; the model is still ${JSON.stringify(drafting.value)} at ${drafting.model.caret}, the ` +
            `frame the same ${drafting.count} commands in ${drafting.frames - framesBeforeDraft} frames`);
        // the boxes the IME asks for mid-composition
        const bounds = await page.evaluate(CHARACTER_BOUNDS, [3, 5]);
        const o = await origin(page);
        const caretX = drafting.caret[0] + o[0], caretY = drafting.caret[1] + o[1];
        if (bounds.length !== 2 || Math.abs(bounds[0][0] - caretX) > 4 || Math.abs(bounds[0][1] - caretY) > 4)
            bad("(b) the draft's boxes", `characterboundsupdate 3..5 answered ${JSON.stringify(bounds)}, want two rects ` +
                `at the drawn caret (${caretX.toFixed(2)}, ${caretY.toFixed(2)})`);
        else ok("(b) the draft's boxes", `characterboundsupdate 3..5 answered two rects at the caret: ` +
            `x ${bounds[0][0].toFixed(2)} against the drawn caret's ${caretX.toFixed(2)} (within 4 px), y ` +
            `${bounds[0][1].toFixed(2)} against ${caretY.toFixed(2)}, not the canvas's corner`);
        const framesBeforeEnd = (await page.evaluate(FIELD)).frames;
        await page.evaluate(COMPOSE_END, "na");
        const composed = await page.evaluate(FIELD);
        await page.evaluate(() => window.__page.warm(2));
        const done = await page.evaluate(FIELD);
        const composedInk = await inkOf(page);
        if (done.value !== "Adana" || done.model?.caret !== 5 || done.context?.text !== "Adana" ||
            done.context?.end !== 5)
            bad("(b) compositionend", `the value is ${JSON.stringify(done.value)} at the caret ${done.model?.caret} and ` +
                `the context ${JSON.stringify(done.context)}, want "Adana" at 5 in both`);
        else ok("(b) compositionend", `the committed string is the field's, in one insertion at its caret: ` +
            `"Ada" -> "Adana" in ${composed.frames - framesBeforeEnd} frame (the commit's own), the context "Adana" at 5`);
        const sameInk = composedInk.n === typedAdanaInk.n &&
            JSON.stringify(composedInk.box) === JSON.stringify(typedAdanaInk.box) &&
            composed.caret[0] === typedAdana.caret[0];
        if (!sameInk)
            bad("(b) the composition's ink", `the composed run is ${composedInk.n} px in ${JSON.stringify(composedInk.box)} ` +
                `with the caret ${composed.caret[0].toFixed(2)}, the typed one ${typedAdanaInk.n} px in ` +
                `${JSON.stringify(typedAdanaInk.box)} with ${typedAdana.caret[0].toFixed(2)}`);
        else ok("(b) the composition's ink", `the same run as the typed path's: ${composedInk.n} px of ink in ` +
            `${JSON.stringify(composedInk.box)} and the caret at x ${composed.caret[0].toFixed(2)} (the typed "Adana"'s)`);

        // --- (c) a cancelled composition leaves the field, and the mirror, as they were
        const atEnd = done;
        await page.evaluate(COMPOSE_DRAFT, "ne");
        const cancelledDraft = await page.evaluate(FIELD);
        await page.evaluate(COMPOSE_END, "");
        await page.evaluate(() => window.__page.warm(2));
        const cancelled = await page.evaluate(FIELD);
        const cancelledInk = await inkOf(page);
        if (cancelledDraft.context?.text !== "Adanane" || cancelled.value !== atEnd.value ||
            cancelled.model?.caret !== atEnd.model?.caret || cancelled.context?.text !== atEnd.value ||
            cancelled.context?.end !== atEnd.model?.caret || cancelledInk.n !== composedInk.n)
            bad("(c) a cancelled composition", `the draft was ${JSON.stringify(cancelledDraft.context?.text)}; after ` +
                `compositionend("") the field is ${JSON.stringify(cancelled.value)} at ${cancelled.model?.caret} and the ` +
                `context ${JSON.stringify(cancelled.context)}, want ${JSON.stringify(atEnd.value)} at ` +
                `${atEnd.model?.caret} in both and ${composedInk.n} px of ink`);
        else ok("(c) a cancelled composition", `the draft "Adanane" is dropped by compositionend with no string: the ` +
            `field is still ${JSON.stringify(cancelled.value)} at ${cancelled.model?.caret}, and the context is the ` +
            `field's again ("${cancelled.context.text}" at ${cancelled.context.end}), ${cancelledInk.n} px of ink`);

        // --- (b) a composition over a selection: "Ada", "da" selected, "ne" composed
        const selectedPage = await open();
        await selectedPage.keyboard.press("Tab");
        await selectedPage.keyboard.press("Tab");
        await selectedPage.keyboard.type("Ada");
        await selectedPage.keyboard.press("Home");
        await selectedPage.keyboard.press("ArrowRight");
        await selectedPage.keyboard.press("Shift+End");
        await selectedPage.evaluate(() => window.__page.warm(2));
        const run = await selectedPage.evaluate(FIELD);
        if (run.context?.start !== 1 || run.context?.end !== 3 || run.model?.selection?.start !== 1 ||
            run.model?.selection?.end !== 3)
            bad("(b) the mirror of a selection", `the context's selection is ${run.context?.start}..${run.context?.end} ` +
                `and the model's ${JSON.stringify(run.model?.selection)}, want 1..3 in both`);
        else ok("(b) the mirror of a selection", `Home, ArrowRight, Shift+End selects "da" (1..3), and the context's ` +
            `own selection is the field's: ${run.context.start}..${run.context.end}`);
        await selectedPage.evaluate(COMPOSE_DRAFT, "ne");
        const overRun = await selectedPage.evaluate(FIELD);
        if (overRun.context?.text !== "Ane" || overRun.context?.start !== 3)
            bad("(b) the draft over a selection", `the context is ${JSON.stringify(overRun.context)}, want "Ane" at 3 ` +
                `("da" replaced by the IME's "ne")`);
        else ok("(b) the draft over a selection", `the IME's "ne" replaces the selected "da" in the context: ` +
            `${JSON.stringify(overRun.context.text)}, the caret at ${overRun.context.end}; the model is still ` +
            `${JSON.stringify(overRun.value)}`);
        await selectedPage.evaluate(COMPOSE_END, "ne");
        await selectedPage.evaluate(() => window.__page.warm(2));
        const replaced = await selectedPage.evaluate(FIELD);
        const replacedInk = await inkOf(selectedPage);
        if (replaced.value !== "Ane" || replaced.model?.caret !== 3 || replaced.context?.text !== "Ane" ||
            replacedInk.n !== typedAneInk.n || replaced.caret[0] !== typedAne.caret[0])
            bad("(b) the composition over a selection", `the field is ${JSON.stringify(replaced.value)} at the caret ` +
                `${replaced.model?.caret}, ${replacedInk.n} px of ink, the context ${JSON.stringify(replaced.context)}, ` +
                `want "Ane" at 3, ${typedAneInk.n} px, the caret ${typedAne.caret[0].toFixed(2)}`);
        else ok("(b) the composition over a selection", `the selection's replacement is one insertion: "Ane", the caret ` +
            `3, ${replacedInk.n} px of ink in ${JSON.stringify(replacedInk.box)} and the caret at x ` +
            `${replaced.caret[0].toFixed(2)}, the typed "Ane"'s`);
        await selectedPage.close();

        // --- (b) the mirror after the keys: each of them moves the field, and the context with it (two numbers each)
        const steps = [["Backspace", 4], ["Home", 0], ["End", 4], ["ArrowLeft", 3], ["ArrowRight", 4]];
        const seen = [];
        let keysOk = true;
        for (const [name, caret] of steps) {
            await page.keyboard.press(name);
            await page.evaluate(() => window.__page.warm(2));
            const state = await page.evaluate(FIELD);
            const at = state.context?.end;
            if (state.model?.caret !== caret || at !== caret || state.context?.text !== state.model?.value)
                keysOk = false, bad(`(b) the mirror after ${name}`, `the context is ${JSON.stringify(state.context)} ` +
                    `and the model ${JSON.stringify(state.model)}, want "Adan" at ${caret} in both`);
            seen.push(`${name}: ${at} = ${state.model?.caret}`);
        }
        if (keysOk) ok("(b) the mirror after the keys", `Backspace, Home, End, ArrowLeft, ArrowRight: the context's ` +
            `caret equals the model's each time (${seen.join(", ")})`);
        const atFour = await page.evaluate(FIELD);
        await page.keyboard.press("Shift+Home");
        await page.evaluate(() => window.__page.warm(2));
        const back = await page.evaluate(FIELD);
        if (back.context?.start !== 4 || back.context?.end !== 0 || back.model?.selection?.start !== 0)
            bad("(b) the mirror of a backwards selection", `the context's selection is ${back.context?.start}..` +
                `${back.context?.end}, want 4..0 (anchor then caret) and the field's run 0..4`);
        else ok("(b) the mirror of a backwards selection", `Shift+Home from the caret 4: the context's selection is ` +
            `${back.context.start}..${back.context.end}, anchor then caret as the field has it, its run 0..4`);

        // --- (e) the clipboard: Shift+Home selects the run (already selected by the backwards check), Ctrl+C copies it
        const adan = await page.evaluate(FIELD);
        if (adan.selection === undefined) bad("(e) Shift+Home", "the field has no selected run");
        await page.keyboard.press("Control+c");
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        if (copied !== "Adan") bad("(e) Ctrl+C", `the clipboard holds ${JSON.stringify(copied)}, want "Adan"`);
        else ok("(e) Ctrl+C", `the selection goes to navigator.clipboard: "Adan" (the context's selection 4..0), the ` +
            `value still ${JSON.stringify((await page.evaluate(FIELD)).value)}`);
        // the selection is still there; Backspace drops it, then Ctrl+V inserts what was copied — one frame after the read
        await page.keyboard.press("Backspace");
        await page.evaluate(() => window.__page.warm(2));
        const cleared = await page.evaluate(FIELD);
        if (cleared.value !== "" || cleared.context?.text !== "")
            bad("(e) Backspace", `the field is ${JSON.stringify(cleared.value)} and the context ` +
                `${JSON.stringify(cleared.context?.text)}, want "" in both`);
        await page.keyboard.press("Control+v");
        await page.waitForFunction(() => JSON.parse(window.__page.dump()).commands.some((c) => c.text === 'Value: "Adan" (4)'),
            null, { polling: 20, timeout: 5000 }).catch(() => {});
        await page.evaluate(() => window.__page.warm(2));
        const pasted = await page.evaluate(FIELD);
        const pastedInk = await inkOf(page);
        if (pasted.value !== "Adan" || pasted.caret[0] !== atFour.caret[0] ||
            pasted.context?.text !== "Adan" || pasted.context?.end !== 4)
            bad("(e) Ctrl+V", `the field is ${JSON.stringify(pasted.value)} with the caret at ${pasted.caret?.[0]} and ` +
                `${pastedInk.n} px of ink, the context ${JSON.stringify(pasted.context)}, want "Adan", the caret at ` +
                `${atFour.caret[0]} and the context at 4`);
        else ok("(e) Ctrl+V", `readText's promise, then one frame: "Adan", the caret back at x ` +
            `${pasted.caret[0].toFixed(2)}, the ink at ${pastedInk.n} px, the context "Adan" at 4`);
        // Ctrl+X: the clipboard keeps it and the field is empty
        await page.keyboard.press("Shift+Home");
        await page.keyboard.press("Control+x");
        await page.evaluate(() => window.__page.warm(2));
        const cut = await page.evaluate(FIELD);
        const cutClipboard = await page.evaluate(() => navigator.clipboard.readText());
        if (cut.value !== "" || cutClipboard !== "Adan")
            bad("(e) Ctrl+X", `the field is ${JSON.stringify(cut.value)} and the clipboard ${JSON.stringify(cutClipboard)}`);
        else ok("(e) Ctrl+X", `the field is empty and the clipboard still holds "Adan" (cut is the field's own copy + ` +
            `the backspace rule); the caret back at x ${cut.caret[0].toFixed(2)}`);
        // Ctrl+A: the whole value selected, and a key replaces it
        await page.keyboard.press("Control+v");
        await page.waitForFunction(() => JSON.parse(window.__page.dump()).commands.some((c) => c.text === 'Value: "Adan" (4)'),
            null, { polling: 20, timeout: 5000 }).catch(() => {});
        await page.evaluate(() => window.__page.warm(2));
        await page.keyboard.press("Control+a");
        await page.evaluate(() => window.__page.warm(2));
        const all = await page.evaluate(FIELD);
        const replacedRun = all.selection;
        await page.keyboard.press("B");
        await page.evaluate(() => window.__page.warm(2));
        const one = await page.evaluate(FIELD);
        if (!replacedRun || replacedRun.box[0] > 54 || replacedRun.box[2] < 26)
            bad("(e) Ctrl+A", `the selected run is ${JSON.stringify(replacedRun?.box)}, want the whole value`);
        else if (one.value !== "B" || one.context?.text !== "B")
            bad("(e) Ctrl+A then a key", `the field is ${JSON.stringify(one.value)} and the context ` +
                `${JSON.stringify(one.context?.text)}, want "B" in both`);
        else ok("(e) Ctrl+A then a key", `the run selected (${replacedRun.box[2].toFixed(2)}px of the line), the context ` +
            `4..0, and "B" replaces the whole value: ${JSON.stringify(one.readout)}`);

        // --- (d) the fallback: the same page with ?ime=input, the textarea holding the focus
        const fallback = await open("?ime=input");
        const fallbackPath = await fallback.evaluate(() => ({
            editContext: document.getElementById("frame").editContext,
            textarea: document.querySelector("textarea")?.tagName ?? null,
            active: document.activeElement?.tagName,
        }));
        if (fallbackPath.editContext != null || fallbackPath.textarea !== "TEXTAREA" ||
            fallbackPath.active !== "TEXTAREA")
            bad("(d) the fallback's path", `${JSON.stringify(fallbackPath)}, want no editContext, a focused TEXTAREA`);
        else ok("(d) the fallback's path", "no EditContext in this browser's path: the hidden TEXTAREA has the DOM's " +
            "focus, and its own value and selection are the mirror (one `Mirror` in text.ts, two writings of it)");
        // its keys are cloned onto the canvas: Tab twice reaches the field (the canvas's own keydown listener takes it)
        await fallback.keyboard.press("Tab");
        await fallback.keyboard.press("Tab");
        await fallback.keyboard.type("Ada");
        await fallback.evaluate(() => window.__page.warm(2));
        const typedFallback = await fallback.evaluate(FIELD);
        const fallbackInk = await inkOf(fallback);
        const fo = await origin(fallback);
        const boxAt = [typedFallback.caret[0] + fo[0], typedFallback.caret[1] + fo[1]];
        if (typedFallback.value !== "Ada" || typedFallback.caret[0] !== typed.caret[0] ||
            fallbackInk.n !== typedInk.n || typedFallback.textarea?.value !== "Ada" ||
            typedFallback.textarea?.start !== 3 || typedFallback.model?.caret !== 3 ||
            Math.abs(typedFallback.textarea?.left - boxAt[0]) > 0.5 ||
            Math.abs(typedFallback.textarea?.top - boxAt[1]) > 0.5)
            bad("(d) the fallback's keys", `the field is ${JSON.stringify(typedFallback.value)} with the caret at ` +
                `${typedFallback.caret?.[0]} and ${fallbackInk.n} px of ink, the textarea ` +
                `${JSON.stringify(typedFallback.textarea)}, want "Ada", ${typed.caret[0]}, ${typedInk.n} px and a ` +
                `textarea holding "Ada" at 3 with its 1px box at the caret (${boxAt[0].toFixed(2)}, ` +
                `${boxAt[1].toFixed(2)})`);
        else ok("(d) the fallback's keys", `Tab twice and "Ada" through the textarea's cloned keydowns: the value, the ` +
            `caret at x ${typedFallback.caret[0].toFixed(2)} and the ink (${fallbackInk.n} px) are the canvas path's, ` +
            `and the textarea's own mirror is "Ada" with the caret 3, its 1px box at the caret's pixel ` +
            `(${typedFallback.textarea.left.toFixed(2)}, ${typedFallback.textarea.top.toFixed(2)}) — where a real ` +
            `IME's candidate window would be`);
        // ... and a composition on the textarea commits through the same Input.textInput
        await fallback.evaluate(FALLBACK_DRAFT, "na");
        const fallbackDraft = await fallback.evaluate(FIELD);
        if (fallbackDraft.textarea?.value !== "Adana" || fallbackDraft.textarea?.start !== 5 ||
            fallbackDraft.value !== "Ada" || fallbackDraft.count !== typedFallback.count)
            bad("(d) the fallback's draft", `the textarea is ${JSON.stringify(fallbackDraft.textarea)} and the field ` +
                `${JSON.stringify(fallbackDraft.value)} in ${fallbackDraft.count} commands, want the textarea "Adana" at ` +
                `5, the field "Ada" in the same ${typedFallback.count}`);
        else ok("(d) the fallback's draft", `the browser's own insertion into the textarea: its mirror is ` +
            `${JSON.stringify(fallbackDraft.textarea.value)} at 5, while the field is still ` +
            `${JSON.stringify(fallbackDraft.value)} (the same ${fallbackDraft.count} commands)`);
        await fallback.evaluate(FALLBACK_END, "na");
        await fallback.evaluate(() => window.__page.warm(2));
        const composedFallback = await fallback.evaluate(FIELD);
        const composedFallbackInk = await inkOf(fallback);
        if (composedFallback.value !== "Adana" || composedFallbackInk.n !== typedAdanaInk.n ||
            composedFallback.textarea?.value !== "Adana" || composedFallback.textarea?.start !== 5)
            bad("(d) the fallback's composition", `the field is ${JSON.stringify(composedFallback.value)} with ` +
                `${composedFallbackInk.n} px of ink and the textarea ${JSON.stringify(composedFallback.textarea)}, want ` +
                `"Adana", ${typedAdanaInk.n} px and the textarea "Adana" at 5`);
        else ok("(d) the fallback's composition", `compositionstart/update/end on the textarea: "Adana", ` +
            `${composedFallbackInk.n} px of ink, the same commit as the EditContext's, and the textarea's mirror is the ` +
            `model's (at 5)`);
        // ... over a selection, and cancelled, as the context's: "Ada" again, "da" selected (1..3)
        await fallback.keyboard.press("Control+a");
        await fallback.keyboard.press("Backspace");
        await fallback.evaluate(() => window.__page.warm(2));
        await fallback.keyboard.type("Ada");
        await fallback.keyboard.press("Home");
        await fallback.keyboard.press("ArrowRight");
        await fallback.keyboard.press("Shift+ArrowRight");
        await fallback.keyboard.press("Shift+ArrowRight");
        await fallback.evaluate(() => window.__page.warm(2));
        const fallbackRun = await fallback.evaluate(FIELD);
        await fallback.evaluate(FALLBACK_DRAFT, "ne");
        await fallback.evaluate(FALLBACK_END, "ne");
        await fallback.evaluate(() => window.__page.warm(2));
        const fallbackReplaced = await fallback.evaluate(FIELD);
        const fallbackReplacedInk = await inkOf(fallback);
        if (fallbackRun.textarea?.start !== 1 || fallbackRun.textarea?.end !== 3 ||
            fallbackReplaced.value !== "Ane" || fallbackReplaced.model?.caret !== 3 ||
            fallbackReplaced.textarea?.value !== "Ane" || fallbackReplaced.textarea?.start !== 3 ||
            fallbackReplacedInk.n !== typedAneInk.n)
            bad("(d) the fallback's selection", `the textarea's selection was ${fallbackRun.textarea?.start}..` +
                `${fallbackRun.textarea?.end} for "da"; after "ne" the field is ${JSON.stringify(fallbackReplaced.value)} ` +
                `at ${fallbackReplaced.model?.caret}, the textarea ${JSON.stringify(fallbackReplaced.textarea)} and ` +
                `${fallbackReplacedInk.n} px of ink, want 1..3, then "Ane" at 3 in both and ${typedAneInk.n} px`);
        else ok("(d) the fallback's selection", `the textarea's own selection 1..3 ("da"), "ne" over it: "Ane", the ` +
            `caret 3, the textarea at 3 and ${fallbackReplacedInk.n} px of ink — the context path's numbers`);
        await fallback.evaluate(FALLBACK_DRAFT, "xy");
        const fallbackCancelling = await fallback.evaluate(FIELD);
        await fallback.evaluate(FALLBACK_END, "");
        await fallback.evaluate(() => window.__page.warm(2));
        const fallbackCancelled = await fallback.evaluate(FIELD);
        if (fallbackCancelling.textarea?.value !== "Anexy" || fallbackCancelled.value !== "Ane" ||
            fallbackCancelled.model?.caret !== 3 || fallbackCancelled.textarea?.value !== "Ane" ||
            fallbackCancelled.textarea?.start !== 3)
            bad("(c) the fallback's cancelled composition", `the draft was ` +
                `${JSON.stringify(fallbackCancelling.textarea?.value)}; after compositionend("") the field is ` +
                `${JSON.stringify(fallbackCancelled.value)} at ${fallbackCancelled.model?.caret} and the textarea ` +
                `${JSON.stringify(fallbackCancelled.textarea)}, want "Ane" at 3 in both`);
        else ok("(c) the fallback's cancelled composition", `the draft "Anexy" in the textarea is dropped by ` +
            `compositionend with no string: the field is still "Ane" at 3, and the textarea is the model's again`);

        // --- the cost: a frame at rest diffs the mirror, a frame on an edit rewrites it
        const restMs = await page.evaluate(() => window.__page.bench(100));
        const editMs = await page.evaluate(EDIT_MS, 60);
        await page.evaluate(COMPOSE_DRAFT, "Ada");
        const composingMs = await page.evaluate(() => window.__page.bench(100));
        const fieldBundle = (await stat(BUNDLE)).size;
        console.log(`info ${fieldBundle} B of bundle (field.js) and ` +
            `${(await stat(join(ROOT, "browser/solid/field.html"))).size} B of field.html`);
        console.log(`info ${editMs.toFixed(2)} ms an edit's frame (a typed character and a Backspace, the mirror rewritten ` +
            `in each: 120 frames), ${restMs.toFixed(2)} ms at rest (the same page's frame with the mirror's diff only, ` +
            `100 frames), ${composingMs.toFixed(2)} ms with the composition open`);
        console.log(`info the composition drafts ${"Ada".length} textupdate(s) with no frame and no command: its string is ` +
            `inserted once, at compositionend`);
        if (logs.some(l => l.startsWith("pageerror"))) bad("page", logs.filter(l => l.startsWith("pageerror")).join("; "));
    } finally {
        await browser.close();
        server.close();
    }
    if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
    console.log("browser/ime-check: ok");
}

main();
