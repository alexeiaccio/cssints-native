# The map: one UI, many targets

Styles in cssints, components in Solid 2 JSX, drawn on a desktop GPU, on an ESP32's CPU, in a browser and in a
terminal. This page says which layer does what on each target, what is proven, and the order of the work.

## Four layers

| Layer   | What it does                        | Where it runs                       |
| ------- | ----------------------------------- | ----------------------------------- |
| Author  | cssints styles, Solid JSX, state    | the editor (types catch errors)     |
| Compile | a style to a JS literal or to C     | the build (the cssints Vite plugin) |
| Layout  | boxes from styles and content       | the target: Clay                    |
| Raster  | pixels from boxes                   | the target: GPU or CPU              |

The rule (esp32 bean esp32-8j6y): **what can be computed at build time is computed at build time.** A style is data;
it needs no runtime on the device.

## Targets

| Target            | Styles          | Layout         | Raster                         | JS at run time | Status                        |
| ----------------- | --------------- | -------------- | ------------------------------ | -------------- | ----------------------------- |
| Desktop (macOS)   | `cssints/clay`  | Clay           | Clay's SDL3 renderer (GPU)     | optional (Bun) | a page in a window            |
| ESP32-S3          | `cssints/clay`  | Clay           | esp32's `render.c`, CPU bands  | none           | one element proven on board   |
| Browser (WASM)    | `cssints/clay`  | Clay (C→WASM)  | canvas                         | the page       | exists in esp32 storybook     |
| ESP32-P4          | `cssints/clay`  | Clay           | CPU + PPA (2D DMA)             | none           | later, needs a board          |
| Terminal          | `cssints/clay`  | Clay (cells)   | Clay's `termbox2` renderer     | optional (Bun) | after desktop; replaces `cssints/tui` |

Facts behind it:

- Clay ships renderers: `SDL3`, `SDL2`, `GLES3`, `sokol`, `raylib`, `cairo`, `web`, `win32_gdi`, `terminal`,
  `termbox2` (checked 2026-10-19). SDL3 3.4.14 is installed here.
- The ESP32-S3 has no GPU: raster is 17.8 ms of a 22.8 ms frame, layout 3.3 ms (board log, 2026-10-19).
- esp32's `ui.c` and `render.c` are plain C with no ESP-IDF; `host/test.c` already runs them on a Mac.

## Why desktop first

- It is where the framework has to grow: windows, input, text shaping, a GPU raster, live reload, Solid. The board
  only needs what the desktop already proved, compiled to C.
- The loop is seconds, not a flash. Every later target is checked against desktop frames.
- The board is proven at the one point that was risky (generated C equals hand-written C, on the device). It does
  not block anything, so it waits.

Other targets **later, not in parallel**: each one is a renderer choice under the same layout, so doing them after
the desktop costs a renderer, not a redesign. One exception runs alongside at no cost: `test.sh` keeps checking the
generated C against esp32's `clay.h`, so the board path cannot rot.

## The terminal

A Clay target like the others: Clay's numbers have no unit, so a measure function that returns one per character
lays out in cells, and Clay's `termbox2` renderer draws them. Focus, text input and the caret are built once in the
framework for the desktop and reused here; the system theme of `@cssints/tui/system` is renderer-neutral and comes
along.

It replaces `cssints/tui` and its OpenTUI and bomb.sh adapters, but not before it can carry what they carry today:
apps/csssky-tui and the docs' `/tui` page. Then `cssints/tui` is deprecated, csssky-tui moves over, and the old
subpath is removed in a breaking release with a migration. Lengths stay per target: a style in cells is not a style
in pixels, so a terminal page has its own styles under the same member names.

## Where Solid runs

| Target   | Solid                                                                     |
| -------- | ------------------------------------------------------------------------- |
| Desktop  | Solid 2 universal renderer building Clay's tree each frame (Bun FFI)      |
| ESP32    | none at run time: JSX evaluated at build time to C, state in C            |
| Terminal | the desktop's universal renderer over Clay, cells for pixels              |

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
   ThorVG built with them; then the ESP32-S3: ThorVG SW against `render.c`'s 17.8 ms, measured on the board.

