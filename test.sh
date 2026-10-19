#!/bin/sh
# The generator on the Units example, then the C against Clay. CLAY_H is the folder of clay.h (esp32's by default,
# until clay.h moves here at the desktop step).
set -e
CLAY_H="${CLAY_H:-$HOME/github/esp32/firmware/clay-test/main}"
OUT="${TMPDIR:-/tmp}/cssints-native-test"
mkdir -p "$OUT"
node --conditions=development generator/clay-header.ts examples/units/styles.ts "$OUT/styles.h"
cc -std=c99 -I "$OUT" -I "$CLAY_H" examples/units/same.c -lm -o "$OUT/same"
"$OUT/same"
