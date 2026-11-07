# The map: one UI, many targets

Styles in cssints, components in Solid 2 JSX, drawn on a desktop GPU, on an ESP32's CPU, in a browser and in a
terminal. This page says which layer does what on each target, what is proven, and the order of the work.

## Four layers

| Layer   | What it does                     | Where it runs                       |
| ------- | -------------------------------- | ----------------------------------- |
| Author  | cssints styles, Solid JSX, state | the editor (types catch errors)     |
| Compile | a style to a JS literal or to C  | the build (the cssints Vite plugin) |
| Layout  | boxes from styles and content    | the target: Clay                    |
| Raster  | pixels from boxes                | the target: GPU or CPU              |

The rule (esp32 bean esp32-8j6y): **what can be computed at build time is computed at build time.** A style is data;
it needs no runtime on the device.

## Targets

| Target          | Styles         | Layout        | Raster                                     | JS at run time         | Status                                          |
| --------------- | -------------- | ------------- | ------------------------------------------ | ---------------------- | ----------------------------------------------- |
| Desktop (macOS) | `cssints/clay` | Clay          | Clay's SDL3 renderer (GPU)                 | optional (Bun)         | a page in a window                              |
| ESP32-S3        | `cssints/clay` | Clay          | esp32's `render.c`, CPU bands              | none                   | clay-test's shell, 22 ms a frame                |
| Browser (WASM)  | `cssints/clay` | Clay (C→WASM) | canvas 2D                                  | none (the generated C) | a static frame and its `use_g` twin on a canvas |
| ESP32-P4        | `cssints/clay` | Clay          | CPU + PPA (2D DMA)                         | none                   | later, needs a board                            |
| Terminal        | `cssints/clay` | Clay (cells)  | Clay's `termbox2` renderer                 | optional (Bun)         | after desktop; replaces `cssints/tui`           |
| iOS, Android    | `cssints/clay` | Clay          | ThorVG CPU, on a Metal/GLES surface (SDL3) | none (the generated C) | planned; the first slice is the section below   |

Facts behind it:

- Clay ships renderers: `SDL3`, `SDL2`, `GLES3`, `sokol`, `raylib`, `cairo`, `web`, `win32_gdi`, `terminal`,
  `termbox2` (checked 2026-10-19). SDL3 3.4.14 is installed here.