3. **Done: states, tokens, fonts in `cssints/clay`.** `css.hover`/`focus`/`active` print as whole declarations of
   their own (`units_active`); `createTokens` and `createGlobalTheme(tokens, "light", ...)` print every style again
   per theme (`units_light`, `units_active_light`, `title_text_light`), so a page switches at run time by a suffix;
   `fonts("Roboto")` sets `fontId` and prints the font order as an enum. `examples/sensors`: colours as tokens, the
   the pill as `css.hover` and `css.active` (page.c picks `units_hover` over it, `units_active` when held), `THEME=light` for the light theme.
   The pressed look lifts the surface instead of the firmware's `ACCENT_DOWN` orange, which left the ink at 1.28:1; the
   ink on the base, hover and pressed fills is asserted at 4.5:1 and up in `solid/test.ts` (dark 15.8/10.3/7.9, light
   15.8/14.4/12.6). The firmware still draws `ACCENT_DOWN` and needs the same change.
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
   about 0.4 ms a frame on an Apple-silicon Mac, 0.006 ms of it the JS walk and FFI, the rest ThorVG's raster. Left: reload on save,
   text input, JSX types, the window checked by eye.
   **Headless widgets** (`headless/`, between Solid and JSX to C). The first widgets of effects-of-atmosphere's
   `@eoa/headless` (button, switch, checkbox, disclosure, radio, tabs, toolbar, slider) with no DOM: Solid 2 signals for state and, instead of aria-*
   attributes, parts of plain fields (`id`, `role`, `checked`, `selected`, `expanded`, `controls`, `tabIndex`, `hidden`, `disabled`, `focused`, `valueNow`)
   with handlers (`press()`, `key(name)`, `focus()`, `blur()`) that a Clay renderer and an accessibility tree both read. Radio, tabs and toolbar are groups of the focus manager
   (`focus/`) on one page: roving focus inside, Tab between them. The slider is one entry.
   Check: the ported APG scenarios and a seeded random walk, replayed on the parts and on the generated Quint model,
   must agree (`bun test` in `headless/`, in `test.sh`); dropping a controlled request's callback fails 34 tests. Left:
   the menu and menu button (the toolbar's menu item), overlays, text input.
   **Done: the Widgets page** (`solid/app/Widgets.tsx`, `bun solid/main.ts widgets`): the headless widgets and the focus
   manager wired to one live page. SDL key events reach JS through a queue in the FFI; a key goes to the focus manager
   (Tab, Shift+Tab, arrows), then the focused part (Space fires on key up), then the page; a press focuses a part as a
   browser does and a press on empty space blurs; `:focus` is a style state like `:active` (a 2px ring, laid over the
   pressed look). Check: six stored frames (initial, Tab Tab, switch on, mixed, disclosure open, light) and
   `solid/widgets.test.ts` (Tab order, key timing, clicks and focus, the disabled box). Seen by eye: the frames; the live window
   was started, its keys and mouse not tried by hand.
5. **JSX to C.** The same component evaluated at build time to C calls, for targets with no JS. Check: its render
   commands equal step 4's for the same state.
6. **Terminal.** Clay in cells, `termbox2` renderer, the desktop's focus and input; csssky-tui ported. Check:
   csssky-tui's screen tests on the new renderer. Then deprecate `cssints/tui` (in cssints).
7. **Back to the board.** esp32's `ui.c` reads generated `styles.h` and C from step 5; then the browser (WASM) and the
   ESP32-P4. Checked by hand in the live window (2026-10-19): Tab order and ring, Space on release, the switch, Select all and mixed, Details, click focus, `t`.


## Not doing

- JS on a microcontroller. A GPU path on the ESP32-S3. One style for cells and pixels. A layout engine of our own.
