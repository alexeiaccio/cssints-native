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
| Browser (WASM)    | `cssints/clay`  | Clay (C→WASM)  | canvas 2D                      | none (the generated C) | a static frame and its `use_g` twin on a canvas |
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
| Browser  | none at run time yet: the same generated C as the ESP32, on a canvas      |
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
   about 0.4 ms a frame on an Apple-silicon Mac, 0.006 ms of it the JS walk and FFI, the rest ThorVG's raster. Left: reload on save,
   JSX types, the window checked by eye.
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
   **Done: scrolling** (`solid/app/List.tsx`, `bun solid/main.ts list`). Clay's own scroll containers, driven by the host:
   `ui_window_poll` adds every SDL wheel event to the frame (`ui_wheel`), `ui_begin` calls
   `Clay_UpdateScrollContainers(false, delta, dt)` before `Clay_BeginLayout` so the container under the pointer moves by
   the wheel and clamps itself to its content, and `ui_open` gives each clip element its offset back through
   `Clay_GetScrollOffset()` before the declaration is configured — the two calls Clay's debug view makes, so the layout
   shifts the rows and the renderer's scissor cuts what leaves the box. `cssints/clay` needed **no new member**:
   `css.overflow("hidden")` was already the declaration and `pack.ts`/`ui_open` already carried the two clip flags for the
   floats. The page is 30 rows in a 240px viewport with the readout and the footer as its siblings, so they stay put; the
   wheel scrolls, and one Tab stop takes Up/Down, PageUp/PageDown and Home/End, which move the selection (clamped to
   0..29) and `ui_scroll_to` the view the least it takes to show the moved row, measured from the row's and the
   viewport's `ui.bounds` of the last frame. Check: four stored frames (the top, 32 notches down
   with both edges cut, the selection moved to row 13 with the view scrolled to it, the light theme) and
   `solid/list.test.ts` (10px a notch and the rows moving by exactly that, both clamps, the clip's pixels above the
   viewport, the keyboard reveal and its bounds, the wheel not moving the selection, the header and footer unmoved, the
   ring's pixels, the wheel only under the pointer, the page fitting). Dropping the scroll-into-view fails eleven of them.
   Seen by eye: the four frames; the window started (`--frames 60`, exit 0) but its wheel and keys were not tried by hand
   (the screen is not visible to me). Left: horizontal scrolling, momentum, dragging the list with the pointer, a
   scrollbar (the page has a "n of 30" readout instead) and dragging one, and scrolling the page itself when the wheel is
   outside the viewport (Clay scrolls the container under the pointer only).
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
   (360x760): the wordmark and the three feeds as a headless tablist, a Clay clip element (664px of the window) that the
   wheel scrolls and that one Tab stop scrolls with Down/Up 40px, PageDown/PageUp a viewport and Home/End, and six cards
   from the app's own recorded fixtures — three Discover, three Science, News empty — with the author's name and
   `@handle · age` (`ago()` pinned to the fixture's capture moment, not the clock), a body (14px/20) that **wraps** (the
   first page where text does: the body is a stretch text inside the card's percent width, because a clip element lets
   its children grow past the viewport for their content), the media as the terminal's line, the TUI's sky palette, counts in words
   (`8 replies · 32 reposts · 310 likes`, `3.5K` from 3,500) because Roboto has no retweet or heart glyph, and a **drawn
   avatar** per post: `css.image` over the six committed 64x64 PNGs, so the Solid path's image support (`5cf6477`) now
   carries a real screen. A card hovers to the next panel tone, a click records the selection in a signal (the status
   line names it; there is no thread screen), and the bar and status line are the feed's siblings, so they do not move.
   Check: four stored frames (Discover, Science after a click on its tab, the light theme, Science 8 notches down) and
   `solid/sky.test.ts` (the avatars' pixels — the panel at the box's transparent corner, the author's hue in the disc,
   michaelwarburton `74 132 214` and erikstrub `126 108 200`, and the change with the tab; Erik's body four 20px lines
   and the media line that makes Titania's card 18px taller than Michael's; hover on a card and a tab; the wheel's 10px
   with the bar and status still; the keyboard's 40px a Down, a viewport a Page, and the clamps; the feed's ring pixels;
   the tabs switching the feed and News' empty centred muted line; the page fitting). Mutations: a bare 40x40 avatar box
   fails the disc asserts, and a `nowrap` body fails the wrap asserts and (the content then short) the scroll ones. Seen
   by eye: the four frames, zoomed — the bar's underline, the name and handle, the counts' `·`, the avatar discs. Left:
   no fetching or paging (three recorded posts per feed), no thread screen, no post images (a media line), no avatars
   beyond the six committed, no momentum or drag scrolling, the name and handle on two lines because the pair does not
   fit 312px (Clay has no ellipsis), and media lines that wrap at spaces only, so the Science link shows the embed's host
   instead of its 60-character URI (the app's own fallback when a link has no title).
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
   Emitted: `examples/sensors/page_generated.c` (the base), `page_generated_g.c` (use_g true) and
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
   Left: **events are dropped** (`Clay_OnHover`, keys, `onPress`): the C page is one static frame and cannot toggle
   `use_g`; a host that wants the other frame builds it. No run-time signals for the same reason. Not emitted: Dialog and
   Widgets' menu (floats; `Clay_ElementDeclaration.floating` would print, but no page proves it and the pointer capture
   is the host's), List (the viewport's offset is `Clay_GetScrollOffset()`, which `ui_open` asks Clay for each frame, not
   a declaration), Field (typing is SDL's text events) and Widgets itself (12 Tab stops and keys; a static frame is
   possible but unproven). The style contract has no image config, so images cannot be emitted; `clip.childOffset` is
   the host's too. `:focus` comes from a prop, not a signal, so only a page rendered with `focused` gets it. The fonts
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
   parent, the post with its full time and counts in words, the replies at their depth), and `terminal/profile.c`
   `apps/csssky`'s profile (the header, the Posts/Replies/Media tabs, those three fixtures) — the tui has no profile
   screen of its own, and that is the one honest gap in "port the app's screens". `terminal/focus.c` is the keyboard
   focus: stops in document order, Tab/Shift+Tab with the focus released at either end, a group as one stop with
   roving focus (an orientation, wrap and leave-at-the-edge), and `focus(id)` refusing a disabled stop — the semantics
   of `focus/src/focus.ts`, not shared code with it (the C page has no DOM to register into, so its stops are rebuilt
   when a feed or a tab changes the rows). `terminal/shell.c` is the screen stack (`enter` pushes, `esc` pops). The
   pages' rings are the focus state, not two ints. Check: `terminal/test_focus.c` (Tab order, the release, a roving
   group with and without wrap, leaving at an edge, memory, Home/End, a disabled stop), `terminal/expected-thread.txt`
   and `expected-profile.txt` (the two screens), `expected-sky-focus.txt` (the bar focused, its roving tab the active
   feed) and, in `test.sh`, the accent border's rows in the ANSI of focused/unfocused frames (a click and `ArrowDown`
   move the ring), the bar's wrap, the list leaving at its edge, a click on a control of each screen, and the scroll of
   the thread and of the profile. Breaking the group's wrap, or its leave, fails both a unit test and a page test.
   Left: **termbox2 is in** (`terminal/vendor/termbox2.h`, upstream master, MIT, sha256 `e019abb9`; `terminal/tb2.c`: truecolour or 256, keys and the mouse, checked through a pty in
   `test.sh`), and so are clicks; what a click cannot do is hover — termbox2 reports no motion events. Still left:
   `csssky-tui`'s own profile and notifications screens (it has neither; the profile here is the web app's), its data
   fetching and paging (every frame is one recorded fixture), images (a media line; counted and reported, not drawn),
   quote boxes, a body that wraps (one clipped row), the system theme of `src/system.ts` (the static dark/light ones
   are ported), the wheel and dragging, wide glyphs and emoji (a code point is one cell), floating overlays (untried),
   sub-cell borders and radii (a 1px and a 4px border are both one cell, a corner radius is a square corner),
   scrollback, and Solid on the terminal (the pages are C, as step 5's). The
   cell size is the cost: 8x16 makes a 38px pill 2.4 rows and a 200px pill 25 columns, so a page's pixel lengths
   have to be re-cut to land on cell boundaries, and text smaller or larger than a cell is the same cell.
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
   0.07-0.12 ms a frame in headless Chromium. No Solid and no ThorVG in the page yet.
   **Done: ESP32-P4 builds** (esp32 branch `p4-target`): `set-target esp32p4` + build, 471,920 B against the S3's 1,248,176 B
   from the same sources, 0 warnings, no Wi-Fi/BLE symbol in the image, the pages untouched behind `#if CONFIG_IDF_TARGET_*`.
   No panel: `display_init()` refuses without a board, and the path is `esp_lcd_new_dsi_bus` + the `esp_lcd_st77916` 2.0.2
   driver + `esp_driver_ppa` for the blit (no `esp_lcd_p4` component exists in IDF 5.5.3).

8. **Done: the browser.** `browser/page.c` is Clay plus **step 5's generated C, unchanged** (`page_generated.c` and
   `page_generated_g.c`), compiled by `zig cc -target wasm32-wasi` (a libc; there is no emscripten and no `wasm-ld` on
   this machine, and Apple's clang has no wasm target) into 104,375 bytes: 10 commands, 19 slots each, read out of the
   wasm's memory by `browser/render.js` — type, id, box, colour, corner radii, border widths, text bytes. The one import
   is `env.measure`: Clay's measure callback calls Canvas2D, so the layout is the font the canvas draws with (Roboto
   from `vendor/fonts`), not a table from another raster. The draw is Canvas2D: `roundRect` fills, borders as the
   even-odd ring inside the box as ThorVG draws them, `fillText` on the alphabetic baseline one ascent below Clay's line
   box, `clip()` for a scissor. `frame(0)`/`frame(1)` are the two generated frames; `w` or the button toggles them, which
   is the only state on this target (the generated C has no events). No framework and no build step in the page: a static
   `index.html` plus the wasm, 8,505 bytes of page.
   Check: `browser/check.mjs`, Chromium through Playwright, in `test.sh`. (a) the command array against the desktop's own
   for the same C (`browser/dump-commands.c`, Clay + SDL_ttf/Roboto, the frame of `expected-thorvg.png`): 10 commands,
   same order, ids, colours, strings and font sizes; the worst box is 3.09 px out, because Canvas2D does not hint and
   SDL_ttf sums integer advances, so a 20 px line is up to 3 px wider and a centred box moves by half of that. (b) the
   raster against two stored frames, as per-region (command box) mean colours plus each text line's ink box, not per
   pixel: against its own `browser/expected.png` every 8×8 block is within 3/255 (identical here); against ThorVG's frame
   6.4 % (base) and 10.0 % (`use_g`) of pixels differ, every region mean within 13.9/255, every text ink box within 4 px,
   and the frame's mean colour within 1.17/255 — i.e. the same colours and layout with glyphs and rounded corners
   drawn by another rasteriser. The browser's own frame is the regression guard, ThorVG's the design. Cost, headless
   Chromium on an M2: 0.08 ms a frame for the layout, the commands and one readback (100 frames), so the raster is the
   cost and it is the compositor's.
   Limits: no Solid in the page (a static generated frame, as step 5's); no events beyond the unit toggle, so it cannot
   drive the other states; no ThorVG (Canvas2D instead); no touch, no scrolling, images or floats (the page has none, and
   an image command is counted and not drawn); DPR is one scale factor and nothing else; a browser refuses to fetch the
   wasm from `file://`, so the page is served (`node browser/check.mjs --serve`). What would make it real: the host's JS
   in the browser (Solid over Clay in the page, as on the desktop, with the same input path) and the generated C kept as
   the no-JS path, which is what the board already is.


## Not doing

- JS on a microcontroller. A GPU path on the ESP32-S3. One style for cells and pixels. A layout engine of our own.
