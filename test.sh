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

# The desktop: the Sensors page headless, against its stored frames (the software renderer; the window uses the GPU):
# dark, after a scripted click on Units, and the light theme
sh desktop/build.sh examples/sensors >/dev/null
./build/sensors/app --expect examples/sensors/expected.png
./build/sensors/app --click 180 250 --expect examples/sensors/expected-g.png
THEME=light ./build/sensors/app --expect examples/sensors/expected-light.png
# the same page on ThorVG's software raster (brew thorvg), against its own frames
./build/sensors/app --raster thorvg --expect examples/sensors/expected-thorvg.png
./build/sensors/app --raster thorvg --click 180 250 --expect examples/sensors/expected-thorvg-g.png
THEME=light ./build/sensors/app --raster thorvg --expect examples/sensors/expected-thorvg-light.png

# Solid 2 on the desktop: the Sensors page as JSX, its frames against the same stored ThorVG frames
sh solid/test.sh
