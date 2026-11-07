// Clay's render commands on a 2D canvas, shared by the two web targets: the no-JS page (browser/render.js: the generated
// C page) and the Solid page (browser/solid/page.ts, browser/solid/sky.ts: the ui_* wasm module). Clay lays out in the
// wasm; this file draws what the command array says: rectangles, borders (inside, the ring between the box and the box
// inset by each side's width), text, images, and a scissor via clip(). No framework and no build step.
//
// The Solid page's wasm also fills the renderer's tables beside the commands (a shadow, a gradient, a group, a backdrop:
// browser/ui.c, the desktop renderer's own effects): readEffects reads them, and draw(commands, effects) draws them the
// way the desktop's ThorVG renderer draws the same frame —
//   - a shadow: the element's first command's box, moved by the shadow's offset, filled in its colour and blurred by the
//     CSS blur whose standard deviation is the shadow's blur / 2 (ThorVG's sigma, CLAY_THORVG_SHADOW_SIGMA);
//   - a gradient: the element's first rectangle filled with the linear gradient along CSS's gradient line, its stops at
//     their offsets, over the box's solid fill when the value channel has faded it (a hover's cross-fade). Smooth
//     interpolation: the desktop's 4x4 Bayer +-1 dither over the banding is not here (say so in the docs, not a quiet
//     difference);
//   - a group: the commands whose element is the group's subtree, between its first and its last, drawn into an offscreen
//     canvas of the frame's size and composited once with the group's alpha, its scale and rotation about the first
//     command's box centre and its translate (ThorVG's scene, one matrix);
//   - an image: a picture scaled into the command's box, decoded from its path on first use (the desktop's tvg_picture).
// The no-JS page passes no effects and declares no images, so its drawing is the same as before.
//
// The command record is browser/page.c's WebCommand and browser/ui.c's copy of it: 19 32-bit slots, type, id, box,
// colour (r<<16 | g<<8 | b | a<<24), four radii, four border widths, the text's pointer and length, its font and size.
// An image command has no text: its path rides in that pair (browser/ui.c), so `text` is the path.

export const W = 360;
export const H = 360;
export const FONT = 'Roboto, "Helvetica Neue", Arial, sans-serif'; // bundled Roboto (vendor/fonts), system fallback

export const TYPE = { RECTANGLE: 1, BORDER: 2, TEXT: 3, IMAGE: 4, SCISSOR_START: 5, SCISSOR_END: 6 };

// A backdrop's blur is the desktop's CPU blur: a separable box blur, three passes each way, which is a gaussian to the
// eye and has no kernel to build (desktop/clay_renderer_thorvg.c's Clay_ThorVG_BoxBlurH/V, the same arithmetic). A pass
// of radius r three times has a gaussian's variance, so CSS's blur (sigma = blur / 2, the shadow's reading) picks
// r = (sqrt(1 + 4 sigma^2) - 1) / 2. The window is clamped to the region's ends, as the desktop clamps to the box's.
function boxBlurH(src, dst, w, h, r) {
    const n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
        const row = y * w * 4;
        let sr = 0, sg = 0, sb = 0;
        for (let i = -r; i <= r; i++) {
            const x = i < 0 ? 0 : (i >= w ? w - 1 : i);
            sr += src[row + x * 4], sg += src[row + x * 4 + 1], sb += src[row + x * 4 + 2];
        }
        for (let x = 0; x < w; x++) {
            dst[row + x * 4] = (sr / n) | 0, dst[row + x * 4 + 1] = (sg / n) | 0, dst[row + x * 4 + 2] = (sb / n) | 0;
            dst[row + x * 4 + 3] = src[row + x * 4 + 3];
            const out = x - r < 0 ? 0 : x - r, into = x + r + 1 >= w ? w - 1 : x + r + 1;
            sr += src[row + into * 4] - src[row + out * 4];
            sg += src[row + into * 4 + 1] - src[row + out * 4 + 1];
            sb += src[row + into * 4 + 2] - src[row + out * 4 + 2];
        }
    }
}

