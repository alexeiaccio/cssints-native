#!/bin/sh
# The generator on the Units example, then the C against Clay. CLAY_H is the folder of clay.h (esp32's by default,
# until clay.h moves here at the desktop step).
set -e
CLAY_H="${CLAY_H:-$HOME/github/esp32/firmware/clay-test/main}"
OUT="${TMPDIR:-/tmp}/cssints-native-test"
mkdir -p "$OUT/sensors"
node --conditions=development generator/clay-header.ts examples/units/styles.ts "$OUT/styles.h"
cc -std=c99 -I "$OUT" -I "$CLAY_H" examples/units/same.c -lm -o "$OUT/same"
"$OUT/same"
# the Sensors header (a state, a theme, fonts) against the same clay.h
node --conditions=development generator/clay-header.ts examples/sensors/styles.ts "$OUT/sensors/styles.h"
cc -std=c99 -Wall -Wno-unused-variable -I "$OUT/sensors" -I "$CLAY_H" examples/sensors/header.c -lm -o "$OUT/header"
"$OUT/header"

# Step 5: the Solid Sensors page evaluated at build time to C, in three states, and its render commands compared by
# gen.c with the hand-written page.c (base, clicked, pressed; each in the dark and the light theme). The generator is
# deterministic: the committed C is regenerated here and must come out byte for byte, so the file in git cannot rot.
mkdir -p "$OUT/sensors-gen"
P="bun --conditions=development generator/page-to-c.ts solid/app/Sensors.tsx --styles examples/sensors/styles.ts --states examples/sensors/states.json"
$P --state use_g=false --out "$OUT/sensors-gen/page_generated.c"
$P --state use_g=true --name app_frame_g --out "$OUT/sensors-gen/page_generated_g.c"
$P --state pressed=true --name app_frame_pressed --out "$OUT/sensors-gen/page_generated_pressed.c"
for f in page_generated.c page_generated_g.c page_generated_pressed.c; do
  cmp "$OUT/sensors-gen/$f" "examples/sensors/$f" || { echo "FAIL: examples/sensors/$f is stale"; exit 1; }
done
cc -std=c99 -Wall -Wno-unused-variable -I "$OUT/sensors" -I "$CLAY_H" examples/sensors/gen.c \
  "$OUT/sensors-gen/page_generated.c" "$OUT/sensors-gen/page_generated_g.c" \
  "$OUT/sensors-gen/page_generated_pressed.c" -lm -o "$OUT/gen"
"$OUT/gen"
# a page with its styles in the .tsx (InlineDemo.tsx, no styles module): the literals header() prints, compiled
bun --conditions=development generator/page-to-c.ts solid/app/InlineDemo.tsx --out "$OUT/sensors-gen/inline_generated.c"
cc -std=c99 -Wall -Wno-unused-variable -I "$CLAY_H" -c "$OUT/sensors-gen/inline_generated.c" -o "$OUT/inline_generated.o"

# The desktop: the Sensors page headless, against its stored frames: the SDL renderer (the software one; the window
# uses the GPU), dark, after a scripted click on Units, and the light theme
sh desktop/build.sh examples/sensors >/dev/null
./build/sensors/app --raster sdl --expect examples/sensors/expected.png
./build/sensors/app --raster sdl --click 180 250 --expect examples/sensors/expected-g.png
THEME=light ./build/sensors/app --raster sdl --expect examples/sensors/expected-light.png
# the same page on ThorVG's software raster (brew thorvg, the default), against its own frames
./build/sensors/app --raster thorvg --expect examples/sensors/expected-thorvg.png
./build/sensors/app --raster thorvg --click 180 250 --expect examples/sensors/expected-thorvg-g.png
THEME=light ./build/sensors/app --raster thorvg --expect examples/sensors/expected-thorvg-light.png
# Units held down: the pressed look (units_active), written while the pointer is still down
./build/sensors/app --raster thorvg --press 180 250 --expect examples/sensors/expected-pressed.png
# the same page on ThorVG's WebGPU canvas (Metal through wgpu-native): only when its build exists, because brew's
# thorvg has no GPU engine. Its frame is its own: the shapes and colours are the CPU frame's, the anti-aliasing is not
if [ -x ./build/sensors/app-gpu ]; then
  ./build/sensors/app-gpu --raster thorvg-gpu --expect examples/sensors/expected-thorvg-gpu.png
fi

# Solid 2 on the desktop: the Sensors page as JSX, its frames against the same stored ThorVG frames
sh solid/test.sh
# the focus manager (no DOM): Tab order, roving focus, restore, and a seeded random walk
node focus/test/focus.test.ts

# Headless widgets (button, switch, checkbox, disclosure) on neutral parts: ported scenarios and a walk against the Quint models
(cd headless && bun install --frozen-lockfile >/dev/null && bun run typecheck && bun run test)

# Step 6: the terminal target. Clay's commands into character cells (terminal/cells.c, render.c, measure.c), the
# Sensors page plus a list in C. The cell layer's own checks, then three stored frames: the dark page, the light
# theme, and the page after Tab (focus the list) and ArrowDown (select the second row). A cell is 8x16, so the page
# is 80x20 cells. In a dump, '.' is a cell whose background is not the page's (the pill's fill, the selected row).
sh terminal/build.sh >/dev/null
cc -std=c99 -Wall -Wno-unused-variable -Wno-missing-field-initializers -I terminal -I vendor/clay \
  terminal/test_cells.c terminal/cells.c terminal/render.c -lm -o "$OUT/test_cells"
"$OUT/test_cells"
./terminal/demo --cols 80 --rows 20 --dump "$OUT/term-dark.txt"
cmp "$OUT/term-dark.txt" terminal/expected-dark.txt || { echo "FAIL: terminal/expected-dark.txt is stale"; exit 1; }
./terminal/demo --cols 80 --rows 20 --theme light --dump "$OUT/term-light.txt"
cmp "$OUT/term-light.txt" terminal/expected-light.txt || { echo "FAIL: terminal/expected-light.txt is stale"; exit 1; }
./terminal/demo --cols 80 --rows 20 --keys Tab,ArrowDown --dump "$OUT/term-focus.txt"
cmp "$OUT/term-focus.txt" terminal/expected-focus.txt || { echo "FAIL: terminal/expected-focus.txt is stale"; exit 1; }
# the ANSI path, which the dump cannot show: truecolour SGR for a known cell, and runs merged (the surface fill is
# one escape a row that carries it -- 4 rows, 123 cells -- not one an empty cell)
ESC=$(printf '\033')
./terminal/demo --cols 80 --rows 20 --ansi "$OUT/term.ansi"
grep -qF "${ESC}[38;2;230;60;60m" "$OUT/term.ansi" || { echo "FAIL: the title has no red (38;2;230;60;60)"; exit 1; }
grep -qF "${ESC}[38;2;235;235;240m" "$OUT/term.ansi" || { echo "FAIL: the pill's label has no ink (38;2;235;235;240)"; exit 1; }
runs=$(grep -oF "${ESC}[48;2;36;40;52m" "$OUT/term.ansi" | wc -l | tr -d ' ')
[ "$runs" = 4 ] || { echo "FAIL: the surface background has $runs SGR runs, want 4 (merged, not one a cell)"; exit 1; }
