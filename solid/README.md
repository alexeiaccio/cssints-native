# Solid 2 on the desktop

Step 4 of [the map](../docs/map.md): a Solid 2 universal renderer that keeps a JS tree, and each frame declares that
tree to Clay through `bun:ffi`. Clay is immediate mode, so Solid only owns the tree and the state; layout and the
ThorVG software raster are C.

```
solid-js 2.0.0-rc.13, @solidjs/universal 2.0.0-rc.13 (createRenderer), @solidjs/compiler 2.0.0-rc.13
(native Oxc: generate "universal", moduleName src/renderer.ts), Bun 1.3.1, bun:ffi
```

## Run

```sh
sh solid/native/build.sh                         # build/solid/libui.dylib (brew sdl3 sdl3_image thorvg)
bun solid/main.ts                                # the window: the mouse is the pointer, `t` flips the theme
bun solid/main.ts widgets                        # the Widgets page (360x760): Tab, Shift+Tab, arrows, Space, Enter, and on the
                                                 # toolbar's Size item Down/Up/Enter open the size menu; the mouse (below)
bun solid/main.ts dialog                         # the Dialog page (360x480): Enter opens the settings dialog, Tab cycles it,
                                                 # Escape closes it; Tab to the menu, Enter/Down open it, arrows pick
bun solid/main.ts form                           # the Text field page (360x450): Tab to the field and type, Shift+arrows
                                                 # select, Enter submits, Escape blurs, Cmd/Ctrl+C/X/V copy, cut, paste
bun solid/main.ts list                           # the List page (360x400): the wheel scrolls Clay's own container under
                                                 # the pointer, Tab then Up/Down, PageUp/PageDown, Home/End move the
                                                 # selection and scroll it into view
bun solid/main.ts sky                            # the Sky page (360x760): csssky's feed, the tabs switch the three
                                                 # feeds, Tab reaches the feed and Up/Down, PageUp/PageDown, Home/End
                                                 # scroll it (the wheel scrolls it under the pointer); a click on a card
                                                 # opens its thread (a second screen: Back/Escape/a tab return to the feed)
bun solid/main.ts widgets --warm 30 --keys Tab,Tab,Space --expect solid/frames/widgets-switch-on.png   # scripted keys, then the frame
bun solid/main.ts dialog --keys Tab,Enter --expect solid/frames/dialog-open.png             # keyboard, headless
bun solid/main.ts form --keys Tab,Tab,text:Ada --expect solid/frames/field-typed.png        # typed text, not a key
bun solid/main.ts list --warm 30 --wheel 32 --expect solid/frames/list-wheel.png   # headless: the pointer onto the list, 32 notches down
bun solid/main.ts list --settle 3 --png out.png       # headless: four frames into the page's entry (frames/list-entry.png)
bun solid/main.ts sky --warm 40 --drag-feed 180,300,-2,-2,-2,-2,-2 --settle 60 --png out.png   # headless: a drag on the feed, then its fling
bun solid/main.ts sky --click 180 32 --wheel 8 --wheel-over sky-feed --png out.png   # headless: Science, its feed 8 notches down
bun solid/main.ts notify                                          # the Sky page started on its notifications screen (the feed's `n` does the same)
bun solid/main.ts sky --settle 40 --move 180 300 3 --png out.png          # headless: a hover, three frames into its fade, at a page at rest
bun solid/main.ts sky --warm 40 --wheel 4 --wheel-over sky-status --png out.png   # headless: rest first, then four notches past the end (the band)
bun solid/main.ts widgets --drag 0.25 0.75 --png out.png                 # headless: press the slider's rail at a quarter, hold, move to three quarters
bun solid/main.ts dialog --reduced-motion --keys Tab,Enter --png out.png # no travel, no waiting (also REDUCED_MOTION=1)
bun solid/main.ts --scene solid/scenes/list-select.json --expect solid/frames/list-select.png  # a scene: typed events with times, replayed
bun solid/main.ts --scene solid/scenes/list-select.json --png out.png   # ... its last frame, headless (native/README.md, "A scene as a file")
bun solid/main.ts --warm 30 --expect examples/sensors/expected-thorvg.png          # one frame against a stored PNG
bun solid/main.ts --warm 30 --click 180 250 --expect examples/sensors/expected-thorvg-g.png   # host.c's scripted click
THEME=light bun solid/main.ts --warm 30 --expect examples/sensors/expected-thorvg-light.png
bun solid/main.ts sheet --density 2 --png out.png   # the text sheet at the window's pixel density (880x1128)
bun solid/text-oracle.ts                          # the sheet's ink weight and SSIM against CoreText; --density 2, --canvas, --update
bun solid/main.ts --png out.png --bench 1000     # ms a frame by phase
bun solid/main.ts sky --settle 60 --idle 600     # the page at rest: 0 draws of 600, and the ms the tick takes
sh solid/test.sh                                 # all of it; `bun run test` calls it last
bun solid/metamorphic.test.ts                     # the relations with no stored frame: a wrapper, a move, wrap, twice
bun solid/watch.ts sky                           # the dev loop: the page in a child, restarted when a save changed it (below)
```

`--expect` compares the frame with a stored PNG pixel for pixel, and a difference says **where**: `59 pixels differ in a
7x11 box at 101,98`. The count is `ui_diff_png`'s (C, at the frame's own scale); the box is `solid/src/diff.ts`'s
`diffImages`, read back from the two PNGs only on a failure, and the C host's own `differ` computes both, so the two hosts
print the same sentence. The helper came from gpucanvas's `diffImages` (MIT, berkantay) — the same question, "what moved,
and where"; its third field, the diff image, stayed behind because this host has no PNG encoder of its own.
`bun solid/diff.test.ts` holds the rule: a planted patch, the edges, another size, alpha, and the Widgets page's switch off
against on — **2220 pixels in a 280x32 box at 40,117**.

### The dev loop

`bun solid/watch.ts <page>` (from `native/`) runs `bun solid/main.ts <page>` in a child, watches the page's and the
engine's inputs, and restarts the page when a save changed one: a `.c`/`.h`/`.sh` save under `solid/native/` (or a
`vendor/clay/` header) rebuilds `build/solid/libui.dylib` first, a `packages/cssints/src` save builds the engine, and a
`.ts`/`.tsx` save needs nothing but the restart. The flags pass through (`--frames`, `--png`, `--warm`, `--bench`); a
headless run is still one shot, so the suite keeps calling `bun solid/main.ts`. `--hold` stays up for a headless save
loop. The old window is kept until the new process has a window of its own, so a save that fails to compile leaves the
last good page on screen and prints the compiler's error. There is no reload in place: the page's modules are read once
per process and a `.c` save is a new `dlopen`, so the restart is the loop's unit — what it watches, the measured ms and
the terminal's host are in `native/README.md`'s "The desktop's dev loop". The check is `solid/watch-check.mjs`, on a
temp copy of the tree, in `solid/test.sh`.

## The terminal host (the second page)

`terminal/solid.ts` is the desktop loop's shape over the terminal's cells (`solid/native/term.c`, the same declaration
surface as `ui.c`, drawn by `terminal/cells.c`/`render.c`/`measure.c`/termbox2): `createInput()`, the page's `Motion`
hook, `flush()`, the tree walked in order, the value channel for the cell re-cut, Clay's layout and the cells. Two pages
run there, both **unmodified**: Sensors and Sky.

```sh
sh solid/native/build.sh                          # libterm.dylib beside libui.dylib
bun terminal/solid.ts --page sky --dump out.txt   # the feed, one frame (80x20 by default)
bun terminal/solid.ts --page sky --keys Tab,Tab,ArrowDown --settle 40 --offset --dump out.txt
bun terminal/solid.ts --page sky --keys Tab,Tab,Enter --settle 3 --dump out.txt   # the thread, opened by Enter
bun terminal/solid.ts --page sky --click 20,2 --settle 5 --dump out.txt           # the profile (the author's row)
bun terminal/solid.ts --page notify --keys Enter --settle 3 --dump out.txt         # the notifications, a row's thread
bun terminal/solid.ts --page sky --bench 50       # the frame's ms and its cells/commands
sh terminal/test.sh                               # the stored frames and the C comparisons
```