function boxBlurV(src, dst, w, h, r) {
    const n = 2 * r + 1, stride = w * 4;
    for (let x = 0; x < w; x++) {
        let sr = 0, sg = 0, sb = 0;
        for (let i = -r; i <= r; i++) {
            const y = i < 0 ? 0 : (i >= h ? h - 1 : i), at = y * stride + x * 4;
            sr += src[at], sg += src[at + 1], sb += src[at + 2];
        }
        for (let y = 0; y < h; y++) {
            const at = y * stride + x * 4;
            dst[at] = (sr / n) | 0, dst[at + 1] = (sg / n) | 0, dst[at + 2] = (sb / n) | 0;
            dst[at + 3] = src[at + 3];
            const out = y - r < 0 ? 0 : y - r, into = y + r + 1 >= h ? h - 1 : y + r + 1;
            sr += src[into * stride + x * 4] - src[out * stride + x * 4];
            sg += src[into * stride + x * 4 + 1] - src[out * stride + x * 4 + 1];
            sb += src[into * stride + x * 4 + 2] - src[out * stride + x * 4 + 2];
        }
    }
}

/** Loads the same Roboto the desktop draws with; a fallback font is fine, it is measured the same way. `url` is
 *  resolved against the document, so each page passes its own path to vendor/fonts. */
export async function loadFont(url) {
    try {
        const face = new FontFace('Roboto', `url(${url})`);
        await face.load();
        document.fonts.add(face);
    } catch (e) {
        console.info('Roboto not loaded, using the system fallback:', e.message);
    }
}

/**
 * A canvas and the two things a Clay frame needs from it: `measure`, the wasm's env.measure, and `draw`, the command
 * array as pixels. They share the ascent map, so the text a frame measured is the text it puts on the alphabetic
 * baseline Clay's line box implies.
 *
 * `image` resolves an image's path (the style's string, read out of the wasm) to a URL the page can fetch; `onImage` is
 * called when one has decoded, so a page that draws only a changed frame draws the picture the frame after it arrived.
 */
