# cssints-native

A native UI framework on [cssints](../packages/cssints) styles and [Clay](https://github.com/nicbarker/clay)
layout: the desktop on the GPU first, then an ESP32 with no JS on the chip. The plan and the targets are in
[docs/map.md](docs/map.md).

```ts
import * as css from "cssints/clay" with { type: "cssints" };

export const units = css.cn(
  css.width(200),
  css.height(38),
  css.bg("rgb(36 40 52)"),
  css.borderRadius(19),
);
```

```sh
node --conditions=development generator/clay-header.ts styles.ts styles.h   # C for CLAY(CLAY_ID("Units"), units)
```

This directory is `native/` of the cssints repository: the commands below run from it (`cd native`), and `bun install` is
the repository's, at its root (`native` is one of the bun workspaces). From the repository root, `bun run test:native`
is `sh native/test.sh`.

## Layout

```
generator/clay-header.ts   styles.ts -> styles.h through the cssints plugin
generator/page-to-c.ts     a Solid page at build time to C: renders it, walks the tree, reuses styles.h's names
examples/units/            the pill proven on the board, and same.c: generated vs hand-written, same render commands
examples/sensors/          the Sensors page: styles.ts, page.c, its stored frames
desktop/                   host.c (SDL3 window or a headless frame, --dump), clay_renderer_thorvg.c, thorvg_wg.c, build.sh,
                           build-thorvg-gpu.sh (ThorVG's WebGPU engine, from source), clay_dump.c/.h (a frame as JSON, every target)
dump-check.ts              a C host's dump against a golden, field by field (desktop/host.c --dump, the C page)
solid/                     Solid 2 on the desktop: a universal renderer over Clay through bun:ffi; the Sensors and Widgets pages (solid/README.md)
focus/                     the focus manager: Tab order, roving focus in groups, restore (no DOM), focus/README.md
terminal/                  the same page in cells: Clay -> terminal/cells.c -> ANSI truecolour; demo, --dump, --keys.
                           The sky screens (home, thread, profile) and their focus layer (terminal/focus.c)
vendor/                    clay.h and Clay's SDL3 renderer (e6cc369), a font
headless/                  button, switch, checkbox, disclosure as signals + neutral parts, checked against Quint specs
browser/                   the same page as WebAssembly on a canvas: page.c (Clay + generated C), draw.js, render.js,
                           check.mjs; and solid/ — the Solid page in the browser over ui.c, ffi-browser.ts, page.ts, build.ts
docs/map.md                targets, layers, order of work
```

## Effects

`css.shadow({ x, y, blur, color })` is the first one: a renderer effect, because Clay 1.0's declaration has no shadow
field. The style's literal carries it as a sibling `shadow` key, `solid/src/pack.ts`'s `variant()` pulls it out beside
the image's path (the packed box itself stays 45 floats), `solid/src/frame.ts` calls `ui_shadow(x, y, blur, r, g, b, a)`
before `ui_open`, and `ui.c` hangs it on a side table keyed by the element id's 32-bit hash (`Clay_ElementId.id`),
cleared in `ui_begin` with the rest of the frame. `desktop/clay_renderer_thorvg.c` draws it for the element's first
command that carries that id — the command's box and corner radii, offset and filled with the shadow's colour, as a
scene with `tvg_scene_add_effect_gaussian_blur` (sigma `blur / 2`, CSS's reading, quality 80), then the command, which
covers the shadow's middle. One shadow an element; **the element needs an `id`**.

The effect's sigma is in the scene's own units, so the root scene's scale carries it: the same sigma under a root at
pixel density 2 blurs twice as many device pixels, which is why it is not multiplied by the density. Ceilings, on
purpose: 32 shadows a frame, no spread and no inner shadow (the box is the element's own), nothing cached between
frames (the blur runs again each frame), and the cost is real — the Dialog page's 280x152 panel at blur 32 takes the
frame's draw from 0.58 to 1.92 ms (Apple M2, one thread, `--bench 300`, two back-to-back runs; the price grows with the
blur's area). The C pages — `examples/`, the terminal, the browser — ignore a shadow: `header()` prints nothing for it
and the generated declarations are unchanged.

### A backdrop: glass over our own content

`css.backdrop({ blur })` blurs the page under an element, so a translucent fill is glass. It travels as the shadow
does — a sibling `backdrop: { blur }` key, pulled out by `variant()`, `ui_backdrop(blur)` before `ui_open`, a side table
in `ui.c` keyed by `Clay_ElementId.id`, one an element, cleared in `ui_begin` — and the hard part is the draw, not the
style: the pixels under the panel must be blurred **before** the panel's own commands, and ThorVG draws the whole
command array in one `tvg_canvas_draw`.

So the renderer cuts the frame. When the first command carrying a backdrop element's id arrives (a rectangle: only one
cuts), it draws what it has built as pass 1, blurs the element's box in the buffer, starts a new scene, and carries on
from there: the element's fill, text, border and focus ring are in pass 2, over the blurred pixels, so they stay crisp.
`tvg_canvas_draw(d->canvas, d->clear)` clears for pass 1 only. Two things in ThorVG made this fiddly, both measured:
the software canvas seeds its working surface from the target on its **first** draw and replaces what a later draw's
paints touch (so a second draw of a translucent fill comes out as its own alpha — the renderer sets the same target
again before pass 2, which re-seeds it; and a scene effect drawn in an earlier pass wipes the frame if it does not), and
`tvg_paint_rel` on a scene the canvas has owned is a double free, so the pass-1 scene is only removed.

The blur is on the CPU, on the box alone, clipped to the canvas, intersecting nothing else: three box passes each way
(a gaussian to the eye, no kernel to build), radius from CSS's reading of a blur radius — sigma `blur / 2`, as the
shadow's, and a pass of radius r three times has the variance `r² + r`, so `r = (sqrt(1 + 4σ²) - 1) / 2`. The window
clamps at the box's edges, so nothing outside the box is read or written (the pixel test checks the rest of the frame is
byte-identical), and alpha is carried through untouched (it is 255 everywhere; a straight average per channel is
correct). The two buffers are the box's size, `malloc`'d a blur. One cut a frame: a second backdrop, or a nested one, is
not drawn — glass under glass would read a frame the first cut has already drawn. A backdrop inside a scissor scene does
not cut either, neither does one on the WebGPU canvas (its frame is read back after the whole draw, so there is nothing
to blur). The panel's own shadow is drawn before the cut, so it lies on the unblurred page under the glass; the part of
it under the box is blurred with the rest of the page, and the panel covers it.

Cost, measured on the Dialog page's menu (150x133, blur 10 → r = 5) at 360x480, `--bench 300`, Apple M2, one thread: the
frame's draw is 2.2 ms without the glass and 3.0 ms with it (back-to-back runs of 300 frames on a loaded machine, so
0.7-1.0 ms for one glass). The radius is not the lever: blur 18 costs ~0.2 ms more than 10, and a cut with blur 0 is
the same within the noise — the price is the second `tvg_canvas_draw` and the target re-seed, not the six box passes over
about 20k pixels each. Cheap enough for a menu; a full-window backdrop at blur 24 would be ~8× the area and is not free.

The Dialog page's menu is the first glass: `blur 10`, a fill of `rgb(23 27 32 / 0.72)` in the dark theme and
`rgb(255 255 255 / 0.78)` in the light one, overlapping its trigger by 20px so there is a border and a text stroke under
it. The modal dialog keeps its opaque fill and its shadow: the dimmed float under it is one flat colour, so a blur there
would show nothing.

### A gradient: a fill the renderer draws

`css.backgroundImage("linear-gradient(...)")` is a fill, not an effect on the buffer: the element's box is painted with
ThorVG's linear gradient instead of its solid `backgroundColor`. It travels as the shadow does — a sibling
`backgroundImage: { kind, angle, stops }` key of the style literal, `pack.ts`'s `variant()` pulls it out, `frame.ts` calls
`ui.backgroundImage(kind, angle, count, stops)` (the C function `ui_backgroundImage`, five floats a stop: offset 0..1, r,
g, b, a) before `ui_open`, and `ui.c` fills a pending value that `ui_open` hangs on the renderer's table by
`Clay_ElementId.id`, cleared in `ui_begin` with the rest of the frame. At the element's first **rectangle** command the
renderer fills the box's rounded rect with the gradient and does not draw the solid colour; a border is a command of its
own and stays. The element needs an `id`, and a solid `backgroundColor` too: Clay emits a rectangle only for a fill that
is not transparent, so the gradient is what that command draws, and the solid fill is what the C targets keep.

Geometry is CSS's gradient line: the direction is `(sin θ, -cos θ)` (0deg up, 90 right, 180 down — the default), the line
is `|w·sinθ| + |h·cosθ|` long (the box's projection on it), and it runs from the box's centre minus half of that to the
centre plus half. ThorVG's gradient coordinates are the shape's own, the same space as its path, so they are Clay units:
the root scene carries the pixel density, as it does for a shadow's sigma.

Ceilings, on purpose: one gradient an element (16 a frame), 8 stops (a ninth is counted as an error and dropped), linear
only (ThorVG has radial and conic, the style's grammar takes neither), the solid fill under a gradient is not drawn (not
blended), no gradient on text, a border or an image, and the C targets — `examples/`, the terminal, the browser — keep the
solid fill: `header()` prints nothing for a gradient and the generated declarations are unchanged.

Cost: the Sky page's three cards (336x190 each) with gradients against the same page with the gradients dropped,
`--bench 1000`, Apple M2, one thread, the least-loaded of three back-to-back pairs: 3.735 against 3.631 ms a frame
(light 3.625 against 3.458), so **under 0.2 ms for the three cards**, inside the run-to-run noise of this machine
(±0.5 ms). The fill covers the same pixels either way; a gradient's per-pixel lerp is what a solid fill does with one
colour.

Banding, and the dither that goes with it: an 8-bit channel turns the dark card's 190px into **6 runs of one luminance of
about 30px** (18 distinct colours, the longest 32px), the light one into 12 of about 15px (30 colours, the longest 17px); the
dark gradient from `27 32 38` to `21 25 30` has 6 channel values to spread over 190px, so one step every 30px is a strap the
eye sees on a large flat surface. After the frame, `Clay_ThorVG_RenderClayCommands` ends with
`Clay_ThorVG_DitherGradients`: a **4x4 ordered (Bayer) dither of one level either way** (±1/255, the mean kept) on the RGB of
every pixel inside each gradient's box — cut to the canvas, to the clips (a scrolled feed) and to the corners' arcs, one
pixel inside the radius, so no pixel of the page moves. **The mark is the shape's pixels, not an axis-aligned box**: the
groups' map to the target is one affine (`Clay_ThorVG_Map`), and with a rotation in it the mark is the four mapped corners'
quad and every pixel of its bounding box is mapped _back_ into the shape's own space and tested against the box and its
arcs. An axis-aligned mark inside a rotated group stippled the page around the quad (2216 of its 5637 pixels on the test
tree) and missed the quad's tips (none of them): a black gradient over a black fill shows the dither alone, since its ±1
clamps at 0. The quad test leaves the page alone and covers the tips (0 outside, 1151 inside the quad but outside the
unrotated box: `solid/rotated.test.ts`). **A clip's cut is its own quad too**: a clip is a paint in the transformed scene,
so it turns with its group, and the dither records the quad the clip's box maps to (`Clay_ThorVG_Clip`: the whole-pixel
rect is the scan's bound, the quad is tested a pixel at a time). Before that test a gradient inside a _rotated_ clip was
stippled inside the clip's bounding box, so 1898 pixels the clip had cut away — the group's fill behind the gradient —
were stepped by ±1/255, and 3063 inside the clip were right; with the quad test the 1898 are 0 and the 3063 stay
(`solid/rotated.test.ts`, the `--clip` tree: the gradient 30px wider than the 60px clip inside a 30° group).
It is done in the buffer because there is no shader here: ThorVG's
CPU raster writes 8 bits a channel, and a second pass over the element's own pixels is the smallest place to break a step.
A card's column then shows **182 runs of 1-2px instead of 6 of 30** (the light card the same), and the three cards' ink is
unchanged by more than the step: a body's 828 ink pixels, its 44 flat ones at most 1/255 off the ink token, and none of the
15 pixels at the ink mask's threshold on its edge, so the mask — and the text's box — is the one the undithered frame had.
Cost: **0.22 ms for the three cards** (0.07 a card over 191,520 pixels: `--bench 400`, the least-loaded of three
back-to-back pairs 3.56 against 3.79 ms a frame) — the second pass over 766 KB of the target, which the run-to-run noise
of `--bench 1000` (±0.5 ms) cannot show. A per-row pre-scan (dither only the rows a band boundary falls in) was measured
against this and dropped: the step is one row of a 30px run, so the plateaus stay flat and the count above would not move.
`CLAY_THORVG_DITHER` picks the variant the build compiles (2: ±1 with the mean kept; 1: +1 on half the pixels, whose
0.5/255 mean shift is invisible but whose +1 clips the light card's white top into a flat band; 0: none) — those are the
three that were measured.

The Sky page's cards are the first gradient: `180deg` from `rgb(27 32 38)` to `rgb(21 25 30)` in the dark theme and
`rgb(255 255 255)` to `rgb(240 243 246)` in the light one — both top-lighter, so the light theme is the same direction,
not an inversion. A hover overrides the whole gradient with the hover tokens (`34 40 49` to `28 33 40`): a state cannot
unset one, so it replaces it.

### A value channel: one field of a style, per frame

A packed style is a **compile-time literal**: `solid/plugin.ts` runs cssints at build time, `pack.ts` resolves a theme
and a state, and the 45 floats are packed once and kept per variant, so no number in a style can change between frames.
The value channel is the hole in that, kept as small as the shadow's and the backdrop's side tables: a page's `tick`
(which runs after `ui_begin` and after the events, before the tree is declared) calls
`ui_value(id, len, field, value)` for an element's id, and `ui_open` copies that element's 45 floats, applies the frame's
overrides of its id and declares from the copy. Nothing is cached between frames, the table is cleared in `ui_begin`, and
a frame that uses no channel declares exactly what the literal says — which is how the Dialog's settled frames came out
byte-identical after the menu and the panel learned to move.

`field` 0..44 is a packed field, in `solid/README.md`'s table order; `pack.ts`'s `FIELDS` names the ones worth a name
(`WIDTH` 0, `HEIGHT` 3, `PADDING` 6, `GAP` 10, `BACKGROUND` 14, `BACKGROUND_ALPHA` 17, `RADIUS` 18, `BORDER` 26,
`BORDER_ALPHA` 29, `OFFSET_X` 38, `OFFSET_Y` 39, `EXPAND_W`/`EXPAND_H` 40/41, `Z_INDEX` 42, `CAPTURE` 43). **45 to 50 are
not floats of the style**: 45 is `ui_shadow`'s blur, the one number of a shadow a page can move, which the channel hands
to the pending shadow before `ui_open` hangs it on the renderer's table; **46 (`ALPHA`), 47 (`SCALE`) and 48/49
(`TRANSLATE_X`/`TRANSLATE_Y`) are one element's whole subtree as a ThorVG scene** (the section below), and they go to the
renderer's table the same way; **50 (`GRADIENT_ALPHA`)** is the opacity of the element's background image, which the
renderer uses to composite that gradient over the box's solid fill (255 is the gradient alone, the only way it was drawn
before). Out of range, or a 65th override in a frame, is counted as an error and dropped.

**51..54 (`TEXT_COLOR`, r g b a) are a text's, not a box's.** A text's colour lives in its own 10 floats (`ui_text`), not
in the parent's box, so the box channel could not reach it and a changing label swapped its style in one frame. A text now
takes an id like a box does (`ui_text(id, id_len, bytes, len, floats)`, NULL for an anonymous one), and `ui_value` on that
id's field 51..54 overrides the four colour floats of the text's copy. **The ceiling: a text without an id cannot be
named**, so its colour is its style's literal and cannot be animated — the Sky page's tab labels are the user
(`<text id="sky-tabs-label-i">`, `effect(0.15)` from the muted token to the accent and back, beside the 2px underline
that is the tab's own border). Only the colour moves: the font, the size, the spacing, the line height, the alignment and
the wrap stay the literal's.

**55 (`ROTATE`) is the group's fifth number**: degrees about the element's box centre, in the same scene as `SCALE` and
the translate, which the renderer composes into **one matrix — scale, then rotate, then translate**,
`x' = s·R(θ)·(x - c) + c + t` (`Clay_ThorVG_SettleGroup`; ThorVG reads a matrix as `x' = x·e11 + y·e12 + e13`,
`y' = x·e21 + y·e22 + e23`, its third row unused, so `s·R` is the 2×2 and `c + t - (s·R)·c` is the third column). A
positive angle turns clockwise on screen (y runs down). It is drawn, not laid out: `ui_bounds` is the style's box on every
frame, which is the point — the Dialog's menu settles out of a `-2°` tilt as it slides out of its trigger (`-2 → 0` on
`spatial(0.22, 0.1)`, and back to `-2°` on the way out). The order is proved on a hand-built non-square box
(`solid/dialog.test.ts`): a 200x40 box at the root with `SCALE` 0.5, `ROTATE` 90° and `TRANSLATE_X` 40 is drawn as the
rect x 130..150, y -30..70 — the long side stood up about the centre (100, 20), and the 40px after the rotation,
unscaled: a translate taken before the transform would put the rect at x 110..130, and a rotation of 0° leaves the box
where it was. A rotation of exactly 0 takes the scale's own expression rather than the rotation's arithmetic at 0°,
because `c·(1 - s)` and `c - s·c` do not round the same and a page that never leans must keep its frames (measured:
three glyph pixels of the scaled panel moved by one level).

What a page may animate, and what is meaningless mid-frame: an **offset** (`OFFSET_X`/`OFFSET_Y`), `EXPAND_*`,
`Z_INDEX`, the **shadow's blur**, the subtree's **alpha**, **scale**, **translate** and **rotation**, a **gradient's
opacity** and a text's **colour** are read as the element is placed and drawn, and nothing else moves.
`WIDTH`/`HEIGHT`, `PADDING`, `GAP` and the colours are
legal — the override is applied to the floats the declaration is built from — but Clay's layout is computed from the
declaration every frame, so a width or a gap that changes re-lays-out the element's parent and its siblings each frame:
it is a **layout** change, not a transform, and an animation of one reads as a jitter of everything around it. A slide
belongs on a float's offset; a fade, a scale or an arrival belongs on the group.

The cost is one scan of the table per `ui_open` on a frame that uses the channel, and a 180-byte `memcpy` of the 45
floats for each element that has an override (the Dialog writes two elements a frame: 360 bytes, and its declare phase is
0.008 ms of a 2.0 ms frame). The table holds 64 overrides, which is more than a page animating a dozen elements needs.

### Group opacity and scale: an element's whole subtree

A packed style can move one element's own numbers, and a text's colour is not in its parent's floats, so a panel could
not fade its children. Clay has no opacity and no transform either, and its command stream is flat. What the renderer
does have is the **element tree** and each command's element, and that is enough for the two effects that were missing.

`ui.c` keeps the frame's tree as the page declares it: `ui_open` pushes a node `{id, parent}` (the parent being the
element that was open before it; Clay gives an anonymous element an id of its own on open, so it is read back after, and
an anonymous element is a parent like any other), `ui_close` pops, and `ui_text` adds a node for the text — a text is
never open, but a group's subtree has to reach through it. The nodes are in declaration order, at most 1024 a frame, and
cleared in `ui_begin`. Every element's declaration carries its node as `userData` (`index + 1`), which Clay copies into
each command it emits from that element, so at draw time every command says which element it belongs to.

The two fields are the value channel's, above the shadow's blur: **46 `ALPHA`** (0..255) and **47 `SCALE`** (1 = none);
48/49 `TRANSLATE_X`/`TRANSLATE_Y` are a visual offset of the same subtree (px, 0 = none) and 55 `ROTATE` its angle in
degrees about the same centre. `ui_open` reads them into the
renderer's group table instead of into the floats (they are not floats of the style), and they carry no layout:
`ui_bounds` does not move while a group scales, slides or turns. A page writes them from its `tick` as it writes an
offset, one call an element.

The renderer then turns each group into a **range**: the commands whose element is the group's element or under it.
Clay's commands are in depth-first order, so a subtree's commands are contiguous and a min/max over the ancestry is the
whole of it (the panel's range is 15..25 of the Dialog's frame, the menu's 14..21). A command that carries no node — a
scissor's own start or end — belongs to the last element that had one; it is emitted inside that element's subtree, so
it cannot widen a range past it. A group at alpha 255, scale 1 and no offset gets no range at all: a settled frame is
drawn exactly as the literal makes it, which is why the Dialog's settled frames came out byte-identical.

In the draw loop, the first command of a range opens a scene and makes it `into`; the last one gives the scene
`tvg_paint_set_opacity(scene, alpha)` and, if the scale is not 1, the offset is not 0 or the rotation is not 0, a
matrix, then adds it to the
scene that was current when it opened. The scale and the rotation are about the **box centre of the range's first
command**, and ThorVG
carries a matrix's translation in its third column (`x' = x·e11 + y·e12 + e13`; its third row is unused, so a
translation written into `e31`/`e32` is silently dropped — measured), which makes the whole transform `scale` on the
diagonal, `centre·(1 - scale) + translate` in `e13`/`e23`: `x' = scale·(x - c) + c + tx`, the scale about the centre and
the offset after it, unscaled. With a rotation the linear part is `s·R(θ)` and the third column `c + t - (s·R)·c`:
**scale, then rotate, then translate**, one matrix, about the box centre (the order is in the section above). Everything
in the range inherits it: the element's own fill, its text, an image, a
gradient, and — because the loop opens a group before the element's shadow is drawn — its shadow. A shadow fades, scales
and slides with the panel it belongs to, which is what the eye expects.

Limits, stated rather than hidden. **Nesting**: four groups may be open at once (a group inside a group inside …), and a
fifth is drawn ungrouped; 16 groups a frame. **A scissor** (`css.overflow`, a float's clip) opens its own scene _inside_
whatever is current, so a group's subtree that contains a clipped element fades and scales as a whole; the scissor stack
is eight deep. **A clip is a ThorVG paint in the transformed scene, so it turns with its group** — its edge is drawn
tilted, and `solid/rotated.test.ts` proves it (the clipped child's right edge at x 101 on one row and 89 on another
inside a 30° group) — while the dither, which works on the target's pixels after the draw, marks a gradient by the
groups' affine map: the box's four corners' quad, tested a pixel at a time, so a gradient in a rotated group is stippled
where it really is and never on the page around it. A clip's _cut_ for the dither is that clip's quad as well: the
rect is the scan's whole-pixel bound and a pixel is also tested against the quad, so a gradient inside a rotated clip
is never stippled where the clip cut it away. **A backdrop's cut**
mid-group is the one thing that splits a scene: the cut draws pass 1 over the target,
so the groups open at that moment are settled into it first and made again in the new root after it, and the rest of the
subtree is composited with the same alpha, scale, rotation and offset — the Dialog's menu is exactly this case (its own
rectangle is the cut) and its shadow, fill, text and border all sit at the same opacity and lean. A group whose range
never meets its end
(only a hand-made command array could) is composited as it is at the end of the loop.

The Dialog page is the first user. The **panel** and the **menu** arrive as a group: `ALPHA` 225 → 255 on `effect(0.2)`
(a luminance field is clamped, as the dim is) and `SCALE` 96 → 100 on `spatial(0.22, 0.1)` — percent, not a fraction,
because a track's settle rule is 0.5 of its own unit, so 0.96..1 would be "settled" on its first sample; 96..100 snaps at
99.5, a 0.5% jump nobody sees. The **menu** also leans out of `ROTATE` `-2°` → `0` on the same `spatial(0.22, 0.1)`
(field 55, the rotation of the same scene), so it settles into place instead of arriving square: 2° over its 150px is
5px of top edge, which reads as a settle rather than a spin — measured (`solid/dialog.test.ts`, the insets of the top
border a row below the box's top) `112/11` on the frame it opens on, `108/10`, `60/8`, `25/7` and `5/5` at rest, with the
box `40,·,150,133` on every frame of it (`ui.bounds` is the style's: the rotation is drawn). The exit runs both back
(0, 96, -2°) on `effect(0.2)` and `spatial(0.2, 0)` beside the offsets
and the blur that were already there, and the backdrop keeps its own dim through field 17: its box is the window, so its
alpha _is_ the dim, and a scene around it would composite the page's own pixels. Measured on the third frame after the
panel opens (`dialog-entry-mid`, t = 0.05s): alpha 119 of 255, scale 97.8%, the box `40, 156.1, 280x152.3` against
`40, 163.9, 280x152.3` at rest — the x, width and height are the literal's at every frame, only the float's offset moves
the y. A flat spot of the panel reads `24,27,36` between the dimmed page's `7,8,10` and the settled panel's `36,40,52`;
the title's brightest pixel `163,163,166` against the settled ink's `235,235,240`; and the panel's visible edges `43..316`
inside its settled `40..319`. The mutation is the renderer's: dropping `tvg_paint_set_opacity` from a group fails
`FAIL mid-entry the spot is a blend of the dimmed page and the panel: false, wanted true` and
`FAIL mid-entry the ink is a blend, not the settled text: false, wanted true`, and nothing else — the scale alone does
not fade.

## Motion

`solid/src/motion.ts` is Rune's model, and the first user is the Sky feed's scroll. A **spring** is made from
SwiftUI's `(duration, bounce)`: `ω = 2π / duration`, `ζ = 1 - bounce`, and the analytic solution of
`d'' + 2ζω d' + ω² d = 0` for the three regimes — a decaying sinusoid under-damped, `e^(-ωt)(d0 + (v0 + ω d0)t)`
critically damped, two real exponentials over-damped. It is exact at any instant, so there is no integration and no
frame-rate dependence. A **track** is one segment `{x0, v0, target, t0, spring}`; `at(t)` returns `{x, v, done}` and
`retarget(t, target)` first samples the presented `(x, v)`, so the value and the velocity are continuous. The settle
rule is 0.5px and 0.5px/s: within it the value _is_ the target and the velocity 0, an exact snap like Rune's 1/64px
idea without the grid. Two classes: `spatial()` (0.35s, bounce 0, may overshoot) and `effect()` (critically damped and
clamped to the start..target range, so a colour or an opacity cannot overshoot even when a bounce is asked for). A
**decay** is a fling: `v(t) = v0·r^t` with `r = 0.998` per millisecond (iOS's normal deceleration), i.e.
`v0·e^(-kt)`, `k = -1000 ln r ≈ 2.002`, and `x(t) = x0 + v0(1 - e^(-kt))/k`; `project()` is `x0 + v0/k`, where it lands,
and it stops at `|v| < 5px/s` on the projection. **The clock is passed in**: nothing in the file reads the time, so a
headless frame at 1/60 and a window frame at the real dt take one path and a test can ask for any instant.
`bun solid/motion.test.ts` checks 16.6ms against two 8.3ms steps, the continuity of a retarget (both limits), the exact
settle, `effect` staying inside its range, and the decay's monotonicity and projection; with presence and reduced motion
it also checks an exit's length to a frame and its unmount, a revive mid-exit (the value is the exit's own, the velocity
carries), the channel's one call an element, and reduced motion's instant land and instant unmount. The mutation is the
model's: `Track.retarget` dropping the sampled velocity (setting `v0 = 0`) fails the sky test's mid-flight block.

Two host members carry the wheel to a page. `ui_window_poll` still adds every SDL wheel event through `ui_wheel`, and
`ui_wheel` now fills two channels: Clay's (as before, for a page that keeps Clay's scroll container) and the page's,
drained by `ui_wheel_pop(float out[2])`. `ui_auto_scroll(0)` stops `ui_begin` from calling
`Clay_UpdateScrollContainers` with that delta (the delta is still drained), so a page that owns its offset does not get
the notch twice; the default is on, and **the Sky feed and the List's viewport turn it off** — every other page keeps
Clay's container. On the host
side, `View.onWheel(dx, dy)` gets the polled delta before the frame (the window loop pops it after `ui_window_poll`;
`--wheel N` in headless mode calls the same pop after each notch, and `--wheel-rest` puts a frame of rest between them, so
a long scripted run is the notches' own 10px each instead of a 60Hz flick), `View.onPointer(x, y, down, touch)` is called
once a frame after the events (a page that drags keeps its own flag: `onPress` sets it, `down` false clears it; `touch`
says the pointer is a finger's — see "Touch input" below), and `View.tick(dt)` is called once a frame after the events and
before `flush()`. `main.ts` wires a page's `motion` object (`src/entry.ts`: the
three hooks) to all of them — the Widgets slider and the scrolling pages both take the pointer — and `Sky` and `List` put
their handlers there.

The Sky feed's offset is a positive-down value the page owns. A wheel notch adds 10px (as before) to a clamped target
and retargets the track; a notch from rest starts at the velocity a critically damped spring needs to glide the step
without overshoot (`ω·d`), so the notch moves on its first frame and each frame after it less. A burst of notches
(≥2, frames or notches) is a flick: on the release the track's presented velocity is handed to a decay, its
`project()` is clamped to the content, and the motion either runs the decay to that landing (inside the content) or
springs to the clamped end from the presented `(x, v)`. A wheel during a throw retargets from the presented `(x, v)`,
so nothing jumps or stops. The keyboard retargets the same track: Down/Up 40px, PageUp/PageDown a viewport, Home/End
to the ends. The clamp is explicit: the last card's `ui.bounds` bottom plus the 12px padding, less the viewport's
bottom and Clay's offset, so a shorter feed clamps to 0. `ui.scrollTo("sky-feed", -x)` puts the presented value on
Clay's clip element each frame. Measured (`solid/sky.test.ts`): one notch moves `2.59, 1.92, 1.42, 1.05, 0.78, 0.58…`
px a frame and rests at exactly 10px; eight notches step `2.59, 2.28, 2.64, 3.32, 4.14, 4.99, 5.79`, peak at 6.69 and
decay to rest at 78px after 20 frames; a notch up 13.51px into that throw lands at 64.05 (10px back), the worst
frame-to-frame increase 1.64px against the notch's 10. The four stored `frames/sky*.png` were regenerated with the new
`--settle 60` and are **byte-identical**: the settle is the same -78 the clamp had, so the motion changes the frames
between the ends, not the committed ones.

**The rubber band at the feed's ends.** Past an end the wheel is not scrolling, it is pulling the edge, and the content
moves by Rune's and iOS's resistance: `rubber(x, d) = (1 - 1/(x·c/d + 1))·d` with `c = 0.55` (`BAND_C` in `motion.ts`)
and `d` the viewport's height (the feed's 664px). `x` is the raw overshoot the notches have accumulated, so a notch's
first 10px past the end move 5.45 and the fourth only 5.19 (21.29 for the raw 40 — the resistance is _less_ than the
push, and never reaches `d`). A notch is a **pull** only when the content is already at the end it pushes past (or over
it): a notch that merely _reaches_ the end while the content is still gliding there is a scroll like any other, and
snapping it into the band would jump it — measured, an eight-notch flick's peak step is 6.69px either way. A pull is
where the wheel puts it on that frame, because that is direct manipulation; the return is a spring. **80ms**
(`BAND_HOLD`) without a notch and the band lets go on `spatial(0.35, 0.1)` from what it presents, settling exactly on
the clamp (measured: held four frames, back on 78 twenty-two frames later); a key drops it on the frame it is pressed;
a notch the other way walks it back towards the end. The fling is not a pull — a banded stroke's release is a spring to
the clamp, not a decay (`!band` in the release branch) — and a feed switch (a clamp that changed) is still a hard
clamp. The band goes on Clay's clip element through a second host member, `ui_scroll_put(id, y)`: `ui_scroll_to` clamps
to the content (Clay's own range), and a band is out of it on purpose — so the write takes `put` for as long as the
presented value is past an end (the band and the first frames of its way back) and `scrollTo` inside it, which is what
makes the return a spring rather than a snap; 0.01px past an end is the clamp's own float noise and is written through
`scrollTo`, so a settled page is the exact integer its stored frames have. Reduced motion has no band at all: the offset is
clamped hard, and `reduced()` folds the raw overshoot to 0 before the resistance is asked for. `sky-band.png` is
Discover — whose three posts are shorter than the viewport, so its first notch is already past its end — four notches
past it, at `21.29px` of the raw 40.

**The feed's entry.** On its first mount the Sky page's cards arrive: each starts 12px lower than its box and at 0
opacity, and settles on its literals in 0.3s (`TRANSLATE_Y` on `spatial(0.3)`, `ALPHA` on `effect(0.3)` — the group of
the whole subtree, so the card's shadow, fill, avatar, text and gradient all move and fade together and `ui_bounds` is
the settled box from the first frame). Each card waits 50ms (3 frames at 60Hz) longer than the one above it, so the
feed fills in rather than popping. A card's tracks start on the frame its delay is up, from the entry's own values, and
the page writes nothing at all once both have settled: a card at rest is the literal's frame, and `sky.png` is
byte-identical with and without the entry. The stagger is on the first mount only — a tab switch draws the new feed at
rest, so `sky-science.png` is unchanged. Measured (`solid/sky.test.ts`): the first frame draws none of the three; eight
frames in they are 4, 8 and 12px below their boxes, each further behind the one above it; thirty frames later they are
exactly on them. `sky-entry.png` is ten frames in, at 2, 4 and 10px. Reduced motion starts no track at all: no stagger,
no wait, the settled frame on the first frame.

**A hover is a fade, and the tab's underline with it.** A card's and a tab's hover used to swap a style variant; now it
is 120ms of `effect` (a luminance field is clamped and critically damped). A tab has no gradient, so the four
background floats (`BACKGROUND` 14–17) from the resting tone to the hover's are the whole of it — and a tab at rest has
no background at all, so the fade starts from the page it sits on (`variant(s.root)`'s packed colour, which is what a
transparent box shows) and lands on its `:hover` variant, the literal. A card has a gradient, which is drawn _instead_
of its solid fill, so the four floats alone would fade behind it: the card's fade also moves the gradient's opacity
(`GRADIENT_ALPHA` 50, from 0 to 255) and the renderer composites a gradient below 255 over the box's solid fill, so the
two gradients cross-fade through the tones between them and the settled hover is the hover gradient, pixel for pixel.
The card alternates two styles (`card` with the resting gradient, `cardHover` with the hover one) and the page keeps the
hover one while the fade runs _either way_: a `:hover` state would swap the gradient back the moment the pointer left,
and the fade out would never be seen. One consequence, stated: the gradient's identity changes at the two ends of a
fade, so the last 6/255 at the card's bottom edge appears when the fade hands over (the flat panel and the panel
gradient's top are the same colour; only the far end differs). A tab's **2px underline** is its own border colour
(`BORDER_ALPHA` 29): the tab that becomes active fades it in and the one that was fades it out — a colour, not a slide,
and the border is 2px on both (Clay draws a border inside the box, so no box moves) — and the tab that is leaving keeps
the border (and the tab that is arriving keeps it too) while its colour fades. **The label beside it fades with it**:
a text's colour is not in its box's floats, so the tab's `<text>` carries an id and the page fades the text's own four
floats (`TEXT_COLOR` 51–54, `effect(0.15)`) from the muted token to the accent on the tab that becomes active and back
on the one that was — the first use of the channel on something that is not a box. A settled label writes nothing: its
literal is the end it is on (the page still swaps `tabText`/`tabTextOn` at the switch), so the resting frames are
byte-identical to the ones before the label could fade. Measured (`solid/sky.test.ts`, the ink's core as the pixel
furthest from the page): the new label `139/152/165 → 126/152/176 → 106/153/195 → 89/154/211 → 77/155/222 → 59/156/240`
and the old one the same path back; a quick switch back never leaves the two ends, its widest frame 15/255; the one
stored frame of it is `sky-tab-mid.png`, a switch two frames in. Both fades retarget from
the presented colour, so a fast leave and re-enter never jumps (measured: the widest frame of one is 3/255); the ends
are read from the packed variants under the _frame's_ theme, so the light palette fades between its own tones; a
selected card keeps `cardOn` and does not fade at all. Measured: a card's colour `28/33/41 → 31/37/44 → 32/37/46 →
32/38/46` a frame, between its resting `26/31/36` and its hover `34/40/49`; a newly active tab's underline
`42/64/87` on the way up and the old tab's `49/126/191` on the way down; `sky-hover.png` is three frames into a card's
fade.

**The drag: the pointer is the offset.** A press inside the feed grabs it (the feed's `onPress`, then the host's
`onPointer` on the same frame), and while the button is held the offset _is_ the press point's offset less the pointer's
own travel — `dragX = place(grabFrom - (y - grabY), max)` every frame, no track between them, so the drag lags by nothing
and follows the pointer 1:1 (measured: 2px a frame presents 2, 4, 6, 8, 10). Past an end the same `rubber` resists it as
the wheel's pull is resisted (a 153px drag up presents 116.84, the clamp's 78 plus the resistance's f(75)). The tick
writes the value and nothing else while the finger is down: no notch, no key and no band release retargets the track under
it. Travel past `DRAG_SLOP` (4px, in x or y) makes the press a **drag**, and the card under it is not clicked on the
release: the card's `onClick` is dropped while `held && dragMoved`. A press that never moved is a click, and selects as
before. The release hands the drag to the spring/decay: the **speed** is the offset's over the last `FLING_FRAMES` (5)
samples' span, and a span under `FLING_MIN` (1/120s) is one frame's jitter and no speed at all (Rune's rule: no
single-sample spikes) — no travel or no speed means no fling, the offset stops where the finger left it, clamped. A fling
projects `decay(dragX, v)`, runs the decay inside the content and springs to the clamp past an end; a release in the band
lets the band go on its own way back. Reduced motion still drags 1:1 (it is direct manipulation) and flings nothing: the
offset stops where the finger left it, clamped. `held` and `dragged` are the scroll's own (`dragged` is `held &&
dragMoved` when the release's click is decided, which is before the pointer's release call runs). Measured
(`solid/sky.test.ts`): a 10px drag in five frames is released at
11.48 (the release frame is the fling's own first frame), the next frame at 12.9, and it rests at 54.95 — the speed of the
last five samples projected; the same drag past 78 springs back to the clamp and rests on it. `main.ts --drag-feed
X,Y,DY,DY,...` scripts one headless.

**The List's viewport is the same machine** (`solid/src/vscroll.ts`: `scroll(id, max)`, which both pages build), not a
second implementation: the wheel's 10px and the flick's decay, the press's 1:1 grab with its 4px click threshold, the
band's `rubber` and its 80ms hold, `ui_scroll_put` while banded and `ui_scroll_to` otherwise, and reduced motion's hard
clamp are one body of code. What a page keeps is where its content ends and what its keys do. Sky's end is its content
(the cards' real block plus the feed's two 12px paddings); the List's is its whole block of rows — `count·28 + (count−1)·2`,
898px for the 30 rows in a 240px viewport, so 658 to scroll — and neither is the declared window's. Sky's
keys move the offset itself (Down/Up 40, Page a viewport, Home/End); the List's keys move the **selection** a row (Page
eight rows, Home/End the ends) and the page then asks the track for the least offset that shows the moved row — the
reveal. The reveal is measured from the row's _place in the content_ (`row.bounds - view.bounds - Clay's offset`) when
the window declared that row, and from the window's arithmetic (`i·(28 + 2)`) when it did not — the rows are fixed, so a
key can reveal one the window left out; it is compared with the track's **target** rather than what it presents, so a key
pressed while the track is still travelling still lands the row inside the viewport: with the row in view nothing moves.
A key also drops the band, as it does on Sky. The List's wheel is gated on `ui_pointer_over("list")` — Clay scrolled only
the container under the pointer, and a page that owns the offset has to keep that rule itself (Sky's feed takes a wheel
anywhere, as a phone feed would). The drag never touches the selection: it is the keyboard's (there is no per-row click).
Measured (`solid/list.test.ts`): one notch `2.59, 1.92, 1.42 …` px a frame to exactly 10; forty notches in one frame
step `103.44, 86.17, 78.69 …`, peak 103.44, rest on 658 after 40 frames; 4 notches past 658 present `678.15` (f(40) of
the 240px viewport), hold four frames and are back on 658; twelve Downs ease to 148 (the first reveal is 3.4px into its
28), PageDown to 388, End to 658, Home to 0, with the selected row inside the viewport after every settle. The stored
`list-wheel.png` and `list-select.png` are byte-identical: the run is `--wheel 32 --wheel-rest` (320, the notches' own)
and the keys get `--settle 90` (the scrollbar's fade needs the extra frames: see "The scrollbar" below), and a settled
frame is the same rows at the same offset, so the motion changed the frames between the ends, not the committed ones. The band's way back is the spring it is on Sky: 4 notches past 658 present
`678.15` and hold four frames, then `677.4, 675.6, 673.4, 671, 668.7, 666.7 …` and a dip a hundredth under the clamp
before it rests on 658.

**The scrollbar: a thumb the machine draws.** Both scrolling pages carry one (`solid/src/vscroll.ts`'s `thumbOf`, `BAR` of
the List and `sky-thumb` of the Sky): 4px wide, 2px in from the viewport's inner right edge, `max(24, view²/content)`
tall, with its top at `offset/(content-view)·(view-height)`, and nothing at all when the content fits (height 0, alpha 0).
`thumbOf(content, view, offset)` is a pure function, so the formula is checked without a frame. The page declares the thumb
as a **float on its viewport** — `css.float({ parent: "list" })` — which is the decision about the tree: Clay positions a
float from its parent's box and does not give it the clip's `childOffset`, so the thumb is a sibling of the scrolling
content, draws over the rows or the cards, and does not travel with them; it needs no clip of its own because it is
always inside the viewport's box. The machine writes it every frame through the value channel, five numbers: the height
(a FIXED axis is its min and max, fields 4 and 5), the float's offset y (39), the background's alpha (17) and the
pointer capture (43). The fade is a colour and an `effect(0.15)`: the thumb comes up on the frame the offset moves and
goes down `THUMB_HOLD` (600ms) after the last frame it moved — "moved" is the track's own settle, so a spring's tail
keeps it up, and a frame that moved at all, which under reduced motion is the jump itself. Reduced motion fades nothing:
the thumb is there on the frame the offset moves and gone 600ms later, at once. A press on the thumb (its `onPress`,
`scroll.thumb()`) grabs the offset _where it is_ — the thumb does not jump under the pointer, as a native scrollbar's
does — and while it holds it, `offset = grabFrom + (y - grabY)·max/(view - thumbHeight)`: the thumb's travel is the
offset's whole range, so 1:1 on the bar and `max/travel` on the content. It clamps at both ends (a scrollbar has no band)
and its release stops it (no fling; a scrollbar is not a throw). A press on an _invisible_ thumb is the page's, and a
press on a visible one is the bar's: the float's pointer capture is written with the fade (`CAPTURE` at alpha ≥ 128,
`PASSTHROUGH` below), so `Clay_SetPointerState` breaks at the thumb and the viewport (or the card under it) is not pressed
— a press on the bar therefore never starts a content drag and never clicks a card. That capture is one frame behind the
fade on purpose and stated: Clay's pointer test reads the previous frame's declaration, and one frame of a 0.15s fade is
not a press anyone can aim at. Measured (`solid/list.test.ts`: 898 of content in a 240 viewport, travel 175.86): the
thumb is `314,4x64.14` at the view's top, its top is `88.2` at 330 of the 658 and its bottom is the viewport's bottom at
658; a 10px drag on the thumb at that point moves the thumb 10px and the offset `37.4` (10·658/175.86), not the content's
1:1, and clamps on 658 and 0 past its travel; the fade's pixel is the row's own `36/40/52` at rest, `53/57/69`,
`82/86/99`, `105/111/124`… into the muted `150/155/170` (drawn as `149/154/169`), still there 40 frames into the hold and
gone by frame 64 of it (`131/137/151`, `103/108/122`… back to `36/40/52`). On the Sky (`solid/sky.test.ts`: Science's 742
in 664) the thumb is `354,4x594.2`, its travel 69.8, and it is height 0 on Discover, whose three posts fit. No stored
frame shows it: every settled frame is after the fade-out, so `--settle 60` became `--settle 90` where the frame follows
a scroll (`list-wheel`, `list-select`, `list-light`, `sky-scrolled`) and the pixels did not change — the frames were
compared, not re-stored. `sky-band` did not change either: it is Discover, and Discover has no bar.

**The horizontal axis, and a wide List.** The machine is one axis instantiated twice rather than a second
implementation: `scroll(id, max, bar, across?)` always builds the vertical axis, and with `across` (`{ max, bar }`, the
page's horizontal content end and thumb id) a second one from the same `axis()` closure — the wheel's accumulating
notches, the burst's fling, the `rubber` band and its 80ms hold, the drag's 4px click threshold, the fling's decay and
the thumb's fade are one body of code, and only the coordinate (`dx` for the notch, the pointer's x for a drag and a
thumb), the extent it reads (`ui.bounds`'s width or height) and what it writes (`ui_scroll_to`/`put`'s x or y, the
thumb's width and offset x or height and offset y) swap. The clock and the fade are the machine's, not an axis's: both
bars come up while _either_ axis moves and go down 600ms after both stop. `barOf(content, view, offset, reserve)` is
`thumbOf` with the reserve `thumbOf` never needs, and `thumbOf` is `barOf(…, 0)` — the same formula turned: the
horizontal thumb is 4px tall at the viewport's inner bottom edge (2px up, as the vertical one is 2px in from the right),
its width is `max(24, view²/content)` of the viewport's width, its left is `offset/(content−view)·(view−width)`, and it
is hidden (width 0, alpha 0) when the content fits. With both bars the machine takes 6px (the bar's 4 and its 2px inset)
off the vertical thumb's travel, so the vertical bar's bottom is the horizontal bar's top: they meet, they do not
overlap.

The wheel's x delta reaches the page as it always did (`ui_wheel_pop` has always carried both), and a **shift+vertical
wheel is a horizontal scroll**: `ui_window_poll` swaps the delta onto x when the wheel has none of its own and
`SDL_GetModState()` has shift, which is a browser's rule and costs one branch (a trackpad's two-finger swipe already
sends x, and it is left alone). Headless, `--wheel-x N` is N notches to the right: `ui.wheel(-1, 0)` a notch, the same
sign rule as `--wheel`'s `(0, -1)` a notch down (the machine's offset is positive down or right).

The page that has horizontal content is the **List's wide layout** (`bun solid/main.ts list --wide`, `List({ wide })`):
the same 240px viewport and the same 28px rows with a 2px gap — the vertical window, the clamps, the band and the keys
are untouched, because the widths are a layout matter — with rows **900px wide**. A row stays the same three cells and
adds two: the number, the name as a 150px cell, the note as a 320px cell with `overflow: hidden` (a clip element of its
own, so a long note is cut at the cell instead of widening the row), the temperature, and a second column of values
(`10 seats · 5 sockets · wing C`) past the viewport's 280px edge, which is what there is to scroll to. The horizontal
clamp is `900 − 280 = 620`. The wide layout is a **prop**: the default page's tree is the one it always declared, so
`list-top`, `list-wheel`, `list-select` and `list-light` are byte-identical, and `list-wide.png` is the new frame
(`--wide --wheel-x 12 --wheel-rest --settle 90`: 120px of the 620, the notches' own step, after the bar's fade-out).

Measured (`solid/list.test.ts`, the wide page: the viewport `40,101.5,280x240`, the content 900 of rows): one horizontal
notch glides `2.59, 1.92, 1.42 …` px a frame to exactly 10, the rows' left `40 → 30`; forty notches in one frame step
`103.44, 84.78, 75.47 …`, peak 103.44, and rest on the clamp `620` after 39 frames; the thumb is
`232.89,335.5 87.11x4` px at rest, its travel 192.89, its left `0` at the start, `102.67` at 330 of the 620 and `192.89`
(the viewport's right edge its right) at 620; a 10px drag on the bar is `3.21` px of offset a px (62.1 and 94.24 from
30 over travel 192.89), and the drag clamps on 620 and 0; both bars at once: the vertical thumb's travel is 169.86
(240 − 6 − 64.14) and its bottom at the end `335.5` is the horizontal thumb's top, so nothing overlaps, and a vertical
notch shows the horizontal bar too (one fade). Cost (`--bench 500`, headless, the same 360x400 frame): the wide page is
declare 0.022-0.027 ms a frame against the default's 0.018-0.022 and layout 0.022 against 0.018-0.019, and draw 1.34
against 0.56 — the draw is the wide rows' own glyphs (a long note and a second column on nine rows), not the axis: one
more axis on the same tick is a few arithmetic branches, and its bar is five more numbers a frame through the value
channel (its length, its start, the alpha and the capture). The default pages write one extra call a frame
(`ui_scroll_to_x(id, 0)`, so a clip element's x does not survive a page with the same id in one process); their stored
frames are unchanged (66 comparisons, `test.sh`).

**The window: a page declares what the screen shows.** `solid/src/virtual.ts` is what makes a list of thousands cost
what the screen shows: it returns `{ first, last, above, below, content }` — the indexes to declare, the two spacer
heights, and the _real_ content height — and both pages declare a spacer box, the items, a spacer box, inside the same
clip element and gap-spaced column. Two shapes, one function each. `fixedWindow` is arithmetic (`List`: every row 28px and
the column's 2px gap, so row `i` starts at `i·30`). `measuredWindow` is for the Sky's cards, whose heights differ: a cache
by index, filled from `ui.bounds` of each declared card after the frame (the page's tick reads the last layout's card
heights before declaring the next). It **measures once, then virtualizes**: while any card's height is unknown the window
is the whole column (`first` 0, `last` count−1, no spacers), so a feed of 200 declares 200 cards on the frame it mounts,
measures every one of them on the frame after, and has exact heights from then on. The mean of the measured heights
(190px until anything is measured) is only the estimate the measuring frames give the content, the clamp and the thumb —
never a place a card is _measured_ at — so the content's end does not move when a card is first seen. `List` takes a
`count` (30 by default; 1,000 is the window's own page, `bun solid/main.ts list --count 1000`), `Sky` a `posts` feed (its
Discover fixtures by default; 200 synthetic posts are `--posts 200`, or `synthetic(200)` in `solid/virtual.test.ts`).

The spacers take their own gap out of the column (`above = first·slot − gap`), and there is **no** spacer at an end: an
empty box would still add its gap. So the declared items sit exactly where the whole page would have put them
(`virtual.test.ts` checks row 33 at 990px, the last row's bottom on the viewport's, and the gaps of 8 between cards), and
the declared block is the whole content: 1,000 rows are 29,998px whether nine or eleven of them are declared. The spacer
height is not a style (`css.height` is a build-time literal): the boxes carry the last two numbers of a FIXED axis through
the value channel, fields 4 and 5, as the scrollbar's thumb writes its own. The window is one `For` over the spacer cells
and the items' indexes (a `Show` either side would be put _after_ the `For`'s items by Solid's renderer); the Sky's cell
is `${feed}:${index}`, so a tab switch gives each card a node created in its own child order.

**A list's selection is a range of its own.** The wheel moves the content and leaves the selection where it was, so the
selected row can be outside the window; it is declared all the same, because its box is what the reveal reads, its fill
and ring are what the user sees when a key brings it back, and a11y wants a node. `segments(w, { count, slot, gap, extra })`
is the column the `List` lays out: the window's rows, the extra index when it is outside the window, and a spacer for
everything not declared — `SPACER.above`, then the row, then `SPACER.middle` (the items between it and the window), then
the window's rows, then `SPACER.middle` and the row when the extra one is below, then `SPACER.below` — each spacer taking
its gap out as the window's do, and none of them when the two ranges are adjacent (a zero-height box would add its gap).
Three sentinels, three FIXED-axis heights (fields 4 and 5) of three boxes, `list-above`, `list-mid`, `list-below`. The
order follows the indexes, so every declared row is where the whole list would have put it: at 1,000px down with the
selection still row 1 the column is 12 rows and 3 spacers instead of 11 rows and 2, the window's rows (32..42) have not
moved, and the content is still 29,998px; `frames/list-wheel.png` (row 1 selected, 320px down) is **byte-identical** with
the extra range in the tree, because the clip cuts its box 292px above the viewport and nothing else changed. The Sky has
no selection, so it does not use it (its cells are strings, `${feed}:${index}`).

**The clamp and the thumb are the real content's.** `maxScroll` is `content − view` from the window's `content` (the Sky
adds its two 12px paddings), never the declared subset's, so the ends, the band's f(x) and the thumb's
`max(24, view²/content)` are the same as when every row and card was declared; `thumbOf` writes the bar from `max + view`,
which is that content. The Sky's content is the mean's estimate only while the measuring pass runs: a track that was at the
end follows it if it moves during those frames (when the content's end grows and the target was the old end, the page
seeks the new one; a shrink is the scroll's own hard clamp), and from the pass's last frame it is exact, so no later frame
moves it. The List's reveal reads the selected row's **bounds** — the selection is declared even when the wheel has left it
behind, so there is a box to read — and falls back to the window's arithmetic (`i·(row + gap)`) on the key's own frame,
when the selection has just moved to a row the last frame did not declare; the two agree to the pixel. The Sky's keys
move the offset, so no card is revealed. `ponytail:` `measuredWindow` builds a
prefix sum over the cache on every call (O(n) a frame, n the feed's posts); a persistent prefix or a binary search over a
running total is the upgrade if hundreds of thousands of items ever matter.

Cost, the same machine and `--png … --bench 500` (declare = the JS walk, the FFI and Clay's declaration and text
measure), before (the pages of `05e32400`, every row and card declared) and after: **List** 30 rows
0.086 → 0.032ms, 1,000 rows 2.084 → **0.030ms**; **Sky** 3 cards 0.022 → 0.028ms (its frame's own noise), 200 cards
0.683 → **0.042ms**. The declaration follows the window (nine rows at the top, eleven 1,000px down; six cards of the 200
at the top), not the data. `solid/virtual.test.ts` prints the same numbers from the frame stats (`stats[1]`) and holds the
1,000-row declare within a small factor of the 30-row page's. The stored frames of both pages are **byte-identical**: with
30 rows the window declares nine of them instead of 30 and a spacer for the rest, and the pixels do not move.

The measuring pass is the one frame that is _not_ the window: 200 cards declared in one frame cost **0.85ms** of declare
(the suite's own `stats[1]`; medians of five mounts on the same machine 1.07ms) against 0.024ms a frame once the window is
back, and 1,000 cards 4.9ms. The rule: the pass is one frame while the column fits Clay — about 1,000 cards here (2,000
declared boxes already overflow this build's default element/ID capacity, `CLAY_ERROR_TYPE_HASH_MAP_CAPACITY_EXCEEDED`,
before any of it is drawn). A page with thousands of cards would therefore need both Clay's element count raised and the
pass in chunks over idle frames, with the content's end estimated until the last chunk; no page here has more than a feed
of hundreds, so there is no chunking (`virtual.ts` keeps the note). The pass costs one frame of a page's life and buys a
content height that never moves.

**Touch input: one pointer, mouse or finger.** SDL3 reports a finger as `SDL_EVENT_FINGER_DOWN/MOTION/UP` (and
`CANCELED`) with `event.tfinger.x/y` **normalised to the window** — 0..1, (0,0) the top left, not clamped, so a touch in
the letterbox lands outside every box. `ui.c` maps them through one function, `ui_touch_map(fx, fy, out)`
(`x = fx·width`, `y = fy·height` in the layout's pixels, the same space the mouse path writes after
`SDL_ConvertEventToRenderCoordinates`), into the _same_ pointer state the pages already read: down while the finger is on
the window, up at the place it left. One finger owns the pointer — the first `FINGER_DOWN`'s `fingerID`; a second finger
is **ignored** until that one lifts, because a page here has one pointer and no pinch or two-finger gesture reads the
second (`CANCELED` is a lift). The mouse path is unchanged, and a mouse event clears the flag. The poll's array grew a
sixth slot, `out[5]`: 1 when the last pointer event was a finger's, 0 for the mouse; `main.ts` hands it to the frame,
`View.onPointer(x, y, down, touch)`, and on to `scroll.pointer(x, y, down, touch)`, which uses it for one thing: a
**touch drag has no 4px click threshold** (a finger has no mouse's precision, so any travel starts the drag,
`dragSlop = 0`), while a touch press that **never moved** travels 0 and is still a click — the Sky's card still selects.
The mapping and the flag are covered without a touchscreen: `bun solid/main.ts --touch FX FY` goes through the same
`ui_touch_map` and marks its frames as a finger's, so `--touch 0.5 0.5` is the frame of `--click 180 380` (the Sky's
second card selected) and `sh solid/test.sh` compares the two; `solid/sky.test.ts` runs a finger's 2px drag (not a card
click) against the mouse's (a click) and a finger's tap (a click). **Not verified: there is no touchscreen on this
machine.** No finger has touched this code: what is tested is the mapping, the flag's path through the host, and the
pages' two behaviours under it.

**The thread screen: the page's second screen.** A card press records the selection and opens that post's thread — the
bar (the wordmark and the three tabs) stays where it is, and the feed stays declared underneath, so its clip's offset and
its selected card are the feed's own and are not written while the thread is up. The screen is a **root float over the
content area** (`THREAD_H` 696 = the window's 760 less the bar's 64, at `zIndex` 2, capturing the pointer), with a 44px
header (the back control and the word "Thread") above its own clip element. The data is the app's recorded thread
(`apps/csssky/test/fixtures/thread.json`) as the page's own `Post` literals, the six-field records the feed draws: the
root is the clicked post with its own counts, and the replies are the fixture's tree — `jlp2024.bsky.social` at depth 1,
a tombstone at 2, `Katie Korth` at 2, `Mdubs949` at 3 and the row a cut branch ends in at 4 — cut at the app's
`MAX_DEPTH` (3) by the page's `cut`, which is `apps/csssky-tui`'s `rowsOf` transcribed (its rows are the API's
`ThreadNode` over `PostView`, and this page's records are not): a post row, a tombstone row, and a branch at the limit
ending in a `moreLabel`-worded row that opens that post's own thread (`moreLabel`, `goneText` and `MAX_DEPTH` are
imported from `apps/csssky/src/thread/model.ts` — the same strings, not copies). A row is a full-width wrapper whose
**left padding is the depth's indent, 16px a level** (the app's margin-left), so the card inside keeps a percent width
and wraps its body as the feed's does: measured, the cards start at x 12 (the root), 28, 44, 44, 60 and 76. The root is
the app's focused post — the accent border, `cardOn` — and the replies are the same card without the avatar.

The screen scrolls on the page's own machine (`src/vscroll.ts`, a second instance, one per opening, so a thread always
starts at its top): 900px of rows in the clip's 652 (the window less the bar and the header), so 248 to scroll; its thumb
is `max(24, 652²/900)` = 472.34 tall with 179.66 of travel, 4px 2px in from the clip's right edge, and it fades as the
feed's does. Two Tab stops: the back control (a `createButton` part, role `button`, label "Back", Enter and Space) and
the clip (Down/Up 40px, PageDown/PageUp a viewport, Home/End on the same track); the cards are not stops. Escape (from
either stop, and as the page's last resort from the bar) and a click on a tab return to the feed — the tab's click also
switches it — while the **history is one deep**: a thread opened from a "Show N more replies" row returns to the thread it
came from, and a card's returns to the feed. The a11y tree: the screen is a `region` named `Thread — @<handle>`, the root
and each reply are `article`s named by their author, the tombstone a `note`, the more row a `button`; the covered feed is
`hidden` while the screen is mounted.

The screen enters as **one group** and leaves the same way: 12px low and at 0 opacity → its box, on the page's card
entry's tracks (`TRANSLATE_Y` on `spatial(0.3)`, `ALPHA` on `effect(0.3)`), with `presence(0.3)` keeping the node mounted
for the exit and passing the press through while it closes; the layout never moves (a group is a renderer scene).
Reduced motion has neither: the first frame is the settled screen and the exit is the falling edge. Numbers
(`solid/thread.test.ts`): the feed's frame after back is byte-identical to the one the click left (0 bytes of
1,094,400) with its offset and its selected card, a "Show N more" row's thread returns to its parent's frame, the entry's
first frame draws none of the screen and the next two are a blend, and reduced motion's first frame is the stored one.
Five stored frames: `sky-thread.png` (settled), `sky-thread-mid.png` (two frames into the entry), `sky-thread-scrolled.png`
(six notches with a rest frame between them), `sky-thread-light.png`, and `sky-thread-more.png` (the deeper thread a
"Show 1 more reply" row opens — that row is only in view at the thread's end, so `main.ts` takes a second headless click
after the settle, `--click2`/`--settle2`). The eight frames of the feed (Discover, Science, the light theme, a scroll, the
entry, a hover, the band and a tab mid-fade) are byte-identical to before the screen existed.

Not here: fetching a real thread from the AppView (the page has the one recorded fixture, for whichever card is
pressed), a reply's own thread beyond the one branch the data holds, and the settings screen.

**The thread's data is the AppView's, through one injectable loader.** This replaces the transcription above (that
paragraph's rows and its "not here" line): a card's press now asks the page's `load(uri)` — a post's at-uri in (the
`Post` literals carry the fixture records' own uris), its `ThreadScreen` out — and the screen opens in its **loading
state** before the answer lands. The default loader is the call `apps/csssky/src/api.ts` makes, written out in
`solid/app/Sky.tsx`: `GET https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=<at-uri>&depth=6&parentHeight=20`,
with `AbortSignal.timeout(8000)` and **no retry** (a thread is a screen the reader asked for, and the error state's Retry
row is the retry); a non-2xx is that error state too. The body's `thread` goes through the page's `screenOf`, the app's
shaping of it: the parent chain from the nearest outward, and `nodeOf` — a `threadViewPost` as the API's `ThreadNode` with
its replies sorted by the app's own `topFirst`, a `blockedPost`/`notFoundPost` as a tombstone. The page's rows are then
the app's, not a copy: `rowsOf` from `apps/csssky-tui/src/model.ts` (`MAX_DEPTH` 3, the cut's `moreLabel`, `goneText`),
and each `PostView` becomes the card in one function, `postOf` — display name, handle, the record's text and
`createdAt`, the counts, and the media as the terminal's line (`mediaText` over `embedParts(p).media`, so Mina's link is
`[link: Want to Get Off Your Phone? … - wired.com]`); an empty body draws no text at all (the fixture has a post whose
record is empty, and an empty `ui_text` is not a box). The import is the terminal's precedent, and it costs ~50 ms of
Bun's startup (`time bun -e 'await import("./apps/csssky-tui/src/model.ts")'`), not a frame.

**Three states.** A press mounts the screen on its entry exactly as before, and what it draws is the loader's:
**loading** — the header and one muted row, the tombstone card's own style, 336x44 at 12,120, "Loading the thread…";
**answer** — `rowsOf`'s rows (post rows at their depth, a tombstone's words as a `note`, a "Show N more replies" row at
the cut as the `button` that opens that post's own thread); **error** — "The thread could not be loaded" in the same card
and a **Retry** row under it (336x36, the more row's style), which asks the loader again for the same uri. A late answer
never lands on a screen a back, a tab or a second press replaced (an ask counter, `ask`), and a press on a card whose
record has no uri does nothing. **The honest failure path is the error state, not a fallback**: the fixture is not
offered as if it were the answer to a request that failed — it would read as a real thread — so the offline path is the
error state and its retry, and the recording is used only where nothing is asking: `--offline` (`solid/src/skyload.ts`),
and every headless run, so **a stored frame never touches a network** (`--png`/`--expect` are offline whether or not
the flag is given). `--pending` is a loader whose promise never settles (the loading state's stored frame) and `--fail`
one that throws (the error's).

**What the recording makes of it, and the frames that moved.** The recorded answer is Mina Kimes' _reply by Bluesky_:
`thread.json` has a parent. So the screen is ten rows — Mina Kimes (the parent, 280 tall: her body's paragraphs and her
link line), Bluesky (the root, 136, the accent border), then the app's sorted replies: Mina again (226 likes), Mdubs949
(4) with Ryan at depth 2, then jlp2024, Davide Aversa, Katie Korth, Juanita and rmar124 — 1758px of rows in the clip's
652 (1106 to scroll, the thumb 241.81 tall). That is **not** the old transcription, and the stored frames were re-stored
deliberately: the root was Titania's card (the click's own post; offline the recording answers for whichever card is
pressed, as the terminal's frame does), the old tombstone and its "Show 1 more reply" row are rows the recording does not
contain, and the four transcribed replies are the recording's middle **unsorted** (the page now shows the app's order, so
Mina's 226-like reply is first). Five frames, re-stored: `sky-thread.png`, `sky-thread-mid.png` (two frames into the
entry), `sky-thread-scrolled.png` (six notches), `sky-thread-light.png`, and `sky-thread-more.png` — that one is now
twenty notches down (the flick settles at 508 of the 1106; the second click lands on a post's card, since the recording
has no branch to cut), and the more row's own frame is the test's screen, built from the same posts. Two new frames: `sky-thread-loading.png`,
`sky-thread-error.png`. `solid/thread.test.ts` injects the loader everywhere (a promise per ask, settled by the test):
the loading row and its frame, the answer's rows and indents (12, 12, 28, 28, 44, 28…), the error and its retry (the
second ask for the same uri), a tombstone and the cut's more row from a screen built of the recorded posts (its press
asks for the cut post's uri; back restores the parent without a third ask), a pending answer a back overtook, the
scroll's numbers, back's byte-identical frame, the a11y tree of all three states, and the mutations — an at-once loader
never draws the loading row, and a reject after a loaded thread shows the error's two rows, not the thread that was up.
The frames of the feed are untouched.

**The wide form: the thread beside the feed.** The page reads its own width from the last layout (`ui.bounds("Root")`) and
at 720px (`WIDE_AT`) declares the thread as a **second 360px column** instead of a root float over the content area: the
page's 720x760 is the feed's pane and the thread's, each with its own clip and its own offset. The feed's pane is an
element of its own — `sky-feed-pane`, the bar, the feed and its status line in a page-coloured column — and the thread is
`sky-thread`, 360 wide and the page's own height (its 44px header and its 716px clip). A card's press opens the thread
beside the feed, not over it: both panes stay declared, so the feed keeps its clip's offset and its selected card (measured
in `solid/sky-wide.test.ts`: 78px and the card in the same box before and after the open, and the card still under the
pointer) and the thread's ten rows are the right column's, 12px into its clip at x 372. Below 720 — 719 is measured, the
frame before the turn — the screen is the float it always was: 0,64 360x696 over the feed, its clip 652, the rows at x 12,
and the covered feed pruned from the a11y tree. The pane draws the page's own colour and nothing else, so the narrow page's
stored frames are byte-identical and the command golden `solid/goldens/sky.json` gained that one rectangle.

Still not here: replies below `depth` 6 and a parent chain longer than 20 (the query's caps), paging a thread's replies
with a cursor (`getPostThread`'s `parentHeight` and `depth` are the whole request here), a cache (every press asks
again, and back restores the screen it came from without asking), the moderation `apps/csssky/src/api.ts` applies to a
logged-out viewer (this page shapes a `hidden`/labelled post as a post — it has no labeler), and a real service's auth
(the public AppView, no login).

**The profile screen.** A card's author — the **name-and-handle row**, which is the app's own affordance, an
`<a href="/profile/<handle>">` on the name (`apps/csssky/src/post/Post.tsx`) — is a press of its own, while the avatar and
the rest of the card still open the post's thread; a thread's cards' authors open it too (the app's card is the same card
there). The screen is the page's **third**, built like the thread's: a root float over the content area under the same bar
(the thread's own style, so z 2 and the same 696, declared after it and so drawn over it), a 44px header with the back
control and the word "Profile", and its own clip element on the page's own scroll machine (a third instance). The history
is **one deep**: a profile opened from a card's author returns to the feed — its frame byte-identical (0 bytes of
1,094,400) — and one opened from a thread's card returns to that thread, whose rows and own offset stay untouched under
the profile (the thread's data is not re-asked). The header is the app's recorded profile
(`apps/csssky/test/fixtures/profile-head.json`) through `solid/app/profile.ts`'s `profileOf`, one mapper like `postOf`: the
drawn 56px disc (the recording's author, bsky.app, has no committed PNG, so it is the app's fallback tile and not an
image), the display name, `@handle`, the bio wrapped (`whiteSpace("normal")` in a stretch box) and the counts in the app's
words (`apps/csssky/src/post/model.ts`'s `count` with the profile's `|| "0"`), so `35M followers · 15 following · 865
posts`. Below it the app's three tabs (`TABS` of `apps/csssky/src/profile/model.ts`: **Posts, Replies, Media**) as a
headless tablist like the bar's — one Tab stop, arrows and Home/End move and switch, the 2px underline — and each tab is
its fixture's cards (11, 10 and 13; the Media tab's every card carries its `[image: …]` / `[video]` / `[link: …]` line),
the same card the feed draws. The header and the tablist stay put while the list scrolls under them, and the machine is
**fresh per tab**, so a switch starts the list at its top, never at the old tab's offset. The screen enters and leaves as
one group on the card entry's tracks (`presence(0.3)`), so reduced motion has neither, and its a11y tree is a `region`
named `Profile — @handle` over a `button` "Back", the tablist and one `article` per card named by its author, with the
feed (and a thread under it) pruned.

The data is the app's recordings, read at run time with `readFileSync` from `apps/csssky/test/fixtures/` (the head and the
three author feeds) the way `apps/csssky-tui` reads its models — ~140 KB of JSON, so not transcribed — once, on the first
opening. **No fetch**: the thread's loader is the page's only network path and this screen does not use it. Four stored
frames: `sky-profile.png` (the settled screen), `sky-profile-mid.png` (two frames into the entry), `sky-profile-media.png`
(a second headless click on the Media tab, so its cards and their media lines are up) and `sky-profile-light.png`. Numbers
(`solid/profile.test.ts`): the header 44, the head 166, the tablist 35.58 and the list's clip 450.43; the Posts list's
2652 of content in that clip, the thumb `max(24, 450.43²/2652)` = 51.16, one notch 10, End 2201.57; back's 0 bytes of
1,094,400.

Not here: a fetch of a profile (one recording, shown for whichever author is pressed — the header's fields are that
recording's), a follow button, the app's paging (each tab is its one recorded page; no cursor and no Sentinel), and a
card of the profile's list opening its own post's thread.

**The notifications screen: the page's fourth.** `n` on the feed opens it — the app's nav has no notifications item and
its bar is the three feed tabs, so the key is the page's, as the C shell's `n` is — and `bun solid/main.ts notify` starts
the page on it (its `screen` prop). It is the page's one screen the app has no source for: apps/csssky has no
`notifications/`, no route and no `listNotifications` fixture, so `solid/app/notify.ts` **hand-carries** the five kinds —
the app's own verbs, `mentioned you`, `reposted`, `liked your post`, `replied` and `followed you` — over the recordings'
actors, posts and times: `home-science-1`'s [11] (Erik Strub), `home-discover-1`'s [23] and [20] (Titania, Michael
Warburton), `thread.json`'s first reply (jlp2024.bsky.social) and its parent (Mina Kimes, whose follow has no post, so no
snippet and no at-uri). The three recordings are JSON modules (`with { type: "json" }`, ~166 KB) in the page's build
rather than a run-time read, because the browser's own Sky bundle carries the screen too; a row is mapped from them on
the first opening, with the page's `postOf`, so its actor, text and time are what a card would draw. A card is the feed's
(`s.card`): the actor and the verb with the time on one line, the post's first line under them, and the focused row in
`s.cardOn` — the next panel tone and the accent border, which is the C page's ring. The C page's kind glyphs (`✦ ⟲ ♥ ↩`)
are not here: Roboto carries none of them (a cell prints them only because the terminal's font does). The rows are the
page's first **row stops** (`input.add` each, the ring through its `focused` prop): the arrows, j/k and Home/End rove
them without leaving the list, Tab walks them in document order and past the last row wraps to the first (the manager
releases the focus there, and a terminal has nowhere to hand Tab to). Enter or Space opens the row's post through the
page's own `openThread` and `load` — the recorded thread in an offline frame, the AppView's in the window — so a
notification's thread is a card's thread, drawn over the list (both floats at z 2, the thread declared after it), and
that thread's Escape returns to the row it left: the list's frame, the same bytes. A follow opens nothing. Numbers
(`solid/notify.test.ts`, `frames/notify-initial.png`): the screen 696 under the bar, the head 44, the clip 652, the five
cards 94, 74, 74, 114 and 46 (458 of content, so the list fits and its machine never leaves 0, its thumb 0 tall); the
frame's ms (`solid/main.ts notify --png --bench 200`): **events+flush 0.19, declare 0.16, layout 0.06, draw 13.6** (the
360x760 ThorVG raster is 13.6 of it); back from a row's thread 0 bytes of 1,094,400.

**The settings screen: the page's third.** A gear at the bar's right end opens it — the app's own Settings nav item, its
glyph three 16x2 boxes (Roboto has no gear glyph and Clay has no icons) in a 40x28 box that ends at the bar's content
edge — and the screen is built like the thread's: a root float over the content area one z above the thread's, so it
opens over a thread as well; a 44px header with the back control and "Settings"; its own clip element on a third
instance of the page's scroll machine (the three rows fit the 652, so it never scrolls and its thumb stays out); the same
group entry (12px low and 0 opacity on `spatial(0.3)`/`effect(0.3)`, `presence(0.3)` for the exit, and reduced motion
neither); and Escape, the back control or a click on a tab returning to what was up — the feed, or the thread the screen
was opened from. Its five stops (the back control, the theme group, the switch, the size group and the clip) are the
page's Tab stops while it is up and disabled while it is down, the covered screen's stops are disabled under it, and the focus its opening
pushed comes back on the way out, so the frame under it is byte-identical (measured: the thread's back control has its
ring again, 0 bytes of 1,094,400).

Its three rows are controls that change the page, not a drawing of one. **Theme** is a radio group, Dark and Light: every
style's variant is picked by the _frame's_ theme, so the pick is written back to the host (`Sky`'s `setTheme` prop —
main.ts's own `theme` variable, which its frame's `theme` getter reads and its `t` key flips) and the whole palette
follows, the page's own fades with it (they read the same signal): measured, the bar's ground and the screen's `16/19/22`
→ `243/245/247` and a row's panel `27/32/38` → `255/255/255`. **Reduced motion** is a `createSwitch` that calls
`setReducedMotion`, starting on the platform's flag (`--reduced-motion`), so afterwards every retarget lands at once:
measured, the frame after a card's click is the settled thread (0 bytes of the 20-frame one), where without it the same
frame differs by 672,965. **Text size** is a second radio group, Regular and Large: the page's styles are literals and a
Clay text carries its `fontSize` and `lineHeight` as numbers, so no token can carry them — the feed card's five text
styles have a Large variant each, two steps up (16/22 → 18/24, 12/16 → 13/18, 14/20 → 16/22, 13/18 → 15/20 twice), built
in `app/Settings.tsx` from the page's own tokens (the palette is `app/Sky.styles.ts`'s now, shared by the two screens).
The card grows 190 → 222 and its body's one 20px line is two 22px ones; the feed re-measures (the page drops its height
cache on the frame the size changed), so Science's 742px of content is 830, its thumb 594.2 is 531.2 and its end 78 is
166; back at Regular the card and the feed's whole frame are byte-identical to before. The thread's cards keep Regular.

The values are the page's while it runs — signals and `motion.ts`'s flag, no storage read or written — so a window starts
from `THEME=light` or the dark palette, from the platform's motion flag and at Regular. Not here: the app's full
appearance set (the accent hue's slider, the corners, the fonts — `apps/csssky/src/settings.ts`), which this page's tokens
have no handles for, and a persisted choice. Four frames (`solid/settings.test.ts`): `sky-settings`, `sky-settings-mid`
(two frames into the entry), `sky-settings-light` (Light picked, the ring on it) and `sky-settings-large`. The fifteen Sky
frames that show the bar were re-stored deliberately: the gear draws 96 pixels in a 16x12 box at 315,26 (its three
bar-glyph rows) and nothing else in any of them moved, measured pixel for pixel against the previous files; the command
golden (`solid/goldens/sky.json`) gained those three rectangles and the one a11y node.

**A page's entry, once.** The four plain pages — List, Widgets, Sensors, Text field — get the same first mount from one
helper (`solid/src/entry.ts`): the root element's subtree (its id is `Root` on all four) starts 8px low and at alpha 0 and
settles on its literals over `spatial(0.25, 0)` for `TRANSLATE_Y` and `effect(0.25)` for `ALPHA` — the group fields, so
no box moves and `ui.bounds` is the settled one on every frame — and then the tick writes nothing at all, so a page at
rest is the frame its literals make. The clock is the host's tick, so a headless frame and a window frame take one path.
The settle is ~21 frames (a spring's duration is not its settle time), so the stored frames of those pages are taken after
`--warm 30` and are byte-identical to the frames before the entry existed. Reduced motion has no entry: the first frame
is the settled one. `frames/list-entry.png` is four frames in (t = 3/60): the page is `5/6/8` of its `16/18/24` and the
selected row `12/14/18` of its `36/40/52`, still lighter than the page around it; `solid/list.test.ts` checks the blend,
the literals at rest and that the layout never moved.

The Dialog page is the value channel's first user, and it animates the two overlays of `headless/`. Both end on the
style's own literal, so a settled frame is the literal's frame: the **menu** slides out of its trigger — its float's
offset y from -10 to its style's -20 on `spatial(0.22, 0.1)`, and its shadow's blur from 0 to its style's 14 on
`effect(0.22)`, which is clamped and critically damped because a blur has no negative side and must not ring; the
**dialog** drops in — offset y from -14 to 0 and its shadow's blur 0 to 32, the same two tracks. Both use the `effect`
class for the blur and `spatial` for the offset for the same reason: position may carry a little velocity, a luminance
field may not. The pair that reads best in a frame is the offset with the blur at once: the menu grows out of the
trigger (it starts 10px lower, over the 20px it overlaps) while its shadow appears under it, so by the third frame
(2/60s in) the menu is 7.4px low with a shadow at a quarter of its blur — legible as "arriving" rather than as a jump;
the blur alone would look like a fade and the offset alone like a slide with no depth. The group is the third layer of
the same arrival and the one that reaches the panel's text: alpha 225 → 255 and scale 96% → 100% (`dialog-entry-mid` is
three frames in: 119 of 255 and 97.8%), so the panel is translucent and a shade small while it drops, and its own text
fades with its fill instead of standing at full ink over a ghost of a box.

The clocks are the page's and run only while the node is mounted: a fresh arrival starts at the entry values, and every
later frame is one dt after the one before it — through the exit too — so a reopen mid-exit presents the value the exit
would have shown next (measured: leaving at -19.03, reopened at -17.18, which is the exit's own next frame), no jump and
no restart. When the presence's exit ends the node leaves the tree and the clock stops with it; the next open starts
from the entry again.

**Presence: a node that leaves stays.** `Show` no longer follows the open state. The page keeps a signal per overlay
(`menuShown`, `dialogShown`) that its tick sets from `presence(when, exit)` (`src/motion.ts`): `update(open, dt)` returns
`{ mounted, closing }` — on the falling edge the node stays mounted and `closing` is true, that frame being the exit's
first (the page retargets there, so it is drawn at the offset the exit starts from); after `exit` seconds (0.35 for the
Dialog) it returns `mounted: false` and `Show` drops the node. `when` true again during the exit revives it: `closing`
goes false and the tracks retarget from what they present, so the reopen frame is the value the exit's own next frame
would have had — no jump and no restart. The page's clock keeps running for as long as the node is mounted, which is
what makes both true. A page's tick is one call an element now: `channel(write)` (`motion.ts`) wraps `ui.value` and
writes an element's fields together (`write(id, t, [field, track], …)`).

The exit runs the arrival tracks the other way. The **panel**'s offset y 0 → 14 on `spatial(0.2, 0)` (an exit must not
bounce past where it came from) and its shadow's blur 32 → 0 on `effect(0.2)`; the **backdrop**'s background alpha 140 →
0 on `effect(0.2)` — field 17 of the rgba, and since the backdrop's box is the whole window, its alpha _is_ the dim (the
0.55 of `rgb(0 0 0 / 0.55)` packs as 140); the **menu**'s offset y -20 → -10 and its blur 14 → 0. The presence's 0.35s
is longer than the tracks take to settle exactly (~0.333 for the 32px blur), so the last frame an exiting node is on
screen is the literal's. Both overlays also leave as a group (alpha 255 → 0, scale 100% → 96%, the section on group
opacity and scale). Measured (`solid/dialog.test.ts`, `ui.bounds` and the pixels per frame): the panel's y
`163.88, 165.24, 167.82, 170.39, 172.54, 174.18 … 177.88` (its rest 163.88, the exit 14 below), the reddest title pixel
behind the backdrop `103, 115, 139, 162, 181, 196, 206, 214, 219, 222, 225, 227, 228, 228, 230` from the dim to the page,
the menu's offset `-20.00, -19.03, -17.18, -15.34, -13.81, -12.64, -11.79, -11.19, -10.79, -10.51, -10.33` with its
shadow lightening 13.9 → 18.0 (the page). After the exit both the panel and the backdrop are out of the layout and the
page's own pixels are back (0 pixels differ from the frame before opening).

**The trap is the open state's timing, not the node's.** `input.modal` asks `dialog.open()`, so it is released on the
frame the dialog closes: a Tab right after Escape reaches the page's own next stop (the Zoom trigger) while the panel is
still fading, and Enter on it reopens the dialog mid-exit (which is the revive above). The pointer follows the same
rule: a `closing` overlay writes `FIELDS.CAPTURE` 1 (passthrough) for the length of its exit, so a press goes through
it to the page instead of hitting a node on its way out.

**Reduced motion** is a module flag (`setReducedMotion`, `reduced` in `motion.ts`), read once by `solid/main.ts` from
`--reduced-motion` or `REDUCED_MOTION=1`, so a headless frame and the window take the same path. With it on, a retarget
lands on its target with v = 0 (settled in the same call) and a `presence` mounts or unmounts on the frame it changes,
so opening is the literal's frame in one frame and closing has no frame with the panel in it; the pages carry no branch
of their own. The dialog test checks it against the settled frame pixel for pixel, and `test.sh` runs the page with the
flag against `frames/dialog-open.png`. On the Sky page the same flag means no stagger and no wait (the cards start on
their boxes) and no rubber band (the wheel is clamped hard); its hovers are instant too, because a fade is a retarget and
a retarget under reduced motion lands at once — the sky test checks all three against the settled frames.

Not here: a transform on a _non-float_ element's own siblings (a group is a whole-subtree opacity, a scale, a rotation
and a visual offset — one scene; a rotation is there, and a _gradient or clip inside_ a rotated group is drawn with it and
stippled on its quad, the clip cutting the dither by its own quad too), a group deeper than four levels or a fifth
open at
once, a group whose subtree is cut in two by a _second_
backdrop's cut in the same frame (one cut a frame), **a text without an id** (a text's colour moves through the channel
only when it is named: an anonymous text is its style's literal, which is the ceiling of the fix, and nothing else of a
text's 10 floats moves), touch hardware (the drag is the window's mouse; a phone's touch events are the host's
next step), a second gradient on one element (a card cross-fades two by fading one over its solid fill), and the terminal,
browser and board targets (they have no Solid page, no wheel and no value channel).

## Idle: a frame's hash, and a draw only when it changes

Rune's rule for the shell: a static page ticks at zero, and a discrete input draws at once. The host can tell because
`ui_end` hashes the frame it has just laid out. `uint64_t ui_hash()` is FNV-1a over what a draw reads — every command's
type, element id, box, colours, corner radii and border widths, a text's bytes with its colour, font id, size, spacing
and line height, an image's pointer, a clip's axes, a custom's pointer — and over the renderer's tables beside the
commands: a shadow's offset, blur and colour, a backdrop's blur, a gradient's angle, stops and alpha, a group's alpha,
scale, translate and rotation (a group at alpha 255, scale 1, no offset and no rotation is skipped, because it draws
what it would have drawn
without one). Padding, `userData` and `zIndex` are not hashed: they do not reach the pixels. A settled frame hashes the
same value frame after frame; `ui_draws()` and `ui_presents()` count the calls, for a test.

`solid/main.ts` takes the shape Rune asks for: poll (`ui_window_poll`), then keys, typed text, the pointer and the
wheel; **declare and lay out every iteration** (a page's tick reads and writes values there, so a timer or a track
animates); hash; and draw and present only when the hash changed or the iteration carried a _discrete_ input — a key,
typed text, a press or release, a wheel notch. A pointer move is not discrete: it draws through the hash, so a move that
starts a hover draws and a move inside a hover that has settled draws nothing. Nothing drawn means `await Bun.sleep(16)`
at the end of the iteration; a drawn frame does not sleep, and an input's frame is never behind one (the poll is the
first thing an iteration does). The decision is `createDrawer(frame, stats)` in `solid/src/frame.ts`: it runs
`frame(px, py, down, dt, render = false)` and then `ui.draw()` only when the hash changed or its `discrete` argument is
true, returning whether it drew; the draw is its own, so it writes the time into the frame's fourth phase (`stats`, the
view's own array) and a dev panel has a raster to show. The headless path uses the same drawer for every `--keys`/`--wheel`/`--settle`/`--move`
frame, so the stored frames go through the skipping loop and come out **byte-identical** (a skipped frame holds exactly
the pixels the previous draw left). `--idle N` runs N more frames with nothing in and prints
`idle: draws 0 of 60 in 1.2 ms (0.02 ms a frame: poll, declare, lay out, hash)`; `--idle-keys K` presses Tab every K of
them, and each key draws its own frame (`--idle 600 --idle-keys 10` is 60 draws of 600).

Measured (macOS, a 360x760 window at pixel density 2, 2026-10-25):

- headless, `--idle 600`: **0 draws**; Sky 21 ms (0.04 ms a frame) and Sensors 11 ms (0.02 ms a frame) for the tick
  that still declares, lays out and hashes.
- the window, Sensors at rest, `--frames 600`: **1 draw, 1 present**, 599 idle iterations of 17.7 ms each — the 16 ms
  sleep is most of it, the tick is the rest.
- the same 600 frames with the draw forced (an instrumented run): **600 draws, 600 presents, 5.00 s**, 8.29 ms a drawn
  frame, of which `ui_draw` is 0.30 ms (`--bench 1000`) and `ui_window_present` **6.43 ms** — the compositor's wait is
  measurable in the loop and it is the bulk of a present. So an idle frame skips ~6.7 ms of draw and present work, and
  the loop's own cost at rest is 0.04 ms a frame.
- the bench's phases are unchanged: events+flush 0.001, declare 0.004, layout 0.013, draw 0.30 ms (Sensors, 1000
  frames).

Not here: a **blocked** poll (`SDL_WaitEventTimeout`) instead of the 16 ms sleep, so the loop would wake only for an
event and hand back the tick's latency (the sleep bounds the input latency at ≤16 ms, with the frame drawn at once on
wake); the board's equivalent (its 22 ms frame is where this would pay most — it draws nothing at rest already,
though its diff is the firmware's, not a hash); dirty rects (a changed frame draws all of it — a hover fade
re-renders the page, where a wrapped-frame diff
could redraw only the boxes that moved); a window-expose present (SDL asks for a redraw when the window is uncovered,
and an idle loop has none in hand, so the next input redraws it); and the terminal and browser targets, which have no
hash loop of their own.

### A dev panel: the tree, the bounds, the phases

Rune's item 7, first half: `bun solid/main.ts dev` is the Widgets page with a panel beside it (`solid/app/Dev.tsx`,
660x760, `solid/README.md` has the details). The page on the left is the `Widgets` component itself in a 360px column, so
its keys, focus and mouse are the `widgets` page's; the panel is 300px on the right, in the same Clay frame, in three
sections: the page's **accessibility tree** as indented rows (`role "name" [states] x,y w×h`, from `a11y.ts`'s
`snapshot` of the page's own subtree, bounds from `ui.bounds`), the **hovered box** (the innermost box under the pointer
that has an id and a role — `ui.over` on the way down — with its name from the tree and its `ui.bounds`; `nothing` over
the page's background), and the **frame's phases** (`View.stats`: events+flush, declare, layout, draw), the mean and max
of the last 30 frames, and `ui.draws()`/`ui.presents()`.

The panel reads all three every frame and prints them when they change. That is what makes the page useful for this
chapter: it is part of the frame, so a phase line reprinted every frame changes the hash every frame and the page could
never rest — the counters in the panel are there to show that it does. A change prints at once and the frame's own
numbers on the next reading (the host pushes them after the tick that reads them), so what is on screen is the last
frame that changed the page. Two runs of the same frame are therefore 13,661 pixels apart of 501,600, which is why the
four stored frames (`solid/frames/dev*.png`) are not compared.

Cost (Apple M2, one thread, `--bench 200`, five runs each, medians; the machine was busy with other work):

- the reading — Solid's `flush()`, `snapshot` (28 nodes) and the hover walk over ~95 boxes with `ui.over` — **0.09 ms** a
  frame: events+flush 0.02 without it, 0.11 with.
- the panel's 28 rows: **+0.02 ms** declare, **+0.008 ms** layout.
- its draw: **+5.4 ms** on a frame that redraws the panel (2.0 → 7.4 ms at 660x760) — ThorVG shapes every text command
  each frame and the panel is 34 lines of it, ~3 µs a glyph. `createDrawer(frame, stats)` now writes the time `ui.draw()`
  took into the frame's fourth phase, so the panel's draw line is the raster the loop did.
- at rest, `--idle 200`: **0 draws**, 0.20 ms a frame against the Widgets page's 0.06.

The page's own first-mount entry is off (the Widgets page is given no motion hook): the entry draws ~21 frames over a
page that does not change, and this page is about the frames after it. `solid/dev.test.ts` holds the panel's content
(the 28 rows, the ring after Tab, the hovered box, the four phases against the frame that changed the page, the counters,
0 draws at rest) and lists three mutations with their failure messages. **A pick** is here too: a press on the page
selects the innermost node under it — a box with a role and an id, the same one the hovered line reports, so a press on
the switch's track (no role) is the switch, and a press on the page's padding is empty space — and moves the tree's
cursor to its row (the row starts with `>`), pins the hovered-box line and switches the live values to it. The pin
holds when the pointer leaves; `Escape`, or a press on empty space, clears it and the panel follows the pointer again.
A box with no role is never picked (the nearest node with one is), and a node with no id has no `ui.bounds`, so it is
skipped: the answer is the nearest ancestor that has both. The tree has no scrolling of its own — the 28 rows fit the
panel — so the cursor's row is always declared. `solid/dev.test.ts` holds the click block; a pick that takes the
outermost box instead lands on the tablist (`FAIL the click picks the innermost node, not its tablist: "> tablist
40,359", wanted "> tab "Overview""`).

### The live values: a box's numbers, edited while the page runs

Rune's item 7, second half (`solid/app/Dev.tsx`, `tuneRows`): the panel's fourth section lists the picked box's style
numbers that the value channel can move, and edits them while the page runs. The pointer over a node of the page picks
it — the same innermost box with an id and a role that the hovered-box line reports — and it _stays_ picked when the
pointer leaves the page (the panel is not the page, and the keyboard needs the numbers to stay); a click pins a box
instead, and the overrides are the page's own, keyed by element id, so a box keeps its numbers when the pointer picks
another. The section's first line names it with its bounds (`wifi  switch "Wi-Fi"  40,118
280×32`), and the rows are `src/pack.ts`'s `FIELDS` that `ui.c` reads:

| Row                                                    | The number                                                                                                                                                                            | Step               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `width`, `height`                                      | the box's size; a `stretch` or `fit` axis has no pixel of its own in the 45, so the row reads the box's laid-out size and a step pins the axis to a pixel (type, min and max at once) | 1                  |
| `padding.l`, `.r`, `.t`, `.b`, `gap`                   | the layout's padding and child gap                                                                                                                                                    | 1                  |
| `radius`                                               | all four corners at once; where they are not one number the row is `radius.tl`, `.tr`, `.br`, `.bl` (a tab's 8 8 0 0)                                                                 | 1                  |
| `bg.r`, `.g`, `.b`, `.a`                               | the fill's four channels                                                                                                                                                              | 4                  |
| `border.r`, `.g`, `.b`, `.a`                           | the border's colour, listed only where the style draws a border (any of its four widths)                                                                                              | 4                  |
| `offsetX`, `offsetY`, `expandW`, `expandH`, `zIndex`   | a float's (`css.float`) block, listed only for a float, which is the only element `ui.c` reads it for                                                                                 | 1                  |
| `shadowBlur`                                           | the blur of the style's shadow (`ui_shadow`'s argument, field 45), listed for a shadow                                                                                                | 1                  |
| `gradientAlpha`                                        | the opacity of the style's background image (field 50), listed for a gradient                                                                                                         | 0.1                |
| `alpha`, `scale`, `translateX`, `translateY`, `rotate` | the renderer's group: the whole subtree's opacity 0..255, scale about its box centre (1 = none), offset in px, and rotation in degrees (fields 46..49 and 55)                         | 0.1, 0.01, 1, 1, 1 |

Every one is a live value, including the ones the renderer only reads at layout (a width, a padding, a gap, a radius):
the page re-declares its own tree every frame, so a value that moved a box re-lays it out, moves its a11y bounds and its
siblings. What is **not** a row: a **text's** colour (fields 51..54 are a text's own floats, not its box's, and a text's
colour is only reachable through a text with an id — the picked element is a hovered box), and the **modes and enums**
of the 45: `capture` and `clip` (0/1), the sizing type, an alignment, the layout direction, a float's attach and its
parent's id halves. A step does not read those as values, so the section does not offer them.

The keys, when the values part has the panel's focus (`Tab`/`Shift+Tab` walk the page's own controls, then the panel's
three stops — the tree, the hovered box and the values, which are the page's last three):

- `Up`/`Down` (and `Home`/`End`) pick a row; `Left`/`Right` (or `-`/`+`) step it by the table's step, clamped to the
  field's range (a colour 0..255, a size 0..8192, an alpha 0..255, a scale 0..8, a translate or an offset -4096..4096,
  a `zIndex` -32768..32767, a rotation -360..360).
- `r` resets the row to the style's literal, `Shift+R` all of them. A reset does not write the literal: it _drops_ the
  override, so the declare falls back to the style's own floats and the frame is the frame before the edit again — the
  page's pixels byte for byte (the panel's own frame section prints the milliseconds of the frame that last changed the
  page, so its digits are the one thing that moves between two readings of the same state).
- `>` is the cursor (the row is drawn in the accent too), and `*` before a row's name marks a live value, so the reader
  can tell the panel's number from the style's. The section's footer is the keys, what `*` is, and — when the box has
  more rows than the panel has room for — which rows of how many it is showing (`4-21 of 21`): the list is a window of
  18 rows, two a line, that follows the cursor. The panel cannot scroll: Clay squeezes a fitted column into its box, so
  what the four sections declare has to fit the 760px it has (the gap's 2px instead of 3 is what the fourth section
  needed).

The writes are the Dialog page's mechanism: `ui.value(id, field, value)` at the panel's tick, before the tree is
declared, into the renderer's table for that frame only (`ui_begin` clears it). No page state is touched, so the page's
literals are untouched, and nothing is written while nothing is overridden — an untouched panel's frame is the frame it
was. Cost (Apple M2, one thread, in `solid/tune.test.ts`'s own measurement, 120 frames at rest, medians; the machine had
other work on it): declare **0.050** ms and layout **0.033** ms with no override, **0.048**/**0.038** ms with five rows
overridden — inside the noise, because a write is one float into a 64-entry table and `ui_open` copies the element's 180
bytes once for an element that has any override (a `memcpy` per overridden element, as the Dialog's tracks are). The
same two medians read 0.057 and 0.130 in a run with three other agents' suites on the machine, which is the machine and
not the writes: five `ui.value` calls and one 180-byte copy cannot cost 70 µs. An
edit's own frame draws the window as any changed frame does: **6.9..13.1 ms** of draw for the page and the panel in
four runs on a machine with other work on it (a machine busy with other agents drew the same frame at 38 ms, so the raster is what the load moves).

`solid/tune.test.ts` holds it: the switch's 17 rows and their numbers (and the same numbers from the style's own
`resolve`), the panel's three Tab stops, `Right` on the radius rounding the corner (`48,53,68` → the page's own
`16,18,24` at the corner pixel) and the row's text, the width moving the box and the a11y tree's bounds (`280×32` →
`281×32`), `bg.r` running to 255 and the row's fill going red, the clamps (an alpha at 255 stays 255, a padding at 0
stays 0), `r` and `Shift+R` (five rows overridden) with the page byte-identical to before, the `*`, the window, and the
cost. Three mechanisms' mutations were run and reverted, the write's twice: the width's row writing the height's
floats fails `FAIL the box is a pixel
wider: "40,118 280×281", wanted "40,118 281×32"`; a `radius` row one float along fails `FAIL the radius rounds the
corner: "48,53,68,255", wanted "16,18,24,255"`; a reset that writes the live value back fails `FAIL ... and the page is
the page before the edit, byte for byte: false, wanted true`; and a step without its clamp fails `FAIL an alpha past 255
stays 255: 259, wanted 255`.

A **session** is the overrides as data. `bun solid/main.ts dev --tune path.json` reads one before the first frame, and
`s` (with the values part focused) writes the current one to the same path (`dev-tune.json` when the flag is absent).
The file is `{ "values": [ { "id": "wifi", "field": "radius", "value": 16 } ] }`: one element, one of the panel's row
names (`radius`, `bg.r`, `padding.l`, `width`, …; `radius` writes all four corners), and a number. Entries are written
sorted by id and in the panel's row order, so the same session is the same bytes. Loading checks every entry and fails
with its number and why: an element the page does not have (`tune: entry 1: no element "nope" on the page`), a name
that is not a row (`tune: entry 1: "radiusX" is not a panel field`), and a number out of the row's range (`tune: entry
1: bg.r 300 is out of range 0..255`). A file of two entries is the frame of the same two edits by hand, byte for byte,
and `s`'s file loads back to it (`solid/tune.test.ts`); a writer naming a field the loader does not know fails that load
with `tune: entry 1: "radius!" is not a panel field`.

Not there: no pointer on a row (no dragging a number and no colour picker — the arrows are the only control), no
multi-element replay in the suite (the format gives every entry an id, so a session may span boxes, but the tests hold
one), no editing a style the page does not declare (a text's colour and the modes above), and the panel is still one
page's (`Widgets`): a second page needs its own dev page.

## Text: the oracles, and why there is no weight correction

Rune's item: their text looked thin next to the platform's, so they built an oracle (CoreText drawing the same strings)
and two numbers per line — the **ink weight** and the **SSIM** — and fixed the drift by emboldening by ~0.1 pt. Same
method here, other verdict: ThorVG's text on macOS already weighs what CoreText weighs, at 1x and at 2x, so a correction
would be a regression. And the one rasteriser that is far from ours is Chrome's Canvas2D, the _web_ target's: it is a
third heavier, which is its gamma, not a glyph we can fix here. The instruments are in the tree, because that is what
makes the verdicts checkable and re-checkable.

`solid/app/Sheet.tsx` is the sheet: twelve lines of the app's strings and eight sizes (11 to 32 px) in Roboto, one page,
nothing that moves. Two references draw the same lines at the same places, from one spec:

- `solid/text-oracle.swift` — CoreText, the platform's own rasteriser, font smoothing off (it is a display gamma with no
  counterpart in ThorVG), antialiasing and subpixel positioning on — into `frames/text-oracle.png`, and at the window's
  pixel density into `frames/text-oracle-2x.png`;
- `solid/text-canvas.mjs` — Chrome's Canvas2D through Playwright, the browser target's rasteriser, into
  `frames/text-canvas.png`.

`solid/src/textmetric.ts` is the metric: a crop's **coverage** per pixel (its luminance between the page's and the
text's), a line's **ink** (the coverage summed, in pixels of the text's colour), the best whole-pixel **shift**, and the
standard **SSIM** (11x11 Gaussian, sigma 1.5) over the windows that carry ink — over the whole crop it would score every
pair 1.0 on empty paper. `solid/text.test.ts` renders the sheet in-process at each reference's density and checks every
line of all three: no shift, an ink weight in that reference's band, an SSIM floor, an extent within a pixel or two. It
needs neither Swift nor a browser, so it runs in the suite. `bun solid/text-oracle.ts` prints the numbers,
`--density 2` the Retina pass, `--canvas` the Canvas2D reference, `--update` re-stores the frames, `--weight N` measures
the renderer's dial and `--sweep` a table of them.

Measured (macOS, Roboto-Regular.ttf, 1x, 2026-10-28; ink in pixels of the text's colour):

| line                | size | ThorVG | CoreText | weight | SSIM  |
| ------------------- | ---- | ------ | -------- | ------ | ----- |
| Sensors             | 32   | 792    | 783      | 1.012  | 0.998 |
| Network & Sharing   | 24   | 1045   | 1039     | 1.005  | 0.998 |
| +1.16 -0.72 +10.04  | 20   | 543    | 541      | 1.003  | 0.999 |
| Wm ¼ ⅓ — “quotes”   | 20   | 559    | 583      | 0.958  | 0.459 |
| 18.3 °C             | 17   | 157    | 158      | 0.995  | 0.996 |
| Room A1             | 16   | 203    | 203      | 1.001  | 0.997 |
| The quick brown fox | 16   | 453    | 450      | 1.005  | 0.983 |
| switch to g         | 14   | 191    | 189      | 1.008  | 0.991 |
| accel m/s²          | 14   | 177    | 174      | 1.019  | 0.997 |
| 18.3 °C             | 13   | 92     | 89       | 1.027  | 0.993 |
| gjpqy 0123456789    | 12   | 276    | 269      | 1.025  | 0.994 |
| settings            | 11   | 100    | 96       | 1.044  | 0.993 |

The mean weight is **1.008** (1.013 without the fallback line): not thin anywhere, and up to 4.4 % _fat_ at 11 px, which
is what a rasteriser without hinting does to a stem that falls between pixels — it spreads it. Every line is where
CoreText puts it (shift 0,0) and measures within a pixel of its extent (114/113 at 32 px is the widest gap), so the
advance sum is not drifting either. The one real difference is the **fallback font**: ThorVG sets one face, so the ⅓ of
"Wm ¼ ⅓ — “quotes”" is the empty box and CoreText falls back for it — weight 0.958, SSIM 0.459. The sheet keeps the line
because a weight alone would call it thin and the SSIM is what sees a wrong glyph, and the test asserts that low SSIM
rather than hiding it.

**At the window's density.** A Retina window draws the same layout at 2x (`SDL_GetWindowPixelDensity` hands the host
`ui_density`), and ThorVG scales its root scene, so the question is whether the glyphs are rasterised at 2x or a 1x
raster is enlarged. The numbers say rasterised: ink is 4.006x the 1x line (3,173 against 792 for "Sensors") and the
weight **1.005** on average, every line 1.001..1.018 — _closer_ to CoreText than at 1x, and SSIM 0.967..0.998. The
stored `frames/text-sheet-2x.png` is the frame, `frames/text-oracle-2x.png` the reference, and the suite checks it at
2x with the same bands.

**Against the web target's rasteriser.** Chrome's Canvas2D draws the same twelve lines at **0.729** of our ink
(0.699..0.781 a line, SSIM 0.843..0.916, every line at shift 0,0 and the same extent within a pixel) — the browser is a
third _heavier_ than the desktop, and the harness and the browser target's own frame agree (the same title 1,014 against
the stored `browser/expected.png`'s 907 in a tighter crop, "+1.16 -0.72 +10.04" 723 against 715). So the gap is Chrome's
canvas gamma, not our renderer, and matching it would mean thickening the desktop's text to a rasteriser that is wrong
next to its own platform. It is stored and pinned in the test (weight band 0.68..0.80) instead: a change in either
renderer is a failing line, not a surprise.

The dial exists and sits at 0: `ui_text_weight(px)` (`ui.textWeight`) makes the renderer draw every line twice, half the
weight either side of Clay's place, growing the glyph by that much and keeping its centre. The sweep is why 0 is the
value: a weight of 0.25 already yields **1.309** mean weight and SSIM 0.883, 0.5 → 1.408 / 0.840, 1.0 → 1.635 / 0.684.
Rune's 0.1 pt is 0.13 px at 96 dpi, in the same direction and the same order — and against CoreText here it is wrong.

Not covered: any font but Roboto-Regular (the stack vendors one face; a second face is a font feature, not a metric),
and the terminal and board targets, whose text is a cell grid and termbox2's — a different question from a rasteriser's
ink. And not measured: why Chrome's canvas is that heavy (gamma, contrast enhancement or subpixel coverage — its DOM text
was not compared with its canvas text), and the light theme's dark-on-light text, where a display gamma differs.

## The Hershey spike: a monoline stroke font against the raster path

Gorton's engraving faces and Hershey's straight-line vector fonts are the same idea: text as strokes, and kilobytes
instead of a font file or an atlas. Measured rather than argued (`native/spike/hershey/`, `sh spike/hershey/run.sh`):
`futural` ("Roman Simplex", 96 glyphs, public domain, `vendor/hershey/`) drawn as ThorVG strokes at 14, 40 and 96 px
against the same strings through the renderer's own text path, on the same page, with the CoreText oracle and the metric
of `solid/textmetric.ts`. The rows are the sheet's eight ASCII strings plus one signage line of digits ("`0123456789`");
the four with ¼ ⅓ ° ² — “ ” are left out because `futural` has no such glyphs — a fallback question of its own, and
the one the TTF already answered with its empty box. The rasters are `spike/hershey/out/`, git-ignored and regenerated by
the script; the script is not in `test.sh` (90 seconds of measurement, not a gate).

**Bytes — where strokes win.**

| data                                      | bytes                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| Hershey table, 96 glyphs, every size      | **3,122** (8,486 with the Cyrillic set)                                 |
| `vendor/fonts/Roboto-Regular.ttf`         | **168,260** (every size)                                                |
| A8 atlas built with ThorVG, the 96 glyphs | **12,544 / 77,056 / 373,504** at 14/40/96 px (463,104 + 4,032 of index) |

**Milliseconds — where they lose.** 300 runs a frame, median of 5 runs, the page cleared and the scene built every frame
(median of 200/100/20 frames a run; the path and fill alone are 0.6-1.6 ms, so it is ThorVG's stroke tessellation). On an
8-core Apple-silicon Mac at load average 2.9; a second run at 4.7 was within 3%, the ratios the same:

| size | strokes               | ThorVG text      | ratio |
| ---- | --------------------- | ---------------- | ----- |
| 14   | 16.6 ms (55 µs a run) | 8.8 ms (29 µs)   | 1.90x |
| 40   | 48.4 ms (161 µs)      | 39.2 ms (131 µs) | 1.24x |
| 96   | 110.4 ms (369 µs)     | 84.8 ms (283 µs) | 1.30x |

**How it reads** — ink weight and SSIM against CoreText, per row of the sheet, the TTF through the same harness as the
control:

| size | weight | SSIM, the face's own advances | SSIM, at Roboto's advances | the TTF control |
| ---- | ------ | ----------------------------- | -------------------------- | --------------- |
| 14   | 1.067  | 0.248                         | 0.640                      | 1.003 / 0.993   |
| 40   | 1.047  | 0.231                         | 0.531                      | 1.010 / 0.990   |
| 96   | 1.041  | 0.179                         | 0.362                      | 1.002 / 0.973   |

The weight is a dial (the stroke is 7.8% of the size, Roboto's stem), but the advances are not: Hershey's lines run
10-40% wide, and even given Roboto's advances the shapes score 0.36-0.64 where the suite's floor is 0.95 (a one-pixel
move scores 0.708). Hershey's cap-matched scale leaves an x-height 0.667 of the cap against Roboto's 0.743, so the
lowercase of a stroke font reads small; there is no scale that matches both. It is a different typeface, and at 96 px
that is visible.

**The rule.** Strokes for a display-only size — a board whose ROM is the binding constraint, signage at one size, in a
face drawn for it. Not for UI text at 11-17 px: there the platform's raster is faster _and_ the face the app is
designed in. No hybrid: the 14 px atlas is 12.5 KB and the TTF covers every size, so the bytes only matter at 96 px,
where the strokes cost 1.3x the raster and read 0.36 SSIM. What would change the answer: a stroke font drawn for 12-14 px
with hinting (futural has none), a GPU line expander that turns the tessellation into a vertex shader, or a board whose
texture memory is as short as the ESP32-S3's 512 KB — where a 12.5 KB atlas against a 168 KB font is the whole argument.
Cyrillic is vendored but not drawn: `cyrilc_1.jhf` carries Hershey numbers (2199…), in no order, with no published
mapping to Unicode, so a reading test would be a guess.

Not measured: other stroke faces, kerning (neither side has any), a cached stroke geometry (the path is 3% of the cost),
text at 2x density, and the board itself — there it is a CPU band raster of 16.7–19.2 ms of a 21.4–24.2 ms frame
(2026-11-06, `native/docs/map.md`), never ThorVG, so a 1.3-1.9x text share would be measured against that raster,
not a GPU.

## The nicegraf spike: a GPU pipeline against the CPU raster

The question after the WebGPU probes (the map, "Probed 2026-10-21") was how much of the GPU path was ThorVG and how much
was the GPU. [nicegraf](https://github.com/nicebyte/nicegraf) is the smallest layer that can answer it: pipelines,
command buffers and resource tables over Metal/D3D12/Vulkan, with no renderer, no shapes, no text.
`native/spike/nicegraf/`: `run.sh` fetches it (shallow, `c7b2739`), builds the Metal backend (**2-4 s**, one two-line
patch: clang 16 rejects `ngfi::fixed_array {ptr, len}` on an alias template), and `quad.cpp` — **325 lines** with the
shaders as MSL source, the bench and a PNG writer — draws the Sensors frame's six quads (fill, pill, four 1px border
strips) through one pipeline, one vertex buffer, one draw call, into a 360x360 offscreen target, and reads the pixels back.
The binary is 372,696 bytes with all three nicegraf static libraries in it; no submodules, one vendored header
(metal-cpp) is all it needed on this Mac.

Smallest of three back-to-back runs, Apple M2, 8 cores, load average 4.4, 300 frames a phase:

|                                                            | ms a frame                        |
| ---------------------------------------------------------- | --------------------------------- |
| nicegraf/Metal, record + submit                            | 0.037                             |
| nicegraf/Metal, GPU throughput, no readback                | **0.045**                         |
| nicegraf/Metal, draw + wait, no readback                   | 0.126                             |
| the readback alone (copy, wait, map)                       | **0.087-0.127**                   |
| nicegraf/Metal, a frame with its readback                  | 0.155-0.187                       |
| ThorVG's CPU raster, the same six quads                    | **0.019**                         |
| ThorVG's CPU raster, the real frame (text, border, radius) | 0.304                             |
| 502 quads: GPU no readback / with readback / ThorVG CPU    | 0.045 / 0.154-0.181 / 0.250-0.268 |

Verdict: checked, not adopted. The floor is real — 0.045 ms of GPU time for the shapes — but the frame the CPU raster
draws in 0.019 ms does not need it, the readback that makes a frame visible costs 0.09-0.13 ms (the wall the WebGPU probe
hit at 1080², 0.62 against 2.19), and everything the page actually is — seven text commands, AA edges, corner radii,
the border ring, gradients, shadows, images, a scissor stack — is what a renderer on top of nicegraf would still have to
build. The board has no GPU, the browser's Canvas2D/WebGPU is not Metal and the terminal is cells, so a GPU path is a
fifth raster for the one target that already has the fastest one. What would change it: a window that presents this
pipeline's target from its own `CAMetalLayer` (no readback) carrying a frame of hundreds of shapes and little text.

`sh native/spike/nicegraf/run.sh` prints the table and fails if a number is missing. Not in `test.sh` — it fetches a
library and needs a GPU, and it is a measurement, not a gate (the same reason the Hershey spike is out).

## Test

```sh
bun install      # at the repository root
sh test.sh       # generator, same.c against vendor/clay/clay.h, the Sensors frames on SDL and on ThorVG (needs brew sdl3 sdl3_ttf sdl3_image thorvg)
sh desktop/build.sh examples/sensors && ./build/sensors/app   # the window, ThorVG's software raster; the t key toggles the theme
./build/sensors/app --raster sdl                              # Clay's SDL3 renderer instead (the window uses the GPU)
sh desktop/build-thorvg-gpu.sh examples/sensors               # ThorVG built from source with its WebGPU engine (~1 min, in $TMPDIR)
./build/sensors/app-gpu --raster thorvg-gpu --bench 500       # the same page on Metal through wgpu-native; needs brew meson ninja pkgconf wgpu-native
sh desktop/build-wg-window.sh && ./build/sensors/wg-window --capture out.png   # ThorVG into the window's own WebGPU surface, no readback; --capture checks the frame
bun solid/main.ts widgets                                     # Solid: headless button, switch, checkboxes, disclosure, radio, tabs, slider, toolbar; Tab, arrows, Space work
bun solid/main.ts storybook                                   # the stories of solid/stories/*.stories.tsx in a vertical tablist rail: Tab enters, Up/Down move and pick; --story ID opens one
bun solid/main.ts storybook --arg on=true --arg label=Wi-Fi   # the controls panel under the canvas: one row per arg a story declares, each a headless part (switch, radio group, slider, text field); --arg name=value starts the opened story with it (repeatable), typed by the control
bun solid/main.ts notify                                      # the Sky page started on its notifications screen (the feed's `n`)
bun solid/main.ts sky --settle 60 --idle 600                  # the page at rest: 0 draws of 600, and the ms the tick takes
bun solid/main.ts sky --settle 60 --idle 600 --idle-keys 10   # ... and 60 keys, each drawing its own frame (60 draws)
bun solid/main.ts sky --touch 0.5 0.5 --png out.png           # headless: a finger's tap at the window's middle (ui_touch_map: 0.5,0.5 -> 180,380)
bun solid/text-oracle.ts                                      # the text sheet's ink weight and SSIM against CoreText, line by line
bun solid/text-oracle.ts --density 2                          # ... at the window's pixel density; --canvas against Chrome's Canvas2D
bun solid/text-oracle.ts --update                             # re-store the sheet and its references (needs swiftc; --canvas playwright)
./build/sensors/app --press 180 250 --png out.png             # headless: a press held at 180,250, the frame written while pressed
./build/sensors/app --raster thorvg --dump out.json           # headless: the frame as JSON (desktop/clay_dump.c), the Solid goldens' schema
node dump-check.ts solid/goldens/sensors.json out.json        # ... compared with the Solid Sensors page's golden, field by field
IMAGE=1 ./build/sensors/app --raster thorvg --png out.png    # the IMAGE=1 variant: the page's 32x32 image, loaded by ThorVG from its path
sh terminal/build.sh && ./terminal/demo                       # the Sensors page in characters: Tab, Up/Down, Space, t; q quits
./terminal/demo --page sky                                    # apps/csssky-tui in characters: the feed; enter opens the thread
./terminal/demo --page profile                                # apps/csssky's profile: its tabs, its posts; enter opens a thread
./terminal/demo --dump out.txt                                # one frame headless as plain text ('.' is a fill)
./terminal/demo --keys Tab,ArrowDown --dump out.txt           # a frame after each key, as solid/main.ts --keys
sh browser/build.sh && node browser/check.mjs                 # the browser target, headless: wasm + Canvas2D, compared
node browser/check.mjs --serve                                # ...or serve the page and open the URL it prints
./terminal/demo --click 22,0 --page sky --dump out.txt        # a frame, a press, a frame, a release, a frame
```

## Browser (WASM)

The same generated C as step 5, compiled with `zig cc -target wasm32-wasi` (a libc; there is no emscripten here) and
drawn by `browser/draw.js` on a `<canvas>` (rectangles, inside borders, `roundRect` corners, `fillText`, `clip()` for a
scissor), which `browser/render.js` — the no-JS page's own two frames and its readouts — loads. No framework and no
build step at run time. Text is measured by Canvas2D through one wasm import, so Clay lays out with the same font the
canvas draws with (Roboto from `vendor/fonts`), and `w` or the button switches the `use_g` frame.

```sh
sh browser/build.sh            # -> ${TMPDIR:-/tmp}/cssints-native-web/page.wasm, next to the generated styles.h
node browser/check.mjs         # Chromium through Playwright: the command array and the raster
node browser/check.mjs --serve # http://127.0.0.1:<port>/browser/index.html — a browser will not fetch a .wasm from file://
```

| What        | Size                                        |
| ----------- | ------------------------------------------- |
| `page.wasm` | 131,609 B                                   |
| the page    | 10,487 B (index.html + render.js + draw.js) |

`browser/check.mjs` builds nothing: `browser/build.sh` does, into `$TMPDIR`, because the wasm is a build product. The
wasm exports `dump()`: the last frame as the JSON of `desktop/clay_dump.c`, the one emitter on every target, and the
check compares it with `solid/goldens/sensors.json` — the same golden the Solid page and the C page are held to — so
the browser has no command table of its own any more. `page.wasm` carries the emitter's `vsnprintf` (about 27 KB) for
that comparison; the page itself does not need it.

### The Solid pages in the browser

The desktop's modules play in the page too: `browser/solid/page.ts` imports `solid/src/renderer.ts`, `solid/src/frame.ts`
and `solid/app/Sensors.tsx` **unmodified**, `browser/solid/widgets.ts` does the same with `solid/app/Widgets.tsx`,
`browser/solid/build.ts` bundles them with Bun (`--target=browser`, the same JSX and cssints loaders as
`solid/plugin.ts`), and Clay runs in a second wasm module beside the generated page's.

```
browser/ui.c                 the desktop's flat ui_* surface over Clay only: no SDL, no window, no ThorVG — and the
                             renderer's tables beside the commands (a shadow, a backdrop, a gradient, a group, an image)
browser/solid/ffi-browser.ts the same `ui` object as solid/src/ffi.ts, over the wasm: a growing heap, TextEncoder,
                             the style's Float32Array copied in, Canvas2D answering env.measure
browser/solid/page.ts        the Sensors frame loop: render(Sensors) into an El tree, createDrawer, requestAnimationFrame,
                             the mouse and the wheel as the pointer, the canvas drawn by browser/draw.js
browser/solid/sky.ts         the Sky page the same way: src/input.ts's own keys from the DOM, the wheel to the page's
                             scroll track, and each draw carrying the effect tables
browser/solid/build.ts       Bun.build: page.js and sky.js; one resolution, src/frame.ts's ./ffi.ts -> ffi-browser.ts
browser/solid/index.html     the Sensors canvas and the script
browser/solid/sky.html       the Sky page's canvas (360x760) and the script
browser/solid-check.mjs      Chromium: the commands, a real click, the raster, the sizes and the ms
browser/sky-check.mjs        Chromium: the Sky page's frame against the desktop's, its gradient, avatars, shadow, entry
browser/solid/shell.ts       what both pages share: the canvas, the loop (createDrawer), the pointer and the wheel, the
                             keyboard when a page has an Input, and the object the check drives (window.__page)
browser/solid/keys.ts        a DOM KeyboardEvent as the name src/input.ts takes (the table below), into the page's Input
browser/solid/page.ts        Sensors: mountPage with the page's own size and its motion hook
browser/solid/widgets.ts     Widgets: the same, plus createInput() and the page's props as main.ts builds them
browser/solid/dialog.ts      Dialog: the same, with the two root floats (the modal's backdrop and its panel) and the
                             menu's glass, whose `css.backdrop` comes from the effects table
browser/solid/build.ts       Bun.build: page.js, widgets.js, sky.js and dialog.js (one entry point each); one resolution,
                             src/frame.ts's ./ffi.ts and app/Widgets.tsx's ../src/ffi.ts -> ffi-browser.ts
browser/solid/index.html     the Sensors canvas and its script
browser/solid/widgets.html   the Widgets canvas (360x760, tabindex=0) and its script
browser/solid/dialog.html    the Dialog canvas (360x480, tabindex=0) and its script
browser/solid-check.mjs      Chromium: the commands, a real click, the rasters, the keys, the sizes and the ms
browser/dialog-check.mjs     Chromium: the Dialog's four frames, the menu's golden, the backdrop's blur and its cost
```

`sh browser/build.sh` builds both modules: `page.wasm` is the no-JS path (unchanged), `ui.wasm` is this one. Neither is
committed. The loop is `src/frame.ts`'s `createDrawer`: the tree is declared and laid out every `requestAnimationFrame`,
and the canvas is drawn only when the frame hash moved or a discrete input came in — a page at rest costs a layout and
no pixels, as on the desktop. A press or a release runs its frame on the event, so a click cannot land both inside one
frame. Keys have no page to reach: `Sensors` takes no input, and the desktop's SDL key names (`src/input.ts`) have no
DOM map here yet (`sky.ts` gives them their DOM names, which are the ones `src/input.ts` routes).
no pixels, as on the desktop. A press, a release, a wheel notch and a key each run their frame on the event, so a quick
input cannot land two events inside one frame and lose one; the mouse is `src/frame.ts`'s pointer.

**The keys.** A page with an `Input` gets a `keydown`/`keyup` pair on its canvas: the DOM event is named as `src/input.ts`'s
`keyName` names SDL's, the name goes into `input.down`/`up`, and the frame that changed runs after it — main.ts's order, a
key queued before the tree is declared. Tab, Space and the arrows are `preventDefault`ed (the canvas has the browser's
focus, so the browser must not move it to the chrome or scroll the page); Cmd, Ctrl and Alt chords are nobody's, as on the
desktop, and so is Shift with an arrow, Home, End, Backspace or Delete (a selection chord, not a move). Letters and digits
are read from `event.code`, because SDL's keycode is the key and not the character: Shift+1 is "1", not "!", and Shift+A
is the page's own "Shift+A" chord. A typed character is not a key: `Input.textInput` has no DOM path yet.

| `KeyboardEvent`                                                                                              | the name (`src/input.ts`)                                                          |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `key` "Tab"                                                                                                  | `Tab`, and `Shift+Tab` with `shiftKey`                                             |
| `key` " " (and the legacy "Spacebar")                                                                        | `" "` — the desktop's name for SDL 32; the parts take `Space` too                  |
| `key` "Enter"/"Escape"/"Backspace"/"Delete"                                                                  | the same                                                                           |
| `key` "ArrowUp"/"ArrowDown"/"ArrowLeft"/"ArrowRight"                                                         | the same                                                                           |
| `key` "Home"/"End"/"PageUp"/"PageDown"                                                                       | the same                                                                           |
| `code` KeyA..KeyZ                                                                                            | `a`..`z`; `Shift+A`..`Shift+Z` with Shift (the page's own chord)                   |
| `code` Digit0..Digit9                                                                                        | `0`..`9`, shifted too                                                              |
| `code` Backquote, Minus, Equal, BracketLeft, Backslash, BracketRight, Semicolon, Quote, Comma, Period, Slash | the unshifted character: `` ` ``, `-`, `=`, `[`, `\`, `]`, `;`, `'`, `,`, `.`, `/` |
| anything else (F1, Dead, a chord)                                                                            | nothing: the page never sees it                                                    |

**The focus.** The canvas is `tabindex="0"`, and a press on it calls `focus()`: a canvas takes no DOM focus otherwise, and
a `keydown` goes to the focused element. The page does not take the focus on load — a page should not jump into a reader's
keyboard — so a person clicks the frame first, and the check does the same (a press on the page's top padding: empty
space, so nothing is toggled). The ring is the page's own `:focus` style (2px `t.color.ring`), not a browser outline.

**The second page.** Sensors and Widgets share the shell: the same wasm, `src/renderer.ts`, `src/frame.ts`,
`browser/draw.js`, `ffi-browser.ts`, `globals.ts`, `keys.ts` and `window.__page`. They differ in their component, their
size (360x360, 360x760), their HTML file, and one prop: Widgets takes an `Input` (made with `createInput()`, as main.ts
makes it) and a drag state, and its keys go into that Input. The bundles are separate files (one entry point each, no
shared chunk), so a page loaded alone needs nothing from the other's; the shared code is one source.

The two host globals the desktop's modules read are shimmed in `browser/solid/globals.ts`: `Bun.nanoseconds` (the
frame's phases, `performance.now`) and `Buffer.from` (the page's entry id). Of the desktop binding's pixels,
`ui.pixel(x, y)` and `ui.pixels(w, h)` are the page's canvas (`getImageData`, at the raster's density) and
`png`/`savePng`/`diffPng` have no file system to work on — the check writes the canvas with Playwright instead; the
command array itself is the wasm's (`cmds`, `cmd_count`, `cmd_size`), which is what `draw.js` and the dump read. The
page's accessibility tree is `solid/a11y.ts`'s `snapshot(root)`: it walks the Solid tree the frame declares, so it runs
in the page as it does on the desktop (`window.__page.a11y()`), and it is what the keyboard is asserted through.

| What             | Size                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `ui.wasm`        | 147,210 B (54,754 B gzip): the console's `render.c`/`cells.c` are in it                                 |
| `page.js`        | 154,464 B (38,752 B gzip), unminified                                                                   |
| `sky.js`         | 300,229 B (71,434 B gzip), unminified                                                                   |
| `sky.html`       | 1,301 B                                                                                                 |
| `draw.js`        | 16,733 B (5,732 B gzip)                                                                                 |
| a frame, Sensors | 0.08 ms: declare, layout, commands, Canvas2D, one readback (100 frames, headless Chromium, M2)          |
| a frame, Sky     | 0.73-0.80 ms: the same, with the effect tables read and the avatars drawn from bitmaps                  |
| What             | Size                                                                                                    |
| ---------------- | ---------------------------------------                                                                 |
| `ui.wasm`        | 147,210 B (54,754 B gzip): the console's `render.c`/`cells.c` are in it                                 |
| `page.js`        | 239,871 B (57,445 B gzip), unminified                                                                   |
| `index.html`     | 1,320 B                                                                                                 |
| `widgets.js`     | 335,796 B (74,582 B gzip), unminified                                                                   |
| `widgets.html`   | 1,482 B                                                                                                 |
| a frame, Sensors | 0.08-0.09 ms: declare, layout, the commands, Canvas2D, one readback (100 frames, headless Chromium, M2) |
| a frame, Widgets | 0.25-0.26 ms: the same, on the 59-command page                                                          |

The bundles are the production build of `solid-js` (`build.ts` resolves `solid-js` and `@solidjs/signals` to their
`dist/*.js`, as `solid/plugin.ts` redirects the desktop's): the bundler's `development` condition picks
`@solidjs/signals/dist/dev.js`, whose diagnostics refuse the writes a page makes in its component body (`Sky.tsx`'s
cells), and it is twice the size for rules this target does not run.

`browser/solid-check.mjs` and `browser/sky-check.mjs` are `browser/check.mjs`'s siblings and run in `solid/test.sh`
(skipped, with a message, when zig, bun or Playwright's chromium is missing):

```sh
sh browser/build.sh && bun browser/solid/build.ts   # the two wasms and the two bundles, in $TMPDIR
node browser/solid-check.mjs                        # the Sensors base frame, the click, the raster, the sizes
node browser/sky-check.mjs                          # the Sky page: its frame, gradient, avatars, shadow, entry
node browser/sky-check.mjs --serve                  # http://127.0.0.1:<port>/browser/solid/sky.html, for a person
sh browser/build.sh && bun browser/solid/build.ts   # the two wasms and the bundles, in $TMPDIR
node browser/solid-check.mjs                        # both pages: the commands, the click, the rasters, the keys
node browser/solid-check.mjs --update               # ... and re-store browser/expected-widgets.png
node browser/solid-check.mjs --serve                # the pages' URLs, for a person (/browser/solid/index.html, widgets.html)
node browser/dialog-check.mjs                       # the Dialog: its four frames, the menu's golden, the glass's blur
node browser/dialog-check.mjs --serve               # http://127.0.0.1:<port>/browser/solid/dialog.html, for a person
```

`solid-check.mjs`: (a) the base frame dumped through the same emitter against `solid/goldens/sensors.json` — 10
commands, every field and every box, the worst box 3.38 px (the Units pill sitting that much lower because the measure
callback rounds every line height up, 37.5 -> 38 at 32px and 16.4 -> 17 at 14px, while ThorVG's is exact; the no-JS
page's own check reports the same 3.38 on the same command). (b) a real click: Playwright's mouse on the pill, the
page's DOM listeners, `src/frame.ts`'s events, the `Units` element's `onClick`; while the pointer is on the pill the
frame carries its `:hover` (48,53,68), and with the pointer off it the use_g frame is the no-JS page's `frame(1)` field
for field and box for box, 0 px. A second click returns to the base frame, again identical. (c) the canvas against
`browser/expected.png`: 0.00% of pixels differ, worst 8x8 block 0.0/255.

(a) each base frame, dumped through the same emitter, against its golden: Sensors 10 commands, every field and every box
— the worst box 3.38 px, the Units pill sitting that much lower because the measure callback rounds every line height up
(37.5 -> 38 at 32px, 16.4 -> 17 at 14px, `draw.js`, as the no-JS page's does) while ThorVG's is exact; the no-JS page's own
check reports the same 3.38 on the same command. Widgets: 59 commands, every field, the worst box 3.16 px ("Storage": the
rows above it are each a little taller than ThorVG's). (b) a real click on the Sensors pill: Playwright's mouse on the
pill, the page's DOM listeners, `src/frame.ts`'s events, the `Units` element's `onClick`; while the pointer is on the
pill the frame carries its `:hover` (48,53,68), and with the pointer off it the use_g frame is the no-JS page's use_g
frame, field for field and box for box, 0 px — two runs of the same Clay and the same Canvas2D measure, so a difference
could only be this page's. A second click returns to the base frame, again identical. (c) the rasters: Sensors' canvas
against `browser/expected.png`, 0.00% of pixels differ, worst 8x8 block 0.0/255; Widgets' against
`browser/expected-widgets.png` (the canvas's own pixels, not an element screenshot — its CSS box rounds to 761 px), 0.00%
and 0.0/255; and Widgets against the desktop's own `solid/frames/widgets-initial.png`, the way `check.mjs` holds this
browser to ThorVG's frame: 8.36% of pixels differ, every command box of at least 16x16 px is within 17.3/255 in the mean
(a smaller box is more offset than fill: the boxes differ by up to 3.16 px, and an 8x8 dot is half offset), every text's
ink box is within 3 px, the frame's mean colour within 1.41/255 — `check.mjs`'s numbers (20/255, 4 px, 3/255, 12%) hold.
(d) the keys: Playwright's keyboard into the Widgets page — a press on the canvas focuses it (`document.activeElement`),
Tab twice puts the `Wi-Fi` switch's node in the a11y tree at `focused: true` and draws the 2 px ring at its edge
(90,170,255 one px in), Space sets `checked: true` and turns the track's fill from #3c404e to #f08c32 (the accent at a
pixel of it), ten more Tabs reach the settings tree (the `Network` item) and ArrowDown moves the roving node to `Wi-Fi`.

### The dev server: a save builds, and the page reloads

`bun browser/serve.ts`, from `native/`, is the whole loop: it builds both artefacts with the scripts above into a temp
directory (`browser/build.sh` for `page.wasm` and `ui.wasm`, `browser/solid/build.ts` for the bundles), serves
`browser/` and them at one origin, and watches the builds' inputs — `browser/`, `solid/`, `desktop/clay_dump.c`,
`vendor/clay/`, `generator/`, `examples/sensors/`, `apps/` (the Sky page imports apps/csssky's api and models) and
`packages/cssints/dist`. A save's extension picks the build: `.c`/`.h`/`.sh` is the wasm, `.ts`/`.tsx`/`.jsx` is the
bundles, a change under `packages/cssints/dist` is both, and a `.js`/`.html` is no build at all, only a reload. Each
build writes into a staging directory and is copied over the served one — renamed into place, so a fetch never sees half
a file — only when the child exits 0, and the open pages reload over a `text/event-stream` at `/__events`; the client is
a script the server injects into every `text/html`, so the htmls are untouched.

```sh
bun browser/serve.ts                  # http://127.0.0.1:4173/browser/solid/index.html (Sensors)
bun browser/serve.ts --port 0 --open  # a free port, and the browser opened on the page
```

The reload is `location.reload()`: a page's Solid state is lost and the thread it opened is gone — an honest "reload on
save", not a hot swap. A page that opts in is re-mounted instead, and the reload is what a `.c` save and a page without
the opt-in get — the hot re-mount is the next section. HMR proper — a component's signals kept across an edit, a style
patched rather than rebuilt — needs the module graph, i.e. the cssints plugin and Vite's client in this path (`apps/docs`
has them: the engine's own `cssints/vite`); a `.c` save is a new `ui.wasm` whatever else is hot, because the page holds
one `WebAssembly.Instance` (`browser/solid/ffi-browser.ts`).
The desktop's loop is its own, below; this server cannot help it: the page there is a Bun process that opens a window over
`libui.dylib`, not a document at an origin, so there is no page to reload.

### The hot re-mount: the shell's state survives, the page's does not

A bundle-only save is the one thing a page can keep. The server pushes `hot` instead of `reload` — one event on the same
`text/event-stream`, its data one JSON line, `{"v":3,"why":"solid/app/Widgets.tsx","ms":3854}`: the version a page
imports its bundle at, the file that changed and the bundle build's ms — and a page that opted in
(`mountPage({ ..., hot: true })`, today the Widgets page, `browser/solid/widgets.ts`) does not navigate. The injected
client calls `window.__hotSwap(v)`, the shell's own `import("<this bundle>?v=" + v)`, and the new module's `mountPage` —
a second copy of the shell, its own Solid runtime — finds the page load's **host** on `globalThis` instead of making a
second one: the canvas and its context, the `WebAssembly.Instance` and Clay's state in it, the font, the canvas's 11 DOM
listeners and the pointer. A **session** is one page: the Solid tree, the frame, the drawer, one rAF and
`window.__page`. The new session's tree is rendered first (a save that parses and throws while it renders leaves the old
page drawing and its error in the bar), then the old session is stopped (`cancelAnimationFrame` and the Solid `render`'s
dispose), and the host carries over what was never the page's. `?hot=0` is the old reload; a page that does not opt in
(the Sky's own loop, the Field's own listeners) reloads, and the client falls back to `location.reload()` when
`window.__hotSwap` is absent.

What survives, measured on the Widgets page: the document does not navigate (`performance.timeOrigin`), the same row is
still hovered (the host's pointer, 48,53,68), `document.activeElement` is still the canvas, the document's scroll is
where it was, and the wasm's counters carry on — one instance, `presents` 31 → 53 (and 97 → 22 after the `.c` save
below). What does not: the switch reads
`checked: false` and its 2 px focus ring is gone, because its signal is the component's and a new module is a new
component; the page's `Input` (the focus manager), its scroll machine and its state are all new. **The shell survives,
the page does not** — the state a person put into a page is lost on a re-mount as on a reload. The same save with the
full reload, side by side, also costs the pointer (no hover: the row shows the page's 16,18,24), the focus and the
counters (`presents` restarts at 22) — and the switch is unchecked there too. Chrome restores the document's scroll
across a reload (`history.scrollRestoration` is `auto`), so that one is not what a re-mount buys.

A `.c` save is still a reload: a new `ui.wasm` is a new `WebAssembly.Instance`, and the page's id table, Clay's arena and
its counters are its — the server sends `reload` for the wasm and for `both` (cssints' `dist` compiles styles into both).
A broken `.tsx` save is still only an `error` event: nothing is published, the page keeps drawing the frame it had (the
same hash) and the bar has the compiler's own `Unexpected token` in `solid/app/Widgets.tsx`; the fixed save re-mounts it.

Cost, `browser/hot-check.mjs` on an M2 sharing its cores with two sibling worktrees, medians of three at a load average
of 29/13/10 (1/5/15 min): a `.tsx` save to its new frame **4125 ms** hot (3949, 4125, 4265) against **4315 ms** for the
reload (4315, 3942, 4615) — the build is most of both, so the two are within the machine's noise of each other; after
the build, the hot re-mount is **37 ms** (the bundle's import, its render and the first frame) against the reload's
**71 ms** (navigation, wasm, font and mount). A `.c` save reached its new frame in **2290 ms** (its build 2.4 s). Three
re-mounts cost **4.6 MB** of `usedJSHeapSize` (3.4 → 7.9 MB; 3.2 MB in an earlier run — the garbage collector's
moment, a fresh copy of the bundle and its Solid runtime, the host's copy staying), and leave the canvas at the **11**
listeners it started with and the loop at **62 frames/s** — one rAF, not four. Real HMR needs what this path still has
not: the module graph. A style change is
compiled into the bundle by the cssints plugin, so it is a new module and not a patchable string; patching a style, and
keeping a component's signals across an edit (`solid-refresh`), want the engine's own `cssints/vite` plugin and Vite's
client here, as `apps/docs` runs them. The mutations that would fake this are checked too:
`browser/hot-check.mjs --mutate=dispose` (the old session not stopped: 240 frames/s, four loops) and `--mutate=state`
(claiming the switch survives: `the switch reads checked: false, not true`) both fail the check, which exits 0 only when
a mutation is caught.

### The desktop's dev loop: a save restarts the window

`bun solid/watch.ts <page>`, from `native/`, is the desktop's loop: `bun solid/main.ts <page>` in a child, the page's
and the engine's inputs watched, and the page restarted when a save changed one. The page's own flags go through as
written (`--frames`, `--png`, `--warm`, `--bench`), and a headless run stays one shot: the child writes its frame and
exits, and the watcher exits with its status, so `solid/test.sh` keeps calling `bun solid/main.ts` itself. `--hold`
keeps the watcher up for a headless save loop; `--root DIR` runs and watches another tree, which is how the check runs
on a temp copy.

| a save of                                                                  | the loop does                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `solid/native/*.c`, `*.h`, `*.sh`, a `vendor/clay/*.h`                     | `sh solid/native/build.sh` (`build/solid/libui.dylib`), then a restart    |
| `packages/cssints/src/*.ts`                                                | `bun run build` in `packages/cssints` (the engine's dist), then a restart |
| `packages/cssints/dist/*`                                                  | a restart: that is the engine's build product                             |
| a `.ts`/`.tsx` under `solid/`, `examples/`, `apps/`, `focus/`, `headless/` | nothing but the restart                                                   |
| a stored frame, a golden, a scene, a test, `solid/watch.ts`                | nothing                                                                   |

The page reads its modules once per process (Bun's loader, the cssints plugin's Node children, one `dlopen` of
`libui.dylib`), so there is no reload in place: a restart is a new process and a new window. The old window is kept
until the new process has a window of its own (`main.ts` prints `window: pixel density N` once SDL has one), so a save
that fails to compile — a broken `.tsx`, a colour the cssints plugin rejects — exits first, the old window keeps
drawing, and the compiler's own text is printed by the watcher. A failed `.c` save keeps it too: the running process
holds the loaded image, whatever cc did to the file.

```sh
bun solid/watch.ts sky                  # the Sky page; a save restarts it
bun solid/watch.ts list --frames 2      # the flags pass through to solid/main.ts
bun solid/watch.ts --png out.png --hold # headless, and stay up for saves
```

Cost, three runs a kind, medians, on an M2 sharing its 8 cores with two sibling worktrees that were building and
testing: the load average was 41-66 across the runs below (an earlier set under 72-114 gave 38.4 s, 47.3 s and 34.5 s
— the loop's cost is mostly the machine's). A colour change in the Sky's palette (`solid/app/Sky.styles.ts`) reached
the new window's first frame in **11.6 s**, a `.c` save in **24.9 s** (its dylib build 4.0 s of it), a
`packages/cssints/src` save in **35.9 s** (its engine build 17.0 s of it). The restart is the cost: at every start the
page's `.tsx` and its `.styles.ts` go through the cssints plugin in Node children, ~11 s here.

The check is `solid/watch-check.mjs` (in `solid/test.sh`), on a temp copy of the tree as `--root`: the frame is the
Sensors page's (its background and the pill's surface, read out of the PNG through the tree's own `libui.dylib`), a
style save restarts it and the new colour is on the page, a broken style save prints the compiler's text and leaves the
last good PNG, a `.c` save moves `libui.dylib`'s mtime and a `.tsx`-only save moves neither it nor the engine's `dist`.
It writes no file of this tree.

What the loop cannot do is reload in place. A `.ts`/`.tsx` save could be re-evaluated with a cache-busting import and
the page re-mounted over the same Clay root (its state would be the new mount's), but the window and the loaded
`libui.dylib` live in the same process, so a `.c` save is a new `dlopen` and therefore a new process whatever else is
hot: the restart is the loop's unit. The terminal is out of it: `bun terminal/solid.ts` is a second host over the same
page and the same plugin (its `libterm.dylib` comes from the same build script), it has no window to keep — a live run
owns termbox2's alternate screen and its headless `--dump` is one shot — and it draws one page, `solid/app/Sensors.tsx`.
A watcher for it is this file with `solid/main.ts` swapped for `terminal/solid.ts`, left out until the terminal has pages
of its own to iterate on.

A failed build keeps the last good artefact: the page is not reloaded, it keeps running, and the compiler's own text
goes out as an `error` event — a dark red bar at the bottom of the page and a `console.error` — until a save builds.
Cost, `browser/serve-check.mjs` on an M2, three runs: two ran under a load average of 70-170 (other work on the same
machine) and one on a quiet minute, so the median of the three is a loaded one — the first build **101.3 s** (wasm
58.1 s, bundles 43.1 s), a `.ts` save **38.0 s** to the bundles and **38.2 s** to the page's first frame, a `.c` save
**21.4 s** to the wasm and **21.6 s** to its first frame. On the quiet run: the first build **25.5 s** (wasm 15.0 s,
bundles 10.5 s), a `.ts` save **11.4 s** / **11.7 s**, a `.c` save **2.5 s** / **2.6 s** — the loop's own cost; the
loaded numbers are what a busy machine makes of it. The bundle build is the cost: `Bun.build` over eight entry points,
each page's `.tsx` through Solid's compiler and cssints in a Node child, so any `.ts` save rebuilds all eight
(`src/frame.ts` and `src/renderer.ts` are shared by all of them). `--root` builds and serves another tree, which is how
the check runs on a temp copy.

### The renderer's effects, on a command array

The desktop's ThorVG renderer draws four things a Clay command does not carry, from tables beside the commands
(`browser/ui.c` fills them, `browser/draw.js` reads them back with the commands, `readEffects`):

| effect   | from                                                                    | how it is drawn                                                                                                                                                                                                                                                                                                                                                           |
| -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shadow   | `ui_shadow(x, y, blur, r, g, b, a)`, the value channel's 45             | the element's first command's box, moved by the offset, of the command's radii, filled in the colour and blurred by Canvas2D's `filter: blur(blur / 2)`: the same gaussian, ThorVG's sigma being half the CSS blur                                                                                                                                                        |
| gradient | `ui_backgroundImage(kind, angle, count, stops)`, the value channel's 50 | the element's first rectangle filled with `createLinearGradient` along CSS's gradient line (the direction (sin θ, −cos θ), the length \|w·sinθ\| + \|h·cosθ\|, from the box's centre); at a gradient alpha below 255 the box's solid fill under it, as the desktop cross-fades. **Smooth interpolation: no dither** (see the deviations)                                  |
| group    | the value channel's 46–49 and 55 (`ui_value`)                           | the element's subtree's commands — the range the C works out from the frame's element tree, which Clay's commands carry as `userData` — drawn into an offscreen canvas of the frame's size and composited once: `globalAlpha` of alpha/255, then the translate, the rotation and the scale about the first command's box centre (one matrix, `Clay_ThorVG_SettleGroup`'s) |
| image    | `ui_image(path)`, a `css.image` style                                   | the picture decoded from its path once (`Image`), `drawImage` scaled into the command's box, as `tvg_picture_set_size`                                                                                                                                                                                                                                                    |

A backdrop (`ui_backdrop`) is a fifth: `draw.js` reads the element's first rectangle's box out of the canvas with
`getImageData`, blurs it three times each way (the desktop's `Clay_ThorVG_BoxBlurH/V`: a box of radius
`(sqrt(1 + 4 sigma^2) - 1) / 2`, `sigma = blur / 2`, the region's edges clamping the window) and writes it back with
`putImageData`, then draws the element's own translucent fill over it — the desktop's cut, without a second scene. The
Dialog's menu is the one page with a backdrop; it costs **0.8 ms a frame** for its 150x134 box (below).

The image path a style carries is an absolute path in this checkout: `sky.ts` maps the part from `/examples/` on to the
page's URL, and the check's server serves the repo tree, so the avatars are the committed PNGs.

### The Sky page in the browser

`browser/solid/sky.ts` is `page.ts`'s sibling for `solid/app/Sky.tsx` **unmodified**: `src/input.ts`'s `createInput`,
with the DOM's `key` names (they are already the parts': `Tab`, `ArrowDown`, `Home`, `PageUp`, `Escape`, `Enter`, `" "`),
the wheel to `ui.wheel` and then the page's own scroll track (`src/vscroll.ts`), the pointer's press and release on the
event as `page.ts` has it, and the page's thread loader a promise that never settles (no frame asks a network). It is
the first page with the effects, and it has all of them but a backdrop: three gradient cards, three drawn avatars, and
the cards' entry — twelve pixels down and transparent, each card 50 ms after the one before — which is the value
channel's group, so the entry exists on this target only because the group fields are drawn.

`sky.html?bench=0` leaves out the page's twenty-frame auto bench: the entry has to start at the first frame the check
asks for. `node browser/sky-check.mjs`:

| what                                                         | measured                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the settled frame (`warm 45`) against `solid/frames/sky.png` | every command's box mean within **12.8/255** (the worst is `alexjungle.bsky.social`'s card, where Canvas2D's line heights put a line a pixel lower), every text's ink box within **1 px** (`sky`), the frame's mean colour within **2.32/255**                  |
| pixels                                                       | **73.79%** differ at all, **39.00%** by the dither's one level or two, **7.30%** by more than 2/255 — the threshold the check holds to 12%: the rest is glyph hinting and anti-aliasing, and the gradient's banding (below)                                     |
| the card's gradient                                          | top **26,31,37** (the panel token is 27,32,38: the desktop rounds its end one level the other way), middle 24,29,34, bottom **21,25,30** (the deep end, exact); a row across it varies by 1/255; 2 stops, 180°                                                  |
| the avatars                                                  | three pictures 40x40; michaelwarburton's centre **99,178,255** and body **74,132,214**, sky.test.ts's own numbers, **0/255** off                                                                                                                                |
| a shadow (a scratch canvas: no page here has one)            | **37/255** of a black shadow's blur 4 px outside its box, nothing 44 px out                                                                                                                                                                                     |
| the entry (8 frames in)                                      | three groups, the first at alpha **179/255** and **3.59 px** down: inside its card **22,26,31**, between the page's 16,19,22 and the card's resting 25,29,35, and 3 rows below the card's resting edge are the card. At rest: no groups, nothing below the edge |
| the page at rest                                             | 30 frames draw nothing (`ui_draws`): the frame hash folds the effect tables in, a settled frame's is the one before it                                                                                                                                          |
| the bar and the wheel                                        | a real click on the Science tab switches the feed (`Erik Strub`'s card), and three notches glide its cards **78.0 px** up (one event is one notch, SDL's sign: `src/vscroll.ts` takes it)                                                                       |

Every one of them is a mutation the check catches (each measured by breaking `draw.js` alone, the bundle rebuilt):
a gradient drawn as the box's flat colour — the gradient's bottom reads 27,32,38 instead of 21,25,30 and the frame's
mean colour goes 5.09/255 off; a group's alpha ignored — the card's inside reads its resting 25,29,35; a group's
translate ignored — 0 rows below the edge; the pictures not drawn — the avatar reads the card's 26,31,37, 219/255 off
its author's hue, and its box's mean 139.8/255; the shadow not drawn (or not blurred) — alpha 0 where its blur is.

The deviations, honestly: **no dither.** The desktop stipples every gradient by a 4x4 Bayer pattern of ±1 (its
`Clay_ThorVG_Dither`), which breaks the banding of a 190 px card; Canvas2D interpolates smoothly and bands where the
gradient is shallow — the card's 6-level run over 190 px shows as bands of about 30 px. It is why 39% of the pixels
differ by a level or two, and it is visible in the cards' darkest stretches, not in their means. Everything else that
differs is the rasteriser: Canvas2D's glyphs against ThorVG's advances (the card boxes move a pixel or two, so a
region's mean takes the worst 12.8/255), and the anti-aliasing of the avatars' discs and the cards' rounded corners.

What it still is not, honestly: the four pages whose keys and scroll machines are untried here (Text field, List,
Sheet, Dev — `src/vscroll`'s wheel is in, `Input`'s typed text is not); the backdrop's blur on a second page (the
Dialog's menu is the only `css.backdrop`); no touch (the wasm still has `ui_touch_map`, nothing sends a finger's event);
no HMR or dev server story — the bundles are built once, by hand; and the framework's cost is the bundle's 240 KB
(Sensors, 57 KB gzip) and 336 KB (Widgets, 75 KB gzip) against the no-JS page's 5 KB, for a JS tree and 12 Tab stops
instead of a static frame. The generated C stays the no-JS path, which is what the board already is.

### The Dialog page in the browser

`browser/solid/dialog.ts` + `dialog.html` run `solid/app/Dialog.tsx` **unmodified** (360x480) with its own
`createInput()`: `Tab`/`Shift+Tab` walk the page, `Enter` opens the modal and moves the focus to Cancel, `Tab` then
cycles the dialog's two controls (the trap is `input.modal`, so the page's own controls are unreachable while it is
open), `Escape` closes it, and `Tab Tab Enter` opens the Zoom menu, whose arrows, `Home`/`End`, `Enter` and `Escape` are
the desktop's. `?glass=0` renders the menu without `css.backdrop` (the app's `glass` prop) for the A/B below;
`?bench=0` leaves out the shell's twenty-frame auto bench, so the check's motion clock starts at its first frame.

**The floats.** Both overlays are Clay root floats (`css.float({ root: true })`): the backdrop is the whole window, dims
it and captures the pointer; the panel is centred on the root and captures too. The menu is a float parented to
`zoom-trigger`. Clay lays them out; the browser surface needed **nothing new for the floats themselves** — the packed
style already carries the float's attach/offset/expand/z/capture (slots 32-44) and the value channel's offset y (field
39), so the layout is the desktop's. What the page did need was the two renderer effects beside them: the group (fields
46/47, the panel's and the menu's alpha and scale) and the backdrop, which the shell now hands to `draw.js` with the
commands (`readEffects`) — the Sensors and Widgets pages have no effect, and their frames are byte-identical after it.

**The backdrop's blur.** `ui_backdrop` is still recorded and hashed as before; `draw.js` now draws it. At the element's
first rectangle it takes the pixels under that box with `getImageData`, runs the desktop's separable box blur (three
passes each way, radius `r = (sqrt(1 + 4 sigma^2) - 1) / 2` with `sigma = blur / 2`, the box clamped at its ends) and
writes them back with `putImageData`; the element's own translucent fill is then drawn over them, so the glass's text
and border stay crisp. Only the box is read and written: a pixel outside it does not move. A backdrop inside a scissor
is not blurred (the desktop's rule), and a second one in the same frame would blur the first one's pixels (the desktop
cuts once) — the Dialog has one.

Its cost: the menu's 150x134 box is **0.84 ms a frame** — the same page at rest with the menu open reads 1.91 ms a
frame with the glass and 1.07 ms with `glass: false` (100 frames each, headless Chromium, M2). The modal's backdrop is a
plain `rgb(0 0 0 / 0.55)` rectangle with no `css.backdrop`, so opening the modal costs the panel's shadow instead:
0.12 ms a frame closed, 1.92 with it open. The bundle is 245,583 B (`dialog.js`, unminified), the page 1,663 B and
`ui.wasm` 141,104 B, unchanged.

`node browser/dialog-check.mjs` (in `solid/test.sh`, the same zig/bun/Chromium guard as its siblings):

| what                                                                                                           | measured                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the closed frame against `solid/frames/dialog-closed.png`                                                      | **6.40%** of pixels differ; every command box's mean within **15.9/255**, every text's ink box within **4 px**, the frame's mean within **0.93/255**                                                                                                                          |
| `Enter`, 30 frames: the open frame against `solid/frames/dialog-open.png`                                      | **24.52%** of pixels differ (the shadow's soft falloff is two rasterisers'), box means within **13.6/255**, ink within **3 px**, the frame's mean **1.01/255**; the panel `40,163,280x154` centred, the backdrop `0,0,360,480`, the shadow's blur 32                          |
| the backdrop's dim                                                                                             | the page `16,18,24` reads **7,8,10** under it: `rgb(0 0 0 / 0.55)`                                                                                                                                                                                                            |
| a pixel of the panel's shadow                                                                                  | 4 px left of the panel **6,6,8** (luma 6.1) against the dimmed page **7,8,10** (7.9)                                                                                                                                                                                          |
| the entry 3 frames in (`keyboard.down` + 3 frames is exactly 3/60) against `solid/frames/dialog-entry-mid.png` | **31.80%** of pixels differ, box means within **15.1/255**, the frame's mean **1.15/255**; the panel **7.81 px above its rest**; the group at alpha **239/255** and scale **0.978**; inside it **35,39,50** between the dimmed page **11,13,17** and the settled **36,40,52** |
| the menu 2 frames into its slide against `solid/goldens/dialog.json`                                           | 22 commands, every field the golden's, the worst box **3.59 px** (`"200%"`, Canvas2D's line heights), and the effects tables identical: the shadow at blur 3.45, the backdrop at 10, the group at alpha 233, scale 0.9703, rotate -1.484°                                     |
| the settled glass against `solid/frames/dialog-menu.png`                                                       | **20.62%** of pixels differ, box means within **18.7/255**, ink within **4 px**, the frame's mean **1.16/255**                                                                                                                                                                |
| the blur, A/B against `?glass=0`                                                                               | over the trigger's border the glass reads **22,24,30** and the same page without it **40,43,49** (**19/255** apart); the worst step down a 16 px scan across that border **1** under the glass against **23** without it; nothing outside the menu's box moved                |
| `Escape`                                                                                                       | the closed frame again, **0 of 691,200** pixels differ, and the same commands and effects                                                                                                                                                                                     |
| the trap                                                                                                       | `Enter` focuses Cancel; `Tab` cycles OK -> Cancel -> OK -> Cancel, `Shift+Tab` back to OK; the page's Open settings is never a stop                                                                                                                                           |

Each holds as a mutation: drawing the backdrop as its flat tint alone (no blur) fails only the A/B — over the trigger's
border both pages read `40,43,49`, "the page under the glass is not blurred" — while the menu's region means still pass,
which is why the A/B is there; ignoring the value channel's float offset y (field 39 in `browser/ui.c`) makes the
mid-entry panel read `y 163.00`, "not above its rest 163.00", and moves the menu's golden frame's `"200%"` box by
16.18 px.

What is not there, honestly: the glass is the Dialog's alone (no other page has a `css.backdrop`); the menu's group and
its blur are drawn per frame, so a page that blurs every frame pays the 0.8 ms; a second backdrop (or glass under glass)
would read the first one's pixels; the mid-entry frame's _text ink_ is not compared, because the translucent panel
covers the page's own `100%` row there and the two rasterisers put that row's bottom 7 px apart (the panel's offset, the
group's alpha and scale, and the box means are); and there is still no touch (the wasm has `ui_touch_map`, nothing sends
a finger's event) and no HMR (the bundle is built by hand).

### The List and the Text field in the browser

`browser/solid/list.ts` (`list.html`) and `browser/solid/field.ts` (`field.html`) are the shell's third and fourth pages:
`solid/app/List.tsx` and `solid/app/Field.tsx` **unmodified**, each with its own `createInput()`. They are the two things
the shell could not carry: a page that owns its scroll offset, and a page that takes typed text.

**The wheel, into the page's own track.** The List's viewport is `src/vscroll.ts`'s machine, not Clay's scroll
container (`ui.autoScroll(false)`, and the track writes the offset into the clip element every frame), so a wheel event
has to reach the page's `motion.onWheel` — which the shell drains `ui.wheel` into before each frame, and the page then
asks `ui.over` whether the pointer was on the viewport or on its visible thumb. A DOM wheel event's delta is in pixels
and the machine counts notches (10px each, SDL's ±1), so `list.ts` reduces the host's delta to its sign, one event a
notch, with the sign turned round (SDL's wheel y is positive away from the user, a browser's `deltaY` positive scrolling
down) — the mapping `sky.ts`'s own wheel already makes. Measured: three notches, a rest frame apart (a run at 60Hz is a
flick, which the track flings), move the offset **30px** and row 0's top by **−30.00px**; the thumb is then at the
viewport's top **+8.02px**, **64.14px** tall (max(24, 240²/898)) and 4px wide 2px in, which is `barOf`'s geometry for
30px of 658. Tab brings the selected row back into view (the offset eases to 0) and ArrowDown moves the selection a row:
the readout goes "Room A1 — 1 of 30" → "Room B1 — 2 of 30" and the new row is the flow's only filled one (36,40,52,255).

**The typed text, through `Input.textInput`.** A canvas is no editable element: no `beforeinput`, no `input` and no
composition event is dispatched to it, so `field.ts` takes the printable characters from the `keydown`'s `key` — the
string SDL's TEXTINPUT gives — and calls `Input.textInput(text)`, the call `main.ts` makes for SDL's text events, one
frame on the event. The keys the focus manager's table drops stay the shell's (Tab, Shift+Tab, Backspace, Delete, the
arrows, Home/End, Enter, Escape); Shift with Left, Right, Home or End is a selection chord, which `keyName` refuses as a
move and `keys.ts`'s `selectionChord` names ("Shift+ArrowLeft"). Measured: Tab twice focuses the field (the a11y
snapshot's `textbox "Name"`, the caret at x **52**), typing "Ada" reaches the page's own state and the frame
(`Value: "Ada" (3)`, the caret after the run at x **80.16**), Backspace is one character and one advance (**−8.70px**),
and two Shift+ArrowLeft make a run of **19.46px** whose middle is **97,69,51** — the accent at 30% over the field's
36,40,52 — with the caret 1px before it. `browser/draw.js` draws a command's own alpha for that (Clay's colour carries
one, ThorVG honours it; the selection is this target's first translucent plain rectangle), which changes no frame of the
other pages (every command they draw is opaque).

`node browser/input-check.mjs` holds them: the List's base frame against `solid/goldens/list.json` (36 commands, every
field, the worst box **0.94px** — Canvas2D's line heights rounded up), its raster against `solid/frames/list-top.png`
(**7.18%** of pixels differ; the boxes' means within **14.4/255**, the text's ink within **1.00px**, the frame's mean
within **1.55/255**), and the wheel, the thumb and the keys above; the field against `solid/frames/field-typed.png`
(**11.53%**; **15.3/255**, ink **4.00px**, mean **1.23/255**), the typed run's ink in the same box as the desktop's
(52..80 px), the caret's and the selection's pixels above. Cost: `list.js` **197,252 B** (49,199 B gzip) and **0.17 ms**
a frame, `field.js` **236,785 B** (55,208 B gzip) and **0.14 ms** (100 frames: the tree declared, Clay's layout, the
commands, Canvas2D's raster, one readback), on the same `ui.wasm` (141,104 B, 52,269 B gzip) as the other pages.

What they are not: no pinch or long-press (a page has one pointer, as on the desktop), and no real touchscreen on this
machine — the finger's path is Chromium's own touch through the DevTools protocol, and the List's rows and its thumb
and the Sky's feed drag under it (`browser/touch-check.mjs`, below); an IME is driven as its events and not as a
candidate window (`browser/ime-check.mjs`), and a clipboard read is the page's permission. The drags are the machine's,
and they are the machine's for a finger too: a press that does not travel is still a click. A typed character and a
selection chord
are `preventDefault`ed, as the keys the shell consumes are (the shell's own `consumed` list: Tab, Space, the arrows,
Home/End, PageUp/Down, Enter, Backspace, Delete), so a character never reaches a browser accelerator; a Cmd, Ctrl or
Alt chord is the field's clipboard or the browser's (the subsection below).

### The input method and the clipboard in the browser

**Two paths, and the one each browser takes.** A canvas is dispatched no composition, so the text has to come from an
editable surface: Chromium's `EditContext` is the standard's answer (`canvas.editContext = new EditContext()`) and WebKit
has none. `browser/solid/text.ts` takes the EditContext where the browser has it — the canvas carries the control, and the
control's `compositionstart`, `textupdate` and `compositionend` are the page's — and a hidden, 1px, transparent `<textarea>`
where it does not: the textarea holds the DOM's focus, its `keydown`/`keyup` are cloned onto the canvas (a key the page
consumed — Tab, Space, the arrows — is `preventDefault`ed on the real event too, so the browser neither moves its focus nor
scrolls), its `beforeinput` cancels the plain character the keydown already took, and its composition events are the
composition's. `?ime=input` forces the fallback, which is how `browser/ime-check.mjs` drives both paths in one browser:
Chromium takes the EditContext, and the forced page is the textarea's (no `canvas.editContext`, the TEXTAREA focused).

**What a composition does to the model: one insertion, at its end.** The desktop has no composition at all — SDL hands it
committed characters — so the draft an IME presents never reaches the page's model, only the context's view of it (the
paragraph below), and nothing is inserted, declared or drawn while it is being composed (the candidate window is the
browser's; a canvas gets no inline preview). `compositionend`'s string goes through `Input.textInput`, the call the desktop's SDL_TEXTINPUT makes, and only
while a text field has the focus (`textInput` answers false otherwise), then one frame. A keydown inside a composition is
the IME's, and the page's character path drops it (`text.composing()`). Measured: the draft "Ada" (three `textupdate`s)
leaves the value `""`, the frame's 20 commands and its 18 px of caret ink exactly as they were; `compositionend` with
"Ada" gives `Value: "Ada" (3)`, the caret at x **80.16** and **192 px** of ink in **52..80 × 212..229** — the numbers
`input-check.mjs` measures for the same run typed key by key.

**The mirror an IME reads.** The context is a view of the field, not a second model: `browser/solid/text.ts` keeps
`Input.field()`'s `{ id, value, caret, selection }` in it with `updateText(0, length, value)`, `updateSelection(anchor,
caret)`, `updateControlBounds` (the field's row) and `updateSelectionBounds` (the 1px caret box the page already draws),
and answers `characterboundsupdate` from the row's width over its length — one advance a character, the approximation
`press` makes, because the page draws runs and not per-glyph boxes. The sync runs **once a frame**, in the page's tick
before the tree is declared, and writes only what moved: a typed character, Backspace, an arrow, a selection chord, a
paste, a cut, select-all and a click's caret all land in the model and are mirrored by the next frame, so there is one
site instead of ten (and the model has no change notification a page could subscribe to); the boxes are the frame just
laid out, one frame — 16ms — behind the edit that moved the caret. **While a composition runs the sync is skipped**: the
IME's `textupdate` is applied to the context instead (the spec's own flow), so its text is the field's with the draft in
it, and the model takes the committed string only at `compositionend`, one insertion at its caret; the end re-syncs, so a
cancelled composition puts the field's string back. Measured: "Ada" typed then "na" composed gives the context
`"Adana"` at 5 while the model is still `"Ada"` at 3, and the commit `"Adana"` at the caret 5 with the typed path's
**305 px** of ink in **52..98 × 212..229**; a composition over the selected "da" replaces it (`"Ane"`, the caret 3,
**201 px**); `characterboundsupdate` 3..5 answers at x **121.00** against the drawn caret's **120.16** (y **520.00**
against **520.81**), not at the canvas's corner; the context's caret equals the model's after Backspace, Home, End and
both arrows (**4, 0, 4, 3, 4**), and a backwards Shift+Home keeps the direction (**4..0**). The fallback is the same
code path — one `Mirror` with two writings: the hidden textarea _is_ its own mirror (`value`, `setSelectionRange`, and its
1px box moved to the caret's pixel), so `?ime=input` holds the same numbers (`"Adana"` at 5, **305 px**; `"Ane"` at 3,
**201 px**) and a composition on it composes into the field's string rather than into an empty line.

**The clipboard.** Cmd/Ctrl+C, X, V and A on a focused field, over `navigator.clipboard` and the page's own model: copy is
`Input.clipboard("copy")` into `writeText`; cut is `Input.clipboard("cut")` — the field's own copy and backspace rule, the
op `main.ts` makes for SDL's chord — and then `writeText`; paste is `readText()` → `Input.textInput`; select-all is the
field's own Home then Shift+End, so no second selection model exists here. Copy, cut and select-all act on the event and run
one frame. A paste cannot: the permission is a promise, so the field is untouched until it settles and then one frame shows
the insert — the canvas keeps the old frame while the clipboard is being read, not a half-applied one. Measured:
Shift+Home then Ctrl+C puts `"Ada"` in the clipboard; Backspace empties the field; Ctrl+V brings it back (`"Ada"`, the caret
at **80.16**, the **192 px**); Shift+Home + Ctrl+X empties the field and keeps `"Ada"`; Ctrl+A selects the **28.16 px** run
and a key replaces the whole value (`"B"`). A chord on a page with no field focused is the browser's, as `keyName` decides
for the desktop's.

**Cost.** `field.js` **255,515 B** (**59,455 B** gzip) — **3,533 B** over the page before the mirror (251,982 B) —
`field.html` **1,865 B**, on the same `ui.wasm` (141,104 B). The mirror costs the frame nothing measurable: **0.13–0.14 ms**
at rest (the diff: one read of the model and four comparisons), **0.11–0.13 ms** with a composition open and
**0.09–0.11 ms** on an edit's frame, where the mirror is rewritten (a typed character and a Backspace, 120 frames; 100
for the benches, three runs) — the same band the page measured before it (0.14 and 0.12). The text is the model's until
`compositionend` and one `textInput` call; the clipboard is two DOM calls on the event and a promise on a paste.

**What genuinely remains.** A real input method was not driven: Playwright cannot, so the check dispatches the sequence a
composition produces (`compositionstart`, the `textupdate`s, `compositionend`) — no candidate window, no dead key, none of
an IME's own keydowns (Chromium's keyCode 229/"Process") — and what the tests hold is the string's way into the model, the
caret and the pixels it leaves, not the IME's. A script whose IME sends several clauses with `textformatupdate` (a
Japanese conversion, an autocomplete) is not driven either: the format is ignored and the committed `data` is what is
inserted. The EditContext now carries the field's string, caret and boxes, but a real IME's candidate window is still the
browser's and is not driven: the check dispatches the context's side of the protocol and reads back what the mirror would
hand an IME, not where a platform puts its window. The clipboard's permission is the page's: an insecure context has no
`navigator.clipboard`, so the chords fall through to the browser's own (a no-op on a canvas), and the check grants
`clipboard-read`/`clipboard-write` to its context rather than letting the browser ask. And the fallback's textarea takes the DOM's focus, so `document.activeElement` is the textarea
there and the canvas here (the canvas keeps the page's own ring and `aria-label` either way).

### The Dev page and the Text sheet in the browser

`browser/solid/dev.ts` + `dev.html` are `solid/app/Dev.tsx` **unmodified** at its own 660x760 — the Widgets page in its
360px column and the 300px panel beside it — and `browser/solid/sheet.ts` + `sheet.html` are `solid/app/Sheet.tsx` at
440x564, the static text sheet. Both are `mountPage` calls: the sheet takes no input and no hook, and it is still the
shell's page rather than a loop of its own, which is what "not a special case" means here. With them all eight pages the
desktop has are real in a browser (the Sky's own loop `sky.ts`, the other seven on the shell), and the Sky chapter's
"Sheet and Dev are still not here" is done.

**What the panel needed from the surface.** `Dev.tsx` reads the page's own tree (`snapshot`), the innermost box under
the pointer (`ui.over` + `ui.bounds`) and the frame's numbers (`stats`, pushed by `createFrame`, and `ui.draws` /
`ui.presents`), and prints them when the page changes. Of those the browser surface had `ui.over` and `ui.draws`; it
gained exactly two things. `Options.stats` (one member of `mountPage`'s options, handed to `createFrame` and
`createDrawer`, so the panel's phases and the draw's time are the loop's own) and the presents counter: `ui_present`
(called by the shell's `paint`, once a frame on the canvas, the desktop's window present) and `ui_presents` beside
`ui_draws` in `browser/ui.c` — **+67 B**, and every other page's frame is untouched. The pointer needed nothing: the
shell already feeds the press/release point into `frame(px, py, …)` → `ui_begin`, and that is the point `ui.over` answers,
so the panel's `deepest` and the page's `:hover` follow the real mouse; `dev.ts` hands the page the shell's `motion`
(its tick samples the panel, its `onPointer` pins a click) and its `drag` (the Widgets slider). The panel prints into its
own frame, not to the console — it is a Clay text like any other, and `window.__page.commands()` reads the lines back:

```
hover:  press  button "Presses: 0"          the panel's "hovered box", and in the live values
        press  button "Presses: 0"  40,72 280×40
keys:   switch "Wi-Fi" [checked=false focused=true] 40,118 280×32   after Tab, Tab
        switch "Wi-Fi" [checked=true focused=true] 40,118 280×32    after Space
frame:  draws 15  presents 15                                        the counters of the frame that printed
```

A row wider than the 276px of panel wraps: `checkbox "Beta (disabled)" [checked=false disabled=true] 40,258 280×28`
arrives in the page as two text commands. That is Clay's wrapping on a narrower measure (Canvas2D's), not a second row.

**The frames, measured.** `node browser/dev-check.mjs` (in `solid/test.sh`, the same zig/bun/Chromium guard):

| what                                                                                                                                                                                                                                    | measured                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| the Dev page's 360px column against `solid/frames/dev.png` (there is no command golden for this page: the panel prints the frame's milliseconds, so its text differs on every run — the panel is asserted through its commands instead) | **9.63%** of pixels differ, 51 command boxes' means within **17.3/255**, every text's ink box within **3.00px**, the column's mean colour within **1.62/255** — `check.mjs`'s numbers (20/255, 4 px, 3/255) hold; the 12% pixel band is what the Widgets page alone pays (8.36% against its own frame) |
| the panel                                                                                                                                                                                                                               | not compared pixel-wise, and that is the point: its 40 lines of 10px text are a pixel or two lower in Canvas2D's metrics (24.18% of its own pixels), and its printed numbers are the run's. What it says is checked as text                                                                            |
| the a11y tree                                                                                                                                                                                                                           | **28 nodes**, the Widgets page's, in its order (`button "Presses: 0"`, `switch "Wi-Fi" [checked=false]`, the unnamed `group no bounds`, …, `treeitem "Storage" [selected=false]`); no node's box is in the panel's column (every one ends at x ≤ 360)                                                  |
| the hover                                                                                                                                                                                                                               | the pointer on the button: `press  button "Presses: 0"` and the live values' `press  button "Presses: 0"  40,72 280×40`; the pointer over the panel prints `nothing` (the panel is not the page)                                                                                                       |
| the keys                                                                                                                                                                                                                                | Tab, Tab: the panel's row is `switch "Wi-Fi" [checked=false focused=true] …`; Space: `[checked=true focused=true] …`; the frame's hash moves and the key's frame draws and presents (13 → 16 draws)                                                                                                    |
| the page at rest                                                                                                                                                                                                                        | **30 frames, 0 draws and 0 presents**: `ui.draws`/`ui.presents` stand still, which is what a panel that reprinted every frame could not do                                                                                                                                                             |
| the Text sheet's 13 commands against `solid/goldens/sheet.json` (a new golden, `bun solid/dump.ts sheet --update`)                                                                                                                      | every field the golden's, the worst box **7.24px**: `"Wm ¼ ⅓ — “quotes”"`, whose ⅓ is one face's empty box in ThorVG and a fallback glyph in Canvas2D, so its advance differs (8 px is this page's band; the other 12 lines are inside 1 px)                                                           |
| the sheet against `solid/frames/text-sheet.png`                                                                                                                                                                                         | **4.04%** of pixels differ, 11 boxes' means within **14.6/255**, the frame's mean within **1.80/255**; the fallback line's ink is not compared (8 px of it is that glyph), the other eleven lines are within **0.00px**                                                                                |
| the sheet at rest                                                                                                                                                                                                                       | 30 frames, 0 draws: a static page is the frame hash's easiest case                                                                                                                                                                                                                                     |

| What               | Size                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `dev.js`           | 297,480 B (66,322 B gzip), unminified                                                                                                      |
| `dev.html`         | 1,598 B                                                                                                                                    |
| `sheet.js`         | 160,731 B (39,926 B gzip), unminified                                                                                                      |
| `sheet.html`       | 1,278 B                                                                                                                                    |
| `ui.wasm`          | 141,171 B (52,235 B gzip): +67 B for `ui_present`/`ui_presents`                                                                            |
| a frame, Dev       | **0.76-0.96 ms**: the page and the panel (28 a11y nodes, the hover walk, the panel sampled every frame), 100 frames, headless Chromium, M2 |
| a frame, the sheet | **0.13-0.18 ms**: the same, 13 commands                                                                                                    |

Each is a mutation the check catches (measured by breaking one thing, rebuilding): the pointer not reaching `ui_begin`
— `FAIL hover, the panel's readout: the panel has 0 lines naming the button`; `stats` not handed to the frame — `FAIL
the panel's counters: no "draws N presents M" line in the panel` (the panel prints `no frame yet` instead); a panel that
reprints every frame (the very thing the page exists to avoid) — `FAIL 30 frames at rest: draws 50 -> 80, presents 50
-> 80`.

What the two pages still are not, after them: the panel's live values edit through `ui.value` (the surface has had it
since the Dialog), but the check does not drive the arrows, and the panel's `s` (save a session) and the host's `--tune`
(read one) are file paths — Bun's browser bundle stubs `node:fs` to an empty object, so both are no-ops here. And what
was true of the chapter before is still true: **no IME** (a canvas gets no composition event; typed characters are
`Input.textInput`'s, as `field.ts` has it), **no clipboard** (`paste` is an editable element's event), **no touch** (the
shell listens to the mouse only; the wasm's `ui_touch_map` has no fibre of it), **no pointer drag** beyond the Widgets
slider the shell hands the page (the List's rows and thumb, the Sky feed's fling are the desktop tests'), and **no HMR or
dev server story** — the bundles are built once, by hand, into `$TMPDIR`.

### A finger in the browser

The DOM's touch is the pointer events a touchscreen sends, and the shell had the mouse's and not these. `shell.ts` (the
five shell pages) and `sky.ts` (its own loop) now listen to `pointerdown`/`pointermove`/`pointerup`/`pointercancel` with
`pointerType === "touch"`: the same `at()` mapping as the mouse's, `down` while the finger is on the canvas, up where it
lifts, and the frame's fourth argument — `src/frame.ts`'s `touch` — **true**, which is the flag `src/vscroll.ts` reads
for a drag with no click threshold (and what `main.ts` gets from SDL's `out[5]` on the desktop). The mouse's listeners
are untouched and their frames stay `touch = false`; a `pointercancel` (the browser taking the gesture back) ends it as a
lift at the last point, and `setPointerCapture` on the press keeps a finger that leaves the canvas lifting on it.
`pointerdown` is `preventDefault`ed, so a tap sends no compatibility mouse events and one tap is one press and one
release, and the canvas has `touch-action: none` (in `shell.ts` for its five pages, in `sky.html` for the Sky) — without
it the browser pans the document from the finger and sends the page a `pointercancel` instead of the drag. `window.__page`
grew `touch()` (the flag the last frame's `onPointer` got), `touches()` (the finger's events the canvas has taken: a check
waits on it, since a CDP call resolves before the renderer runs) and `offset(id)` (a clip element's offset,
`ui.scrollOffset` with its sign turned round), so a check can ask what the frame saw and where the offset is.

**`browser/ui.c` needed nothing.** The flag never enters Clay: `ui_begin` carries the button and the time, and a finger is
the same pointer as the mouse _above_ that line. `ui_touch_map` is the desktop's mapping from SDL's normalised window
coordinates; the browser's pointer events are already in CSS pixels of a canvas drawn at 1:1, so the shell's `at()` is
that mapping, and no C changed. The wasm is still 141,104 B.

**The List, by finger.** A press inside the viewport and four moves of 10px up: the offset is **40.000px** and row 0's
top moved **40.000px** with it (`vscroll`'s drag is direct manipulation: the offset is the press point's less the
pointer's travel, no track in between). The drag does not select (the header stays "Room A1 — 1 of 30"), and a release
with the finger at rest for 12 frames ends there — **40.000px**, no throw: the release's speed is the last five frames'
travel, which is nothing (a finger that lifts while still moving does fling, as the desktop's `list.test.ts` has it). A
press that never moves is still a click: a tap on the third row selects it ("Room C1 — 3 of 30") and a tap on the first
row brings the selection back. **The thumb**: after a 40px drag it is up at `314, 112.69, 4x64.14` (4px wide, 2px in,
max(24, 240²/898)), a press on its middle holds the offset where it is (40.000: it does not jump under the finger), and
20px of drag down moves the offset **74.833px** — 20·(898−240)/(240−64.14), the thumb's own scale — while the thumb
itself moved **20.000px**; the release ends it at **114.833px**, no fling (a scrollbar is not a throw).

**The Sky, by finger.** Science's feed is 742px of content in the 664px feed, so 78px of it scrolls. 60px of drag are
**60.000px** of offset (1:1, the flag true on every frame); 120px are **100.323px** — the feed's end, 78px, then the same
rubber band the wheel pulls, `f(42) = 22.323` in a 664px feed — and the release lets the band go, resting on **78.000px**.
The throw is the desktop's own: the same 10px drag in five 1/60 frames (`solid/sky.test.ts`, through `__page.pointer` and
`warm` so the frames are exact) is released at **11.48px**, is **12.90px** the frame after (a positive velocity), and rests
at **54.955px** — the projection of its last frames' speed, the desktop's 54.95 to the hundredth, on a browser whose card
heights are Canvas2D's. A 5px drag then a release does not open the thread (the feed scrolled instead, which is
`vscroll`'s `dragged` and Sky.tsx's `onClick` rule), while a tap on the same card does (the thread, its Back, and a tap on
Back returning to the feed). And the flag's one rule, at 2px: a finger's 2px travel is **already a drag** — no thread, and
the frame's `touch` is true — while the mouse's 2px is a **click** — the thread opens, `touch` false. That is the desktop's
`sky.test.ts` pair, on this target's real input path.

**The mouse.** The four checks above are unchanged: `browser/solid-check.mjs`, `sky-check.mjs`, `input-check.mjs` and
`dialog-check.mjs` all pass, so the List's and the Sky's rasters at rest are the pixels they were (the stored frames and
`browser/expected*.png`). Inside the touch check, a 45px mouse drag on the List is **45.000px** with `touch` false, and a
touch drag and a mouse drag that end in the same place leave **byte-identical dumps** (the List's frame, element for
element) — the two pointers leave one page.

`node browser/touch-check.mjs` is the check, in `solid/test.sh` with the other four (skipped without zig, bun or
Playwright's Chromium). The input is Chromium's own touch through the DevTools protocol, `Input.dispatchTouchEvent`
(start/move/end) on a context with `hasTouch: true`, because Playwright's `touchscreen.tap` only taps and a drag is a
sequence of moves; the events arrive as `PointerEvent`s with `pointerType: "touch"`, which a synthetic event made in the
page would not be (the browser's compatibility-mouse and pointer-capture paths are half of what the listeners are for).
A CDP call resolves in the browser process before the renderer's listener runs, so the check waits until the canvas has
taken the event it sent (`window.__page.touches`, the listeners' own count); the frames are the check's (`warm`, 1/60,
the window loop held as in `sky-check.mjs`), plus the one frame an event runs itself, as the desktop's loop runs one
after every poll. **Cost**: the touch path adds **1,107 B** to `list.js` (200,586 → **201,693 B**,
50,079 → 50,252 B gzip) and **880 B** to `sky.js` (357,624 → **358,504 B**, 82,575 → 82,737 B gzip); a frame with a drag
in flight is **0.20 ms** on the List and **0.82 ms** on the Sky (100 frames, `ui.wasm` unchanged at 141,104 B). Not
here: **pinch** and any two-finger gesture (a page has one pointer; the desktop ignores a second finger too),
**long-press**, and the Widgets page's slider under a finger — the shell's touch path feeds `Widgets.tsx`'s own
`drag.onPointer` and every shell canvas has `touch-action: none`, so it should drag, but no check drives it. A **real
touchscreen** (this machine
has none: what is tested is Chromium's own touch pipeline into the shell, not a panel's), and HMR. `native/docs/map.md`'s
step 8 keeps the list.

## Solid on the terminal

Step 6's Solid half: two pages run as Solid over the terminal's cells. `solid/native/term.c` is Clay over
`terminal/cells.c`, `render.c`, `measure.c` and `tb2.c` — no SDL3, no ThorVG, no window — built as
`build/solid/libterm.dylib` beside `libui.dylib`, and it takes the same declaration surface the desktop's `ui.c` takes:
a packed 45-float box style, a 10-float text style and the value channel (`solid/src/pack.ts`'s `FIELDS`). So a page's
`styles.ts` is one module on both targets, and `solid/app/Sensors.tsx` and `solid/app/Sky.tsx` are the pages,
**unmodified**.

```sh
sh solid/native/build.sh                          # libui.dylib and libterm.dylib
bun terminal/solid.ts                             # live: the page in termbox2; q/Ctrl+C/Escape quits
bun terminal/solid.ts --page sky                  # live: the Sky feed (q/Ctrl+C quits; Escape is the page's back)
bun terminal/solid.ts --dump out.txt              # one frame headless, plain text ('.' is a fill); no file: stdout
bun terminal/solid.ts --ansi out.ansi             # the same cells as truecolour ANSI (SGR runs merged)
bun terminal/solid.ts --keys Tab,ArrowDown --dump out.txt     # the frame after each key, as main.c
bun terminal/solid.ts --click 40,9 --dump out.txt # a press and a release on the Units pill (the page's own onClick)
bun terminal/solid.ts --page sky --keys WheelDown,WheelDown --settle 90 --offset --dump out.txt  # the page's wheel, then its rest
bun terminal/solid.ts --page sky --keys Tab,Tab,Enter --settle 3 --dump out.txt    # the thread (Enter on the feed)
bun terminal/solid.ts --page sky --click 20,2 --settle 5 --dump out.txt            # the profile (a card's author row)
bun terminal/solid.ts --page notify --keys Enter --settle 3 --dump out.txt          # the notifications, and a row's thread
bun terminal/solid.ts --theme light --dump out.txt            # the light theme (also THEME=light)
bun terminal/solid.ts --cols 80 --rows 11 --bench 20          # the frame's ms, and the same cells as ANSI
sh terminal/test.sh                               # the comparisons below (native/test.sh runs it)
```

**The binding.** `term_open(cols, rows)` starts Clay and the grid — cols and rows headless, `0, 0` for termbox2's own
size — `term_begin(px, py, down, dt)` opens a frame with the pointer in cells (Clay's pixels are a cell's, 8x16),
`term_open_element`/`term_text`/`term_close_element` are the tree, `term_value` is the value channel, `term_end(dt)` lays
out and runs the commands into the grid (`terminal/render.c`: a fill is its cells' background, a border is `─│┌┐└┘`,
text at `x / CELL_W` one row, a scissor stack; `terminal/measure.c`: a code point a cell, a line a cell), and
`term_present`/`term_dump`/`term_ansi` are the three ways out. `term_poll(key, out)` is termbox2's next event within
16ms (0 none, 1 an event, 2 a resize, 3 quit; `out` is the pointer's cell and the button). `terminal/tb2.c` gained
`term_tb2_poll_ms` for that wait: the C host keeps blocking in `term_tb2_poll`, which is the same call with no timeout,
so the C pages' frames are untouched. The Sky page needed four things of the binding the Sensors page did not:

- a clip element's offset is read **after** the element is open (`Clay_GetScrollOffset` is the open element's offset, as
  the `CLAY` macro's is), so a page's own scroll reaches Clay's clip at all; the binding had read the parent's;
- `term_bounds`, `term_scroll_offset`, `term_scroll_to` and `term_scroll_put` (the four `ui.c` has), which is what
  `solid/src/vscroll.ts` measures the viewport with and writes the page's offset through;
- a **float** is declared with its attach, offset, z and pointer capture, not counted as an error and drawn as a plain
  box: Clay places it over the flow in the grid's own pixels, so the feed's thumb and the thread's screen keep their
  place. Only a float's shadow, backdrop and alpha fade are still a cell's to drop;
- a text's line height is the **cell's**, not the style's: Clay lays a text out at its `lineHeight` (the Sky card's 22px
  name was 1.4 rows and pushed every card out of its cells), so `term_text` writes `CELL_H` (measure.c already returns
  one cell a line). The per-frame value table is 1,024, because a feed's measuring pass declares every card of a page
  (51 with the second one, five values each) and the page's own writes are on top of that; a longer page needs a bigger
  table. The parts of a style a cell cannot show are still not declared: an image, a shadow, a backdrop, a gradient,
  and the group fields of the value channel (46–49, 55), which arrive and are dropped — the page's entry animation is a
  no-op in cells rather than a different frame.

**A page's frame.** `terminal/solid.ts` is the desktop loop's shape: `createInput()` (the keys named as `src/input.ts`
names them, Space as `" "`), the page's `Motion` hook, `flush()` for Solid, the tree walked in order, `term_value` for
the cell re-cut, Clay's layout and the cells. It is not `solid/src/frame.ts`, and honestly: that module imports the
desktop's `src/ffi.ts` and draws through `ui_draw`, so the host walks the same tree itself (~40 lines, without the
effects a cell has no command for) and aliases `solid/src/ffi.ts` to `terminal/term.ts` — the page's own
`pageEntry` therefore writes its motion into libterm. The two lengths page.c re-cuts, it re-cuts the same way, through
the value channel, not by editing the page: the root's padding (2 cells) and gap (0), and the pill's height (3 cells,
so a border, a line of text and a border are three rows). The pill's ring is the host's: page.c's `pill_style(focused)`
asks the page's focus, and `Sensors.tsx` has no focus prop, so the host draws the same accent border
(`styles.magnitude`'s colour in the theme that is on) while its own focus is on the pill. Tab moves it off the pill,
which is where the C page's list would take it; there is no list in `Sensors.tsx`, so the ring simply goes.

**The Sky feed.** `bun terminal/solid.ts --page sky` renders `solid/app/Sky.tsx` over the terminal's cells: its props are
the host's `input` (the headless parts and the focus manager), its `motion` (the page puts its wheel, its pointer and its
tick there), `theme`/`setTheme` (the host's `t`), `load`, `pages` — and two the desktop host has too: `screen` (the page
started on its notifications) and `mutate`. `pages` is what this step added to the page: the app's `homeScreen` at a
cursor, so the feed is the **data's** and not the six fixtures transcribed in the page (`posts`, the synthetic feed's
prop, still replaces Discover on the desktop). With no source the page is those fixtures, so the desktop and the browser
are unchanged; with one, the feed's first page is asked on the page's first frame, the next when its scroll reaches the
feed's end (the app's own sentinel at the list's end), and the cards are **appended below the reader** — the offset does
not follow them, because a page that arrived is not a re-measure of the same column. What the host re-cuts, through the
value channel (written by the walk just before each element opens, so a frame uses a value only for the elements it
declares), is the length set a cell cannot take as px:

| the page        | px                                   | the cell                                                                                                                                                                                       |
| --------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the bar         | 64 high, 0/16 padding, 20 gap        | 1 row, 1 cell, 1 cell                                                                                                                                                                          |
| a tab           | 6/10 padding, a 2px bottom underline | no padding, a cell after the label; no underline (a 2px border is a one-row tab's whole row and eats the label)                                                                                |
| the status line | 32 high                              | 1 row                                                                                                                                                                                          |
| a card          | 12 padding, 8 gap                    | 1 cell of side padding, 0 above/below, 0 gap (its lines are rows)                                                                                                                              |
| the feed        | 12 padding, 8 gap                    | **not** re-cut: the page's own scroll arithmetic adds the same lengths (a host that zeroed them would make the page's content end larger than Clay's and the clip would stop the scroll short) |

**The data: the app's own calls, from its recordings.** `terminal/data.ts` is the terminal's AppView, so the page asks
what it asks the network. `homeScreen(feed, cursor)` answers Discover from `home-discover-1` and then
`home-discover-2` (the first page's cursor is the one the second was recorded with), Science from `home-science-1` and
then an empty page, and News with an empty page (no recording — the app's empty feed); a third page is the empty page,
which is the **end**. A page is filtered by the app's own `postVerdict` before it leaves, as `homeScreen` filters it (28
and 23 of Discover's 30, 25 of Science's). `threadScreen(uri)` is `thread.json` through the page's own `screenOf` — one
recording for whichever post opened it, as the app's test stub and `terminal/thread.c` show it — and the host hands it
over one frame after the screen mounts, so the loading row is a frame the run draws. **`listNotifications` is not
here**: apps/csssky has no notifications screen, route or fixture, so the page's rows stay hand-carried
(`app/notify.ts`), and the file says so instead of inventing an answer.

The feed's three states are the page's **status line**, because a row inside the clip would be out of view exactly at
the end — the page's content end is the window's, not the declared rows': `Discover — loading…` on the first frame,
`Discover — 28 posts — loading more…` at the end while the next page is on its way, `Discover — 51 posts — that's all
for now` (the app's own words) when the source answers an empty page, and `Discover — could not load the feed` when it
rejects. Two knobs make the last states reachable: `--offline` fails both calls (and a notification's thread), and
`--mutate cursor` answers page 1 for page 2, which the page's dedupe (a card is its post's at-uri) adds nothing of and
calls the end. The recordings are four JSON modules (`with { type: "json" }`, 224,760 bytes: 53,113 + 54,624 + 93,964 +
23,059) in the host's module graph, imported only when the Sky page starts, so the Sensors host pays none of them.
Numbers (`terminal/test.sh`): 28 cards on the first page, 23 on the second, the end after 51; the frame over 1,600 cells
is **0.08 ms** with the full second page (36 commands); ArrowDown is 40px, PageDown a viewport (288px at 80x20, 160px at
80x12), one wheel notch 10px; and the C feed's counted distance from the page is below.

The tab's focus is the C bar's active tab — the accent fill and an on-accent label — because a `:focus` ring on a
one-row tab is the label's row; the feed's `:focus` ring is the page's own `t.color.ring` border as one cell of box
characters around the viewport, and when it is focused it eats the first card's name row (a cell cannot be both a ring
and that row). The avatar is a `css.image`: the host **skips** the element (a cell has no glyph for it, and its 40x40
box would be three rows of nothing the C page does not draw). A card's own `onClick` opens the thread; the page's cards
are not Tab stops, so Enter has no card to open of its own — the host presses the first card's own `onClick` while the
feed is focused, which is the C page's Enter (it opens the focused post's thread). Tab reaches the tablist and then the
feed; Left/Right on the tablist switch the feed; Up/Down, PageUp/PageDown and Home/End scroll the feed; `j`/`k` are
mapped to the page's Down/Up; a wheel event (`WheelDown`/`WheelUp` from termbox2, or a key in the headless run) is one
10px notch of the page's own machine. `--settle N` runs frames after the input (the track's spring and the band need
them), a `-` in `--keys` is a frame with no input (a screen measures its content from the last layout, so its first
scroll key needs one) and `--offset` prints the clip's offset, which is how the check states the displacement.

**The thread and the profile.** They are the page's **screens**, not entries of their own: `Sky.tsx` mounts the thread as
a root float over the feed, and `Profile.tsx`'s `createProfile` is called by `Sky` and its element is declared in `Sky`'s
tree, so there is no `--page profile` here (the C `demo --page profile` is a stack entry point its own host has). A
click on a card (or Enter on the feed) opens the thread; a click on a card's **author row** — the app's link to
`/profile/handle` — opens the profile; Escape is the page's own back (the Back control takes Enter too). The profile
needs nothing handed to it: `app/profile.ts` reads apps/csssky's recorded `getProfile` and its three author feeds itself,
on the first opening, and its tabs (Posts, Replies, Media) are the page's headless tablist, each list a fresh instance of
the page's scroll machine. Each screen is the feed's re-cut, one row down: the page floats it at 64px (its bar) and
696px (its window less the bar) and in cells the host's bar is one row, so the float starts on row 1 and takes the rows
under it; a 44px head is one row; the page's 28px Back control is one row and its 1px border is **dropped** (Clay adds a
border's command on the way out of an element, after its children, so a one-row control's border would be its word's own
cells — the C pages have no Back there at all); a card's padding and gap are the feed's card's; the profile's drawn disc
is two rows and its tabs are the bar's (no padding, a cell after the label, no 2px underline), but its labels have no id
for the host to recolour, so its focus has no cell of its own (the active tab is its accent label, the style's literal).
The exit is the page's 0.3s group, which a cell draws as the screen staying and then leaving at once (a group's alpha and
translate are a cell's to drop), so the back check waits the exit out.

The C thread and profile (`terminal/thread.c`, `profile.c`) are the behaviour's oracles, not the cells': the C thread's
cards all carry a hand-cut border, its name and meta share a row, its body is clipped to one row, its counts are the
glyphs `↩ ⟲ ♥` and its bar says `sky · Thread (esc: back)` (the page's bar stays the page's); the C profile has a
two-row banner band, an accent-pill tab and the app's reason lines (`Pinned`, `Reposted by ...`) above each card, which
the page draws no counterpart of. At 80x26 (the C pages' size) the measured distances are:

```
solid, terminal: the thread against terminal/expected-thread.txt (the C thread): 1957 cells, 0 of 26 rows the same, the worst row 1 (80 of 80); rows 21,80,67,79,76,70,80,80,78,79,71,77,80,80,79,78,76,80,80,79,76,74,80,80,80,77
solid, terminal: the profile against terminal/expected-profile.txt (the C profile): 1837 cells, 0 of 26 rows the same, the worst row 2 (80 of 80); rows 22,77,80,79,79,38,76,78,35,80,80,29,80,77,80,74,80,78,74,79,73,80,80,72,80,77
```

The thread's worst row is the C card's top border against the page's head row; its nearest rows are the body lines (row
2 in 67 of 80, the same words at a different inset) and the counts row (71, the same words where the C's are glyphs). The
profile's worst row is the C banner band (two rows of colour) against the page's head row and drawn disc; its nearest rows
are the header's (row 5 in 38, the bio's words; row 8 in 35, the counts; row 11 in 29, the tabs). No row of either is
identical to the C's, and the check stores the Solid frames as its own guards (`terminal/expected-solid-thread.txt`,
`-profile.txt`) on top of the counted comparison.

**The notifications.** The page's **fourth** screen: `--page notify` is `Sky.tsx` with `Notify.tsx`'s screen open (the
page's own `screen` prop — the page `n` leaves the feed on, not an entry of its own), and `n` on the feed opens it in a
`--page sky` run, as the C shell's `n` does. Its rows are `app/notify.ts`'s five: the app's recordings hand-carried (the
app has no notifications screen or fixture — the one screen of the four that is), with the app's five verbs. They are real
Tab stops (`input.add`), so a cell's ring is the card's own border; Tab past the last row wraps to the first (the page's
fallback); Enter on a row opens its post's thread through the page's `load`, the host's recorded thread, and Escape there
returns to the list's frame. The C screen (`terminal/notify.c`) is the behaviour's oracle, not the cells': its bar names
the screen, its card has a hand-cut border and a separator row at rest, and its footer is the key hints. At 80x26 the
measured distances are:

```
solid, terminal: the notifications against terminal/expected-notify.txt (the C screen): 1564 cells, 0 of 26 rows the same, the worst row 5 (80 of 80); rows 26,79,5,36,9,80,5,22,77,80,80,75,41,80,80,78,77,80,80,29,80,80,80,80,80,45
solid, terminal: after Tab,Tab against terminal/expected-notify-focus.txt: 1910 cells, 0 of 26 rows the same, the worst row 2 (80 of 80); rows 26,79,80,71,78,80,80,77,79,80,80,80,71,80,80,78,77,80,80,29,80,80,80,80,80,45
```

The nearest rows are the header's (row 2 in 5 of 80: the same word, the page's Back control one cell in) and the first
card's snippet (row 4 in 9, the same words at a one-cell inset); the worst are the C card's border and separator rows,
which the page's cards at rest have none of, and its footer. The stored guards are
`terminal/expected-solid-notify.txt` and `-focus.txt` (the ring on the third row after Tab,Tab, as the C's focus frame
has it), and the two mutations are the page's: `--mutate verbs` draws one wrong verb on every row (the stored dump fails)
and `--mutate rows` never registers the rows (Tab,Tab is not the third row's frame). The frame is **0.12–0.16 ms** (70
commands, 2080 cells — the feed's cards are declared under the float too) and its ANSI 0.16 ms (5.1 KB).

**The C feed's cells are not the Solid feed's, and the check does not pretend they are.** The C card
(`terminal/sky.c`) has a hand-cut border and separator row, its name and meta on one row, its body clipped to one row,
its counts as the glyphs `↩ ⟲ ♥`, no avatar and a footer of key hints; the Solid card has one cell of side padding and
no border at rest, its meta on its own row, a body that wraps at words, its counts in words, a skipped avatar and the
page's status line as its footer. So no row of the two 80x20 frames is identical, and the measured distance is:

```
solid, terminal: the Sky feed against terminal/expected-sky.txt (the C feed): 1475 cells, 0 of 20 rows the same, the worst row 1 (80 of 80); rows 32,80,76,74,77,74,80,80,77,74,78,79,80,80,76,74,77,79,80,48
solid, terminal: after the tab switch against terminal/expected-sky-focus.txt: 1399 cells, 0 of 20 rows the same, the worst row 1 (80 of 80); rows 32,80,79,75,77,69,80,80,77,78,79,80,80,69,73,73,64,80,24,50
solid, terminal: after the scroll against the C list's scrolled frame (80x12): 684 cells, 0 of 12 rows the same, the worst row 6 (80 of 80); rows 32,1,74,78,75,66,80,3,73,74,80,48
```

The worst row is row 1 (80 of 80) at rest and after the tab switch: the C page's card top border against the Solid
card's first line, which has no border. The closest rows are the body lines — Science's row 5 and row 10 differ in 8 of
80 cells, the same words one cell in and with no `│` — and the bar (row 0, 32 cells: the C's `1`/`2`/`3` and its
padding against the page's rhythm) and the counts' words (67). The scrolled frame is the closest of the three: row 1 in
1 of 80 and row 7 in 3, both at a one-cell offset. The C page's own six separator rows and the key-hints footer have no
counterpart. The tab switch and the scroll are compared as _behaviour_, not glyphs: after `Tab,ArrowRight` both pages
show the Science feed (the Solid's 1399-cell distance is the same card-shape difference), and after `PageDown` the Solid
feed's rows move by its own offset (288px, 18 rows, at 80x20; 160px, 10 rows, at 80x12 where the C list's `scroll_into`
drops two cards instead of moving an offset) and both hide the first post and show a later one. That is the honest
ceiling: the C page re-cuts card heights and clips text by hand, so a cell page that keeps the app's own card structure
cannot land on its rows.

**The cost of the feed**, on this Mac (`--bench 50`, headless, 80x20 = 1600 cells, 34–36 commands with the first page
and the second): **0.08–0.17 ms a frame** over repeated runs (begin, the tree declared through Bun's FFI, Solid's flush,
Clay's layout, and the commands turned into cells), and 0.11–0.16 ms more for the same cells as ANSI (3.9–4.4 KB, the
file write included). The same `--bench` on the Sensors page is 0.04–0.13 ms (10 commands, the same 1600 cells): the
feed is ~3.4x the commands, not the 30x a page of its element count might suggest, and it stays under a frame at 60fps
with room. The C feed's own frame has not changed (~0.08 ms as the `demo --frames 1`/`--frames 201` delta, termbox2
included).

**The terminal's own palette.** `--system-theme` (`THEME=system`) asks the terminal instead of taking a flag: `tb2.c`'s
`term_tb2_ask` opens `/dev/tty`, puts it in raw mode for the query, writes `@cssints/tui/system`'s `QUERY` — OSC 11 (the
background), OSC 10 (the foreground), `OSC 4;0;?` … `OSC 4;15;?` (the 16 ANSI entries) and `CSI ? 996 n` (the colour
scheme) — and reads the answer with a **120 ms timeout**, a 15 ms quiet gap ending a real answer soon after its first
bytes; the termios is restored and the fd closed. The bytes go through the package's **`scan`**, the parser
`followSystemTheme` uses for bomb.sh's stdin (there is no second parser here), and the Sky page's nine tokens through
its **`createSystemTheme`**, the solver apps/csssky-tui runs — so a surface sits at the background, the panel 1.1:1 above
it, the ink 7:1 on every surface it is drawn on, the accent and the ring from the terminal's blue and bright blue, and
the light/dark call is the background's WCAG 2 luminance (`#f0e0d0` is light, `#101316` dark). A compiled style keeps
colours, not token names, so `terminal/theme.ts` repaints by the palette's nine values (`Sky.styles.ts`'s dark and light
literals) and leaves a colour outside them alone; the note in the file says the ceiling. The answer need not be
complete: with OSC 11 only, the app's own hues fill the gaps (`#e6e9ec`, `#8b98a5`, `#3b9cf0`, `#5cb0ff`: a dark
`#101316` background gives back roughly the page's own dark palette, a warm light one a light palette); a terminal that
answers nothing at all — a pipe, no `/dev/tty`, `TERM=dumb` — keeps the theme the flag gave and says so on stderr:
`terminal: no colours from the terminal in 120.x ms (0 bytes); the dark theme`, or, for a dumb terminal, `terminal:
TERM=dumb, no colours asked; the dark theme` without waiting. `s` asks again, before a frame. What is read is the Sky
page's palette: the Sensors page's tokens have no roles (they keep their static light/dark), and the C pages keep theirs
too. Cost: an answering terminal is one write, one read and the 15 ms gap (a pty with a scripted answer: 22.7–28.7 ms
in `terminal/test.sh`, Bun's first `dlopen` of libterm and the pty helper's own read tick included); a silent one is its
120 ms once, at startup (129.5 ms measured, `dlopen` included), and a frame is unchanged (0.077 ms for the feed in the
suite's system-themed `--bench 50` against 0.107 ms for the plain one: the palette is solved once and the repainted
variants are cached per style and state).

**The proof.** The C page is the oracle, and at the page's own height the Solid frame is the C frame byte for byte —
the same cells, the same palette in the same first-use order, the same ANSI runs:

```
solid, terminal: the page's frame, dark, is the C page's own (80x11 cells) -> identical
solid, terminal: after Tab and ArrowDown (the ring off the pill, nowhere to go) the frame is the C page's own -> identical
solid, terminal: and the page's rows are expected-focus.txt's own (the C page's ring is the list's, on row 12) -> identical
solid, terminal: its ANSI is the C page's own (truecolour, SGR runs merged) -> identical
solid, terminal: the pill's fill is 3 SGR runs (one a row, not one a cell) and the title is 38;2;230;60;60 -> identical
solid, terminal: the same in the light theme (the theme variant, folded by the same styles.ts) -> identical
solid, terminal: at 80x20 the page's 11 rows are expected-dark.txt's own (rows 12-19 are the C page's list, not the page's) -> identical
solid, terminal: a click on the pill flips Units through the page's own onClick (hover fill 48,53,68, as a mouse leaves it) -> identical
solid, terminal: termbox2 drew the Solid page's screen (80x24, truecolour) under a pty -> identical
```

11 cells is the page's own height: the C page's list starts on row 12, so `demo --cols 80 --rows 11` draws exactly the
page and nothing of the list or the footer. At the suite's 20 rows the page's first 11 rows are `expected-dark.txt`'s
own and rows 12-19 are the C page's list and footer — 9 of 20 rows, 720 cells — which `Sensors.tsx` does not have. That
is the slice's one real gap, counted by `terminal/test.sh` rather than hidden; the two pages are not the same page yet,
they are the same _page part_ drawn by two different programs.

**The cost**, on this Mac (`--bench 50`, headless; the number moves with the machine's load, so a range over repeated
runs): the Sensors page's own 80x11 frame is **0.04–0.08 ms** (10 commands, 880 cells) and its 80x20 frame 0.08 in the
suite's run; the Sky feed's 80x20 frame is **0.08–0.17 ms** (34–36 commands, 1600 cells, the first page and the second),
0.12 in the suite's run — about 3.4x the commands of the Sensors page, not the 30x the slice expected, and well inside a
60fps frame. The thread's 80x26 frame is **0.13–0.25 ms** (66–70 commands, 2080 cells) and the profile's the same
(**0.25** in the suite's run, 75 commands, the feed's cards declared under the float): a full screen of rows costs about
what the feed does, because the walk is the same per element and Clay's layout is a cell grid, not a page. The same cells
as ANSI are 0.11–0.20 ms more (3.9–4.4 KB for the feed, 5.8 KB for the thread, 5.1 KB for the profile, the file write
included). The C page's own frame is
~0.08 ms measured as the delta of `demo --frames 1` and `--frames 201` under a pty, termbox2's present included
(`main.c` prints no frame time, so that delta is the number). The binding is 236 KB of `libterm.dylib` (Clay's
implementation, cells.c, render.c, measure.c and termbox2). The per-element FFI call is what the gap is: a page has one
declaration per element and one per text through `bun:ffi`, where the C page calls Clay directly.

**What it cannot do in cells.** A text line is one row: the C pages clip a body to one row, and the Solid Sky page
wraps at words (a long word is still broken nowhere) — neither is the paragraph the desktop draws. An image is a box
the host skips (the Sky avatars: no glyph, and a 40x40 box is three rows of nothing the C page does not draw). A float
now _is_ placed (Clay's own float over the flow: the feed's thumb and the thread's screen), but its shadow, backdrop and
alpha fade are not. There is no shadow, backdrop, gradient, group opacity, scale or rotation, so the cards' gradients and
their staggered entry are literals; termbox2 reports no motion events, so a hover is only where the last press was (a
click leaves the pointer on the pill, which is why the click's frame is the hovered one) and a drag has nowhere to
travel; a 1px and a 4px border are one cell (a 2px tab underline is the label's row, hence the accent fill instead); a
corner radius is a square corner; a wide glyph (CJK, most emoji) is one cell and breaks the row by one; and the cell size
makes a page's pixel lengths land between cells — 38px is 2.4 rows and 200px is 25 columns — so a terminal page re-cuts
them (here through the value channel, in C by hand). The Sky feed shows the ceiling concretely: no card border at rest,
no drawn avatars, the meta on its own row, the counts in words where the C page has `↩ ⟲ ♥`, and the page's status line
where the C page has the key hints; its thread shows it again: a body that wraps at words where the C clips one row, an
avatar the host skips, the counts in words, and a Back control the C pages do not have (escape is their bar's text); its
profile: a drawn disc of two rows where the app has a picture the page does not draw at all (the C profile keeps a
two-row band for the app's banner), a tab whose underline is the label's row, and no reason line above a card; the
notifications: no kind glyph (Roboto has none) and cards with no border at rest where the C keeps a hand-cut one. **All
four of the Sky page's screens now run as the page's own** — the feed, the thread, the profile and the notifications
(`terminal/solid.ts --page sky|notify`, `solid/app/Sky.tsx`, `app/Profile.tsx`, `app/Notify.tsx`); the C pages stay in
the tree as the behaviour's oracles (`terminal/sky.c`, `thread.c`, `profile.c`, `notify.c`, and `test.sh` still checks
them, their dumps byte for byte). The shape is there (a page declares, Clay lays out in cells, termbox2 draws); what a
page still lacks is the network — the host's `load` is a promise it settles with a recorded thread, and fetching, paging
and the app's system theme are not in the terminal yet.

## The sky screens in a terminal

`apps/csssky-tui` (`../apps/csssky-tui`) ported to cells: the same cards, the same recorded fixtures, the same palette
from its `styles.ts`. Its two screens and two of the sibling web app `apps/csssky`'s:

| screen                                                         | data                                                                                                        | keys                                                                                                                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the feed (`--page sky`)                                        | `apps/csssky`'s `home-discover-1` and `home-science-1` (three posts each; News has no fixture)              | `tab`/`shift-tab` between the bar and the list, `left`/`right` the tabs (which switch the feed), `j`/`k` or `up`/`down` the list, `1`-`3` a feed, `enter` opens, `t` the theme, `q` quits |
| a thread (`--page thread`)                                     | `thread.json`: the parent, the post, its replies                                                            | `j`/`k` or the arrows, `esc` back                                                                                                                                                         |
| a profile (`--page profile`)                                   | `profile.json`, `profile-posts`, `profile-replies`, `profile-media`                                         | `left`/`right` the tabs, `tab` to the list, `j`/`k` or `up`/`down`, `enter` opens a thread, `esc` back                                                                                    |
| the notifications (`n` on the feed, or `--page notifications`) | **hand-carried**, and this is the one screen that is: the app has no notifications screen, model or fixture | `tab`/`shift-tab` the rows in order (wrapping at either end), `j`/`k` or `up`/`down` the roving row, `enter` opens a post's thread, `esc` back                                            |

The focus is `terminal/focus.c`, a port of the semantics of `focus/src/focus.ts` (not shared code with it): Tab stops in
document order with the focus released at either end (a terminal has no platform to hand Tab to, so the page presses it
again and wraps), a group as one stop with roving focus, and `focus(id)` refusing a disabled stop. A click is a press
and a release over one control; the terminal has no pointer motion beyond that.

**The notifications.** `apps/csssky` has no `notifications/` and no route for one, and `apps/csssky/test/fixtures` holds
no `listNotifications` answer (the only notifications in it are a recorded post _about_ the notifications redesign), so
`terminal/notify.c` carries five rows of its own: the app's five kinds — `liked your post`, `reposted`, `followed you`,
`mentioned you`, `replied` — with an actor and a post out of the recorded fixtures (`home-discover-1`,
`home-science-1`, `thread.json`), the post's text as the snippet the app shows under the verb (none for the follow,
which has no post), and the post's own `createdAt` through the app's `ago()`, so a frame does not depend on the clock.
The screen is the shared one: the bar, the app's header row (`Notifications`), the cards of the page's own scroll, the
footer. The focused card is the accent border _and_ the next panel tone, so the ring is visible in a plain dump as well
as in the ANSI.

**The shell's path to it.** `apps/csssky`'s nav (`Shell.tsx`) has Home, a profile and Settings, and the feed's bar is
its three feed tabs, so a notifications screen has no place in either: the feed opens it with `n` (not in the feed's
footer line, which is the tui's own string), and `--page notifications` starts the stack there. The stack is
`terminal/shell.c`'s: `enter` pushes `thread.c` from a notification's post, `esc` pops back to the notifications, and
`esc` again to the feed.

What stays unported: `apps/csssky-tui` has neither a profile nor a notifications screen of its own (the profile here is
the web app's, on the same data layer and fixtures; the notifications are the web app's too, hand-carried); no fetching
(the frame is the recorded fixture — and for the notifications no recording exists at all), no unread counts or their
badge, none of the notifications' grouping (`All`/`Mentions`, "and 3 others liked your post"), no actor avatars (a
glyph), no images (a media line), no quote box, no wrapping (a body is one clipped row), the app's system theme, and
the app shell (a bar, a list, a footer is all).

`cssints` is the workspace package (`"cssints": "workspace:*"`, `../packages/cssints`), not a release from npm: the
tests run with `--conditions=development`, which resolves to its sources, so an edit to the engine is seen at once; `dist`
is what a web build gets. `native` is a workspace of the repository's `bun.lock`, with one difference from the others: it
has no `test` script, so `bun run test` at the root (`vp run -r test`) does not need a C toolchain, SDL3 or ThorVG; the
script is `test:native`. `headless/` is a workspace too (`native/headless` in the root `workspaces`; TypeScript 7 and `@types/bun` of its own, the specs from
`@cssints/apg-specs`); its scripts are `typecheck:native` and `test:native` for the same reason, and `test.sh` runs them.

## The console: the terminal's cells as a console.log call

A fourth screen for the same cells: `terminal/cells.c`'s `cells_console` turns a grid into one browser
`console.log` call — a `%c` run a foreground/background pair, a row a console line, every cell of the row (the trailing
spaces carry the background), a literal `%` doubled so the format does not read it — and the reference is
[textjs](https://github.com/anomalyco/textjs) (MIT), whose **numbers** this takes and whose React + Yoga stack it does
not: the console is a **sink on the cells path**, not a second framework and not a `cssints` member (the engine owns
styles, a renderer owns the screen). The sink is one C function in two hosts: `libterm` for Bun
(`terminal/solid.ts --console` / `--console-frames`) and the browser's `ui.wasm`, where the terminal's `render.c` and
`cells.c` are compiled beside Clay (`browser/ui.c`, `sh browser/build.sh`) and the Solid page reads the bytes out of the
wasm's memory.

**The rule a console needs.** A console has no double buffer: every write scrolls, so a frame at rest must write nothing
and a changed frame must write as little as it can. The sink diffs the new grid against the frame before it and writes
**only the rows that changed** — a console line starts at column 1, so a run of changed cells cannot be printed on its own
— and a row with nothing changed writes nothing at all: thirty idle frames are thirty `[]` lines, 90 bytes and no console
line. Tab on the Sensors pill writes its three rows, whole. That is the desktop's hash rule (`ui.hash` → 0 draws) one
level down; the reference arrived at it independently, which is a corroboration, not a port.

**The numbers** (M2, 80x20 cells, one frame, file write included in both ms): Sensors **3,315 B** a console call against
the ANSI dump's **3,018 B** (1.10x), **0.09-0.14 ms** against **0.13-0.23 ms**; the busier Sky feed **5,449 B**, 98 runs.
The browser page's `console.js` is **197 KB** (the shell, the renderer, Clay's binding, the same wasm, and the vitals
report) and a frame 0.04-0.07 ms. The cells are the frame's cost, as they are for the terminal and the ANSI dump; what the sink adds is the
run-length encoding and the JSON.

**The page** (`browser/solid/console.ts` + `console.html`): the Sensors page at 80x20 cells, the terminal's cell plan
(`Root`'s two cells, the pill's three rows, the ring) through the browser's value channel, the terminal's measure
(`measure.c`: one cell a code point) instead of Canvas2D's, the canvas dark (the display is the console), Tab the ring,
Space/Enter the pill (the page's own press) and `v` the page's vitals (`@cssints/devtools/vitals`; `?vitals` prints them
once after the first frames — a canvas page has no elements to inspect, so the console is its only devtools).
`terminal/console.mjs` parses the call back to the ANSI dump's cells and SGR
colours — 1,600 cells, glyph and both truecolours — and the text dump a cell for a cell, holds the diff and a no-diff
mutation, and prints the bytes and ms; `browser/console-check.mjs` runs the terminal's three frames and holds the page to
them cell for cell (at rest, after Tab, after a press on the pill and after Space, which presses it again), 20 frames at
rest with no console line, a canvas with no pixels, and `v` (and `?vitals`) printing the vitals group, whose sheet report
is the page's own chrome and nothing of the app's.

**What it cannot be**: accessible (a console has no tree), typed (a console takes the page's keys, not a text field: the
Field page cannot run here), typographic (monospace; a cell's width is the console's, so a proportional console font or a
wide glyph breaks a row the sink cannot know), or portable (a phone has no console, and Firefox's and Safari's consoles
render `%c` and scroll differently). Not here: FIGlet titles (deferred; the Hershey spike already said a data font's
niche is a ROM-bound board at one signage size).

## A scene as a file

A scene is a page's input as data: `solid/scenes/*.json` holds a page, the window's size, the theme, an optional
reduced-motion flag and a list of typed steps with times. `--keys`, `--click` and `--wheel` each store a state; a scene
stores the sequence that made it, so a bug report is a file, and "the same commands" can be checked as a sequence rather
than as one state.

```sh
bun solid/main.ts --scene solid/scenes/list-select.json --png out.png                            # replay it, write the last frame
bun solid/main.ts --scene solid/scenes/list-select.json --expect solid/frames/list-select.png   # ... or compare it
bun solid/scene.test.ts                                    # four scenes in-process: steps, frames, ending state, mutations
```

A scene's `page` is one of the pages `main.ts` takes, and **`storybook` is one of them**: the optional `story` field names
the story it opens (`solid/scenes/storybook-switch.json`), so a story's state and the keys that reached it are one file —
the native half of a link (`--story` is the other half, for a frame written from the command line). A `story` on any other
page is a parse error, because that page has no stories.

The file:

| field           | what it is                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `name`          | the stored frame it reproduces (`solid/frames/<name>.png`) and the name a failure prints          |
| `page`          | `sensors`, `widgets`, `dialog`, `form`, `list` or `sky`: the page `bun solid/main.ts <page>` runs |
| `size`          | `[width, height]` in pixels; it must be the page's own (`list` is 360x400, `sky` 360x760)         |
| `theme`         | `"dark"` or `"light"` (`THEME` is ignored: the file is the record)                                |
| `reducedMotion` | `true`, or left out: no travel and no waiting, as `--reduced-motion`                              |
| `steps`         | the events, in order, each `{ "t", "kind", ... }`                                                 |

A step's `t` is seconds from the start, rounded to the nearest 1/60s frame — a frame is what carries input — and a step
whose frame is before the previous step's is a parse error. The kinds:

| `kind`    | fields                     | what it does                                                                                                                                                          |
| --------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`     | `name`, `down`             | `Input.down`/`up`: the names the parts and the focus manager take (`Tab`, `Shift+Tab`, `ArrowDown`, `Enter`, `Space`); a press and its release at one `t` are one tap |
| `text`    | `text`                     | typed characters (`Input.textInput`), a composed run as SDL's TEXT_INPUT delivers it, not a key                                                                       |
| `pointer` | `x`, `y`, `down`, `touch`? | the pointer in the layout's pixels, `down` the button, `touch` a finger's (one pointer either way)                                                                    |
| `wheel`   | `dx`, `dy`                 | a wheel delta in SDL's units, the ones `ui.wheel` takes: `dy: -1` is one notch down, `dx: -1` one notch right                                                         |
| `settle`  | `frames`                   | that many frames at rest while a page's motion runs out (`--settle`)                                                                                                  |
| `frame`   | —                          | one frame at 1/60s with nothing in it: a boundary stated rather than left to the gap between two steps                                                                |

`solid/src/scene.ts` parses and validates the file and replays it into the loop `main.ts` runs headless: one frame a
step, declared and laid out every frame and drawn when the hash changed or the step was a discrete input (a key, typed
text, a wheel, a press or a release), through the page's own `render`/`createFrame`/`createDrawer` — the replayer adds the
timeline, not a second frame loop. A pointer keeps its last place between steps and starts off the window at -1,-1; the
touch and reduced-motion flags are the file's, the theme is its starting one. A run prints its page, size, theme, steps
and frames; `--png` writes the last frame, `--expect` compares it with `main.ts`'s own message and exit code. A file that
is not a scene fails with the step's index and why (`scenes/x.json: step 1: out of order: t 0.1 is frame 6, after a step
at t 0.5 (frame 30)`), and a size that is not the page's fails before a frame runs.

Four scenes are the record of four stored frames, byte for byte (`solid/scene.test.ts` replays each in-process):

| scene               | steps                                                          | frames | the frame                      | the ending state                      |
| ------------------- | -------------------------------------------------------------- | ------ | ------------------------------ | ------------------------------------- |
| `widgets-switch-on` | Tab, Tab, Space, 30 frames in                                  | 33     | `frames/widgets-switch-on.png` | focus `wifi`: the switch on           |
| `list-select`       | Tab, ArrowDown ×12, settle 90                                  | 133    | `frames/list-select.png`       | "Room A3 — 13 of 30", the offset -148 |
| `sky-scrolled`      | a click on the Science tab, 8 notches over the feed, settle 90 | 103    | `frames/sky-scrolled.png`      | the feed 78px down, the tab focused   |
| `dialog-menu`       | Tab, Tab, Enter, settle 30                                     | 34     | `frames/dialog-menu.png`       | focus `zoom-item-0`: the menu open    |

The Sky's scene needs `settle 90`, not 60: the scrollbar's thumb holds 600ms after the track stops and fades over
0.15s, so a frame 60 frames after the last notch still has it on (2,376 pixels differ); at 90 it is the stored frame. The
test's mutations are the other half of the proof: the Widgets scene with Space where its first Tab was — the switch never
turns on — is **964 pixels and 2,892 bytes** off its frame, and the List's scene without its settle compares the frame
the twelfth ArrowDown left, 43 frames in: the selection is 13 but the reveal is at -33.97, not -148, and the frame is
**15,445 pixels and 46,544 bytes** off.

What a scene cannot say yet: a drag's velocity (a pointer step is a position; a fling is what the page makes of two of
them, and a stored frame is one instant of it, not a recorded speed), a window resize (the size is the scene's, one
window for the run), a font or a device change (the vendored Roboto, one pixel density, the desktop raster), a page's
own data options (`--count`, `--posts`, `--wide`: a scene has its page at its own size), and a theme change mid-run (`t`
is a key and works, but `theme` is the starting one). And the scenes are written by hand: nothing records a live window
into one yet.

## The image in a generated page

`css.image(path, { width, height, fit })` is a style whose config is Clay's `Clay_ImageElementConfig`: one pointer,
`imageData`, which is the path of the picture. Clay passes it through untouched — ThorVG's renderer loads the file from
it (`Clay_ThorVG_Picture`, once per path) and sizes the picture into the command's box — so a C page needs no image
data of its own, only that literal. `header()` already printed it: a style with an image becomes

```c
static const Clay_ElementDeclaration glyph = { .layout = { … 32x32 … },
  .image = { .imageData = (void *)"examples/sensors/glyph.png" }, .aspectRatio = { .aspectRatio = 1 } };
```

the path as the style's own escaped C string, in every declaration that style has (`glyph`, `glyph_light`), and
`examples/sensors/header.c` asserts it against the firmware's `clay.h`. So the style contract never lacked an image
config; what was missing was a page that proves the generator emits the command.

That page is `examples/sensors/page_generated_image.c`: the Sensors page with the 32x32 glyph of `styles.ts` under the
title — `page.c`'s `IMAGE=1` variant, which is an env var there and an `image` prop of `solid/app/Sensors.tsx` here.
A prop is not a signal, so the generator takes it beside the page's signals:

```sh
bun --conditions=development generator/page-to-c.ts solid/app/Sensors.tsx \
  --styles examples/sensors/styles.ts --states examples/sensors/states.json \
  --prop image=true --name app_frame_image --out examples/sensors/page_generated_image.c
```

`--prop name=value` renders the page with that prop fixed (`true`/`false` as booleans, a number, else a string), and the
file's header says which (`// props: image=true`). The file is 44 lines, two frame functions (dark and light) and 11
commands each: the page's 10, and `CLAY(CLAY_ID("Glyph"), glyph)` between the title and the caption.

`examples/sensors/gen.c` compares it with the hand page's same variant at 360x360 and one fixed measure — Clay's
`Clay_ImageRenderData` is compared too (`backgroundColor`, `cornerRadius`, and the path, `strcmp` of `imageData`), and a
FAIL names the command's type, so the image is held to its type, id, box and path:

```
dark, image: 11 commands, identical
light, image: 11 commands, identical
2 images, identical
```

`test.sh` regenerates the file and `cmp`s it, so the committed C cannot rot, and compiles it into `gen`. Mutations:
one byte of the path fails `FAIL dark, image: command 2 (image) differs at renderData.image.imageData (path)`; a box of
8x32 instead of 32x32 fails `FAIL dark, image: command 2 (image) differs at boundingBox`; emitting the element with no
style at all (`{}`) fails `FAIL dark, image: 10 generated commands, 11 hand-written` (an element with no box emits no
command).

What a generated page still does not carry: `:focus` (a prop of an _element_, not a page, and `--prop` sets only the
page's). The image variant is a file of its own
and not a state of `--events` for the same reason: a prop is not a signal the table can dispatch. A float is a
declaration and the generator prints it, and a clip element's `childOffset` is read from the host (the List, below).

## The floats in a generated page

A style that floats is Clay's `Clay_FloatingElementConfig` on the declaration. `header()` printed it before any page
used it: `clay.ts`'s `floatingOf` turns `css.float()`'s options into the struct's fields and prints it in the struct's
own order,

```c
static const Clay_ElementDeclaration menu = { .layout = { … 150 wide … }, .backgroundColor = { .r = 23, .g = 27, .b = 32, .a = 184 },
  .floating = { .offset = { .x = 0, .y = -20 }, .parentId = 2339896710u, .zIndex = 10,
                .attachPoints = { .element = CLAY_ATTACH_POINT_LEFT_TOP, .parent = CLAY_ATTACH_POINT_LEFT_BOTTOM },
                .attachTo = CLAY_ATTACH_TO_ELEMENT_WITH_ID } };
static const Clay_ElementDeclaration backdrop = { … .floating = { .zIndex = 1,
  .attachPoints = { .element = CLAY_ATTACH_POINT_LEFT_TOP, .parent = CLAY_ATTACH_POINT_LEFT_TOP },
  .pointerCaptureMode = CLAY_POINTER_CAPTURE_MODE_CAPTURE, .attachTo = CLAY_ATTACH_TO_ROOT } };
```

— the thirteen numbers the Solid path packs into `pack.ts`'s slots 32–44 (the float flag, `attachTo`, the parent's hash in
two halves, the element and parent attach points, the offset, the expand, the z-index, the capture and the clip), and
`parentId` as the hash `CLAY_ID("zoom-trigger").id` would be, with its `u`. The printer needed nothing: the gap was a
page that proves the commands Clay makes of it.

That page is `solid/app/Dialog.tsx`, whose overlays are the modal's backdrop and panel (both root floats) and the menu
floated off `zoom-trigger` ("left top" on "left bottom", 20px up, z 10, no capture: the backdrop and the panel capture
the pointer, the menu's items take it). Its state is a **click**, not a prop, so `examples/dialog/states.json` names one
state per overlay and the generator replays the page's own `onClick`:

```json
{ "menu": [{ "click": "zoom-trigger" }], "dialog": [{ "click": "settings-trigger" }] }
```

```sh
bun --conditions=development generator/page-to-c.ts solid/app/Dialog.tsx \
  --states examples/dialog/states.json --out examples/dialog/page_generated.c
bun --conditions=development generator/page-to-c.ts solid/app/Dialog.tsx \
  --states examples/dialog/states.json --state menu --name app_frame_menu --out examples/dialog/page_generated_menu.c
bun --conditions=development generator/page-to-c.ts solid/app/Dialog.tsx \
  --states examples/dialog/states.json --state dialog --name app_frame_dialog --out examples/dialog/page_generated_dialog.c
```

Three files, two frame functions (dark and light) each: `page_generated.c` is the page with both overlays closed (14
commands), `page_generated_menu.c` the menu open (22), `page_generated_dialog.c` the panel and its backdrop (26). The
styles are in the .tsx, so every declaration is one of `header()`'s literals (`style_9`, `style_10`, …) — the literal
path holds the floats too. The click also moves the focus, as the page's parts do: the menu opens on its first item
(`style_10_focus`), the dialog on Cancel (`style_3_focus`), so the generated frame carries a state, not just a signal.

**The check** (`examples/dialog/gen.c`) compiles the three files with Clay and `desktop/clay_dump.c`, measures text with
ThorVG as the Solid host does (`solid/native/ui.c`'s measure; the sums are the same, so a box is exact, no tolerance) and
writes each frame as JSON at 360x480. The reference is the Solid page's own frame at the same state
(`examples/dialog/solid-dump.ts`: `solid/dump.ts`'s `capture` — `ui_dump_json`, the emitter `solid/goldens` is stored
with), and `dump-check.ts` compares them field by field:

```
closed: 14 commands
menu: 22 commands
dialog: 26 commands
dialog-closed: 14 commands, identical
dialog-menu: 22 commands, identical
dialog-dialog: 26 commands, identical
```

The closed frame is compared whole; the two overlays' commands only (`dump-check.ts --commands`), because a float's
shadow, the menu's backdrop and the mid-slide group are the renderer's tables and no Clay field: a C host has none.
`sh check.sh` regenerates the three files and `cmp`s them, greps the two things a command array cannot show (the dialog's
floats' `pointerCaptureMode`, the menu's `parentId` and attach points) and compiles them; `test.sh` builds `gen` and runs
the comparison, so the page cannot rot.

The stored dialog golden is **not** the comparison's target, and cannot be: `solid/goldens/dialog.json` is the menu
_two frames into its slide_ (`dump.ts`'s `PAGES.dialog`: `Tab,Tab,Enter` and two settles), so its float offset y is the
value channel's animated -12.5813, not the style's -20, and its frame carries the group (alpha 233, scale 0.9703,
rotate -1.484°), the shadow's blur (3.45) and the backdrop. A static generated frame is the page at rest. Compared with
it, the generated menu frame differs in exactly the slide and nothing else — the differ names the menu's eight commands
and their y, by 7.418686 px (the value channel's field 39; the first line is `command 14 (rectangle) box
40/221.574936/150/133 -> 40/214.15625/150/133`), with every colour, radius, border, z, text and the draw order equal.
`solid/dump.test.ts` holds the golden to the page; the generated page is held to the page at rest.

Mutations, each reverted: the menu's parent attach point `LEFT_BOTTOM` → `LEFT_TOP` moves it up by the trigger's height
and the differ names `command 14 (rectangle) box … -> …` (the declaration's own field is pinned by the grep, which names
`floating.attachPoints`); `.zIndex = 10` → `-1` sorts the menu's root before the page's and the differ says
`command 0 (rectangle) element "Root" -> "zoom-menu" … (that is command 14 in the golden: the order moved)`; dropping
`.floating` from the menu's declaration lays it out in the page's column and the differ names its `box` and `z` (`10 ->
0`); dropping `.pointerCaptureMode` changes no command and the grep fails naming `floating.pointerCaptureMode`.

Still not emitted: the Widgets toolbar's menu (a float whose opening key is the toolbar's and whose pointer capture is the
host's; the Dialog's menu proves the float itself), and a page's own scroll _state_, the List's below. `:focus` still
comes from an element's prop or a part's state, never from a signal of the page. A clip element's offset is not a
declaration either, and the List page shows what that means for a generated page: the file asks Clay for the container's
offset (below).

## The Field in a generated page

The Text field page's state is its text field's: the value, the caret and the selection live in `createTextField`, behind
the page's `input`, not in a signal the page exports. So a state is a script of that input, and `page-to-c.ts`'s
`states.json` gained the two actions that are not a signal — beyond `click`/`press`/`pointer`:

| action                       | what it is                 | the page code it reaches                                                      |
| ---------------------------- | -------------------------- | ----------------------------------------------------------------------------- |
| `{"press": "<id>"}`          | the button down over a row | its `onPress`: `input.bind(part)`'s `focus.focus(part.id)`                    |
| `{"key": "Shift+ArrowLeft"}` | a key pressed and released | `input.down`/`up` (the focused part's `keyDown`)                              |
| `{"text": "Ada"}`            | typed characters           | `input.textInput` (SDL's TEXT_INPUT, what `main.ts`'s `text:` key stands for) |

A `text` with no focused field fails the build ("no text field has focus"), so a state cannot silently emit an untyped
frame. `examples/field/states.json` is the three stored frames' own scripts:

```json
{
  "empty": [{ "press": "name" }],
  "typed": [{ "press": "name" }, { "text": "Ada" }],
  "selection": [
    { "press": "name" },
    { "text": "Ada" },
    { "key": "Shift+ArrowLeft" },
    { "key": "Shift+ArrowLeft" }
  ]
}
```

`examples/field/page_generated.c` is the field focused and empty (20 commands: the caret's 1px box, no run),
`page_generated_typed.c` is `Ada` typed (21: one run and the caret after it) and `page_generated_selection.c` is two
Shift+ArrowLeft (23: `A`, the caret, the tinted `da` run). `examples/field/solid-dump.ts` is the reference: the page's own
loop, 31 frames at rest (`--warm 30`) and the stored frames' keys — Tab,Tab; Tab,Tab,text:Ada; and two Shift+ArrowLeft
more — dumped through `ui_dump_json`. `examples/field/gen.c` measures with ThorVG (the Solid host's advance sums, so a box
is exact) and `dump-check.ts` compares the whole frame:

```
field-empty: 20 commands, identical
field-typed: 21 commands, identical
field-selection: 23 commands, identical
solid/frames/field-empty.png: identical, 20 commands
solid/frames/field-typed.png: identical, 21 commands
solid/frames/field-selection.png: identical, 23 commands
```

The last three are `examples/field/page.c` — one generated file linked at `-DAPP_W=360 -DAPP_H=450`, `FIELD_FRAME` naming
the frame — on the desktop host's ThorVG raster, against the page's stored pixels: **0 of 162,000 pixels**, all three.

One seam: the field's runs are the page's only `css.whiteSpace("nowrap")` texts, and a text command carries no wrap (the
dump reads it from a table by node, and a command's node is the text config's `userData`, which the printed literals leave
NULL). `gen.c` numbers the text commands in tree order and marks the value runs' indices `CLAY_TEXT_WRAP_NONE`; a text
added above a value shifts an index and the comparison names the wrap difference, so the table cannot go quiet.

Mutations, each reverted (on copies; the repository's generated C never moved): the caret's box dropped from the typed
frame — `FAIL field-typed: commands: 21 -> 20`, then `command 10 (rectangle) box 80.1640625/210.0625/1/18 ->
40/197.0625/280/44` and `element "name-line-caret" -> null`.

What a static Field frame is not, honestly: it is one state of the field. Typing is the host's SDL_TEXT_INPUT, a key
event is the host's keycode, a press places the caret from the pointer's x and the last layout's run width, and maxLength,
submit and the theme key are the page's behaviour: a generated file shows the state the build scripted, and a board that
types asks `--events` (which replays clicks and presses, not text) or a page of its own. The three files cover the value,
the caret and the selection; a fourth state is another `states.json` entry and one more file.

## The Widgets in a generated page

The Widgets page's `:focus` and `checked` are the parts' fields, not the page's signals — the page picks `track` or
`trackOn` from `wifi.checked()` and the renderer lays `:focus` over the row — so a state is the parts' own handlers, and
`examples/widgets/states.json` names three with the two actions that already existed:

```json
{
  "rest": [],
  "switch": [{ "press": "wifi" }, { "click": "wifi" }],
  "disclosure": [
    { "press": "wifi" },
    { "click": "wifi" },
    { "press": "more-trigger" },
    { "click": "more-trigger" }
  ]
}
```

`press` on a row is its `onPress` (`input.bind(part)`'s `focus.focus(part.id)`: the focus ring); `click` is its `onClick`
(the part's `press`: the switch flips, the disclosure toggles). `examples/widgets/page_generated.c` is the page at rest
(59 commands), `page_generated_switch.c` the switch focused and on (60: the on track's accent and flex-end move the
thumb, and the row's 2px ring is a border command) and `page_generated_disclosure.c` that plus the Details panel open
(63: the panel's box and its one text). `examples/widgets/solid-dump.ts` is the reference at the stored frames' keys — the
page at rest; Tab,Tab,Space; and that with four Tabs and Enter (`solid/test.sh`'s own) — and `examples/widgets/gen.c`
dumps the three, measured with ThorVG:

```
widgets-rest: 59 commands, identical
widgets-switch: 60 commands, identical
widgets-disclosure: 63 commands, identical
solid/frames/widgets-initial.png: identical, 59 commands
solid/frames/widgets-switch-on.png: identical, 60 commands
solid/frames/widgets-disclosure.png: identical, 63 commands
```

The rasters are `examples/widgets/page.c` at `-DAPP_W=360 -DAPP_H=760`, `WIDGETS_FRAME` naming the state: **0 of 273,600
pixels** on all three.

Mutations, each reverted: the switch's on track drawn as the off one (the accent 240/140/50 as 60/64/78, flex-start
instead of flex-end) — `FAIL widgets-switch: command 5 (rectangle) colour 240/140/50/255 -> 60/64/78/255` and
`command 6 (rectangle) box 72/123.5/20/20 -> 52/123.5/20/20`; the Tab stop's `:focus` declaration dropped to the base
row — `FAIL widgets-switch: commands: 60 -> 59`, then `command 8 (border) box 40/117.5/280/32 -> 50/159.5/20/20`,
`colour 90/170/255/255 -> 150/155/170/255` (the ring's command is gone and the next border takes its place). `check.sh`
regenerates the six files and greps the states' own marks: the caret in every Field frame, the selection's box only where
it was selected, the wifi row's `_focus` declaration and the accent on track in the switch's, the panel only in the
disclosure's.

What a static Widgets frame is not: 12 Tab stops and the keys between them are the host's — a frame fixes one focus, which
is what these three do — the slider's drag reads the pointer through `drag.onPointer`, the settings tree's roving focus is
the focus manager's (one node focused is a state, the arrows between nodes are keys), and the toolbar's menu is left out:
it is a float whose opening key is the toolbar's third item's and whose pointer capture is the host's (the Dialog's menu
proves the float, not this page's key path).

## The List in a generated page

The List page (`solid/app/List.tsx`) is the first generated page whose tree is not the page's literals alone: its
viewport declares what the screen shows (a window of rows, `solid/src/virtual.ts`), its scrollbar's thumb is five numbers
the page writes every frame through the value channel, and its offset is the host's. Three things had to follow, and none
of them is a new field of a declaration:

**The page's frame hook ran at build time** (`--tick <n>`). The window is the page's tick's: it reads the viewport's
height from `ui.bounds` and the offset from `ui.scrollOffset`, and without a tick the tree is an empty viewport and its
opaque thumb (9 commands, against the golden's 36). So the generator gives the page its `motion` and runs the hook n frames at 1/60 before
every frame it emits, exactly as `main.ts` does. There is no host to ask, so `generator/ui-build.ts` — resolved in place of
`solid/src/ffi.ts` before the page is imported — answers the two reads a build can answer: the box an element's _own
style_ states (the viewport's `css.height(240)`) and the offset the host will scroll it to (`--scroll`). Every other call
of the `ui` surface is a no-op: nothing is drawn, uploaded or scrolled at build time.

**The value channel was baked.** The rows are the tick's, but so are the spacers' heights (FIXED min and max), the
thumb's height, its offset, its fade and its capture: the page writes them with `ui.value`, and a static page has no
channel. `ui-build.ts` records the writes and the generator applies them the way `ui_open` does — `packBox` of the
resolved shape, the page's fields over it, the declaration back — and prints the element as `values_<n>`. At rest that is
the below spacer (628px) and the thumb (64.14 tall, 0 opacity: the golden's frame has no thumb command and this file has
none either). A write past the 45 packed floats (a group's alpha, a shadow's blur, a text's colour) is dropped, as
`header()` drops the effects: a static C page keeps none of those tables. One seam: the page's _track_ is at 0 at build
time, so the thumb's baked top is the rest one, while `--scroll` is the offset the host will put in the container; both
frames have the bar faded out (it never rose: no wheel was delivered at build time), so no command carries the number —
a visible thumb would want the page's own wheel instead, which is a stub `ui.over` and a notch away.

**The offset is the host's, and the declaration reads it.** `header()` prints the viewport's
`.clip = { .horizontal = 1, .vertical = 1 }` — Clay's `Clay_ClipElementConfig`, which is also its scroll container — and
never a `childOffset`, because a file-scope constant cannot call Clay. The generator therefore declares a clipped element
through `clip_scroll`, which reads it where the element is open:

```c
static Clay_ElementDeclaration clip_scroll(Clay_ElementDeclaration d)
{
    d.clip.childOffset = Clay_GetScrollOffset();
    return d;
}
...
CLAY(CLAY_ID("list"), clip_scroll(style_4)) {
```

the same call `solid/native/ui.c`'s `ui_open` makes (and the browser's `ui.c`), so the C frame draws whatever offset the
host put in the container. The host puts it there exactly as the Solid page's `ui.scrollTo` does:
`Clay_GetScrollContainerData(...).scrollPosition->y`. The window, though, is the _offset's_ — one notch down is one more
row in the overscan — so a generated file is one offset, as the Dialog's is one state:

```sh
bun --conditions=development generator/page-to-c.ts solid/app/List.tsx \
  --tick 31 --name app_frame_list --out examples/list/page_generated.c
bun --conditions=development generator/page-to-c.ts solid/app/List.tsx \
  --tick 31 --scroll list=10 --name app_frame_list_scrolled --out examples/list/page_generated_scrolled.c
```

`page_generated.c` is the page at rest (rows 0..8, 36 commands), `page_generated_scrolled.c` at 10px (rows 0..9, 39:
the tenth is the overscan and is drawn outside the scissor).

**The check** (`examples/list/gen.c`) compiles both with Clay and `desktop/clay_dump.c`, measures with ThorVG as the
Solid host does, and lays the page out twice: the first frame creates the container, the host writes the offset, the
second is the frame the declaration's `Clay_GetScrollOffset()` makes. The reference is the Solid page's own frame at the
same two states — `examples/list/solid-dump.ts` is the page's loop with `motion.onWheel`, because `solid/dump.ts`'s
`capture` has no wheel field: 31 frames at rest, the pointer onto the viewport (the page's wheel is gated on `ui.over`),
one notch down, 90 frames of settle (the offset lands on exactly 10 and the thumb has faded) — and `dump-check.ts`
compares them field by field:

```
rest: 36 commands, viewport offset 0
scrolled: 39 commands, viewport offset -10
list-golden: 36 commands, identical
list-rest: 36 commands, identical
list-scrolled: 39 commands, identical
solid/frames/list-top.png: identical, 36 commands
```

The golden's line holds `solid-dump.ts` to `solid/goldens/list.json` (the page at rest, which is what the stored frame
is); `list-rest` holds the _generated_ frame to the same golden, whole — no tolerance, its measure is the Solid host's;
`list-scrolled` holds the generated frame to the page 10px down. The last line is the desktop host's own raster of the
generated page (`examples/list/page.c`, `-DAPP_W=360 -DAPP_H=400`, the page's own size: `desktop/build.sh` has no size
flag) against the Solid page's stored `solid/frames/list-top.png`, **pixel for pixel, 0 of 144,000 pixels**: the same
ThorVG renderer, the same measure, the same tree.

Mutations, each reverted (on a copy of the committed file, so the repository's generated C never moved): declaring the
viewport without `clip_scroll` — the offset not read — leaves the rows at row 0 while the reference is 10px down:
`FAIL list-scrolled (no noclipscroll): command 5 (rectangle) box 40/91.5/280/28 -> 40/101.5/280/28`, and the same for
every row and its three texts; dropping the clip element's axes sends the host to `the page has no scroll container
"list": the viewport's css.overflow("hidden") was not declared as a clip element`, and a dump of the same file loses the
scissor (`commands: 39 -> 37`, `command 3 (scissor-start) axes horizontal/vertical -> (absent)`); dropping the value bake
leaves the thumb's opaque style in the frame (`FAIL list-rest (no value bake): commands: 36 -> 37`: the golden has no
thumb at all); and dropping `--tick` loses the window itself (`rest: 9 commands`, `FAIL list-rest (no --tick): commands:
36 -> 9`: the empty viewport and its opaque thumb).

What it does not close: the page's own scroll _state_. The List's Solid page animates its offset with a track; a
generated file is one offset, chosen at build time, and the C host is what moves it — the machine (`vscroll.ts`'s 10px
notch, the fling, the band, the reveal) is the desktop's, not the board's. So a board page shows a scrolled viewport;
it does not scroll itself. The thumb is a sibling float over the content (a float has no `childOffset`, which is why it
does not travel): its numbers are the page's value channel, baked for the frame the file is.

## The generated page's events: a state machine

The generated C page used to be one static frame per file: a host that wanted the clicked or pressed frame had to be given
that file at build time, and a click in the page did nothing. `generator/page-to-c.ts --events` emits the same page as a
**state machine** instead — `examples/sensors/page_generated_events.c` — one frame a state and the table a host dispatches
with:

```sh
bun --conditions=development generator/page-to-c.ts solid/app/Sensors.tsx \
  --styles examples/sensors/styles.ts --states examples/sensors/states.json \
  --events examples/sensors/page_generated_events.c --events-name sensors
```

A **state** is the frame the page declares: its signals plus the pointer's overlay (`:hover`/`:active` over an element
with an `onClick`/`onPress`). The signal states are the `--states` entries with no `pointer` action (`use_g=false`,
`use_g=true`); the generator derives each one's overlays by replaying its actions and drawing the pointer at build time,
and names a derived state after a `--states` entry whose frame is identical (`pressed=true` is `use_g=false` with the
pointer held down on `Units`). For the Sensors page the six states are:

| index | state                       | the frame                                                               |
| ----- | --------------------------- | ----------------------------------------------------------------------- |
| 0     | `use_g=false`               | the base frame                                                          |
| 1     | `use_g=false + hover Units` | the pointer over the pill, up                                           |
| 2     | `pressed=true`              | `units_active`, m/s² values — the file `page_generated_pressed.c` holds |
| 3     | `use_g=true`                | the `use_g` frame                                                       |
| 4     | `use_g=true + hover Units`  | the clicked frame, hovered: `expected-thorvg-g.png`                     |
| 5     | `use_g=true + press Units`  | `units_active`, g values                                                |

The generated API (`<name>` is `--events-name`):

| symbol                                                              | what it is                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `void <name>_frame(int state, int light)`                           | draw one state: `light` 0 is the base theme, 1 the one variant (`light`)             |
| `void <name>_frame_<i>`, `_<i>_light`                               | the same, one function a state and theme, for a target that wants the symbol         |
| `int <name>_state_count(void)`                                      | the states, 6 here                                                                   |
| `const char *<name>_state_name(int state)`                          | `--states`' key, or how the generator derived it (`use_g=true + hover Units`)        |
| `int <name>_handler_count(void)`, `uint32_t <name>_handler_id(int)` | the elements a click can reach, by Clay's id (`Units`), in tree order                |
| `int <name>_next(int state, uint32_t id, int event)`                | the state after an event on an element; the state itself when the table has no entry |

`event` is `CLAY_EVENT_PRESS` or `CLAY_EVENT_RELEASE`, in `generator/events.h` (they are not Clay's
`CLAY_POINTER_DATA_*`: Clay's are a per-frame click flag, and a state machine needs the two edges apart). A **press** is
the button down over the element: the element's `onPress` runs, and the frame is its `:active`. A **release** is the
button up over the element the press was on: its `onClick` runs (a click), and the frame is the state its signal now
declares with `:hover` — so the pill's click is `0 → 2 → 4` and the click again is `4 → 5 → 1`. The table is total over
its states and handlers: a press or a release the state does not take is an entry that leads to itself (the host also
checks the release is over the pressed element, and puts the state back where the press found it if it is not).

A transition the generator cannot express as a frame of a state `--states` names is a **build error**, not a dropped
event: `state "use_g=false": a press on "Units" leads to a frame no state in …/states.json names (a signal it changes is
not one of the state machine's)`. An element with a handler and no `id` fails too (the table could not address it), and
`--events` carries the base theme and one variant, so a page with more themes is refused.

**The host dispatches.** `desktop/build.sh examples/sensors --generated` links `desktop/host.c` against the state file
(`PAGE_STATES`, `PAGE_STATE_PREFIX=sensors`) instead of the hand page: the state is the host's `int`, `Clay_SetPointerState`
gives the element under the pointer (from the last frame's boxes, as `page.c`'s `Clay_OnHover` is), a down edge asks
`sensors_next(state, id, CLAY_EVENT_PRESS)`, an up edge asks for the release (or returns to the state before the press),
and every frame draws `sensors_frame(state, light)` — no rebuild, no JS, no page signal. `t` still toggles the theme.
`examples/sensors/gen.c` is the same walk as a test: the six old frame comparisons, then `step 0: state 0 "use_g=false":
10 commands, identical`, step 1 the press (`pressed=true`), step 2 the release (state 4), step 3 the second press (state 5)
and step 4 its release (state 1), each against the hand-written `page.c`'s tree at the same signal, pointer and button.
The trajectory ends with the signal where it started, the pointer still over the pill.

The hand C page and the Solid page differ on one edge, and the table follows the Solid page: `page.c`'s `Clay_OnHover`
fires on `CLAY_POINTER_DATA_PRESSED_THIS_FRAME`, so its `--press` already shows the _next_ signal (`expected-pressed.png`
is `units_active` with the g values), while the Solid page's `onClick` and the table's release flip it on the way up (a
held generated `--press` shows `units_active` with the m/s² values). What the table reproduces is `page.c`'s _frame_ at a
given signal, pointer and button — the command arrays gen.c compares — not its toggle's edge.

**The browser** (`browser/page.c`) keeps the same state machine in the wasm: `press(x, y)` and `release(x, y)` ask the
table through Clay's hit test, `frame()` draws the state, `state()`/`state_name(i)` report it. `w`, the button and a
pointer click on the canvas are one click at the pill's centre; the post-click frame is dumped through the same emitter
and `browser/check.mjs` compares its commands with the desktop's own `--click` dump (`build/sensors/app`, 4px boxes for
Canvas2D's metrics) and its raster with the desktop's `expected-thorvg-g.png`, and reports `state 4 "use_g=true + hover
Units"`. The browser's own `expected-g.png` was re-stored: it is now the clicked (hovered) frame, not the plain `use_g`
frame the old `frame(1)` drew.

**A scene drives it.** `examples/sensors/scenes/sensors-click.json` is the click as a file, in the format the Solid host
already replays (three pointer steps and a settle). The C host reads it itself — `desktop/scene.c`, a strict recursive
descent over the format's strings, numbers, booleans and arrays — and replays one frame a step:

```sh
./build/sensors/app-generated --scene examples/sensors/scenes/sensors-click.json --expect examples/sensors/expected-thorvg-g.png
# scene sensors-click: page sensors, 4 steps, 33 frames, ending state 4 "use_g=true + hover Units"
# examples/sensors/expected-thorvg-g.png: identical, 10 commands
```

The Solid host replays the same file with `bun solid/main.ts --scene …` and lands on the same stored frame, so the format
has two replaying targets. The C parser's limits are stated in `desktop/scene.c`: the kinds are `pointer`, `settle` and
`frame` (`key`, `text` and `wheel` are refused by name), a string is UTF-8 with the JSON escapes but no `\uXXXX`, numbers
are JSON's grammar via `strtod`, no `null` and no nested objects, at most 64 steps, and a step's frame (seconds × 60,
rounded) may not go back — `step 1: out of order: t 0 is frame 0, after a step at t 0.0166667 (frame 1)`. The page's
name and size must be the build's (`sensors`, 360x360).

What the table cannot carry: **a key** (a page that answers `t` or Tab outside a click has no event in it); **a signal
outside `states.json`** (the generator refuses the transition it cannot name, so a new signal is a new entry in the file,
not a silent dead end); **an animation or a clock** (a state is one frame; a settle is the host's frames, and a C page
has no motion tracks); **pointer hover as a track** (a hovered state is entered by a release over the element, not by
moving over it — the frame after a click is hovered, a later move away does not change it); a drag, a wheel, typed text,
a float, the image variant (a page prop, so a file of its own, above), `:focus` (a prop of an element, not a signal) and
more than one theme variant per page.

Two mutations are the proof, run by hand: mapping state 2's release to state 3 instead of 4 fails the walk with
`FAIL step 2: command 7 (rectangle) differs at renderData.rectangle.backgroundColor (state 3 "use_g=true")`, and deleting the
order check in `desktop/scene.c` lets a scene whose second step goes back to frame 0 run silently — it ends in state 0
and `10,114` pixels off `expected-thorvg-g.png` instead of naming `step 1`.

## The frame as data: command-stream goldens

A stored frame answers "did the pixels change" and not "what changed". One emitter, `desktop/clay_dump.c`, writes the
last frame as JSON for every target, and `bun solid/dump.ts <page>` renders a page exactly as `main.ts`'s headless path
does for its stored frame — the same size, input and motion hook, run to rest, no raster — and stores it in
`solid/goldens/`:

```sh
bun solid/dump.ts sensors                  # the JSON to stdout, the counts to stderr
bun solid/dump.ts sky --out /tmp/sky.json  # ... or to a file
bun solid/dump.ts widgets --update         # re-store solid/goldens/widgets.json
bun solid/dump.test.ts                     # every golden, field by field (solid/test.sh runs it)
```

The emitter is Clay and libc only — no SDL, no ThorVG, no file I/O: it returns the bytes, and each host writes them the way
its target can (a file, a buffer JS reads out of the wasm's memory). `ClayDumpFrame` (`desktop/clay_dump.h`) is the
command array plus what a host knows about it: the frame's size, scale and hash; the page's id strings (`names`, by
Clay's hash, from `ui_open`/`ui_text` — the Solid host interns them, a C page has only the hashes, so a command's
`element` is null); each node's Clay id and the two text fields a command does not carry (`textAlign`, `textWrap`, per
node); and the renderer's effect tables (`shadows`, `backdrops`, `gradients`, `groups` — the C page has none of them, so
it passes them empty). `ui_dump_json` (`solid/native/ui.c`) is now the Solid host's adapter over it and writes the same
bytes it always has: the five goldens did not change.

The JSON carries what a draw reads and nothing else, so a diff of it is a diff of the frame:

- the layout's `size` and the raster's `scale`;
- `commands`, one a line, each with its `type`, Clay's `id` (a 32-bit hash, printed as a number) and the page's own
  `element` id string behind it when the element has one (null for an anonymous one), its `box` and `z`, and per type:
  a text's bytes, colour, font, size, letter spacing, line height, alignment and wrap; a rectangle's colour and corner
  radii; a border's colour, radii and five widths; an image's path; a clip's axes; a custom's pointer;
- `effects`, the renderer's side tables beside the commands — the ones `hash_frame` folds in but no command carries: each
  `shadow`'s offset, blur and colour, each `backdrop`'s blur, each `gradient`'s kind, angle, alpha and stops, each
  `group`'s alpha, scale, translate and rotation (a neutral group, which makes no scene, is left out as the hash leaves
  it out), and the `textWeight`;
- `a11y`, the accessibility snapshot of the same tree (`solid/a11y.ts`): role, name, value, states, hasPopup, level and
  bounds per node.

`solid/dump.test.ts` compares five goldens and prints the counts: Sensors 10 commands and 0 a11y nodes (the page has no
roles), Widgets 59 and 28, the List's top 36 and 0, the Sky's Discover settled 35 and 4, and the Dialog's menu two frames
into its slide 22 and 7 — the one frame with every table in play (a group at alpha 233, scale 0.971 and -1.48°, the
menu's shadow at blur 3.45, its backdrop at 10, and the float it hangs off its trigger by; the Sky's three cards carry
the gradients). A miss names the command and the field, not a pixel count:

```
FAIL sensors: command 2 (text "accel m/s²") colour 150/155/170/255 -> 160/165/180/255
FAIL sensors: command 2 (text "accel m/s²") id 13290005 -> 836677627 (that is command 3 in the golden: the order moved)
```

The differ joins a colour or a box into one value, calls a field by the name a page reads it by (`colour`), annotates a
command with its type and its text, and says where an id that moved is in the golden — two commands swapped is a diff,
not a mystery. Numbers are written as they are (`%.9g`, a float32's exact round trip) and object keys are sorted where
their order carries no meaning, so a golden is stable: two processes write the same bytes. The one field that is not:
a custom command's `pointer`, an address. The frame's hash is written by `ui_dump_json` but left out of a golden, because
with an image in the frame it hashes the image's pointer, which is a process's own address. Re-store after a deliberate
change with `--update`, and read the diff first: the golden is the frame, not an opinion.

What it cannot see: the pixels — anti-aliasing, a shadow's raster (the geometry is data, the blur is not), a backdrop's
blurred pixels, a gradient's dither, a glyph's shaping (ThorVG applies no kerning, and the dump has the declared size and
the finished box, not the advances), and the raster's density beyond the `scale` it records. Nor anything the frame does
not declare: a part's handlers and key timing (`widgets.test.ts`, `list.test.ts`), the focus trap (`dialog.test.ts`), a
hover that has not moved the tree, or what a page would draw next.

### The C page and the browser, through the same emitter

The desktop host takes `--dump out.json` (`desktop/host.c`), so the C page's command stream is the same emitter's and
its layout is the raster's own:

```sh
./build/sensors/app --raster thorvg --dump /tmp/sensors.json       # the C page (examples/sensors)
node dump-check.ts solid/goldens/sensors.json /tmp/sensors.json    # vs the Solid page's golden
sensors: 10 commands, identical
```

One golden, not a second one beside the C page: the hand-written C page and the Solid page are the same tree from the
same `styles.ts`, and both are laid out with ThorVG's metrics, so all 10 commands compare equal field by field, the
boxes included — measured before the golden was shared. `dump-check.ts` settles the three things a C host does not know
and the golden does, and compares the rest byte for byte as `solid/src/format.ts` writes it (the formatter `solid/dump.ts`
stores the goldens with): a command's `element` is resolved by id (the same page, the same ids, the host keeps no
strings); the frame's hash is dropped (a C host writes zero, a golden never stores one); the `a11y` snapshot is dropped
(the Solid host's alone). A miss names the command and the field, as the Solid test's does — a colour in
`examples/sensors/styles.ts`:

```
FAIL sensors: command 2 (text "accel m/s²") colour 150/155/170/255 -> 160/165/180/255
FAIL sensors: command 4 (text "gyro °/s") colour 150/155/170/255 -> 160/165/180/255
FAIL sensors: command 9 (border) colour 150/155/170/255 -> 160/165/180/255
```

The browser is the third host: `browser/page.c` exports `dump()`, which writes the wasm's last frame through the same
emitter into its linear memory, and `browser/check.mjs` compares that JSON with `solid/goldens/sensors.json` — the
same golden, no table of its own any more (`browser/dump-commands.c` is gone). Every field is exact but the `box`: the
golden's boxes are ThorVG's metrics, the wasm's are Canvas2D's, which does not hint a font, so a 20px line comes out up
to 3px wider and a centred box starts half of that to the side; the 4px tolerance is the one the old table had. A box
that moves fails as `FAIL commands frame(0): command 7's box is 10.00px off the golden's` (measured by widening the
Units pill to 210), and a colour as a named field. The wasm's `use_g` frame has no golden of its own: its two stored
rasters are its gate.

What is still per-target: the board has no dump at all; a golden of a page's light theme (a variant is
`capture(page, "light")` plus one file) and of the use_g frame; a custom command's pointer (an address, kept out of the
goldens) and a frame's hash (with an image it hashes the image's pointer; also kept out). Nothing here sees the pixels,
glyph shaping, a shadow's raster or a gradient's dither: the raster stays the final gate.

## Figures from specs: one figure, three targets

A **figure** here is a JSON _spec_, and every target draws that one file. The format is [glyph-kit](https://github.com/alextraykov/glyph-kit)'s
(MIT): `skills/glyph-kit/reference/spec.md`, its `areas/metrics.md` and `areas/flows.md` are the reference, and **no code
is taken** from it — the shape of the object, the six kinds' data and the sentences of its refusals are ported by hand,
in plain TypeScript, over our own Clay tree. `solid/src/figure/spec.ts` is the format and the check; a kind is one file in
`solid/src/figure/kinds/`, reached through `solid/src/figure/kinds.ts` (below); `solid/app/Figure.tsx` declares that
layout, once, for all three hosts.

**Where a kind lives.** `solid/src/figure/spec.ts` is the format, the `parse` and the checks about the spec as a whole (a
source, a focus's names, the width); a kind itself is **one file** under `solid/src/figure/kinds/`, its layout and its own
refusals side by side — `metrics.ts` (barChart, compare, contrast, funnel), `flows.ts` (flow, branchFlow, stateMachine),
`structure.ts` (journeyMap, tree), `systems.ts` (palette, spacingScale, typeScale, table) and `planning.ts` (nowNextLater,
statusKey, timeline), over `shared.ts` (the cell helpers,
the item builders, `finish`, the raw-JSON readers a refusal reads) — and one `register("<kind>", { layout, check })` at
the bottom of the file that holds it. `solid/src/figure/registry.ts` is the table and the lookups (`layoutOf(spec)`,
`checkOf(kind, data, options)`, `namesOf`, `sizeOf`), `solid/src/figure/kinds.ts` is the door that loads the four areas
and re-exports the types and the table, and `solid/figure-registry.test.ts` is the test the seam has: both halves of a
kind, the list the docs and the refusal print, and a throwaway kind registered in the test alone that draws through
`text.ts` and on the desktop. So a new kind is three steps, none of them in another kind's file: (1) its spec type and its
name in `KINDS`, in `spec.ts`; (2) its layout and its check beside its area's, with the one `register` at the bottom of
that file; (3) a spec in `solid/specs` when this repository draws the figure. Nothing else learns the name: `Figure.tsx`,
`text.ts`, the terminal host and the browser declare what `layoutOf` returns, which is why `journeyMap` and `tree` needed
no change in any of them.

| Field                     | What it is                                    | Here                                                                                     |
| ------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `kind`                    | one of the types                              | `barChart`, `branchFlow`, `compare`, `flow`, `funnel`, `stateMachine` (glyph-kit has 34) |
| `title`                   | a short name, drawn above the rows            | optional                                                                                 |
| `intent`                  | why the figure exists                         | optional, carried, not drawn (it is a document's line, as the kit's)                     |
| `source`                  | where the numbers came from                   | **required when the data holds a number**; drawn under the figure                        |
| `data`                    | the kind's rows, or `"@<path>"`               | a JSON file beside the spec, read and substituted at parse time (below)                  |
| `sample`                  | `true` when the data is not this repository's | the SAMPLE DATA band above the title (below)                                             |
| `options`                 | widths and scales in cells                    | `width` (track cells), `max` (bar chart), `headers` (compare)                            |
| `focus`                   | `{ on, tone, say }`                           | a row's label, `problem` / `good` / `plain`, and the `►` line                            |
| `label`, `motion`, `lang` | the kit's                                     | not here (no screen reader line, no motion, one locale)                                  |

**A spec's data in a file.** `data` may be `"@data/funnel.json"`: a path **relative to the spec's own directory**, which
`parse(text, { dir })` reads and substitutes for the string before `check` sees it. The CLI, `dump.ts`, `text.ts`'s
`--redraw` and the terminal pass the spec's directory, so a figure's rows can live in a file of their own; a caller whose
data is inline still calls `parse(text)` and needs no path. A spec whose data is `"@…"` with no path is refused with
`A spec whose data is "@…" needs the file it sits in: parse() was given no path.`; a path that is absolute or leaves the
directory, a file that is not there and a file that is not JSON each get their own sentence. `funnel.json`,
`compare.json` and `journey-map.json` keep their rows in `solid/specs/data/`, and
`solid/figure-file-sample.test.ts` holds each one's frame to the inline spec's byte for byte — moving the data out moved
no cell. The generated specs (`table.json`, `cohort.json`, the `from-*.ts` ones) keep inline data: a script writes them,
and a script's output is one file.

**The SAMPLE DATA stamp.** A spec with `sample: true` draws, above the title, a band of `=` between `+` caps with the
words `SAMPLE DATA` on it, in the muted role: it is the **layout's first line**, so the text half, the terminal, the pixel
frame, the SVG and the HTML page draw one band and none of them has a branch for it. `sample` is absent when the data is
the author's, and any other value (a string, a number, `false`) is refused. `funnel.json`, `compare.json`,
`journey-map.json` and `pipeline.json` — the kit's own examples, adapted — set `sample: true`, because that data is not
this repository's; our own specs (`bars.json`, `palette.json`, `cohort.json`, …) do not, and their first line is the
title.

The six kinds and their layout: **barChart** is a row of `{ label, value, text? }`, one track each, the fill
`value/max` of it, at least one cell for a positive value and `"+"` on a number past `options.max`; **branchFlow** is a
column of `{ label }` steps where a decision `{ label, type: "decision", no: { label, to } }` draws its `no` box to the
right and its `no` word on the connector; **compare** is `{ label, a, aText, b, bText }`, two tracks a row that share
the row's own scale (2.7 s against 7.7 s is one pair); **flow** is `[string]`, a row of panel boxes joined by `►`;
**funnel** is `[{ label, value }]`, a track a step whose fill is `value/first`, with the number and its share of the
first; **stateMachine** is `{ states, transitions: [{ from, to, on }] }` with `options.path`, the path's states as a
column and each transition's `on` word between them, the states the path does not visit listed under it. `check(spec)`
returns **every** problem as a sentence, and
`parse` is the same over a file's text; `bun solid/main.ts figure --spec ...`, `bun terminal/solid.ts --page figure
--spec ...` and the browser page all refuse before a frame (the desktop and terminal exit non-zero). The sentences ported
from the kit (its `guard.mjs` and `render/focus.mjs`):

```
These numbers need a source: where did they come from?
signed up 13000 is more than visited 12400; a funnel never grows
Focus names "Q3", which isn't in the figure. Use a row label or a column heading as it is drawn.
unknown kind "pieChart": the ones here are barChart, compare, flow, funnel.
```

**Numbers as geometry.** A bar is not a row of block characters: it is a `fig-track-<n>` box and a `fig-fill-<n>` box
inside it, and the fill's width is its value's. The layout speaks **cells** — glyph-kit's unit and the terminal's
(`terminal/cells.h`, 8x16 px) — so a pixel target multiplies a cell by eight across and sixteen down, which is exactly the
rectangle a cell covers on the grid, and a fill's edge lands on a cell boundary instead of between two. That is why the
desktop and browser add no length of their own and the terminal re-cuts **nothing**: one figure is 50x7 cells, 400x112
px on ThorVG and 50x7 cells at 80 columns, the same rows in the same places.

The invariant is read from the **frame**, not from the layout: `solid/figure.test.ts` captures each spec (through
`solid/dump.ts`, the same last frame the goldens store), takes every fill's and track's box out of the commands, and
compares `fill / track` with `value/max` (a funnel's `value/first`) within **half a cell**. Measured worst error: **0.49
of a cell** (compare's "build time, before": 0.27/0.77 of a 10-cell track is 3.5 cells, rounded to 4). The same test
checks each number's text command, the rows' order, that a funnel never grows, `check`'s sentences, and (f) the same
spec on the terminal: the cell rows equal the pixel figure's rows in words and count. A mutation that draws the fill
from the value instead of the ratio fails with `the fill is 0.00 cells of 24.00, 24.00 cells off 0.3/0.3`; a growing
funnel that the check stops refusing fails with `no refusal with "signed up 13000 is more than visited 12400; a funnel
never grows"`.

**The focus paints by role, never by colour.** `focus.on` names a row as it is drawn; the label's text and the bar's
fill take the `problem`, `good` or `plain` **token of `createTokens`** (`solid/app/Figure.styles.ts`), and the figure
carries a `►` line with `focus.say`, so it reads the same without colour. `figure.test.ts` asserts the focus's style
follows the token across the two themes (`230,60,60` dark, `190,30,40` light) and that the drawn label and `►` line are
its dark value; a literal colour at the same value would read the same in both themes, and that is the assertion a
deliberate literal fails.

**The three targets.** Desktop (Bun, ThorVG): `bun solid/main.ts figure --spec solid/specs/bars.json`, stored as
`solid/frames/figure-bars.png` (400x112, 14.6 KB) and `figure-funnel.png` (59x10 cells, 472x160, 25.1 KB), plus the
two flow kinds' `figure-branch-flow.png` (72x17 cells, 576x272, 24.9 KB) and `figure-state-machine.png` (71x17 cells,
568x272, 21.4 KB); 15 commands,
`--bench 1000`: declare 0.024 ms, layout 0.020 ms, draw 0.59 ms (ThorVG's raster included). Terminal (`terminal/solid.ts`
over `libterm`, cells): `--page figure --spec ...`, 0.033-0.039 ms a frame for 560 cells at 80x7, and the same cells as
1,313 bytes of truecolour SGR in 0.072 ms. Browser (`browser/solid/figure.ts`, Clay in `ui.wasm`, Canvas2D):
`figure.html?spec=bars` (the spec is fetched from `solid/specs/`, not inlined, so all three read one file),
`browser/figure-check.mjs` holds the frame to `solid/goldens/figure.json` with the **4 px** box tolerance Canvas2D's
metrics need (worst box 0.55 px) and a click to leaving it byte-identical; `figure.js` is 193,445 B and a frame is 0.12 ms
(the tree, Clay's layout, the commands, Canvas2D, one readback). `solid/specs/bars.json` is this repository's own
measurements (native/README.md's `--bench`), `pipeline.json` is the pipeline this repository has (declaration → Clay →
commands → ThorVG / cells / Canvas2D), and `funnel.json` and `compare.json` are glyph-kit's own examples, adapted.

**Not here** (and honest about it): the kit's `lang` and its `label`. The text
renderer, the exports (SVG, HTML, a deck as a page and as PDF, PNG) and the 42 kinds below are here; each section says what
its half still cannot carry. The kit's `@file` data and its SAMPLE DATA stamp are here too — because the four examples
adapted from its docs carry data that is not this repository's, they set `sample: true`; a figure whose data is this
repository's does not.

**The two flow kinds.** `branchFlow` and `stateMachine` are `solid/specs/branch-flow.json` and `state-machine.json`, one
stored frame each (`solid/frames/figure-branch-flow.png`, `figure-state-machine.png`) and one command golden each
(`solid/goldens/figure-branch-flow.json`, `figure-state-machine.json`). A branch flow's step is `{ "label": "read the
spec" }`; a decision adds `"type": "decision"` and `"no": { "label": "refuse it", "to": "end" }`, where `to` is a step's
label (the branch loops back to it) or `"end"`. The branch box is drawn to the right of the decision, its `no` word on
the connector, and the main path goes down as "yes"; a state machine is `{ "states": [...], "transitions": [{ "from",
"to", "on" }] }` with `"options": { "path": [...] }`, drawn as the path's boxes in a column with each transition's `on`
between them and the states the path does not visit listed under it. Their own spec: `branch-flow.json` is this
repository's path — a spec read, checked, laid out, drawn, refused or redrawn — and `state-machine.json` is the Dialog's
`presence` (`solid/src/motion.ts`), closed → opening → open → closing → closed, with `reopen` a transition the path does
not take.

Their refusals (glyph-kit's published checks cover `states`' path, whose sentence this follows; the branch and state
machine sentences are ours in its voice):

```
has data has no "no" branch.
has data's "no" goes to "import data", which is not a step.
saving goes to saved on "ok", but "saved" isn't one of the states.
The path goes happened → paid, but no transition connects them.
The path starts at saving, but the machine's first state is idle.
A state machine needs its states: ["closed", "opening", "open", "closing"].
```

What our cells cannot carry of the kit's drawing (and the layout says so rather than pretending): the kit frames a step
solid, a decision dotted and an end double; a cell here is a filled panel, so a box's `role` in the layout
(`step`/`decision`/`end`/`branch`/`state`) is what tells a target which it is, and the drawing itself does not change its
border. The kit wraps a label past 24 cells onto a second line inside its box; a line here is one cell high and nowrap,
so a long label widens the figure instead. The kit's branch box puts `→ to` on a second line inside the box; here it is
one line, `label -> to`. The kit draws a state machine horizontally with lanes for forward and back edges; here the path
is a vertical column, so transitions the path does not walk are not drawn at all (only the states are listed). And the
kit's connectors are `│ ─ ► ▼ →`: Roboto has none of those code points (ThorVG has no fallback, and the `►` already in
the focus line draws as an empty box), so these two kinds use `|`, `-`, `>` and `v`, which read the same on the terminal
and the pixels. `solid/figure.test.ts` asserts the boxes' and connectors' counts, the path's labels in the path's order,
the six refusal sentences, a command golden each, and the terminal's rows against the pixel figure's.

**The text half.** `solid/src/figure/text.ts` draws the same layout as characters, so one spec also prints as a figure for
a README, a pull request or a model's context, with no host underneath: `render(spec, { width = 80, compact = false })`.
The shape is glyph-kit's: the title, one line a row (a label padded to its cell, the bar, the number as text on the
right), the `►` line with the focus's `say`, the source. A bar is `█` a whole cell and **one eighth block** (`▏▎▍▌▋▊▉`) for
the fraction its `value/max` leaves — 3.5 cells of a track reads `███▌`, and a remainder that rounds to a whole cell has
no block. The width is counted in **display cells**, not JS characters (`░` and `█` one, a CJK label two), and a line
longer than the width is cut there with `…`.

```
bun solid/figure.ts solid/specs/bars.json                     80 cells (the default)
bun solid/figure.ts solid/specs/pipeline.json --width 60      cut at 60 display cells
bun solid/figure.ts solid/specs/funnel.json --compact         plain ASCII, for a model's context
bun solid/figure.ts solid/specs/funnel.json --markdown        ## title, the intent, the fence, _source_
bun terminal/solid.ts --page figure --spec solid/specs/bars.json --text   the same, from the terminal host
```

`--compact` maps every glyph the renderer draws to one ASCII character, so columns stay where they were: `█` → `#`, each
of `▏▎▍▌▋▊▉` → `=` (a partial cell), `►` → `>`, and the cut's `…` → `.`. Nothing else changes; the renderer draws no box
drawing and no shades, so `:`, `-`, `|` and `+` are not needed here. The terminal host hangs `--text` (and `--markdown`)
on `--page figure`: it prints the same module's text before the grid opens, so the text and the cells cannot disagree.
`--markdown` is one figure as a page: `## title`, the `intent`, a ```text fence with the rows and the `►`line, then`_source_`.

An invalid spec is refused with every sentence on stderr, exit 1, and **no figure on stdout**, as the desktop and the
terminal refuse before a frame.

**The export half.** `solid/src/figure/export/` writes the same layout twice more, with no host:
`svg(spec, { width, scale })` is one standalone `<svg>` (`bun solid/figure.ts <spec> --svg <file>`, `-` for stdout) — the
viewBox is the layout's cells × 8/16, every item is one element (a box a `<rect>`, a bar its track and fill, a text a
`<text>` at its baseline, a swatch its own `#rrggbb`, a marker a triangle, a space nothing), the title and the source are
in it, and no font file, script or external stylesheet is. `html(spec)` (`--html <file>`) is one page: the SVG **inline
and verbatim, once**, with the title, the intent, the `►` focus line and the source around it, `<title>` and
`<meta name="description">` from the spec, `prefers-color-scheme` dark and light on the page's own role variables, a
print sheet and `forced-colors` rules. It carries **no JavaScript**, so the one thing it drops is the kit's arrival (a
figure growing in on view — the still is the export; the live colour probe and the ↺ replay go with it), and the meaning
survives without colour because every number is text. `NO_COLOR` is an environment variable a page with no script cannot
read; the page is colour-independent by construction instead. Text is XML-escaped, so a label with `&` or `<` still
parses; `font-family="Roboto, Helvetica, Arial, sans-serif"` ships no font, so a viewer without Roboto measures `Aa` with
its own fallback and the cells, boxes and bars do not move (the one caveat of a fontless file). Both writes validate
first: an invalid spec prints `check`'s sentences, exits 1 and writes no file. The output is deterministic; `solid/test.sh`
runs each twice and `cmp`s, and ships `docs/exports/palette.html` (28,736 B) and `docs/exports/pipeline.svg` (2,811 B)
from their specs. `solid/figure-export.test.ts` holds every spec's SVG to the layout (well-formed XML by a hand-check, its
`<text>`s in the layout's order, every `<rect>`'s x/width the layout's own number, worst error **0.000 px**), the page to
one verbatim SVG and no `<script>`, and Chromium's rendered boxes to the SVG's numbers (worst **0.000 px**, tolerance
**1 px**).

**The three a review needs.** The same two files are not a review, so the export half writes three more from the same
layout and no second drawer. `--deck a.json b.json … -o deck.html [--title T]` is **one self-contained page with a slide a
spec**, in the given order: each slide carries that spec's `svg(spec)` **inline, verbatim, once** (so a slide and the
`.svg` file cannot disagree — the test counts one `<svg>` a spec and holds each slide's figure to `svg(spec)` byte for
byte), its number (`Slide 2 of 3`), the title and intent above it, the `►` focus line and the source under it, and a
Previous/Next pair. The navigation is **CSS only**: a slide is `display: none` until it is the URL's fragment (`:target`,
`#s2`), and the first slide is the default when no fragment names one (the deck's `:has()`). The links are the only way to
move, so there are no arrow keys, no swipe and no overview — a page with no script cannot hear the keyboard, and the
browser's back button is the way back; a browser without `:has()` shows no slide until a link is followed. The page has
the HTML export's `prefers-color-scheme` roles and `forced-colors` rules and adds the print sheet: `@page { size: A4
landscape; margin: 12mm }` and `break-after: page` on every slide (the last `auto`, so no blank sheet) with
`break-inside: avoid` — **Print is one page a slide**, and a figure larger than the printable box is scaled into it by CSS
with its viewBox unchanged. `docs/exports/review.html` (`palette`, `bars`, `timeline`, title "The review: a palette, a
frame and the plan") is **40,384 B** for 3 slides, and two runs are `cmp`-identical; every spec is validated before the
file is opened, so a deck with one invalid spec prints that spec's sentences and writes nothing.

`--png <spec> -o out.png [--scale N]` is the figure as a **raster through the desktop host**: `png.ts` spawns
`bun solid/main.ts figure --spec … --warm 30 --density N --png out.png` — the frame the stored
`solid/frames/figure-*.png` are, at rest, not a re-drawing — because `capture`, the tests' path, never draws. The scale is
the host's pixel density, not a resample: the layout stays in cells (8x16 px) and `--density 2` draws it into twice the
pixels each way, so 1× is `cells * 8` by `cells * 16` and 2× twice that. `docs/exports/bars.png` is **400x112**
(13,730 B) and `docs/exports/bars@2x.png` **800x224** (33,739 B) — `bars.json`'s 50x7 cells. The test holds the 2× frame
to the 1× one: every flat shape pixel is the same colour at twice its position (29,522 of them: page, track and fill) and
the widest bar is twice as long at twice its `x`; the glyph edges are rasterised again at the density, so it is a real 2×
draw and not a nearest-neighbour doubling. Two runs are `cmp`-identical.

`--pdf a.json b.json … -o deck.pdf [--title T]` prints that deck through **Playwright's Chromium** (`page.pdf()`, the
dependency the browser checks already use) on the deck's own sheet: A4 landscape, 12 mm margins (`preferCSSPageSize`),
backgrounds printed. **A figure a page**: `page.pdf()`'s page count is the specs' count (3), and the text is **text** —
Chromium embeds a subset face and writes glyph ids with a `ToUnicode` map per font, and `pdf.ts`'s `pdfText()` reads them
back (the objects, the page's content stream through zlib, the `/Fn … Tf` and `<hex> Tj` runs through each font's
`bfchar`/`bfrange`), so the test finds every spec's title in its own page's glyph stream. No new dependency. The PDF is
61,115 B for 3 pages, and two runs differ only in the two dates Chromium stamps (`/CreationDate`, `/ModDate`), which the
test masks before `cmp`.

**The docs draw themselves.** The eight figures below are drawn by the renderer from their specs, and `test.sh` regenerates
them (`bun solid/figure.ts --redraw native/README.md`) and `cmp`s the result with this file, so a figure here cannot drift
from its spec — the same discipline as the generated C and the goldens. The line above each fence names the spec, relative
to this file.

<!-- glyph-kit: solid/specs/pipeline.json -->

```text
+========================= SAMPLE DATA =========================+
One declaration, three targets
[declaration] ► [Clay] ► [commands] ► [ThorVG / cells / Canvas2D]
native/docs/map.md, the contract
```

<!-- glyph-kit: solid/specs/bars.json -->

```text
A frame, by target
desktop  ████████████████████████  0.30 ms
terminal ██████▏                  0.077 ms
browser  ██████▍                   0.08 ms
native/README.md --bench: 0.30, 0.077, 0.08 ms
```

**The two row kinds.** `tree.json` is this repository's own map: the root `one UI, many targets`, the four targets under
it (`desktop`, `terminal`, `browser`, `board`) and the pages each draws as their children; `journey-map.json` is
glyph-kit's own "First week" example adapted, with its three stages and their feelings. A tree is drawn as a row of
boxes a level — the root, its children, their children — with three connector rows between two levels: the parents' `|`
stems, a `+---+` bracket over the children's centres, and the children's `|` stems. The kit draws a tree with
`├── └── │`, which ThorVG's Roboto has not (there is no fallback), so ours is `| - +`, the same ASCII as the other
kinds. A journey stage is `{ label, doing, thinking, feeling }`; `feeling` is the kit's -2 to 2 scale, and the row is a
bar of `|feeling|/2` of its track, the number and its word (`-2 bad` … `+2 great`), the doing and the thinking on the
rows under it. Neither needs any code in the page or in the text renderer: `Figure.tsx` declares `layout`'s items and
`text.ts` prints them.

Their refusals: the journey's range sentence is the kit's `within` check word for word ("Import has a feeling of 3,
outside -2 to 2."); the tree's sentences ("A tree needs one root: …", `child names "missing" as its parent, …`) and the
empty journey's are ours in its voice, because the kit's published scripts check neither kind's data. The stored frames
are `solid/frames/figure-tree.png` (576x208) and `figure-journey-map.png` (480x224), the command goldens
`solid/goldens/figure-tree.json` and `figure-journey-map.json`, the terminal's dumps are in `terminal/test.sh`, and the
browser draws `?spec=tree` and `?spec=journey-map` from the same files.

What our cells cannot carry of them: the kit's tree glyphs (above) and its three-level cap (ours draws every level, and a
level wider than 80 cells makes the figure wider); the kit's journey map is a table with a doing row and a thinking row
across the stages, where ours is a bar a stage with its notes under it, because a bar here is geometry (a box) and not a
run of `░▒▓█`.

<!-- glyph-kit: solid/specs/tree.json -->

```text
The targets and their pages
                       [one UI, many targets]
                                 |
         +-----------------+-----+-------------+---------------+
         |                 |                   |               |
     [desktop]         [terminal]          [browser]        [board]
         |                 |                   |               |
    +----+----+        +---+---+          +----+----+          +
    |         |        |       |          |         |          |
[sensors]  [figure]  [sky]  [figure]  [sensors]  [figure]  [sensors]
native/docs/map.md, Targets; native/solid/app/*.tsx, the pages
```

<!-- glyph-kit: solid/specs/journey-map.json -->

```text
+==================== SAMPLE DATA =====================+
The first week, in three stages
Discover    ████      +1 good
            Finds the tool through a colleague
            "Will this replace my sheet?"
Import      ████████   -2 bad
            Uploads a CSV with 4,000 rows
            "Why did my dates break?"
First chart ████████ +2 great
            Picks a template and edits labels
            "Oh, that was quick"
glyph-kit's journeyMap example (areas/flows.md), adapted
```

**Not in the text half**: the kit's `lang`, its screen-reader `label`, and its exports to HTML, decks, SVG and PDF. The
characters are a build/CLI path: nothing at run time pays for them. The SAMPLE DATA band and `@file` data are here, as
they are in the pixel and export halves: both are the layout's, not a renderer's.

**The design-system half: our own tokens.** The kit's `areas/systems.md` documents a design system as data, and nine of
its kinds are here — the half whose data is **ours** (the token sets, the Dialog's frames, the pages' styles, the docs'
token file, this page's Targets table), so the figure cannot disagree with the source it documents:

| kind           | data                                                                   | the figure                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `palette`      | `{ page, hues: [{ name, steps: [{ name, value }] }] }`                 | a step a row, a hue a column: the mark (the first step at 4.5 to 1 on the page), the step's swatch, its `#rrggbb` and its contrast — both computed  |
| `contrast`     | `[{ label, fg, bg, min, ratio }]`                                      | a pair a row: a track of 21 cells (a cell a point of the ratio), the ratio and pass/fails against WCAG's floor (3, 4.5 or 7)                        |
| `colourRoles`  | `[{ label, min, light: { fg, bg, ratio }, dark: { fg, bg, ratio } }]`  | a role pair a row, a mode a column: the foreground's and the background's swatch, the ratio and its verdict per mode                                |
| `layerStack`   | `[{ name, z, box: { width, height }, alpha, radius, blur?, shadow? }]` | a layer a row, back to front: its z as a bar, its box, its fill's alpha, its corner radius, its backdrop blur and its shadow                        |
| `stateMatrix`  | `{ columns: ["hover", "focus", "active"], rows: [{ name, states }] }`  | a style a row, a state a column: a `+` where the style declares that state, painted in the good role                                                |
| `tokenTable`   | `[{ group, name, value }]`                                             | a token a row, its group a heading over the run: the token's name and its resolved value, one table for every length and number group               |
| `spacingScale` | `[{ name, value }]`                                                    | a step a row: a bar of `value/largest` and its pixels — a cell is 8px, so a 4px step is **half a cell**                                             |
| `typeScale`    | `[{ name, size, lineHeight }]`                                         | a size a row: a bar of `size/largest`, `size/lineHeight`, and a specimen `Aa` **at its own size**                                                   |
| `table`        | `{ columns: [{ title, align? }], rows: [[string]], headerRule? }`      | a heading a column, the heading once with a rule under it, a cell cut to its column with `…` (counted in cells), a column that may read flush right |

`palette.json` is `@cssints/tokens`' Open Props blue and grey scales (`packages/tokens/src/open-props.ts`, measured on
their own `gray.0`) — Open Props and not Radix because its scales are one flat object of hex values that reads step for
step into the figure, where Radix's light and dark are two sets of overrides. `contrast.json` is the six pairs the
documentation site draws and checks: `apps/docs/src/palettes.ts`'s `open-props` light palette at `src/theme.ts`'s floors,
and `colour-roles.json` is seven of those pairs in **both** modes (the secondary inks, the link, the accent as a mark, the
ink on the accent, the strong accent on its soft fill), each mode's value the palette's and each ratio the engine's.
**Those three are generated** — `node native/solid/specs/from-tokens.ts` writes them from those files and **the engine's
own contrast**, `packages/cssints/src/color.ts`'s `luminance` and `ratio`, the functions `css.check.contrast` measures
with — and `solid/test.sh` regenerates them into a temp directory and `cmp`s, so a token change that left a figure stale
is a line of the suite and not a reviewer's memory. The other two are **hand-written and say so**: `spacing.json`
(`space.xs` 4px … `space.3xl` 48px) and `type-scale.json` (12/17 … 40/48) are `apps/docs/src/tokens.json`, where a size's
line height is the role's choice (`prose.ts`'s 1.7 on prose, 1.2 on the headings) and not a token.

`layer-stack.json` is the half's sixth kind and its data is not a token set but **the Dialog's own layers**, back to front — the page, the modal's scrim and dialog (its modal frame) and the menu (its menu frame) — with
each layer's z, box, fill alpha, radius, backdrop blur and shadow read from the command and the effect row that draw it.
`specs/from-frames.ts` captures the two frames (settled forty frames after the overlay opens, so a property is the
layer's and not the entry's) and writes the spec, `solid/figure-handoff.sh` regenerates and `cmp`s it, and
`figure.test.ts` recomputes every row from two fresh captures, so the figure is the Dialog measured, not a z scale typed
into a spec.

`state-matrix.json` is the seventh and the pages' own: `specs/from-styles.ts` walks the Widgets, Sky and List pages' `s`
maps and the Sensors page's exports, asks each style which `:hover`/`:focus`/`:active` keys it carries, and writes a row
a style and a state a column. `solid/test.sh` regenerates and `cmp`s it, and `figure.test.ts` reads the cells back from
the frame (69 cells, a `+` in the good role where the style declares the state, a muted `-` where it does not).

`token-table.json` is the eighth and the token file's own: `from-tokens.ts` reads `apps/docs/src/tokens.json`'s seven
length and number groups (space, radius, fontSize, lineHeight, fontWeight, border, layout), resolves each `calc(Npx *
{scale.k})` with the scale the file declares, and writes 30 rows — one table, a group's name once over its run.
`solid/test.sh` regenerates and `cmp`s it, and `figure.test.ts` reads every name, value and one-heading-a-group back
from the frame.

`table.json` is the ninth and the generic one — not a design system but the kit's `systems.md` table: a heading a column,
a row of cells, the heading drawn once with a rule of `-` under it (off when `headerRule` is false), and a value cut to
its column's width with `…`. The cut is counted in **cells**, not characters or bytes: a CJK glyph is two cells, which
`figure-table.test.ts` holds with a value that is five characters and ten cells (`监控摄像头` of a six-cell column draws
`监控…`). A column's `align: "right"` pads its cells flush right, which is a number's own alignment. Its data is this
page: `from-targets.ts` parses the Targets table, keeps the four columns whose cells differ row to row (target, raster, JS
at run time, status), drops the markdown backticks, and writes 6 rows; `options.max` is 18 cells, so the raster's and the
status's own sentences are cut (`Clay's SDL3 rende…`). `figure-handoff.sh` regenerates and `cmp`s the spec, the frame is
`solid/frames/figure-table.png` (79x12 cells, 632x192), the golden `solid/goldens/figure-table.json` (35 commands), the
browser draws `?spec=table`, and `figure.test.ts` reads the rows' order and the golden back from the frame.

**The ratio is the engine's, twice.** A pair's number is written by `from-tokens.ts` with `color.ts` and printed at two
places (`shown`, which floors: 4.499 does not read as the 4.5 it misses). `check` refuses a pair whose ratio is not the
one its colours make — `link on bgSubtle says 4.51:1, but #1971c2 on #f8f9fa makes 4.12:1.` — through
`solid/src/figure/contrast.ts`, a twelve-line WCAG formula with no dependency: a spec is checked on a terminal and in a
browser too, and neither may import culori. `figure.test.ts` holds that copy to the engine on every pair and every swatch
(they are bit-identical, not merely close), and every number a frame prints to `color.ts`'s.

**What the layout gained** — three things these kinds needed, additions to the _format_ and not to one target: an item
kind `swatch` (a step's own `#rrggbb`: a palette documents the colours, so here the picture is the data — the one colour a
figure carries), an item kind `marker` (glyph-kit's `▲`, a `good`-role cell on a pixel target because Roboto has no `▲`)
and a text's `size` with a line's `height` in cells (a 40px line is three cells: `spacingScale` and `typeScale` are the
first kinds whose rows are not all one cell). The text renderer draws all three with no kind in it: `██` in the swatch's
cells, `▲` for the mark (and `*` under `--compact`). A palette's cell is the marker, the swatch, the value and the
contrast; a type scale's row is the name, the bar, `size/lineHeight` and the specimen. The frame's value channel holds
1,024 overrides on every target now (the terminal's `term.c` already did; the desktop's and the browser's `ui.c` were
still 128, and a palette of two hues' thirteen steps writes 429 of them).

**The numbers.** `palette`: 26 swatches (13 steps × 2 hues), the mark on **Blue 8 (4.76)** and **Grey 7 (7.75)** — the
first step of each that reads as words — every swatch's frame box its own colour, and every printed ratio the engine's.
`contrast`: 19.36, 9.70, 7.35, 4.51, 3.98, 5.00, each fill within **0.00 of a cell** of its `ratio/21` track.
`spacing`: every step's fill is **its value in pixels** (4, 8, 12, 16, 24, 32, 48 — worst error **0.00 px**), because
the track is the largest step in whole cells. `typeScale`: **40 > 28 > 22 > 18 > 16 > 14 > 12px**, each specimen its own
`size` in the frame, and rows 3, 3, 2, 2, 2, 2, 2 cells tall — its line height in cells. The text half, a render and its
bytes: palette **804 B / 0.168 ms**, contrast **591 B / 0.043 ms**, spacing **342 B / 0.032 ms**, type-scale
**463 B / 0.037 ms** (the other kinds are 135–633 B and 0.014–0.073 ms). The desktop frames are
`solid/frames/figure-{palette,contrast,spacing,type-scale}.png`, the command goldens `solid/goldens/figure-*.json`, and
the browser draws `?spec=palette`, `?spec=contrast`, `?spec=spacing` and `?spec=type-scale` from the same files.

What our cells cannot carry: a type scale's specimen is at its own size on the pixel targets only — the terminal has one
cell size, so a `typeScale` row is as tall as its line height in cells and the cell figure prints the numbers (`40/48`).
A palette's swatch is `██` in text and two cells of its colour on the terminal, which is exactly what the text half's
check keeps (the swatch's cells are `██` and the terminal's two cells are that colour, a cell for a cell).

<!-- glyph-kit: solid/specs/palette.json -->

```text
The blue and grey scales, on the page
      Blue                Grey
0     ██ #e7f5ff 1.05     ██ #f8f9fa 1.00
1     ██ #d0ebff 1.17     ██ #f1f3f5 1.05
2     ██ #a5d8ff 1.43     ██ #e9ecef 1.12
3     ██ #74c0fc 1.86     ██ #dee2e6 1.23
4     ██ #4dabf7 2.34     ██ #ced4da 1.41
5     ██ #339af0 2.83     ██ #adb5bd 1.96
6     ██ #228be6 3.37     ██ #868e96 3.15
7     ██ #1c7ed6 3.98   ▲ ██ #495057 7.75
8   ▲ ██ #1971c2 4.76     ██ #343a40 10.91
9     ██ #1864ab 5.77     ██ #212529 14.63
10    ██ #145591 7.27     ██ #16191d 16.72
11    ██ #114678 9.17     ██ #0d0f12 18.20
12    ██ #0d375e 11.54    ██ #030507 19.36
packages/tokens/src/open-props.ts (blue, gray; page gray.0); ratio: color.ts
```

<!-- glyph-kit: solid/specs/contrast.json -->

```text
The docs' colour roles, on their pages
text on bg            ███████████████████▍  19.36:1 pass 7:1
textMedium on bgMuted █████████▊             9.70:1 pass 4.5:1
textLow on bgSubtle   ███████▍               7.35:1 pass 4.5:1
link on bgSubtle      ████▌                  4.51:1 pass 4.5:1
accent on bg          ████                   3.98:1 pass 3:1
onAccent on accent    █████                  5.00:1 pass 4.5:1
apps/docs/src/palettes.ts (open-props, light); ratio: cssints/src/color.ts
```

<!-- glyph-kit: solid/specs/spacing.json -->

```text
The docs' spacing scale
space.xs  ▌       4px
space.sm  █       8px
space.md  █▌     12px
space.lg  ██     16px
space.xl  ███    24px
space.2xl ████   32px
space.3xl ██████ 48px
A cell is 8px: the track is the largest step, 48px.
apps/docs/src/tokens.json (space); a cell is native/terminal/cells.h's 8px
```

<!-- glyph-kit: solid/specs/table.json -->

```text
The map's targets, one a row
target           raster              js at run time      status
---------------  ------------------  ------------------  ------------------
Desktop (macOS)  Clay's SDL3 rende…  optional (Bun)      a page in a window
ESP32-S3         esp32's render.c,…  none                clay-test's shell…
Browser (WASM)   canvas 2D           none (the generat…  a static frame an…
ESP32-P4         CPU + PPA (2D DMA)  none                later, needs a bo…
Terminal         Clay's termbox2 r…  optional (Bun)      after desktop; re…
iOS, Android     ThorVG CPU, on a …  none (the generat…  planned; the firs…
native/docs/map.md, the Targets table
```

<!-- glyph-kit: solid/specs/type-scale.json -->

```text
The docs' type scale
fontSize.3xl ██████████████ 40/48 Aa
fontSize.2xl █████████▊     28/34 Aa
fontSize.xl  ███████▊       22/26 Aa
fontSize.lg  ██████▎        18/22 Aa
fontSize.md  █████▋         16/27 Aa
fontSize.sm  ████▉          14/20 Aa
fontSize.xs  ████▎          12/17 Aa
apps/docs/src/tokens.json (fontSize, lineHeight) and src/prose.ts's roles
```

**The handoff half: our own component and our own suite.** The kit's `areas/handoff.md` is measurement and QA, and three
of its kinds are here — the half whose data is **this repository's**, so a figure cannot disagree with what the page draws
or with what the suite passes:

| kind          | data                                                                                          | the figure                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `redline`     | `{ box: { label, width, height }, parts: [{ label, x, y, width, height, inset? }] }`          | the box's outline, a leader row of `·`/`-` runs for its parts and a numbers row of the real pixels                                                     |
| `beforeAfter` | `{ before, after }`, each `{ caption, box: { width, height }, measures: [{ label, value }] }` | two panels side by side (above/below when narrow), each its caption, its box in cells and its measures; the numbers that changed under them            |
| `qaChecklist` | `{ summary, rows: [{ check, area, verdict, source }] }`                                       | a comparison a row (area, the check as the suite names it, its verdict), the passes' bar with the summary's words, and the key `+ pass  x fail  - n/a` |

`redline.json` is the Widgets page's Wi-Fi switch row: the row's own style (`app/Widgets.tsx`'s `row`, `track` and
`thumb`), so its numbers are the page's — 10px of padding either side and 4 above and below, the 44x24 track, the 12px
gap, and the 204px label that takes what is left of the 280px row. `figure-handoff.test.ts` reads those numbers out of the
page's **packed style** (`src/pack.ts`'s `variant(s.row)`, `s.track`, `s.thumb` and `s.root`), so a style change that left
the spec stale fails there with the number that moved (today: **0px out**), and the frame's leaders are within **half a
cell** of them (the worst **4px** of a 2px inset round and a 4px track edge: a cell is 8px, and 280 is exactly 35 of them).
A leader is a cell run, the number is the real pixel, and the numbers row carries each part's `x,y WxH`.

`before-after.json` is the same switch off and on, **generated** by `specs/from-frames.ts`: it captures two frames of the
Widgets page (the switch focused in both, `Tab,Tab` and `Tab,Tab,Space`, so the focus ring is the same command twice) and
reads the commands that differ — exactly two: the track's colour (**60,64,78 -> 240,140,50**) and the thumb's x
(**2px -> 22px**, the on track's `flex-end`). The figure's changed numbers are computed from the two states, never typed, so
a caption cannot claim a change the frames do not make; `solid/test.sh` regenerates the spec and `cmp`s it, and the test
recomputes the same two differences from the frames.

`qa-checklist.json` is a hand-picked dozen of the suite's **own** comparisons, named as the scripts name them: eight stored
frames the desktop's `--expect` compares (`solid/frames/widgets-initial.png`, `sky.png`, `dialog-open.png`, …) and four
comparisons the terminal prints (`the page's frame, dark, is the C page's own (80x11 cells)`, …), each row's `source`
naming the script. The test refuses a row that no `--expect` or `identical "…"` of its script prints, and `check` refuses
a summary that is not its rows' count (`12 of 12 pass`) and a verdict the key does not name (pass, fail or n/a). The three
verdicts are painted by the `good`, `problem` and `muted` roles, one role a state.

The desktop frames are `solid/frames/figure-{redline,before-after,qa-checklist}.png`, the command goldens
`solid/goldens/figure-{redline,before-after,qa-checklist}.json`, and the browser draws `?spec=redline`,
`?spec=before-after` and `?spec=qa-checklist` from the same files (`browser/figure-handoff-check.mjs`, boxes within 4px).
The terminal draws all three cells for cells (`terminal/figure-handoff.sh`).

What remains of the kit's handoff half: a checklist's `note` ("waiting on brand"), and the redline's vertical leaders — a
cell is 16px tall, so an inset of 4px is a number here and not a drawn line. The half's `anatomy` is drawn, in cells: see
the wireframe section below.

What remains of the kit's systems half: nothing — its nine kinds are here, and the kit's own `cohort`, `forecast` and
`listDetail` are here too; its motion half is complete (the sections below).

**The seven wireframe kinds: a page, not a drawing.** `screen`, `anatomy`, `appShell`, `cardGrid`, `listDetail`, `modal`
and `responsivePair` (`solid/src/figure/kinds/wireframe.ts`) are the kinds whose data is a **real page's own command
stream**. `specs/from-page.ts` captures the page with `solid/dump.ts`'s `capture` — the call the goldens are stored with —
and writes the frame's `rectangle`/`border` boxes and its `text` runs into the spec: `screen.json` is the Widgets page at
360x760, `anatomy.json` is a 296x120 region of it with four numbered callouts, `modal.json` is the Dialog's frame with
its modal open (the keys `Tab, Enter`, settled forty frames), and `responsive-pair.json` is the Sky feed at 240x760
(30x48 cells) and 360x760 (45x48), 30 + 2 + 45 = **77 cells** side by side at the default 80, above/below at 60.
`specs/from-frames.ts` captures the Sky page at rest for two of the others: `app-shell.json` is its three shell bands —
`sky-bar` (0,0 360x64), `sky-feed` (0,64 360x664) and `sky-status` (0,728 360x32), each the element's own box, and the
three tile the page — and `card-grid.json` is its feed's three post cards (`sky-card-0..2`, 336x190, 336x208 and 336x210),
the one column and 8px row gap the boxes make. The third is the Sky page's **wide form** (`list-detail.json`): a capture
at 720x760 that presses the second card's body and settles its thread (`capture` grew `clickOn` and a `load`, so the
recording answers on the frame the thread opens), whose panes are the page's own elements — the list `sky-feed-pane`
(0,0 360x760: the bar, the feed and its status line) and the detail `sky-thread` (360,0 360x760: its 44px header and its
clip) — two panes that tile the page. The data's fields are `page`, `width`, `height` and the frame's `boxes` and `texts`
(the shell adds its `regions`, the grid its `prefix`, `cards`, `columns`, `gap` and `columnGap`, the panes their two
elements and boxes); `check` refuses a page this repository does not draw (naming `dialog, list, sensors, sheet, sky,
widgets`), a page wider than `options.width`, a narrow side wider than the wide, an empty frame and a frame with no boxes,
a shell band that is not a box of its frame or two that overlap or do not tile the page, a card that is not a box of its
frame, an index listed twice, columns or gaps the boxes do not make, a pane that is not a box of its frame or one outside
the page, two panes that overlap, one element used for both panes, and panes whose union is not the page.
`solid/test.sh` and `solid/figure-handoff.sh` regenerate all six captured specs into a temp directory and `cmp` — a page
edit that moved a box or a run is a `cmp` line in the same commit, not a stale figure.

The reconciliation is the cell: a box's cell rect is `round(x/8)`, `round(y/16)`, `round(w/8)`, `round(h/16)` of the
page's own box, so a wireframe is at 1/8 scale and **not pixel-accurate** — an edge is up to **half a cell** out (4px
across, 8px down; today's worst is 0.50 of a cell on every box of both figures), a 4px inset rounds to nothing, and a
1px rule (0 rows) is skipped. Of the screen's Widgets page **29 rectangles and borders, 23 are drawn** (the switch's 8x8
knob is 1x1 cells, and five 3–4px rules round to 0 rows: an outline needs two cells across and one down) and **30 text
runs** are placed in the page's order, one cell a character, **1 shortened** to `Ital…` where a panel edge or the run
beside it left less room. The pair's Sky page is 8 boxes and 22 runs a side (4 shortened at 360, 11 at 240, whose
narrower page puts one run outside its cells, so the wireframe does not draw it). The pixel frame splits each row into a
muted `connector` segment (its `+ - |` edges) and an ink `label` run (the page's words), so it reads as a line drawing on
all three targets; the terminal and the text renderer are exact cells, the desktop's Roboto is proportional, which is
what remains: a monospace style (or a real outline item) would make the pixels' columns line up as the cells do.

**`anatomy`: the same page, one part at a time.** The kit's anatomy is an illustrated component with numbered callouts;
here it is the page's own frame cut to one **crop**, with the numbers on it and a legend under it — so the drawing is
still the page and cannot drift, and only the numbers are the author's. `anatomy.json` is a 296x120 crop at 32,56 of the
Widgets page — 37x8 cells, the button and the two checkbox rows — with four callouts: the button, its label, the Wi-Fi
checkbox, and the same control one row down. The crop's boxes are clipped to it and moved to its corner, the page's own
background rectangle is **dropped** (it is the window, not a component: a cut of it would ring the drawing with an edge
the page never drew around the part), and a box under 2x1 cells is not drawn, as for a wireframe. A callout is
`{ "n": 1, "x": 40, "y": 72, "label": "the button" }`, its point in the page's pixels, and its digit lands at
`round((x-crop.x)/8)`, `round((y-crop.y)/16)` — one cell, so `n` is **1 to 9**, and the digit replaces exactly that cell
(a wide glyph's two cells become the digit and a space). `check` refuses a crop outside the page, a crop wider than
`options.width`, a number that is not one digit, a callout with no label or no point, a callout outside the crop, and two
callouts on one cell. What a cell drawing cannot carry is the kit's **leader lines**: a row is 16px, so a 4px leader
rounds away (the same number the redline records) — the digit sits in the cell beside its part instead.

**`appShell`: the page's own bands.** A region is `{ "band": "nav", "element": "sky-bar", "x": 0, "y": 0, "width": 360,
"height": 64 }`: the element is looked up in the frame and the box is that element's own, so a band cannot be a rectangle
the author drew, and `check` counts the union in pixels — the three bands cover the page's 273,600 exactly and no two
overlap. The drawing is the page's cell grid with each band's rule on its own top and bottom rows and its label inside it,
the band's word in the ink (`label`) role and the element's name in the muted (`note`) one. The Sky page's 664px feed is
41.5 cells tall, so the cell grid rounds half a cell away and leaves one blank row above the status line — the union the
check counts is the boxes' in pixels, not the drawing's in cells.

**`cardGrid`: the page's repeated cards.** A card is `{ "index": 0, "element": "sky-card-0", "x": 12, "y": 76, "width":
336, "height": 190 }`, and `gridOf` derives the three grid numbers from the boxes: a column is a distinct `x` (the Sky
feed's three cards are one), the row gap is the distance between one card's bottom and the next card's top (8px), and the
column gap is 0 for one column. The drawing puts each card at its own cell rect with `#0 sky-card-0` inside it, and the
note under it prints the grid the boxes make; `check` refuses a card whose element is not under `prefix`, an index listed
twice, and a column count or gap the boxes do not make. The cards are the elements the page named — `sky-card-<i>` — so a
second column of cards would need no new kind, only boxes at another `x`.

**`listDetail`: the page's two panes.** A pane is `{ "element": "sky-feed-pane", "x": 0, "y": 0, "width": 360, "height":
760 }`, and the data's two of them are the list and the detail: each element is looked up in the frame, so a pane cannot be
a rectangle the author drew, and the check counts their union in pixels — the two panes cover the page's 547,200 exactly
and share none of it. The page is the Sky page's **wide form**: at 720px the thread is a column beside the feed instead of
a float over it, so the left 360 is `sky-feed-pane` (the bar, the feed and its status line) and the right 360 is
`sky-thread` (its 44px header and its clip), and the two of them are the page. The drawing is the page's cell grid with
each pane's rule on its own top and bottom rows and its label — the role's word and the element's name — inside it, so
it reads as `appShell`'s bands do; the note under it prints the two boxes. What the drawing cannot carry is the page
inside the panes: a frame's own runs are `screen`'s figure, and this one is about where the split is.

The frames are `solid/frames/figure-{screen,anatomy,modal,responsive-pair,app-shell,card-grid,list-detail}.png` and the
command goldens `solid/goldens/figure-{screen,anatomy,modal,responsive-pair,app-shell,card-grid,list-detail}.json` (108,
25, 55, 186, 100, 80 and 148 commands); the tests are
`solid/figure-wireframe.test.ts` for the count, the rects' worst rounding, the runs' order and their `…`, the pair's two
sizes and both layouts, the refusals, the three mutations (a box rounded to pixels — 280 cells out; a run cut by bytes —
`监控摄…` 7 cells against `监控…` 5; the pair's halves swapped — its sentence), the goldens and the terminal's rows;
`solid/figure-anatomy.test.ts` for the crop's cells, each digit's cell and the characters around it, the legend, the
background dropped, the six refusals, the golden and the terminal's rows, and three mutations (a callout rounded from the
page instead of the crop — cell 4 against cell 0; a callout a row out; the background kept — six boxes against five);
`solid/figure-modal.test.ts` for the Dialog's open frame, the panel the frame drew (its cell rect one of the boxes),
the drawing, the refusals, the golden and the terminal's rows; `solid/figure-app-shell.test.ts` for the bands being the
frame's own elements (three, each at its own box), no two overlapping, the union the page in pixels, each label and rule
on its band's cell rows, the five refusals, the mutation (a band's row read at 8px down is row 8, not 5), the golden and
the terminal's rows (15 checks); and `solid/figure-card-grid.test.ts` for the cards the prefix names (three, their boxes
and indices), the grid the boxes make (one column, an 8px row gap, no column gap), the note, the six refusals, the
mutation (a column per card would be three, not the one `x` the boxes make), the golden and the terminal's rows (15
checks); and `solid/figure-list-detail.test.ts` for the wide Sky page's two panes being the frame's own elements (their
boxes, one each), no overlap, the union the 720x760 page in pixels, the two labels and the rules on the panes' own cell
rows (48 of 90 cells), the note, the six refusals, the mutation (a pane 4px off the frame's box is column 1, not 0, and
`check` refuses it), the golden and the terminal's rows (18 checks).
What remains: a page at a scroll offset (a capture is one frame, at rest), and the pixel columns above.

**The seven motion kinds.** `motionTiming`, `easing`, `stagger`, `frameStrip`, `intentCard`, `transitionSpec` and
`easingTable` (`solid/src/figure/kinds/motion.ts`) are the first kinds whose data is not typed but **solved** and
**captured**: `solid/specs/from-motion.ts` runs `solid/src/motion.ts`'s own `Track.at` and `Decay.at` at 1/60 and writes
`motion-timing.json`, `easing.json`, `stagger.json`, `frame-strip.json` and `easing-table.json`, and `solid/test.sh`
regenerates them into a temp directory and `cmp`s (`--check` does both) — so a change to the spring changes the figure in
the same commit. `solid/specs/from-frames.ts` captures the pages for the other two: `intent-card.json` is the Sky feed's
third card at nine frames, each frame's group effect its alpha and y, and `transition-spec.json` is the Dialog's menu at
the `dialog-menu` scene's entry (`settle 0`) and its settle (`settle 40`); `figure-handoff.sh` cmps both. `motionTiming` is a track's samples a bar a row, the settle marked;
`easing` is a curve a block of dots (the instants across, the values down, one scale for both curves, and the `v = 0`/peak
note under it); `stagger` is an item a row with its delay as an indent and its span as a bar; `frameStrip` is glyph-kit's
filmstrip, a frame a row with the box at its offset in cells. The data is the repository's own motion: the Dialog's panel
out on `spatial(0.2, 0)` and its menu in on `spatial(0.22, 0.1)`, the panel's entry on `spatial(0.22, 0.1)` against
`effect(0.22)` for the same travel, the Sky cards' 50ms stagger, and the panel's drop beside the feed's fling
(`decay(87.03 px/s)`, landing on 54.95px). **The README's own numbers are the script's check**: the panel's entry
`149.88, 151.07, 153.49, 156.07, 158.33` and the menu's `-10.00, -10.85, -12.58, -14.42, -16.04` are the solver's at 1/60 to
**0.00px**, the exit's fourth frame is **170.40** against the page's measured `170.39` (the page ticks on the window's
clock, the script on 1/60), and the cards' 50ms is three frames of a sixtieth. Each has a stored frame
(`solid/frames/figure-{motion-timing,easing,stagger,frame-strip}.png`) and a command golden, and
`solid/figure-motion.test.ts` holds the samples to `Track.at` (worst 0.0044px), each dot to its sample (half a value level
is 1.17px), each strip's box to the track's offset (0.47 of a cell) and the stagger's bars to the items' own delays, then
the terminal's rows to the frame's words and the browser to `?spec=` of each file. What the figures do not carry: a
figure is one track's or one run's trajectory, so a retarget mid-flight (the Dialog's reopen) is still a test's number.

**The card, the transition and the easing table.** `intentCard` is one animation as a card: the `@cssints/motion` preset
whose fields it moves (the package's `presets` table, by name, in `solid/specs/from-frames.ts`'s `presetOf`), the two
properties and the values they run between, the duration and delay, the trigger, and the frames the page actually took —
the Sky feed's third card at 16.67, 33.33, 66.67, 116.67, 166.67, 233.33, 333.33, 500 and 666.67ms, waiting its 100ms
before its 300ms entry, its alpha 0 → 255 and its y 12 → 0 read from the group effect each captured frame drew (a bar a
property a frame, filled by the frame's own progress). `transitionSpec` is one transition before and after: the
`dialog-menu` scene's keys in two captures give the menu's box at the entry's start (`40, 224.16 · 150x133`) and at its
settle (`40, 214.16 · 150x133`) and the five properties between them — the offset y `224.16 → 214.16px`, the alpha
`225 → 255`, the scale `96 → 100%`, the tilt `-2 → 0°` and the shadow's blur `0 → 14px` — with the 220ms the Dialog's
longest track names and no delay. `easingTable` is the app's curves in one table: a row a curve (the panel's entry, the
menu's slide, the scrim's fade, the panel's exit, the card's entry, the card's fade and a hover's fade), its class, its
duration and bounce, and its progress at 0, 25, 50, 75 and 100% of its duration — computed by `from-motion.ts` calling
`Track.at` at those instants, so the entry's 220ms `spatial(0.22, 0.1)` reads 0.00, 49.40, 86.85, 98.04 and 100.04%.
The springs and the numbers a page starts an entry from are `solid/src/animations.ts`'s, imported by `app/Dialog.tsx`,
`app/Sky.tsx` and the two generators, so a timing cannot drift from the figure. Each has a stored frame
(`solid/frames/figure-{intent-card,transition-spec,easing-table}.png`, 73, 15 and 85 commands) and a command golden, and
`solid/figure-{intent-card,transition-spec,easing-table}.test.ts` holds the card to nine re-captures of the page's group
rows, the transition to a re-capture of both frames and the Dialog's constants, and the table to the solver at every
point, then the drawing, the refusals, the terminal's rows and a mutation each (16, 16 and 14 checks).
`layerStack`, `tokenTable` and `table` — and, as before, the kit's other kinds, its motion, and its exports to HTML,
decks, SVG, PDF and PNG.

**The planning half: the map's own plan.** The kit's `areas/planning.md` documents a plan as data, and three of its
kinds are here with `native/docs/map.md` as the data — the figure that draws this repository's own steps:

| kind           | data                                                                                      | the figure                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timeline`     | `[{ label, start, end, status?, date?, note? }]`, `options` `{ width, start, end, unit }` | a step a row: its label, its span as a bar on one shared axis, the span's numbers and the date it records, and the axis's two ends under the rows |
| `statusKey`    | `[{ label, sentence }]`, `options.used`                                                   | a mark a status, its word and what it means; the entries are the declared set the figures use                                                     |
| `nowNextLater` | `{ now, next, later: [string] }`                                                          | three columns of cards, a card wrapped in its column                                                                                              |

What changed from the kit: a gantt row's `label`/`start`/`end` and its `options.width`/`.unit` are read on an axis of the
plan's own order (one step is four cells) and `scale` is gone, because the map has an order and dates, not hours; a
`statusKey` row gained `sentence`; and `timeline` rows gained `status` (the word the key legends), `date` (an axis a
row's may not run backwards on) and `note` (a recorded date that is not an axis — the map's dates do not run in its
order). The checks are ours, in the kit's voice: a span that ends before it starts, a row with no label, a date out of
order, a span past `options.width`, an empty column, and a status the declared set does not have.

`timeline.json` is **generated**: `node native/solid/specs/from-map.ts` parses the numbered bold headings of the map's
`## Order of work` (a label is the heading after `Done:` and before `in`, its status is `Done` when the heading says so
and `Left` otherwise, and its note the first date the section records), and `solid/test.sh` regenerates it into a temp
directory and `cmp`s — a step added, renamed or reordered in the map is a `cmp` line, not a stale figure. The map itself
draws that timeline: a `<!-- glyph-kit: ../solid/specs/timeline.json -->` fence is redrawn and `cmp`'d too.
`nowNextLater.json` is **hand-written**: the map's `Left:` lines mix remaining work with notes of what came later (one
opens `Left: **termbox2 is in** …, and so are clicks; what a click cannot do is hover`) and the now/next/later split is a
judgement about the map's own order of targets, so the parse is not honest enough; `solid/figure-planning.test.ts` holds
every card's words and every status's name to the map's, so a renamed line still fails. `statusKey.json` is hand-written
with a `source` naming the map's words.

The numbers: the timeline is **8 rows** of 4 cells on a 32-cell axis, each fill's box **0.00 of a cell** from its span
(`0–1 step` … `7–8 step`), and the axis's words at the axis's first and last cells. The key is **3 rows** (Done, Left,
Blocked), one a status the timeline uses or the map's word for work that waits. The board is **19 cards** — 1 now, 15
next, 3 later — each wrapped to 20 cells and every segment a text command. The desktop frames are
`solid/frames/figure-{timeline,status-key,now-next-later}.png`, the command goldens `solid/goldens/figure-*.json`, the
browser draws `?spec=timeline`, `?spec=statusKey` and `?spec=nowNextLater`, and the terminal's rows are the pixel
figure's.

**The three chart kinds: a recorded series, a ratio against its floor, and our palette's own matrix.** `sparkline`,
`meter` and `heatmap` (`solid/src/figure/kinds/charts.ts`) are the kit's `areas/metrics.md` ordinary charts, with this
repository's numbers:

| kind        | data                                                                      | the figure                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sparkline` | `{ label, values: [number], unit? }`                                      | a point an eighth of a cell (`▁▂▃▄▅▆▇█`), the min and max labelled under the row and the last value printed after it                                         |
| `meter`     | `{ label, fg, bg, min, value, max? }`                                     | a 0..`max` track (21 cells, a cell a point), the fill `value/max`, the ratio and `pass`/`fails min:1` (the engine's comparison, painted by `good`/`problem`) |
| `heatmap`   | `{ rows: [{ label, fg }], columns: [{ label, bg }], values: [[number]] }` | a row an ink, a column a page, a cell one of four shades by its ratio's WCAG band (under 3:1, 3–4.5, 4.5–7, 7:1+)                                            |

`solid/specs/sparkline.json` is **hand-written and says so**: the desktop frame's draw phase over twelve back-to-back
`bun solid/main.ts --bench 200` runs on the Sensors page (Apple M2, 2026-11-04, load average 8.3), `0.333, 0.318, 0.318,
0.315, 0.311, 0.315, 0.314, 0.415, 0.325, 0.326, 0.312, 0.310` ms. It is a **recorded series, not a benchmark at render
time**: the frame draws the numbers in the file and never runs `--bench`, so a slow machine does not move the figure.
`meter.json` and `heatmap.json` are **generated** by `specs/from-charts.ts` from the docs' open-props light palette and
the engine's contrast (`packages/cssints/src/color.ts`): the meter is `link on bgSubtle` at 4.5:1 (4.51 passes by a
hundredth), and the heatmap is the Open Props grey inks 5..12 on `bg`, `bgSubtle` and `bgMuted`; `solid/test.sh`
regenerates both and `cmp`s, so a token change that left a ratio stale is a suite line.

The layout gained two items for them, beside a palette's `swatch` and `marker`: `spark` (its `eighth`; a bottom-aligned
bar on the pixel targets, and the same point's `▁`..`█` in text — Roboto has no `▁`, so the pixel target draws the bar and
the glyph is the text command the terminal prints and the row comparison reads) and `shade` (a level; `░▒▓█` in text and
one step of `Figure.styles.ts`'s four-shade ramp on a pixel target). `text.ts` draws both in two branches and knows no
kind. `solid/figure-charts.test.ts` reads each sparkline point's eighth back from its fill's height (worst **0.00 of an
eighth**), the meter's fill (**4.51 of 21 cells, 0.00 off**) and its verdict against the engine's comparison, every
heatmap cell's band and colour (**24 cells**, 8 inks × 3 pages: 5 under 3:1, 1 at 3–4.5, 1 at 4.5–7, 17 at 7:1+), every
ratio the engine's, the three specs' refusals, their command goldens, the terminal's rows and three mutations (a
sparkline drawn evenly: 7 eighths off; a flipped meter verdict: the engine disagrees; a heatmap shade from the cell's
index: 17 of 24 cells wrong). The frames are `solid/frames/figure-{sparkline,meter,heatmap}.png` (592x112, 624x80,
640x224), the goldens `solid/goldens/figure-*.json`, and the browser draws `?spec=` of each. What remains: the SVG/HTML
export half draws neither `spark` nor `shade` yet (it draws the boxes, bars, texts, swatches and markers it knows), which
is the export work's, not a kind's.

**The forecast kind: our own release cadence, projected.** `forecast` (`solid/src/figure/kinds/charts.ts`) is the
thirty-seventh and the one whose data is this repository's own: `CHANGELOG.md`'s 40 dated headings are a daily series —
26 days, 2026-10-10 to 2026-11-04, one or two most days, nine on 2026-10-30, a quiet day a zero — and
`solid/specs/from-releases.ts` counts them, fits the last 14 days (mean **2.50** a day, population sd **2.29**) and
projects the next 7 at that mean, each day with the band `mean ± 1 sd` clamped at zero. `solid/figure-handoff.sh`
regenerates and `cmp`s the spec, so a release added to the changelog is the figure's next column. The drawing is the cell
grid, one cell a count: a column a day of `#`, the projected days to the right of a one-cell gap as `=` inside the band's
`:` cells (the `good` and `muted` roles), the series' max at the top and `0` on the baseline, three dates under it, the
legend, and the fit's own mean and sd. Its six refusals are ours: no samples, dates that do not run forward, a horizon
that is not a whole number above zero, a band below zero, a band upside down, and a model with no sentence.
`solid/figure-forecast.test.ts` (22 checks) re-derives the series from `CHANGELOG.md` and the fit from the series, reads
a named day's column back out of the drawing, the projected cells' paint and height, the band's width (5 cells, not the
projection's own 1), the legend and the fit's words, the six sentences, two mutations, the golden
(`solid/goldens/figure-forecast.json`, 39 commands) and the terminal's rows. The frame is
`solid/frames/figure-forecast.png` (632x272), and the browser draws `?spec=forecast`. It is a projection of a count, not
a promise.
