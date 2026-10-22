# cssints-native

A native UI framework on [cssints](../css-in-ts-compiler) styles and [Clay](https://github.com/nicbarker/clay)
layout: the desktop on the GPU first, then an ESP32 with no JS on the chip. The plan and the targets are in
[docs/map.md](docs/map.md).

```ts
import * as css from "cssints/clay" with { type: "cssints" };

export const units = css.cn(css.width(200), css.height(38), css.bg("rgb(36 40 52)"), css.borderRadius(19));
```

```sh
node --conditions=development generator/clay-header.ts styles.ts styles.h   # C for CLAY(CLAY_ID("Units"), units)
```

## Layout

```
generator/clay-header.ts   styles.ts -> styles.h through the cssints plugin
generator/page-to-c.ts     a Solid page at build time to C: renders it, walks the tree, reuses styles.h's names
examples/units/            the pill proven on the board, and same.c: generated vs hand-written, same render commands
examples/sensors/          the Sensors page: styles.ts, page.c, its stored frames
desktop/                   host.c (SDL3 window or a headless frame), clay_renderer_thorvg.c, thorvg_wg.c, build.sh,
                           build-thorvg-gpu.sh (ThorVG's WebGPU engine, from source)
solid/                     Solid 2 on the desktop: a universal renderer over Clay through bun:ffi; the Sensors and Widgets pages (solid/README.md)
focus/                     the focus manager: Tab order, roving focus in groups, restore (no DOM), focus/README.md
terminal/                  the same page in cells: Clay -> terminal/cells.c -> ANSI truecolour; demo, --dump, --keys.
                           The sky screens (home, thread, profile) and their focus layer (terminal/focus.c)
vendor/                    clay.h and Clay's SDL3 renderer (e6cc369), a font
headless/                  button, switch, checkbox, disclosure as signals + neutral parts, checked against Quint specs
browser/                   the same page as WebAssembly on a canvas: page.c (Clay + generated C), render.js, check.mjs
docs/map.md                targets, layers, order of work
```

## Test

```sh
bun install
bun run test     # generator, same.c against esp32's clay.h, the Sensors frames on SDL and on ThorVG (needs brew sdl3 sdl3_ttf sdl3_image thorvg)
sh desktop/build.sh examples/sensors && ./build/sensors/app   # the window, ThorVG's software raster; the t key toggles the theme
./build/sensors/app --raster sdl                              # Clay's SDL3 renderer instead (the window uses the GPU)
sh desktop/build-thorvg-gpu.sh examples/sensors               # ThorVG built from source with its WebGPU engine (~1 min, in $TMPDIR)
./build/sensors/app-gpu --raster thorvg-gpu --bench 500       # the same page on Metal through wgpu-native; needs brew meson ninja pkgconf wgpu-native
sh desktop/build-wg-window.sh && ./build/sensors/wg-window --capture out.png   # ThorVG into the window's own WebGPU surface, no readback; --capture checks the frame
bun solid/main.ts widgets                                     # Solid: headless button, switch, checkboxes, disclosure, radio, tabs, slider, toolbar; Tab, arrows, Space work
./build/sensors/app --press 180 250 --png out.png             # headless: a press held at 180,250, the frame written while pressed
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
drawn by `browser/render.js` on a `<canvas>`: rectangles, inside borders, `roundRect` corners, `fillText`, `clip()` for
a scissor. No framework and no build step at run time. Text is measured by Canvas2D through one wasm import, so Clay
lays out with the same font the canvas draws with (Roboto from `vendor/fonts`), and `w` or the button switches the
`use_g` frame.

```sh
sh browser/build.sh            # -> ${TMPDIR:-/tmp}/cssints-native-web/page.wasm, next to the generated styles.h
node browser/check.mjs         # Chromium through Playwright: the command array and the raster
node browser/check.mjs --serve # http://127.0.0.1:<port>/browser/index.html — a browser will not fetch a .wasm from file://
```

| What         | Size       |
| ------------ | ---------- |
| `page.wasm`  | 104,375 B  |
| the page     | 8,505 B (index.html + render.js) |

`browser/check.mjs` builds nothing: `browser/build.sh` does, into `$TMPDIR`, because the wasm is a build product.
`browser/dump-commands.c` is how the desktop's command table in the check was produced (Clay + SDL_ttf/Roboto, the
frame in `examples/sensors/expected-thorvg.png`); it is not part of the page.

## The sky screens in a terminal

`apps/csssky-tui` (css-in-ts-compiler) ported to cells: the same cards, the same recorded fixtures, the same palette
from its `styles.ts`. Its two screens and the profile of the sibling web app `apps/csssky`:

| screen | data | keys |
| --- | --- | --- |
| the feed (`--page sky`) | `apps/csssky`'s `home-discover-1` and `home-science-1` (three posts each; News has no fixture) | `tab`/`shift-tab` between the bar and the list, `left`/`right` the tabs (which switch the feed), `j`/`k` or `up`/`down` the list, `1`-`3` a feed, `enter` opens, `t` the theme, `q` quits |
| a thread (`--page thread`) | `thread.json`: the parent, the post, its replies | `j`/`k` or the arrows, `esc` back |
| a profile (`--page profile`) | `profile.json`, `profile-posts`, `profile-replies`, `profile-media` | `left`/`right` the tabs, `tab` to the list, `j`/`k` or `up`/`down`, `enter` opens a thread, `esc` back |

The focus is `terminal/focus.c`, a port of the semantics of `focus/src/focus.ts` (not shared code with it): Tab stops in
document order with the focus released at either end (a terminal has no platform to hand Tab to, so the page presses it
again and wraps), a group as one stop with roving focus, and `focus(id)` refusing a disabled stop. A click is a press
and a release over one control; the terminal has no pointer motion beyond that.

What stays unported: `apps/csssky-tui` has no profile screen of its own (that one is the web app's, on the same data
layer and fixtures); no fetching (the frame is the recorded fixture), no images (a media line), no quote box, no
wrapping (a body is one clipped row), the app's system theme, and the app shell (a bar, a list, a footer is all).

`cssints` comes from npm (`^0.5.0`, the release that carries `cssints/clay` and its images): no local link, so the tree builds on a
clean machine. The tests still run with `--conditions=development`, which resolves to the package's shipped source;
`dist` is what a web build gets. A change to the engine means a new release, not an edit in a sibling checkout.