- The ESP32-S3 has no GPU, and a full 360×360 frame of esp32's `clay-test` shell — 55 render commands, a 256-element
  arena in PSRAM — measures **layout 3.1–3.3 ms, raster 16.7–19.2 ms, panel push 1.3–1.5 ms, 21.4–24.2 ms a frame**
  (board log, 2026-11-06, esp32 `f0c55f4`, the app's own `esp_timer` around `ui_frame` and around `draw_bitmap`).
  The CPU raster is the floor; the 80 MHz QSPI push overlaps the next band's raster, so the panel is not the limit.
  On the board today: `firmware/clay-test` at `f0c55f4`, `clay_test.bin` 1,247,120 B (19% of the app partition free);
  the vendor image restores from `vendor/ESP32-S3-Touch-LCD-1.85B/Firmware/…-Factory.bin`.
- It holds **33.3 fps** drawing every band every pass over 30 s at 74% busy: the loop yields one 10 ms FreeRTOS tick
  between frames, so 22 ms of work is ~45 fps of headroom. Idle it draws nothing (`drawn 0.0/s`, `busy 1%`): the app
  diffs its commands and skips layout too. What a _partial_ repaint costs was not measured — the only way to change
  the picture on this firmware is a finger or the clock screen, and the board's HTTP API has no input endpoint.
- esp32's `ui.c` and `render.c` are plain C with no ESP-IDF; `host/test.c` already runs them on a Mac.

## Why desktop first

- It is where the framework has to grow: windows, input, text shaping, a GPU raster, live reload, Solid. The board
  only needs what the desktop already proved, compiled to C.
- The loop is seconds, not a flash. Every later target is checked against desktop frames.
- The board is proven at the points that were risky: generated C equals hand-written C on the device, and a whole
  Clay app shell draws there at 33 fps. It does not block anything, so it waits.

Other targets **later, not in parallel**: each one is a renderer choice under the same layout, so doing them after
the desktop costs a renderer, not a redesign. One exception runs alongside at no cost: `check.sh` keeps checking the
generated C against Clay's header, so the board path cannot rot — by default the vendored `native/vendor/clay/clay.h`,
and `CLAY_H=$HOME/github/esp32/firmware/clay-test/main` points the same check at the board's own copy of `clay.h`,
which on 2026-11-06 is byte for byte the vendored one (`062448b8…`).

## The terminal

A Clay target like the others: Clay's numbers have no unit, so a measure function that returns one per character
lays out in cells, and Clay's `termbox2` renderer draws them. Focus, text input and the caret are built once in the
framework for the desktop and reused here; the system theme of `@cssints/tui/system` is renderer-neutral and comes
along.

It replaces `cssints/tui` and its OpenTUI and bomb.sh adapters, but not before it can carry what they carry today:
apps/csssky-tui and the docs' `/tui` page. Then `cssints/tui` is deprecated, csssky-tui moves over, and the old
subpath is removed in a breaking release with a migration. Lengths stay per target: a style in cells is not a style
in pixels, so a terminal page has its own styles under the same member names.

**Figures from one spec.** A figure is one JSON file in glyph-kit's format (`solid/specs/*.json`, MIT, no code taken) and
that file is the only place it is defined — its `data` may be a file beside it (`"@data/…"`), and `sample: true` stamps
the figure SAMPLE DATA: `solid/src/figure/kinds.ts` turns it into rows of items whose lengths are
cells, and the desktop, the terminal and the browser draw those rows — the desktop and the browser at 8x16 px a cell, the
terminal at one cell. Forty-two kinds are here: `anatomy`, `appShell`, `barChart`, `beforeAfter`, `branchFlow`,
`cardGrid`, `cohort`, `colourRoles`, `compare`, `contrast`, `easing`, `easingTable`, `flow`, `forecast`, `frameStrip`,
`funnel`, `heatmap`, `intentCard`, `journeyMap`, `layerStack`, `listDetail`, `meter`, `modal`, `motionTiming`,
`nowNextLater`, `palette`, `qaChecklist`, `redline`, `responsivePair`, `screen`, `spacingScale`, `sparkline`,
`stagger`, `stateMachine`, `stateMatrix`, `statusKey`, `table`, `timeline`, `tokenTable`, `transitionSpec`, `tree`,
`typeScale`. A kind is one file under `solid/src/figure/kinds/` —
`metrics.ts`, `charts.ts`, `flows.ts`, `structure.ts`, `systems.ts`, `planning.ts`, `motion.ts`, `handoff.ts` and
`wireframe.ts`, over `shared.ts` — its layout and its refusals side by side and one `register` call at the bottom, so a
new kind is its own file and no other kind's;
`solid/src/figure/kinds.ts` is the door that loads those files and `registry.ts` the table a kind is looked up in. A
`screen` is a page of this repository's own frame cut to the cell grid, an `anatomy` is one region of that page with
numbered callouts and their legend, an `appShell` is a page's shell bands — the Sky page's bar, feed and status line —
each the element the frame drew and its own box, a `cardGrid` is a page's repeated cards — the Sky feed's three post
cards — each at its own box with its index and the columns and gaps its boxes make, a `listDetail` is a page's list pane
and its detail pane — the Sky page's wide form, its feed's column and its thread's, each the element the frame drew, and
the two of them tiling the 720x760 page — a `modal` is the Dialog's frame with its modal open (the scrim is the page's
rectangle, the panel inside it, and the panel's box under the drawing), and a `responsivePair` is a page at two widths —
the data is the captured command stream, so a wireframe is the page and cannot drift from it. The systems file's ninth
kind is not a design system: `table` is the generic one —
columns with a heading and an alignment, rows of cells, the heading once with a rule under it, and a value cut to its
column with `…` at the cell (counted in cells, not bytes). Its data is this page's own Targets table:
`solid/specs/from-targets.ts` parses it and writes `table.json` from four of its six columns, and
`solid/figure-handoff.sh` regenerates and `cmp`s it. Eight of them are the design system's half, and their data
is ours — five our own token sets, three the system's own sources (the Dialog's frames, the pages' styles, the docs' token
file): `palette` (`@cssints/tokens`' Open Props blue and grey on
their page, a swatch and its contrast a step, `▲` on the first step at 4.5 to 1), `contrast` (the docs' own
colour pairs at WCAG's floors) and `colourRoles` (seven of those pairs in both modes, each mode's two swatches, its ratio
and its verdict) are **generated** by `solid/specs/from-tokens.ts` from those files and the engine's contrast
(`packages/cssints/src/color.ts`), with `cmp` in `solid/test.sh`; `spacingScale` (`apps/docs`' `space`) and `typeScale`
(its `fontSize` with the roles' line heights) are hand-written from `apps/docs/src/tokens.json`. `layerStack` is the
half's sixth and its data is a page instead: the Dialog's own layers, back to front — the page, the modal's scrim and
dialog (its modal frame), the menu (its menu frame) — with each layer's z, box, fill alpha, radius, backdrop blur and
shadow read from the command and effect row that draw it, generated by `solid/specs/from-frames.ts` and `cmp`'d.
`stateMatrix` is the seventh and its data is the pages' **style modules**: `solid/specs/from-styles.ts` walks the
Widgets, Sky and List pages' `s` maps and the Sensors page's exports for a `:hover`/`:focus`/`:active` key, so a style a
row and a state a column is a `+` only where that style declares it — 23 styles, 15 hovering, 21 focusable, 13 pressable
— and `solid/test.sh` regenerates and `cmp`s the spec. `tokenTable` is the eighth and its data is `apps/docs`'
`tokens.json`: the thirty length and number tokens of seven groups in one table, each value resolved the way the file
means it (a `calc(Npx * {scale.k})` with the scale the file declares), with the group's name once over the run of its
tokens. A palette's swatch and a
type line's own size are what the layout gained — an item kind `swatch`, an item kind `marker`, and a text's `size` with a
line's `height` — so the halfway kinds still print through the same text renderer. The last of the original eight draws a
second row: a tree's level is a row of boxes with `| - +` connectors between the levels, and a journey stage is a bar row
with its doing and thinking under it. The last three are the handoff and QA half of the kit's `areas/handoff.md`, and
their data is this repository's own: `redline` is the Widgets page's Wi-Fi switch row — its 10px padding, 44x24 track,
12px gap and 204px label — drawn as leaders and numbers and held to the page's **packed style** (`app/Widgets.tsx`
through `src/pack.ts`) by `solid/figure-handoff.test.ts`; `beforeAfter` is the same switch off and on, and its two
measures' numbers are the two stored frames' commands (`solid/specs/from-frames.ts` writes `before-after.json` from them,
and `solid/test.sh` regenerates and `cmp`s); `qaChecklist` is a dozen of the suite's own printed comparisons — the stored
frames `solid/test.sh` compares and the terminal comparisons `terminal/test.sh` prints — with a summary the rows count
and a refusal for a row naming a comparison no script prints. The three **planning** kinds are this repository's own plan: `timeline` is the
eight steps of this page's order of work, one a row on a shared axis (the span is the step's place in the order, not
hours; the dates a step records are notes), and it is **generated** from this file by `solid/specs/from-map.ts` and
`cmp`'d in `solid/test.sh`, so a step added or renamed here cannot leave the figure stale; `nowNextLater` is the `Left:`
lists as three columns of cards, hand-written because those lines mix remaining work with notes of what came later, and
held to this file's words by `solid/figure-planning.test.ts`; `statusKey` is the legend of the statuses the two use
(`Done`, `Left`, and `Blocked`, this page's word for work that waits). The
numbers are geometry: a bar's fill is a box whose width is `value/max` of its track, read back
from the frame in `solid/figure.test.ts` (worst error 0.49 of a cell). One of the figures is this repository's own
measurements (`solid/specs/bars.json`, native/README.md's `--bench`):

```text
A frame, by target
desktop   ████████████████████████  0.30 ms
terminal  ██████                    0.077 ms
browser   ██████                    0.08 ms
native/README.md --bench: 0.30, 0.077, 0.08 ms
```

The plan on this page, drawn from `solid/specs/timeline.json` (the fence is the renderer's, and `solid/test.sh` redraws
and `cmp`s it):

<!-- glyph-kit: ../solid/specs/timeline.json -->

```text
The plan's order, one step a row
cssints/clay          ████                            0–1 step
desktop window            ████                        1–2 step  2026-10-19
states, tokens, fonts         ████                    2–3 step  2026-10-19
Solid on the desktop              ████                3–4 step  2026-10-31
JSX to C                              ████            4–5 step
the terminal renderer                     ████        5–6 step
Back to the board                             ████    6–7 step  2026-10-19
the browser                                       ████ 7–8 step  2026-10-29
                      0 step                    8 step
native/docs/map.md, steps 1-8; a span is the order, a date is a note
```

`pipeline.json` is this pipeline's own flow (declaration → Clay → commands → ThorVG / cells / Canvas2D); `funnel.json`
and `compare.json` are the kit's examples, adapted. `native/README.md`'s "Figures from specs" chapter is the whole of it.
Its seven **motion** kinds (`motionTiming`, `easing`, `stagger`, `frameStrip`, `intentCard`, `transitionSpec`,
`easingTable`) are the other half's and the first whose data is `solid/src/motion.ts`'s **own**: `solid/specs/from-motion.ts`
runs the solver at 1/60 and writes `motion-timing`, `easing`, `stagger`, `frame-strip` and `easing-table.json`,
`solid/test.sh` regenerates and `cmp`s them, and the check re-runs the same spring from the data — so a motion figure is
the trajectory the pages take, not a drawing of one.

**The motion half is complete** (2026-11-06). The kit's three remaining motion types are here too, and their data is the
repository's own.

`intentCard` is one animation as a card: the `@cssints/motion` preset whose fields it moves (the package's `presets`
table, by name), the properties and the two values each runs between, the duration and delay, the trigger, and the frames
the page actually took — `solid/specs/from-frames.ts` captures the Sky feed's third card at nine frames and reads each
frame's group effect, so the card's alpha and y are the pixels the page drew, not a model's samples.

`transitionSpec` is one transition before and after: the `dialog-menu` scene's own frames give the menu's box at the
entry's start (`40, 224.16`) and at its settle (`40, 214.16`), and the five properties that move between them — the
offset, the alpha, the scale, the tilt and the shadow's blur — with the duration the Dialog's longest track names (220ms).

`easingTable` is the app's curves in one table: a row a curve, its class, its duration and bounce, and its progress at 0,
25, 50, 75 and 100% of its duration, which `from-motion.ts` computes by calling `motion.ts`'s `Track.at` at those
instants (a spring's duration is its period, so a row's 100% is 100.04%, not its settle).

The springs the pages run on and the numbers a page starts an entry from are `solid/src/animations.ts`'s now, imported by
the pages and the generators both, so a duration changed in a page changes the figure in the same commit.
`from-motion.ts --check` guards the easing table beside the four earlier specs, and `figure-handoff.sh` cmps the card and
the transition against the frames they come from.
`forecast` is the thirty-seventh kind and the one whose data is this repository's own cadence: `CHANGELOG.md`'s 40 dated
release headings are a daily series (26 days, 2026-10-10 to 2026-11-04, a quiet day a zero), and
`solid/specs/from-releases.ts` counts them, fits the **last 14 days** (their mean, 2.50 a day, and their population
standard deviation, 2.29) and projects the **next 7** at that mean, each day with the band `mean ± 1 sd` clamped at zero
— a projection of a count, not a promise. `solid/figure-handoff.sh` regenerates and `cmp`s the spec, so a release added to
the changelog is the figure's next column and not a stale drawing.
`cohort` is the thirty-ninth and the only kind whose data this repository had to **collect**: Bluesky's public Jetstream
firehose, twenty minutes of `app.bsky.feed.post` (2026-11-07 06:11Z, 17,354 accounts, 33,551 posts), recorded once by
`solid/specs/collect-jetstream.ts` into `samples/jetstream.json` — an account and the minutes it posted in, no text and no
handles. `solid/specs/from-cohort.ts` is the arithmetic: a row the accounts of one minute (about 1,300 a minute), a column
one to five minutes later, a cell the whole percent of that row's accounts that posted again (13% a minute later, 10% five
minutes later, steady across the fifteen cohorts). Re-running the collector gives other numbers, because the network is
not a build, so the sample is committed and `figure-handoff.sh` takes the spec from the sample by `cmp` — the recording is
the data, the kind is what it means.
Its text half is the same layout as characters (`solid/src/figure/text.ts`, `solid/figure.ts`): the title, the rows with
`█` and an eighth block, the `►` line and the source, 80 cells wide or `--compact` ASCII, and `--markdown` for a page; the
eight figures in `native/README.md` are drawn by it and `solid/test.sh` re-renders and `cmp`s them, so a doc's figure
cannot drift from its spec. A future kind needs only to return its rows from `layout`: the text renderer reads no kind's
data. As files, the same layout is `docs/exports/palette.html` (one self-contained page) and `docs/exports/pipeline.svg`
(one standalone SVG), both written by `solid/figure.ts --html`/`--svg` and regenerated and `cmp`'d by `solid/test.sh`;
and for a review, `docs/exports/review.html` (a three-slide deck — `palette`, `bars`, `timeline` — with `:target`
navigation and a print sheet that is a page a slide) and `docs/exports/bars.png`/`bars@2x.png` (the desktop host's frame
at 1× and 2×, 400×112 and 800×224), written by `--deck`/`--png` and regenerated and `cmp`'d the same way; `--pdf` prints
that deck to a PDF, one page a slide, through Playwright's Chromium.

**The console as a fourth screen** (2026-11-05). The terminal's cells, printed to a browser's console instead of drawn:
`terminal/cells.c`'s `cells_console` makes one `console.log` call of a grid — a `%c` run a foreground/background pair, a
row a console line, every cell of the row (the trailing spaces carry the background), a literal `%` doubled so the format
does not read it. One C function, two hosts: `libterm` for Bun (`terminal/solid.ts --console`, `--console-frames`) and
the browser's `ui.wasm`, where `terminal/render.c` and `terminal/cells.c` are compiled beside Clay (`browser/ui.c`) and a
Solid page reads the bytes out of the wasm's memory (`browser/solid/console.ts`). The reference is
[textjs](https://github.com/anomalyco/textjs) (MIT): its **numbers** and its rule, not its React + Yoga stack — the console
is a **sink on our cells path**, not a second framework, and not a `cssints` member (the engine owns styles, a renderer
owns the screen; a React + Yoga port would fork the layout engine and the component model the "each target is a renderer"
rule forbids). What it buys: a fourth screen for the same page and the same Clay numbers, a debugging channel that prints
a whole frame, and a cheap demonstration that one tree reaches many displays.

**The rule a console needs**: no double buffer, so every write scrolls. The sink compares the new grid with the frame
before it and writes **only the rows that changed** — a console line starts at column 1, so a run of changed cells cannot
be printed alone — and a frame at rest writes nothing: 30 idle frames are 30 `[]` lines, 90 bytes, no console line. Tab on
the Sensors pill writes its 3 rows, whole. This is the desktop's hash rule (`ui.hash` → `0 draws`) one level down; the
reference arrived at it independently: a corroboration, not a port. Numbers (M2, 80x20 cells, file write included in both):
Sensors **3,315 B** against the ANSI dump's **3,018 B** (1.10x), **0.09-0.14 ms** against **0.13-0.23 ms**; Sky **5,449 B**
and 98 runs; the browser page's bundle **197 KB** and a frame **0.04-0.07 ms**. Checks: `terminal/console.mjs` (the JSON
parses back to the ANSI dump's cells and SGR truecolours, 1,600 cells, glyph and both colours; the text dump a cell for a
cell; the diff, 30 idle frames, the no-diff mutation, the bytes and ms) and `browser/console-check.mjs` (the browser page's
frame is the terminal's, cell for cell, at rest, after Tab, after a press on the pill and after Space; 20 frames at rest
write no line; the canvas has no pixels; `v` and `?vitals` print the vitals group — on a canvas page the console is the only
devtools). **What it cannot be**: accessible (a console has no tree), typed (the page's keys, not a text
field: the Field page cannot run here), typographic (monospace; a cell's width is the console's, so a proportional font or
a wide glyph breaks a row the sink cannot know), or portable (a phone has no console; Firefox's and Safari's consoles
render `%c` and scroll differently). Not here: FIGlet titles, deferred — the Hershey spike already said a data font's niche
is a ROM-bound board at one signage size.

## Where Solid runs

| Target   | Solid                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------ |
| Desktop  | Solid 2 universal renderer building Clay's tree each frame (Bun FFI)                             |
| ESP32    | none at run time: JSX evaluated at build time to C, state in C                                   |
| Browser  | Solid 2 universal renderer over Clay in wasm on a canvas; the generated C kept as the no-JS page |
| Terminal | the desktop's universal renderer over Clay, cells for pixels                                     |

Measured for the ESP32: QuickJS 38 ms a UI turn (retired, esp32-mkn5); scriptc 0.3.6 has no Xtensa/RISC-V target and
segfaults on one Solid 2 `createSignal`; porffor is alpha.

## The contract

`ClayShape` of `cssints/clay`: the fields of `Clay_ElementDeclaration` and `Clay_TextElementConfig`. The plugin writes
it as a JS literal (desktop, browser) and `header()` as C (firmware). Text is per target: shaped glyphs on the
desktop, 4-bit bitmaps by `fontId` on the board.

## Order of work

Each step ends in a check that fails when it breaks.

1. **Done.** `cssints/clay`, `header()`, `generator/clay-header.ts`; `test.sh`: generated C gives the same render
   commands as hand-written C; the Units pill flashed and working on the board.
2. **Done: desktop window.** `vendor/clay` (clay.h and the SDL3 renderer at `e6cc369`, the same clay.h as the
   firmware's), `desktop/host.c`: a window on Metal, or one frame headless on SDL's software renderer.
   `examples/sensors`: the Sensors page from `styles.ts`, with a fixed sample. Check: two stored frames, before and
   after a scripted click on Units, compared pixel for pixel.
   **Done: the ThorVG raster.** `desktop/clay_renderer_thorvg.c`: Clay's commands as a ThorVG scene on its software
   canvas (brew thorvg 1.1.3, CPU engine only), `host --raster thorvg`, the default raster (`--raster sdl` is Clay's); text measured by ThorVG too.
   Check: two
   stored frames of its own (`expected-thorvg*.png`). Headless on an M2, the same 360x360 frame, one thread: ThorVG
   0.30 ms, SDL's software renderer 1.2 ms (2026-10-19; it does not transfer to the board). GL/WebGPU engines need a
   ThorVG built with them; then the ESP32-S3: ThorVG SW against `render.c`'s 16.7–19.2 ms of a 21.4–24.2 ms frame
   (board, 2026-11-06).
   **Probed 2026-10-21: ThorVG's WebGPU engine is reachable on this Mac, and it is not the faster raster here.**
   `brew` builds thorvg with `-Dengines=cpu` (its formula; `nm` on the dylib has `GlCanvas`/`WgCanvas` as stubs and
   no GL/EGL/Dawn/Metal link, and a probe prints `swcanvas=<ptr> glcanvas=0x0 wgcanvas=0x0`), so the installed one
   cannot. Building 1.1.3 from source with `-Dengines=cpu,wg` against brew `wgpu-native` 29.0.1.1 (the version
   ThorVG's own CI pins; Metal backend, no Dawn, no EGL, no surface needed) works, and `tvg_wgcanvas_create` +
   `tvg_wgcanvas_set_target(device, instance, texture, w, h, ABGR8888, 1)` renders into a `BGRA8Unorm` texture (its
   blit pipeline is built for BGRA; read back and swapped to RGBA). That is `--raster thorvg-gpu` here:
   `desktop/thorvg_wg.c` (device, texture, copy-to-buffer, map, swizzle), `desktop/build-thorvg-gpu.sh` (ThorVG in
   `$TMPDIR`, then `build/<example>/app-gpu`, or `solid` for `build/solid/libui.dylib` with `ui_init_gpu`).
   `examples/sensors/expected-thorvg-gpu.png` is its own frame: shapes, colours and text land on the CPU frame's
   pixels (mean channel of the frame within 0.06/255), 3809 of 129600 pixels differ, every one of them on a glyph or
   rounded-corner edge and nowhere else (max 90/255, mean 16/255 there) — the GPU tessellates and anti-aliases edges
   its own way. Numbers, M2, one thread, `--bench 500`, same 360x360 Sensors frame: software 0.31-0.34 ms, WebGPU
   **0.85-0.87 ms** (submit + copy + map + swizzle back to CPU pixels), SDL's software renderer 1.30-1.43 ms; at
   1080x1080 it is 0.62 ms against 2.19 ms, so the readback dominates and the GPU does not catch up by frame size.
   Verdict: kept as an opt-in probe, not the default. The GPU path only wins if a frame never comes back to the CPU —
   i.e. ThorVG draws into the window's own WebGPU surface (`tvg_wgcanvas_set_target` type 0) and presents it, which
   means this host would have to own a WebGPU swapchain instead of SDL's renderer (the SDL Texture upload goes away,
   but SDL3's GPU API cannot host a WebGPU texture; either the window becomes wgpu-native's own, or the host stays on
   SDL and the readback stays). For the ESP32-S3 the CPU engine remains the target either way.
   **Tried 2026-10-21: that surface path, and it draws the page.** `desktop/wg_window.c` (opt-in:
   `sh desktop/build-wg-window.sh` -> `build/sensors/wg-window`) owns the window: SDL for the events and its
   `CAMetalLayer`, wgpu-native wraps that layer in a surface, ThorVG's WebGPU canvas targets it (type 0) and the loop
   presents it — no copy to a buffer, no map, no SDL texture upload. `--capture` draws one frame into a swapchain
   texture this file acquires itself (type 1) and reads it back once, which is how the frame is checked without a
   screen: **0 of 518400 channels differ from `expected-thorvg-gpu.png`**, so the window shows the CPU frame exactly.
   (The trap on the way there: a host that does not create `tvg.measurer` measures every run at width 0, Clay then
   stacks all the page's text in the middle of the window, and the frame differs in 58872 channels — that paint is
   `Clay_ThorVG_MeasureText`'s only state, and the surface path has nothing else to set it.)
   Numbers, M2, one thread, `--bench 200`, five runs each: the surface path is **12.4-16.4 ms a frame (61-81 fps) at
   1080x1080 and 12.7-16.4 ms at 360x360 — one range, the screen paces it, not the GPU**. Per frame, layout is
   0.02-0.09 ms and present 0.008-0.026 ms (it never waits); the rest sits in ThorVG's sync. Timed from inside a
   throwaway ThorVG build (temporary timers in `WgRenderer::sync`), that sync is 14.2 ms at 360x360 and 14.8 ms at
   1080x1080, of which the layer's next drawable is 13.7 and 13.3 ms: ThorVG's own frame work is **0.49 and 1.49 ms**,
   the wait is the compositor's — a 16x16 surface still takes 8.2 ms, and `--novsync` (a non-Fifo present mode on top
   of ThorVG's Immediate) does not lift it. So vsync cannot be separated from the frame here, only from its parts: what
   is left out of the wait is 0.5-1.5 ms of ThorVG's work. Against the readback path at the same sizes, CPU raster
   0.31 ms / readback 0.67-0.80 ms at 360x360 and 0.52-0.70 / 2.1-2.3 ms at 1080x1080: the surface path removes that
   readback (0.3-0.6 ms of it) and the texture upload, but ThorVG's WebGPU frame work is itself more than the CPU
   raster's 0.31-0.70 ms, so no raster gets faster for it — the frame just runs at the screen's pace. Kept as an opt-in
   experiment; the defaults (`--raster thorvg`, `--raster sdl`, `--raster thorvg-gpu`) are untouched.

3. **Done: states, tokens, fonts in `cssints/clay`.** `css.hover`/`focus`/`active` print as whole declarations of
   their own (`units_active`); `createTokens` and `createGlobalTheme(tokens, "light", ...)` print every style again
   per theme (`units_light`, `units_active_light`, `title_text_light`), so a page switches at run time by a suffix;
   `fonts("Roboto")` sets `fontId` and prints the font order as an enum. `examples/sensors`: colours as tokens, the
   the pill as `css.hover` and `css.active` (page.c picks `units_hover` over it, `units_active` when held), `THEME=light` for the light theme.
   The pressed look lifts the surface instead of the firmware's `ACCENT_DOWN` orange, which left the ink at 1.28:1; the
   ink on the base, hover and pressed fills is asserted at 4.5:1 and up in `solid/test.ts` (dark 15.8/10.3/7.9, light
   15.8/14.4/12.6). The firmware's `ACCENT_DOWN` is gone the same day: a pressed control sinks to `PRESSED` (28,31,40), since its rows
   carry DIM and ACCENT text too (TEXT 13.9, DIM 5.9, ACCENT 6.7). Flashed and seen on the board (2026-10-19):
   the pill and a settings row sink while held, no Clay errors, 55 commands, 22.8 ms a frame.
   Check: cssints test/clay.mjs; `expected-light.png`; and
   `examples/sensors/header.c`, the header's states and theme asserted in C99 against esp32's clay.h. In the window,
   the `t` key toggles the theme; `expected-pressed.png` stores the pressed frame (`--press`, held down). Seen in the live window (2026-10-19): `t` switches the theme, the pill presses and toggles the unit.

4. **Solid on the desktop.** A universal renderer over Clay through `bun:ffi`, live state, reload on save. Check:
   a click changes a signal and the next frame.
   **Done: the renderer and the Sensors page** (`solid/`, solid-js 2.0.0-rc.13, @solidjs/universal and
   @solidjs/compiler rc.13). The universal renderer keeps a JS tree; each frame it is declared to Clay through flat
   `bun:ffi` calls into a dylib (Clay + ThorVG + SDL3), styles from `examples/sensors/styles.ts` through the cssints
   plugin, theme and `:active` picked at run time. Check: `solid/test.sh` renders the Solid page headless and compares
   it with the C page's three ThorVG frames, pixel for pixel (identical), plus the pressed look and click rules. Cost:
   about 0.4 ms a frame on an Apple-silicon Mac, 0.006 ms of it the JS walk and FFI, the rest ThorVG's raster. Left:
   JSX types, the window checked by eye. **Done: reload on save** (2026-10-31). `bun solid/watch.ts <page>` runs the
   page in a child and watches its inputs (`solid/`, `examples/`, `apps/`, `focus/`, `headless/`, `vendor/clay/`,
   `packages/cssints/{src,dist}`): a `.c`/`.h`/`.sh` save rebuilds `build/solid/libui.dylib`, a `packages/cssints/src`
   save builds the engine, a `.ts`/`.tsx` save nothing — and then restarts the page. The old window is kept until the
   new process has a window of its own, so a save that fails to compile leaves the last good page drawing and prints
   the compiler's text. Still no in-place reload: the modules are read once per process and a `.c` save is a new
   `dlopen`; the terminal's host (`terminal/solid.ts`) is not in the loop yet. Cost, medians of three on an M2 sharing
   its 8 cores with two sibling worktrees (a load average of 41-66): a colour change in the Sky's palette took 11.6 s
   to the new window's first frame, a `.c` save 24.9 s (its dylib 4.0 s), a `packages/cssints/src` save 35.9 s (the
   engine 17.0 s). `solid/watch-check.mjs`, in `solid/test.sh`, drives it on a temp copy of the tree.
   **Headless widgets** (`headless/`, between Solid and JSX to C). The first widgets of effects-of-atmosphere's
   `@eoa/headless` (button, switch, checkbox, disclosure, radio, tabs, toolbar, slider, tree) with no DOM: Solid 2 signals for state and, instead of aria-*
   attributes, parts of plain fields (`id`, `role`, `checked`, `selected`, `expanded`, `controls`, `tabIndex`, `hidden`, `disabled`, `focused`, `valueNow`, `level`, `posInSet`, `setSize`)
   with handlers (`press()`, `key(name)`, `focus()`, `blur()`) that a Clay renderer and an accessibility tree both read. Radio, tabs, toolbar and the tree are groups of the focus manager
   (`focus/`) on one page: roving focus inside, Tab between them. The slider is one entry.
   Check: the ported APG scenarios and a seeded random walk, replayed on the parts and on the generated Quint model,
   must agree (`bun test` in `headless/`, in `test.sh`); dropping a controlled request's callback fails 39 tests.
   **Dialog and menu** (`headless/src/dialog.ts`, `headless/src/menu.ts`): the modal dialog (a trap over the focus
   manager: opening moves focus to the first control, Tab and Shift+Tab cycle it, Escape closes and restores) and the
   menu button with the checkable menus (`createMenu`; the menubar is not ported). Check: the dialog's 161 scenarios (32
   replayed, 112 gated by the bridge — `modal: false`, focus attrs — 17 carried divergences) and five walks; the plain
   menu's 114 (19 / 86 / 9) and the checkable menu's 34 (16 / 14 / 4), with their walks. Left: the menubar, other
   overlays, tree type-ahead.
   **Done: the Widgets page** (`solid/app/Widgets.tsx`, `bun solid/main.ts widgets`): the headless widgets and the focus
   manager wired to one live page; the page's styles sit in `Widgets.tsx` itself (the loader compiles JSX, then cssints
   on the result, in one child: colocation without a separate `styles.ts`). SDL key events reach JS through a queue in the FFI; a key goes to the focus manager
   (Tab, Shift+Tab, arrows), then the focused part (Space fires on key up), then the page; a press focuses a part as a
   browser does and a press on empty space blurs; `:focus` is a style state like `:active` (a 2px ring, laid over the
   pressed look). Check: six stored frames (initial, Tab Tab, switch on, mixed, disclosure open, light) and
   `solid/widgets.test.ts` (Tab order, key timing, clicks and focus, the disabled box). Seen by eye: the frames; the live window
   was started, its keys and mouse not tried by hand.
   **Done: radio, tabs, slider, toolbar on the page.** The four groups of `headless/` on the same page (360x608), in the one
   shared focus manager: radio, tabs and toolbar are its groups (roving focus, one Tab stop each; the checked radio and
   the selected tab are the entry, the toolbar remembers its last item), the slider is one entry whose rail takes the
   focus ring (the value text stays outside it) and whose rail (or knob) takes a press (`ui_bounds` gives the ratio). A held press drags: each frame's
   pointer x is the ratio, so the knob follows and the value changes continuously; a release ends it. A key goes to the manager only for Tab; an arrow is the focused part's, which moves
   focus and checks or selects. Check: eleven stored frames (the old six regenerated at the new height, their old layout
   unchanged above the new widgets; radio, tabs, slider, slider dragged, toolbar re-entered) and asserts for the full Tab
   order, one stop a group, arrows, clamping, memory, a disabled radio, the rail, the drag, the rail's ring. Seen by
   eye: the eleven frames; the window was started (`--frames 60`), its keys and mouse not tried by hand.
   **Done: the tree on the page.** The sixth group is `headless/`'s settings tree (360x760 now): Network open with
   Wi-Fi and Bluetooth, Display closed with Brightness, Storage a leaf — six nodes, one level of nesting. It shares the
   page's focus manager, so it is one more Tab stop (the twelfth) entered at the first visible row, and its keys reach the
   part as any focused part's do (no page-level key handling): Up and Down, Home and End walk the visible rows only (a
   closed subtree's node has `tabIndex: -1` and is not even in the Solid tree), Right opens a closed parent and steps into
   an open one, Left closes or steps to the parent, Space selects, Enter opens and selects, a click does both and focuses.
   The row's left padding is 18px a level, `+`/`-` marks a parent, the selected row is the panel surface with an accent
   label, and the roving row takes the same 2px ring as the other rows (both themes; the accent on the surface is
   asserted at 4.5:1). The page grew to 760 so the tallest state (panel open and Display open) still fits and nothing is
   shrunk. Check: five tree frames (Tab in, Down, Right on the closed Display, Space, light) and asserts for the stop,
   the entry, the visible-only arrows, Right and Left, Home and End, Space, the ring following the roving row, a hidden
   node skipped, the indent, and the page fitting. Seen by eye: all sixteen frames; the window started with
   `--frames 60`, exit 0, its keys and mouse not tried by hand.
   **Done: the toolbar's menu button, and the menubar in `headless/`.** The toolbar's third item is now a menu button
   (`createMenu`, radio items Small/Medium/Large, Medium checked): the item's label shows the chosen size, it carries
   `aria-haspopup`, and Down, Up, Enter or Space open the menu as a capturing float under the item (`css.float({ parent:
"format-item-2", ... })`), so the page under it is unreachable by that press. Inside, the arrows and Home/End move,
   Enter picks and closes, Escape closes and returns focus to the item, Tab closes and goes on; the page routes it through
   `input.modal`. The toolbar's roving focus treats it as one more item (Left/Right/Home/End, one Tab stop, memory), and
   the ring is now the slider's rail only, so the value text sits outside it. `headless/` also gained eoa's
   `createMenubar` (the roving bar, a menu per item, one more level of submenus, the focus manager in place of
   `document.activeElement`), its `menu-menubar.qnt` bridge, model and both scenario files vendored byte for byte from
   `09f2185`. Check: 74 menubar scenarios (26 replayed, 30 gated by the bridge, 18 carried divergences) and one walk;
   breaking Escape's focus return fails the walk and the unit test. The page: a new `widgets-toolbar-menu` frame and
   asserts for the ring on the rail only (and none on the readout), opening by Down/Up/Enter, the menu's arrows, Home/End,
   Enter picking, Escape returning focus, Tab closing, the float's `ui.bounds` under the item, a click picking, and the
   toolbar's roving with the menu button in it. Seen by eye: all seventeen Widgets frames; every frame that shows the
   toolbar changed with the third item's label (the change is confined to that item), and the two slider frames also with
   the ring. The window was started (`--frames 60`, exit 0); its keys and mouse were not tried by hand.
   **Done: floating overlays on a page** (`solid/app/Dialog.tsx`, `bun solid/main.ts dialog`). `css.float` is carried
   through `pack.ts` and `ui_open` (the style grew from 32 to 45 floats: what to attach to, the attach points, offset,
   expand, z-index, pointer capture, clip, and the parent id as two 16-bit halves, since a float32 cannot hold Clay's
   32-bit hash). A float is a layout root of its own, so the page behind it keeps its layout, and a capturing float hides
   what is under it from `Clay_PointerOver`: the modal's backdrop is a root float of the whole window and swallows every
   press, the dialog is a root float centred on the root, and the menu hangs off its trigger by id. The dialog's trap is
   the keyboard half (`input.modal`: Tab and Shift+Tab cycle its controls, Escape closes) and focus returns to the
   trigger. Check: four stored frames (closed, open, the light theme, the menu open) and `solid/dialog.test.ts` (the
   trap, Escape and Cancel, OK's write, the backdrop swallowing a press, `ui.bounds` of both floats, the page's layout
   unchanged, the menu's arrows, Escape back to the trigger, Enter and a click picking). Seen by eye: the four frames.
   The window was started for the page (`--frames 60`, exit 0); its keys and mouse were not tried by hand.
   **Done: a text field** (`solid/app/Field.tsx`, `bun solid/main.ts form`; `headless/src/textfield.ts`). Text is a
   second path beside the keys: while a text field has focus the host turns on SDL's text input (`ui_text_input` →
   `SDL_StartTextInput`/`Stop`), the poll queues every `SDL_EVENT_TEXT_INPUT` next to the keys (a composed run of UTF-8,
   never a keycode) and `ui_text_pop` hands it to `Input.textInput`, which inserts it into the focused part; the key
   queue is untouched. Editing keys stay keys — `Backspace` and `Delete` joined the names, and `selectionName` keeps
   Shift on the arrows/Home/End (the focus manager still only gets plain Tab, and `keyName`'s contract is unchanged) —
   and Cmd/Ctrl+C/X/V go through SDL's clipboard in C (`ui_clipboard_get`/`set`). The neutral `createTextField` is
   **ours, not a port**: eoa has no textfield and `specs/apg/` has no textbox, so there is no vendor file, model or walk
   and the conformance counts did not move. Its part is `role: "textbox"` with `value`, `caret`, `selection`, `valueText`,
   `readOnly`, `disabled`, `focused`, `tabIndex`, `editsText`; handlers `insert`, `keyDown`, `focus`/`blur`,
   `press(x, advance)`, `clipboard`. The page draws the caret and the selection by laying the value out as up to three
   text runs with a 1px caret box between them (Clay has no text attributes, so this needs no per-glyph measure; the
   caret costs that 1px of layout), and only a press needs an advance: the row's `ui.bounds` width over the text's
   length, an approximation a proportional font can be a character off. Check: five stored frames (empty with the caret,
   "Ada", Shift+ArrowLeft×2, submitted, light) and `solid/field.test.ts` (typing reaches only the focused field, the
   theme key after Escape blurs, the caret's and the selection run's pixels and x, the arrows, Backspace/Delete,
   `maxLength` 24, a press placing the caret, the read-only field refusing edits, Enter and Submit showing the value
   once, the page fitting); 26 unit tests in `headless/test/textfield.test.ts`. Inserting at the start instead of at the
   caret fails seven of them and two asserts of the page test. Seen by eye: the five frames, zoomed; the window started
   (`--frames 60`, exit 0) but typing in it was not tried by hand. Left: bidi, grapheme clusters (an index is a UTF-16
   unit), wrapping and multiline, undo, IME composition state (SDL's text events are committed characters), drag-select,
   and the caret's 1px layout cost.
   **Done: scrolling** (`solid/app/List.tsx`, `bun solid/main.ts list`). The viewport's offset is the page's
   (`solid/src/vscroll.ts`, the Sky feed's machine): one clip element as before, `ui.autoScroll(0)` keeps Clay's own
   wheel scrolling out, and the page writes `ui_scroll_put`/`ui_scroll_to` on it every frame. A wheel notch is 10px on a
   track (it glides and settles at exactly 10; a burst is a flick), a press inside the viewport drags it 1:1 with a 4px
   click threshold, past an end the `rubber` band resists both and lets go 80ms after the last input, and reduced motion
   clamps hard, flings nothing and lands a key at once. The wheel is gated on the pointer being over the viewport (Clay's
   own rule, kept by the page). The 30 rows sit in a 240px viewport with the readout and the footer as its siblings, so
   they stay put; one Tab stop takes Up/Down (a row), PageUp/PageDown (eight), Home/End, which move the selection (clamped
   to 0..29) and then ease the track to the least offset that shows the moved row — the reveal is measured from the row's
   place in the content and against the track's *target*, so a key pressed mid-animation still lands right, and the drag
   never selects (the selection is the keyboard's). Check: four stored frames (the top, 32 notches down with both edges
   cut, the selection eased to row 13, the light theme; all byte-identical, from `--wheel-rest` and `--settle`) and
   `solid/list.test.ts` (a notch glides `2.59, 1.92, 1.42…` px a frame to exactly 10, both clamps, a 40-notch flick to
   the clamp, the band's f(40) at both ends and its hold, the drag frame for frame with its fling and its resistance, the
   clip's pixels above the viewport, the keyboard's reveal and its bounds after the ease, the wheel not moving the
   selection, the header and footer unmoved, the ring's pixels, the wheel only under the pointer, reduced motion, the page
   fitting). Mutations: making the notch instant fails the "settles at 10px over frames" check; dropping the reveal fails
   eleven of them. Seen by eye: the four frames; the window started (`--frames 60`, exit 0) but its wheel and keys were
   not tried by hand (the screen is not visible to me). Left: scrolling the page itself when the wheel is outside the
   viewport (it is the viewport's own track); the scrollbar and the dragging of one came later (item 2's last paragraph),
   and so did the horizontal axis and the wide List.
   **Done: the window** (`solid/src/virtual.ts`, `solid/virtual.test.ts`): both scrolling pages now declare what the screen
   shows, not the data. `fixedWindow` is arithmetic (the List's rows: `item + gap` a row, row `i` at `i·30`); it returns
   the indexes to declare, the spacer heights above and below, and the real content (`count·item + (count−1)·gap`). The
   Sky's cards differ, so `measuredWindow` keeps a height cache by index from `ui.bounds` of each declared card, and it
   **measures once, then virtualizes**: while any height is unknown the window is the whole column (no spacers), so a feed
   declares all of itself on its mount frame, measures every card on the next, and has exact heights from then on; the mean
   of the measured ones (190px until anything is) is only the estimate those frames give the content and the thumb, never
   a place a card is measured at, so the end does not move when a card is first seen. `segments(w, { count, slot, gap,
extra })` is the List's column: the window's rows, the selected row when the scroll has left it outside the window, and
   the spacers between them (`SPACER.above`, `middle`, `below` — each taking its own gap out, none when the ranges are
   adjacent), so the selection has a box, a fill, a ring and an a11y node without declaring the range in between, and
   nothing the viewport shows moves. The spacer boxes are cells of the same column as the items, their heights written
   through the value channel's FIXED axis (fields 4 and 5, as the thumb's are): the declared items are exactly where the
   full page would have put them. The clamp and the thumb read the real content, never the declared subset's. The List
   takes a `count` (`bun solid/main.ts list --count 1000`), the Sky a `posts` feed (`--posts 200`, `synthetic(200)`).
   Check: `solid/virtual.test.ts` — the fixed window's arithmetic (29,998px for 1,000 rows, the spacers sum to it at the
   top, 1,000px down and the end), the measured window's spacers (`[100, 300, 100]` is 516 of content, one card declared)
   and its measuring pass (a hole declares all three), the segments (an extra index above or below the window: the column
   still 29,998px, no spacer when the ranges are adjacent, nothing when it is inside), 1,000 rows at the top, 1,000px down
   and the exact end 29,758 (nine to eleven declared boxes plus the selection's, row 33 at 990px, the last row's bottom on
   the viewport's, the thumb from 29,998), the keyboard revealing a row outside the window, 200 cards of mixed height (the
   pass declares all 200 on one frame and the window is small on the next, at most ten declared, the gaps 8 at the measured
   heights, End at the real end with the last card and the thumb's bottom at the feed's, the pass's content == the last
   card's), `solid/list.test.ts`'s wheel leaving the selection behind (its box 110px above the viewport at 200px, the
   spacers 88/28/418, the content still 898, `frames/list-wheel.png` byte-identical, and two pages at 348px — the selection
   above the window and below it — with the same viewport pixels), and the declare cost: 30 rows 0.086 → 0.032ms, 1,000
   rows 2.084 → 0.030ms, 3 cards 0.022 → 0.028ms, 200 cards 0.683 → 0.042ms (`--bench 500`), and the measuring pass's one
   frame: 200 cards 0.85ms of declare (1.07 as five mounts' median) against 0.024ms a frame after it, 1,000 cards 4.9ms,
   while 2,000 already overflow Clay's default element capacity. The stored List and Sky frames are byte-identical.
   Mutations: dropping the top spacer fails
   `FAIL row 33 is at the viewport's top: -970, wanted -10` (the rows jump by the spacer they lost) and four more of the
   block, and the stored `list-wheel.png` **5,074 pixels differ**; dropping the selection's range fails the List's
   `FAIL the selected row is declared although the window left it behind: 0, wanted 4` (and seven more) and
   `virtual.test.ts`'s `FAIL the window is eleven rows, 32..42, and the selection's row 0: 11, wanted 12`, while the stored
   frame still matches (that is the frame of the old behaviour); the constant fallback for the whole feed's end fails the
   Sky's `FAIL End lands on the content's end` and `FAIL and the last card's bottom is that content's end`; using the
   declared subset's height for the clamp fails the List's
   `FAIL the thumb is the content's: max(24, 240²/29,998): 175.61, wanted 24` (its top `64.39, wanted 7.26`, and the
   wheel stops at −88), the Sky's `FAIL twenty viewports down: 13,280: 1100, wanted 13280` and
   `FAIL the last card is declared there: false, wanted true`.
   **Done: the accessibility tree** (`solid/a11y.ts`, `solid/a11y.test.ts`). `snapshot(root, { parts, containers })`
   walks the rendered tree in document order and returns `{ role, name, value, states: { checked, expanded, selected,
disabled, focused, hidden }, hasPopup, level, bounds, children }`: the name from the part's `label` / `labelledBy`
   (resolved to the text of the element it names) / the text of its descendants outside nested roles, `hidden` pruned
   with its subtree, and an open modal dialog's page pruned as a screen reader sees it (not marked hidden); `bounds` is
   `ui.bounds` of the box's id. `a11y(part)` is the other half: the part's `id` and each field as a live getter, spread
   by a page on the box that draws it (`{...bind(part)} {...a11y(part)}`), so a page's boxes are its parts' boxes and a
   field a page drops is a missing role, name or state in the snapshot. Still missing: `controls`/`describedBy` never
   reach the snapshot (no disclosure→panel, tab→panel or trigger→dialog link), no live regions, no trap order in the
   snapshot (the keys are tested in `dialog.test.ts`), `tree`/`toolbar`/`tablist`/the checkbox `group` have no accessible
   name, and the List and Sensors pages are not covered (they are not headless parts). Check: the three pages' bare snapshots
   (`p.snap()`, no table of parts) — the Widgets page (the four checkboxes in their `group`, the
   radiogroup/tablist/toolbar/tree as the page's own boxes with bounds, the mixed and the disabled box, the disabled box
   no Tab stop, the disclosure named `Details` with the `+`/`-` mark outside its name, the toolbar's `Size: Medium` with
   `hasPopup: "menu"`, the tree's rows named by their nodes, the slider named `Volume` with `40%` as its value, the
   Tab-focused switch's path), its open menu, the Field page (the textboxes named `Name`/`Read-only` through
   `labelledBy`, the value as typed), the Dialog page (closed, the zoom trigger `Zoom: 100%` with its `hasPopup`; open,
   the dialog alone named by its title, the backdrop and the page behind no nodes; and its open menu), a hand-built tree
   for `labelledBy`, `hidden`, nesting and absent bounds, and two rules on every page: a role on every node, a non-empty
   name on every role that requires one. Dropping the disclosure trigger's `label` fails the name asserts. Left:
   `aria-controls`/`describedBy` in the tree (the parts carry `controls` and `describedBy`; no field copies them, and no
   disclosure, dialog or menu exposes them), live regions, the focus trap in the snapshot (the dialog's Tab cycle is
   `dialog.test.ts`'s, not the tree's), the `tree`/`toolbar`/`tablist` containers unnamed (the page has no caption for
   them), and the List page, which is no headless part and so has no roles at all yet.
   **Done: the first real app** (`solid/app/Sky.tsx`, `bun solid/main.ts sky`). csssky's home feed at phone size
   (360x760): the wordmark and the three feeds as a headless tablist, a clip element (664px of the window) that the page's
   own motion track scrolls — 10px a wheel notch, a flick's decay, Down/Up 40px, PageDown/PageUp a viewport, Home/End,
   clamped to the cards' height (item 2's tracks; it is the first page that owns its offset and turns
   `ui_auto_scroll` off) — and six cards
   from the app's own recorded fixtures — three Discover, three Science, News empty — with the author's name and
   `@handle · age` (`ago()` pinned to the fixture's capture moment, not the clock), a body (14px/20) that **wraps** (the
   first page where text does: the body is a stretch text inside the card's percent width, because a clip element lets
   its children grow past the viewport for their content), the media as the terminal's line, the TUI's sky palette, counts in words
   (`8 replies · 32 reposts · 310 likes`, `3.5K` from 3,500) because Roboto has no retweet or heart glyph, and a **drawn
   avatar** per post: `css.image` over the six committed 64x64 PNGs, so the Solid path's image support (`5cf6477`) now
   carries a real screen. A card hovers to the next panel tone, a click records the selection in a signal (the status
   line names it) and opens the post's thread — the page's second screen, below — and the bar and status line are the
   feed's siblings, so they do not move.
   Check: four stored frames (Discover, Science after a click on its tab, the light theme, Science 8 notches down) and
   `solid/sky.test.ts` (the avatars' pixels — the panel at the box's transparent corner, the author's hue in the disc,
   michaelwarburton `74 132 214` and erikstrub `126 108 200`, and the change with the tab; Erik's body four 20px lines
   and the media line that makes Titania's card 18px taller than Michael's; hover on a card and a tab; the wheel's one
   notch gliding `2.59, 1.92, 1.42…` px a frame to exactly 10 with the bar and status still, eight notches flinging to
   the clamped 78 in 31 frames and the stored `sky-scrolled.png` matching that frame 0 pixels, a wheel up mid-throw
   landing 10px back at 64.05 with no step jumping; the keyboard's 40px a Down, a viewport a Page, Home/End on the same
   track, and the clamps; the feed's ring pixels;
   the tabs switching the feed and News' empty centred muted line; the page fitting). Mutations: a bare 40x40 avatar box
   fails the disc asserts, a `nowrap` body fails the wrap asserts and (the content then short) the scroll ones, and
   `Track.retarget` dropping the sampled velocity fails the mid-flight block. Seen
   by eye: the four frames, zoomed — the bar's underline, the name and handle, the counts' `·`, the avatar discs. What is
   left of it: no fetching or paging (three recorded posts per feed), no post images (a media line), no avatars beyond
   the six committed (a thread's replies have none), the name and handle on two lines because the pair does not
   fit 312px (Clay has no ellipsis), and media lines that wrap at spaces only, so the Science link shows the embed's host
   instead of its 60-character URI (the app's own fallback when a link has no title).
   **Done: the drag, the pages' entry, and a rotated clip and gradient.** The Sky feed is dragged as a phone's list is: a
   press inside it grabs the offset, which follows the pointer 1:1 from the press point (the same `rubber` past an end as
   the wheel's pull), a press that travels past 4px is not a click on the card under it, and the release hands the speed of
   the last five samples to a decay (or lets the band go at an end); reduced motion drags 1:1 and flings nothing. That
   machine is now one module (`solid/src/vscroll.ts`), and **the List's viewport is on it too**: the same 10px notch and
   flick, the same 1:1 grab, band and release, with what only a page knows left to the page — where its content ends, its
   keys, and the reveal (its keys move the selection and then ask the track for the offset that shows the row, measured
   from the row's place in the content and against the track's target, so it works mid-animation). One helper
   (`solid/src/entry.ts`) gives List, Widgets, Sensors and the Text field their first mount — the root's subtree rises 8px
   and fades in over 0.25s once, writing nothing afterwards — and `frames/list-entry.png` is four frames into it, the
   stored frames of those pages unchanged. In the renderer the groups' map to the target is one affine, so a gradient
   inside a *rotated* group is stippled on its rotated quad, where an axis-aligned mark stippled the page around it and
   missed the quad's tips; **a clip is cut by its own mapped quad too** (its rect bounds the scan, the pixel is tested
   against the quad), so a gradient inside a rotated clip is no longer stippled where the clip cut it away — before, 1898
   of the ramp's pixels were outside the 30° clip and 3063 inside; after, 0 outside and the same 3063 inside. The clip
   itself already turned with its scene, and `solid/rotated.test.ts` proves all four on a hand-built tree (the tilt, the
   ramp, the stipple inside the gradient's quad, and none outside the clip's). Check: the drag's offset frame for frame,
   the resistance past an end, the fling's deterministic landing, the suppressed click, reduced motion, the entry's blend
   and still layout, the List's notch/flick/band/drag/reveal on its track, the dither's clip quads, and `sh test.sh`'s
   stored-frame comparisons (56 frames, all identical). Seen by eye: `list-entry.png`.
   **Done: touch input and a scrollbar on both scrolling pages.** SDL3's finger events (`FINGER_DOWN/MOTION/UP/CANCELED`,
   `tfinger.x/y` normalised to the window) go through `ui_touch_map` into the same pointer state the mouse writes, so a
   page still has one pointer: down while a finger is on the window, up at the place it left, and the first finger owns it
   (a second is ignored until the first lifts — nothing here reads a pinch). `FINGER_CANCELED` is a lift and a mouse
   event clears the flag; the mouse path is untouched. The flag rides the poll's spare slot (`out[5]`) to the frame's
   `View.onPointer(x, y, down, touch)` and on to `vscroll.pointer`, which uses it for one rule: a finger's drag has **no
   4px click threshold** (any travel starts it), while a finger's press that never moves is still a click. Covered
   without hardware: `main.ts --touch FX FY` goes through the same mapping with the flag on, so `--touch 0.5 0.5` is
   `--click 180 380`'s frame on the Sky page (`test.sh` compares them), and `sky.test.ts` runs a finger's 2px swipe that
   does not select the card under it against the mouse's 2px that does, plus a finger's tap that does. **Not verified: no
   touchscreen on this machine**; the mapping, the flag's path and the pages' two behaviours under it are all that is
   tested.
   **The scrollbar** (`solid/src/vscroll.ts`'s `thumbOf`, `BAR`/`sky-thumb` in the pages): both scrolling pages grow a 4px
   thumb 2px in from the viewport's right edge, `max(24, view²/content)` tall, top `offset/(content-view)·(view-height)`,
   and none at all when the content fits (height 0, alpha 0 — Discover's three posts). It is a **float on the viewport**
   (`css.float({ parent: "list" })`), which is the tree decision: Clay positions a float from its parent's box and gives it
   no `childOffset`, so the thumb is a sibling of the scrolling content, draws over it and does not scroll with it. The
   machine writes five numbers a frame through the value channel — height (a FIXED axis's min and max), the float's offset
   y, the background's alpha and the pointer capture — and the fade is a colour on `effect(0.15)`: up while the offset
   moves (the track's settle, or any frame that moved, which under reduced motion is the jump), down 600ms after the last
   such frame, and under reduced motion nothing fades (it appears and goes at once). A press on a visible thumb grabs the
   offset where it is (the thumb does not jump under the pointer) and its travel is the offset's whole range, 1:1 on the
   bar, clamped at both ends with no band and no fling; a press on an invisible one is the page's, because the capture is
   written with the fade (Clay reads the previous frame's declaration, so that is one frame of a 0.15s fade). Measured
   (`solid/list.test.ts`, 898 in 240: thumb `314,4x64.14`, travel 175.86): `0` at the top, `88.2` at 330 and its bottom on
   the viewport's bottom at 658; a 10px drag on the thumb moves the offset 37.4 and clamps on 658 and 0; the fade's pixel
   goes `36/40/52 → 53/57/69 → 82/86/99 → 105/111/124 …` into `149/154/169` and back out by frame 64 of the hold. On the
   Sky (`664` in `742`: `354,4x594.2`, travel 69.8) the drag and the fade are the same, and the thumb is 0 on Discover.
   No stored frame shows it — every settled frame follows the fade-out — so the frames after a scroll take `--settle 90`
   instead of 60 and are **byte-identical** to before (`list-wheel`, `list-select`, `list-light`, `sky-scrolled`), as is
   `sky-band` (Discover has no bar).
   Seen by eye: `list-entry.png`; the scrollbar was not seen in a window (no window was run for this step). What is
   genuinely left of this step: a **touchscreen** to try the finger's path on (there is none here), scrolling the page
   itself when the wheel is outside the viewport (the wheel is the viewport's own track), and the terminal, browser and
   board targets (no Solid page, no wheel, no pointer, no touch and no value channel: the drags are the desktop's).
   **Done: the horizontal axis, and a wide List.** `scroll(id, max, bar, across?)` builds the vertical axis as before and,
   with `across` (`{ max, bar }`), a second axis from the same `axis()` closure: the notches, the burst's fling, the band
   and its hold, the 4px drag threshold and the bar's fade are one body of code with the coordinate (dx, the pointer's x)
   and the extent (`ui.bounds`'s width) swapped, and the clock and the fade are the machine's, so both bars show while
   either axis moves. `barOf(content, view, offset, reserve)` is `thumbOf` turned (the same formula with a reserve) — the
   horizontal thumb is 4px tall at the viewport's inner bottom edge, `max(24, view²/content)` wide, its left
   `offset/(content−view)·(view−width)` — and both bars shorten the vertical one's travel by 6px, so they meet and do not
   overlap. The wheel's x delta was always in `ui_wheel_pop`; a shift+vertical wheel becomes an x delta in
   `ui_window_poll` (`SDL_GetModState()`), and `--wheel-x N` is the headless notch. `List({ wide })` (`--wide`) is a prop:
   900px rows in the same 280px viewport — number, a 150px name, a 320px note cell that clips (`overflow: hidden`), the
   temperature, and a second column past the edge — with the vertical window, keys and clamps untouched, so the default
   page's four stored frames are byte-identical and `list-wide.png` is the new one (12 notches right, 120 of the 620).
   Measured (`solid/list.test.ts`): one horizontal notch `2.59, 1.92 …` to exactly 10; forty in one frame peak 103.44 and
   rest on 620 after 39; the thumb `232.89,335.5 87.11x4`, travel 192.89, left `0`/`102.67`/`192.89`; a 10px bar drag is
   3.21 of offset a px; the two bars' boxes meet at `335.5` and never overlap. Mutation: the horizontal thumb's width from
   the content's width instead of the viewport's fails `FAIL its width is max(24, 280²/900): a screenful of the content`.
   Not covered: a horizontal *content\* drag in the viewport (the wide page drags vertically; the bar is the horizontal
   handle), and horizontal content on any page but the List.
   **Done: the thread screen.** A card press now opens the post's thread — the page's second screen, with the bar (the
   wordmark and the tabs) staying put. It is a **root float over the content area** (696 = 760 - 64, `zIndex` 2, the
   pointer captured), so the feed stays declared underneath: its clip's offset and its selected card are not written
   while the thread is up, and back is the frame the click left (0 bytes of 1,094,400, measured). A 44px header (the back
   control — a `createButton`, role `button`, label "Back", Enter/Space — and the word "Thread") sits above a second clip
   element on the page's own scroll machine (one instance per opening, so a thread always starts at its top). The data is
   the app's recorded thread (`apps/csssky/test/fixtures/thread.json`) as the page's own `Post` literals: the root is the
   clicked post with its counts, then `jlp2024.bsky.social` (1), a tombstone (2, "Post deleted or not found"), `Katie
Korth` (2), `Mdubs949` (3) and the "Show 1 more reply" row (4) a branch cut at the app's `MAX_DEPTH` ends in — the
   rows are `apps/csssky-tui`'s `rowsOf` transcribed (its nodes are the API's `ThreadNode`; the page's cards are not), its
   words and limit imported from `apps/csssky/src/thread/model.ts` (`goneText`, `moreLabel`, `MAX_DEPTH`). A row's left
   padding is the depth's indent, 16px a level (the app's margin-left), so the cards start at x 12, 28, 44, 44, 60 and 76
   and keep a percent width (they wrap as the feed's do); the root is the app's focused post (the accent border). The
   screen enters as one group — 12px low and 0 opacity over 0.3s, the card entry's tracks — and leaves the same way
   reversed with `presence(0.3)`, so reduced motion has neither, and its two Tab stops are the back control and the clip
   (Down/Up 40, PageDown/PageUp a viewport, Home/End; the cards are not stops). Escape and a click on a tab return to the
   feed; the history is **one deep** (a "Show N more" row's thread returns to its thread, a card's to the feed). Measured
   (`solid/thread.test.ts`): 900 of rows in the clip's 652 → 248 to scroll, the thumb 472.34 tall (`max(24, 652²/900)`)
   with 179.66 of travel, one notch 10; the a11y tree is a `region` "Thread — @handle" over `article`s named by their
   authors, a `note` and a `button`, the covered feed pruned; reduced motion's first frame is the stored one. Five frames:
   `sky-thread.png`, `sky-thread-mid.png` (two frames into the entry), `sky-thread-scrolled.png`, `sky-thread-light.png`,
   `sky-thread-more.png` (the deeper thread; its row is only in view at the thread's end, so `main.ts` grew
   `--click2`/`--settle2`). Mutations: dropping the wrapper's padding fails `FAIL a reply's box is its depth's indent in
from the clip (…)`, and reusing the thread's offset for the feed fails `FAIL the feed's offset after back is its own`
   (and 667,725 bytes of the frame). **The wide form** (2026-11-06): the page reads its own width from the last layout
   (`ui.bounds("Root")`) and at 720px the thread is a **second 360px column beside the feed** instead of the float over it —
   the page's 720x760 is the feed's pane (`sky-feed-pane`, the bar, the feed and its status line in a page-coloured column)
   and the thread's (`sky-thread`, its 44px header and its 716px clip), each its own clip and its own offset. The feed keeps
   its offset and its selected card across the open (`solid/sky-wide.test.ts`: 78px and the card's box, before and after)
   and its card is still under the pointer; below 720 (719 measured) the float and the covered feed are unchanged. The pane
   draws the page's own colour, so the narrow page's stored frames are byte-identical and `solid/goldens/sky.json` gained
   one rectangle. What is still not there: a fetch of a real thread from the AppView (the page has one
   recorded fixture, shown for whichever card is pressed), a reply's own thread beyond the one branch the data holds, and
   the settings screen (the profile is the third screen below).
   the profile screen (its sibling's).
   **Done: the thread comes from the AppView, through an injectable loader.** The transcription above — and its "what is
   still not there" list — is replaced: a
   card's press asks the page's `load(uri)` (a post's at-uri in, the API's `ThreadScreen` out) and the screen opens in its
   **loading** state — the header and one muted "Loading the thread…" row (336x44 at 12,120) — before the answer lands.
   The default loader is `apps/csssky/src/api.ts`'s call: `GET
https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=…&depth=6&parentHeight=20`, an 8 s
   `AbortSignal.timeout` and no retry; a non-2xx, a throw and a rejection are the **error** state ("The thread could not be
   loaded" and a Retry row 336x36, which asks again for the same uri), and a late answer a back, a tab or a second press
   overtook is dropped (an ask counter). The **answer**'s rows are the app's own: `rowsOf` (`apps/csssky-tui/src/model.ts`:
   `MAX_DEPTH` 3, `moreLabel`, `goneText`) over the page's `screenOf` shaping of the answer (the parent chain, `nodeOf`'s
   sorted replies, `topFirst`), and each `PostView` becomes the card in `postOf` (the record's text and time, the counts,
   `mediaText(embedParts(p).media)` — the terminal's line). The recorded answer is Mina Kimes' reply by Bluesky, so the
   screen is ten rows: the parent Mina (280 tall, with her link line), the root Bluesky (136, the accent border), then the
   sorted replies — Mina (226 likes), Mdubs949 with Ryan at depth 2, jlp2024, Davide, Katie, Juanita, rmar124 — 1758 of
   rows in the clip's 652 (1106 to scroll, the thumb 241.81). **The honest offline path is the error state, not a
   fallback**: the recording is offered where nothing is asking — `--offline`, and every `--png`/`--expect` run
   (`solid/src/skyload.ts`), so a stored frame never makes a request; `--pending` and `--fail` are the two states' frames.
   The five thread frames were re-stored deliberately (the root is the answer's post, not the pressed card's; the old
   tombstone and "Show 1 more reply" rows are not in the recording; the replies are in the app's order), and
   `sky-thread-more.png` is now twenty notches down (the flick settles at 508 of the 1106) with its second click on a
   post's card — the recording has no cut branch, so the more row's frame is `thread.test.ts`'s screen built from the same
   posts. Two frames are new: `sky-thread-loading.png`,
   `sky-thread-error.png`. `solid/thread.test.ts` injects its own promises (the loading row and its frame, the rows'
   indents, the error and the retry's second ask, the tombstone and the more row from a built screen, back's restore
   without a third ask, a dropped late answer, all three a11y states, the stored frame byte for byte), with a mutation a
   state: an at-once loader never draws the loading row, and a reject after a loaded thread shows the error's rows, not
   the thread that was up. The import of the app's model costs ~50 ms of Bun's startup (`time bun -e 'await import(…) '`).
   What is still not there: replies below `depth` 6 or a parent chain past 20, a cursor's paging, a cache (every press
   asks; back restores the screen it came from), the labeler moderation `api.ts` applies (this page has no labels), and a
   real service's auth.
   **Done: the profile screen.** A card's author — the name-and-handle row, the app's own `<a href="/profile/…">` on the
   name (`apps/csssky/src/post/Post.tsx`), not the avatar — opens the author's profile as the page's third screen, built
   like the thread's: a root float over the content area (the thread's style, declared after it and so over it), its own
   44px header with Back and "Profile", a third clip element on the page's own scroll machine, and the card entry's group
   under `presence(0.3)`. The header is the app's recorded `getProfile` answer
   (`apps/csssky/test/fixtures/profile-head.json`) through `solid/app/profile.ts`'s `profileOf`, one mapper like `postOf`:
   the drawn 56px disc (the recording's author has no committed PNG), the display name, `@handle`, the wrapped bio and
   `35M followers · 15 following · 865 posts` in the app's `stat` words. Below it the app's Posts/Replies/Media tabs
   (`TABS` of `apps/csssky/src/profile/model.ts`) as a headless tablist like the bar's, each holding its fixture's cards
   (11, 10, 13; the Media tab's all carry their media lines); the machine is fresh per tab, so a switch starts the list at
   the top. The history is one deep: a profile from a card returns to the feed (0 bytes of 1,094,400), one from a thread's
   card to that thread at its own offset and rows (the thread is not re-asked and not moved). The data is read at run time
   from `apps/csssky/test/fixtures/` — ~140 KB of JSON, so not transcribed, once, on the first opening — and **nothing
   fetches**. Numbers (`solid/profile.test.ts`): the header 44, the head 166, the tablist 35.58, the list's clip 450.43;
   the Posts list 2652 of content in it, the thumb 51.16, one notch 10, End 2201.57. Four frames: `sky-profile.png`,
   `sky-profile-mid.png`, `sky-profile-media.png`, `sky-profile-light.png`. What is still not there: a fetch (one
   recording, for whichever author is pressed), a follow button, the app's paging (one page a tab), and a card of the
   profile's list opening its own thread. The settings screen is the sibling's.
   **Done: the settings screen** (`solid/app/Settings.tsx`, the page's third). A gear at the bar's right end — the app's
   own Settings nav item, three 16x2 boxes because Roboto has no gear — opens a screen built like the thread's: a root
   float one z above the thread's (so it opens over a thread and its back returns to that thread, the history one step),
   a 44px header with Back and "Settings", its own clip on a third instance of the scroll machine (the three rows fit the
   652, so no thumb), the card entry as one group under `presence(0.3)`, five stops of its own while it is up (the back
   control, the theme group, the switch, the size group and the clip) with the covered screen's stops disabled, and the
   focus the opening pushed popped back on the way out (the thread's back control has its ring again: 0 bytes). Three
   controls, each real: **Theme** (Dark/Light) writes the pick back to the host's `theme`, which the frame's `theme`
   getter reads, so every style's variant and the page's fades follow (`16/19/22` → `243/245/247`, a row's panel
   `27/32/38` → `255/255/255`); **Reduced motion** is a `createSwitch` on `setReducedMotion`, so the frame after a card's
   click is the settled thread (0 bytes, against 672,965 without it); **Text size** (Regular/Large) picks two variants of
   each of the feed card's five text styles (a Clay text carries its `fontSize`/`lineHeight`; no token can), the card
   190 → 222, Science's content 742 → 830, its thumb 594.2 → 531.2 and its end 78 → 166, the page dropping its height
   cache on the frame of the change, and back at Regular the feed's frame byte-identical. The values live as long as the
   page runs (signals and the flag; no storage, no persisted choice), and the palette moved to `solid/app/Sky.styles.ts`
   so both screens' styles are the same tokens. Four frames — `sky-settings`, `sky-settings-mid` (two frames into the
   entry), `sky-settings-light` (Light picked by the keyboard: one Tab from Back, then an arrow) and `sky-settings-large`
   (three Tabs to the size group) — and the fifteen Sky frames that show the bar were re-stored deliberately: the diff of
   every one of them is the gear's 96 pixels in a 16x12 box at 315,26, measured pixel for pixel against the old files,
   and the command golden gained its three rectangles and one node.
5. **JSX to C.** The same component evaluated at build time to C calls, for targets with no JS. Check: its render
   commands equal step 4's for the same state.
   **Done: the evaluator** (`generator/page-to-c.ts`, `bun --conditions=development`). It imports `solid/plugin.ts`
   (JSX and cssints compile as in the app), renders a page with `solid/src/renderer.ts` into an `El` tree, replays the
   state's events, and walks the tree in tree order, one function per theme. A style is not printed again: the style
   object is looked up by identity among the exports of the modules passed with `--styles`, and the C names are the
   ones `generator/clay-header.ts` gave it in `styles.h` (`root`, `units`, `units_active`, `title_text`, `<name>_light`),
   so `header()` prints declarations (one per export, with its states and themes) and page-to-c prints only the frames.
   A style the page does not export (declared inside the .tsx) is printed by `header()` itself and named `style_<n>` in
   tree order: one printer, two sets of names, no second C printer. The state is a build-time input: `--state use_g=true`
   looks the key up in `examples/sensors/states.json`, which says how to reach it (a click on `Units`, i.e. the page's own
   `onClick`, called where the frame calls it on release), so the generator drives the page's signals the way the host
   does; a `pointer` action declares the pointer over an element, down or up, which is a build-time `:active`/`:hover` and
   picks `units_active`/`units_hover`. States stay overlays: the state that holds picks one declaration, and when two
   hold at once the generator checks that the last one's declaration equals their merge (pack.ts's order) and fails
   loudly when it does not.
   Emitted: `examples/sensors/page_generated.c` (the base), `page_generated_g.c` (use*g true) and
   `page_generated_pressed.c` (the pointer over Units, held), 36 lines each, six frame functions, no style declarations
   of their own.
   Check: `examples/sensors/gen.c` runs the three generated files and `page.c`'s hand-written frame through Clay at
   360x360 with one fixed measure and compares the command arrays field by field (type, id, z-index, box, colour, corner
   radius, border width, and the text's bytes, colour and font fields): six comparisons (dark and light × base, clicked,
   pressed), 10 commands each, identical. Step 4's frames already hold `page.c` equal to the Solid page pixel for pixel,
   so generated C = hand C = the desktop's frame. `test.sh` regenerates the committed C and `cmp`s it, so the file in
   git cannot rot; `InlineDemo.tsx` (styles in the .tsx, no styles module) is generated and compiled for the literal
   path. Mutation: `units` to `units_active` in the base frame fails at `renderData.rectangle.backgroundColor`, one digit
   of a value fails at the text's bytes. Cost: about 1.2 s a state (3.5 s for the three) plus one C compile.
   **Done: the events** (`--events`, `examples/sensors/page_generated_events.c`). The page is a state machine: six states
   (the two signals × the pointer's none/`:hover`/`:active` over `Units`), one frame a state and theme, `sensors_state_count`,
   `sensors_state_name`, the handler ids, and `sensors_next(state, id, event)` with `CLAY_EVENT_PRESS`/`CLAY_EVENT_RELEASE`
   (`generator/events.h`). Each state is the frame the page declares, derived by replaying `states.json`'s actions and
   the pointer at build time; a press or a release the generator cannot name in `states.json` fails the build, and so
   does a handler with no id. The desktop host (`desktop/build.sh examples/sensors --generated`) and the browser's wasm
   keep the state and dispatch a click through the table, and `examples/sensors/scenes/sensors-click.json` — the shared
   scene format, read in C by `desktop/scene.c` — replays the same click to `expected-thorvg-g.png`; the Solid host
   replays the same file to the same frame. `gen.c` walks base → press → release → press → release, `10 commands,
identical` against `page.c` at every step. What is not there: **run-time signals** (a state is one frame);
   hovering is entered by a release over the element, not tracked by pointer motion; the table's click flips on the
   release (the Solid page's `onClick`) where `page.c`'s `Clay_OnHover` flips on the press edge, so a held generated
   `--press` shows the current signal.
   **Done: the image.** The style contract did carry Clay's `Clay_ImageElementConfig` after all: `header()` prints
   `.image = { .imageData = (void *)"examples/sensors/glyph.png" }` beside `.aspectRatio`, the path as the style's own
   C string, in `<name>` and `<name>_light` (asserted in `examples/sensors/header.c`), so what was missing was a page
   that emits it. The Solid page's `image` prop is `page.c`'s `IMAGE=1`, and `--prop image=true` is how the generator is
   given it (a prop, where `states.json` holds signals): `examples/sensors/page_generated_image.c`, 44 lines, two frame
   functions, 11 commands each — the page's 10 and `CLAY(CLAY_ID("Glyph"), glyph)`. `gen.c` compares both themes with
   the hand page's image frame, the command's type, id, box, `backgroundColor`, `cornerRadius` and path (a `strcmp` of
   `imageData`) included: `2 images, identical`; `test.sh` regenerates the file and `cmp`s it. Mutations: one byte of
   the path fails naming `renderData.image.imageData (path)`, an 8x32 box fails at `boundingBox`, and an element with no
   style emits no command at all (10 against 11).
   **Done: the floats.** The style contract did carry Clay's `Clay_FloatingElementConfig` too: `header()` prints
   `.floating` with the fields `pack.ts` packs into slots 32-44, in the struct's order (`offset`, `expand`,
   `parentId` as the hash with its `u`, `zIndex`, `attachPoints.element`/`.parent`, `pointerCaptureMode`, `attachTo`,
   `clipTo`), so what was missing was a page. It is `solid/app/Dialog.tsx`, whose overlays are the modal's backdrop and
   panel (both `CLAY_ATTACH_TO_ROOT`, z 1 and 2, capturing the pointer) and the menu floated off `zoom-trigger`
   (`ELEMENT_WITH_ID`, left-top on left-bottom, offset y -20, z 10). Its state is a click, so `examples/dialog/states.json`
   names `{"menu": [{"click": "zoom-trigger"}], "dialog": [{"click": "settings-trigger"}]}` and
   `examples/dialog/page_generated.c` (both closed, 14 commands), `page_generated_menu.c` (22) and
   `page_generated_dialog.c` (26) are the page at those states, one file each (the click also moves the focus: the menu's
   first item, the dialog's Cancel, so the frames carry `style_10_focus`/`style_3_focus`). `examples/dialog/gen.c`
   compiles them with Clay and `desktop/clay_dump.c`, measures with ThorVG as the Solid host does (exact boxes, no
   tolerance), and `dump-check.ts` compares them with the Solid page's own frame at the same state
   (`examples/dialog/solid-dump.ts`, `ui_dump_json`): `closed: 14 commands, identical`, `menu: 22`, `dialog: 26`; the
   closed frame whole, the overlays' commands only (a shadow, a backdrop and a group are the host's tables, no Clay
   field). The stored `solid/goldens/dialog.json` is the menu two frames into its slide — offset y the value channel's
   -12.5813, a group at alpha 233/scale 0.9703/rotate -1.484° — so a static frame cannot be it: the differ names its
   eight menu commands and their y, 7.418686 px, and nothing else. `check.sh` regenerates the three files and `cmp`s them.
   Mutations: the parent attach point → the box moves by the trigger's 37.09 px; `.zIndex = 10` → `-1` draws the menu
   first (`element "Root" -> "zoom-menu" … the order moved`); no `.floating` → the box falls into the page's column and
   z 10 → 0; no `.pointerCaptureMode` → no command changes, the grep names the field.
   **Done: the List.** `examples/list/` is the page whose tree is not its literals: the window of rows is its own tick's
   (`solid/src/virtual.ts`), so `page-to-c.ts` grew `--tick <n>` — the page gets its `motion`, and the hook runs n frames
   at 1/60 before the frame is emitted, with `generator/ui-build.ts` in place of `solid/src/ffi.ts` answering the two reads
   a build can (`ui.bounds`: the box the element's own style states, the viewport's 240; `ui.scrollOffset`: `--scroll`'s
   number) — and the value channel is **baked**: the writes the page made (the spacers' FIXED heights, the thumb's height,
   offset and 0 opacity, its capture) are applied to the declaration as `ui_open` applies them and printed as `values*<n>`.
The viewport is Clay's scroll container (`css.overflow("hidden")`: `.clip = { .horizontal = 1, .vertical = 1 }`), and
its offset is still not a declaration: the generator declares a clipped element through `clip_scroll`, which reads
`Clay_GetScrollOffset()`where Clay has the element open (the call`ui_open` makes), so the C host writes the offset in
the container (`Clay_ScrollContainerData.scrollPosition`, `ui_scroll_to`'s line) and the frame draws it. The window is
the offset's, so a file is one offset: `page_generated.c`(rest, rows 0..8) and`page_generated_scrolled.c`(10px, rows
0..9). Check:`examples/list/gen.c` lays each out twice (the container, then the offset), and the Solid page's own frame
at the same two states (`examples/list/solid-dump.ts`: the page's loop with its wheel and 90 frames of settle, which
`capture`cannot do) is identical, 36 and 39 commands; the rest frame is`solid/goldens/list.json`too, and the desktop
host's raster of the generated page is`solid/frames/list-top.png`pixel for pixel. Mutations: no`clip_scroll`→ the
rows stay at row 0 while the reference is 10px down; no`.clip`→`gen.c` finds no container.
**Done: the Field and the Widgets** (`examples/field/`, `examples/widgets/`). Their state is not a signal of the page:
the field's value, caret and selection are `createTextField`'s, behind the page's `input`, and the Widgets' `:focus`and`checked`are the parts' fields. So`page-to-c.ts`'s states gained the two input actions —
`{"key": "Shift+ArrowLeft"}` (`input.down`/`up`) and `{"text": "Ada"}` (`input.textInput`, SDL's TEXT_INPUT; a text
with no focused field fails the build) — and a state is a script of the parts' handlers: `{"press": "name"}`focuses
the row (its`onPress`), `{"click": "wifi"}`flips the switch (the part's`press`). Field: empty (20 commands; the
caret's 1px box, no run), typed `Ada`(21: the run and the caret after it) and two Shift+ArrowLeft (23:`A`, the
caret, the tinted `da`); Widgets: rest (59), the switch focused and on (60: the accent track's flex-end and the row's
2px ring) and that with Details open (63: the panel's box and its text). Each is `dump-check.ts`-identical to the Solid
page's own frame at the stored frames' keys (`examples/*/solid-dump.ts`: 31 rest frames then Tab,Tab[,text:Ada]
[,Shift+ArrowLeft ×2]; rest; Tab,Tab,Space; that and four Tabs and Enter), and the desktop host's raster of each is
**0 of 162,000** pixels (the Field, 360x450) and **0 of 273,600** (the Widgets, 360x760) against
`solid/frames/field-{empty,typed,selection}.png`and`widgets-{initial,switch-on,disclosure}.png`. The seam the field
needed: its runs are the page's only nowrap texts and a command carries no wrap, so `examples/field/gen.c`numbers the
text commands and marks the value runs' indices; a shifted index fails the compare. Mutations (each reverted, on
copies): the caret's box dropped →`commands: 21 -> 20`and`element "name-line-caret" -> null`; the switch's on
track as the off one → `colour 240/140/50/255 -> 60/64/78/255`and the thumb`72 -> 52`; the Tab stop's focus
declaration dropped → `commands: 60 -> 59`, the ring's border command gone (`command 8 (border) …
   90/170/255/255 -> 150/155/170/255`).
   Still not emitted: the Widgets' toolbar menu (a float whose opening key is the toolbar's and whose pointer capture is
   the host's; the Dialog's menu proves the float itself); and a page's own scroll *state\* is the host's still — the
   List's file is one offset, its track (`vscroll.ts`'s notch, fling, band and reveal) is the desktop's. `:focus` comes
   from a prop or a part's state, not a signal, so only a page rendered over it gets it. Typing, a key between Tab stops,
   the slider's drag and the tree's roving focus are the host's too: a frame fixes one state, and the six files are the
   six that were proven. The fonts
   enum (`font_Roboto = 0`) is the header's; the C page carries no font array, and text measure stays the host's
   (gen.c fixes one to compare layout). Text without a style is the renderer's white 14, printed as `white_14_text`.
6. **Done: the terminal renderer.** `terminal/`: Clay's commands into a grid of character cells (`cells.c`: a
   code point a cell, 8x16, a palette index each; ANSI truecolour with SGR runs merged, and a plain-text dump for
   tests), `render.c` (a box's cells: fill as their background, border as `─│┌┐└┘` on the rect's perimeter, text at
   `x/CELL_W` one row clipped, a scissor stack), `measure.c` (a code point a cell, a line a cell: a monospace grid)
   and `main.c` (no window: raw termios and a full repaint with `\x1b[H` in a terminal, `--dump`, `--ansi` and
   `--keys` headless). The page is the Sensors page plus a list in C (`terminal/page.c`), the generated `styles.h`
   from `examples/sensors/styles.ts` with only the root's padding/gap and the pill's height re-cut for cells; Tab,
   Up/Down, Space/Enter and `t` as on the desktop. Check: `terminal/test_cells.c` (clipping, the box characters,
   UTF-8, SGR merging, the scissor stack) and three stored dumps (dark, light, after `Tab,ArrowDown`) plus ANSI
   asserts (the title's and the pill label's truecolour; the surface fill is one escape a row, not one a cell) in
   `test.sh`; dropping the text colour fails the ANSI assert.
   **`csssky-tui` in cells**: `terminal/sky.c` is its home screen (the bar with the three feed tabs, the cards from
   `apps/csssky`'s recorded `home-discover-1`/`home-science-1`, the footer), `terminal/thread.c` its thread (the
   parent, the post with its full time and counts in words, the replies at their depth), `terminal/profile.c`
   `apps/csssky`'s profile (the header, the Posts/Replies/Media tabs, those three fixtures) and `terminal/notify.c`
   `apps/csssky`'s notifications (the header row, then a card a kind: the actor, the verb — liked your post, reposted,
   followed you, mentioned you, replied — the post's snippet where there is one, the time), which the feed opens with
   `n` because neither the app's nav (Home, a profile, Settings) nor the feed's bar (its feed tabs) has a place for it.
   The tui has neither the profile nor the notifications screen of its own: the profile is the web app's, on its data
   layer and fixtures, and the notifications are **hand-carried**, because the app has no notifications screen, model or
   fixture — the app's five verbs, actors and posts out of the recorded fixtures, the post's own time.
   `terminal/focus.c` is the keyboard focus: stops in document order, Tab/Shift+Tab with the focus released at either
   end, a group as one stop with roving focus (an orientation, wrap and leave-at-the-edge), and `focus(id)` refusing a
   disabled stop — the semantics of `focus/src/focus.ts`, not shared code with it (the C page has no DOM to register
   into, so its stops are rebuilt when a feed or a tab changes the rows). `terminal/shell.c` is the screen stack
   (`enter` pushes, `esc` pops). The pages' rings are the focus state, not two ints. Check: `terminal/test_focus.c` (Tab
   order, the release, a roving group with and without wrap, leaving at an edge, memory, Home/End, a disabled stop),
   `terminal/expected-thread.txt` and `expected-profile.txt` (the two screens), `expected-sky-focus.txt` (the bar
   focused, its roving tab the active feed), `expected-notify.txt` and `expected-notify-focus.txt` (the notifications at
   rest — the ring on the first row, whose card carries the accent border and the next panel tone — and after Tab and
   ArrowDown, the third row's) and, in
   `test.sh`, the accent border's rows in the ANSI of focused/unfocused frames (a click and `ArrowDown`
   move the ring), the five verbs' texts, the rows' Tab order one key at a time and its wrap at either end, a follow's
   Enter opening nothing, the notifications' own scroll and `n` from the feed, the bar's wrap, the list leaving at its
   edge, a click on a control of each screen, and the scroll of the thread and of the profile. Breaking the group's
   wrap, or its leave, fails both a unit test and a page test; swapping a verb's text fails the stored notifications
   dump, and taking the rows out of the Tab order fails its focus-order check (`Tab: the ring is 0 rows, want 4`).
   Left: **termbox2 is in** (`terminal/vendor/termbox2.h`, upstream master, MIT, sha256 `e019abb9`; `terminal/tb2.c`: truecolour or 256, keys and the mouse, checked through a pty in
   `test.sh`), and so are clicks; what a click cannot do is hover — termbox2 reports no motion events. **Done: the feed's
   data and paging** (`terminal/data.ts` is the app's own calls over apps/csssky's recordings: `homeScreen` with page 1,
   page 2 at the cursor and an empty page for the end, `threadScreen` for the page's `load`; the loading, end and error
   states are the page's status line, `--offline` and a repeated cursor are its mutations, and `terminal/test.sh` counts
   the rows against `home-discover-1`). Still left: `csssky-tui`'s own profile screen (the one here is the web app's),
   notifications in the tui itself (the terminal shows the web app's, hand-carried), the real network the recordings
   stand in for (a terminal with a login and an AppView of its own), unread counts and their
   badge, the notifications' grouping and the actor's avatar, images (a media line; counted and reported, not drawn),
   quote boxes, a body that wraps in the C pages (one clipped row; the Solid feed wraps at words, a long word still is
   not broken), the system theme in the C pages (they keep the static dark/light ones; the Solid Sky page reads the
   terminal's own palette at `--system-theme`, `@cssints/tui/system`'s OSC 10/11/4 and solver, and falls back to the dark
   one with a message), dragging (termbox2 reports
   no motion, so a press has nowhere to travel; the wheel is a notch now), wide glyphs and emoji (a code point is one
   cell), sub-cell borders and radii (a 1px and a 4px border are both one cell, a corner radius
   is a square corner) and scrollback. The cell size is the cost: 8x16 makes a 38px pill 2.4 rows and a 200px pill 25
   columns, so a page's pixel lengths have to be re-cut to land on cell boundaries, and text smaller or larger than a
   cell is the same cell.
   **Done: two pages run as Solid; the rest are C.** `solid/native/term.c` (built as `build/solid/libterm.dylib`
   beside `libui.dylib`) is Clay over the terminal's own cells — `terminal/cells.c`, `render.c`, `measure.c` and
   `tb2.c`, no SDL3, no ThorVG, no window — behind the declaration surface `solid/native/ui.c` has: a packed 45-float
   box style, a 10-float text and the value channel, so a page's `styles.ts` and `solid/src/pack.ts` are one module on
   both targets. `terminal/solid.ts` is `solid/main.ts`'s loop shape over it, and the pages are
   `solid/app/Sensors.tsx` and `solid/app/Sky.tsx` **unmodified**:
   - Sensors: the host re-cuts page.c's two lengths for cells through the value channel (the root's padding and gap,
     the pill's 3-cell height) and draws the pill's ring from its own focus, as `pill_style(focused)` does. At the
     page's own 11 cells the frame is the C frame's bytes (dump and ANSI, dark/light, after `Tab,ArrowDown`), and the
     page's 11 rows at 20 are `expected-dark.txt`'s.
   - the Sky feed: the bar 1 row, the status line 1 row, a card's lines whole rows, the feed's own 12px padding and
     8px gap left as the page's (its scroll arithmetic adds the same lengths); the avatar image skipped, an image has
     no glyph; the tablist's focus the C bar's accent fill (a 2px underline is a one-row tab's label), the feed's
     focus the page's ring token as a cell of box characters; `Tab`/arrows/clicks drive the page's own tablist and
     scroll machine (`src/vscroll.ts`), `j`/`k` and the wheel (a termbox2 notch) too, and a card's click opens the
     thread.
   - the thread and the profile, the page's other two screens — not entries of their own: `Sky.tsx` mounts the thread
     as a root float and calls `Profile.tsx`'s `createProfile` inside its own tree, so there is no `--page profile`
     (the C `demo --page profile` is a stack entry point its own host has). Enter on the feed presses the first card's
     own onClick (the page's cards are not Tab stops; the C page's Enter opens the focused post), a click on a card's
     author row opens the profile. The host's `load` is a promise it settles with the app's **recorded** thread
     (apps/csssky's fixture through the page's own `screenOf`): the loading row is a frame the run draws, the app's
     rows the next. The profile needs nothing handed to it (`app/profile.ts` reads the recordings itself). Each screen
     is the feed's re-cut: the root float one row down (the host's bar is one row) and the rows under it, a one-row
     head with the page's Back (its 1px border dropped — Clay draws a border after the children, and on a one-row
     control the border would be the word's own cells), a card's lines one row each, the clip keeping the page's 12px
     (its scroll arithmetic adds it). The profile's drawn disc is two rows; its tabs are the bar's (no padding, a cell
     after the label, no 2px underline — a one-row tab's row), and its labels have no id to recolour, so its focus has
     no cell of its own. Escape (the page's own back) leaves either; the exit's 0.3s is drawn as the screen staying,
     because a group's alpha and translate are a cell's to drop.
   - The binding gained what the feed needed: the clip offset read after the element is open (it was the parent's),
     `term_bounds`, `term_scroll_offset/to/put`, floats declared with their attach/offset/z/capture (Clay places them
     over the flow), a text's line height forced to the cell's, and a 256-entry value table.
     One caveat of the slice: `solid/src/frame.ts` imports the desktop's `ffi.ts` and draws through `ui_draw`, so the host
     walks the tree itself (~40 lines of the same walk) and aliases `solid/src/ffi.ts` to the terminal's binding, which is
     how a page's own `pageEntry`/tick motion lands in libterm and why its group fields (opacity, translate) are dropped by
     a cell grid instead of moving it. Check: `terminal/test.sh` (`sh native/test.sh` runs it), 9 Sensors `identical`
     lines (the stored frames above, the click on the pill, termbox2 under a pty), 8 for the feed (the stored
     `expected-solid-sky.txt`/`-focus.txt`, the focus order, the tab switch, the key and the wheel on the same -24px end,
     the scroll to the third post at 80x12, a card's click opening the thread, two mutations), and 5 for the thread and 5
     for the profile: the stored `expected-solid-thread.txt`/`-profile.txt` (80x26), Enter's loading frame and the landed
     rows, the thread's -40px and the profile's (its tabs and its header staying put), Escape back, and three mutations
     (the page's offset dropped before Clay -> the feed stays at row 0; no flush after the tab key -> the bar's active tab
     stays Discover; a card's or an author row's onClick dropped -> the screen does not open; no Escape -> the screen
     stays; each prints the check's own FAIL message). The C screens are not reproducible cell for cell: the measured
     distance is **1251 cells, 0 of 20 rows identical, the worst row 1 (80/80)** for the feed at rest, **1397** after the
     tab switch and **684** after the scroll; the thread **1957 cells, 0 of 26 rows, the worst row 1 (80/80)**; the
     profile **1837 cells, 0 of 26, the worst row 2 (80/80)**. The C's `1/2/3` bar labels, its separator rows, its
     hand-cut card borders and heights, its one-row body clips, its `↩ ⟲ ♥` counts, its banner band and its reason lines
     have no counterpart; the nearest rows are the body lines (31 and 6 of 80 for the feed, 67 for the thread) and the
     profile's header (38, the bio's words). Cost: 0.08-0.35 ms a frame for the feed (34 commands, 1600 cells), 0.13-0.15
     ms for the thread and the profile (66 and 69 commands, 2080 cells), against the C pages' ~0.08 ms; the dylib is 236
     KB. What the Solid pages cannot do in cells is the cell's limit as the C pages' is: text is one row (the Solid feed
     and thread wrap at words, the C pages clip), an image is a skipped box, a float sits over the flow but its
     shadow/backdrop/alpha fade do not, there is no shadow, backdrop, gradient, group opacity or scale, and a hover or a
     drag exists only where the last press was (termbox2 reports no motion). **All four of the Sky page's screens are the
     page's own now** (the feed, the thread, the profile, and the notifications: `solid/app/Notify.tsx` over
     `app/notify.ts`, `terminal/solid.ts --page notify` or `n` on the feed, and the desktop's `bun solid/main.ts notify`).
     The notifications are still **hand-carried** — the app has no notifications screen, model or fixture — but they are
     the app's recordings mapped through the page's own `postOf` (the actors, posts and times of `home-discover-1`,
     `home-science-1` and `thread.json`) under the app's five verbs, and a row's Enter opens its post's thread through the
     same `load` the feed uses; the C `terminal/notify.c` stays the behaviour's oracle: **1564 cells, 0 of 26 rows, the
     worst row 5 (80/80)** at rest and **1910, row 2** after `Tab,Tab`, 0.16 ms a frame (70 commands, 2080 cells). The
     feed's data is the app's calls over the recordings now (`terminal/data.ts`: the first page, the next at the end and an
     empty page for the end, the page's loading/end/error on its status line, and the thread), so what
     remains is the notifications' **data** — fetching `listNotifications` (no fixture was recorded, which is why the rows
     are carried; the feed's paging is in, theirs is not), the real network behind both, the unread counts and their badge,
     the app's `All`/`Mentions` grouping and its "and 3 others
     liked your post" — and the cell's limits as above: images (the thread's avatars, the actors' in the notifications),
     the thread's wrapped bodies against the C's one-row clip, the app's banner picture (the page has none; the C draws a
     band), the Sensors page's system theme (its tokens have no roles; the Sky page's are read from the
     terminal's OSC answer through `src/system.ts`'s own solver), the wheel's _set_ bounds, and the C `sky.c` as the oracle it
     already is.
7. **Back to the board.** esp32's `ui.c` reads generated `styles.h` and C from step 5; then the browser (WASM) and the
   ESP32-P4. Checked by hand in the live window (2026-10-19): Tab order and ring, Space on release, the switch, Select all and mixed, Details, click focus, `t`.
   **Done: the board draws the generated page** (esp32 branch `step7-generated`, cssints-native `b3b3e01`): the Sensors
   page is `main/generated/page_sensors.c` (+ the pressed variant), regenerated by `main/generated/regen.sh` and committed,
   not built at IDF time (`--text ui_sensors_text` hands the live sample to the page; `fontId` is remapped to the board's
   three faces). The hand-written page and the generated one give the same 10 commands on the host (`host/generated.c`,
   at rest and held), the firmware's own host test passes with the generated sources, and `idf.py build` gives 0 warnings,
   +1.5 KB. Flashed and seen on the board (2026-10-21): 55 commands, 0 Clay errors, 22 ms a frame. What the generated page
   cannot carry stays in `ui.c`: the strings, the press on `Units`/`Title`, the pressed frame, and the tab count; the
   page's pressed look is the desktop's lift (64,70,90), not the shell's sink.
   **Done: the browser** (`browser/`, step 8): the same generated C as WebAssembly (`zig cc -target wasm32-wasi`, 104 KB),
   Clay's measure callback answered by Canvas2D, `browser/render.js` drawing the commands; the wasm's 10 commands match the
   desktop's, the raster differs only in glyph and corner anti-aliasing (6.4% of pixels; per-region means within 14/255),
   0.07-0.12 ms a frame in headless Chromium. No Solid and no ThorVG in the page yet (step 8's end below).
   **Done: ESP32-P4 builds** (esp32 branch `p4-target`): `set-target esp32p4` + build, 471,920 B against the S3's 1,248,176 B
   from the same sources, 0 warnings, no Wi-Fi/BLE symbol in the image, the pages untouched behind `#if CONFIG_IDF_TARGET_*`.
   No panel: `display_init()` refuses without a board, and the path is `esp_lcd_new_dsi_bus` + the `esp_lcd_st77916` 2.0.2
   driver + `esp_driver_ppa` for the blit (no `esp_lcd_p4` component exists in IDF 5.5.3).

8. **Done: the browser.** `browser/page.c` is Clay plus **step 5's generated C, unchanged** (`page_generated.c` and
   `page_generated_g.c`), compiled by `zig cc -target wasm32-wasi` (a libc; there is no emscripten and no `wasm-ld` on
   this machine, and Apple's clang has no wasm target) into 156,766 bytes: 10 commands, 19 slots each, read out of the
   wasm's memory by `browser/render.js` — type, id, box, colour, corner radii, border widths, text bytes. The one import
   is `env.measure`: Clay's measure callback calls Canvas2D, so the layout is the font the canvas draws with (Roboto
   from `vendor/fonts`), not a table from another raster. The draw is Canvas2D: `roundRect` fills, borders as the
   even-odd ring inside the box as ThorVG draws them, `fillText` on the alphabetic baseline one ascent below Clay's line
   box, `clip()` for a scissor. `frame(0)`/`frame(1)` are the two generated frames; `w` or the button toggles them, which
   is the only state on this target (the generated C has no events). No framework and no build step in the page: a static
   `index.html` plus the wasm, 8,816 bytes of page (10,487 with `draw.js`, which the Solid page shares).
   box, `clip()` for a scissor. The wasm runs step 5's **state machine** (`page_generated_events.c`): `press(x, y)` and
   `release(x, y)` ask the table through Clay's hit test, `frame()` draws `sensors_frame(state, light)` and `state()`
   reports it, so a click on the pill (or `w`, or the button) lands on state 4, the clicked and hovered `use_g` frame.
   No framework and no build step in the page: a static `index.html` plus the wasm, 10,012 bytes of page.
   Check: `browser/check.mjs`, Chromium through Playwright, in `test.sh`. (a) the wasm's `dump()` — the last frame
   through `desktop/clay_dump.c`, the emitter every target writes — against `solid/goldens/sensors.json`, the Solid
   Sensors page's own golden: 10 commands, field by field, the boxes inside 4 px (Canvas2D does not hint a font and the
   golden's ThorVG metrics sum glyph advances, so a 20 px line is up to 3 px wider and a centred box moves by half of
   that); the hand-written table the check had is gone. The post-click frame is compared the same way with the desktop
   C host's own `--click` dump, and the state it lands on is printed (`state 4 "use_g=true + hover Units"`). (b) the
   raster against two stored frames, as per-region (command box) mean colours plus each text line's ink box, not per
   pixel: against its own `browser/expected.png` every 8×8 block is within 3/255 (identical here); against ThorVG's frame
   6.4 % (base) and 10.0 % (`use_g`) of pixels differ, every region mean within 13.9/255, every text ink box within 4 px,
   and the frame's mean colour within 1.17/255 — i.e. the same colours and layout with glyphs and rounded corners
   drawn by another rasteriser. The browser's own frame is the regression guard, ThorVG's the design. Cost, headless
   Chromium on an M2: 0.08 ms a frame for the layout, the commands and one readback (100 frames), so the raster is the
   cost and it is the compositor's.
   Limits: the page itself is a static generated frame, as step 5's; the events are the generated table's (a click,
   its press and release — no keys, no typed text, no wheel, and a hover state is entered by a release, not tracked by
   motion); no ThorVG (Canvas2D instead); no touch, no scrolling, images or floats (the page has none, and
   an image command is counted and not drawn); DPR is one scale factor and nothing else; a browser refuses to fetch the
   wasm from `file://`, so the page is served (`node browser/check.mjs --serve`). What would make it real was the host's
   JS in the browser (Solid over Clay in the page, as on the desktop, with the same input path) and the generated C kept
   as the no-JS path, which is what the board already is.
   **Done: the host's JS in the page** (2026-10-29), for one page. `browser/ui.c` is the desktop's flat `ui_*` surface
   over Clay alone — no SDL, no window, no ThorVG — and `browser/build.sh` compiles it as a second wasm module beside the
   generated page's (131,609 B for `page.wasm`, 136,338 B for `ui.wasm`). `browser/solid/` is the desktop's own modules
   in the page: `page.ts` imports `solid/src/renderer.ts`, `solid/src/frame.ts` and `solid/app/Sensors.tsx` **unmodified**,
   `build.ts` bundles them with `Bun.build` (`--target=browser`, the JSX and cssints loaders of `solid/plugin.ts`,
   `src/frame.ts`'s `./ffi.ts` resolved to `browser/solid/ffi-browser.ts`), and the binding hands the wasm the same `ui`
   object `bun:ffi` hands the desktop: a growing bump heap, `TextEncoder` for the ids (kept for good — Clay's
   `Clay_ElementId` holds the pointer it hashed), the style's `Float32Array` copied in, `draw.js`'s `measureText`
   answering `env.measure` so the layout keeps the browser's font metrics. The loop is `createDrawer`: a
   `requestAnimationFrame` declares and lays the tree out every tick and draws only when the frame hash moved or a press,
   a release or a wheel notch came in (the press and the release run their frame on the event, so a click cannot land both
   inside one frame); the mouse is `src/frame.ts`'s pointer. The drawing is `browser/draw.js` — `render.js`'s Canvas2D
   code moved out, imported by both pages, not forked.
   Cost, headless Chromium on an M2: `ui.wasm` 136,338 B (50,215 B gzip), the bundle 228,467 B (54,144 B gzip,
   unminified) against the no-JS page's 10,487 B, 0.08-0.09 ms a frame — declare, layout, the commands, Canvas2D and one
   readback, the no-JS page's 0.08 with no JS tree. Check: `browser/solid-check.mjs`, in `solid/test.sh` (skipped with a
   message without zig, bun or Playwright's chromium). (a) the base frame through the same emitter against
   `solid/goldens/sensors.json`: 10 commands, every field and every box, the worst box 3.38 px —
   the pill, that much lower because the measure callback rounds each line height up while ThorVG's is exact, the same
   3.38 the no-JS page's check reports. (b) a real click on the `Units` pill (Playwright's mouse,
   the DOM listeners, `src/frame.ts`'s events, the element's `onClick`): with the pointer off the pill its frame equals
   the no-JS page's `frame(1)` field for field and box for box (0 px) and a second click returns to the base frame
   identically; with the pointer on it the pill carries its `:hover` (48,53,68), which the generated C cannot have. (c)
   the canvas against `browser/expected.png`: 0.00 % of pixels differ, worst 8x8 block 0.0/255.
   What is still not there: the other seven pages (they need a DOM map for `src/input.ts`'s key names, and the List's and
   Sky's scroll machines are untried), touch (the wasm has `ui_touch_map`, nothing sends a finger's event), and a dev
   server or HMR (the bundle is built by hand). The generated C is still the no-JS page, unchanged, which is what the
   board already is.
   **Done: the renderer's effects, and the Sky page** (2026-10-29). `browser/ui.c` keeps the desktop's side tables and
   exposes them beside the commands: `ui_shadow`, `ui_backgroundImage`, `ui_image`, `ui_backdrop`, and the value channel's
   group fields (46–49 and 55, with 50 the gradient's alpha and 45 the shadow's blur) as one table keyed by the element's
   Clay id (a group by its tree node, resolved to a command range in `ui_end` the way `Clay_ThorVG_Under` resolves a
   span — and a clip's close is given the node that opened it, or a group inside the feed's clip swallows the close).
   `readEffects` in `draw.js` reads them as one `Int32Array` and one `Float32Array` over the same rows, `draw(commands,
effects)` draws them: a shadow as its box plus Canvas2D's `blur(blur / 2)` (ThorVG's sigma), a gradient along CSS's
   gradient line over the box's solid fill at a fading alpha, a group as an offscreen canvas composited once with the
   alpha and the translate/rotation/scale about the first command's box centre, an image as `drawImage` into its box.
   A backdrop is recorded and hashed; `draw.js` draws it now (the Dialog's menu, below).
   `browser/solid/sky.ts` + `sky.html` run `solid/app/Sky.tsx` unmodified with `src/input.ts`'s keys from the DOM, the
   wheel through the page's own scroll track, and its thread loader a promise that never settles. Check:
   `browser/sky-check.mjs` against `solid/frames/sky.png`, per command box and per text line: every box's mean within
   12.8/255, every text's ink box within 1 px, the frame's mean within 2.32/255, 7.30 % of pixels differing by more than
   2/255 (73.79 % at all — the desktop's 4×4 Bayer dither of a gradient, which this target's smooth interpolation does
   not have, so a card bands where the desktop stipples). The card's gradient reads the panel at its top and its deep end
   at its bottom, the avatars are their authors' hues to 0/255, a scratch canvas proves a shadow's blur, and the entry
   8 frames in is the group (alpha 179/255, 3.59 px down, three rows of card below its resting edge). Each of those
   fails if its effect is removed from `draw.js` alone. Cost: `ui.wasm` 141,104 B (52,269 B gzip), `sky.js` 300,229 B
   (71,434 B gzip), 0.73–0.80 ms a frame with the effects and the avatar bitmaps.
   **Done: the Dialog page, the two root floats and the backdrop's blur** (2026-10-29). `browser/solid/dialog.ts` +
   `dialog.html` run `solid/app/Dialog.tsx` unmodified at 360x480 with its own `createInput()`: the modal's backdrop and
   panel are Clay root floats and the menu is a float off its trigger, so the floats' path needed **nothing new on this
   surface** — the packed style's slots 32-44 and the value channel's offset y (field 39) already carry them. What it did
   need was `shell.ts` handing the effect tables to `draw.js` with the commands (Sensors and Widgets have none; their
   frames are unchanged, 0.00 % of pixels). `draw.js` now draws `ui_backdrop`: at the element's first rectangle it takes
   the pixels under the box with `getImageData`, runs the desktop's separable box blur (three passes each way, radius
   `r = (sqrt(1 + 4 sigma^2) - 1) / 2`, `sigma = blur / 2`, the box clamping the window) and writes them back, then the
   element's translucent fill over them; a backdrop inside a scissor is skipped and a second one would read the first
   one's pixels (the desktop cuts once). Cost: **0.84 ms** for the menu's 150x134 box — 1.91 ms a frame with the glass
   against 1.07 with `?glass=0` (100 frames, headless Chromium, M2). Check: `browser/dialog-check.mjs`, in `solid/test.sh`.
   The closed frame against `frames/dialog-closed.png`: 6.40 % of pixels differ, box means within 15.9/255, ink within
   4 px, the frame's mean 0.93/255. `Enter` then 30 frames: 24.52 %, 13.6/255, 3 px, 1.01/255, the panel
   `40,163,280x154` centred, the backdrop the window, its shadow at blur 32; the dim reads 7,8,10 where the page is
   16,18,24, and 4 px left of the panel 6,6,8 (luma 6.1) against 7.9. The entry 3 frames in (keyboard.down + 3 frames is
   exactly 3/60) against `frames/dialog-entry-mid.png`: 31.80 %, 15.1/255, the frame's mean 1.15/255, the panel 7.81 px
   above its rest, the group at alpha 239/255 and scale 0.978. The menu 2 frames in against `goldens/dialog.json`: 22
   commands, every field, the worst box 3.59 px, and the effects tables identical (shadow 3.45, backdrop 10, group alpha
   233, scale 0.9703, rotate -1.484°). The settled glass against `frames/dialog-menu.png`: 20.62 %, 18.7/255, 4 px,
   1.16/255. The blur's own A/B: over the trigger's border the glass is 22,24,30 against 40,43,49 without it (19/255),
   the scan's worst step 1 against 23, nothing outside the box moved. `Escape` returns 0 of 691,200 pixels to the closed
   frame and the trap cycles Cancel/OK. Mutations: no blur fails only the A/B ("the page under the glass is not
   blurred", both 40,43,49), and ignoring field 39 makes the mid-entry panel read "at y 163.00, not above its rest
   163.00". Bundle 245,583 B (`dialog.js`), page 1,663 B, the same `ui.wasm` 141,104 B; 0.12 ms a frame closed, 1.92 with
   the modal open.
   Limits: the other six pages, touch, and no HMR (a second backdrop, or glass under glass, would read the first one's
   pixels); the bundle is the production `solid-js` (the bundler's `development` condition picks `@solidjs/signals`' dev
   build, whose diagnostics refuse `Sky.tsx`'s writes in its component body).
   **Done: the keyboard and the second page** (2026-10-29). The browser has the desktop's keys. `browser/solid/keys.ts`
   names a DOM `KeyboardEvent` as `src/input.ts`'s `keyName` names SDL's — Tab and Shift+Tab, `" "` for Space, Enter,
   Escape, Backspace, Delete, the arrows, Home/End, PageUp/PageDown, letters (`Shift+A` is the page's own chord) and digits,
   read from `event.code` where SDL's keycode is the key and not the character — and puts the name into the page's `Input`
   before the frame is declared, as main.ts's loop does; Tab, Space and the arrows are `preventDefault`ed, so the browser
   neither moves its focus nor scrolls. The canvas is `tabindex="0"` and a press focuses it (the page does not take the
   focus on load), so a `keydown` reaches it. `browser/solid/shell.ts` is what the two pages share — the canvas, the loop,
   the pointer, the keys and `window.__page` — and `browser/solid/widgets.ts` with `widgets.html` is the second page:
   `solid/app/Widgets.tsx` unmodified, its own `createInput()`, 59 commands, its own bundle (335,796 B, 0.25-0.26 ms a
   frame against Sensors' 239,871 B and 0.08-0.09). Check, in `browser/solid-check.mjs` and `solid/test.sh`: Widgets' base
   frame against `solid/goldens/widgets.json` (59 commands, every field, worst box 3.16 px), its raster against
   `browser/expected-widgets.png` (0.00 % of pixels) and against the desktop's `solid/frames/widgets-initial.png` the way
   `check.mjs` holds this browser to ThorVG's (8.36 % of pixels; command means within 17.3/255, text ink within 3 px, the
   frame's mean colour 1.41/255), and Playwright's keys: Tab twice focuses the Wi-Fi switch (the a11y snapshot's `focused`
   and the 2 px ring's pixel), Space checks it (the snapshot, the track's fill #3c404e -> #f08c32, a pixel of it), Tab on
   to the settings tree (the `Network` item) and ArrowDown move the roving node to `Wi-Fi`. A key that is not mapped leaves
   the switch unfocused; a frame declared before the key is queued makes the tree and the pixels disagree by one key (the
   snapshot has `focused` and `checked`, the canvas still draws the page's background at the switch's edge).
   What is still not there: four more pages (each has its own keys, and the List's and Sky's scroll machines are untried;
   `src/vscroll`'s wheel is in, `Input`'s typed text is not), a second page with a backdrop (the Dialog's menu has the
   only one; a second one in a frame would read the first one's pixels), touch (the wasm has `ui_touch_map`, nothing
   sends a finger's event), and a dev server or HMR (the bundles are built by hand). The generated C is still the no-JS
   page, unchanged, which is what the board already is.
   What is still not there: six more pages (each has its own keys, and the List's and Sky's scroll machines are untried;
   `src/vscroll`'s wheel is in, `Input`'s typed text is not, and neither are a page's dialogs and floats), the renderer's
   side tables (`ui_shadow`, `ui_backdrop`, `ui_backgroundImage` and the value channel's group fields 46–50 and 55: a
   command array alone has no scene, so a shadow, a gradient, a backdrop, a transform or an image is a frame this target
   draws without it — the Sensors page's entry is why the check warms 31 frames), touch (the wasm has `ui_touch_map`,
   nothing sends a finger's event), and a dev server or HMR (the bundles are built by hand). The generated C is still the
   no-JS page, unchanged, which is what the board already is.
   **Done: the List and the Text field** (2026-10-29). The two things the shell could not carry: a page that owns its
   scroll offset, and a page that takes typed text. `browser/solid/list.ts` (`list.html`) is `solid/app/List.tsx`
   unmodified on its own `createInput()` and `src/vscroll.ts`'s machine; the wheel reaches the page's `motion.onWheel`
   (the shell drains `ui.wheel` into it before the frame) reduced to its sign, one event a notch with SDL's sign, because
   a DOM delta is in pixels and the machine counts notches: three notches, a rest frame apart, move the offset 30 px and
   row 0's top by −30.00 px, the thumb at +8.02 px of the viewport, 64.14 px tall, 4 px wide 2 px in (`barOf` for 30 of
   658), Tab easing the offset back to 0 for the selected row and ArrowDown moving it (the readout "Room A1 — 1 of 30" →
   "Room B1 — 2 of 30", the row's fill 36,40,52,255). `browser/solid/field.ts` (`field.html`) is `solid/app/Field.tsx`
   unmodified: a canvas has no `beforeinput` and no composition, so the printable characters come from the `keydown`'s
   `key` into `Input.textInput` (the call `main.ts` makes for SDL's TEXTINPUT), and `keys.ts`'s `selectionChord` names
   the selection keys `keyName` refuses — Tab twice, "Ada" is the page's value and the frame's (`Value: "Ada" (3)`, the
   caret at x 80.16), Backspace one character and −8.70 px, two Shift+ArrowLeft a run of 19.46 px whose middle is
   97,69,51 (the accent at 30% over the surface), the caret 1 px before it. `browser/draw.js` draws a command's own alpha
   for that — the first translucent plain rectangle on this target; no other page's frame moves (all its commands are
   opaque). Check: `browser/input-check.mjs` — the List's base frame against `solid/goldens/list.json` (36 commands,
   worst box 0.94 px) and its raster against `solid/frames/list-top.png` (7.18 % of pixels; means within 14.4/255, ink
   within 1.00 px, the frame's mean within 1.55/255), the field against `solid/frames/field-typed.png` (11.53 %;
   15.3/255, ink 4.00 px, 1.23/255), and the typed run's ink in the same box as the desktop's (52..80 px). Mutations it
   catches: the wheel dropped on its way to the page — "the offset is 0, want 30", "row 0's top moved 0px, want -30";
   a character sent as a key instead of `textInput` — the value is "" and the caret stays at 52 (the run's ink 18 px
   against the desktop's 170). Cost: `list.js` 197,252 B (49,199 B gzip) and 0.17 ms a frame, `field.js` 236,785 B
   (55,208 B gzip) and 0.14 ms on the same `ui.wasm` (141,104 B, 52,269 B gzip).
   **Done: the input method and the clipboard** (2026-10-30). `browser/solid/text.ts` gives the field the two things a
   canvas cannot do for itself: the text above it, and the clipboard's chords. Chromium's `EditContext` is on the canvas
   (`compositionstart`/`textupdate`/`compositionend`); a browser without one — WebKit — gets a hidden textarea with the
   same composition events, its keys cloned onto the canvas (`?ime=input` forces that path, which is how one browser's
   check drives both). The clipboard is Cmd/Ctrl+C/X/V/A over `navigator.clipboard` and the page's own model
   (`Input.clipboard`, `Input.textInput`, Home + Shift+End for select-all, so there is no second selection model). A
   composition's draft never reaches the page — the desktop has no composition, so neither does this: `compositionend`'s
   string is inserted once through `Input.textInput` and drawn by one frame. Measured: the draft "Ada" leaves the value
   `""` and the frame's 20 commands as they were, `compositionend` gives `Value: "Ada" (3)`, the caret at **80.16** and
   **192 px** of ink in 52..80 × 212..229 (the typed run's, `input-check.mjs`'s); Shift+Home + Ctrl+C is "Ada" in the
   clipboard, Ctrl+V brings it back (the caret at 80.16, 192 px), Ctrl+X empties the field and keeps it, Ctrl+A selects
   28.16 px and a key replaces the whole value. Check: `browser/ime-check.mjs`, in `solid/test.sh`, both paths in one
   browser. Cost: `field.js` 248,670 B (57,075 B gzip), 3,386 B over the page without it, 0.12-0.19 ms a frame with a
   composition open (0.14-0.27 at rest: the noise, nothing per frame). Mutations it catches: the committed string not
   going through `Input.textInput` — "the value is "", want "Ada"" and "the composed run is 18 px in [52,52,212,229],
   the typed one 192 px"; a paste not awaited — "the field is "" with the caret at 52 and 18 px of ink, want "Ada", the
   caret at 80.1640625 and 192 px".
   **Done: the Dev page and the Sheet** (2026-10-30), the last two, so all eight of the desktop's pages are real in a
   browser. `browser/solid/dev.ts` + `dev.html` run `solid/app/Dev.tsx` unmodified (660x760: the Widgets page in its
   360px column, a 300px panel that prints the page's a11y tree, the box under the pointer, the live values and the
   frame's phases) and `browser/solid/sheet.ts` + `sheet.html` run `solid/app/Sheet.tsx` (440x564, static) — both
   `mountPage`, the sheet with no input and no hook, so a page that needs nothing is still the shell's page. The surface
   gained only what the panel reads: the frame's `stats` (`Options.stats`, handed to `createFrame` and `createDrawer`, so
   the phases and the draw's time are the loop's own) and `ui_present`/`ui_presents` beside `ui_draws` (+67 B; the
   shell's `paint` calls it once a frame, the desktop's window present) — `ui.over` was already the point `ui_begin` gets,
   so the panel's `deepest` and the page's `:hover` follow the real mouse with nothing added. Check:
   `browser/dev-check.mjs`, in `solid/test.sh` with the same guard. (a) the Dev page's 360px column against
   `frames/dev.png`: 9.63 % of pixels differ, 51 command boxes' means within 17.3/255, ink within 3.00 px, the column's
   mean within 1.62/255 (the panel is not compared pixel-wise — it prints its own frame's milliseconds and Canvas2D
   re-wraps one of its 10px rows — and is asserted through its text commands instead). (b) the a11y tree is the page's:
   28 nodes, every box inside x ≤ 360, the panel's boxes none of them. (c) the pointer on the button makes the panel print
   `press  button "Presses: 0"` and, in the live values, `press  button "Presses: 0"  40,72 280×40`. (d) Tab, Tab, Space:
   the panel's row `switch "Wi-Fi" [checked=false focused=true]` -> `[checked=true focused=true]`, the frame's hash moves,
   and 30 frames at rest draw and present nothing (draws 16, presents 16 stand still). (e) the sheet's 13 commands against
   the new `goldens/sheet.json` (every field, the worst box 7.24 px: the fallback ⅓ is another font's glyph here) and its
   raster against `frames/text-sheet.png` (4.04 %; means within 14.6/255, the frame's mean within 1.80/255). Cost:
   `dev.js` 297,480 B (66,322 B gzip) and 0.76-0.96 ms a frame with the panel's 28 nodes and hover walk, `sheet.js`
   160,731 B (39,926 B gzip) and 0.13-0.18 ms, on `ui.wasm` 141,171 B (52,235 B gzip). Mutations it catches: the pointer
   not reaching `ui_begin` — "the panel has 0 lines naming the button"; `stats` not handed to the frame — no
   `draws N presents M` line at all; a panel that reprints every frame — "30 frames at rest: draws 50 -> 80".
   Limits: a real IME was not driven (Playwright cannot: the composition's events are dispatched, so no candidate
   window, no dead key, none of an IME's own keydowns, no several-clause `textformatupdate`), and where a platform puts
   that window is not observed even though the EditContext now carries the field's own string, caret and boxes
   (`updateText`/`updateSelection`/`updateControlBounds`/`updateSelectionBounds` from `Input.field()` once a frame, the
   IME's `textupdate` written to the view and the model's only at `compositionend`): the check reads the mirror back — the
   context's text, its selection against the model's, and the character bounds at the drawn caret — not the window itself;
   the clipboard's read is the page's permission (the check grants `clipboard-read`/`clipboard-write`; an insecure context
   has no `navigator.clipboard`),
   no pinch or long-press, no real touchscreen on this machine (the finger's path is Chromium's own touch
   through the DevTools protocol), no HMR; and the panel's live
   values edit through `ui.value`, but its `s` and the host's `--tune` are file paths and Bun's browser bundle stubs
   `node:fs`, so both are no-ops in the page.
   **Done: a finger in the browser, and the two drags** (2026-10-30). The browser was the mouse's and the wheel's; a
   touchscreen's pointer events reached no listener, so the List's rows and its thumb and the Sky's feed could not be
   dragged with a finger — and the drawer's sixth argument was never passed (`shell.ts`'s and `sky.ts`'s `step` called
   `draw(px, py, down, dt, discrete)`), so `src/frame.ts`'s flag was false whatever the pointer was. Now:
   `pointerdown`/`pointermove`/`pointerup`/`pointercancel` with `pointerType === "touch"` in both loops, the same `at()`
   mapping as the mouse's, `down` while the finger is on the canvas and up where it lifts, the frame's `touch` **true**,
   `event.preventDefault()` on the press (no compatibility mouse events: one tap is one press and one release),
   `touch-action: none` on the canvas (`shell.ts` for its five pages, `sky.html` for the Sky: without it the browser pans
   the document and cancels the page's gesture), `setPointerCapture` so a finger that leaves the canvas still lifts on it,
   and `pointercancel` ending the gesture at the last point as a release. The mouse's listeners are untouched and their
   frames stay `touch = false`; `window.__page` grew `touch()` (the flag the last frame's `onPointer` got), `touches()`
   (the finger's events the canvas has taken: a check waits on it) and `offset(id)` (a clip element's offset, positive
   down), for the check. **`browser/ui.c` needed nothing**: the flag never
   enters Clay (`ui_begin` carries the button and the time; a finger is the same pointer above that line), and the DOM's
   pointer events are already in the canvas's CSS pixels, so `ui_touch_map` — the desktop's SDL mapping — has no work
   here; `ui.wasm` is 141,104 B, unchanged. Measured, by Chromium's own touch (`Input.dispatchTouchEvent`,
   `hasTouch: true`; the check waits on the listeners' own count, `window.__page.touches`, because a CDP call resolves
   before the renderer runs, and Playwright's `touchscreen.tap` only taps), the window loop held so a frame is one asked
   for, plus the one an event runs:
   **the List** — a 40px drag moves the offset **40.000px** and row 0's top with it **40.000px**, the selection stays
   ("Room A1 — 1 of 30"), and a release with the finger at rest for 12 frames **ends there** (40.000; a finger that lifts
   while moving throws, as `list.test.ts` has it); a press with no travel still clicks (a tap selects "Room C1 — 3 of 30",
   then "Room A1 — 1 of 30"); the thumb, up after that drag at `314, 112.69, 4x64.14`, holds the offset where it is
   (40.000) and **20px on it is 74.833px of offset** — 20·(898−240)/(240−64.14) — with the thumb itself **20.000px**, and
   its release ends at **114.833** with no fling. **The Sky** (Science: 742px of content in the 664px feed, 78px of
   scroll) — 60px of drag are **60.000px** of offset and 120px are **100.323** (the end, 78, then `f(42) = 22.323` of the
   rubber band in 664), the release letting the band go back to **78.000**; the throw is the desktop's own drag (10px in
   five 1/60 frames, through `__page.pointer` + `warm`): released at **11.48**, **12.90** the frame after (a positive
   velocity), resting at **54.955** — the projection of its last frames' speed, `sky.test.ts`'s 54.95 — and a 5px drag
   does not open the thread a tap does (Back, tapped, returns). The flag's one rule at 2px: a finger's 2px travel is
   already a drag (no thread, `touch` true) and the mouse's is a click (the thread opens, `touch` false). **The mouse is
   unchanged**: `solid-check.mjs`, `sky-check.mjs`, `input-check.mjs` and `dialog-check.mjs` all pass (the List's and the
   Sky's rasters at rest are their stored frames), a 45px mouse drag is **45.000px**, and a touch drag and a mouse drag
   that end in the same place leave **byte-identical dumps**. Cost: the touch path adds 1,107 B to `list.js` (200,586 →
   **201,693 B**, 50,079 → 50,252 gzip) and 880 B to `sky.js` (357,624 → **358,504 B**, 82,575 → 82,737 gzip); a frame
   with a drag in flight is **0.20 ms** on the List and **0.82 ms** on the Sky. Check: `browser/touch-check.mjs` (31
   comparisons) in `solid/test.sh` with the other four. Limits: pinch and any two-finger gesture, long-press, a
   touchscreen (this machine has none), the Widgets page's slider under a finger (`Widgets.tsx`'s drag is the same
   `drag.onPointer`, untested), and no HMR — a hot re-mount keeps the shell's state and not the page's, with the numbers,
   below; a style change is a new module, so true style patching would need Vite's graph.
   **Done: the dev server, and reload on save** (2026-10-30). The browser target had no loop: a style change was
   `sh browser/build.sh` and `bun browser/solid/build.ts` again and a person's reload, and `check.mjs --serve` was a
   static server that built nothing. `browser/serve.ts` (Bun, `bun browser/serve.ts`) is the loop: it builds both
   artefacts into a temp directory, serves `browser/` and them at one origin
   (`http://127.0.0.1:4173/browser/solid/index.html`; `--port`, `--open`, `--root`), watches the builds' inputs
   (`browser/`, `solid/`, `desktop/clay_dump.c`, `vendor/clay/`, `generator/`, `examples/sensors/`, `apps/`,
   `packages/cssints/dist`), debounces 80 ms and picks the build by extension: `.c`/`.h`/`.sh` the wasm,
   `.ts`/`.tsx`/`.jsx` the bundles, cssints' `dist` both, `.js`/`.html` no build at all, only a reload. A build writes
   into a staging directory and is renamed over the served copy only when the child exits 0, so a broken save keeps the
   last good artefact: the page is not reloaded, it keeps running, and the compiler's text arrives as an `error` event —
   a dark red bar at the bottom of the page (a script the server injects into every `text/html`, so the htmls are
   untouched) and a `console.error`. A good build pushes `reload` over the same `text/event-stream` and the page does
   `location.reload()`: a full reload, so its Solid state and its scroll are lost. Measured by `browser/serve-check.mjs`
   (three runs on an M2: two under a load average of 70-170 and one quiet, so the median is a loaded one): the first
   build **101.3 s** (wasm 58.1 s, bundles 43.1 s); a `.ts` save **38.0 s** to the bundles and **38.2 s** to the page's
   first frame; a `.c` save **21.4 s** to the wasm and **21.6 s** to the first frame. The quiet run: **25.5 s** first
   build (wasm 15.0, bundles 10.5), a `.ts` save **11.4 s** / **11.7 s**, a `.c` save **2.5 s** / **2.6 s**. The bundles
   are the cost — `Bun.build` over eight entry points, each page's `.tsx` through Solid's compiler and cssints in a Node
   child — so any `.ts` save rebuilds all eight. The check (in `solid/test.sh`'s browser block) runs on a temp copy of
   the repo as `--root` (it writes no tracked file): a `.ts` save rebuilds the bundles and not the wasm (the live
   `ui.wasm`'s mtime does not move, `page.js`'s does), and the page's `timeOrigin` changes; a `#error` in `ui.c` fails
   the wasm build, the page's bar
   names it (`serve-check-typo`), the page is _not_ reloaded, and a manual reload still serves the last good `ui.wasm`;
   the fixed save rebuilds the wasm and reloads, and the frame is the one from before the break (the same hash). Real HMR
   was still absent, and is what the next paragraph took the first step of: it needs the module graph — the engine's own
   `cssints/vite` plugin and Vite's client, as `apps/docs` runs them — in this path, and a `.c` save is a reload whatever
   else is hot, because the page holds one `WebAssembly.Instance`.
   **Done: the hot re-mount** (2026-10-31). The reload above is now the fallback. A bundle-only save pushes a `hot` event
   — one JSON line of data, `{"v","why","ms"}` — and a page that opts in (`mountPage({ ..., hot: true })`, the Widgets
   page) imports its bundle again at `?v=<v>` instead of navigating; `shell.ts` split into a **host** on `globalThis`
   (the canvas and its context, the `WebAssembly.Instance` and Clay's state in it, the font, the DOM listeners, the
   pointer) and a **session** per module copy (the tree, the frame, the drawer, one rAF, `window.__page`), so the new
   copy's `mountPage` renders its tree, stops the old session (`cancelAnimationFrame` plus `render`'s dispose) and takes
   its place; `ffi-browser.ts` keeps the instance and the transient heap slot on `globalThis` for the same reason. The
   page's `Input` and every signal stay the page's — a new module is a new component. Measured by `browser/hot-check.mjs`
   on a temp copy (medians of three, load average 29/13/10): a `.tsx` save to its new frame **4125 ms** hot against
   **4315 ms** reload — the build is most of both — of which after the build **37 ms** against **71 ms**; a `.c` save
   **2290 ms** (still a reload: a new instance is a new page). What survives a re-mount: no navigation, the same row hovered (the host's pointer), the
   canvas focused, the document's scroll, one wasm (`presents` 31 → 53), one loop (62 frames/s; skipped dispose: 240) and
   the canvas's 11 listeners. What does not: the switch reads `checked: false`, its `:focus` ring is gone, and the page's
   own scroll machine is new — the same as after a reload, which also costs the pointer and restarts `presents` at 22.
   Three re-mounts cost 4.6 MB of heap (3.4 → 7.9 MB: a bundle copy and its Solid runtime). A broken `.tsx` save keeps
   the last good frame and says why in the bar, as before. A style change is compiled into the bundle, so it is a new
   module and not a patchable string: patching one, and keeping a component's signals (`solid-refresh`), still want
   Vite's module graph and the engine's own `cssints/vite` plugin in this path.

## What Rune's research gives us (2026-10-23)

[Rune](https://github.com/anomalyco/rune) (Maukea) is a Rust UI framework with its own wgpu renderer, Taffy layout,
Parley text and per-platform shells — not our stack, and none of its code is portable. What is portable is the method:
25 documents in `research/`, with a handful of measured spikes. What we would take, by value for the price:

1. **Idle frames, and a frame on the input.** `solid/main.ts` sleeps 16 ms and declares, lays out and draws every frame
   whether anything changed or not; a key press waits for that tick. Take: poll, then draw at once if there was an
   event; if there was none and the packed tree did not change (a hash of the command array), skip `ui_draw` and sleep.
   On the desktop this stops a static page from burning a core; on the board it turns 22 ms a frame at rest into 0.
   Check: a frame counter with no input stays at 0 draws, one key draws one.
   **Done: the frame hash and the idle loop** (2026-10-25). `ui_end` hashes the frame into 64 bits (`ui_hash`, FNV-1a
   over every command's visible fields and the renderer's tables beside them — shadows, backdrops, gradients, groups;
   padding, `userData` and `zIndex` are left out, and a neutral group is skipped because it draws what it would have
   drawn without one), and `ui_draws`/`ui_presents` count the calls. `solid/src/frame.ts` has the decision as
   `createDrawer(frame)`: declare and lay out every iteration, draw only when the hash changed or a _discrete_ input
   came in (a key, typed text, a press or release, a wheel notch), and the pointer's moves go through the hash alone —
   a hover that starts draws, a move inside a settled hover does not. `solid/main.ts` sleeps only when nothing was
   drawn, and the headless path (`--keys`/`--wheel`/`--settle`/`--move`, and the new `--idle N`/`--idle-keys K`) takes
   the same drawer, so every stored frame is byte-identical. Measured: headless `--idle 600` is **0 draws** (Sky 21 ms,
   0.04 ms a frame; Sensors 11 ms, 0.02 ms a frame for the tick that still declares, lays out and hashes); the Sensors
   window at rest with `--frames 600` is **1 draw, 1 present**, 599 idle iterations of 17.7 ms (the 16 ms sleep most of
   it); with the draw forced those 600 frames are 5.00 s, 8.29 ms a frame, of which `ui_draw` 0.30 and
   `ui_window_present` 6.43 ms — **the compositor's wait is in the loop and is the bulk of a present**, so an idle
   frame skips ~6.7 ms of work. `--idle 600 --idle-keys 10` gives 60 draws of 600, one a key, and the sky page's
   settling tracks still draw every frame until they settle (`solid/idle.test.ts`). Open: a blocked poll
   (`SDL_WaitEventTimeout`) in place of the 16 ms sleep, which would both stop the tick and cut the ≤16 ms input
   latency; the board's own loop (22 ms a frame at rest, no hash yet); and dirty rects, where a changed frame draws all
   of it. The terminal and browser targets have no such loop, and a window-expose present is not handled (the next input
   redraws the window).
2. **Motion as a first-class track.** We have no animation at all. Rune's model transfers unchanged: a spring from
   `(duration, bounce)` (SwiftUI's parameterisation), a track `{t0, x0, v0, target, spring}` that retargets from the
   presented `(x, v)`, `spatial` and `effect` classes (colour and opacity never overshoot), a settle rule with a snap
   (`1/64 px` for geometry), a first mount that can arrive (the Sky page's cards do, staggered; reduced motion skips
   it), reduced motion, and a `Decay` track for scroll physics
   (`0.998/ms`, rubber band `0.55`). It is cheaper for us than for them: the value is packed into the style each frame
   anyway, so `solid/src/motion.ts` is ~150 lines and the Dialog, the menu, the tab underline, hover and the feed's
   scroll come alive. Checks are theirs too: `x` and `v` continuous at a retarget, `1x16.6 ms == 2x8.3 ms == seek`, and
   an exact stop.
   **Done: motion tracks (scroll)** (2026-10-23). `solid/src/motion.ts` has the model: a spring from
   `(duration = 0.35, bounce = 0)` with `ω = 2π/duration`, `ζ = 1 - bounce`, solved analytically in the three regimes
   (a decaying sinusoid, `e^(-ωt)(d0 + (v0 + ω d0)t)`, two real exponentials), so it is exact at any time and needs no
   integration; a track `{x0, v0, target, t0, spring}` whose `at(t)` is `{x, v, done}`, whose `retarget(t, target)`
   samples the presented `(x, v)` first (continuity), and whose settle is 0.5px and 0.5px/s with the value snapped to
   the target exactly; `spatial()` and `effect()` (the latter critically damped and clamped to the start..target range
   even when asked for a bounce); and a decay `v0·r^t`, `r = 0.998/ms` (`k = -1000 ln r ≈ 2.002`), landing at
   `x0 + v0/k`, stopping at `|v| < 5px/s` on that projection. The clock is passed in, never read. The first user is the
   Sky feed, which is also the first page to own its scroll offset: `ui_wheel` now feeds a second channel
   (`ui_wheel_pop`), `ui_auto_scroll(0)` keeps `ui_begin` from giving the same delta to Clay's containers (the default
   stays on; the Sky feed and, since the List's page-owned track, the List's viewport turn it off), `View.onWheel(dx, dy)`
   gets the polled delta before the frame (headless `--wheel` too) and `View.tick(dt)` runs before `flush()`. Sky: a notch is
   10px, accumulated and clamped to the last card's height (an explicit `maxScroll` from `ui.bounds`); a notch from rest
   glides from `ω·d` (no overshoot); a burst of two or more is a flick whose presented velocity goes to the decay, whose
   projection is clamped, and the motion then either decays to it or springs to the clamped end; keys retarget the same
   track. Measured: one notch `2.59, 1.92, 1.42, 1.05, 0.78, 0.58…` px a frame, exact 10px at rest; eight notches
   `2.59…5.79`, peak 6.60, rest at 78 after 31 frames; a wheel up 13.51px into the throw lands at 64.05, worst
   frame-to-frame increase 1.64px (the notch is 10); the four stored frames regenerated byte-identical (the settled
   -78 is what the old clamp had). Checks: `solid/motion.test.ts` (frame-rate independence, both limits at a retarget,
   the exact settle, effect's clamp, the decay's projection) and the sky test's four scroll blocks, whose stored-frame
   check is a 0-pixel `diffPng`. Mutation: `Track.retarget` setting `v0 = 0` after sampling makes the mid-flight block
   fail — `FAIL and it turns the throw back: the rest is 64, ten px above the 74 it was heading to: 27.87, wanted
64.05`.
   **Done: the value channel, and the Dialog's menu and panel** (2026-10-24). A style is packed once, so a field could
   not move; now a page's `tick` calls `ui_value(id, len, field, value)` for an element and `ui_open` copies that
   element's 45 floats, applies the frame's overrides of its id and declares from the copy — a renderer-level side table
   as the shadow's and the backdrop's, cleared in `ui_begin`, no cache, 64 overrides and a 180-byte `memcpy` per
   overridden element (0.008 ms of declare for the Dialog's two). Fields 0..44 are the packed ones (`pack.ts`'s `FIELDS`
   names the offsets 38/39, the expand 40/41, `Z_INDEX` 42, radius, colours, padding, gap, width and height); 45 is
   `ui_shadow`'s blur. Offsets, expand, z and the blur are what reads as motion; a width, a gap or a colour re-lays-out
   the parent every frame (a layout change, not a transform) and is documented as such. The Dialog is the first user:
   the menu's float offset y slides -10 → its style's -20 on `spatial(0.22, 0.1)` with its shadow's blur 0 → 14 on
   `effect(0.22)`, the panel drops -14 → 0 and 0 → 32 on the same pair, both ending on the style's own literal (the
   settled `frames/dialog-menu.png` and `dialog-menu-light.png` came out byte-identical; `dialog-open`/`dialog-light`
   were regenerated, since the panel's own blur is now 32). The clock is the page's and stops with the element, so a
   reopen retargets from the value it froze on (measured: closed at -10.85, reopened at -10.85, a 0.000 jump). Measured
   per frame: the menu's offset `-10.00, -10.85, -12.58, -14.42, -16.04, -17.32, -18.26, -18.92, -19.36, -19.64,
-19.82, -19.92, -19.97, -20.00` and at rest exactly -20, the pixel beside the menu 18.0 → 13.9 (the shadow's blur);
   the panel's y `149.88, 151.07, 153.49, …163.88` and still. Stored: `frames/dialog-menu-mid.png`, three frames in.
   Mutation: `ui_value` dropping `OFFSET_Y` gives offsets of -20 on every frame — `FAIL every frame of the slide moves
it towards the offset: false, wanted true` — and the mid frame's menu sits at the settled place, only the shadow band
   differing.
   **Done: exits, presence and reduced motion** (2026-10-25). `motion.ts` gained `presence(when, exit)`:
   `update(when, dt)` returns `{ mounted, closing }`, the falling edge keeps the node mounted (that frame being the
   exit's first) for `exit` seconds and then unmounts it, and a return mid-exit revives it where it is — Rune's rule —
   since the tracks retarget from what they present (the reopen frame is the exit's own next value). `channel(write)`
   makes a page's tick one call an element (`write(id, t, [field, track], …)`), and a reduced-motion flag
   (`setReducedMotion`/`reduced`, `--reduced-motion` or `REDUCED_MOTION=1` in `main.ts`) makes a retarget land with
   v = 0 in the same call and a presence mount/unmount at once, so the pages carry no branch. The Dialog is the user:
   closing runs the arrival tracks backwards — panel offset y 0 → 14 (`spatial(0.2, 0)`) and blur 32 → 0, backdrop alpha
   140 → 0 through field 17 (its box is the window, so the alpha is the dim), menu -20 → -10 and 14 → 0 — for the
   presence's 0.35s (the 0.2s tracks settle at 0.333, so no frame is cut), then both nodes leave and the page's pixels
   are back (0 differ from the frame before opening). The trap stays the open state's timing: a Tab right after Escape
   reaches the page (the Zoom trigger) while the panel fades, and a closing overlay writes `CAPTURE` 43 = 1 so a press
   goes through it. Measured: the panel's y `163.88, 165.24, 167.82, 170.39, 172.54, 174.18 … 177.88` (rest 163.88),
   the title pixel behind the backdrop `103 … 230` (140 of 255 of dim to the page), the menu `-20.00, -19.03, -17.18,
-15.34, -13.81, -12.64, -11.79, -11.19, -10.79, -10.51, -10.33`, and a reopen after four frames presenting 174.18
   (the exit's own next frame) and settling on 163.88. Reduced motion opens on the literal's frame and removes both
   nodes in the frame it closes. Stored: a new `frames/dialog-exit-mid.png` (three frames after Escape, the panel 3.94px
   into its exit, its blur at 22.9 of 32, the dim at 100.6 of 140), every other dialog frame byte-identical, and a
   `--reduced-motion` run against `frames/dialog-open.png`. Mutation: mounting the dialog on `dialog.open()` again
   (dropping the presence) fails `FAIL the panel is still in the layout right after Escape: false, wanted true`.
   **Done: group opacity and scale** (2026-10-25). The value channel moves one number of one element, and a text's
   colour is not in its parent's floats, so a panel could not fade its children; Clay has no opacity and no transform.
   `ui.c` now keeps the frame's **element tree** (`ui_open`/`ui_close`, and `ui_text`, as `{id, parent}` nodes in
   declaration order, cleared in `ui_begin`) and every declaration carries its node as `userData`, which Clay copies
   into each command it emits; the renderer turns an element's **subtree into the contiguous range of its commands** and
   gives the range a ThorVG scene: `tvg_paint_set_opacity(scene, alpha)` (fields **46 `ALPHA`**, 0..255, so a text fades
   with its own fill) and `tvg_paint_set_transform` about the **box centre** of the range's first command (field **47
   `SCALE`**, 1 = none, from `centre·(1 - scale)` in e13/e23 — ThorVG's matrix takes the translation in its third
   column and silently drops it from e31/e32, measured). Neither is a layout: `ui_bounds` does not move. A settled group
   (255, 1) makes no scene, so the Dialog's settled frames stayed byte-identical. Limits: four groups open at once (a
   fifth is ungrouped), 16 a frame, eight nested scissors, one backdrop cut a frame — a cut inside a group settles the
   open groups into pass 1 and makes them again after it (the menu's glass is exactly that), and a shadow is drawn
   inside its element's group, so it fades with the panel. The Dialog's panel and menu arrive and leave as a group
   beside their offsets (alpha 225 → 255 and 96% → 100% on `effect(0.2)` and `spatial(0.22, 0.1)`; the backdrop keeps its
   own dim through field 17). Measured (`solid/dialog.test.ts`, `dialog-entry-mid` three frames in): alpha 119 of 255,
   scale 97.8%, the panel's box `40, 156.1, 280x152.3` against `40, 163.9, 280x152.3` at rest (x, width and height the
   literal's on every frame), a flat spot `24,27,36` between the dimmed page `7,8,10` and the settled panel `36,40,52`,
   the title's brightest pixel `163,163,166` against `235,235,240`, the visible edges `43..316` inside `40..319`.
   Mutation: no `tvg_paint_set_opacity` fails the two blend checks and nothing else. Stored: `frames/dialog-entry-mid.png`,
   and `dialog-menu-mid`/`dialog-exit-mid` were re-stored (a mid-exit panel now fades and shrinks).
   **Done: the group's translate, the feed's entry and hover, and the rubber band** (2026-10-25). A group gained a
   **translate** (fields **48/49 `TRANSLATE_X`/`TRANSLATE_Y`**, px): the scene's one matrix is
   `x' = scale·(x - c) + c + t`, the scale about the box centre with the offset after it and unscaled, so a subtree
   slides without moving anything in the layout (`ui_bounds` is the settled box on every frame), and a group at
   255, scale 1 and offset 0 still makes no scene — the Dialog's frames stayed byte-identical. The Sky page is the user,
   with the three pieces of motion it was missing: **the entry** (on the first mount every card starts 12px low and at
   0 opacity and settles on its literals in 0.3s, `TRANSLATE_Y` on `spatial(0.3)` and `ALPHA` on `effect(0.3)`, each card
   50ms after the one above it; measured, eight frames in the offsets are 4, 8 and 12px of their 12 and thirty frames
   later exactly 0; only the first mount — a tab switch draws its feed at rest — and reduced motion starts no track at
   all), **the hover fades** (`effect(0.12)` through four background floats, and because a card's gradient is drawn
   _instead_ of its solid fill, also through a new field **50 `GRADIENT_ALPHA`**: below 255 the renderer draws the solid
   fill under the gradient, so the resting and hover gradients cross-fade and a settled hover is the hover gradient
   pixel for pixel; the card alternates `card`/`cardHover` and the page keeps the hover one while the fade runs either
   way, since a `:hover` state would drop the gradient the moment the pointer left — the one cost is the 6/255 at the
   card's bottom edge where the gradient changes identity; a tab's 2px underline is its own border colour
   (**`BORDER_ALPHA` 29**), faded in on the tab that becomes active and out of the one that was — a colour, not a slide,
   and Clay draws a border inside the box, so no tab moves; a text's colour is not in its box's floats and its label
   swaps style instead), and **the rubber band** (a notch past an end is a pull of the edge while the content is at the
   end, `f(x) = (1 - 1/(x·c/d + 1))·d` with `c = 0.55` in `motion.ts` and `d` the viewport's 664 — the raw 10px of a
   notch is 5.45, the raw 40 is 21.29 — where a notch that only _reaches_ the end while the content still glides is a
   scroll like any other, so nothing jumps; 80ms without a notch and it lets go on `spatial(0.35, 0.1)` from what it
   presents, settling exactly on the clamp; a key drops it, a notch back walks it in, a flick's release is a spring and
   not a decay, a feed switch is still a hard clamp, and reduced motion has no band). The band needed one host member,
   `ui_scroll_put(id, y)`: `ui_scroll_to` clamps to Clay's content range, and a band is past it on purpose. Measured
   (`solid/sky.test.ts`): the card's hover `28/33/41, 31/37/44, 32/37/46…` between its resting `26/31/36` and hover
   `34/40/49`, the leave the same path back, a quick leave and re-enter's widest frame 3/255; a new tab's underline
   `42/64/87` on the way up and the old one's `49/126/191` on the way down; four notches past the clamped 78 land at
   99.29 (+21.29 of the raw 40), a notch back at 97.95, the band held four frames and back on 78 twenty-two later.
   Stored: `frames/sky-entry.png` (ten frames in, the three cards at 2, 4 and 10px), `sky-hover.png` (the pointer on the
   second card three frames into its fade, `--move X Y N`, a new headless option) and `sky-band.png` (Discover four
   notches past a feed shorter than its viewport), and the four older `sky*.png` are **byte-identical** with
   `--settle 40` (the entry and a settled hover are their literals; `--warm N` is the other new option, rest before the
   input). Mutations: a hover that starts its track at the target rather than retargeting it fails `FAIL the third frame
of the hover is between the resting colour and the hover's: false, wanted true` and three more of that block; a
   stagger of 0 fails `FAIL each card further behind the one above it: the entry is staggered: false, wanted true`; a
   band that clamps hard fails `FAIL a wheel past the end pushes the content out of it: false, wanted true`,
   `FAIL and exactly its f(40) on the 664px viewport: 78, wanted 99.29`, the hold and the exact return, and nothing
   else.
   **Done: the text channel and rotation** (2026-10-26). The value channel's last two holes. **A text's colour** is its
   own four floats, not its parent's box's, so no box override could reach it and a label whose colour changed swapped
   its style in one frame. `ui_text` now takes the text's **id** (`ui_text(id, id_len, bytes, len, floats)`, NULL for an
   anonymous one, which is the ceiling: a text without an id cannot be named and keeps its literal), and the table's
   fields **51..54 (`TEXT_COLOR`)** override the four colour floats of the text's copy — Clay's text command carries the
   colour, so the hash sees it and a fading frame draws. The Sky page's tab labels are the user: each `<text>` has an id
   and the page fades its colour on `effect(0.15)` from the muted token to the accent and back, retargeted from the
   presented percent, beside the 2px underline that was already fading (measured: the new label `139/152/165 → 126/152/176
→ 106/153/195 → 89/154/211 → 77/155/222 → 59/156/240`, the old one the same path back, a quick switch back inside the
   two ends with its widest frame 15/255; `sky-tab-mid.png` is a switch two frames in). **Rotation**: the group gained a
   fifth number, **55 `ROTATE`** (degrees about the box centre), composed with the scale and the translate into one
   matrix — **scale, then rotate, then translate**, `x' = s·R·(x - c) + c + t`, `s·R` in the 2×2 and `c + t - (s·R)·c`
   in the third column of ThorVG's matrix (`x' = x·e11 + y·e12 + e13`, its third row unused). The Dialog's menu leans
   `-2° → 0` on `spatial(0.22, 0.1)` as it slides out of its trigger and back to `-2°` on the way out; 2° over its 150px
   is 5px of top edge. It is drawn, not laid out: `ui.bounds` is the style's box on every frame (`40,·,150,133`) while
   the top border's insets a row below the box's top read `112/11, 108/10, 60/8, 25/7` as the lean decays and `5/5` at
   rest. The composition is proved on a hand-built non-square box: a 200x40 box with `SCALE` 0.5, `ROTATE` 90° and
   `TRANSLATE_X` 40 is the rect x 130..150, y -30..70 — the long side standing up about the centre (100, 20) and the
   40px after the rotation, unscaled. One arithmetic detail stated: a rotation of 0 takes the scale's own matrix
   expression, because `c·(1 - s)` and `c - s·c` round differently and three glyph pixels of the scaled panel moved by
   one level otherwise. Stored:
   `sky-tab-mid.png` (a new frame) and `dialog-menu-mid.png` regenerated (the tilt); every other frame is byte-identical,
   the settled ones included (the lean lands on 0 and a group at 255, scale 1, offset 0 and rotation 0 makes no scene).
   Mutations: dropping the four `TEXT_COLOR` writes fails `FAIL and the next frame is strictly between the muted token and
the accent: false, wanted true` (both labels at their ends throughout) and three more of that block; dropping the
   `ROTATE` write fails `FAIL mid-lean the top edge is not horizontal: the border's two insets differ: false, wanted
true` (the insets flat). Files are compared with their backups after the reverts.
   Not covered yet: a second gradient on one element; the thread screen
   (Sky's card click records the selection and nothing opens); a finger on real glass — SDL3's finger events go through
   `ui_touch_map` into the same pointer the mouse uses and both pages' touch behaviour is tested, but no touchscreen has
   been used; and the terminal, browser and board targets (no Solid page, no wheel and no value channel). A gradient or a
   clip inside a _rotated_ group is covered: the dither's mark is the gradient's rotated quad and a clip is cut by its own
   mapped quad (`solid/rotated.test.ts`); the drag, the pages' entry, the List's own track and the window are covered by
   item 2 — its selection, which the wheel leaves behind, is a declared range of its own, and a measured feed is declared
   once in one frame and then virtualized, so neither the column's layout nor the content's end moves
   (`solid/list.test.ts`, `solid/virtual.test.ts`).
   **Done: the motion as a figure** (2026-11-03). The four motion kinds of the figure format (`motionTiming`, `easing`,
   `stagger`, `frameStrip`, `solid/src/figure/kinds/motion.ts`) draw `motion.ts`'s **own** samples: `from-motion.ts`
   writes the Dialog's panel out (`spatial(0.2, 0)`) and menu in (`spatial(0.22, 0.1)`), the same travel on `effect(0.22)`,
   the Sky cards' 50ms stagger and the panel's drop beside the feed's fling (`decay(87.03 px/s)`, landing on 54.95) at
   1/60, and `solid/figure-motion.test.ts` re-runs the spring from each spec's parameters — so the samples the panels took
   are the ones the figure prints (the entry `149.88, 151.07, 153.49 …` and the menu `-10.00, -10.85 …` are the README's
   own lists, to 0.00px; the exit's fourth frame is 170.40 against the page's measured 170.39). So what is left of the
   motion items is what a figure cannot carry — a second gradient on one element, the thread screen, a finger on real
   glass, and the other targets' pages: a track's trajectory is no longer one of them, it is a figure read on the desktop,
   the terminal and the browser, and nothing about a page's behaviour moved. The half is complete now (2026-11-06): the
   kit's `intentCard`, `transitionSpec` and `easingTable` are kinds 37–39, on the pages' own frames and the solver's own
   numbers, so no motion type of the kit is missing any more.
3. **Done: metamorphic tests** (`solid/metamorphic.test.tsx`, 2026-10-25). Four relations over the Sensors page and a
   two-width text, no oracle and no stored frame: a fixed-size wrapper leaves the pixels identical (0 of 129,600 differ);
   a whole-pixel move (13, 7) shifts the picture exactly (0 differ); a wider box never adds a text line (82px at 160
   wide against 49px at 300); and the same tree drawn twice in one process is the same frame (0 differ), which is the
   stale-cache check Clay's scroll offsets and the renderer's picture caches need. Mutations: a one-pixel slip in the
   move fails with 5,869 pixels, a 1px padding in the wrapper with 6,859. Left: scale equivariance (a 2x render
   downsampled against 1x), order independence of non-overlapping siblings, and the springs' time-split relation
   (`motion.test.ts` already holds `1x16.6 == 2x8.3`).
4. **Done: a scene as a file (record/replay).** `--keys/--click/--wheel` were ad hoc; Rune's scripts are a typed event
   log with timestamps, window size and theme. `solid/scenes/*.json` is that file now: `{ name, page, size, theme,
reducedMotion?, steps }`, a step a typed event at its time — `key` (`name`, `down`), `text` (`text`), `pointer` (`x`,
   `y`, `down`, `touch`?), `wheel` (`dx`, `dy`), `settle` (`frames`) or `frame`. Times are seconds from the start,
   rounded to the nearest 1/60s frame (a frame is what carries input) and never decreasing; the JSON is strings, numbers,
   booleans and arrays only, so a C or a wasm host can read it too. `solid/src/scene.ts` parses and validates (a bad step
   fails with its index and why — `step 1: out of order: t 0.1 is frame 6, after a step at t 0.5 (frame 30)`; a size that
   is not the page's fails before a frame), replays into the page's own `render`/`createFrame`/`createDrawer` loop (no
   second frame loop), and `bun solid/main.ts --scene <file> --png|--expect` writes or compares the last frame. Four
   scenes are the record of four stored frames, byte for byte: the Widgets switch (`Tab, Tab, Space`, 33 frames), the
   List's selection (`Tab, ArrowDown ×12`, settle 90: 133 frames, "Room A3 — 13 of 30" at -148), the Sky after a click
   and eight notches down (settle 90: 103 frames, 78px down) and the Dialog's menu (`Tab, Tab, Enter`, 34 frames).
   `solid/scene.test.ts` replays the four in-process (0 pixels each), prints their steps, frames and ending state, and
   proves the record can lie: Space before Tab is 964 pixels / 2,892 bytes off, and the List's scene without its settle
   compares the twelfth ArrowDown's frame — selection 13, the reveal still at -33.97 — 15,445 pixels / 46,544 bytes off.
   The Sky's scene needs `settle 90`, not 60: the scrollbar's 0.6s hold and 0.15s fade leave a 60-frame frame 2,376
   pixels off the stored one. Not covered yet: the generated C page, the wasm in the browser and the board reading the
   same scenes (only the Solid host has the replayer); a scene recorded from a live window rather than written by hand;
   and what a scene cannot say — a drag's velocity, a window resize, a font or a device change, a page's
   `--count`/`--posts`/`--wide`, and a theme change mid-run.
5. **Command-stream goldens, not only pixels.** When a frame differs by 300 pixels the image does not say what changed;
   a JSON of `cmds` plus the a11y snapshot does (Rune keeps `golden/*-tree.json`). We already compare command arrays
   field by field in `examples/sensors/gen.c` and, before this, in a hand-written table in `browser/check.mjs` (its
   `dump-commands.c` is gone, see below); one `ui_dump_json` for every target, with the raster as the final gate, is a
   small step.
   **Done: `ui_dump_json`, five goldens, a path-aware differ** (2026-10-28). `ui_dump_json(path)` (`solid/native/ui.c`)
   writes the last frame as JSON: every command with the fields a draw reads (type, Clay's id and the page's id string
   behind it, box and z, then a text's bytes/colour/font/size/spacing/line height/alignment/wrap — the last two from the
   node's table, since Clay's command carries neither — a rectangle's colour and radii, a border's colour/radii/five
   widths, an image's path, a clip's axes, a custom's pointer) and then the renderer's tables that `hash_frame` folds in
   but no command carries (shadow offset/blur/colour, backdrop blur, gradient kind/angle/alpha/stops, group
   alpha/scale/translate/rotation — a neutral group left out, as the hash leaves it out — and the text weight).
   `solid/dump.ts` renders a page as `main.ts`'s headless path does (its size and `View` hooks, `--warm 30`'s 31 frames,
   the Sky's 41, the Dialog's `Tab,Tab,Enter` + 2) and never draws; `solid/src/dump.ts` adds `snapshot(root)` and writes
   one command a line with sorted keys and `%.9g` floats, so two processes write the same bytes. Measured: six pages —
   Sensors 10 commands / 0 a11y nodes, Widgets 59/28, the List's top 36/0, the Sky's Discover settled 35/4, the Dialog's
   menu two frames into its slide 22/7 (a group at alpha 233, scale 0.971, -1.48°, the menu's shadow at blur 3.45, its
   backdrop at 10, the Sky's three gradients), and the Text sheet 13/0 — `solid/dump.test.ts`, in `test.sh`. The differ names command and field:
   `FAIL sensors: command 2 (text "accel m/s²") colour 150/155/170/255 -> 160/165/180/255`. Mutations: the Sensors
   subtitle's ink `150 155 170 → 160 165 180` fails exactly that line (and command 4, "gyro °/s", on the same token);
   swapping two commands' emission order in the dump fails
   `command 2 (text "accel m/s²") id 13290005 -> 836677627 (that is command 3 in the golden: the order moved)`.
   **Done: one emitter, and the C page and the browser are held to the Solid goldens** (2026-10-29). The writer moved
   out of `ui.c` into `desktop/clay_dump.c` + `clay_dump.h` (Clay and libc only: no SDL, no ThorVG, no file I/O — it
   returns the bytes and each host writes them its own way), with `ClayDumpFrame` carrying the command array and what a host
   knows beside it: the size, scale and hash, the page's id strings (`names`, by Clay's hash), each node's id and the
   text's own two fields (`textAlign`/`textWrap`, per node, since a command carries neither), and the renderer's effect
   tables. `ui_dump_json` is the Solid host's adapter over it and writes the same bytes: the five goldens did not change.
   The desktop host takes `--dump out.json`, so the C page (`examples/sensors`) dumps its frame through the same emitter
   and `dump-check.ts` compares it with `solid/goldens/sensors.json` — the _same_ golden, not one beside the C page:
   measured first, the C page's 10 commands equal the Solid page's field by field, boxes included (same tree, same
   `styles.ts`, both laid out with ThorVG's metrics). The differ resolves a command's `element` by id (a C host keeps no
   id strings), drops the hash and the a11y snapshot (a C host has neither) and compares the rest byte for byte as
   `solid/src/format.ts` writes it. The browser: `browser/page.c` exports `dump()` (the wasm's frame through the same
   emitter) and `browser/check.mjs` compares it with the same golden, exact on every field but the boxes' 4 px tolerance
   for Canvas2D's advances; `browser/dump-commands.c` and its hand-written table are deleted. Mutations: a muted token
   `150 155 170 → 160 165 180` fails `FAIL sensors: command 2 (text "accel m/s²") colour 150/155/170/255 ->
160/165/180/255` (and commands 4 and 9, the same token), and the Units pill's width 200 → 210 fails the browser as
   `FAIL commands frame(0): command 7's box is 10.00px off the golden's`. `test.sh`: 86 `identical` lines (85 before).
   Not covered: the board still has no dump; a golden of a page's light theme (a variant is `capture(page, "light")`
   plus one file), of the browser's `use_g` frame (its two stored rasters are its gate) or of the C page's pressed look;
   a custom command's pointer (an address, kept out of the goldens) or a frame's hash (with an image it hashes the
   image's pointer; also kept out). Nothing here sees the pixels, glyph shaping, a shadow's raster or a gradient's
   dither: the raster stays the final gate.
6. **Done: text quality against an oracle** (2026-10-28). Rune built a CoreText oracle and an ink-weight + SSIM metric
   and found its text thin (0.1 pt of centred emboldening fixed most of it). We built the same instruments — a sheet page
   (`solid/app/Sheet.tsx`: the app's strings at 11..32 px), CoreText drawing the same lines at the same places
   (`solid/text-oracle.swift`, font smoothing off, subpixel positioning on) into a stored PNG, and the metric
   (`solid/src/textmetric.ts`: per-pixel coverage against the page's and the text's luminance, the line's ink, the best
   whole-pixel shift, and the standard SSIM over ink-carrying windows) — and the verdict is the opposite: **ThorVG's text
   already weighs what CoreText weighs**. Mean weight 1.008, and 1.013 over the eleven lines without the fallback one
   (0.995..1.044: every line within 2.7 % but the 11 px one, which is 4.4 % fat — a stem between pixels, spread by a
   hinting-free raster), every line at shift 0,0 and within 1 px of CoreText's extent.
   No correction: the renderer's dial (`ui_text_weight`, a second copy of the line half the weight either side, default 0) sweeps to 1.309 mean weight and SSIM 0.883 at 0.25, so an emboldening here is a regression, and the sweep is how
   that is known. The one real difference the SSIM caught is the **missing fallback font**: the ⅓ in "Wm ¼ ⅓ — “quotes”"
   is ThorVG's empty box (weight 0.958, SSIM 0.459) and CoreText falls back for it. `solid/text.test.ts` checks every
   line (no shift, weight 0.95..1.06, SSIM ≥ 0.95, extent within a pixel) against the stored oracle, asserts the
   fallback line's low SSIM on purpose, and proves the metric can see a 1 px move (SSIM 0.708) and more ink, so the
   check cannot pass vacuously.
   **Done: the other two references** (2026-10-28, same day). _Density 2_, the window's own path
   (`ui_density` retargets, ThorVG scales its root scene): the glyphs are rasterised at 2x, not a 1x raster enlarged —
   ink 4.006x the 1x line and mean weight **1.005** (1.001..1.018 a line, SSIM 0.967..0.998), closer to CoreText than
   1x; `frames/text-sheet-2x.png` and `frames/text-oracle-2x.png` are stored and the suite checks them. _Chrome's
   Canvas2D_, the web target's rasteriser (`solid/text-canvas.mjs` through Playwright): **0.729** of our ink
   (0.699..0.781 a line, SSIM 0.843..0.916, shift 0,0, extent within a pixel) — the browser is a third heavier, and its
   own frame agrees (`browser/expected.png`: 715.5 against the harness's 723.1 on the same 20 px line), so it is Chrome's
   canvas gamma, not our renderer: stored as `frames/text-canvas.png` and pinned in the test as a band, not matched.
   That leaves fonts other than Roboto-Regular (one face is vendored; a second face is a font feature) and the terminal
   and board, whose text is a cell grid.
7. **Done: the dev panel.** `bun solid/main.ts dev` (`solid/app/Dev.tsx`, 660x760) is the Widgets page in its own
   360px column with a 300px panel beside it, in the same frame: the page's **a11y tree** as indented rows
   (`role "name" [states] x,y w×h` — `a11y.ts`'s snapshot of the page's own subtree, bounds from `ui.bounds`, and `no
bounds` where the page drew no box; 28 rows for that page), the **box under the pointer** (the innermost box with an
   id and a role, `ui.over` down the tree, its name from the tree at the same role and bounds, and its `ui.bounds`;
   `nothing` over the page's background or over the panel) and the **frame's four phases** plus the mean and max of the
   last 30 frames and `ui.draws()`/`ui.presents()`. The panel reads all three every frame and prints them when they
   change: it is part of the frame, so a phase line reprinted every frame would change the hash every frame and the page
   could never rest, which is what its counters are there to show — so the numbers are the last frame that changed the
   page, and two runs of one frame are 13,661 pixels apart of 501,600 (the four stored frames are stored, not compared).
   `createDrawer(frame, stats)` writes the host's own `ui.draw()` into the frame's fourth phase. Measured (M2, one
   thread, `--bench 200`, five runs): the reading (flush + snapshot + the hover walk over ~95 boxes) **0.09 ms** a frame,
   the 28 rows **+0.02 ms** declare and **+0.008** layout, and **+5.4 ms** of draw on a frame that redraws the panel
   (ThorVG shapes every text command; the panel is 34 lines, ~3 µs a glyph); at rest **0 draws** of 200 and 0.20 ms a
   frame against the Widgets page's 0.06. The page's own entry is off (the Widgets page gets no motion hook). Frames:
   `dev.png`, `dev-hover.png`, `dev-light.png`, `dev-tree.png`. Check: `solid/dev.test.ts` — the 28 rows and their
   states, the switch's row and the ring after Tab, the hovered box (the tab, not its tablist), the four phases against
   the frame that changed the page, `0.00` ms of draw and a still `ui.draws()` over 20 idle frames, the light theme,
   reduced motion — and three mutations with their messages.
   **Done: `tune!`-style live values** (2026-10-29) — the panel's fourth section. The picked box's style numbers that the
   value channel can move are rows with their numbers: `width`/`height` (a stretch or fit axis reads the laid-out size,
   and a step pins the axis to a pixel), the padding's four sides, `gap`, `radius` (a corner a row where they differ),
   the background's and border's channels, a float's offsets/expand/`zIndex`, a shadow's blur, a gradient's alpha, and
   the group's `alpha`/`scale`/`translateX`/`translateY`/`rotate` — live even where a field only matters at layout,
   because the page re-declares every frame. Not rows: a text's colour (a text's own floats, reachable only through a
   text with an id) and the modes and enums of the 45 (`capture`, `clip`, the sizing type, an alignment, a float's
   attach). `Tab`/`Shift+Tab` walk the page then the panel's three stops (the tree, the hovered box, the values);
   `Up`/`Down` pick a row, `Left`/`Right` (or `-`/`+`) step it (1 a pixel, 4 a colour channel, 0.1 an alpha, 1 a degree),
   clamped to the field's range; `r` resets the row and `Shift+R` all of them — by _dropping_ the override, so the
   declare is the style's literal again and the page is byte-identical to before the edit; `*` marks a live value, `>`
   (and the accent) the cursor, and a list longer than 18 rows is a window with `4-21 of 21` in its footer (the panel
   cannot scroll: Clay squeezes a fitted column into its box, so its four sections have to fit the 760px). Measured: 120
   frames at rest, declare 0.050 ms and layout 0.033 ms with nothing overridden, 0.048/0.038 ms with five rows
   overridden (the noise; a write is one float, and `ui_open`'s 180-byte `memcpy` is per overridden element). Check:
   `solid/tune.test.ts` (the 17 rows of the switch, a radius's corner pixel, a width's a11y bounds, a colour's fill, the
   clamps, `r` and `Shift+R` byte for byte, the window, the cost) and four mutations with their messages.
   **Done: the pick and the session file** (2026-10-29). A press on the page (not on the panel) selects the innermost
   node under it — a box with a role and an id; a box without a role reports its nearest node ancestor, a node without
   an id is skipped — moves the tree's cursor to its row (`>`), pins the hovered-box line and switches the values to
   it; the pin holds when the pointer leaves, and `Escape` or a press on empty space clears it. A session is the
   overrides as data, `{ "values": [ { "id", "field", "value" } ] }` with the panel's row names: `--tune path` loads it
   before the first frame and `s` writes the current one to the same path (`dev-tune.json` by default). Loading fails
   with the entry and why on an unknown id, an unknown field or an out-of-range value; two entries loaded are the frame
   of the same two edits by hand, byte for byte, and `s`'s file loads back to it. Check: `solid/dev.test.ts` (the click
   on a tab and on the button, a pin that holds, Escape and empty space) and `solid/tune.test.ts` (the pinned rows and
   `r`, the two-entry replay, `s` and its load, the three messages), and two mutations: the pick taking the outermost
   box lands on the tablist, and the writer naming a field the loader does not know fails the load with its entry.
   Remaining here: no pointer on a row (no dragging a number, no colour picker), no multi-element session in the suite
   (the format carries an id, the tests hold one box), and no editing a style the page did not declare.
   Also later: style reload without a restart (our "reload on save"); and a static first frame shown
   by the window before Bun and the first layout are ready.

8. **Checked, not adopted: a monoline stroke font (Hershey, 2026-11-01).** The question came from Gorton (the engraving
   face at the top of the Manhattan list) and Hershey's straight-line vector fonts, which are the same idea with the
   data published: could text be strokes, and kilobytes, instead of a 168 KB TTF or a megabyte of atlas? The spike is
   `spike/hershey/` (`sh spike/hershey/run.sh` prints every number below): the sheet's rows at 14, 40 and 96 px on one
   software canvas and one page, drawn three ways — Hershey's `futural` strokes as one ThorVG shape a run (round cap and
   join, a stroke 7.8% of the size, its cap matched to Roboto's), the same strokes at Roboto's advances (the shapes
   without the metrics), and Roboto through the renderer's own text path — measured by `solid/src/textmetric.ts`
   against CoreText's oracle, plus 300 runs a frame and an A8 atlas of the same 96 glyphs.
   **Bytes: strokes win outright, and only there.** The `.jhf` parses to a **3,122-byte** table for 96 glyphs at every
   size (8,486 with the Cyrillic set), against `Roboto-Regular.ttf`'s **168,260** and an A8 atlas built with ThorVG:
   **12,544 + 77,056 + 373,504 = 463,104** bytes for 14, 40 and 96 px, plus a 4,032-byte index. 54x smaller than the TTF
   and 148x smaller than three atlas sizes.
   **Milliseconds: strokes lose everywhere.** 300 runs a frame, median of 5 runs (200/100/20 frames a run), page clear +
   scene build + draw + sync, on an 8-core M-series Mac at load average 2.9 (a run at 4.7 was within 3%): **16.6 vs
   8.8 ms** at 14 px (1.90x), **48.4 vs 39.2** at 40 (1.24x), **110.4 vs 84.8** at 96 (1.30x). The path and its fill
   alone are 0.6-1.6 ms of that, so it is ThorVG's stroke tessellation and not our path building — a cache of the glyph
   geometry would not pay, the stroke's own expansion is the cost.
   **How it reads: another typeface, not a cheap copy of this one.** Ink weight is 1.04-1.07 of CoreText's (a dial, not
   a fact), but the lines are 10-40% wider — Hershey's advances are not Roboto's — and even at Roboto's advances the
   SSIM is **0.64** at 14 px, **0.53** at 40, **0.36** at 96, against the 0.95 the suite holds the renderer to and
   0.708 for a one-pixel move. At 96 px it is visibly another face (a larger cap, a smaller x-height: 0.667 of the cap
   against Roboto's 0.743); at 12-14 px it is closer, and still not the platform's text. The TTF control in the same
   harness reproduces the oracle (weight 1.00-1.01, SSIM 0.97-0.99), so the harness is the renderer's own.
   **The rule.** Strokes are for a display-only size: a board whose ROM is the binding constraint, whose text is signage
   at one size, in a face drawn for that size. Not for UI text at 11-17 px, where the platform's raster is both faster
   (1.9x at 14 px) and the face the app is designed in. A hybrid is not worth it today: the 14 px atlas is 12.5 KB and
   the TTF serves every size, so the bytes saved only matter at 96 px — where the strokes cost 1.3x the raster and read
   0.36 SSIM. Checked, not adopted.

Not taking: Rust, Taffy, wgpu, Parley, AccessKit, their per-OS shells, split-process development, subsecond
hot-patching, and animation owned by a render thread (we have no render thread). Their verdict on GPU-evaluated
springs — keep it opt-in, CPU stays the default — is independent confirmation of our own WebGPU probe.

### TypeGPU: checked, not adopted (2026-10-23)

[TypeGPU](https://docs.swmansion.com/TypeGPU/) is Software Mansion's TypeScript toolkit for WebGPU: shaders in TS with
`'use gpu'`, typed buffers and layouts, `tgpu.resolve` to WGSL. [`@typegpu/gl`](https://docs.swmansion.com/TypeGPU/ecosystem/typegpu-gl/)
adds a WebGL 2 backend for a subset (vertex and fragment stages, uniforms, 2D textures; no vertex buffers, bind groups
or compute) and a GLSL generator.

- **Browser: the only target where it runs for us, and it does run.** The headless Chrome our checks use exposes
  `navigator.gpu` on a served `https` page — adapter, device and a `webgpu` canvas context, no flags. (`about:blank`,
  `data:` URLs and `chrome://gpu` report no `navigator.gpu`, so a probe must serve the page; `browser/check.mjs`
  already does.) A TypeGPU renderer over the same Clay command array is therefore testable headlessly. It would not be
  faster: the page is 0.08 ms a frame and the compositor is the cost. It is worth it only for what Canvas2D cannot do
  (backdrop blur, dithered gradients, glass) or as a TS prototype of a GPU renderer we would port.
- **Desktop: no.** Bun and Node have no `navigator.gpu`; a Deno subprocess or Dawn (`webgpu`) would put a second
  runtime or a large binary between the C host and the page, and ThorVG's own WebGPU canvas already measured slower
  than its CPU raster (0.69-1.06 vs 0.31-0.47 ms) before the compositor.
- **`@typegpu/gl`**: WebGL 2 is everywhere, but the subset has no buffers, bind groups or compute, so it is a
  full-screen-effects path, not a UI renderer.
- **Board and terminal**: no GPU at all.

Verdict: keep as the named option for a browser effects layer or a GPU-renderer prototype, with `browser/render.js`
(the same commands, WebGPU instead of Canvas2D) as the entry point. Not a dependency of anything today.

### nicegraf: the floor a GPU path starts from, and what it does not buy (2026-11-04)

[nicegraf](https://github.com/nicebyte/nicegraf) is a thin C abstraction over Vulkan/Metal/D3D12 — pipelines, resource
tables, command buffers — with no 2D renderer, no shapes and no text. It is the smallest thing a GPU path for this host
could stand on, so the question was: what does it cost to get a frame through it, and is that faster than ThorVG's CPU
raster? `native/spike/nicegraf/`: a shallow clone at `c7b2739` (nothing vendored; `run.sh` fetches it), the Metal
backend from `cmake` in **2-4 s**, and `quad.cpp` — 325 lines including the shaders as MSL source, the bench and a PNG
writer — drawing the Sensors frame's geometry as six quads (the fill, the pill, four 1px border strips) through one
pipeline, one vertex buffer, **one draw call**, into a 360x360 offscreen target, with the pixels copied back.

**It built, and what it needed.** The tree does not compile with Xcode 16's clang: `ngfi::fixed_array {ptr, len}` is
class-template argument deduction on an _alias_ template, which clang rejects ("argument deduction only allowed for
class templates"); spelling `fixed_array<char>` is the whole two-line patch, applied by `build.sh`. Two more things the
abstraction does not hide, both met on the way to the first pixel: an **offscreen-only context cannot begin a frame**
(`ngf_create_context` with a NULL swapchain makes the frame semaphore with capacity 0, so `ngf_begin_frame` blocks
forever — the spike never calls it and starts command buffers directly, which the Metal backend allows), and a shader
is **MSL text plus a `NGF_NATIVE_BINDING_MAP` comment**, because the backend parses its binding table out of a comment
(niceshade writes it; hand-written MSL must too). The first frame also came out as confetti because MSL's
`{float2, float4}` is 32 bytes, not 24: the layout rules are still yours. `run.sh` prints the table below, the smallest
of three back-to-back runs, Apple M2 / 8 cores, load average **4.4** (the same table at load 13 ran 5-45% higher, the
readback most of all).

| the 360x360 Sensors geometry (six quads)                                | ms a frame                        |
| ----------------------------------------------------------------------- | --------------------------------- |
| nicegraf/Metal, record + submit (the CPU side)                          | **0.037**                         |
| nicegraf/Metal, GPU throughput with no readback (300 frames, one wait)  | **0.045**                         |
| nicegraf/Metal, draw + wait (a round trip, still no readback)           | 0.126                             |
| the readback alone — `copyFromTexture`, wait, map                       | **0.087-0.127**                   |
| nicegraf/Metal, a frame that comes back to the CPU                      | **0.155-0.187**                   |
| ThorVG's CPU raster, the same six quads                                 | **0.019**                         |
| ThorVG's CPU raster, the real frame (10 commands: text, border, radius) | 0.304                             |
| 502 quads: GPU no readback / with readback / ThorVG CPU                 | 0.045 / 0.154-0.181 / 0.250-0.268 |

**The floor is 0.045 ms, and the readback is 0.09-0.13 of a 0.16-0.19 frame** (the readback is the noisiest line
here: two runs at the same load read 0.087 and 0.127). On this frame the CPU raster of the same shapes is
**8x faster than the GPU path that comes back to the CPU, and still 2.4x faster than the GPU path that keeps the frame
on the GPU** — the frame is a fill and a pill, and ThorVG's spans are cheaper than the submit. The GPU only pulls ahead
when the frame is many shapes: at 502 quads it is 6x faster than the CPU raster without a readback, **1.7x** with one.
That is the same wall the WebGPU probe hit (0.62 against 2.19 ms at 1080²), and it decides the thing for us: any target
that must show pixels through the CPU — this host's ThorVG buffer and PNG goldens, the browser's Canvas2D, the board —
pays the readback, and that is 30-40% of the 0.30 ms CPU frame before a single glyph is drawn.

**What a renderer on top of this would still owe** — all of it, since nicegraf draws triangles: text shaping and a
glyph atlas (the seven text commands are 70% of the Sensors frame's commands and most of its 0.30 ms), AA (edges here
are hard and the golden's are not), borders as even-odd rings and corners as radii (a real renderer tessellates the
path it is given, not four strips), gradients with our dither, shadows and backdrop blur (today ThorVG's scene effects,
`Effects` above), images, and a scissor stack for clipping. That work is the same for Vulkan and Metal and it is where
the months are, not in the 327 lines above.

**What it does not help, whatever the number:** the board (no GPU at all — 17.8 of its 22.8 ms is ThorVG's raster on the
S3's CPU), the browser (Canvas2D and WebGPU are not Metal; `@typegpu/gl` is the browser's version of this spike), and
the terminal (cells). A GPU path would be a _fifth_ raster for the one target that already has the fastest one.

Verdict: checked, not adopted; the abstraction is small and honest and the build is a coffee, but a GPU path starts at
0.045 ms of a frame the CPU draws in 0.019, needs the readback (0.09-0.13) wherever it must be seen, and owes every glyph,
edge and radius the CPU raster already has. **What would change it:** a window that owns a `CAMetalLayer` and presents
this pipeline's target directly (nicegraf's swapchain, no readback), on a page whose frames are hundreds of shapes and
little text — and a host whose text and AA path already exists on the GPU to be reused. Until then the CPU raster stays
the default and the number to beat is ThorVG's 0.30 ms full frame, not 0.045.

## Effects (2026-10-23)

The raster can do more than we ask of it. ThorVG 1.1.3 (the installed one) already ships scene effects and masks, and
we use neither: `tvg_scene_add_effect_gaussian_blur(scene, sigma, direction, quality)`, `..._drop_shadow(r,g,b,a,
angle, distance, sigma, quality)`, `..._motion_blur`, `..._fill`, `..._tint`, `..._tritone`, and `Paint::mask()` with
alpha, luma and their inverses. An effect is not a Clay declaration, so it cannot be a style field Clay lays out: it is
a renderer side table keyed by Clay's element id. The command stream already carries that id, so `ui_effect(id, kind,
params)` (called from JS, or printed by `header()` for the C targets; the shadow is its first call,
`ui_shadow(x, y, blur, rgba)`) plus a lookup at draw time is the whole API, and the style keeps only its own layout.

What each target can actually do — the "no" cells are as important as the rest:

| Effect                                                       | Desktop (ThorVG, CPU)                                                                         | Browser (WebGPU)  | Board (S3/P4)              | Terminal              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ----------------- | -------------------------- | --------------------- |
| Card, panel, menu shadow                                     | `drop_shadow` on a one-shape scene, drawn before the command                                  | one pass          | a pre-baked 9-slice sprite | none                  |
| Blur of the element itself (a menu, a card leaving in place) | `gaussian_blur` on its scene                                                                  | one pass          | none                       | none                  |
| Backdrop blur ("glass" over our own content)                 | our own buffer: copy the region under the panel, blur it, draw the panel over it              | dual Kawase pass  | none                       | none                  |
| Gradients                                                    | ThorVG linear and radial fills; a new style member, dithered                                  | Canvas 2D or WGSL | banded, dithered           | 256 colours, dithered |
| Group opacity                                                | **done**: a scene per element subtree, at the alpha of value field 46 (and a scale, field 47) | yes               | per-command alpha          | none                  |
| Tint and tritone (themes, disabled states)                   | ThorVG effect                                                                                 | a pass            | a palette swap             | the palette           |
| Grain, vignette                                              | one tiled 64x64 alpha PNG                                                                     | a pass            | the same tile              | none                  |

The order, each with its own frame and its own number:

1. **Done: shadow** (`css.shadow({ x, y, blur, color })`, 2026-10-23) — the largest felt difference for the smallest
   piece of work: the Dialog, the menu and the Sky cards float today on colour alone. The style's literal carries a
   sibling `shadow` key (`{ x, y, blur, color: { r, g, b, a } }`, defaults 0, 2, 12, `rgb(0 0 0 / 0.4)`); Clay 1.0's
   declaration has no such field, so `header()` prints nothing for it and the C pages are unchanged, `pack.ts`'s
   `variant()` pulls it out beside the image's path (the packed box stays 45 floats), `frame.ts` calls `ui_shadow(x, y,
blur, r, g, b, a)` before `ui_open`, and `ui.c` hangs it on the renderer's table by the element id's 32-bit hash
   (`Clay_ElementId.id`), cleared at `ui_begin` with the rest of the frame. The renderer draws it for the element's
   first command with that id — the command's box and corner radii, offset and filled with the shadow's colour, a scene
   with `tvg_scene_add_effect_gaussian_blur` (sigma `blur / 2`, CSS's reading of a blur radius, quality 80), then the
   command itself, so the element covers its middle: a `drop_shadow` of a scene of the element's own silhouette would be
   the same pixels, and the blur of one shape is the smaller machine. Measured, sigma 8 in a scene under a root at
   scale 2 blurs twice as many device pixels as at scale 1: the sigma is in the scene's own units, so the root's scale
   carries it (it is not multiplied by the pixel density). Frames: the Dialog page's panel (280x152, `{ y: 12, blur: 24,
color: "rgb(0 0 0 / 0.45)" }`) and its menu (150x133, `{ y: 6, blur: 14 }`), the three stored frames regenerated —
   23037 (dark), 23053 (light) and 8647 (menu) pixels differ from the frames without a shadow, every one outside the
   element's box except the four corner cut-outs of its radius, 11636 of the panel's below it against 4006 above (the
   12px offset), max channel 4/255 in the dark theme and 41/255 in the light one. Cost: the page at 360x480 is 1.07 ms
   a frame drawn without the panel's shadow and 1.93 ms with it (dark; light 1.00 → 1.76), so **about 0.8 ms a 280x152
   shadow at blur 24, quality 80** (Apple M2, one thread, `--bench 300`, `bun solid/main.ts dialog --keys Tab,Enter
--png out.png --bench 300`); quality 50 is 1.47 ms and 30 1.31 ms for 5/255 and 15/255 at the shadow's edge, and the
   sigma is not the lever (sigma = blur, CSS's blur radius unhalved, spreads the same alpha over 44px instead of 25 and
   reads washed out). Checks: `solid/dialog.test.ts` and the four frames. Open: spread and inner shadows (the box is the
   element's own), a cache between frames (each frame blurs the shadow again), the element must have an `id`, and no C
   target draws one (the header and the C pages are untouched; the browser's Canvas2D `shadowBlur` and a 9-slice sprite
   on the board are the obvious ports).
2. **Done: backdrop blur** (`css.backdrop({ blur })`, 2026-10-23) — glass over our own content, the second effect. The
   style's literal carries a sibling `backdrop: { blur }` key (`header()` prints nothing, the C pages are unchanged),
   `variant()` pulls it out beside the shadow, `frame.ts` calls `ui_backdrop(blur)` before `ui_open`, and `ui.c` hangs it
   on the renderer's table by the element id, cleared at `ui_begin`. The renderer cuts the frame: at the element's first
   rectangle command it draws pass 1 (`tvg_canvas_draw(d->canvas, d->clear)`), blurs the element's box in `pixels`, and
   starts a new scene for the rest, so the element's fill, text, border and focus ring are drawn over blurred pixels and
   stay crisp. The blur is CPU-side and box-only: three box passes each way, sigma `blur / 2` as the shadow's, pass
   radius `r = (sqrt(1 + 4σ²) - 1) / 2`, both ends clamped so nothing outside the box is read or written, alpha carried
   through (255 everywhere, so a per-channel average is right). The menu of the Dialog page is the first glass: 150x133,
   blur 10 (r = 5), a `rgb(23 27 32 / 0.72)` fill (light `rgb(255 255 255 / 0.78)`), overlapping its trigger by 20px so
   the border and the text stroke under it are the proof. Measured: 5273 pixels of `dialog-menu.png` differ from the same
   page with the style dropped, bbox 40,214-189,347 (the menu's own box), worst channel 81; a light menu frame was added
   (`dialog-menu-light.png`); `dialog-closed.png`/`-open`/`-light` stay byte-identical. The A/B in `dialog.test.ts` puts
   the pixel over the trigger's border at 21,25,30 against 40,44,49 in the dark theme and 228,228,229 against
   210,211,213 in the light one, the 1px step down that edge 1 against 23 and 20, zero pixels changed outside the box,
   and the label's ink box identical (55,258-91,269, 166 px): the panel is not blurred with the page.
   Cost: the frame's draw is 2.2 ms without the glass and 3.0 ms with it in back-to-back 300-frame runs (Apple M2, one
   thread, a loaded machine, so 0.7-1.0 ms for one 150x133 glass); the radius is not the lever (blur 18 is ~0.2 ms more
   than 10, and blur 0 with the cut still made is the same within the noise), the second `tvg_canvas_draw` and the target
   re-seed are; the blur's own passes are six of about 20k pixels each. Two ThorVG facts the cut rests on, both measured: its software canvas seeds its
   working surface from the target on its first draw only (a later draw replaces what its paints touch, so the renderer
   sets the same target again before pass 2) and `tvg_paint_rel` on a canvas-owned scene is a double free (the pass-1
   scene is removed, not released). Open: nested backdrops and a backdrop inside a scissor scene (one cut a frame; a
   second is not drawn), the WebGPU canvas (no target to blur before the whole draw, so no cut at all there), the
   browser/board/terminal (a dual Kawase pass, a pre-baked sprite, none), a panel whose own alpha varies per pixel (the
   fill is one Clay colour), and what a backdrop over an image or another float would need (the box is the first
   rectangle command; a picture or a float in the cut is drawn into pass 1 and blurred like everything else under it).
3. **Done: gradients** (`css.backgroundImage("linear-gradient(...)")`, 2026-10-23) — the third effect, and the first that is
   a fill rather than work on the buffer. The style's literal carries a sibling `backgroundImage: { kind: "linear", angle,
stops: [{ offset, color }] }` key; `header()` prints nothing for it (the C pages stay byte-identical), `variant()` pulls
   it out beside the shadow and the backdrop, `frame.ts` calls `ui.backgroundImage(kind, angle, count, stops)` before
   `ui_open`, and `ui.c` hangs it on the renderer's table by `Clay_ElementId.id`, cleared at `ui_begin`. The member is one
   string of CSS's own grammar: an optional direction (`<number>deg`, or `to top | to right | to bottom | to left`; 180deg
   by default) and two or more colour stops with an optional `<number>%` (a stop without one is spread as CSS spreads it);
   `radial-gradient`, `conic-gradient`, a repeating one, `url()`, colour hints, `px` stops, fewer than two stops and a
   backwards list are build errors. At the element's first **rectangle** command the renderer fills the box (its corner
   radii too) with ThorVG's linear gradient and does not draw the solid fill; a border is its own command and stays. The
   geometry is CSS's gradient line: direction `(sin θ, -cos θ)`, length `|w·sinθ| + |h·cosθ|`, the box's centre ± half of
   it, in Clay units (the root scene carries the scale). One gradient an element (16 a frame), 8 stops (a ninth is an
   error count), linear only. The page: the Sky cards (three of 336x190) are `180deg` from `rgb(27 32 38)` to
   `rgb(21 25 30)` in the dark theme and `255 255 255` to `240 243 246` in the light one, both top-lighter; the hover
   overrides the whole gradient with the hover tokens (`34 40 49` to `28 33 40`), since a state cannot unset one. The four
   stored frames were regenerated: of their pixels 187,898 (sky), 194,752 (science), 197,990 (light) and 198,952
   (scrolled) differ from the frames without a gradient, every one inside a card's box, worst channel 6, 6, 15 and 9/255.
   A card's column is 5/255 lighter at its top over 182px (14/255 in the light theme), a row varies by 0/255 across, and
   the page is one pixel beyond its edge. Cost: under 0.2 ms for the page's three cards (`--bench 1000`, the least-loaded
   of three back-to-back pairs: 3.735 against 3.631 ms a frame, light 3.625 against 3.458), i.e. what the solid fill of the
   same pixels costs, within the machine's noise. Checks: `test/clay.mjs` (the literal at 180deg and at `to right`, the
   even spreading, a themed stop, the offsets, the errors), `solid/sky.test.ts` (the vertical scan, the row, the edge, the
   hover, the light theme) and the four frames; a mutation of the angle to `90deg` fails the vertical scan. **Bands, and the
   dither (2026-10-25)**: before it, a card's column is 6 runs of one luminance of about 30px in the dark theme (18 colours,
   the longest 32px) and 12 of about 15px in the light one (30 colours, longest 17px). Now `Clay_ThorVG_RenderClayCommands`
   ends after its final `tvg_canvas_sync` with a 4x4 ordered (Bayer) dither of the buffer: ±1/255 on the RGB inside each
   gradient's box, the box mapped by the groups around it (a card's entry slides), cut to the canvas, to the clips (a
   scrolled feed) and one pixel inside the corners' arcs — and the same column is 182 runs with the longest 1px, in both
   themes (26 and 50 colours). The three variants, measured: ±1 with the mean kept (chosen), +1 on half the pixels (182 runs
   but the longest 2px in the light theme, whose 255 top clips a +1 step into a flat band, and a 0.5/255 lift on every
   card), and none (the numbers above). The seven Sky frames were regenerated: of 273,600 pixels, 203,712 differ (sky),
   213,217 (science), 203,712 (light), 213,217 (scrolled), 202,766 (entry), 203,712 (hover) and 200,445 (band) — every one
   inside a card's box or the feed's clip; the bar, the status line, the 8px gaps and the columns outside the cards are
   untouched. The text takes the step and stays legible: a body's 44 flat ink pixels are at most 1/255 off the ink token,
   and none of its 15 pixels at the ink mask's threshold is on the ink's edge, so the mask (and the text's box) is the
   undithered frame's; the same settled frame drawn twice is byte-identical. Cost 0.22 ms for the three cards (`--bench 400`,
   the least-loaded of three back-to-back pairs: 3.56 against 3.79 ms a frame; 0.07 ms a card over 191,520 pixels), the
   price of a second pass over 766 KB of the target. A per-row pre-scan was measured against it and dropped: a stippled
   boundary row inside a 30px plateau leaves the plateau flat, so the run count would not move. Open: radial and conic
   (ThorVG has both), a gradient under a translucent fill (one fill per element today), a gradient on text, a border or an
   image, and the browser, the board and the terminal — none of them dithers, and the board would band hardest (a dithered
   gradient there is PPA work on the P4). A dither the raster itself carried (ThorVG's gradient shader, or 10-bit channels)
   is the real fix; this one is a pass over pixels that are already drawn, in the one target that is a buffer.
4. **Tint and tritone** for themes and disabled states, worth it once a theme switch is animated.
5. The terminal gets none of the blurs; its equivalents are the palette and the attributes it already has.
6. The board gets only what `render.c` can do without a filter: dithered gradients, shadows as pre-baked sprites, PPA
   for scaling and blending on the P4. A full-screen blur does not fit a 22 ms frame.

Rules to keep from Rune's research: blur only what enters or leaves in place, never persistent text; dither every
gradient; soft masks on clips; an effect is opt-in with a plain fallback, and ships with a measured cost on both the
desktop frame and the board where it exists. The GPU raster does not buy the cost back (0.69-1.06 vs 0.31-0.47 ms,
before the compositor), so the first pass is the CPU raster.

## Mobile: iOS and Android (2026-10-23)

Status: not started. The first slice is **A: no JavaScript** — Clay, ThorVG, the C renderer and generated pages in a
platform shell, which is the board's shape on a phone. Solid on the device (a JS runtime and a bridge where
`bun:ffi` sits today) is a decision for later, and what decides it is the events debt of generated C.

What transfers, so the first slice is smaller than it looks:

- **Clay** is one C99 header with no dependencies, and **ThorVG** builds for both platforms; the software canvas means
  no GPU code of ours. `clay_renderer_thorvg.c` is plain C.
- **SDL3** is already the desktop's window, pointer and text input, and it has iOS and Android backends: touch, the
  system keyboard's committed text, the activity lifecycle. Our `Field` speaks the same text events.
- **The styles need no compiler on the device**: `cssints/clay` is a build-time literal and `header()` prints C.
- **The generated pages** are the board's path — `main/generated/*` in esp32 comes from `regen.sh` and `--text`, and the
  same generator runs for a mobile app.
- **`retarget(scale)`** already takes a pixel density, so 2x and 3x are a scale, not a rewrite.

What has to be built, in the order it hurts:

1. **Builds.** An Xcode project and a Gradle/NDK one, ThorVG per ABI (arm64 device, arm64 simulator, arm64-v8a,
   x86_64), the fonts in the bundle, SDL3's own mobile project shapes. Mechanical, and the slowest part in wall-clock
   time.
2. **Touch.** Down, move, up; a press that leaves its element; drag scrolling with decay and rubber band (`0.998/ms`,
   `0.55` from Rune's research); the drag takes the wheel's place.
3. **Text input.** The system keyboard and committed text come with SDL3 and the Field already handles them; marked
   text (composition), autocorrect, the caret's loupe and the selection handles do not, and are the largest single
   piece of work on a phone (Flutter's iOS text shim is ~3,400 lines).
4. **Insets.** Safe areas and the notch, the keyboard over the window, rotation: the root takes them as padding, and
   Clay lays out again.
5. **Accessibility.** VoiceOver and TalkBack cannot see a C raster. The tree we already snapshot (`solid/a11y.ts`, an
   element's `bounds`) has to be posted to `UIAccessibility` and to an `AccessibilityNodeProvider`; without it the app
   is not readable by a screen reader, which the stores require.
6. **Lifecycle and the platform bits.** Background and foreground, the first frame, memory pressure, Android's back
   button, haptics, the status bar, share and links.

The first slice, and what each step proves:

1. The generated Sensors page on the iOS simulator and the Android emulator through SDL3 and ThorVG at the device's
   pixel density, with a tap hit-tested on `ui_bounds` toggling `use_g`. Proves the toolchain, the raster and the DPI.
2. The Sky page with drag scrolling and a Field that raises the keyboard. Proves the interaction model.
3. The a11y bridge for those two pages. Proves that a store could ship it.
   Roughly 1-2 weeks for the first step, 2 more for the second, a week for the third.

The decision left open (B): **Solid on the device** — the desktop's architecture, a JS bundle and a JSI module where
`bun:ffi` is. It keeps one UI codebase and the whole interaction layer, at the cost of a runtime (no JIT on iOS:
Hermes or JSC in interpreter mode, so our 0.3 ms a frame becomes 1-3), the bridge, and a bundle build. What forks the
decision is generated C's **events debt**: if `page-to-c` learns to carry state and handlers, A is enough and B is never
needed; if it does not, B is the only route to a real app. Either is 3-6 weeks to the same demo.

Not doing: React Native, and Skia with it (tens of megabytes and a second raster; the board's 1.25 MB firmware rules
it out), our own text shaping (HarfBuzz/Parley is its own project; ThorVG's text is thin, and it is what we have), and
pixel-exact goldens across architectures: float differences are real, so a mobile lane needs the tolerance model of
Rune's research 14 — a bounded per-channel error with a recorded budget, not a hash.

## Highlighting: tree-sitter and Pierre (2026-11-02)

The terminal and the desktop will show code — a file pane, the docs' Files view — and neither target has a highlighter:
Shiki is a build-time Node tool with no C story.

**Native** takes [pierredotco/tree-sitter-languages](https://github.com/pierredotco/tree-sitter-languages) (MIT). Its
`tsx/queries/highlights.scm` is generated from a pinned grammar with every token classified (`queries/tokens.json` fails
on an unclassified one), the TS/TSX grammars are `zed-industries/tree-sitter-typescript@e2c53597d6a5`, and Dockerfile,
GraphQL, Make, Nix, Svelte, Vue and YAML vendor the grammar's C `src/`. Releases `v0.1.0`-`v0.2.0` are retracted; use
`v0.3.0` or later. We take the `.scm` queries and, for a language outside TS, the vendored C grammar. We do not take its
Go bindings: there is no Go in this repository.

**The TypeScript side has a packaged answer**: [`@pierre/highlights`](https://github.com/pierrecomputer/pierre/tree/main/packages/highlights)
(Apache-2.0, 333 kB wasm / 147 kB gzipped) is Pierre's lexer-in-WAT highlighter — 152 languages including `tsx`, `css`,
`bash` and `json`, 65 Shiki-catalog and 10 Pierre themes with `toCSS` for CSS variables, synchronous after import in
Node, browsers and workerd, and `codeToHtml` / `codeToTokens` / streaming / edits. It is the reader for the docs' Files
pane and example blocks, with a theme built from our tokens; Shiki stays only where twoslash needs types (the API
blocks), because a second pipeline there buys no hover.

**Done: native's code pane** (`terminal/code.c`, 2026-11-02). Tree-sitter's `lib/` (v0.25.10), the `tsx` grammar's
`parser.c` and the v0.3.0 query, all vendored; the query is compiled once, its four predicate spellings
(`#match?`/`#not-match?`/`#eq?` and their patterns) are evaluated in C, and the captures' byte ranges become cells: one
row a line, a tab the next multiple of 4, the innermost span winning and, where two captures cover the same text, a
fixed kind ranking (a variable naming a component is a tag, `css.cn` a function though it is also a property). The theme
is one dark palette, every colour 4.5:1 or better on the background. `terminal/test_code.c` is both the check and the
pane: `code file.tsx` prints the grid (a dump, or `--ansi`), and `check.sh` fails on a lost capture or a changed colour
through the stored fixture dump. Cost: 9.3 MB of vendored C, 6 s of `cc`, and about a second of start-up — the query
compiles once, `ts_query_new` over the 283k-line grammar; 1080 lines drawn on top cost nothing measurable. Not yet wired
into `demo`: a file pane in the live terminal needs a keys/scroll story first, and every `demo` build would carry the
grammar and that second.

**Done: the docs' code** (2026-11-03). `apps/docs/plugin/code.ts` is the second reader: `@pierre/highlights` 0.3.0 paints
the files of an example's Result/Code panel, the README blocks the type-check skips, and the landing page's samples;
Shiki renders only the ts blocks twoslash type-checks, which is where its hovers come from. One palette serves both: the
syntax colours are the default palette's (`src/palettes.ts`) at the accent's hue, each kind at a contrast floor (4.6:1
light, 7:1 dark) on the code's own paper (`src/code.ts` — fixed, because a palette's warm paper takes fixed colours below
the floor), and both highlighters emit the same `--shiki-light-*`/`--shiki-dark-*` custom properties, so the site's
existing mode switch paints either. `test/code.mjs` measures every pair and the paper against the palette. Cost: the 276 kB
wasm runs at build time only (it is not in the client), and the pages are unchanged in size. Bean: `cssints-sbce`.

## Not doing

- JS on a microcontroller. A GPU path on the ESP32-S3. One style for cells and pixels. A layout engine of our own.
