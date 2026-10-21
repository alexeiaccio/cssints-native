#!/bin/sh
# The terminal target: the Sensors styles.ts -> styles.h, then the window-less host with the demo page.
#   sh terminal/build.sh   -> terminal/demo
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/terminal/build"
mkdir -p "$OUT"
node --conditions=development "$ROOT/generator/clay-header.ts" "$ROOT/examples/sensors/styles.ts" "$OUT/styles.h"
cc -std=c99 -O2 -Wall -Wno-unused-parameter -Wno-unused-variable -Wno-missing-field-initializers \
  -I "$OUT" -I "$ROOT/vendor/clay" -I "$ROOT/terminal" \
  "$ROOT/terminal/main.c" "$ROOT/terminal/page.c" "$ROOT/terminal/cells.c" "$ROOT/terminal/render.c" \
  "$ROOT/terminal/measure.c" -lm -o "$ROOT/terminal/demo"
echo "$ROOT/terminal/demo"