export function createSurface(ctx, { width = W, height = H, dpr = 1, image = (path) => path, onImage = null } = {}) {
    const fontFor = (size) => `400 ${size}px ${FONT}`;
    const ascent = new Map(); // font size -> ascent in px, for the baseline
    const bitmaps = new Map(); // path -> an Image, loading or decoded
    const layers = []; // one offscreen canvas a group nesting level, made the first time one is needed
    let clips = 0; // the scissor scopes open in the current pass: a backdrop inside one is not blurred (the desktop's rule)

    /** The wasm's env.measure: Canvas2D measures the string with the font the canvas draws with. */
    function measure(wasm, ptr, len, fontId, size) {
        const text = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, ptr, len));
        ctx.font = fontFor(size);
        const m = ctx.measureText(text);
        const up = m.fontBoundingBoxAscent ?? size * 0.8;
        ascent.set(size, up);
        const slot = new Float32Array(wasm.memory.buffer, wasm.measure_slot(), 2);
        slot[0] = m.width;
        // Roboto's line height is 2400/2048 em, and the desktop's SDL_ttf measure returns it rounded up; Clay stacks the
        // lines with it, so the two rasters put the same line at the same y (16.4 -> 17 at 14px, 37.5 -> 38 at 32px).
        slot[1] = Math.ceil(size * 2400 / 2048);
    }

    function roundRect(target, x, y, w, h, r) {
        target.beginPath();
        target.roundRect(x, y, w, h, [r[0], r[1], r[2], r[3]]);
    }

    /** Clay's border: inside the box, the fill rule's ring between the outer and the inner rounded rect. */
    function borderRect(target, c) {
        const [l, r, t, b] = c.border, w = c.w - l - r, h = c.h - t - b;
        const inner = [c.radius[0] - l, c.radius[1] - r, c.radius[2] - r, c.radius[3] - l];
        roundRect(target, c.x, c.y, c.w, c.h, c.radius);
        if (w > 0 && h > 0) target.roundRect(c.x + l, c.y + t, w, h, inner.map(v => Math.max(0, v)));
        target.fillStyle = c.color;
        target.fill('evenodd');
    }

    /** A command's own opacity: Clay's colour carries an alpha and ThorVG draws with it (a translucent fill, border or
     *  glyph), so the page's canvas does too. `paint` is the fill or the text at the path already built. */
    /** A CSS colour from a 0-255 channel triple and an opacity. */
    const rgba = (c, a = 1) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;

    /** One draw at the command's own alpha (the backdrop's dim, a text or a border fading): the frame's composite times
     *  the command's, as ThorVG draws the colour's alpha. */
    const withAlpha = (target, a, draw) => {
        if (a >= 1) return draw();
        const before = target.globalAlpha;
        target.globalAlpha = before * Math.max(0, a);
        draw();
        target.globalAlpha = before;
    };

    /** The shadow of the element a command belongs to: its box, of the command's radii, offset, filled and blurred. The
     *  desktop draws it as a ThorVG scene with a gaussian of blur / 2; Canvas2D's filter is that same gaussian. */
    function shadow(target, c, s) {
        const rad = c.type === TYPE.RECTANGLE || c.type === TYPE.BORDER ? c.radius : [0, 0, 0, 0];
        target.save();
        if (s.blur > 0) target.filter = `blur(${s.blur / 2}px)`;
        roundRect(target, Math.trunc(c.x) + s.x, Math.trunc(c.y) + s.y, Math.trunc(c.w), Math.trunc(c.h), rad);
        target.fillStyle = rgba(s.color, s.color[3] / 255);
        target.fill();
        target.restore();
    }

    /** A box filled with a linear gradient along CSS's line: the direction (sin θ, -cos θ) (0deg is up, 90 right), the
     *  length |w·sinθ| + |h·cosθ|, from the box's centre out to both ends — the desktop's Clay_ThorVG_FillGradient. */
    function gradient(target, c, g) {
        // the element's own background alpha (the backdrop's dim) and the gradient's (a hover's cross-fade)
        const before = target.globalAlpha;
        const alpha = before * c.alpha;
        // a fading gradient is composited over the box's solid colour, so what is under it is the page animating (a hover)
        if (g.alpha < 255) {
            roundRect(target, c.x, c.y, c.w, c.h, c.radius);
            target.fillStyle = c.color;
            target.globalAlpha = alpha;
            target.fill();
        }
        const rad = (g.angle * Math.PI) / 180;
        const dx = Math.sin(rad), dy = -Math.cos(rad);
        const len = Math.abs(c.w * dx) + Math.abs(c.h * dy);
        const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
        const fill = target.createLinearGradient(cx - (dx * len) / 2, cy - (dy * len) / 2,
            cx + (dx * len) / 2, cy + (dy * len) / 2);
        for (const s of g.stops) fill.addColorStop(Math.min(1, Math.max(0, s.offset)), rgba(s.color, s.color[3] / 255));
        roundRect(target, c.x, c.y, c.w, c.h, c.radius);
        target.globalAlpha = g.alpha < 255 ? alpha * (g.alpha / 255) : alpha;
        target.fillStyle = fill;
        target.fill();
        target.globalAlpha = before;
    }

    /** A backdrop (`css.backdrop`): the pixels under the command's box, as they are now, blurred by the three-pass box
     *  blur above and written back; the element's own translucent fill is then drawn over it as its rectangle. Only
     *  the box is read and written, so nothing outside it moves. A backdrop inside a scissor is not blurred, as on the
     *  desktop; a second one a frame would blur the first one's pixels (the desktop cuts once). */
    function backdrop(target, c, blur) {
        if (!(blur > 0) || clips > 0) return;
        const m = target.getTransform();
        const scale = Math.abs(m.a);
        const x0 = Math.max(0, Math.floor(m.a * c.x + m.e)), y0 = Math.max(0, Math.floor(m.d * c.y + m.f));
        const x1 = Math.min(target.canvas.width, Math.ceil(m.a * (c.x + c.w) + m.e));
        const y1 = Math.min(target.canvas.height, Math.ceil(m.d * (c.y + c.h) + m.f));
        const w = x1 - x0, h = y1 - y0;
        if (w <= 0 || h <= 0) return;
        const sigma = (blur * scale) / 2;
        let r = Math.round((Math.sqrt(1 + 4 * sigma * sigma) - 1) / 2);
        if (r < 1) r = 1;
        const image = target.getImageData(x0, y0, w, h);
        const a = image.data, b = new Uint8ClampedArray(a.length);
        for (let pass = 0; pass < 3; pass++) {
            boxBlurH(a, b, w, h, r);
            boxBlurV(b, a, w, h, r);
        }
        target.putImageData(image, x0, y0);
    }

    /** The picture of an image's path: decoded once, and the frame after it arrives is the one that shows it. */
    function bitmap(path) {
        let img = bitmaps.get(path);
        if (img === undefined) {
            img = new Image();
            img.src = image(path);
            img.addEventListener('load', () => onImage?.());
            bitmaps.set(path, img);
        }
        return img.complete && img.naturalWidth > 0 ? img : null;
    }

    /** One command onto `target`: the frame's shapes, text, pictures and clips. */
    function command(target, c, plan, at) {
        const s = plan?.shadows.get(at);
        if (s) shadow(target, c, s);
        // the desktop draws the element's shadow before its cut, so the shadow is on the page the blur reads
        const bd = plan?.backdrops.get(at);
        if (bd !== undefined) backdrop(target, c, bd);
        switch (c.type) {
        case TYPE.RECTANGLE: {
            const g = plan?.gradients.get(at);
            if (g) gradient(target, c, g);
            else withAlpha(target, c.alpha, () => {
                roundRect(target, c.x, c.y, c.w, c.h, c.radius);
                target.fillStyle = c.color;
                target.fill();
            });
            break;
        }
        case TYPE.BORDER: withAlpha(target, c.alpha, () => borderRect(target, c)); break;
        case TYPE.TEXT:
            target.font = fontFor(c.fontSize);
            target.fillStyle = c.color;
            target.textBaseline = 'alphabetic';
            // Clay's box is the text's line box; the alphabetic baseline sits one ascent below its top
            withAlpha(target, c.alpha, () =>
                target.fillText(c.text, c.x, c.y + (ascent.get(c.fontSize) ?? c.fontSize * 0.8)));
            break;
        case TYPE.SCISSOR_START: {
            const clip = new Path2D();
            clip.rect(c.x, c.y, c.w, c.h);
            target.save();
            target.clip(clip);
            clips++;
            break;
        }
        case TYPE.SCISSOR_END: target.restore(); clips = Math.max(0, clips - 1); break;
        case TYPE.IMAGE: {
            const img = bitmap(c.text);
            // ThorVG's tvg_picture_set_size: scaled into the box. An image command carries no colour, so its alpha
            // slot is 0: the picture is drawn whole.
            if (img) target.drawImage(img, c.x, c.y, c.w, c.h);
            break;
        }
        }
    }

    /** The offscreen canvas of one group nesting level, cleared and at the frame's scale. */
    function layer(level) {
        let l = layers[level];
        if (!l) {
            const canvas = document.createElement('canvas');
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            l = layers[level] = { canvas, ctx: canvas.getContext('2d') };
        }
        l.ctx.setTransform(1, 0, 0, 1, 0, 0);
        l.ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
        l.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return l;
    }

    /** A group: its subtree's commands onto an offscreen canvas, then one composite with the alpha and the matrix (the
     *  scale, then the rotation, then the translate, about the first command's box centre — Clay_ThorVG_SettleGroup). */
    function group(target, commands, plan, g, level) {
        const l = layer(level);
        l.ctx.save();
        paint(l.ctx, commands, plan, g.start, g.end, level + 1, g);
        l.ctx.restore();
        target.save();
        target.globalAlpha = target.globalAlpha * Math.min(1, Math.max(0, g.alpha / 255));
        target.translate(g.cx + g.tx, g.cy + g.ty);
        if (g.rotate !== 0) target.rotate((g.rotate * Math.PI) / 180);
        target.scale(g.scale, g.scale);
        target.translate(-g.cx, -g.cy);
        target.drawImage(l.canvas, 0, 0, width, height);
        target.restore();
    }

    /** The commands from..to (inclusive), a group's range drawn as one scene at its first command (`self` is the group
     *  whose own range this is: its first command is not a nested group). */
    function paint(target, commands, plan, from, to, level, self = null) {
        for (let i = from; i <= to; i++) {
            const g = plan?.groups.get(i);
            if (g && g !== self && g.end <= to) {
                group(target, commands, plan, g, level);
                i = g.end;
                continue;
            }
            command(target, commands[i], plan, i);
        }
    }

    /** Which command draws which effect: a shadow and a gradient belong to the element's first command with its id. */
    function plan(commands, effects) {
        if (!effects) return null;
        const shadows = new Map(), backdrops = new Map(), gradients = new Map(), groups = new Map();
        const drawnShadow = new Set(), drawnBackdrop = new Set(), drawnGradient = new Set();
        for (let i = 0; i < commands.length; i++) {
            const c = commands[i];
            const s = effects.shadows.get(c.id);
            if (s && !drawnShadow.has(c.id)) drawnShadow.add(c.id), shadows.set(i, s);
            if (c.type !== TYPE.RECTANGLE) continue;
            // the desktop cuts the frame at the element's first *rectangle* (Clay_ThorVG_BackdropOf)
            const b = effects.backdrops.get(c.id);
            if (b !== undefined && !drawnBackdrop.has(c.id)) drawnBackdrop.add(c.id), backdrops.set(i, b);
            const g = effects.gradients.get(c.id);
            if (g && !drawnGradient.has(c.id)) drawnGradient.add(c.id), gradients.set(i, g);
        }
        // a group that contains another is drawn first: by its start, and the longer range first where two start together
        for (const g of [...effects.groups].sort((a, b) => a.start - b.start || b.end - a.end))
            if (!groups.has(g.start)) groups.set(g.start, g);
        return { shadows, backdrops, gradients, groups };
    }

    /** The command array as pixels: an empty canvas, then the commands and the effects beside them. */
    function draw(commands, effects = null) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.globalAlpha = 1;
        clips = 0;
        paint(ctx, commands, plan(commands, effects), 0, commands.length - 1, 0);
    }

    return { width, height, dpr, measure, draw, ascent, images: () => [...bitmaps].map(([path, img]) => ({ path, complete: img.complete, width: img.naturalWidth })) };
}