`Sky.tsx` takes the props the desktop gives it — `input` (the headless parts), `motion` (the page puts its wheel, its
pointer and its tick there), `theme`/`setTheme` — and two data ones: `pages` and `load`. `pages` is the step's: the
app's `homeScreen` at a cursor, answered by `terminal/data.ts` from apps/csssky's **recordings** (Discover's two pages,
Science's one, an empty page for News and for the end), so the feed's first page comes from the fixtures, the next is
asked at the feed's end, and the loading/end/error states are the page's status line. `load` is settled by the host one
frame after a screen mounts with the recorded thread (apps/csssky's `thread.json` through the page's own `screenOf`), so
a card's click draws the loading row and then the app's rows; the profile needs nothing handed to it (`app/profile.ts`
reads the recordings itself), and neither do the notifications (`app/notify.ts`'s five rows are the app's recordings
hand-carried — the app has no notifications screen or fixture, which is why `terminal/data.ts` has no
`listNotifications`).
The thread, the profile and the notifications are the page's **screens**, not entries of their own (`Sky.tsx` mounts
the thread as a root float and calls `Profile.tsx`'s `createProfile` and `Notify.tsx`'s `createNotify` in its own tree),
so `--page notify` is the sky page with its own `screen` prop, not a page: Enter on the feed presses the first card's
own onClick (the page's cards are not Tab stops), a click on a card's author row opens the profile, `n` opens the
notifications, Escape is the page's back. The host re-cuts the lengths a cell
cannot take as pixels through the value channel — the bar 1 row, the status line 1 row, a tab no padding and a cell after
its label, a card one cell of side padding with no vertical padding or gap — and skips the avatar image (no glyph; its
40x40 box would be three rows of nothing the C page does not draw). The feed's own 12px padding and 8px gap stay the
page's: its scroll arithmetic adds the same lengths, and in cells the 12px is the card's gutter and the 8px is the empty
row the C page draws as a separator. The tablist's focus is the C bar's accent fill (a 2px underline on a one-row tab is
the label's row), the feed's focus is its own ring token as a cell of box characters. Each screen is the feed's re-cut: the
float one row down (the host's bar is one row) and the rows under it, a one-row head whose Back keeps its word (a 1px
border is drawn after the text in a cell, so it is dropped), and the profile's drawn disc two rows and its tabs the
bar's. The binding gained four things for the feed: the clip offset read after the element is open,
`term_bounds`/`term_scroll_offset/to/put`, float declarations (Clay places them over the flow: the feed's thumb and the
screens), and a text line height forced to the cell's; the re-cut is written by the walk just before an element opens, so
a frame writes a value only for the elements it declares (the table is 256).

The C screens (`terminal/sky.c`, `thread.c`, `profile.c`, `notify.c`) are **not** reproducible cell for cell, and
`terminal/test.sh` says so with numbers: the feed 1475 of 1600 cells differ at rest (the recording's page 1), 1399 after
the tab switch, 684 after the scroll; the thread 1957 of 2080 at 80x26; the profile 1837 of 2080; the notifications 1564
at rest and 1910 after `Tab,Tab`; no row identical (the worst rows are the C card's top border, 80/80, the C profile's
banner band, 80/80, and the notifications' card borders and footer, 80/80) — the C card has a hand-cut border, its name
and meta share a row, its body is clipped, its counts are glyphs and its footer the key hints, and the C profile has a
banner band, an accent-pill tab and the app's reason lines; the notifications' C page names the screen in its bar and
draws a separator row at rest. The frames are 0.08-0.17 ms for the feed (34-36 commands over 1600 cells), 0.13-0.25 ms
for the thread and the profile (66-75 commands over 2080, the feed's cards declared under the float) and 0.12-0.16 ms for
the notifications (70 commands over 2080), so Solid on a terminal is viable. **All four** of the Sky page's screens are the
page's own now (the feed, the thread, the profile and the notifications — the last one's rows are the app's recordings
hand-carried, `app/notify.ts`, because the app has no notifications screen or fixture). The full account, with what a cell
cannot carry, is `native/README.md`'s "Solid on the terminal".

**The theme's third value.** `theme` is `"light"`, the page's default (undefined) — or `"system"`: `--system-theme`
(`THEME=system`) asks the terminal at startup and on `s` (`terminal/tb2.c`'s `term_tb2_ask` over `/dev/tty` with
`@cssints/tui/system`'s `QUERY`, a 120 ms timeout and a 15 ms quiet gap), parses the answer with the same package's
`scan` and solves the page's nine tokens with its `createSystemTheme` (`terminal/theme.ts`); the compiled styles are
repainted by value, so a warm terminal and a cool one are two different pages (the pty check's `#f0e0d0` page, its
`#0060d0` accent). A terminal that does not answer keeps the dark theme and the host says so on stderr; the Sensors page
and the C pages keep their static light/dark. `pack.ts` is untouched: `solid.ts`'s `skin` picks `repaint` for the system
theme and `variant` otherwise, and the re-cut's two colour writes go through it as well.

## Layout

```
native/ui.c        Clay + desktop/clay_renderer_thorvg.c + SDL3 window behind flat C functions (libui.dylib)
src/renderer.ts    createRenderer: El (tag, props, children) and Txt nodes; <box id style onClick>, <text style>
src/pack.ts        a ClayShape + theme + state -> Float32Array, once per variant
src/motion.ts      the motion model: tracks (spatial/effect), decay, rubber, presence, reduced motion, the value channel
src/entry.ts       the page's frame hook (Motion: onWheel, onPointer, tick) and its first-mount entry
src/frame.ts       one frame: pointer in, events, flush(), the tree declared, layout, draw
src/ffi.ts         bun:ffi bindings
plugin.ts          Bun plugin: JSX through @solidjs/compiler, `styles.ts` and a page's own styles through cssints, solid-js client build
compile-styles.ts  Node child of the plugin: Vite + cssints, prints a style module as JS
compile.tsx.ts     Node child of a `.tsx` whose styles live in it: Solid's JSX first, then cssints on the JS
stub-bun.mjs       `bun:ffi` for that child: cssints runs the page to read its tokens, and the dylib has no meaning in Node
src/input.ts       SDL keys to names, and where a key goes: an open modal, the focus manager, the focused part, the page
src/scene.ts       a scene file: the schema, its validation (a bad step says its index and why), the replay into the page's
                   own frame loop (one frame a step at 1/60s), and `main.ts --scene`'s `--png`/`--expect`
a11y.ts            the accessibility tree of a rendered page: snapshot(root) -> { role, name, states, bounds, children }, and a11y(part), the props a page spreads to make a box the part's box
app/Sensors.tsx    the Sensors page; styles are examples/sensors/styles.ts, the same file the C page's styles.h comes from
app/Widgets.tsx    the Widgets page: headless button, switch, checkboxes, disclosure, radio, tabs, slider, toolbar, settings tree, and its styles, in the same file
app/Dialog.tsx     the Dialog page: a modal dialog on a backdrop (both Clay root floats) and a menu floated off its trigger
app/Field.tsx      the Text field page: the headless text field, its caret and selection drawn as runs, and its styles
app/List.tsx       the List page: thirty rows in a viewport Clay clips and scrolls, the wheel and the keys, and its styles
app/Sky.tsx        the Sky page: csssky's feed in a phone-sized window, the tablist switching it, drawn avatars, wrapped
                   bodies, and the thread screen a card opens (the replies at their depths, the "Show N more" row)
app/Profile.tsx    the Sky page's third screen: a card's author opens the recorded profile (the disc, name, handle, bio and
                   counts, the app's Posts/Replies/Media tabs and their lists on the page's own machine)
app/profile.ts     the profile's data (no cssints, no Solid): the app's recorded head and three author feeds mapped into the
                   page's records, read at run time from apps/csssky/test/fixtures/
app/Notify.tsx     the page's fourth screen: the notifications (`n` on the feed), the five rows in document order with the
                   page's card, the ring, the arrows/Tab and a row's post opening the page's own thread
app/notify.ts      the notifications' data: the app's five verbs over the recordings' actors, posts and times (a JSON module
                   each of home-discover-1, home-science-1 and thread.json), the one screen the app has no fixture for
app/Sheet.tsx      the text sheet: the app's strings at eight sizes, for the CoreText oracle and the ink-weight metric
frames/            the pages' stored frames (the Sensors page's are in examples/sensors), and the sheet at 1x and 2x with
                   its two references: text-oracle.png and text-oracle-2x.png (CoreText), text-canvas.png (Canvas2D)
scenes/            the record of four stored frames: widgets-switch-on, list-select, sky-scrolled, dialog-menu — each a
                   page's typed events with times, replayed by scene.test.ts (and by main.ts --scene)
main.ts            the host (window and headless)
test.ts, widgets.test.ts, dialog.test.ts, field.test.ts, list.test.ts, sky.test.ts, thread.test.ts, profile.test.ts,
notify.test.ts, text.test.ts, scene.test.ts      the checks the stored frames cannot make
test.ts, widgets.test.ts, dialog.test.ts, field.test.ts, a11y.test.ts   the checks the stored frames cannot make
```

A scene is shared with the C host too: `examples/sensors/scenes/sensors-click.json` (a click on the Sensors page's pill)
is replayed by `bun solid/main.ts --scene …` and by the generated C page's host
(`./build/sensors/app-generated --scene …`; `desktop/scene.c` is the parser, strict on purpose, and its limits are in
`native/README.md`, "The generated page's events: a state machine"), both landing on
`examples/sensors/expected-thorvg-g.png`.

**Styles live where the markup does.** A page may declare its tokens and styles in its own `.tsx`
(`import * as css from "cssints/clay" with { type: "cssints" }`) — `app/Widgets.tsx` does. The child spawns only when the
source mentions cssints, costs about 0.9 s once per page at load (the same as a `styles.ts` module: it is Node and
cssints' evaluation, not the extra stage), and reports a cssints error at the line the user wrote. A styles module
still has its place when the C side generates from the same file (`examples/sensors/styles.ts` feeds `styles.h`).
`app/inline-demo`/`InlineDemo.tsx` and `InlineDemoSplit.tsx` are the same page both ways, and `inline.test.ts` holds
their frames to each other.

A style is the `ClayShape` literal of `cssints/clay`. A theme (`THEME=light`, `t`) and a state are picked at run time
by `resolve()` in `pack.ts`, the merge `header()` does for C (`units_active_light`). `:hover`/`:active` apply to a box
with an `id`: Clay tells whether the pointer is over it. `onClick` runs on release over the box that was pressed;
`onPress` when the button goes down over it. `:focus` applies while the box's `focused` prop is true. `createFrame`'s `View.onPointer` gets the pointer once per frame, before the tree is declared: the widgets page uses it to drag the slider.

## The FFI (flat, no struct crosses it)

| Function | |
| --- | --- |
| `ui_init(w, h)`, `ui_font(path)` | Clay and a ThorVG canvas; a font by file path, its id is the order of calls. 0 / id on success |
| `ui_init_gpu(w, h)` | the same on ThorVG's WebGPU canvas (`--raster thorvg-gpu`); only a `libui.dylib` from `desktop/build-thorvg-gpu.sh solid` |
| `ui_begin(px, py, down, dt)` | pointer for this frame, then Clay's scroll containers move by the wheel this frame took (`Clay_UpdateScrollContainers(false, delta, dt)`, before the layout), then `Clay_BeginLayout` |
| `ui_open(id, len, f32[45])` | open an element; `id` NULL for none; the style as below |
| `ui_value(id, len, field, f32)` | an override of one number of that element's style for this frame: a packed field 0..44 (the table below), 45 its shadow's blur, 46/47 its whole subtree's alpha and scale (a ThorVG scene of its own: `FIELDS.ALPHA`, `FIELDS.SCALE`, the section below), 48/49 its subtree's translate, 50 the opacity of its background image, 51..54 the colour of the **text** with that id (a text's own floats, not its box's: `FIELDS.TEXT_COLOR`) and 55 its subtree's rotation in degrees (`FIELDS.ROTATE`). `ui_open` declares from a copy of the 45 floats with the frame's overrides applied, `ui_text` from a copy of its 10; the table is cleared in `ui_begin`, 64 overrides a frame (`src/pack.ts`'s `FIELDS` names the ones a page uses; `src/motion.ts`'s `channel(write)` writes one element's fields in one call) |
| `ui_image(bytes, len)` | the image of the element the next `ui_open` declares (a `css.image` style): the path as UTF-8, no terminator. Interned once per distinct path, so the renderer's picture cache (keyed by that pointer) sees one address every frame |
| `ui_shadow(x, y, blur, r, g, b, a)` | the shadow of the element the next `ui_open` declares (a `css.shadow` style): Clay has no shadow field, so it waits here and the element id's hash carries it to the renderer's table (one a frame, 32 at most, one draw an element) |
| `ui_text(id, id_len, bytes, len, f32[10])` | a text element, with an id or NULL: with one, the text's colour can be moved through `ui_value` (fields 51..54, applied to a copy of its 10 floats). The bytes are copied for the frame |
| `ui_close()` | close the element |
| `ui_pointer_over(id, len)` | Clay's `Clay_PointerOver`, on the last frame's layout |
| `ui_end(dt)`, `ui_draw()` | `Clay_EndLayout` (returns the command count), then the frame's hash; ThorVG draws the commands into the buffer |
| `ui_hash()`, `ui_draws()`, `ui_presents()` | the last frame's 64-bit FNV-1a over its commands and renderer effects, and the counts of those calls: the same hash twice draws the same pixels, so the host skips both |
| `ui_save_png(path)`, `ui_diff_png(ref, actual)`, `ui_pixel(x, y)` | the frame out; pixels that differ from a PNG; one pixel |
| `ui_pixels_copy(out, cap)`, `ui_load_png(path)`, `ui_png_size(out)`, `ui_png_copy(out, cap)` | the whole frame as RGBA32 (the text metric reads a crop of it every pixel at once); a PNG of the page's size, loaded once, and its size and bytes |
| `ui_text_weight(px)` | how much thicker than ThorVG's own raster a line is drawn: a second copy of it, half the weight either side of Clay's place (0, the default: one copy) |
| `ui_density(scale)` | the raster's pixel density: 2 draws the same layout into twice the pixels, as the window on a Retina screen does (`--density 2` headless) |
| `ui_window_open(title)`, `ui_window_poll(f32[6])`, `ui_window_present()` | SDL3 window (Metal); poll fills pointer x, y, button, quit, the last key's character, and whether the last pointer event was a finger's (1) or the mouse's (0). A finger's `SDL_EVENT_FINGER_DOWN/MOTION/UP` goes through `ui_touch_map` (normalised 0..1 of the window → the layout's pixels) into the same x, y and button, and the first finger owns the pointer until it lifts |
| `ui_touch_map(fx, fy, f32[2])` | a finger's normalised position in the layout's pixels: the one mapping the poll and the headless `--touch` share |
| `ui_key_pop(i32[4])` | the oldest key event the polls queued: down (1) or up (0), SDL keycode, `SDL_Keymod`, repeat. 0 when none; 64 are kept |
| `ui_text_pop(bytes)` | the oldest typed run the polls queued: UTF-8, a composed character, never a keycode. Its byte length, 0 when none; 64 runs of up to 128 bytes are kept, a longer run cut at a character boundary |
| `ui_text_input(on)` | `SDL_StartTextInput` / `SDL_StopTextInput`: only while it runs does the window poll `SDL_EVENT_TEXT_INPUT` (an IME needs it too). The host turns it on while the focused part is a text field (`Input.editing`) |
| `ui_clipboard_get(bytes)`, `ui_clipboard_set(text, len)` | `SDL_GetClipboardText` / `SDL_SetClipboardText`: UTF-8 in and out (the get writes NUL-terminated bytes and returns their count) |
| `ui_bounds(id, len, f32[4])` | x, y, width, height of an element in the last layout (tests click at the middle of a part). A scroll container's children are outside its box and their bounds are not clipped |
| `ui_wheel(dx, dy)` | adds a wheel delta for the next frame, in Clay's units and SDL's sign: positive is away from the user (the content moves down). `ui_window_poll` calls it for every `SDL_EVENT_MOUSE_WHEEL`, and a shift+vertical wheel is moved onto x there (`SDL_GetModState()`), so a mouse can scroll sideways as a browser's does; Clay moves the container the pointer is over by 10px a notch |
| `ui_scroll_offset(id, len, axis)` | the scroll offset of a clip element, in pixels along `axis` (0 y, 1 x; negative is scrolled down or right); 0 when there is none |
| `ui_scroll_to(id, len, axis, v)` | scrolls a clip element to `v` on `axis`, clamped to its content (the same range Clay clamps to); returns the offset it took |
| `ui_scroll_put(id, len, axis, v)` | puts a clip element's offset on `axis` where the page says, **with the content's clamp left out** — a rubber band past an end is past the content on purpose; returns the offset |
| `ui_errors()` | Clay errors so far |

Text is measured by ThorVG, as in `host.c`.

**Idle.** `ui_end` hashes the frame it has just laid out (`ui_hash`): every command's visible fields and the renderer's
tables beside them (a shadow, a backdrop, a gradient, a group; a neutral group is skipped). `main.ts` draws and presents
only when that hash changed or the iteration carried a discrete input (a key, typed text, a press or release, a wheel
notch); a pointer move draws through the hash alone, so a settled hover draws nothing. Nothing drawn means
`Bun.sleep(16)` at the end of the iteration; `createDrawer` (`src/frame.ts`) is that decision, and the headless flags
take it too. `--idle N` runs N frames with nothing in and prints the draws, `--idle-keys K` presses a Tab every K of
them. `native/README.md` ("Idle") has the fields and the numbers.

An image is the one part of a style that is not a float: `css.image` becomes `d.image.imageData`, a pointer, so
`frame.ts` calls `ui_image` with the path just before the element's `ui_open` (`pack.ts` keeps the path beside the
packed box in its variant). `ui.c` interns the path, because Clay's config is that pointer alone and
`Clay_ThorVG_Picture` caches a picture by it; ThorVG loads one file per path and stretches it into the element's box.
The packed style does not carry Clay's `aspectRatio`, so `fit: "contain"` is the C header's; `fill` (the default) is what
a Solid page gets. The SDL renderer path still reads `imageData` as an `SDL_Texture` and does not draw a path: the image
element is ThorVG-only, as on the C side.

A shadow is the second part of a style that is not a float, for the other reason: Clay 1.0's declaration has no shadow
field, and a shadow is an effect of the raster, not a box. `frame.ts` calls `ui_shadow` just before `ui_open`, and
`ui.c` files it under `Clay_ElementId.id` — the id the element's render commands carry — so the renderer draws it before
the element's first command (`clay_renderer_thorvg.c`: the command's box and radii, offset, filled and blurred, sigma
`blur / 2` in the scene's own units, quality 80). `pack.ts` keeps the `Shadow` object in its variant beside the image's
path; the element needs an `id`, or the shadow is dropped.

### `ui_open` fields (`pack.ts` `packBox`, `ui.c` `ui_open`)

| i | field | | i | field |
| --- | --- | --- | --- | --- |
| 0 1 2 | width: type, min or percent, max | | 14-17 | background r g b a |
| 3 4 5 | height: type, min or percent, max | | 18-21 | corner radius tl tr br bl |
| 6-9 | padding left right top bottom | | 22-25 | border width left right top bottom |
| 10 | child gap | | 26-29 | border colour r g b a |
| 11 12 | child alignment x (0 left, 1 centre, 2 right), y (0 top, 1 centre, 2 bottom) | | 30 31 | clip horizontal, vertical |
| 13 | direction (0 row, 1 column) | | | |

The floating fields (`css.float`, `packBox`'s `d.floating`; all zero means not a float):

| i | field | | i | field |
| --- | --- | --- | --- | --- |
| 32 | is a float | | 38 39 | offset x, y |
| 33 | attach to (0 none, 1 parent, 2 element with id, 3 root) | | 40 41 | expand width, height |
| 34 35 | the parent id's two 16-bit halves (a float32 cannot hold the 32-bit hash) | | 42 | z index |
| 36 37 | attach point of the float, of the parent (0 `left top` .. 8 `right bottom`) | | 43 | pointer: 0 capture, 1 passthrough |
| | | | 44 | clip: 0 none, 1 attached parent |

A float is a layout root of its own: Clay lays the page out as if it were not there and draws it above (ascending z), and
a capturing float stops `Clay_PointerOver` from seeing what is under it — which is how the dialog's backdrop swallows the
pointer. `root: true` attaches to the window (`Clay__RootContainer`), so `width`/`height` `stretch` is the whole window
(the backdrop) and `attach: { element: "center center", parent: "center center" }` centres the dialog, while
`parent: "<id>"` + `attach: { element: "left top", parent: "left bottom" }` hangs a menu off its trigger.

Sizing type: 0 fit, 1 grow, 2 percent, 3 fixed (Clay's order).

### The value channel: a field that moves

A variant is packed once and kept, so a page cannot change a style's number by rebuilding it. Instead its `View.tick`
runs before the tree is declared and calls `ui.value(id, field, value)`: `ui_open` copies that element's 45 floats,
applies the frame's overrides of its id and declares from the copy. It is the shadow's and the backdrop's kind of side
table — cleared in `ui_begin`, nothing cached — and a frame without overrides declares exactly the literal, which is why
the Dialog's settled frames stayed byte-identical. `field` is a packed field (0..44), or `FIELDS.SHADOW_BLUR` (45), which
is `ui_shadow`'s blur and not one of the floats, or the four **group** fields: `FIELDS.ALPHA` (46, 0..255),
`FIELDS.SCALE` (47, 1 = none) and `FIELDS.TRANSLATE_X`/`TRANSLATE_Y` (48/49, px), which are the element's whole subtree
as one ThorVG scene — its opacity, a scale about its box centre and a visual offset, none of which is a layout
(`ui_bounds` does not move). None of them goes into the floats. `FIELDS.GRADIENT_ALPHA` (50) is the opacity of the
element's own background image: 255 is the gradient alone, as an opaque one has always been drawn; below it the gradient
is composited over the box's solid fill, which is how two gradients cross-fade through the colours between them.

**`FIELDS.ROTATE` (55)** is the fifth number of that scene: degrees about the same box centre, composed with the scale
and the translate into one matrix — **scale, then rotate, then translate**, `x' = s·R·(x - c) + c + t`. ThorVG's matrix
is read as `x' = x·e11 + y·e12 + e13`, `y' = x·e21 + y·e22 + e23` (`tvg::operator*` in its `tvgMath.cpp`; the third row
is unused), so the linear part is `s·R(θ)` in `e11/e12/e21/e22` and the third column is `c + t - (s·R)·c`. A positive
angle turns clockwise on screen (y runs down), a page's tilt is its sign, and a rotation of exactly 0 takes the scale's
own matrix expression, not the rotation's arithmetic for 0°, so a page that never leans keeps the frames it had
(`c·(1 - s)` and `c - s·c` round differently; measured: 1-level shifts in three glyph pixels of the scaled panel).
The order is proved on a hand-built non-square box (`dialog.test.ts`): a 200x40 box at the root with `SCALE` 0.5,
`ROTATE` 90° and `TRANSLATE_X` 40 draws the rect x 130..150, y -30..70 — the long side stood up about the centre (100,
20) and the 40px after the rotation, unscaled (a translate taken before the transform would put it at x 110..130).

**A text's colour is the one field a box does not have**, so it is the table's other kind of target: `FIELDS.TEXT_COLOR`
(51..54, rgba) names a **text** element, and `ui_text` applies it to a copy of its own 10 floats — with the id of the
`<text id="...">` (`ui_text`'s first argument; a text with no id is anonymous and cannot be named, so its colour is its
style's literal and cannot be animated). A text's colour is not in its parent's box, which is why the group's opacity
fades a text but a colour transition needed this. Clay's text command carries the colour, so `ui_hash` sees it and the
frame draws.

Naming them is `pack.ts`'s `FIELDS`: `OFFSET_X` 38 and `OFFSET_Y` 39 of a float, `EXPAND_W`/`EXPAND_H` 40/41, `Z_INDEX`
42, `CAPTURE` 43 (a closing overlay sets it to 1, passthrough, so the page under it takes the press), `RADIUS` 18 (the
four corners), `BACKGROUND` 14 (rgba) and `BACKGROUND_ALPHA` 17 (the dim of a backdrop), `BORDER` 26 and `BORDER_ALPHA` 29
(a tab's 2px underline, and the alpha it fades by), `PADDING` 6, `GAP` 10, `WIDTH` 0, `HEIGHT` 3, `GRADIENT_ALPHA` 50,
`TEXT_COLOR` 51 (`TEXT_COLOR_ALPHA` 54) and `ROTATE` 55. The first group is what reads as motion; width, height, padding,
gap and the colours are legal but Clay lays the page out
from the declaration each frame, so a changing one re-lays-out the element's parent and its siblings — a layout change,
not a transform. The cost is a 180-byte copy per overridden element and one scan of the table per `ui_open` on a frame
that uses it.

### The element tree and the groups (`ui.c`, `clay_renderer_thorvg.c`)

A group is one element's subtree drawn into a scene of its own, which per-command alpha cannot do (a text's colour is not
in its parent's floats). `ui_open`/`ui_close` keep the frame's tree of `{id, parent}` nodes in declaration order and
`ui_text` adds a node for a text — a text is never open, but a group's subtree must reach through it — and every
declaration hands its node to Clay as `userData` (index + 1), so each command says which element it belongs to. Clay's
commands are in depth-first order, so a subtree's commands are contiguous: a group's range is the min and max command
index whose element is that node or a descendant. The renderer opens a scene at the first command of the range, gives it
`tvg_paint_set_opacity` and one matrix (scale, rotation, translate: above) at the last one, and adds it to the scene that
was current when it opened; the element's shadow is drawn inside it. A group at 255, scale 1, no offset and no rotation
makes no scene. Four groups may be open at
once, 16 a frame, eight nested scissors; a backdrop's cut inside a group settles it into pass 1 and makes it again after
the cut. The groups' map to the target is one affine (`Clay_ThorVG_Map`): a **clip** is a ThorVG paint in the transformed
scene, so it already turns with its group (the test tree's clipped child ends its bright fill at x 101 on one row and 89
on another inside a 30° group), and the **dither**'s mark of a gradient is the box's four mapped corners' quad — every
pixel of its bounding box is mapped back into the shape's own space and tested against the box and its corner arcs — so a
gradient in a rotated group is stippled where it really is (0 pixels of the page around the quad, 1151 inside the quad
but outside the unrotated box: `solid/rotated.test.ts`); a clip's cut for the dither is that clip's quad bounding box,
the conservative bound.

### A page's first mount (`src/entry.ts`)

`Motion` (`onWheel`, `onPointer`, `tick`) is the page's half of the host: `main.ts` wires all three to the page it
renders. `pageEntry(motion, root = "Root")` gives List, Widgets, Sensors and the Text field their entry: the root's
subtree starts 8px low and at alpha 0, and settles on its literals in 0.25s — `TRANSLATE_Y` on `spatial(0.25, 0)` and
`ALPHA` on `effect(0.25)`, the group fields, so `ui.bounds` is the settled box on every frame — and then the tick writes
nothing at all, so a page at rest is the frame its literals make. The settle is ~21 frames; the stored frames are taken
after `--warm 30` and are byte-identical. Reduced motion has no entry. The Sky page's entry is its cards' stagger and the
Dialog's its overlays; both own their ticks.

### `ui_text` fields (`packText`)

0-3 colour r g b a, 4 fontId, 5 fontSize, 6 letterSpacing, 7 lineHeight, 8 alignment (0 left, 1 centre, 2 right),
9 wrap (0 words, 1 newlines, 2 none). The colour is also the value channel's `FIELDS.TEXT_COLOR` (51..54) when the text
carries an id; nothing else of the 10 moves.

## Keys, focus and the Widgets page

`bun solid/main.ts widgets` is the headless widgets (`headless/`) and the focus manager (`focus/`) on this renderer.

**A key.** The window queues every key down and up (repeats too); the host pops them (`ui_key_pop`) after the poll and
before the frame. `keyName` (`src/input.ts`) gives the names the manager and the parts use: `Tab`, `Shift+Tab`, `Enter`
(keypad too), `" "` for Space (DOM's `key`; the parts take `"Space"` too), `Escape`, `ArrowLeft/Right/Up/Down`, `Home`,
`End`, `PageUp`, `PageDown`, `Backspace`, `Delete`, a letter as itself in lower case. A Ctrl, Alt or Cmd chord has no name and is dropped, and so is Shift with an
arrow, Home or End (the manager takes plain keys only; see below for how a text field still gets the selection chords). Then `input.down(name, repeat)`:

1. Tab and Shift+Tab go to the focus manager. It answers true when it moved focus. Past the last Tab stop it releases
   focus and answers false (a browser would hand Tab to its chrome): the next Tab starts at the first stop again, so the
   order cycles through one "nothing focused" stop.
2. Otherwise the focused part's `keyDown(name, repeat)`: Enter on a button, Space armed on key down; in a group the
   arrows, Home and End: the part asks the manager to move focus itself and then checks or selects what it moved to (a
   radio checks, tabs select, a toolbar only moves), a slider changes its value, and PageUp and PageDown are its large
   step. A key a pattern does not have (Home on a radio, Up on a horizontal toolbar) is nobody's. The arrows must not go
   to the manager first: it would move focus and the radio would never check.
3. Otherwise `input.fallback(name)`, the page level: `t` toggles the theme — but only while no text field has focus
   (`!input.editing()`): while one does, a letter is a character to type, and the page keeps its hands off it.

`input.up(name)` goes to the focused part's `keyUp` (Space fires there). `focus.onChange` blurs the part that lost focus
(dropping an armed Space) and focuses the one that got it, so a part's `focused` follows the manager.

**Typed text** is a second path beside the keys, because a text field takes characters (and composed ones: an IME commits
a run, an accent composes), not keycodes. While a text field has focus the host starts SDL's text input; `ui_window_poll`
queues every `SDL_EVENT_TEXT_INPUT` next to the keys, `ui_text_pop` hands them over and `Input.textInput(text)` inserts
them into the focused part. The key path is untouched: a letter still arrives as `keyDown("a")`, a text field's `keyDown`
ignores it, and the same character then arrives as text. While a text field has focus, `input.editing()` is true and
`solid/main.ts` turns SDL's text input on and off with it.

Editing keys stay keys, and `src/input.ts` names them: `Backspace` (SDL 8) and `Delete` (127) are new entries in `KEYS`;
`selectionName` (used by the host instead of `keyName`) keeps Shift on the arrows, Home and End (`Shift+ArrowLeft`,
`Shift+Home`), which a text field selects with. `keyName` itself is unchanged — it still refuses a Shift+arrow, and the
focus manager is only ever handed plain Tab and Shift+Tab, so no other part sees a name it did not have. Cmd/Ctrl+C, X
and V are chords `keyName` drops, so the host reads them before the name (`CHORD` in `main.ts`) and calls
`Input.clipboard(op, text)`: the part returns what goes on the clipboard (copy, cut) or takes what comes off it (paste),
and the bytes go through SDL's clipboard functions in C (`ui_clipboard_get` / `ui_clipboard_set`).

**A modal.** `input.modal` is a key the whole page gives to one owner while it is open: the Dialog page sets it to the
dialog's trap (`dialog.keyDown`), so Tab and Shift+Tab cycle the dialog's controls and Escape closes it before the focus
manager or any part sees them, and everything else falls through to the focused control. `up` still goes to the part
(Space fires there). The Widgets page uses it for the open size menu (`createMenu.keyDown`; Tab closes it and falls
through, every other key belongs to the menu) and for opening it from the toolbar's Size item (Down, Up, Enter, Space).

**The pointer.** A box with `onPress` runs it when the button goes down over it, as a browser focuses on mousedown;
`onClick` still runs on release over the box that was pressed. `input.add(part)` registers the part in the manager
(in call order: the document order) and returns the props `{ id, focused, onPress, onClick }` to spread on its row:
a press focuses it (`focus.focus(id)`) and a release over it calls `part.press()`. A group (radio, tabs, toolbar, slider)
registers its own items in the manager it is given (`createRadioGroup({ focus: input.focus })`), so `input.bind(part)`
only routes keys and focus to the part and returns the same props; both `onPress` and `onClick` get the pointer's x and y. The page also gets the pointer once a frame (`View.onPointer`): a press on the slider's rail sets its own `dragging` flag, and while the button is held each frame's x moves the value (a release clears the flag; a press off the rail never sets it). A press on a part that cannot take
focus (the disabled checkbox) changes nothing, focus stays where it was and `press()` ignores it. A press on no
element with `onPress` (empty space) blurs: `createFrame`'s `onPressMiss` calls `input.pressMiss()`.

**`:focus`.** A style may have `css.focus(...)`. A box with an `id` and a `focused` prop that is true takes it; with
`:hover`/`:active` the states that hold are laid over the base in the order hover, focus, active, so active wins a field
they both set, and focus ring and pressed look show together (`resolve` in `pack.ts`). The Widgets styles use a 2px
border in the `ring` token (a border does not change Clay's layout, so the ring moves nothing).

**The page.** `app/Widgets.tsx` (360x760: the page is as tall as it needs to be with the disclosure open and the tree's
Display open, the tallest state; a page taller than the window makes Clay shrink its boxes, a row wider than it widens
the root, both are asserted): a button that counts presses, a Wi-Fi switch (the thumb is at the end of the track
by `trackOn` instead of `track`), "Select all" (mixed) over Wired and Wireless (`all` is controlled: its `value` is
read from the two, its `onValueChange` sets both), a disabled checkbox, and a disclosure whose panel is in the tree
while `!panel.hidden`. Tab order: button, switch, select all, wired, wireless, trigger, then the five groups below.

The groups come after the disclosure, so the first part of the page is the old layout pixel for pixel (checked against
the earlier eleven frames over their old height: the only new ink in them is the tree under the toolbar; the frames are
regenerated at the new size). Each is made after the parts above it, because the manager's document order is the order of
registration:

| Widget | In the manager | Keys and pointer |
| --- | --- | --- |
| Speed (radio, `1x 4x 16x`; `disabledSpeeds` marks some disabled, the tests do) | a group: `orientation: both`, `wrap`, no memory, `entry` = the checked radio | Tab enters at the checked one and leaves as one stop; all four arrows move and check (wrapping, a disabled one skipped); Space checks; a click focuses and checks |
| Tabs (Overview, Stats, Log) | a group: horizontal, `wrap`, no memory, `entry` = the selected tab; the selected panel is a stop after it | Left and Right move and select (automatic), Home and End go to the ends; a click selects; Tab goes to the panel (ring on it), then on |
| Volume (slider 0..100, step 5, page 20, `valueText` "45%") | not a group: one entry (the thumb) | arrows step, PageUp and PageDown move by 20, Home and End go to the ends, clamped; a press on the rail or the knob sets the value and starts a drag: each held frame's x is the ratio from the rail's `ui_bounds` (less the knob's width, so a press on the knob's middle keeps its value); the ring is the rail's (the control), so it hugs the rail and the knob and the value text stays outside it |
| Format (toolbar: Bold, Italic and a menu button, Size; the first two toggle a lamp under the label) | a group: horizontal, no wrap, **memory**, `focusDisabled`; the menu button is one more item of it | Left and Right, Home and End move; Enter and Space toggle a plain item on key down; Tab away and back lands on the item left last. On Size, Down, Up, Enter or Space open the size menu (Down and Enter on the first radio, Up on the last), the item's label shows the chosen size and its lamp is lit while the menu is open |
| Settings (tree: Network open with Wi-Fi and Bluetooth, Display closed with Brightness, Storage a leaf: six nodes) | a group: vertical, no wrap, no memory, `entry` = the first selected visible node, else the first visible; a node in a closed subtree has `tabIndex: -1` | one Tab stop: Tab enters at Network (the first visible row); Up and Down, Home and End walk the visible rows only; Right opens the closed Display and, on an open parent, steps into its first child; Left closes an open parent, or steps to it from a child; Space selects, Enter opens and selects; a click opens, selects and focuses |

The tree is the last group, made after the toolbar, so its rows are the page's last Tab stop: Tab out of the tree
releases focus (nothing is after it). Its styles: a row per node with the hover and pressed looks of the other rows and
the same 2px `ring` on the roving row; the row's left padding is one step of 18px per `level` (`nodeOf`, one style made
at run time per level and selection, as `fillOf` does for the slider); `+` on a closed parent, `-` on an open one, and
a leaf has none; the selected row is the `surface` fill with its label in the `accent` (4.5:1 or more on the surface in
both themes); a node in a closed subtree is not in the Solid tree at all (`Show when={!item.hidden}`), so its row is
neither drawn nor findable. No disabled nodes: the tree part has none, so the page has no dim row look.

The slider's filled part is the one style made at run time (`fillOf`: `s.fill` with a fixed width of the value, kept
per width); Clay has no flex ratio. The focus ring is the rail's (`s.rail`: the control, 140x24, no padding or border at
rest — a Clay border draws inside the box, so it moves neither the rail nor the knob); the row (`s.sliderRow`) holds the
rail and the value and takes no ring, so the readout stays outside it. A drag reuses `Slider.pointer` for each held
frame's x: a press sets the value, moving with the button down follows the pointer, and a release ends it where it was.

The size menu is a float hung under the menu button (`formatMenu`: `parent: "format-item-2"`, `attach: { element: "left
top", parent: "left bottom" }`, 4px down, `zIndex: 10`, **capturing**, so a press on it does not also reach the page under
it), one row per radio with the accent dot on the chosen one. `createMenu` has a focus manager of its own: its trigger is
not a stop of the page, the toolbar's item is. The page gives the open menu every key through `input.modal` (Down, Up,
Enter and Space open it from the item; inside, the arrows and Home/End move, Enter picks and closes, Escape closes and
returns focus to the item, Tab closes it and goes on), and an effect closes it when the item loses focus to another part.

Checked by `bun solid/widgets.test.ts` (no pixels but a few ring, fill and knob positions: the full Tab order over the
page and Shift+Tab, one Tab stop for each group, Space on key up and Enter on key down, a held Space once, a click toggling
and focusing, the disabled box, blur on empty space, select all, the disclosure, the page fitting its window, the radio's
arrows (wrap, Space, Tab in at the checked one, a disabled radio skipped by arrows, Tab and a click), the tabs' arrows,
Home, End and panels, the slider's step, page keys, ends, clamping and rail presses, the rail's ring and the readout
without one, the toolbar's ends, memory and toggles, the menu button (`aria-haspopup`, Down/Up/Enter open, the menu's
arrows and Home/End, Enter picking and closing, Escape returning focus to the item, Tab closing and moving on, its float
under the item, a click picking), the tree's one stop, its visible-only arrows, Right and Left, Home and End, Space, the
ring following the roving row, a hidden node skipped, contrast of the ink on every fill, key names, the drag) and by
seventeen stored frames in `frames/`:

| Frame | Keys | Shows |
| --- | --- | --- |
| `widgets-initial` | | the page at rest: 1x checked, Overview selected, Volume 40%, no lamp on; below the toolbar the tree: `- Network` with Wi-Fi and Bluetooth, `+ Display`, Storage |
| `widgets-tab2` | Tab Tab | ring on the switch |
| `widgets-switch-on` | Tab Tab Space | the switch on |
| `widgets-mixed` | Tab×4 Space | Wired checked and ringed, "Select all" mixed |
| `widgets-disclosure` | Tab Tab Space Tab×4 Enter | the panel open, everything below it moved down, nothing shrunk |
| `widgets-radio` | Tab×7 ArrowRight | 4x checked and ringed, 1x cleared |
| `widgets-tabs` | Tab×8 ArrowRight | Stats selected and ringed, its panel's text |
| `widgets-slider` | Tab×10 ArrowRight | 45%, the filled part and the knob a step on, the ring around the rail (the `45%` outside it) |
| `widgets-slider-drag` | a press at a quarter, held, a move to three quarters | the knob near the right end, the fill grown, 80%, the ring on the rail |
| `widgets-toolbar` | Tab×11 Enter ArrowRight Shift+Tab Tab | Bold's lamp on; Italic ringed after leaving for the slider and coming back |
| `widgets-toolbar-menu` | Tab×11 ArrowRight×2 ArrowDown | the size menu floating under `Size: Medium`: `Small` ringed (the first item), the accent dot on `Medium`, the item's lamp lit; the menu covers the tree's first rows and is not clipped |
| `widgets-light` | the disclosure, then the four groups | the light theme: 4x, Stats, 50%, Bold on and ringed |
| `widgets-tree-focus` | Tab×12 | the ring on Network, the tree's first visible row: Network open with its two children, Display closed, Storage after it |
| `widgets-tree-down` | Tab×12 ArrowDown | the ring on Wi-Fi, the selection still empty (`ArrowDown` moves, it does not select) |
| `widgets-tree-expanded` | Tab×12 ArrowDown×3 ArrowRight | Display opened by Right (`+` became `-`), Brightness indented under it, the ring still on Display |
| `widgets-tree-select` | Tab×12 ArrowDown×3 ArrowRight Space | the same, and Display selected: the surface fill with its label in the accent, ring still on it |
| `widgets-tree-light` | the same keys, light | the light theme: Wi-Fi selected (white fill, accent label) and ringed |

## The Dialog page

`bun solid/main.ts dialog` is a settings screen (360x480) with the two overlays of `headless/`:

| Widget | What it is | Keys and pointer |
| --- | --- | --- |
| Settings dialog | `createDialogModal` (role `dialog`): a float 280 wide centred on the root (`css.float({ root: true, attach: { element: "center center", parent: "center center" }, zIndex: 2 })`) over a backdrop float that is the whole window (`root: true`, `left top`, `stretch`, `zIndex: 1`, `rgb(0 0 0 / 0.55)`) and takes the pointer | "Open settings" opens it by click or Enter; focus moves to Cancel and Tab/Shift+Tab cycle Cancel and OK and never leave; Escape and Cancel close without a write; OK writes `Volume: 55%` onto the page. The backdrop swallows every press, so the page behind is unreachable by pointer, and `input.modal` keeps it unreachable by keyboard. Closing returns focus to the trigger |
| Zoom menu | `createMenu` (plain, `100% 125% 150% 200%`): a float attached to `zoom-trigger`, `attach: { element: "left top", parent: "left bottom" }`, offset y -20 (it overlaps the trigger's bottom edge by 20px, so the glass has a border and a text stroke under it), `zIndex: 10` | Tab reaches the trigger; Enter, Space, Down or Up open it on the first/last item; Up/Down wrap, Home/End go to the ends; Enter picks and closes, Escape closes and returns focus to the trigger, Tab closes and leaves. The picked zoom is shown in the pill and the menu's dot |

The dialog's container and the backdrop carry an `onPress` that does nothing: a press inside the dialog or on the
backdrop must not read as a press on empty space (`onPressMiss` would blur).

**The arrival, and the exit.** The two overlays animate through the value channel (`ui.value`, above): each frame the
page's tick overrides numbers of their packed styles — the float's offset y, the shadow's blur and, for the backdrop, the
alpha of its dim — and every target is the style's own literal, so a settled frame is the literal's frame, pixel for
pixel. The menu slides out of its trigger: offset y `-10` → `-20` on `spatial(0.22, 0.1)` (a light bounce) and its
shadow's blur `0` → `14` on `effect(0.22)`; the dialog drops in: offset y `-14` → `0` and its shadow's blur `0` → `32`.
The blur takes the `effect` class because a blur has no negative side and must not ring in a luminance field, the offset
`spatial` because position may carry a little velocity.

The menu also **leans**: `FIELDS.ROTATE` (55) `-2°` → `0` on the same `spatial(0.22, 0.1)` as its scale, in the same
scene (`ALPHA` 225 → 255, `SCALE` 96 → 100), so it settles out of a tilt as it slides out of its trigger. It is a scene
transform: `ui.bounds` is the style's box on every frame (x, width and height are the literal's, only the float's offset
moves y) while the drawn top edge is 5px out of horizontal over the menu's 150px. On the way out it leans back to -2°
on `spatial(0.2, 0)`, though the fade to 0 is faster than the lean: by the fourth frame of the exit the border is under
the brightness a pixel check needs (measured: 129 → 117 of the muted border's 155 by the third frame, nothing by the
fourth) — the lean is there, it just has little ink left to show it.

A node that leaves stays in the tree while it leaves (`presence` in `src/motion.ts`): the page's tick asks
`presence(open, 0.35)` for each overlay, keeps a signal of its `mounted` answer and puts it on `Show`, so closing runs
the same tracks the other way — the panel's offset y `0` → `14` on `spatial(0.2, 0)` and its blur `32` → `0`, the
backdrop's alpha `140` → `0` (field 17; its box is the whole window, so the alpha is the dim), the menu's offset y
`-20` → `-10` and its blur `14` → `0` — and the node leaves the tree when the 0.35s is up (its 0.2s tracks settle at
0.333, so no frame is cut). The trap is the *open state's*, not the node's: `input.modal` asks `dialog.open()`, so a Tab
right after Escape reaches the page's own next stop (the Zoom trigger) while the panel is still fading, and a closing
overlay writes `FIELDS.CAPTURE` 1 so a press goes through it to the page. A reopen during the exit retargets from what
is presented (the reopen frame is the exit's own next value, no jump and no restart), and the clocks keep running for
as long as the node is mounted. With reduced motion (`--reduced-motion`, `REDUCED_MOTION=1`) a retarget lands on its
target in the same call and a presence unmounts at once, so opening is the literal's frame in one frame and closing has
no frame with the panel in it.

| Frame | Keys | Shows |
| --- | --- | --- |
| `dialog-closed` | | the page at rest: `Volume: 40%`, Zoom `100%`, no menu |
| `dialog-open` | Tab Enter, settled | the dimmed page and the dialog centred on it, ring on Cancel, `Volume` still 40% |
| `dialog-light` | Tab Enter, settled, `THEME=light` | the same in the light theme: a white dialog over a greyed page |
| `dialog-menu` | Tab Tab Enter, settled | the menu hanging off the Zoom trigger's left-bottom corner, ring and dot on `100%`, the trigger's `-` |
| `dialog-menu-mid` | Tab Tab Enter, 3 frames after the key | the menu 7.4px lower than it rests (offset -12.58), its shadow at about a fifth of its blur, and its top edge out of horizontal: the border's inset from the box's left 60px against 8px from its right |
| `dialog-exit-mid` | Tab Enter Escape, 3 frames after the key | the panel 3.94px below its place, its shadow at 22.9 of 32, the page behind it at 100.6 of the 140 dim |

Checked by `bun solid/dialog.test.ts`: opening by click and by keyboard, the trap's two-control cycle, the page's trigger
never a stop while open, Escape and Cancel writing nothing, OK writing 55%, a press on the backdrop doing nothing and not
reaching the page behind, `ui.bounds` of the backdrop (the window) and the dialog (centred on the root), the page's
layout unchanged behind the backdrop, the menu's arrows, Home/End, Escape back to the trigger, Enter and a click
picking, and the motion: the menu's offset `-10.00, -10.85, -12.58, -14.42, -16.04, -17.32, -18.26, -18.92, -19.36,
-19.64, -19.82, -19.92, -19.97, -20.00` and at rest exactly its style's -20, every frame towards it and none past it,
the shadow with no blur on its first frame (the page beside it) and its blur darkening that page 18.0 → 13.9 as it
settles, and the dialog's drop `149.88, 151.07, 153.49, … 163.88` finite and still.

The lean is measured on the pixels: the menu's border is the one near-grey bright line of the glass, so a row one pixel
below the box's top finds it on the left and on the right, each as an inset from the box's edge — `112/11` on the frame
it opens on, `108/10`, `60/8`, `25/7` as the lean decays and `5/5` at rest, the two corner arcs' own. Its box is
`40,·,150,133` on every frame of that (x, width and height the literal's; y is the float's offset alone), and the exit
leans back: `5/5`, `6/6`, `6/5`, `22/116` on the first four frames after Escape (the fade then takes the ink past what
a border check can see). The matrix itself is proved on a hand-built non-square box in the same file: a 200x40 box at the
root with `SCALE` 0.5, `ROTATE` 90° and `TRANSLATE_X` 40 is drawn as the rect x 130..150, y -30..70 — the long side stood
up about the centre (100, 20) and the 40px after the rotation, unscaled (a translate before the transform would put it at
x 110..130, and no rotation at x 40..140); its `ui.bounds` is still 200x40.

The exits and presence (`presence`, `channel`, `setReducedMotion` in `src/motion.ts`):
the panel's offset y `163.88, 165.24, 167.82, 170.39, 172.54, 174.18, 175.37, 176.20, 176.77, 177.16, 177.41, 177.58,
177.68, 177.75 … 177.88` and still at that 14 below its place, the title pixel behind the backdrop (47, 35) `103, 115,
139, 162, 181, 196, 206, 214, 219, 222, 225, 227, 228, 228, 230` (140 of 255 of dim to the page), the menu's exit
`-20.00, -19.03, -17.18, -15.34, -13.81, -12.64, -11.79, -11.19, -10.79, -10.51, -10.33` with its shadow lightening
13.9 → 18.0 (the page), the panel still in the layout on the frame Escape closes it and for the exit after, then gone
with the backdrop, and the page's own pixels back to the frame before opening (0 pixels differ, the trigger's ring
included). The trap is released on that same frame: a Tab right after Escape reaches `zoom-trigger` while the panel is
still fading. A reopen after four frames of the exit presents `174.18` — the exit's own next value — and settles back
on 163.88 with the keys back in the dialog. Reduced motion (`setReducedMotion(true)` in the test) opens on the
literal's frame (0 pixels differ from the settled frame) and removes both nodes on the frame it closes (the page back
in that frame); `test.sh` also runs `$D --reduced-motion --keys Tab,Enter --expect solid/frames/dialog-open.png`.

The frames are taken at rest (`--settle 30`) because a stored frame of a moving page would pin an instant of the spring;
`dialog-menu`, `dialog-menu-light`, `dialog-menu-mid`, `dialog-open`, `dialog-light` and `dialog-closed` came out
**byte-identical** to the frames before the exits (the entry's end is still the literal, and the closed page is the page
before anything was opened); the new `dialog-exit-mid` is three frames after Escape, the panel 3.94px into its exit.

**Mutation.** `ui_value` dropping `OFFSET_Y` leaves every frame at -20 — `FAIL every frame of the slide moves it towards
the offset: false, wanted true` and `FAIL the menu appears 10px below the style's offset` — and the mid frame's menu
sits at the settled place, only its shadow band differing; `ui.c` is compared with its backup after the revert.
Dropping the presence (mounting the dialog on `dialog.open()` again, so it unmounts on close) fails `FAIL the panel is
still in the layout right after Escape: false, wanted true`, with every sampled y `NaN` and the title already `230`
(the dim gone in the same frame) — `Dialog.tsx` is compared with its backup after the revert.
Dropping the `FIELDS.ROTATE` write (so the tilt track is computed and never reaches the scene) fails `FAIL mid-lean the
top edge is not horizontal: the border's two insets differ: false, wanted true` with the insets `NaN/NaN, NaN/NaN, 9/9,
7/7` — the flat edge — and nothing else in the test.

## The Text field page

`bun solid/main.ts form` is a form (360x450) around `headless/`'s `createTextField` — a part that is **not a port**: eoa
has no textfield primitive (`packages/headless` has `combobox` and `spinbutton`, each with its own model) and
`specs/apg/` has no textbox pattern, so there is no Quint model, mount, scenario or walk behind it and the conformance
counts in `headless/README.md` are untouched.

```ts
const name = createTextField({
  id: "name",                 // one focus entry; the field registers itself in the manager it is given
  focus: input.focus,         // the page's manager, so Tab reaches it in creation order
  maxLength: 24,
  onSubmit: (text) => setSubmitted(text),
});                           // uncontrolled: pass `value` + `onValueChange` to own the text
input.bind(name.part);        // keys and focus; the typed characters come through input.textInput
```

| Field / handler | |
| --- | --- |
| `value()`, `part.value`, `part.valueText` | the text (request/commit: `value` + `onValueChange` controlled, `defaultValue` uncontrolled) |
| `caret()`, `selection()` | the caret's index (0..length) and the run between the anchor and the caret, `{ start, end }` ordered |
| `part.role`, `part.tabIndex`, `part.focused`, `part.readOnly`, `part.disabled` | the neutral fields (the aria-* the driver reads) |
| `part.editsText`, `part.insert(text)` | the marker of a part that takes typed characters, and where they go |
| `insert(text)`, `keyDown(key, repeat?)` | the edits: insert at the caret (replacing the selection, clamped to `maxLength`), Backspace, Delete, arrows, Home/End, Shift+arrows/Home/End, Enter, Escape |
| `press(x, advance?)`, `setCaret(i)` | the caret from a press (x from the run's start, `advance` px a character), or programmatically |
| `part.clipboard(op, text)` | copy and cut return the selected text, paste inserts what was on the clipboard |
| `focus()`, `blur()` | the manager's (Escape blurs) |

**The text path is text, not keys.** A host hands the platform's characters to `Input.textInput(text)`, which goes to the
focused part's `insert` — one insertion at the caret, replacing the selection — so the field never knows which key made a
character, and an IME's committed run arrives by the same call; `Input.clipboard(op, text)` is that path's other half
(copy and cut return the run, paste inserts what came off the clipboard). A host that has to *show* the field to something
else — the browser page's `EditContext`, or the hidden textarea its fallback keeps — reads `Input.field()` rather than
keeping a second model: `{ id, value, caret, selection }` of the focused text field (`undefined` for any other part), the
string, the moving end and the ordered run, which `browser/solid/text.ts` mirrors once a frame.

**The keys.** Tab reaches the field as one stop. Typing inserts at the caret; Backspace and Delete remove before and
after it or the whole selection; Left and Right move and collapse a selection to the near end; Home and End go to the
ends; Shift with Left, Right, Home or End extends from the anchor; Enter calls `onSubmit` (a key repeat does not fire it
again) and keeps the focus; Escape blurs, and `t` flips the theme again once nothing has focus; Cmd/Ctrl+C, X and V go
through SDL's clipboard. A press on the field focuses it, and on release its x over the row places the caret.

**The caret and the selection are drawn, not measured per glyph.** Clay has no text attributes, so the value is laid out
as up to three text runs in a row — before the selection, the selection (a box with the tinted `selection` token and the
text inside it), after it — with a 1px caret box between them, so Clay puts each run exactly where its glyphs are. The
caret costs 1px of layout while it is in the middle of the text (browsers overlay it): the runs after it sit 1px right.
A press is the one place that needs an advance: the page takes the row's width from `ui.bounds` and divides it by the
text's length (`pressAt` in `app/Field.tsx`), one advance for every character — an approximation for a proportional font,
which can be a character off in the middle of a word and clamps at both ends.

The page's styles are in `app/Field.tsx`: the page's palette (`:hover` on the field, the same 2px `ring` on `:focus`), the
`ink` caret and the `selection` tint (`30%` of the accent in the dark theme, `22%` in the light one). The page fits its
window in its tallest state (a submitted line under the buttons; the test asserts it).

| Frame | Keys | Shows |
| --- | --- | --- |
| `field-empty` | Tab Tab | the empty Name field, ringed, with the 1px caret just inside its left padding |
| `field-typed` | Tab Tab, `text:Ada` | "Ada" and the caret after the last character, `Value: "Ada" (3)` |
| `field-selection` | Tab Tab, `text:Ada`, Shift+ArrowLeft ×2 | "A" then the caret, then "da" in the tinted run |
| `field-submit` | Tab Tab, `text:Ada`, Enter | the field still focused and `Submitted: Ada` under the buttons |
| `field-light` | the same as `field-typed`, light | the light theme: white field, blue ring, dark ink caret |

Checked by `bun solid/field.test.ts`: typed text reaching the focused field only (the read-only one and the command
button's count unchanged), the theme key not firing while a field is focused and firing after Escape, the caret's box at
the end of the run and its pixel in the ink, the arrows moving it, the selection's box at the anchor's x with its pixel
tinted over the surface, Backspace and Delete, a selection replaced by typing, `maxLength` 24, a press at either edge of
the run, Enter and the Submit button each showing the value once, and the page fitting its window.

**Mutation check.** Inserting at the start of the text instead of at the caret (`take + value()` in
`headless/src/textfield.ts`) fails seven `headless/test/textfield.test.ts` tests and two asserts of `solid/field.test.ts`
(the selection replace and the Submit button's text); the file is compared with its backup after the revert.

## The List page

`bun solid/main.ts list` is thirty rows in a fixed 240px viewport (360x400) whose offset **the page owns**
(`solid/src/vscroll.ts`, the Sky feed's machine): the viewport is one clip element (a `Clay_ClipElementConfig` — to Clay
any clip element is a scroll container) with the same id, and the page writes its offset through `ui_scroll_put` /
`ui_scroll_to` every frame before the tree is declared, with `ui_auto_scroll(0)` keeping Clay's own wheel scrolling out of
the way. Its header (`Room A3 — 13 of 30`) and its footer are the viewport's siblings, so they do not move, and the rows
beyond the box are clipped by the renderer's `SCISSOR_START`, not drawn outside. A scrollbar on the viewport's right edge
is the same machine's (`BAR`, below).

| | |
| --- | --- |
| The wheel | the machine accumulates `SDL_EVENT_MOUSE_WHEEL` notches (`ui_wheel_pop`, 10px each, sign unchanged) and the tick retargets the track: the offset glides to exactly 10 (a burst of notches in one frame is a flick whose decay lands clamped), and past an end the `rubber` band resists the notch and lets go 80ms after the last one. The wheel is gated on the pointer being over the viewport (Clay scrolled only the container under the pointer; the page keeps that rule itself, in `List`'s `wheel`) or over the visible thumb, which is the viewport's chrome. |
| The drag | a press inside the viewport (`onPress`) grabs the offset and the host's `onPointer` makes it 1:1 from the press point — no track in between — with the same `rubber` past an end; the release hands the last frames' speed to a decay. Travel past 4px is a drag and not a click; the drag never selects (the selection is the keyboard's). |
| The scrollbar | `viewScroll.thumb()` is the press's: a visible thumb grabs the offset where it is and its travel is the offset's whole range (`max/(view - thumbHeight)`), clamping at both ends, no fling. The machine writes its box and its fade every frame (see `solid/src/vscroll.ts` and `native/README.md`, "The scrollbar"): height `max(24, 240²/898)` = 64.14, top `offset/658·175.86`, 4px wide 2px in from the right edge, as a float on the viewport so it does not scroll with the rows; 600ms after the offset stops moving it fades out, and a press on the invisible strip is the page's. |
| A finger | the host's `touch` flag (SDL's finger events, one pointer) drops the 4px click threshold to 0: a touch drag starts at once, and a touch that never moves still clicks. The List's rows have no click, so here it changes only when a press becomes a drag (and therefore whether its release flings). |
| The keys | one Tab stop. Up and Down move the selection a row, PageUp and PageDown eight (the viewport holds eight), Home and End to the ends, clamped: no wrap, never out of 0..29. Each move asks the track for the least offset that shows the row — the reveal — measured from the row's and the viewport's `ui.bounds` of the last frame and against the track's *target* (not what it presents), so a key pressed mid-animation still lands with the row in view. The active row also comes into view when the list takes the focus, as a browser's does. |
| The selection | a signal: the selected row is the panel's `surface` with its label in the `accent` (the tree's selected node) and takes the same 2px `ring` while the list has the focus. The wheel does not touch it, so scrolling and the selection only agree when a key moves it. |

| Frame | Keys | Shows |
| --- | --- | --- |
| `list-top` | `--warm 30` | the page at rest: `Room A1 — 1 of 30`, rows 1..8 of 30, no ring, no thumb (it faded out) |
| `list-entry` | `--settle 3` | four frames into the first mount: the page `5/6/8` of its `16/18/24`, the selected row `12/14/18` of its `36/40/52` (still lighter), the top 8px the ground |
| `list-wheel` | `--wheel 32 --settle 90` | rows 12..19 at offset -320: the row above cut to its last 8px and row 19 cut at the viewport's bottom (its glyphs stop at the border), the header still `1 of 30` |
| `list-select` | Tab, ArrowDown ×12, `--settle 90` | `Room A3 — 13 of 30`, the view scrolled by 148px so that row 13 is the last in view, the ring on it |
| `list-light` | the same, light | the light theme: the white selected row, the blue ring |

Checked by `bun solid/list.test.ts`: the viewport 240 and its rows 28 on a 30px pitch (898 of content), the wheel moving
the offset 10px a notch with the rows moving by exactly that, the offset stopping at 0 and at -658 (both clamps), the
clip (a selected row 10px above the viewport: its bounds are not clipped, the pixel just above the viewport is the page
and the one 5px inside it the row's fill; past the bottom the page again), the keyboard selection scrolling into view
(12 Downs scroll by 148, PageDown to 21, End to 30 at -658, Home back to 0 and never past the ends), the wheel leaving the
selection alone and a key bringing it back, a held pointer dragging the viewport 1:1 and stopping at the release (clamped
at both ends; a press above the viewport grabs nothing; the wheel and the keys still work beside it), the page's first
mount (four frames in the page is `5/6/8` of its `16/18/24` and the selected row `12/14/18` of its `36/40/52`, the frame
is `frames/list-entry.png`, the boxes are the settled ones and the literals come back at rest; reduced motion has no
entry), the header and footer unmoved by the scroll, the ring's pixels (the row's
edge is its fill before Tab and the ring after), the wheel only reaching the container under the pointer, **the scrollbar**
(its box `314,4x64.14` at the top, `314,189.7` at 330 and its bottom on the viewport's bottom at 658; the fade's pixels
from the row's `36/40/52` into the muted `149/154/169` and back out; a 10px drag on the thumb moving the offset 37.4 and
clamping at 658 and 0; the invisible strip at rest being the page's own drag), **a finger** (a 1:1 drag, and a 2px one
that flings where the mouse's rests at 2), reduced motion (no band, no fling, a key at once, and the thumb shown at once
and dropped at once — 600ms, no fade), and the page fitting its window. The stored frames are taken after `--warm 30`,
which is the settled page the frames before the entry were: all four are byte-identical, the `--settle 90` ones
included (90, not 60, because the fade needs 600ms plus its 0.15s after the track stops; the pixels at rest are the
pixels they were).

**Mutation check.** Dropping `reveal(i)` from `select` (never scroll the selection into view) fails eleven asserts of
`solid/list.test.ts` (the arrows, PageDown, End and the wheel-then-key move); the file is compared with its backup after
the revert.

## The Sky page

`bun solid/main.ts sky` is **csssky's feed** (`apps/csssky` of this repository) as the first real app on this
renderer: a phone-shaped 360x760 page whose data is the app's own recorded fixtures, not a fetch. The bar holds the
wordmark and the three feeds as a **headless tablist** (`createTabs`: one Tab stop on the active tab, Left/Right and
Home/End move it and switch the feed); the feed is one Clay clip element (`sky-feed`, the rest of the window's height)
that the wheel scrolls and the keyboard scrolls through `ui_scroll_to`; the status line under it names the feed and its
post count, or the card a click selected.

| | |
| --- | --- |
| The posts | the same six `terminal/sky.c` carries, verbatim from `home-discover-1.json` (Michael Warburton, Titania, alexjungle), `home-science-1.json` (Erik Strub, David Blanchflower BSc, Jason GRIZZLED Bittel) and the app's empty News feed. `created` in seconds against the fixtures' capture moment (`SKY_NOW = 1790955571`), so `ago()` and a frame read the same today as when recorded; the counts are the app's compact numbers (`310`, `3.5K`), with words instead of the app's icons because Roboto has no retweet or heart glyph (`8 replies · 32 reposts · 310 likes`). |
| The cards | the panel, radius 12, padding 12, gap 8, the author's 40x40 avatar, the name and the handle with its age, the body, the media line and the counts; the palette is `terminal/sky_styles.ts`'s (the sky dark and light themes, not the web app's Mu theme). A click records the card in a signal (the status line names it) and opens the post's thread (the row below). |
| The thread screen | the page's second screen, under the same bar: a card's press opens the post's thread as a **root float over the content area** (696 = 760 less the bar's 64, pointer captured), so the feed stays declared underneath with its offset and its selected card and back returns to the frame the click left (0 bytes of 1,094,400). A 44px header holds the back control (a `createButton`: role `button`, label "Back", Enter/Space, and Escape as the page's back) and the word "Thread"; below it a second clip element on the page's own scroll machine (a fresh instance per opening, so a thread always starts at its top): 900px of rows in 652, 248 to scroll, a thumb `max(24, 652²/900)` = 472.34 tall with 179.66 of travel. The rows are the app's recorded thread (`test/fixtures/thread.json`) as the page's own `Post` literals: the root is the clicked post with its counts and the accent border (`cardOn`, the app's focused post), then replies whose wrapper's left padding is **16px a level** (the app's margin-left), so the cards start at x 12, 28, 44, 44, 60 and 76 — `jlp2024.bsky.social` at 1, a tombstone at 2, `Katie Korth` at 2, `Mdubs949` at 3 and the "Show 1 more reply" row at 4, which is the row a branch cut at the app's `MAX_DEPTH` (3) ends in. The rows are `apps/csssky-tui`'s `rowsOf` transcribed (its nodes are the API's `ThreadNode` over `PostView`); the words and the limit are imported from `apps/csssky/src/thread/model.ts`. Two Tab stops (the back control and the clip: Down/Up 40, PageDown/PageUp a viewport, Home/End) and no card is one; Escape and a click on a tab return to the feed, and the **history is one deep** (a "Show N more" row's thread returns to its thread, a card's to the feed). The screen enters as one group — 12px low, 0 opacity, 0.3s, the card entry's tracks — and leaves the same way reversed under `presence(0.3)`, so reduced motion has neither. The a11y tree: a `region` "Thread — @handle", an `article` per post named by its author, a `note` for the tombstone, a `button` for the more row, the covered feed pruned. |
| The avatars | `css.image(path, { width: 40, height: 40 })` — the six committed 64x64 PNGs of `examples/sky/avatars.py` (a disc in the author's hue, transparent outside it, so the panel shows at the box's corners). The path is a literal per author because a css style is evaluated when its module loads: a page cannot build one from a loop variable. This is the first page that uses `css.image` in the Solid path. |
| Wrapping | new on this page: a body is a `text` with `whiteSpace("normal")` and `lineHeight(20)` inside a stretch box inside a card of percent width, and Clay wraps it. (A clip element lets its children grow past the viewport for their content, so a card that must wrap cannot take its width from a stretch inside the feed: the card is `width("100%")`.) |
| Scrolling | the feed's offset is a page-owned motion track (`solid/src/motion.ts`): a wheel notch is 10px on a spring that glides it, a burst of notches is a flick whose decay lands (clamped) at the end, and one Tab stop on the feed retargets the same track with Down/Up 40px, PageDown/PageUp a viewport and Home/End. The page turns `ui_auto_scroll` off, so Clay's own container does not also move; `ui.scrollTo("sky-feed", -x)` puts the value on it each frame. Discover's three short posts fit the 664px viewport (max 0), so the wheel frame and the test scroll **Science** (742px of content, 78px of travel). |
| The drag | a press inside the feed grabs the offset (`onPress`, then the host's `onPointer` on the same frame) and, while the button is held, the offset *is* `place(grabFrom - (y - grabY))` — the pointer's travel from the press point, 1:1, with the same `rubber` past an end as the wheel's pull, and no track in between. Travel past 4px makes the press a drag, and the card's `onClick` is dropped (`held && dragMoved`), so a drag never selects and a click that did not move still does. A **finger's** drag has no 4px threshold (the host's `touch` flag, 0 instead of 4): any travel is a drag, so a finger's 2px swipe does not select the card under it, while a finger's tap that never moves still does. The release hands the speed of the last five samples (no span under 1/120s) to a `decay`: the fling runs to its projection inside the content or springs to the clamp past an end, and a release in the band lets the band go. Reduced motion drags 1:1 and flings nothing. `main.ts --drag-feed X,Y,DY,...` scripts one headless. |
| The scrollbar | the feed has one too (`sky-thumb`, the machine's `thumbOf` at the feed's right edge): 4px wide 2px in, `max(24, 664²/742)` = 594.2 tall on Science (whose content is 742 in the 664 viewport), its top at `offset/78·69.8`, and **height 0 on Discover**, whose three short posts fit. It is a float on the feed, so it draws over the cards and does not scroll with them; it fades in while the offset moves and out 600ms after it stops; a press on it drags the offset by the thumb's travel (`78/69.8` a px) and the cards under it are not pressed. `solid/sky.test.ts` checks the box, the fade's pixels, the drag and the 0 on Discover. |
| The rubber band | a notch past an end is a **pull** of that end, not a scroll: while the content is at the end (or already past it) the wheel moves it by Rune's and iOS's resistance, `f(x) = (1 - 1/(x·c/d + 1))·d` with `c = 0.55` and `d` the viewport's 664 (`motion.ts`'s `rubber`); `x` is the raw overshoot the notches have accumulated, so the first 10px past the end move 5.45 and the 40th only 21.29. Eight frames without a notch — 80ms — and it springs back on `spatial(0.35, 0.1)` to the clamp, settling exactly on it; a key drops it at once; a notch the other way walks it back. A notch that only *reaches* the end while the content is still travelling there is a scroll like any other (the flick's clamp), so nothing jumps. The band goes on Clay's clip element through `ui_scroll_put` (the unclamped sibling of `ui_scroll_to`, since Clay's own clamp is the content's). Reduced motion has no band: the wheel is clamped hard. |
| The entry | on mount (once — a tab switch draws its feed at rest) every card starts 12px low and at 0 opacity and settles on its literals in 0.3s: `TRANSLATE_Y` on `spatial(0.3)` and `ALPHA` on `effect(0.3)`, the group of the element's whole subtree, so not one box moves (`ui_bounds` is the settled one on the first frame). Each card starts 50ms (3 frames) after the one above it. Reduced motion starts no track at all: the settled frame at once. |
| Hover | the card's and the tab's hover is a 120ms fade (`effect`), not a style switch. The card fades its four background floats from the panel tone to the hover tone **and** its gradient's opacity (`GRADIENT_ALPHA`), so the resting gradient fades out under the hover one: the card alternates two styles (`card`, `cardHover`) and the page keeps the hover one while the fade runs either way (a `:hover` state would drop the gradient the moment the pointer left). A tab has no gradient, so its four channels are enough; a tab's 2px underline is its own border colour (`BORDER_ALPHA`), which fades in on the tab that becomes active and out of the one that was — a colour, not a slide. **The label beside the underline fades too**: a text's colour is not in the tab's box's floats, so the `<text id="sky-tabs-label-i">` carries an id and the page fades the text's own four floats (`FIELDS.TEXT_COLOR`, 51..54) on `effect(0.15)`, muted → accent on the tab that becomes active and back on the one that was, retargeted from the presented colour, so the label and its underline move together. A label that has settled writes nothing: its literal is the end it is on (the page swaps `tabText`/`tabTextOn` at the switch, and Clay's text command carries the colour, so the fading frames draw and the settled one is the literal's). The ends are read from the packed variants under the frame's theme, so the light palette fades between its own tones; a selected card keeps `cardOn` and does not fade. |

| Frame | Keys | Shows |
| --- | --- | --- |
| `sky` | `--settle 40` | Discover at rest: the bar, three cards (Michael, Titania, alexjungle), the status `Discover — 3 posts` |
| `sky-science` | a click on `(180, 32)`, `--settle 40` | Science: Erik's four-line body and its link line, David, Jason (cut at the feed's bottom), the ring on the clicked tab |
| `sky-light` | `THEME=light --settle 40` | the same Discover feed in the palette's light theme |
| `sky-scrolled` | the Science click, `--wheel 8 --wheel-over sky-feed --settle 90` | the Science feed eight notches down, settled at the clamped 78px: Erik's card cut at the top, Jason's at the bottom, the bar and status unmoved. 90 frames, not 60: the scrollbar's 600ms hold and 0.15s fade come after the track stops, so a frame at rest is a little later — and it is the same pixels as before, the thumb being out |
| `sky-entry` | `--settle 9` | ten frames in: the three cards arriving, 2, 4 and 10px of their 12 below their boxes, translucent, each further behind the one above it |
| `sky-hover` | `--settle 40 --move 180 300 3` | the pointer on the second card three frames into its 120ms fade: its colour between the panel and the hover tone |
| `sky-band` | `--warm 40 --wheel 4 --wheel-over sky-status` | Discover four notches past its end (its content is shorter than the viewport, so the first notch is already past it): the cards 21.3px out of the clamp, the top one cut, the bar and status unmoved |
| `sky-tab-mid` | `--warm 40 --keys Tab,ArrowRight --settle 2` | a tab switch two frames in: the ring on Science, its label between the muted token and the accent (`139/152/165 → 126/152/176`), Discover's label going the other way, both underlines mid-fade |
| `sky-thread` | `--warm 40 --click 180 380 --settle 40` | Titania's thread at rest: Back and Thread, the root card with the accent border, jlp's reply, the tombstone, Katie, Mdubs949 cut at the clip's bottom; the status line is behind the screen |
| `sky-thread-mid` | `--warm 40 --click 180 380 --settle 2` | two frames into the entry: the screen 10px low and faint over the feed |
| `sky-thread-scrolled` | `--warm 40 --click 180 380 --wheel 6 --wheel-rest --settle 90` | six notches down (60px, a rest frame between them so it is not a flick), the thumb faded out again |
| `sky-thread-light` | `THEME=light --warm 40 --click 180 380 --settle 40` | the same thread in the palette's light theme |
| `sky-thread-more` | `--warm 40 --click 180 380 --wheel 20 --wheel-over sky-thread-view --settle 90 --click2 180 730 --settle2 40` | the deeper thread the "Show 1 more reply" row opens (Mdubs949's, with Ryan's reply): the row is only in view at the thread's end, so `main.ts`'s `--click2` presses there after the settle |

Checked by `bun solid/sky.test.ts`: `ago()`/`num()`, the bar 64 / feed 664 / status 32 layout with 8px card gaps, the
avatars' pixels (the panel at the box's corner where the PNG is transparent, the head's tint at the middle, the author's
exact hue in the disc — `74 132 214` for michaelwarburton, `126 108 200` for erikstrub — and the change of author with
the tab), the body and media wrapping (Erik's body four 20px lines, Titania's card one media line taller than
Michael's), hover on a card and a tab, **the entry** (the boxes are the settled ones while the cards arrive, the first
frame draws none of them, eight frames in they are 4, 8 and 12px low — each further behind the one above it, so the
stagger is there — and the last frame is the literal's; reduced motion draws them at rest at once), **the hover's fade**
(a mid frame strictly between the resting and the hover colour, the colour continuing the same way, the leave the same
path back to the literal, and a quick leave and re-enter whose widest frame is 3/255), **the tab's underline** (a mid
frame of the new tab's a blend of the page and the ring, the old one's a blend of the accent and the page, the tabs'
boxes unmoved, then the ring and the page), **the label's colour** (the ink's core found as the pixel furthest from the
page: `139/152/165` muted at rest, `126/152/176`, `106/153/195`, `89/154/211`, `77/155/222` and then exactly the accent
`59/156/240` on the new tab, the old one the same path back to the muted token, a quick switch back inside the two ends
with its widest frame 15/255), **the rubber band** (four notches past 78 land at 99.29 = the formula's
21.29 of the raw 40, a notch back walks it to 97.95, it is still out of the end for four frames and back on the clamp 22
frames later, a flick into the end never steps more than 20px and rests at 78, and reduced motion clamps hard), **the
drag** (each held frame's offset is the pointer's travel — 2, 4, 6, 8, 10 — released at 11.48, the next frame 12.9 and
the rest at 54.95, the speed of the last five samples projected; a 153px drag up presents rubber's f(75) on the clamp and
springs back to 78; a 30px drag on a card does not select it while a click without movement does; a press on the bar grabs
nothing; reduced motion drags 1:1 and stops at the release without a band), one wheel
notch gliding `2.59, 1.92, 1.42…` px a frame to exactly 10 (the bar and status still), eight notches flinging to the
clamped 78 and the settled frame matching `sky-scrolled.png` pixel for pixel, a wheel up mid-throw landing 10px back at
64.05 with no frame's step jumping, the keyboard (Down/Up 40, PageDown a viewport, Home/End, all on the same track and
clamped), the feed's focus ring's pixels, the tabs switching the feed, News' empty box and its centred muted line, the
status naming a clicked card, **the scrollbar** (Science's box `354,4x594.2` with its travel 69.8, its height 0 on
Discover, its fade's pixels in and out of the muted token, a 10px drag on it moving the offset by `78/69.8` a px and
clamping at 78 and 0), **a finger** (a 2px finger drag not selecting the card under it, a 2px mouse drag selecting it, a
finger's tap selecting it), and the page fitting 360x760. `bun solid/motion.test.ts` is the model itself: one path at
any dt, a retarget's continuity, the exact settle, `effect`'s clamp, the decay's projection, `presence` (the exit's
length to a frame, a revive mid-exit at the value the exit presented), `channel`'s one call an element, and reduced
motion (a retarget settled in the call that makes it, a presence that does not wait).
`bun solid/thread.test.ts` is the screen itself: a click on the second card opens its post's thread (the 696/44/652
boxes, the root card 336x208 at 12,120 with the accent border, the replies at x 28, 44, 44, 60 and the more row at 76,
the tombstone's words, the "Show 1 more reply" label, the status line still naming the selected post); its own scroll
(one notch 10px, End/PageDown 248, Up 40 from the end, the thumb the machine's `thumbOf(900, 652, offset)` at 354 and 4px
wide, the feed's offset still 0); back — the control, Escape and a click on the tab — with the same offset and the same
selected card, its frame byte-identical to the one before the click (0 bytes of 1,094,400); the one-deep history (the
more row's thread returns to the first thread, whose back returns to the feed, and the deeper thread starts at its own
top); reduced motion (the first frame is the settled screen, which is the stored frame's, and the exit unmounts on the
falling edge); the entry (the first frame draws none of the screen, two frames in the root's border is a blend between
the feed's pixel and the accent, the layout still); the a11y tree (13 nodes: the three tabs, the region, Back, four
articles, the note and the more button); the stored frame; and the two mutations (see below).

**Mutations.** Dropping `css.image` from Michael's avatar box (a bare 40x40 box) fails the two disc asserts (the middle
and the body are the panel `[23,27,32]`, not `[99,178,255]`/`[74,132,214]`). Making the body `nowrap` fails the wrap
asserts (alexjungle's body 20px, Erik's 60, David's 20) and, because the Science content then shrinks to 678, the scroll
asserts too (the offset stops at -14). `Track.retarget` resetting `v0` to 0 after sampling fails the mid-flight block
(`FAIL and it turns the throw back: the rest is 64, ten px above the 74 it was heading to: 27.87, wanted 64.05`).
Dropping the four `FIELDS.TEXT_COLOR` writes (the label keeps its style's literal and never fades) fails `FAIL and the
next frame is strictly between the muted token and the accent: false, wanted true` with every frame of both labels at
their ends (`59/156/240` and `139/152/165` throughout), and three more of that block. In the thread screen, dropping
the row wrapper's left padding fails `FAIL a reply's box is its depth's indent in from the clip (drop the wrapper's
padding and it is 12): 12, wanted 28`, and reusing the thread's offset for the feed on back fails `FAIL the feed's offset
after back is its own (0; a thread offset reused for it would be 244): -78, wanted 0` and `FAIL the feed's frame after
back differs in 0 bytes (a reused offset would scroll the feed to its end): 667725, wanted 0`. All files are compared
with their backup after the revert.

**What is not here.** No fetching and no paging: one recorded fixture per feed (three posts), News empty as in the app,
and the thread is that fixture's for whichever card is pressed (no AppView request, and no reply's own thread beyond the
one branch the data holds). The settings screen is not a page yet. No images in post media — the media is a line (`[image]`, `[image: …]`,
`[video]`, `[link: …]`), as in the terminal. No avatars beyond the six committed PNGs (a real author's avatar is a remote
file). The drag is the window's mouse or a finger's events (SDL's finger events go into the same pointer; there is no
touchscreen here, so no finger has tried it). The name and the handle are two lines,
not the app's one row: the longest pair does not fit the 312px card and Clay has no ellipsis. A media line wraps at
spaces only, so a word wider than the card would run over the gutter: the Science link carries the app's own fallback
for an embed with no title, the host (`[link: sciencedirect.com]`), not its 60-character URI. And the light theme is the
TUI palette's light one, not the system's.

**The thread is fetched now, through an injectable loader.** The rows above are the transcription this replaced: the page
takes a `load: (uri: string) => ThreadScreen | Promise<ThreadScreen>` (`Sky`'s prop) and asks it for a card's post by the
record's own at-uri (the `Post` literals carry the fixtures' uris), so `bun solid/main.ts sky` needs a loader from the
host and `solid/thread.test.ts` injects a promise it settles per ask. `solid/src/skyload.ts` is the host's, by flag:
**the default is the AppView** — `fetchThread`, `GET
https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=…&depth=6&parentHeight=20` with
`AbortSignal.timeout(8000)` and no retry (the API call `apps/csssky/src/api.ts` makes, written out: the page has no
atcute client); `--offline` is apps/csssky's recorded answer (`test/fixtures/thread.json`, shaped by the page's
`screenOf`); `--pending` is a promise that never settles (the loading state's frame) and `--fail` a loader that throws
(the error's). **A headless run is offline whether or not the flag is given** (`--png`/`--expect`): a stored frame that
depended on a request would be a flaky oracle, and this machine has no network at all. The window fetches, which is the
page's real path.

The screen has **three states**, all on the same entry (`presence`, 12px and alpha over 0.3s): the press mounts it in
**loading** — the header, and the tombstone card's style as one muted row, `336x44` at `12,120`, "Loading the thread…";
the answer lands in the **rows**, which are the app's own flattening — `rowsOf` from `apps/csssky-tui/src/model.ts`
(over the page's `screenOf`: the parent chain, `nodeOf`'s replies sorted by the app's `topFirst`, tombstones for
blocked/not-found posts), `MAX_DEPTH` 3 and `moreLabel`/`goneText` the app's — with each `PostView` mapped into the card
in one function, `postOf` (name, handle, the record's text and `createdAt`, the counts, and the media as the terminal's
line, `mediaText(embedParts(p).media)`); a post with an empty record draws no text (an empty `ui_text` is not a box). A
**reject** is the **error** state — "The thread could not be loaded" in the same `44px` card and a **Retry** row
(`336x36`, the more row's style) under it, which asks again for the same uri. That is the offline choice: the failure is
shown as a failure with a retry, and the recording is only ever drawn where nothing is asking (an error that fell back to
a recording would read as the thread that failed to arrive). An answer that a back, a tab or a second press overtook is
dropped (an ask counter), and a card whose record has no uri opens nothing.

**What the recording makes of it.** `thread.json` is Mina Kimes' *reply by Bluesky* (it has a `parent`), so `--offline`'s
thread is ten rows: Mina Kimes (the parent, `280` tall: her paragraphs and her link line), Bluesky (the root, `136`, the
accent border, `@bsky.app · Sep 10`), then the app's sorted replies — Mina again (226 likes), Mdubs949 (4) with Ryan at
depth 2, then jlp2024, Davide Aversa, Katie Korth, Juanita, rmar124. `1758` of rows in the clip's `652`: `1106` to scroll,
the thumb `max(24, 652²/1758)` = `241.81`, and the depth-1 cards at x 28, the depth-2 one at 44. The parent's card has no
avatar and no accent border (it is not the screen's post), and the avatar is still only the six committed PNGs', so the
answer's authors have none. The import costs ~50 ms of Bun's startup (`time bun -e 'await import("./apps/csssky-tui/src/model.ts")'`),
not a frame.

| Frame | Keys | Shows |
| --- | --- | --- |
| `sky-thread` | `--warm 40 --click 180 380 --settle 40` (offline) | the recording's thread at rest: Back, Thread, Mina Kimes' parent card, Bluesky's with the accent border, then the sorted replies down past the clip |
| `sky-thread-mid` | `--settle 2` | two frames into the entry: the screen 10px low and faint over the feed |
| `sky-thread-scrolled` | `--wheel 6 --wheel-rest --settle 90` | six notches down (60px), the thumb faded out |
| `sky-thread-light` | `THEME=light … --settle 40` | the same thread in the palette's light theme |
| `sky-thread-more` | `--wheel 20 --wheel-over sky-thread-view --settle 90 --click2 180 730 --settle2 40` | twenty notches down (the flick settles at 508 of the 1106); the second click lands on a post's card, since the recording has no branch to cut |
| `sky-thread-loading` | `--settle 40 --pending` | the loading state: Back, Thread, one muted "Loading the thread…" row |
| `sky-thread-error` | `--settle 40 --fail` | the error state: the note, and Retry under it |

The five frames that existed were **re-stored deliberately**, and this is what moved: the root is the answer's post
(Bluesky, not the pressed card's Titania — offline the recording answers for whichever card is pressed, as the terminal's
frame does), the old tombstone and its "Show 1 more reply" row are rows the recording does not contain, and the four
transcribed replies are the recording's middle in the *unsorted* order the transcription had (the page now shows the
app's: Mina's 226-like reply first, Ryan nested under Mdubs949). `solid/thread.test.ts` is the states': a manual loader
per ask (a promise the test resolves, rejects or leaves pending) — the loading row and its frame, the answer's ten rows
and their indents and heights, the error and the retry's second ask for the same uri, a tombstone and the cut's more row
from a screen built out of the recording's own posts (its press asks for the cut post's uri; back restores the parent
without a third ask), a pending answer a back overtook, the scroll's `1758`/`1106`/`241.81`, back's byte-identical frame,
reduced motion's stored frame, the a11y tree of all three states, the stored frame (`the recorded fixture reproduces it
byte for byte`), and a mutation per state: an at-once loader never draws the loading row (its frame is not the pending
one), and a reject after a loaded thread shows the error's two rows, not the thread that was up.

## The profile screen

`app/Profile.tsx` is the page's **third screen**: a post card's **author** — its name-and-handle row, the app's own
`<a href="/profile/<handle>">` on the name (`apps/csssky/src/post/Post.tsx`) — is a press of its own, while the avatar
and the rest of the card still open the post's thread, and a thread's cards' authors open it too. It is built as the
thread is: a **root float over the content area** under the same bar (the thread's style, declared after it, so drawn
over it when a thread is under it), a 44px header with the back control and the word "Profile", and its own clip element
on the page's own scroll machine (a third instance). The history is **one deep**: a profile from a card's author returns
to the feed, and its frame is byte-identical to the one before the press (0 bytes of 1,094,400); one opened from a
thread's card returns to that thread, its rows and its own offset untouched under the profile.

The header is the app's recorded profile, mapped by one function: `app/profile.ts`'s `profileOf` reads
`apps/csssky/test/fixtures/profile-head.json` and the three author feeds at run time with `readFileSync` (the way
`apps/csssky-tui` reads its models — ~140 KB of JSON, so not transcribed), once, on the first opening, and maps the
`ProfileViewDetailed` into the page's record: the drawn 56px disc (the recording's author, bsky.app, has no committed
PNG, so it is the app's fallback tile, not an image), the display name, `@handle`, the bio (a `whiteSpace("normal")`
text in a stretch box, so Clay wraps it) and the three counts in the app's words (`apps/csssky/src/post/model.ts`'s
`count` with the profile's `|| "0"`): `35M followers · 15 following · 865 posts`. Below it the app's three tabs —
**Posts, Replies, Media** (`TABS` of `apps/csssky/src/profile/model.ts`) — as a headless tablist like the bar's
(`createTabs`: one Tab stop, Left/Right and Home/End move and switch, the 2px underline, the ring when a click focuses
one), and each tab is its fixture's cards, drawn by the page's own card (`styles.card`): 11, 10 and 13 of them, the Media
tab's every card with its `[image: …]`/`[video]`/`[link: …]` line. The header and the tablist stay put; the list scrolls
under them on the machine, whose instance is **fresh per tab** — a switch starts the list at the top, never at the old
tab's offset (the test scrolled 70.8 first and the media list is at 0). The screen enters and leaves as one group on the
card entry's tracks (`presence(0.3)`, so reduced motion has neither). The a11y tree: a `region` named
`Profile — @bsky.app`, a `button` "Back", the tablist, and one `article` per card named by its author, with the feed
(and a thread under it) pruned.

| Frame | Keys | Shows |
| --- | --- | --- |
| `sky-profile` | `--warm 40 --click 180 155 --settle 40` | the profile at rest: Back and Profile, the disc, Bluesky, `@bsky.app`, the bio, the counts, the Posts tab underlined, its first cards |
| `sky-profile-mid` | `--settle 2` | two frames into the entry: the screen 10px low and faint over the feed |
| `sky-profile-media` | `--settle 40 --click2 178 289 --settle2 40` | the Media tab (a second headless click after the settle): thirteen cards with their media lines, the tab's ring and underline |
| `sky-profile-light` | `THEME=light … --settle 40` | the same profile in the palette's light theme (the screen's own token set, `--profile-color-*`) |

`bun solid/profile.test.ts` is the screen's: the recording through `profileOf` (the head's fields and the three tabs'
11/10/13 cards and their media lines), the press (the header's 44, the head's 166, the tablist's 35.58 and the list's
clip 450.43; the back 28 tall at 12; the name, handle, bio and counts' text; the drawn disc; the underlined first tab;
the body's press still opening the thread), the tabs switching the list (Posts' 11, Replies' 10 and Aster ID first,
Media's 13 with 13 media lines), the list's own scroll (2652 of content in the 450.43 clip → 2201.57, the thumb
`max(24, 450.43²/2652)` = 51.16 at 354/4px, one notch 10, End/Home, and a switch to 0), back / Escape / the bar's tab
returning to the feed's frame byte for byte with nothing focused, a profile from a thread back to that thread at its own
offset, the entry's blend, reduced motion's stored frame and no exit, the a11y tree (22 nodes), the stored frames, and
the mutations — the author's row opening the profile alone (the card's press is still the thread's), the media tab's
list at 0 with its 13 cards after the Posts list was scrolled, and the feed's offset still 0 while the profile's moved.

**The settings screen is the page's third** (`app/Settings.tsx`, `bun solid/main.ts sky` then the gear). A gear at the
bar's right end — the app's Settings nav item, three 16x2 boxes since Roboto has no gear — opens a screen built like the
thread's: a root float one z above the thread's (696 = the window less the bar, pointer captured, so it stacks over a
thread and its back returns to that thread), a 44px header with the back control and "Settings", its own clip element on
a third instance of the page's scroll machine (the three panel rows fit its 652, so it never scrolls and its thumb stays
out), and the card entry as one group — 12px low and 0 opacity on `spatial(0.3)`/`effect(0.3)`, reversed under
`presence(0.3)`, and reduced motion neither. Escape (from either stop or the page's last resort), the back control and a
click on a tab return to what was up — the feed, or the thread the gear was pressed over, the history one step — and the
focus the opening pushed is popped back, so the frame under it is byte-identical. Five stops are the screen's while it
is up and disabled while it is down (the back control, the theme group, the switch, the size group, the clip), with the
covered screen's stops disabled under it.

The three rows are the app's own settings, each one real: **Theme** is a `createRadioGroup` (Dark/Light) — a controlled
group, since the page's theme is the truth — and its pick is written back to the host through `Sky`'s `setTheme` prop
(`main.ts`'s own `theme` variable, which its frame's `theme` getter reads for every style's variant, as its `t` key
flips it): the whole palette turns, the page's fade ends with it. **Reduced motion** is a `createSwitch` over
`setReducedMotion`, starting on the platform's `--reduced-motion` flag: the tracks then land at once, so the frame after
a card's click is the settled thread. **Text size** is a second radio group (Regular/Large): the page's styles are
literals, so the feed card's five text styles get a Large variant each, two steps up in `fontSize` and `lineHeight` (a
Clay text carries both as numbers; a token cannot), and the feed re-measures on the frame the size changed (`Sky` drops
its height cache then: `tick`'s answer), its content, its thumb and its end with it. The values are signals for as long
as the page runs — no storage, nothing persisted — and the palette they are drawn from is `app/Sky.styles.ts`, so the
bar, the feed, the thread and this screen are one set of tokens.

| Frame | Keys | Shows |
| --- | --- | --- |
| `sky-settings` | `--warm 40 --click 324 32 --settle 40` | the screen at rest: Back, Settings, the Theme row with Dark checked, the switch off, Text size with Regular checked |
| `sky-settings-mid` | `--settle 2` | two frames into the entry: the screen 10px low and faint over the feed |
| `sky-settings-light` | `THEME=light … --keys Tab,ArrowRight --settle 40` | the light palette with Light picked (the theme group is one Tab from Back, an arrow checks it) |
| `sky-settings-large` | `--keys Tab,Tab,Tab,ArrowRight --settle 40` | Large picked (three Tabs to the size group), the ring on it |

Checked by `bun solid/settings.test.ts`: the gear's box (40x28 at x 303.86, the tabs unmoved), the screen's
`0,64 360x696`, its 44px header, the three rows (75.58/56/75.58 tall, 8 apart) and the clip's no-thumb; the Tab order of
the screen (Back, the theme group, the switch, the size group, the clip, then nothing) and the a11y tree (the gear a
button named "Settings", the region, the two `radiogroup`s with their radios' `checked`, the switch, the covered feed
pruned); the theme (`16/19/22` → `243/245/247` at the bar, at the screen and `27/32/38` → `255/255/255` at a row, the ring
on the picked radio and back); reduced motion (the switch is `reduced()`, the click's next frame is the settled thread —
0 bytes of the 20-frame one — and without it 672,965 bytes off); the text size (the card 190 → 222, the body's box 20 →
44, Science's content 742 → 830, the thumb 531.2 tall, the end 166, and back at Regular the card 190 and the feed's frame
byte-identical); back (the control, Escape from a stop and from nothing, a tab click) to the feed's exact frame; the
screen opened over a thread, back to that thread's frame with the thread's back focused again and its clip its next stop;
the entry's own two frames and reduced motion's one; the stored frame byte for byte; and a mutation per control (the
theme reaching the bar as well as the screen, the switch being the page's flag, the size the cards'). The fifteen frames
that show the bar were re-stored deliberately: the gear's 96 pixels in a 16x12 box at 315,26 are the whole difference in
every one of them, and the command golden gained its three rectangles and the one node.

## The text sheet, and the oracles behind it

`app/Sheet.tsx` is not an app page: twelve lines of the strings and sizes the pages draw (11 to 32 px) in one column,
nothing that moves. It is the subject of the text oracles. `solid/text-oracle.swift` draws the same lines at the same
places with CoreText (at 1x into `frames/text-oracle.png`, at the window's density into `frames/text-oracle-2x.png`), and
`solid/text-canvas.mjs` the same with Chrome's Canvas2D (`frames/text-canvas.png`, the web target's rasteriser, through
Playwright). `solid/src/textmetric.ts` measures a line's **ink** — its coverage against the page's and the text's colour,
summed — and its **SSIM** against the reference at the best whole-pixel shift. `solid/text.test.ts` holds the frame to
all three references at their densities (no shift, a weight band per reference, an SSIM floor, the extent within a pixel
or two) and prints the tables; `bun solid/text-oracle.ts [--density 2|--canvas|--weight N|--sweep|--update]` prints and
re-stores.

The verdict is in `../README.md` ("Text: the oracles"): ThorVG's text weighs **1.008** of CoreText's on average (and
1.005 at the window's 2x density, where the glyphs are rasterised rather than enlarged), so the renderer's weight dial is
at 0; the browser target's Canvas2D is **1.37x** our ink and is recorded, not matched; and the one real defect is that
ThorVG has no fallback font (the ⅓ of the sheet's quote line is an empty box, SSIM 0.459 — asserted, not hidden).

## The Figure page: one spec, drawn

`app/Figure.tsx` (and `app/Figure.styles.ts`, its palette and roles) is the tenth page and the one that is not an app:
it takes `{ spec }`, a glyph-kit spec in the shape `src/figure/spec.ts` checks, and declares the layout `src/figure/kinds.ts`
looks up for its kind — a title, the rows (a label, a bar or a row of boxes, the number as text), the source and the `►`
focus line. No state, no input, no entry: the page at rest is the frame its literals and its widths make.

`src/figure/` is five files and one directory: `spec.ts` (the format, `parse`, and the checks about the spec as a whole —
a source, a focus's names, the width), `registry.ts` (the `Layout`/`Item` types, the cell constants, `sizeOf`, and the
table from a kind's name to its layout and its check), `kinds.ts` (the door: the five areas loaded once and the types and
the table re-exported), `contrast.ts` (WCAG's two functions, no dependency) and `text.ts` (the same layout as characters);
`kinds/` is an area a file — `metrics.ts`, `flows.ts`, `structure.ts`, `systems.ts`, `handoff.ts` — each holding its kinds' layouts and
checks side by side over `kinds/shared.ts`'s item builders, with one `register` call a kind. `solid/figure-registry.test.ts`
`kinds/` is an area a file — `metrics.ts`, `flows.ts`, `planning.ts`, `structure.ts`, `systems.ts` — each holding its kinds'
layouts and checks side by side over `kinds/shared.ts`'s item builders, with one `register` call a kind. `solid/figure-registry.test.ts`
is the seam's test: both halves of every kind, the list the docs and the `unknown kind` sentence print, and a throwaway
kind registered in the test alone that draws through `text.ts` and on the desktop.

```
bun solid/main.ts figure --spec solid/specs/bars.json     a window (the size is the layout's: 400x112 here)
bun solid/main.ts figure --spec solid/specs/funnel.json --png out.png
bun solid/main.ts figure --spec solid/specs/compare.json --warm 30 --png out.png
bun solid/main.ts figure --spec solid/specs/tree.json --png solid/frames/figure-tree.png
bun solid/main.ts figure --spec solid/specs/journey-map.json --png solid/frames/figure-journey-map.png
bun solid/main.ts figure --spec solid/specs/bars.json --warm 30 --expect solid/frames/figure-bars.png
```

An invalid spec is refused **before a frame**: `main.ts` reads the file, `parse` returns every sentence `check` has (a
growing funnel, a number with no source, a focus name the figure does not draw, an unknown kind, a flow wider than its
width), prints them and exits 1, so no PNG is written. The 42 drawable specs are `solid/specs/bars.json` (this
repository's own `--bench` numbers by target), `funnel.json`, `compare.json` and `pipeline.json`, the flow kinds
`branch-flow.json` (this repository's spec path, with its two decisions) and `state-machine.json` (the Dialog's
`presence`), the tree `tree.json` (this repository's own map: the four targets under one root, their pages as children),
the journey `journey-map.json` (glyph-kit's first-week example, adapted), the design-system kinds (`palette`, `contrast`,
`colour-roles`, `spacing`, `type-scale`), the Dialog's layers (`layer-stack`) and the pages' states (`state-matrix`),
the planning kinds (`timeline`, `statusKey`, `nowNextLater`), the motion kinds (`motion-timing`, `easing`, `stagger`,
`frame-strip`, `intent-card`, `transition-spec`, `easing-table`), the handoff kinds (`redline`, `before-after`,
`qa-checklist`), the charts (`sparkline`, `meter`, `heatmap`, `forecast`, `cohort`), the wireframes (`screen`, `anatomy`,
`app-shell`, `card-grid`, `list-detail`, `modal`, `responsive-pair`) and the generic table (`table`);
`invalid-funnel.json`, `invalid-branch.json`, `invalid-state.json`, `invalid-tree.json` and `invalid-journey.json` are the
refusals the test uses.

**A spec's data in a file, and the SAMPLE DATA stamp.** `data` may be `"@data/funnel.json"`, a path relative to the
spec's own directory: `parse(text, { dir })` reads it and substitutes the JSON before `check`, and the CLI, `dump.ts`, the
terminal and `--redraw` pass the spec's directory (a caller with inline data calls `parse(text)` as before). `funnel.json`,
`compare.json` and `journey-map.json` keep their rows in `solid/specs/data/`; `solid/figure-file-sample.test.ts` holds each
frame to the inline spec's command for command, so the move moved no cell. A path that is absolute, leaves the directory,
names no file or is not JSON is refused in its sentence. The browser page fetches a `@path` relative to the spec's URL and
inlines it before `parse` (the parser's own read is the Node hosts'), so `?spec=funnel` and `?spec=journey-map` still draw.

`sample: true` draws a band of `=` between `+` caps across the figure's width with the words `SAMPLE DATA` on it, as the
**layout's first line** in the muted role — so the text renderer, the terminal, `Figure.tsx`, the SVG and the HTML page
draw one band and none of them has a branch for it. `sample` is absent when the data is the author's; any other value (a
string, a number, `false`) is refused. The four kit examples — `funnel`, `compare`, `journey-map` and `pipeline` — set
`sample: true`, because their data is not this repository's; our own specs do not, and their first line is the title.
`solid/figure-file-sample.test.ts` covers both fields (18 checks: the parse, the five refusals, the band in the layout,
the SVG and the export, and the four marked specs).

The layout speaks **cells** (8x16 px, the terminal's), so a length here is `cells * 8` across and a line is one cell down;
a width is data and a style is a literal, so every item's width — and a bar's fill — is written through the value channel
in `tick`, before the tree is declared, as the List's spacers are. The terminal host and the browser page import this
component **unmodified**: the terminal's cells are the layout's own unit (no re-cut), and the browser fetches the same
`solid/specs/<name>.json` with `?spec=`. `solid/figure.test.ts` reads the geometry back from the frame (each fill's box
against its track's, within half a cell; over the twelve specs the worst is 0.49), each number's text, the rows' order, the
funnel's ratios and `check`'s sentences, then the same spec's rows on the terminal (`terminal/solid.ts --page figure
--spec ... --dump`) word for word. `solid/goldens/figure.json` is the bars frame's command golden, and
`browser/figure-check.mjs` holds the browser's copy to it within 4 px, with a click that changes nothing.
`figure-branch-flow.json`, `figure-state-machine.json`, `figure-tree.json` and `figure-journey-map.json` are the flow and
row kinds' command goldens, and the browser check reads `?spec=branch-flow`, `?spec=state-machine`, `?spec=tree` and
`?spec=journey-map` from the same files. A tree's level is a row of boxes and a journey stage is a bar row with its notes
under it: the layout draws both, and the text renderer prints them without a kind of its own.

The four **design-system** kinds are the kit's `areas/systems.md` half, and their data is our own tokens:
`palette.json` and `contrast.json` are **generated** by `specs/from-tokens.ts` from `@cssints/tokens`' Open Props scales
and `apps/docs`' palette — every ratio is `packages/cssints/src/color.ts`'s, the engine's — and `solid/test.sh`
regenerates them and `cmp`s; `spacing.json` and `type-scale.json` are hand-written from `apps/docs/src/tokens.json`,
whose line heights a role chooses. The layout gained three things they needed and no earlier kind had: a `swatch` item (a
step's own `#rrggbb`: the one colour a figure draws as itself), a `marker` item (glyph-kit's `▲`, a `good`-role cell on a
pixel target, since Roboto has no `▲`) and a text's `size` with a line's `height` in cells (`typeScale` is the one kind
whose rows differ: a 40px line is three cells). `src/figure/text.ts` draws all three in two branches — `██` for a swatch,
`▲` for a marker — so the text half still reads items and has no kind in it. Their goldens are `figure-palette.json`,
`figure-contrast.json`, `figure-spacing.json` and `figure-type-scale.json`, and the browser reads `?spec=` of each.

The generic **`table`** is the kit's `systems.md` table and not a design system: `table.json` is `native/docs/map.md`'s
Targets table, **generated** by `specs/from-targets.ts` — the four columns whose cells differ row to row, the markdown
backticks off, `options.max` 18 cells — and `solid/figure-handoff.sh` regenerates and `cmp`s it. A heading a column, the
heading once with a rule of `-` under it (off when `headerRule` is false), and a value cut to its column with `…`,
counted in cells and not characters (a CJK glyph is two cells). `solid/figure-table.test.ts` re-parses the map and holds
every cell to it, the cut, a right-aligned column's cells, the refusals, the golden and the terminal's rows; the browser
reads `?spec=table`.

The three **handoff and QA** kinds are the kit's `areas/handoff.md` half, and their data is this repository's own, so a
figure cannot drift from what is drawn or from what passes. `redline.json` is the Widgets page's Wi-Fi switch row: the
row's 10px padding, 4 top and bottom, the 44x24 track, the 12px gap and the 204px label, drawn as a leader row of `·`/`-`
and a numbers row — and `solid/figure-handoff.test.ts` holds every one of those numbers to the **packed style** of
`app/Widgets.tsx` (`src/pack.ts`'s `variant`), 0px out, while the drawn leaders are within half a cell (the worst 4px:
a cell is 8px). `before-after.json` is the same switch off and on: **generated** by `specs/from-frames.ts` from two frames
of the Widgets page (the switch focused in both, `Tab,Tab` and `Tab,Tab,Space`), whose commands differ in exactly two places
— the track's colour (60,64,78 -> 240,140,50) and the thumb's x (2px -> 22px) — and `solid/test.sh` regenerates it and
`cmp`s. Its two panels are the same box side by side, with the numbers that changed under them, computed from the two
states. `qa-checklist.json` is a dozen of the suite's own comparisons, named as the scripts name them (a stored frame the
`solid/test.sh` `--expect` compares, or an `identical "…"` the terminal prints) with a `source` naming the script: the test
refuses a row that no script prints, and `check` refuses a summary that is not its rows' count (`12 of 12 pass`), the three
verdicts painted by the `good`, `problem` and `muted` roles. Their goldens are `figure-redline.json`,
`figure-before-after.json` and `figure-qa-checklist.json`, their frames are `solid/frames/figure-{redline,before-after,qa-checklist}.png`,
and the browser reads `?spec=` of each (`browser/figure-handoff-check.mjs`).

**The seven wireframe kinds** (`src/figure/kinds/wireframe.ts`) are `screen`, `anatomy`, `appShell`, `cardGrid`,
`listDetail`, `modal` and `responsivePair`,
and their data is a **page's own captured frame**: `specs/from-page.ts` runs `dump.ts`'s `capture` and writes the Widgets page's
`rectangle`/`border` boxes and `text` runs into `screen.json` (360x760: 45x48 cells, 23 boxes of 29, 30 runs, 1
shortened), a 296x120 crop of the same page and four callouts into `anatomy.json` (37x8 cells, 5 boxes, 3 runs), and the
Sky feed's into `responsive-pair.json` (240x760 and 360x760: 30x48 and 45x48 cells, 8 boxes and 22 runs a side, side by
side at 77 of 80 cells, above/below at 60); `specs/from-frames.ts` captures the Sky page at rest for `app-shell.json` (its
three bands — `sky-bar` 360x64, `sky-feed` 664 and `sky-status` 32, each the element's own box, tiling the page) and
`card-grid.json` (its three post cards, 336x190, 336x208 and 336x210, one column and an 8px row gap) and `list-detail.json`
(the wide page's two panes: a 720x760 capture with the thread open, `sky-feed-pane` 0,0 360x760 and `sky-thread` 360,0
360x760, tiling the page). A box is its page
rect at `round(x/8)`, `round(y/16)`, `round(w/8)`,
`round(h/16)`, so the wireframe is 1/8 scale and not pixel-accurate — the worst edge is half a cell (4px across, 8px
down) and a 1px rule rounds away; a run is one cell a character, marked `…` when shortened. An anatomy crops before it
cuts: a box crossing the crop is clipped to it and moved to its corner, the page's own background rectangle is dropped
(it is the window, not a component), and each callout's `{ n, x, y, label }` digit lands at `round((x-crop.x)/8)`,
`round((y-crop.y)/16)` — one cell, so `n` is 1 to 9 — over the drawing, with the legend under it. A shell's band and a
grid's card are drawn the same way: the element's own cell rect as a border, its label inside it at the first row the
band has to spare, and a rule on its last row.
`figure-wireframe.test.ts` holds the count, the rects, the runs' order, the pair's sizes, the refusals (an unknown page, a
width over `options.width`, a narrow side wider than the wide, an empty frame, no boxes), the three mutations, the two
goldens and the terminal's rows; `figure-anatomy.test.ts` the crop's clipped boxes and dropped background, each digit's
cell and the characters around it, the legend, its six refusals, its golden, the terminal's rows and three mutations;
`figure-app-shell.test.ts` the three bands as the frame's own elements, their union the page, their labels and rules on
their own cell rows, five refusals, a row read at 8px down, the golden and the terminal's rows (15 checks); and
`figure-card-grid.test.ts` the three cards under `sky-card-`, the grid their boxes make, the note, six refusals, a column
per card, the golden and the terminal's rows (15 checks); `figure-list-detail.test.ts` the two panes as the frame's own
elements, their union the page, the labels and rules on their cell rows, six refusals, a pane 4px off, the golden and the
terminal's rows (18 checks); `solid/test.sh` regenerates the three from-page specs and `figure-handoff.sh` the Sky page's
three, and each is `cmp`'d.

**The seven motion kinds** (`src/figure/kinds/motion.ts`) are `motionTiming`, `easing`, `stagger`, `frameStrip`,
`intentCard`, `transitionSpec` and `easingTable`, and their data is `src/motion.ts`'s own and the pages' own:
`specs/from-motion.ts` runs the solver at 1/60 and writes `motion-timing`, `easing`, `stagger`, `frame-strip` and
`easing-table.json`, `specs/from-frames.ts` captures the Sky feed's card and the Dialog's menu for `intent-card.json` and
`transition-spec.json`, and `solid/test.sh` regenerates and `cmp`s them, so the areas are now nine (`metrics`, `flows`,
`structure`, `systems`, `planning`, `motion`, `handoff`, `charts`, `wireframe`) and 42 specs are drawable.
`figure-motion.test.ts` holds each sample to `Track.at`, each dot to its sample, each strip's box to the track's offset
and the stagger's bars to the items' delays, then the stored frames and goldens, the terminal's rows and the browser's
`?spec=` of each.

The three the half gained are the kit's remaining motion types. `intentCard` is one animation as a card: the
`@cssints/motion` preset whose fields it moves (the package's `presets` table, through `from-frames.ts`'s `presetOf`), a
row a property and the two values it runs between, the duration and delay, the trigger, and the frames the page took — the
Sky feed's third card at nine frames (16.67-666.67ms, waiting its 100ms, alpha 0 → 255 and y 12 → 0 from the group effect
each frame drew), a bar a property a frame filled by its own progress, and the last frame's settle said under them.
`transitionSpec` is one transition before and after: the `dialog-menu` scene's keys in two captures give the menu's box
at the entry's start (`40, 224.16 · 150x133`) and at its settle (`40, 214.16 · 150x133`) and the five properties that
move — the offset, the alpha, the scale, the tilt and the shadow's blur — with 220ms (the Dialog's longest track) and no
delay. `easingTable` is the app's curves: a row a curve (the panel's entry, the menu's slide, the scrim's fade, the
panel's exit, the card's entry, the card's fade and a hover's fade), its class, its duration and bounce, and its progress
at 0, 25, 50, 75 and 100% of its duration — `Track.at`'s own numbers, so the 220ms entry reads 0.00, 49.40, 86.85, 98.04
and 100.04%. The springs and the numbers a page starts an entry from live in `src/animations.ts`, imported by
`app/Dialog.tsx`, `app/Sky.tsx` and both generators. Their stored frames are `solid/frames/figure-{intent-card,
transition-spec,easing-table}.png` (73, 15 and 85 commands) and their goldens `solid/goldens/figure-{intent-card,
transition-spec,easing-table}.json`; the three tests re-capture the page's nine frames, both of the menu's frames and
the Dialog's constants, and the solver at every point — 16, 16 and 14 checks, with the drawing, the refusals, the
terminal's rows and a mutation each — and the browser reads `?spec=` of each.

The three **planning** kinds are the kit's `areas/planning.md` half, and their data is `native/docs/map.md`:
`timeline` is the map's eight steps of work, a step a row on one shared axis (the span is the step's place in the order,
not hours; a recorded date is a `note`); `statusKey` is the legend of the statuses the figures use (Done, Left, and
Blocked, the map's word for work that waits); `nowNextLater` is the map's `Left:` lists as three columns of cards.
`timeline.json` is **generated** by `specs/from-map.ts` from the map's step headings and `cmp`'d in `solid/test.sh`, and
the map draws that timeline under a `<!-- glyph-kit: ../solid/specs/timeline.json -->` fence, redrawn and `cmp`'d too;
`nowNextLater.json` is hand-written — the `Left:` lines mix remaining work with notes of what came later — and
`solid/figure-planning.test.ts` holds every card's words and every status's name to the map's. That test also reads the
timeline's bars back from the frame (each span's start and length within half a cell), the axis's two ends, the key's
entries against the statuses the timeline uses, the board's cards and their order, the refusals with their sentences, the
three command goldens (`figure-timeline.json`, `figure-status-key.json`, `figure-now-next-later.json`) and the same rows
on the terminal.

The three **chart** kinds (`src/figure/kinds/charts.ts`) are `sparkline` (a recorded series as eighths, its min and max
labelled and its last value printed), `meter` (one ratio against a 0..21 track and WCAG's floor, the verdict the engine's
comparison) and `heatmap` (our Open Props grey inks 5..12 on the three pages, a cell one of four shades by its WCAG band).
`specs/from-charts.ts` writes `meter.json` and `heatmap.json` from the palette and `color.ts` and `solid/test.sh`
regenerates and `cmp`s them; `sparkline.json` is hand-written from twelve `--bench 200` draw ms, a recorded series and not
a measurement at render time. The layout gained the `spark` and `shade` items, `text.ts` draws them in two branches, and
`solid/figure-charts.test.ts` holds the eighths, the fill and the verdict, every cell's band and engine ratio, the
refusals, the goldens, the terminal's rows and the mutations.

The chart half's fourth kind, **`forecast`**, is the one whose data no kit has: this repository's own cadence.
`specs/from-releases.ts` counts `CHANGELOG.md`'s 40 dated release headings into a daily series (26 days, 2026-10-10 to
2026-11-04, a quiet day a zero), fits the last 14 (mean 2.50, population sd 2.29) and projects the next 7 at that mean
with the band `mean ± 1 sd` clamped at zero, and `solid/figure-handoff.sh` regenerates and `cmp`s `forecast.json`. The
drawing is the cell grid, a cell a count: a column a day of `#`, the projected days as `=` inside the band's `:` cells,
the series' max at the top and `0` on the baseline, three dates under it, the legend and the fit's own mean and sd — so
the terminal and the text half print the same characters the pixel figure draws. `solid/figure-forecast.test.ts` (22
checks) re-derives the series and the fit from `CHANGELOG.md`, reads a day's column back out of the drawing, the
projected cells' paint and height, the band's width, the legend and the fit, the six refusals, two mutations, the golden
and the terminal's rows; its frame is `solid/frames/figure-forecast.png` and the browser reads `?spec=forecast`.

The chart half's fifth kind, **`cohort`**, is the only one whose data this repository had to collect: Bluesky's public
Jetstream firehose, twenty minutes of `app.bsky.feed.post` (2026-11-07 06:11Z, 17,354 accounts, 33,551 posts), recorded by
`solid/specs/collect-jetstream.ts` into `solid/samples/jetstream.json` — an account's minutes in the window, no text and
no handles. `specs/from-cohort.ts` is the arithmetic on it: a row the accounts that posted in one minute (about 1,300), a
column one to five minutes later (`+1m` … `+5m`), a cell the whole percent of that row's accounts that posted again (13% a
minute later, 10% five minutes later, steady across the fifteen cohorts), with the row's `n` beside it because a share of
three accounts and of three thousand read alike. A cell's paint is the share's band: 20% and up the figure's brightest,
10–19 its ink, under 10 its muted step. The sample is a recording and not a build, so it is committed, and
`solid/figure-handoff.sh` takes `cohort.json` from it by `cmp`; `solid/figure-cohort.test.ts` (15 checks) recomputes the
whole grid from the recording itself, reads the heading and the cells, the paint bands, the six refusals and the mutation a
share over every account would pass (8% against the row's 13%), the golden and the terminal's rows; its frame is
`solid/frames/figure-cohort.png` (111 commands) and the browser reads `?spec=cohort`.

**As text.** `bun solid/figure.ts solid/specs/bars.json` prints the same layout as characters — 80 cells wide, a bar's
fraction as an eighth block, `--compact` for plain ASCII, `--markdown` for a page — and
`bun terminal/solid.ts --page figure --spec ... --text` prints it from the terminal host. `solid/figure-text.test.ts`
holds each bar's text cells to the terminal's (within half a cell, the same tolerance) and the docs' figures to a
byte-identical `--redraw`; `native/README.md`'s eight figures are that renderer's. `--svg <file>` and `--html <file>`
write the same layout as one standalone SVG and one self-contained page (`-` for stdout); both `parse`/`check` first, so
an invalid spec writes nothing. `src/figure/export/` is the pair (the page embeds the SVG verbatim, once), and
`figure-export.test.ts` holds it to the layout, to Chromium's rendered boxes (1 px) and to two `cmp`-identical runs.
`--deck a.json b.json … -o deck.html [--title T]` is a deck: one self-contained page, a slide a spec, each slide that
same `svg(spec)` inline and once, the title on the first slide, `:target` navigation (each slide a Previous and a Next
anchor, the first slide the no-fragment default — CSS only, so no arrow keys and no overview), `prefers-color-scheme`,
`forced-colors` and `@page { size: A4 landscape; margin: 12mm }` + `break-after: page` per slide. `--png <spec> -o
out.png [--scale N]` wraps the desktop host (`bun solid/main.ts figure --spec … --warm 30 --png`, a child process, with
`--density N`: the layout in cells × 8 × N by × 16 × N pixels, default 2). `--pdf a.json b.json … -o deck.pdf` prints
that deck through Playwright's Chromium (`page.pdf()`, A4 landscape, 12 mm margins, one page a slide). All three
`parse`/`check` every spec first, so one bad spec writes no file; `figure-export-deck.test.ts` counts the slides, pages
and pixels, reads the PDF's titles back as text, `cmp`s two runs and mutates the deck, the print CSS and the 2× raster.

## The accessibility tree

`solid/a11y.ts` is the tree a screen reader would walk: `snapshot(root, { parts, containers })` returns
`{ role, name?, value?, states, hasPopup?, level?, bounds?, children }` over the boxes that carry a role, in document
order. The fields are the box's own props first (`role`, `label`, `labelledBy`, `checked`, `expanded`, `selected`,
`disabled`, `focused`, `hidden`, `level`, `value`/`valueText`, `hasPopup`, `modal`), then the part `options.parts` names
by id. The pages spread their parts instead (`a11y(part)`: the part's `id` and each field above as a live getter,
`<box {...bind(part)} {...a11y(part)}>`), so a page's boxes are its parts' boxes and no `options.parts` table is needed;
`options.containers` still adopts a group part whose id is on no box at the lowest common ancestor of its items, but the
pages draw a box for every group now. The name is `label`, else `labelledBy` (the text of the element with that id, when
the tree has it), else the text of the box's descendants outside nested role nodes; a `text` element is never a node.
`hidden` prunes a box and its subtree, and so does an open modal dialog (role `dialog` / `alertdialog`, `modal` not
false): the page behind it is left out of the snapshot, as a screen reader does not see it. `bounds` is `ui.bounds(id)` of
the last frame, for a box with an id only.

`bun solid/a11y.test.ts` asserts the three pages' bare snapshots (`p.snap()`, no table of parts standing in for what a
page drops): every interactive box carries its part's role and the name a reader needs, so a dropped field fails the
test. It checks the Widgets page (the four checkboxes in their `group`, the radiogroup/tablist/toolbar/tree as the page's
own boxes with bounds, the disclosure named `Details` with no `+`/`-` in it, the menu button `Size: Medium` with
`hasPopup`, the tree's rows named by their nodes, the slider named by its caption with `40%` as its value, the mixed and
the disabled box, the disabled box no Tab stop, the tab-focused switch's path), the toolbar's open menu, the Field page
(textboxes named `Name` and `Read-only` through `labelledBy`, the value as typed), the Dialog page (closed: the zoom
trigger `Zoom: 100%` with `hasPopup`; open: the dialog alone, named by its title, the backdrop and the page behind not
nodes; and its menu), the rules on a hand-built tree, and two rules on every page: a role on every node, a non-empty name
on every role that requires one. Mutation: dropping `label` from the disclosure trigger fails the name assertions.

## The dev page

`bun solid/main.ts dev` is the Widgets page with a panel beside it (`solid/app/Dev.tsx`, 660x760: the page's own 360 in
the left column and 300px of panel on the right). The page on the left is the `Widgets` component itself, not a copy —
it is called once and the element it returns is inserted into the dev page's tree — so its keys, its focus, its mouse
behaviour, its ids and its `ui.bounds` are the ones the `widgets` page has. The panel is three sections, and the frames
are `solid/frames/dev.png`, `dev-hover.png`, `dev-light.png` and `dev-tree.png`.

- **The a11y tree**: `snapshot(pageEl)` — the page's subtree only, so the panel's own boxes can never appear in it — as
  indented rows, 8px a level, one per node, in document order: `role "name" [states] x,y w×h`. The name is the one the
  tree resolved (a `text` element's runs, a `labelledBy` target), the states are the node's own (`checked=false`,
  `focused=true`, `disabled=true`, …), and the bounds are `ui.bounds` of the last layout, rounded; a node the page drew
  no box for says `no bounds`. The Widgets page is 28 rows, `button "Presses: 0"` first and the `tree`'s five
  `treeitem`s last.
- **The hovered box**: the innermost box under the pointer that has both an `id` and a `role` (`ui.over` on the way
  down; Clay's `over` is true for a box and all its ancestors), then its id, its role, the name the node with the same
  role and the same bounds has, and `ui.bounds(id)` — `wifi  switch "Wi-Fi"` and `40,118 280×32`. Over the page's
  background, or over the panel, it says `nothing`. A box with no role is not a node (the switch's track and thumb
  report the switch), and a node with no id (a group the page drew no box for) has nothing to ask `ui.bounds` for, so it
  is skipped: the answer is the nearest node that has both.
- **The frame**: the four phases `View.stats` pushes — events+flush, declare, layout, draw, in ms — the mean and the max
  of the last 30 frames, and `ui.draws()`/`ui.presents()`. The draw is the host's: `createDrawer(frame, stats)` writes
  the time `ui.draw()` took into the frame's fourth phase, so a panel reads the raster the loop actually did.

The panel prints *when the page changes*, not every frame, and that is the whole point of the page: it is in the same
Clay frame as the page, so a phase line reprinted every frame changes the frame's hash every frame and a page at rest
could never be seen at rest. A change prints at once and its frame's numbers on the next reading (the frame's own
numbers are pushed after the tick that reads them), so the numbers are the last frame that changed the page and the
counters are the process's as of that reading. Two runs of the same frame therefore differ — 13,661 pixels of the
501,600 — which is why the four stored frames are not compared (`dev.test.ts` checks they are the page's size, and
holds the panel's content).

Measured (Apple M2, one thread, `--bench 200`, five runs, a machine with other work on it: medians):

- the panel's reading — Solid's `flush()`, `snapshot` and the hover walk over ~95 boxes with `ui.over` — is **0.09 ms**
  a frame (events+flush 0.02 without it, 0.11 with).
- its rows cost **0.02 ms** of declare and **0.008 ms** of layout (declare 0.055 → 0.078, layout 0.030 → 0.038).
- its draw is **5.4 ms** on a frame that redraws the panel (2.0 → 7.4 ms a frame at 660x760): ThorVG shapes every text
  command each frame, and the panel is 34 lines of it (~3 µs a glyph). A page at rest never pays it.
- `--idle 200`: **0 draws**, 0.20 ms a frame against the Widgets page's 0.06 — the panel's tick at a page at rest.

The page's own first-mount entry is off (the Widgets page is given no motion hook), so the stored frames are a resting
page with `--warm 30`.

`solid/dev.test.ts` asserts the panel's own strings: the 28 rows of the initial state (roles, names, states, bounds),
the switch's row after two Tabs and the button's after Shift+Tab (the ring's pixel on the same box), Space's
`checked=true`, the tab's row for the hovered box and the button's, `nothing` over the padding and over the panel, the
four phases against the frame that changed the page, the mean/max line, the counters, `0.00` ms of draw and a still
`ui.draws()` over 20 idle frames, the light theme's ground, reduced motion, and the four stored frames' size. Three
mutations were run and reverted: a tree read once at mount fails `FAIL the switch's row is the one that has it:` with
`switch "Wi-Fi" [checked=false] 40,118 280×32` where the focused row is wanted (and three more of that block); the hover
reporting the outermost box fails `FAIL the innermost box under the pointer, not its tablist` (the tablist's id, role and
228×33 where the tab's 97×33 are wanted); and the phases taken from the frame before the last fail `FAIL the panel prints
that frame's four, in ms`.

**Picking** is here too: a press on the page (not on the panel) selects the innermost node under the pointer — a box
with a role and an id, the same one the hovered line reports, so the switch's track reports the switch and the page's
padding reports nothing — moves the tree's cursor to its row (the row starts with `>`), pins the hovered line and
switches the values to it. The pin holds when the pointer leaves; `Escape` or a press on empty space clears it. A box
with no role is never the pick (its nearest node ancestor is), and a node with no id has no `ui.bounds` and no row to
keep. Not here: the panel is one page's (it holds the `Widgets` component's element, so another page needs its own dev
page); the tree has no window/scrolling of its own (a big page's rows would run off the panel); and the numbers are not
resampled while nothing changes. Editing a value live and saving a session *are* here now — the sections below.

### The live values (the fourth section)

`bun solid/main.ts dev`, the panel's fourth section: the picked box's style numbers, edited through the value channel
(`ui.value`) while the page runs. The pointer picks (the innermost box with an id and a role, as the hovered box finds
it) and the box stays picked when the pointer leaves the page; a click pins a box instead (the pick above), and the
overrides are the page's, keyed by element id, so a box keeps its numbers when the pointer picks another. The
first line names it with its bounds, and the rows are the numbers `src/pack.ts`'s `FIELDS` that `ui.c` reads: `width`
and `height` (a stretch or fit axis reads the box's laid-out size, and a step pins the axis to a pixel), the padding's
four sides, `gap`, `radius` (all four corners in one row where they are one number, a row a corner where they are not),
`bg.r/g/b/a`, `border.r/g/b/a` where the style draws a border, a float's `offsetX/offsetY/expandW/expandH/zIndex`, a
shadow's `shadowBlur`, a gradient's `gradientAlpha`, and the group's `alpha`, `scale`, `translateX`, `translateY` and
`rotate`. A row is live even where the renderer only reads it at layout — the page re-declares its tree every frame, so
a width moves a box and its a11y bounds. Not rows: a text's colour (fields 51..54 are a text's own, and the picked
element is a box) and the modes and enums of the 45 (`capture`, `clip`, the sizing type, an alignment, a float's
attach).

`Tab`/`Shift+Tab` walk the page's controls and then the panel's three stops (the tree, the hovered box, the values, the
page's last three); `Up`/`Down` (`Home`/`End`) pick a row, `Left`/`Right` (or `-`/`+`) step it — 1 a pixel, 4 a colour
channel, 0.1 an alpha, 0.01 a scale, 1 a degree — clamped to the field's range; `r` resets the row to the style's
literal and `Shift+R` all of them. A reset drops the override instead of writing the number, so the declare is the
style's own floats again and the page's pixels are byte-identical to before the edit (the panel's own frame section
prints the frame's milliseconds, so its digits are the one thing that moves). `*` marks a live value, `>` (with the
accent) the cursor, and a box with more than 18 rows shows a window of them with `4-21 of 21` in the footer: the panel
cannot scroll (Clay squeezes a fitted column into its box), so the four sections fit it — two rows a line, and the
column's gap is 2px.

`solid/tune.test.ts` holds it, with `dev-harness.ts`'s page (shared with `dev.test.ts`): the switch's 17 rows and their
numbers and the same numbers from the style's own `resolve`; the panel's three Tab stops and `Tab`/`Shift+Tab` between
them; `Right` on the radius eight times rounding the corner (`48,53,68` to the page's `16,18,24` at the corner pixel)
and the row reading `>* radius 16`; the width moving the box and the a11y row (`280×32` → `281×32`); `bg.r` to 255 and
the row's fill red; the clamps (an alpha at 255, a padding at 0); `r` and `Shift+R` with five rows overridden, the page
byte-for-byte and the panel's sections the ones before; the `*`; a bordered box's window; and the cost (declare and
layout with five overrides, and the draw of an edited frame). Three mechanisms' mutations were run and reverted, their
messages pinned in the test (the write's twice): the width's row writing the height's floats (`FAIL the box is a pixel
wider: "40,118 280×281", wanted "40,118 281×32"`), a radius row one float along (`FAIL the radius rounds the corner`),
a reset that writes the live value back (`FAIL ... and the page is the page before the edit, byte for byte: false`), and
a step without its clamp (`FAIL an alpha past 255 stays 255: 259, wanted 255`).

### A session as a file

`bun solid/main.ts dev --tune path.json` loads the panel's overrides before the first frame; `s`, with the values part
focused, writes the current ones back to the same path (`dev-tune.json` when the flag is absent). The file is data only:

```json
{ "values": [ { "id": "wifi", "field": "radius", "value": 16 } ] }
```

an element id the page has, one of the panel's own row names (`width`, `radius`, `bg.r`, `padding.l`, …; `radius` writes
all four corners), and a number. Entries are written sorted by id and in the panel's row order, so the same session is
the same bytes. Loading checks every entry and fails with its number and why: an unknown id (`tune: entry 1: no element
"nope" on the page`), an unknown field (`tune: entry 1: "radiusX" is not a panel field`) and an out-of-range value
(`tune: entry 1: bg.r 300 is out of range 0..255`). `solid/tune.test.ts` holds it: a two-entry file is the frame of the
same two edits by hand, byte for byte; `s` writes that file and it loads back to the same frame; the three messages; and
a mutation that writes a field name the loader does not know fails the load with `tune: entry 1: "radius!" is not a
panel field`.

## Notes

- `bun solid/main.ts` needs no flag: Bun's `node` condition would load solid-js's server build (signals that never
  update), so `plugin.ts` loads the client build instead.
- `plugin.ts` runs the cssints plugin in a Node child (Vite, and `cssints/clay` as sources with the `development`
  condition), so a `styles.ts` costs about a second at start. A file is a style module by its name: `styles.ts` or
  `*.styles.ts`.
- Not here yet: JSX types for `box` and `text`,
  a click quicker than one poll (the window's 16 ms loop
  keeps the last button state, so a press and a release inside one poll are lost), a menubar on a page (the headless
  `createMenubar` is ported and checked, but no page uses it: the toolbar's menu button is `createMenu`), a vertical
  radio, tabs or toolbar on the page (the parts take the option; the page has the horizontal ones), the tree's
  multi-select (`selection: 'multiple'` is in the part; the page is single) and its type-ahead (not ported), and disabled
  tree nodes (the part has none). The list scrolls one axis and one way: no horizontal scrolling, no momentum (Clay's
  wheel step is instant; the Sky feed has the first motion track, this page opts out), no pointer drag of its contents, no
  scrollbar to drag (the `n of 30` readout stands in for it), and the wheel reaches the viewport only while the pointer is
  over it: Clay scrolls the container under the pointer, and the window is not itself a scroll container.
- The text field is ours, not a port, and it stops at the simple text model: an index is a UTF-16 code unit (a `selection`
  can split a surrogate pair's halves when an arrow crosses it, as `selectionStart` does), no bidi handling and no
  right-to-left runs, no wrapping or multiline (a newline in `insert` is kept as a character; the row is one line that
  clips at the field's box), no undo/redo, and no IME composition *state* — SDL's text events are already committed
  characters, so a composition in progress is not drawn as one (the platform's IME window is what shows it, because
  `ui_text_input` starts SDL's text input). The clipboard is a single UTF-8 string up to 4 KB (the host's buffer), and
  copy/cut/paste are Cmd or Ctrl chords only (no middle-click or context menu). The caret's 1px is layout, not an
  overlay: the text after the caret sits 1px right.

## The command-stream goldens

`solid/goldens/` is six pages' last frames as JSON, and `solid/dump.test.ts` is their gate. `ui_dump_json(path)` in
`solid/native/ui.c` writes the frame (the commands with every field a draw reads, then the renderer's tables beside them:
the shadows, the backdrops, the gradients, the groups, the text weight), `solid/src/dump.ts` adds the a11y snapshot
(`dumpPage(root)`) and formats it stably, and `solid/dump.ts` is the script:

```sh
bun solid/dump.ts sensors                  # the frame to stdout, the counts to stderr
bun solid/dump.ts sky --out /tmp/sky.json  # ... or a file
bun solid/dump.ts widgets --update         # re-store solid/goldens/widgets.json
bun solid/dump.test.ts                     # all five, field by field
```

| golden | page and state | commands | a11y nodes |
| --- | --- | --- | --- |
| `sensors.json` | Sensors at rest | 10 | 0 (no roles: it is not a headless part) |
| `widgets.json` | Widgets, its initial state | 59 | 28 |
| `list.json` | the List's top | 36 | 0 (no roles) |
| `sky.json` | the Sky's Discover, settled | 35 | 4 (the tablist and its tabs) |
| `dialog.json` | the Dialog's menu two frames into its slide | 22 | 7 |

The dialog's frame is the one that carries every table beside the commands — a group at alpha 233, scale 0.971 and
-1.48° (the tilt of its slide out of the trigger), the menu's shadow at blur 3.45, its backdrop at 10, and the float it
hangs off its trigger by — so a change to `ui_shadow`, `ui_backdrop`, the gradient or the group's matrix shows up as a
field and not only as a count of pixels. The Sky's three cards carry the gradients (three stops lists), and the Widgets
page is the one with a real a11y tree.

The test prints `sensors: 10 commands, 0 a11y nodes, identical` a page and names a miss exactly:

```
FAIL sensors: command 2 (text "accel m/s²") colour 150/155/170/255 -> 160/165/180/255
FAIL sensors: command 2 (text "accel m/s²") id 13290005 -> 836677627 (that is command 3 in the golden: the order moved)
```

The differ is `solid/dump.test.ts`'s (`compare`): it walks both trees by path, joins a colour or a box to one value, and
annotates a command with its type and its text. `solid/dump.ts` renders a page the way `main.ts`'s headless path does for
the same stored pixel frame — the page's size and `View` hooks, `--warm 30`'s 31 frames at rest (the Sky's 41), or the
Dialog's `Tab,Tab,Enter` and two settles — and never draws: the raster changes no command. Only `./plugin.ts` may be a
static import in either file; a static import is resolved before the plugin registers and Bun then loads solid-js's
server build, where signals never update (the List's rows stay empty — the reason `main.ts` is shaped the same way).
A theme variant is `capture(page, "light")` plus one golden, if a page's light theme ever needs its own.

What the goldens cannot see is the README's list: the pixels (anti-aliasing, a shadow's raster, a backdrop's blurred
pixels, a gradient's dither), glyph shaping, and everything a frame does not declare (key timing, the focus trap, a
hover that has not moved the tree). A custom command's pointer is an address and the frame's hash is left out of the
goldens for the same reason (with an image it hashes the image's pointer).

`solid/goldens/sensors.json` is also the gate of the page on the other two hosts — the C page on the desktop
(`desktop/host.c --dump`, compared by `dump-check.ts`) and the wasm in the browser (`browser/page.c`'s `dump()`,
compared by `browser/check.mjs`) — both through `desktop/clay_dump.c`, the emitter this section's `ui_dump_json` is an
adapter over. It is one golden because it is one page: the same tree from the same `examples/sensors/styles.ts`, and
measured first, the C page's commands equal these, boxes included (both are laid out with ThorVG's metrics); the browser
keeps the 4 px tolerance Canvas2D's advances need. `solid/dump.test.ts` still owns the file: it is the only thing that
stores it (`--update`), and the other hosts only read it.

## In the browser

This host's modules are the page's, unmodified. `browser/solid/` holds the files a browser target needs:
This host's modules are the page's, unmodified. `browser/solid/` holds what a browser target needs:

```
browser/ui.c                the flat ui_* surface over Clay alone (solid/native/ui.c minus SDL, the window and ThorVG),
                            with the renderer's tables beside the commands — ui_shadow, ui_backdrop, ui_backgroundImage,
                            ui_image, and the value channel's group fields (46-50, 55) — compiled by browser/build.sh to
                            ui.wasm and read by JS through fx/fx_count/fx_stride
browser/solid/ffi-browser.ts  the same `ui` object this directory's src/ffi.ts exports, over that wasm
browser/solid/page.ts       the loop: this src/renderer.ts, this src/frame.ts and app/Sensors.tsx, requestAnimationFrame,
                            the mouse as the pointer, browser/draw.js for the raster
browser/solid/sky.ts        the same for app/Sky.tsx: this src/input.ts's keys from the DOM, the wheel to the page's
                            scroll track, and each draw carrying the effect tables
browser/solid/build.ts      Bun.build --target=browser; src/frame.ts's ./ffi.ts is resolved to ffi-browser.ts
browser/solid/shell.ts      what both pages share: the canvas, the loop (createDrawer), the pointer, the wheel, the keys
                            when a page has an Input, and window.__page (the commands, the dump, the a11y tree, the ms)
browser/solid/keys.ts       a DOM KeyboardEvent as the name this directory's src/input.ts takes, into the page's Input
browser/solid/page.ts       Sensors: this src/renderer.ts, this src/frame.ts and app/Sensors.tsx, no Input
browser/solid/widgets.ts    the Widgets page: the same shell, createInput() and app/Widgets.tsx as main.ts builds it
browser/solid/dialog.ts     the Dialog page: the same shell and Input, app/Dialog.tsx's two root floats (the modal's
                            backdrop and panel) and the menu's glass, with `?glass=0` for the blur's A/B
browser/solid/dialog.html   the Dialog canvas (360x480, tabindex=0) and its script
browser/dialog-check.mjs    Chromium: the Dialog's closed/open/entry frames, the menu's golden, the backdrop's blur
browser/solid/build.ts      Bun.build --target=browser, one entry point each; this src/frame.ts's ./ffi.ts and
browser/solid/list.ts       the List: the same shell, and app/List.tsx unmodified on src/vscroll.ts's machine (the wheel's
                            pixels reduced to notches, the page's own offset, the thumb, the keys' reveal)
browser/solid/field.ts      the Text field: app/Field.tsx unmodified, the DOM's characters through Input.textInput and
                            keys.ts's selectionChord (a canvas has no beforeinput and no composition)
browser/input-check.mjs     the two pages' check: the List's golden and raster, its wheel, its thumb and its keys; the
                            field's typed text, its caret and its selection's pixels, against frames/field-typed.png
browser/solid/dev.ts        the Dev page: app/Dev.tsx unmodified (the Widgets page and the 300px panel that prints the
                            a11y tree, the hovered box, the live values and the frame's phases), with the page's `stats`
                            and the two counters the panel prints (`ui.draws`, `ui.presents`)
browser/solid/sheet.ts      the Text sheet: app/Sheet.tsx unmodified, 440x564 and static — the shell's page with no input
browser/solid/dev.html      the Dev canvas (660x760, tabindex=0) and its script
browser/solid/sheet.html    the sheet's canvas (440x564) and its script
browser/dev-check.mjs       Chromium: the Dev column against frames/dev.png, its 28-node a11y tree, the hover's printed
                            line, Tab/Space and 30 idle frames, and the sheet's golden and raster
browser/solid/build.ts      Bun.build --target=browser, one bundle a page; this src/frame.ts's ./ffi.ts and
                            app/Widgets.tsx's ../src/ffi.ts are resolved to ffi-browser.ts
```

The effects are the desktop renderer's, drawn by Canvas2D: `browser/draw.js` turns a table row into a shadow (the box
plus a blur), a gradient (a `createLinearGradient` along CSS's line, over the box's solid fill when the value channel has
faded it), a group (the subtree's commands into an offscreen canvas, composited once with the alpha and the
scale/rotate/translate about the first command's centre), an image (a decoded bitmap scaled into the box) and a backdrop
(the box's pixels under the element, the desktop's three-pass box blur, then the element's translucent fill over them).
No dither; both it and the backdrop's 0.8 ms are in `native/README.md`'s browser chapter, with the pages' measured
deviations.

`bun browser/solid/build.ts` writes `page.js` and `sky.js` to `${TMPDIR:-/tmp}/cssints-native-web/solid`, and
`node browser/solid-check.mjs` and `node browser/sky-check.mjs` (which `solid/test.sh` runs last, skipped without zig,
bun or Playwright's chromium) hold the pages to `goldens/sensors.json`, to the no-JS page's use_g frame after a real
click, to `browser/expected.png`, and to `frames/sky.png`. The two globals these modules read from the host —
`Bun.nanoseconds` and `Buffer.from` — are shimmed in `browser/solid/globals.ts`; nothing else of Bun or Node is reached.
What the browser surface drops from `solid/native/ui.c` (the window, key and text queues, the clipboard, PNG I/O,
`ui_pixel`/`ui_pixels_copy`, `ui_density`, `ui_font`) is listed at the top of `browser/ui.c`; the pages it carries, and
their cost, are in `native/README.md`'s browser chapter.
The dev loop is `bun browser/serve.ts` (from `native/`, not from here): it builds `ui.wasm` and the bundles into a temp
directory, serves `browser/` and them at one origin (`http://127.0.0.1:4173/browser/solid/index.html`; `--port`,
`--open`, `--root`), and rebuilds on save — a `.ts`/`.tsx` save the bundles, a `.c`/`.h` save the wasm, a
`packages/cssints/dist` change both, a `.js`/`.html` nothing but a reload — then reloads the open pages over a
`text/event-stream` with `location.reload()`, so a page's Solid state is lost. A broken save keeps the last good
artefact, the page keeps running, and the compiler's error shows in a bar at its bottom. `browser/serve-check.mjs` (in
`solid/test.sh`) drives it on a temp copy of the tree; the measured ms and what HMR would need are in
`native/README.md`'s browser chapter.
`browser/solid/keys.ts` is this host's other half of `src/input.ts`. The desktop pops SDL's queue and calls `keyName`
(`main.ts`); the page gets a DOM `keydown`/`keyup` on its canvas and names it with the same answers — `Tab` and
`Shift+Tab`, `" "` for Space (the parts take `Space` too), `Enter`, `Escape`, `Backspace`, `Delete`, the arrows,
`Home`/`End`, `PageUp`/`PageDown`, a letter (`Shift+A` is a page's own chord) and a digit or a punctuation mark — and the
name goes into `input.down(name, repeat)`/`input.up(name)` before the frame runs, exactly as the loop's poll does. Letters
and digits come from `event.code`, because SDL reports the key and not the character (Shift+1 is `1`, not `!`); Cmd, Ctrl
and Alt chords are nobody's, as `keyName` decides, and so is Shift with an arrow, Home, End, Backspace or Delete. Tab,
Space and the arrows are `preventDefault`ed: the canvas holds the DOM's focus (`tabindex="0"`, and a press calls
`focus()`), so the browser must not take Tab for its chrome or Space and the arrows for a scroll. The table is in
`native/README.md`'s browser chapter.

`browser/solid/text.ts` is the field's text above that keyboard. A canvas gets no composition event, so the text comes
from an editable surface: Chromium's `EditContext` (`canvas.editContext = new EditContext()`, with its `compositionstart`,
`textupdate` and `compositionend`), or a hidden 1px `<textarea>` where the browser has none (its keys cloned onto the
canvas, so Tab and the field's own keys still work; `?ime=input` forces it, which is how the checks drive both). Either
path commits one string, at `compositionend`, through `Input.textInput` — the desktop has no composition, so a draft is
never previewed nor inserted — and only while a text field has the focus. The clipboard is Cmd/Ctrl+C/X/V/A on a focused
field: `Input.clipboard("copy")`/`("cut")` into `navigator.clipboard.writeText`, `readText()` → `Input.textInput` for a
paste (one frame after the promise; the field is untouched until it settles), and select-all is the field's own Home then
Shift+End. `browser/ime-check.mjs` holds the path on both surfaces: the draft that never lands, the committed "Ada" as the
typed run's 192 px of ink with the caret at x 80.16, and the four chords.

`bun browser/solid/build.ts` writes `page.js` and `widgets.js` to `${TMPDIR:-/tmp}/cssints-native-web/solid`, and
`node browser/solid-check.mjs` (which `solid/test.sh` runs last, skipped without zig, bun or Playwright's chromium) holds
both pages to their goldens (`goldens/sensors.json`, `goldens/widgets.json`) and their rasters, the Sensors page to the
no-JS page's use_g frame after a real click, and drives the Widgets page's keys (Tab, Space, the tree's arrows) with
Playwright's keyboard. The two globals these modules read from the host — `Bun.nanoseconds` and `Buffer.from` — are
shimmed in `browser/solid/globals.ts`; nothing else of Bun or Node is reached. What the browser surface drops from
`solid/native/ui.c` (the shadow, backdrop, gradient and group tables, images, the window, key and text queues, the
clipboard, PNG I/O, `ui_pixel`/`ui_pixels_copy`, `ui_density`, `ui_font`) is listed at the top of `browser/ui.c`; the
pages it carries, and their cost, are in `native/README.md`'s browser chapter.

**The dev loop, second mode: a hot re-mount.** `bun browser/serve.ts` (its first mode is the reload) pushes `reload` for
a `.c` save, a `both` save or a page that did not opt in, and `hot` for a bundle-only one — data `{"v","why","ms"}`, the
version to import the bundle at. A page opts in with `mountPage({ ..., hot: true })` (the Widgets page; `?hot=0` takes
the reload back) and then nothing navigates: the client calls `window.__hotSwap(v)`, the shell's `import(<bundle>?v=v)`,
and the new module's `mountPage` finds the page load's **host** on `globalThis` — the canvas, the `WebAssembly.Instance`,
Clay's state, the font, the DOM listeners and the pointer — instead of building a second one, renders its tree, stops the
old **session** (`cancelAnimationFrame` and the Solid `render`'s dispose) and starts its own. The modules a page's runtime
is made of are its own, so the page's state is not carried over: the switch reads unchecked and its `:focus` ring is gone
after a re-mount, while the pointer, the document's focus and scroll and the wasm's counters are the host's and stay.
`browser/hot-check.mjs` measures both sides (hot against `?hot=0`), the `.c` case, a broken save, one loop after three
re-mounts, and the measurements are in `native/README.md`'s browser chapter.

**The pointer in the browser, mouse or finger.** `browser/solid/shell.ts` (the five shell pages) and
`browser/solid/sky.ts` (its own loop) listen to the mouse (`mousemove`, `mousedown`, `mouseup`, `mouseleave`) and to a
touchscreen (`pointerdown`, `pointermove`, `pointerup`, `pointercancel` with `pointerType === "touch"`), and both lists
write one state: `px`, `py`, `down` — and `touch`, the flag that becomes `src/frame.ts`'s `onPointer(x, y, down, touch)`
through the drawer's sixth argument (`draw(px, py, down, dt, discrete, touch)`; before this the argument was dropped, so
a frame's `touch` was always false). The mouse's frames carry `touch = false` and a finger's `true`; the page's machine,
`src/vscroll.ts`, uses it for one rule — a finger has no 4px click threshold, so any travel starts a drag while a press
that never moves is still a click. A finger's press is `preventDefault`ed (no compatibility mouse events after a tap), its
pointer captured (a drag that leaves the canvas still lifts on it), the canvas is `touch-action: none` (the browser's pan
is off: the page owns the gesture), and `pointercancel` — the browser taking the gesture back — ends it where the finger
last was, as a release. The mapping is the mouse's `at()`: the element's box into the layout's pixels, which is why
`ui_touch_map` (the desktop's SDL coordinates) has nothing to do here. `window.__page` exposes what a check needs beyond
the frames: `touch()` (the flag the last frame's `onPointer` got) and `offset(id)` (a clip element's `ui_scroll_offset`,
positive down). `browser/touch-check.mjs` holds it — Chromium's own touch through the DevTools protocol's
`Input.dispatchTouchEvent`, the List's 40px row drag and its thumb's 20px, the Sky's 120px drag into the rubber band and a
throw resting on the decay's projection, a tap that selects and opens — with the measured numbers in `native/README.md`'s
browser chapter.

## On the terminal

The third target, beside the desktop's raster and the browser's canvas: Clay over `native/terminal/`'s cell grid
(`cells.c`, `render.c`, `measure.c`, termbox2), no SDL3, no ThorVG, no window. The declaration surface is this host's,
field for field — `packBox`'s 45 floats, `packText`'s 10, and the value channel's `FIELDS` — so `src/renderer.ts`,
`src/pack.ts`, a page's `styles.ts` and the page itself are one module on all three targets.

```
native/solid/native/term.c  Clay + the cells + termbox2 behind flat term_* functions (libterm.dylib): this
                            directory's ui_open/ui_text/ui_value, on cells
native/terminal/term.ts     bun:ffi over it, and the `ui` a page's own module finds (src/entry.ts's motion: the
                            value channel; a cell grid drops the group fields rather than declining the page)
native/terminal/solid.ts    the host: main.ts's loop shape, the tree walked in order, the page's Motion,
                            --dump/--ansi/--keys/--click/--bench and the live termbox2 loop
native/terminal/test.sh     the comparisons against the C page's own frames (native/test.sh runs it)
```

`app/Sensors.tsx` is unmodified, and the host re-cuts only what page.c re-cuts for cells: the root's padding and gap,
the pill's height (3 cells), through the value channel. The pill's ring is the host's, because the page has no focus
prop: `page.c`'s `pill_style(focused)` draws `magnitude`'s colour as a border, and the terminal host does the same from
its own focus. `src/frame.ts` is not reused — it imports `./ffi.ts` (the desktop's) and draws through `ui_draw` — so the
host walks the same tree (~40 lines) with the terminal's calls; that is also why it aliases `./ffi.ts` to
`terminal/term.ts`, so a page's own `pageEntry` motion lands in libterm and is dropped by a cell instead of moving it.
The proof and the cost are in `native/README.md` (`## Solid on the terminal`); what a cell cannot carry is
`native/docs/map.md` step 6's list, and the four sky screens are still C.
