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
bun solid/main.ts widgets                        # the Widgets page (360x760): Tab, Shift+Tab, arrows, Space, Enter, the mouse (below)
bun solid/main.ts widgets --keys Tab,Tab,Space --expect solid/frames/widgets-switch-on.png   # scripted keys, then the frame
bun solid/main.ts widgets --drag 0.25 0.75 --png out.png                 # headless: press the slider's rail at a quarter, hold, move to three quarters
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
plugin.ts          Bun plugin: JSX through @solidjs/compiler, `styles.ts` and a page's own styles through cssints, solid-js client build
compile-styles.ts  Node child of the plugin: Vite + cssints, prints a style module as JS
compile.tsx.ts     Node child of a `.tsx` whose styles live in it: Solid's JSX first, then cssints on the JS
stub-bun.mjs       `bun:ffi` for that child: cssints runs the page to read its tokens, and the dylib has no meaning in Node
src/input.ts       SDL keys to names, and where a key goes: the focus manager, the focused part, the page
app/Sensors.tsx    the Sensors page; styles are examples/sensors/styles.ts, the same file the C page's styles.h comes from
app/Widgets.tsx    the Widgets page: headless button, switch, checkboxes, disclosure, radio, tabs, slider, toolbar, settings tree, and its styles, in the same file
frames/            the Widgets page's stored frames (the Sensors page's are in examples/sensors)
main.ts            the host (window and headless)
test.ts, widgets.test.ts   the checks the stored frames cannot make
```

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
`End`, `PageUp`, `PageDown`, a letter as itself in lower case. A Ctrl, Alt or Cmd chord has no name and is dropped, and so is Shift with an
arrow, Home or End (the manager takes plain keys only). Then `input.down(name, repeat)`:

1. Tab and Shift+Tab go to the focus manager. It answers true when it moved focus. Past the last Tab stop it releases
   focus and answers false (a browser would hand Tab to its chrome): the next Tab starts at the first stop again, so the
   order cycles through one "nothing focused" stop.
2. Otherwise the focused part's `keyDown(name, repeat)`: Enter on a button, Space armed on key down; in a group the
   arrows, Home and End: the part asks the manager to move focus itself and then checks or selects what it moved to (a
   radio checks, tabs select, a toolbar only moves), a slider changes its value, and PageUp and PageDown are its large
   step. A key a pattern does not have (Home on a radio, Up on a horizontal toolbar) is nobody's. The arrows must not go
   to the manager first: it would move focus and the radio would never check.
3. Otherwise `input.fallback(name)`, the page level: `t` toggles the theme.

`input.up(name)` goes to the focused part's `keyUp` (Space fires there). `focus.onChange` blurs the part that lost focus
(dropping an armed Space) and focuses the one that got it, so a part's `focused` follows the manager.

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
| Volume (slider 0..100, step 5, page 20, `valueText` "45%") | not a group: one entry (the thumb) | arrows step, PageUp and PageDown move by 20, Home and End go to the ends, clamped; a press on the rail or the knob sets the value and starts a drag: each held frame's x is the ratio from the rail's `ui_bounds` (less the knob's width, so a press on the knob's middle keeps its value); the ring is the slider's row (rail and value), not the knob |
| Format (toolbar: Bold, Italic, Underline; each toggles a lamp under its label) | a group: horizontal, no wrap, **memory**, `focusDisabled` | Left and Right, Home and End move; Enter and Space toggle on key down; Tab away and back lands on the item left last |
| Settings (tree: Network open with Wi-Fi and Bluetooth, Display closed with Brightness, Storage a leaf: six nodes) | a group: vertical, no wrap, no memory, `entry` = the first selected visible node, else the first visible; a node in a closed subtree has `tabIndex: -1` | one Tab stop: Tab enters at Network (the first visible row); Up and Down, Home and End walk the visible rows only; Right opens the closed Display and, on an open parent, steps into its first child; Left closes an open parent, or steps to it from a child; Space selects, Enter opens and selects; a click opens, selects and focuses |

The tree is the last group, made after the toolbar, so its rows are the page's last Tab stop: Tab out of the tree
releases focus (nothing is after it). Its styles: a row per node with the hover and pressed looks of the other rows and
the same 2px `ring` on the roving row; the row's left padding is one step of 18px per `level` (`nodeOf`, one style made
at run time per level and selection, as `fillOf` does for the slider); `+` on a closed parent, `-` on an open one, and
a leaf has none; the selected row is the `surface` fill with its label in the `accent` (4.5:1 or more on the surface in
both themes); a node in a closed subtree is not in the Solid tree at all (`Show when={!item.hidden}`), so its row is
neither drawn nor findable. No disabled nodes: the tree part has none, so the page has no dim row look.

The slider's filled part is the one style made at run time (`fillOf`: `s.fill` with a fixed width of the value, kept
per width); Clay has no flex ratio. The focus ring is the slider row's (`s.sliderRow`: the rail and the value, no
padding or border at rest), and a drag reuses `Slider.pointer` for each held frame's x: a press sets the value, moving
with the button down follows the pointer, and a release ends it where it was.

Checked by `bun solid/widgets.test.ts` (no pixels but a few ring, fill and knob positions: the full Tab order over the
page and Shift+Tab, one Tab stop for each group, Space on key up and Enter on key down, a held Space once, a click toggling
and focusing, the disabled box, blur on empty space, select all, the disclosure, the page fitting its window, the radio's
arrows (wrap, Space, Tab in at the checked one, a disabled radio skipped by arrows, Tab and a click), the tabs' arrows,
Home, End and panels, the slider's step, page keys, ends, clamping and rail presses, the toolbar's ends, memory and
toggles, the tree's one stop, its visible-only arrows, Right and Left, Home and End, Space, the ring following the roving
row, a hidden node skipped, contrast of the ink on every fill, key names, the drag) and by sixteen stored frames in
`frames/`:

| Frame | Keys | Shows |
| --- | --- | --- |
| `widgets-initial` | | the page at rest: 1x checked, Overview selected, Volume 40%, no lamp on; below the toolbar the tree: `- Network` with Wi-Fi and Bluetooth, `+ Display`, Storage |
| `widgets-tab2` | Tab Tab | ring on the switch |
| `widgets-switch-on` | Tab Tab Space | the switch on |
| `widgets-mixed` | Tab×4 Space | Wired checked and ringed, "Select all" mixed |
| `widgets-disclosure` | Tab Tab Space Tab×4 Enter | the panel open, everything below it moved down, nothing shrunk |
| `widgets-radio` | Tab×7 ArrowRight | 4x checked and ringed, 1x cleared |
| `widgets-tabs` | Tab×8 ArrowRight | Stats selected and ringed, its panel's text |
| `widgets-slider` | Tab×10 ArrowRight | 45%, the filled part and the knob a step on, ring around the slider's row |
| `widgets-slider-drag` | a press at a quarter, held, a move to three quarters | the knob near the right end, the fill grown, 80%, ring still on the row |
| `widgets-toolbar` | Tab×11 Enter ArrowRight Shift+Tab Tab | Bold's lamp on; Italic ringed after leaving for the slider and coming back |
| `widgets-light` | the disclosure, then the four groups | the light theme: 4x, Stats, 50%, Bold on and ringed |
| `widgets-tree-focus` | Tab×12 | the ring on Network, the tree's first visible row: Network open with its two children, Display closed, Storage after it |
| `widgets-tree-down` | Tab×12 ArrowDown | the ring on Wi-Fi, the selection still empty (`ArrowDown` moves, it does not select) |
| `widgets-tree-expanded` | Tab×12 ArrowDown×3 ArrowRight | Display opened by Right (`+` became `-`), Brightness indented under it, the ring still on Display |
| `widgets-tree-select` | Tab×12 ArrowDown×3 ArrowRight Space | the same, and Display selected: the surface fill with its label in the accent, ring still on it |
| `widgets-tree-light` | the same keys, light | the light theme: Wi-Fi selected (white fill, accent label) and ringed |

## Notes

- `bun solid/main.ts` needs no flag: Bun's `node` condition would load solid-js's server build (signals that never
  update), so `plugin.ts` loads the client build instead.
- `plugin.ts` runs the cssints plugin in a Node child (Vite, and `cssints/clay` as sources with the `development`
  condition), so a `styles.ts` costs about a second at start. A file is a style module by its name: `styles.ts` or
  `*.styles.ts`.
- Not here yet: floating, images, scrolling, text input, reload on save, JSX types for `box` and `text`, an
  accessibility tree (the parts' `role`, `checked`, `expanded`... are there for it), a click quicker than one poll (the
  window's 16 ms loop keeps the last button state, so a press and a release inside one poll are lost), the
  toolbar's menu item (the headless menu is not ported), a vertical radio, tabs or toolbar on the page (the parts take the
  option; the page has the horizontal ones), the tree's multi-select (`selection: 'multiple'` is in the part; the page is
  single) and its type-ahead (not ported), and disabled tree nodes (the part has none).