/** Reads the command array out of the wasm's memory. */
export function readCommands(wasm) {
    const count = wasm.cmd_count();
    const stride = wasm.cmd_size() / 4;
    const base = wasm.cmds();
    const i32 = new Int32Array(wasm.memory.buffer, base, count * stride);
    const f32 = new Float32Array(wasm.memory.buffer, base, count * stride);
    const decoder = new TextDecoder();
    const out = [];
    for (let i = 0; i < count; i++) {
        const o = i * stride, len = i32[o + 16];
        out.push({
            type: i32[o], id: i32[o + 1] >>> 0,
            x: f32[o + 2], y: f32[o + 3], w: f32[o + 4], h: f32[o + 5],
            color: `#${(i32[o + 6] & 0xffffff).toString(16).padStart(6, '0')}`,
            alpha: ((i32[o + 6] >>> 24) & 255) / 255,
            radius: [f32[o + 7], f32[o + 8], f32[o + 9], f32[o + 10]],
            border: [f32[o + 11], f32[o + 12], f32[o + 13], f32[o + 14]],
            text: len ? decoder.decode(new Uint8Array(wasm.memory.buffer, i32[o + 15], len)) : '',
            fontId: i32[o + 17], fontSize: i32[o + 18],
        });
    }
    return out;
}

