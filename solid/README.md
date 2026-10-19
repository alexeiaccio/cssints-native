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
app/Sensors.tsx    the Sensors page; styles are examples/sensors/styles.ts, the same file the C page's styles.h comes from
main.ts, test.ts   the host (window and headless), and the checks the stored frames cannot make
```

A style is the `ClayShape` literal of `cssints/clay`. A theme (`THEME=light`, `t`) and a state are picked at run time
by `resolve()` in `pack.ts`, the merge `header()` does for C (`units_active_light`). `:hover`/`:active` apply to a box
with an `id`: Clay tells whether the pointer is over it. `onClick` runs on release over the box that was pressed.

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
| `ui_window_open(title)`, `ui_window_poll(f32[5])`, `ui_window_present()` | SDL3 window (Metal); poll fills pointer x, y, button, quit, key |
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

## Notes

- `bun solid/main.ts` needs no flag: Bun's `node` condition would load solid-js's server build (signals that never
  update), so `plugin.ts` loads the client build instead.
- `plugin.ts` runs the cssints plugin in a Node child (Vite, and `cssints/clay` as sources with the `development`
  condition), so a `styles.ts` costs about a second at start. A file is a style module by its name: `styles.ts` or
  `*.styles.ts`.
- Not here yet: `:focus`, floating, images, scrolling, text input, reload on save, JSX types for `box` and `text`.
