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
bun solid/main.ts widgets                        # the Widgets page: Tab, Shift+Tab, Space, Enter, the mouse (below)
bun solid/main.ts widgets --keys Tab,Tab,Space --expect solid/frames/widgets-switch-on.png   # scripted keys, then the frame
bun solid/main.ts --expect examples/sensors/expected-thorvg.png          # one frame against a stored PNG
bun solid/main.ts --click 180 250 --expect examples/sensors/expected-thorvg-g.png   # host.c's scripted click
THEME=light bun solid/main.ts --expect examples/sensors/expected-thorvg-light.png
bun solid/main.ts --png out.png --bench 1000     # ms a frame by phase
sh solid/test.sh                                 # all of it; `bun run test` calls it last
```

## Layout

```
native/ui.c        Clay + desktop/clay_renderer_thorvg.c + SDL3 window behind flat C functions (libui.dylib)
src/renderer.ts    createRenderer: El (tag, props, children) and Txt nodes; <box id style onClick>, <text style>
src/pack.ts        a ClayShape + theme + state -> Float32Array, once per variant
src/frame.ts       one frame: pointer in, events, flush(), the tree declared, layout, draw
src/ffi.ts         bun:ffi bindings
plugin.ts          Bun plugin: JSX through @solidjs/compiler, `styles.ts` through the cssints Vite plugin, solid-js client build
compile-styles.ts  Node child of the plugin: Vite + cssints, prints the style module as JS
src/input.ts       SDL keys to names, and where a key goes: the focus manager, the focused part, the page
app/Sensors.tsx    the Sensors page; styles are examples/sensors/styles.ts, the same file the C page's styles.h comes from
app/Widgets.tsx    the Widgets page: headless button, switch, checkboxes, disclosure; its styles are app/widgets.styles.ts
frames/            the Widgets page's stored frames (the Sensors page's are in examples/sensors)
main.ts            the host (window and headless)
test.ts, widgets.test.ts   the checks the stored frames cannot make
```

A style is the `ClayShape` literal of `cssints/clay`. A theme (`THEME=light`, `t`) and a state are picked at run time
by `resolve()` in `pack.ts`, the merge `header()` does for C (`units_active_light`). `:hover`/`:active` apply to a box
with an `id`: Clay tells whether the pointer is over it. `onClick` runs on release over the box that was pressed;
`onPress` when the button goes down over it. `:focus` applies while the box's `focused` prop is true.

## The FFI (flat, no struct crosses it)

| Function | |
| --- | --- |
| `ui_init(w, h)`, `ui_font(path)` | Clay and a ThorVG canvas; a font by file path, its id is the order of calls. 0 / id on success |
| `ui_begin(px, py, down)` | pointer for this frame, `Clay_BeginLayout` |
| `ui_open(id, len, f32[32])` | open an element; `id` NULL for none; the style as below |
| `ui_text(bytes, len, f32[10])` | a text element; the bytes are copied for the frame |
| `ui_close()` | close the element |
| `ui_pointer_over(id, len)` | Clay's `Clay_PointerOver`, on the last frame's layout |
| `ui_end(dt)`, `ui_draw()` | `Clay_EndLayout` (returns the command count); ThorVG draws the commands into the buffer |
| `ui_save_png(path)`, `ui_diff_png(ref, actual)`, `ui_pixel(x, y)` | the frame out; pixels that differ from a PNG; one pixel |
| `ui_window_open(title)`, `ui_window_poll(f32[5])`, `ui_window_present()` | SDL3 window (Metal); poll fills pointer x, y, button, quit, the last key's character |
| `ui_key_pop(i32[4])` | the oldest key event the polls queued: down (1) or up (0), SDL keycode, `SDL_Keymod`, repeat. 0 when none; 64 are kept |
| `ui_bounds(id, len, f32[4])` | x, y, width, height of an element in the last layout (tests click at the middle of a part) |
| `ui_errors()` | Clay errors so far |

Text is measured by ThorVG, as in `host.c`.

### `ui_open` fields (`pack.ts` `packBox`, `ui.c` `ui_open`)

| i | field | | i | field |
| --- | --- | --- | --- | --- |
| 0 1 2 | width: type, min or percent, max | | 14-17 | background r g b a |
| 3 4 5 | height: type, min or percent, max | | 18-21 | corner radius tl tr br bl |
| 6-9 | padding left right top bottom | | 22-25 | border width left right top bottom |
| 10 | child gap | | 26-29 | border colour r g b a |
| 11 12 | child alignment x (0 left, 1 centre, 2 right), y (0 top, 1 centre, 2 bottom) | | 30 31 | clip horizontal, vertical |
| 13 | direction (0 row, 1 column) | | | |

Sizing type: 0 fit, 1 grow, 2 percent, 3 fixed (Clay's order).

### `ui_text` fields (`packText`)

0-3 colour r g b a, 4 fontId, 5 fontSize, 6 letterSpacing, 7 lineHeight, 8 alignment (0 left, 1 centre, 2 right),
9 wrap (0 words, 1 newlines, 2 none).

## Keys, focus and the Widgets page

`bun solid/main.ts widgets` is the headless widgets (`headless/`) and the focus manager (`focus/`) on this renderer.

**A key.** The window queues every key down and up (repeats too); the host pops them (`ui_key_pop`) after the poll and
before the frame. `keyName` (`src/input.ts`) gives the names the manager and the parts use: `Tab`, `Shift+Tab`, `Enter`
(keypad too), `" "` for Space (DOM's `key`; the parts take `"Space"` too), `Escape`, `ArrowLeft/Right/Up/Down`, `Home`,
`End`, a letter as itself in lower case. A Ctrl, Alt or Cmd chord has no name and is dropped, and so is Shift with an
arrow, Home or End (the manager takes plain keys only). Then `input.down(name, repeat)`:

1. Tab, Shift+Tab, the arrows, Home, End go to the focus manager. It answers true when it moved focus (or owns the arrow).
   Past the last Tab stop it releases focus and answers false (a browser would hand Tab to its chrome): the next Tab
   starts at the first stop again, so the order cycles through one "nothing focused" stop.
2. Otherwise the focused part's `keyDown(name, repeat)`: Enter on a button, Space armed on key down.
3. Otherwise `input.fallback(name)`, the page level: `t` toggles the theme.

`input.up(name)` goes to the focused part's `keyUp` (Space fires there). `focus.onChange` blurs the part that lost focus
(dropping an armed Space) and focuses the one that got it, so a part's `focused` follows the manager.

**The pointer.** A box with `onPress` runs it when the button goes down over it, as a browser focuses on mousedown;
`onClick` still runs on release over the box that was pressed. `input.add(part)` registers the part in the manager
(in call order: the document order) and returns the props `{ id, focused, onPress, onClick }` to spread on its row:
a press focuses it (`focus.focus(id)`) and a release over it calls `part.press()`. A press on a part that cannot take
focus (the disabled checkbox) changes nothing, focus stays where it was and `press()` ignores it. A press on no
element with `onPress` (empty space) blurs: `createFrame`'s `onPressMiss` calls `input.pressMiss()`.

**`:focus`.** A style may have `css.focus(...)`. A box with an `id` and a `focused` prop that is true takes it; with
`:hover`/`:active` the states that hold are laid over the base in the order hover, focus, active, so active wins a field
they both set, and focus ring and pressed look show together (`resolve` in `pack.ts`). The Widgets styles use a 2px
border in the `ring` token (a border does not change Clay's layout, so the ring moves nothing).

**The page.** `app/Widgets.tsx`: a button that counts presses, a Wi-Fi switch (the thumb is at the end of the track
by `trackOn` instead of `track`), "Select all" (mixed) over Wired and Wireless (`all` is controlled: its `value` is
read from the two, its `onValueChange` sets both), a disabled checkbox, and a disclosure whose panel is in the tree
while `!panel.hidden`. Tab order: button, switch, select all, wired, wireless, trigger.

Checked by `bun solid/widgets.test.ts` (no pixels but one ring and one pressed pixel: the order and wrap of Tab and
Shift+Tab, Space on key up and Enter on key down, a held Space once, a click toggling and focusing, the disabled box,
blur on empty space, select all, the disclosure, key names) and by six stored frames in `frames/`: initial, Tab Tab
(ring on the switch), Space on it (on), Tab×4 and Space (the first child checked, "Select all" mixed), the disclosure
opened with Enter, and the light theme after a longer run.

## Notes

- `bun solid/main.ts` needs no flag: Bun's `node` condition would load solid-js's server build (signals that never
  update), so `plugin.ts` loads the client build instead.
- `plugin.ts` runs the cssints plugin in a Node child (Vite, and `cssints/clay` as sources with the `development`
  condition), so a `styles.ts` costs about a second at start. A file is a style module by its name: `styles.ts` or
  `*.styles.ts`.
- Not here yet: floating, images, scrolling, text input, reload on save, JSX types for `box` and `text`, an
  accessibility tree (the parts' `role`, `checked`, `expanded`... are there for it), a click quicker than one poll (the
  window's 16 ms loop keeps the last button state, so a press and a release inside one poll are lost), groups on the page
  (roving focus is in `focus/`, the radio, tabs and toolbar ports are not wired here).