/**
 * Reads the renderer's tables out of the wasm's memory (browser/ui.c's fx/fx_count/fx_stride): the shadows and the
 * gradients by the element id their command carries, the backdrops likewise, and the groups as command ranges. A wasm
 * without them (browser/page.c) has none.
 */
export function readEffects(wasm) {
    if (typeof wasm.fx_count !== 'function') return null;
    const effects = { shadows: new Map(), backdrops: new Map(), gradients: new Map(), groups: [] };
    /** The rows of one table: an int32 view for the ids and the counts, a float32 view for the numbers beside them. */
    const rows = (kind) => {
        const count = wasm.fx_count(kind), stride = wasm.fx_stride(kind), base = wasm.fx(kind);
        if (!count) return null;
        return {
            count, stride,
            i32: new Int32Array(wasm.memory.buffer, base, count * stride),
            f32: new Float32Array(wasm.memory.buffer, base, count * stride),
        };
    };
    const shadows = rows(0);
    for (let k = 0; shadows && k < shadows.count; k++) {
        const o = k * shadows.stride, f = shadows.f32;
        effects.shadows.set(shadows.i32[o] >>> 0, {
            x: f[o + 1], y: f[o + 2], blur: f[o + 3], color: [f[o + 4], f[o + 5], f[o + 6], f[o + 7]],
        });
    }
    const backdrops = rows(1);
    for (let k = 0; backdrops && k < backdrops.count; k++)
        effects.backdrops.set(backdrops.i32[k * backdrops.stride] >>> 0, backdrops.f32[k * backdrops.stride + 1]);
    const gradients = rows(2);
    for (let k = 0; gradients && k < gradients.count; k++) {
        const o = k * gradients.stride, f = gradients.f32, i = gradients.i32;
        const stops = [];
        for (let s = 0; s < i[o + 4]; s++) {
            const q = o + 5 + s * 5;
            stops.push({ offset: f[q], color: [f[q + 1], f[q + 2], f[q + 3], f[q + 4]] });
        }
        effects.gradients.set(i[o] >>> 0, { kind: i[o + 1], angle: f[o + 2], alpha: i[o + 3], stops });
    }
    const groups = rows(3);
    for (let k = 0; groups && k < groups.count; k++) {
        const o = k * groups.stride, f = groups.f32, i = groups.i32;
        effects.groups.push({
            start: i[o + 1], end: i[o + 2], alpha: i[o + 3],
            scale: f[o + 4], tx: f[o + 5], ty: f[o + 6], rotate: f[o + 7], cx: f[o + 8], cy: f[o + 9],
        });
    }
    return effects;
}
