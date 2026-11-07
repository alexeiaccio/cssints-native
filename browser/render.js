// The no-JS browser target's page: the wasm (browser/page.c) lays the static generated C page out, and draw.js puts its
// commands on the canvas. This file is the page's own glue — the two frames, the toggle and the readouts a check reads;
// the drawing and the measure callback are in draw.js, shared with the Solid page (browser/solid/).
//
// The state is the wasm's: the generated page's transition table (examples/sensors/page_generated_events.c) is asked on
// a pointer's press and release, exactly as the desktop host asks it, so a click on the pill toggles the units and `w`
// (or the button) is the same click at the pill's centre.

import { W, H, createSurface, loadFont, readCommands } from './draw.js';

const canvas = document.getElementById('frame');
const ctx = canvas.getContext('2d');
const dpr = Math.max(1, window.devicePixelRatio || 1);
canvas.width = W * dpr;
canvas.height = H * dpr;

const surface = createSurface(ctx, { width: W, height: H, dpr });

async function instantiate() {
    let measure = () => {}; // called by Clay inside frame(), after the instance exists
    const imports = { env: { measure: (p, l, f, s) => measure(p, l, f, s) } };
    const response = await fetch('page.wasm');
    if (!response.ok) throw new Error(`page.wasm: HTTP ${response.status}; run "sh browser/build.sh" first`);
    // instantiateStreaming wants application/wasm; a plain static server may send octet-stream
    const module = await (response.headers.get('content-type') === 'application/wasm'
        ? WebAssembly.compileStreaming(response)
        : WebAssembly.compile(await response.arrayBuffer()));
    const instance = await WebAssembly.instantiate(module, imports);
    const wasm = instance.exports;
    if (wasm._initialize) wasm._initialize(); // reactor: libc's constructors
    measure = (p, l, f, s) => surface.measure(wasm, p, l, f, s);
    return wasm;
}

let wasm, lastFrame = [];

const button = document.getElementById('toggle');
const ms = document.getElementById('ms');

/** One frame of the state the wasm holds: Clay's layout, then the draw. Returns the commands, for a test to read. */
function render() {
    wasm.frame();
    lastFrame = readCommands(wasm);
    surface.draw(lastFrame);
    button.textContent = lastFrame.some(c => c.text === 'switch to m/s²') ? 'switch to m/s²' : 'switch to g';
    return lastFrame;
}

/** The pointer's press and release at layout coordinates, through the wasm's table. */
function press(x, y) { wasm.press(x, y); render(); }
function release(x, y) { wasm.release(x, y); render(); }

/** The pill's centre: the click `w` and the button make. */
function clickPill() { press(180, 248); release(180, 248); }

await loadFont('../vendor/fonts/Roboto-Regular.ttf');
wasm = await instantiate();
wasm.init(W, H);
render();

button.addEventListener('click', clickPill);
window.addEventListener('keydown', e => { if (e.key === 'w' || e.key === 'W') clickPill(); });
// a click on the page itself: the canvas is 360 CSS px whatever its backing store is
const canvasXY = e => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)];
};
canvas.addEventListener('pointerdown', e => { const [x, y] = canvasXY(e); press(x, y); });
canvas.addEventListener('pointerup', e => { const [x, y] = canvasXY(e); release(x, y); });

// for browser/check.mjs: the commands of the last frame, a frame count for the timing, the Clay error count, the state,
// and the last frame as the JSON of desktop/clay_dump.c — the dump every target writes, which a check compares
window.__page = {
    commands: () => lastFrame,
    render,
    press,
    release,
    click: clickPill,
    state: () => wasm.state(),
    stateName(i) {
        const ptr = wasm.state_name(i);
        if (!ptr) return '';
        const bytes = new Uint8Array(wasm.memory.buffer);
        let end = ptr;
        while (end < bytes.length && bytes[end]) end++;
        return new TextDecoder().decode(bytes.subarray(ptr, end));
    },
    errors: () => wasm.errors(),
    dump() {
        const length = wasm.dump();
        const at = wasm.dump_ptr();
        return new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, at, length));
    },
    bench(n = 100) {
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
            render();
            ctx.getImageData(0, 0, 1, 1); // a readback, so each frame's raster is done, not just queued
        }
        return (performance.now() - t0) / n; // ms a frame: layout in Clay, the commands, the canvas raster
    },
};
ms.textContent = `${window.__page.bench(20).toFixed(2)} ms a frame`;
